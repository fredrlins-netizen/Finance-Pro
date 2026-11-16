import type { Express } from 'express';
import multer from 'multer';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { db } from '../db/index.ts';
import {
  auditLogs,
  clients,
  collaborators,
  collectionNotes,
  coordinatorTaskAttachments,
  coordinatorTaskColumns,
  coordinatorTasks,
  coordinatorTaskShares,
  coordinatorTaskSubtasks,
  documentObjects,
  financialTitles,
  userGroups,
  users,
  type TaskTimerPauseEntry,
} from '../db/schema.ts';
import {
  AuthRequest,
  getAllowedUnitIds,
  isUnitPermitted,
  requireAuth,
  requireModule,
} from '../middleware/auth.ts';
import {
  canPreviewInline,
  getBucketObjectBuffer,
  putBucketObject,
  sanitizeFileName,
  validateUploadFile,
} from '../services/bucketStorage.ts';
import { runIviOrchestrator } from '../services/ivi.ts';
import { dispatchIviSectorNotification } from '../services/internalMessaging.ts';
import {
  parsePositiveIntArray,
  parsePositiveIntId,
  parseSafeDate,
  sanitizeErrorMessage,
} from '../utils/validation.ts';

const taskAttachmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

const CRITICALITY_WEIGHT: Record<string, number> = {
  emergencial: 5,
  critico: 4,
  alto: 3,
  medio: 2,
  baixo: 1,
};

const STATUS_FALLBACK_COLS = [
  { title: 'Pendente', color: '#64748b', isFinal: false, sortOrder: 1, key: 'PENDENTE' },
  { title: 'Em Execução', color: '#2563eb', isFinal: false, sortOrder: 2, key: 'EM_EXECUCAO' },
  { title: 'Pausado', color: '#d97706', isFinal: false, sortOrder: 3, key: 'PAUSADO' },
  { title: 'Concluído', color: '#16a34a', isFinal: true, sortOrder: 4, key: 'CONCLUIDO' },
  { title: 'Cancelado', color: '#dc2626', isFinal: false, sortOrder: 5, key: 'CANCELADO' },
];

function deriveStatusKeyFromTitle(title: string, isFinal: boolean): string {
  const clean = (title || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (clean === 'PENDENTE' || clean === 'PENDENTES') return 'PENDENTE';
  if (clean === 'EM_EXECUCAO') return 'EM_EXECUCAO';
  if (clean === 'PAUSADO' || clean === 'PAUSADA' || clean === 'PAUSADOS') return 'PAUSADO';
  if (clean === 'CANCELADO' || clean === 'CANCELADA' || clean === 'CANCELADOS') return 'CANCELADO';
  if (clean === 'CONCLUIDO' || clean === 'CONCLUIDA' || clean === 'CONCLUIDOS') return 'CONCLUIDO';
  if (isFinal && !clean) return 'CONCLUIDO';
  return clean || 'PENDENTE';
}

async function ensureDefaultColumnsForOwner(ownerUserId: number) {
  const existing = await db
    .select()
    .from(coordinatorTaskColumns)
    .where(eq(coordinatorTaskColumns.ownerUserId, ownerUserId))
    .orderBy(asc(coordinatorTaskColumns.sortOrder), asc(coordinatorTaskColumns.id));

  if (existing.length > 0) return existing;

  const inserted = await db
    .insert(coordinatorTaskColumns)
    .values(
      STATUS_FALLBACK_COLS.map((c) => ({
        ownerUserId,
        title: c.title,
        color: c.color,
        isFinal: c.isFinal,
        sortOrder: c.sortOrder,
      }))
    )
    .returning();

  return inserted.sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
}

async function getTaskWithAccess(taskId: number, userId: number) {
  const rows = await db.select().from(coordinatorTasks).where(eq(coordinatorTasks.id, taskId)).limit(1);
  const task = rows[0];
  if (!task) return { task: null, permission: null as null | 'owner' | 'edit' | 'view' };
  if (task.ownerUserId === userId) return { task, permission: 'owner' as const };
  const shares = await db
    .select()
    .from(coordinatorTaskShares)
    .where(eq(coordinatorTaskShares.taskId, taskId));
  const mine = shares.find((s) => s.sharedWithUserId === userId);
  if (!mine) return { task: null, permission: null };
  return { task, permission: (mine.permission === 'view' ? 'view' : 'edit') as 'edit' | 'view' };
}

async function logTaskAudit(
  req: AuthRequest,
  action: string,
  entityId: string | number,
  details: Record<string, unknown>
) {
  await db.insert(auditLogs).values({
    userId: req.authUser?.id ?? null,
    userName: req.authUser?.name || 'Coordenador',
    action,
    entityType: 'coordinator_task',
    entityId: String(entityId),
    details,
    unitId: req.activeUnitId ?? null,
  });
}

export function registerCollectionTasksRoutes(
  app: Express,
  deps: { broadcast: (event: string, payload: unknown) => void }
) {
  const requireCollection = requireModule('collection');

  // ---------------------------------------------------------------------------
  // 1. BOOTSTRAP TAREFAS DO COORDENADOR LOGADO (+ COMPARTILHADAS COM ELE)
  // ---------------------------------------------------------------------------
  app.get('/api/collection/coordinator/tasks', requireAuth, requireCollection, async (req: AuthRequest, res) => {
    try {
      const userId = req.authUser!.id;
      const columns = await ensureDefaultColumnsForOwner(userId);

      const [ownedTasks, sharedWithMeRows, allUsers, allGroups] = await Promise.all([
        db.select().from(coordinatorTasks).where(eq(coordinatorTasks.ownerUserId, userId)),
        db.select().from(coordinatorTaskShares).where(eq(coordinatorTaskShares.sharedWithUserId, userId)),
        db
          .select({
            id: users.id,
            name: users.name,
            email: users.email,
            role: users.role,
            groupId: users.groupId,
            active: users.active,
          })
          .from(users)
          .orderBy(asc(users.name)),
        db.select({ id: userGroups.id, name: userGroups.name }).from(userGroups),
      ]);

      const sharedTaskIds = Array.from(new Set(sharedWithMeRows.map((s) => s.taskId)));
      const sharedTasks =
        sharedTaskIds.length > 0
          ? await db.select().from(coordinatorTasks).where(inArray(coordinatorTasks.id, sharedTaskIds))
          : [];

      const mergedMap = new Map<number, typeof coordinatorTasks.$inferSelect>();
      for (const t of ownedTasks) mergedMap.set(t.id, t);
      for (const t of sharedTasks) mergedMap.set(t.id, t);
      const visibleTasks = Array.from(mergedMap.values());

      const taskIds = visibleTasks.map((t) => t.id);
      const [allSubtasks, allShares, allAttachments] =
        taskIds.length > 0
          ? await Promise.all([
              db
                .select()
                .from(coordinatorTaskSubtasks)
                .where(inArray(coordinatorTaskSubtasks.taskId, taskIds))
                .orderBy(asc(coordinatorTaskSubtasks.sortOrder), asc(coordinatorTaskSubtasks.id)),
              db
                .select()
                .from(coordinatorTaskShares)
                .where(inArray(coordinatorTaskShares.taskId, taskIds))
                .orderBy(desc(coordinatorTaskShares.createdAt)),
              db
                .select()
                .from(coordinatorTaskAttachments)
                .where(inArray(coordinatorTaskAttachments.taskId, taskIds))
                .orderBy(desc(coordinatorTaskAttachments.createdAt)),
            ])
          : [[], [], []];

      const shareByTaskMap = new Map(sharedWithMeRows.map((s) => [s.taskId, s]));

      const enriched = visibleTasks
        .map((t) => {
          const subs = allSubtasks.filter((s) => s.taskId === t.id);
          const shares = allShares.filter((s) => s.taskId === t.id);
          const attachments = allAttachments.filter((a) => a.taskId === t.id);
          const isOwner = t.ownerUserId === userId;
          const myShare = shareByTaskMap.get(t.id);
          const subEstSum = subs.reduce((acc, s) => acc + Number(s.estimatedMinutes || 0), 0);
          const derivedEstimatedMinutes =
            subs.length > 0 && subEstSum > 0 ? subEstSum : t.estimatedMinutes;

          return {
            ...t,
            isOwner,
            mySharePermission: isOwner
              ? ('owner' as const)
              : myShare?.permission === 'view'
              ? ('view' as const)
              : ('edit' as const),
            derivedEstimatedMinutes,
            subtasks: subs,
            shares,
            attachments,
          };
        })
        .sort((a, b) => {
          const rank = (item: typeof a) => {
            if (item.statusKey === 'CANCELADO') return 3;
            if (item.isCompleted || item.statusKey === 'CONCLUIDO') return 2;
            if (item.statusKey === 'PAUSADO') return 1;
            return 0;
          };
          const rankDiff = rank(a) - rank(b);
          if (rankDiff !== 0) return rankDiff;
          const critDiff =
            (CRITICALITY_WEIGHT[b.criticality] || 2) - (CRITICALITY_WEIGHT[a.criticality] || 2);
          if (critDiff !== 0) return critDiff;
          if (a.dueAt && b.dueAt) return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
          if (a.dueAt) return -1;
          if (b.dueAt) return 1;
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        });

      const groupMap = new Map(allGroups.map((g) => [g.id, g.name]));
      const coordinators = allUsers
        .filter((u) => u.active && u.id !== userId)
        .map((u) => ({
          id: u.id,
          name: u.name,
          email: u.email,
          role: u.role,
          groupName: u.groupId ? groupMap.get(u.groupId) || 'Coordenador' : 'Equipe',
        }));

      res.json({
        currentUserId: userId,
        currentUserName: req.authUser!.name,
        columns,
        tasks: enriched,
        coordinators,
      });
    } catch (error) {
      console.error('Load coordinator tasks error:', error);
      res.status(500).json({ error: 'Erro ao carregar tarefas da coordenação.' });
    }
  });

  // ---------------------------------------------------------------------------
  // 2. CONFIGURAR COLUNAS DO QUADRO KANBAN (§6.4)
  // ---------------------------------------------------------------------------
  app.put('/api/collection/coordinator/tasks/columns', requireAuth, requireCollection, async (req: AuthRequest, res) => {
    try {
      const userId = req.authUser!.id;
      const incoming = (req.body?.columns || []) as Array<{
        id?: number;
        title: string;
        color?: string;
        isFinal?: boolean;
      }>;

      const cleanCols = incoming
        .map((c, idx) => ({
          id: c.id && Number(c.id) > 0 ? Number(c.id) : null,
          title: String(c.title || '').trim(),
          color: String(c.color || '#64748b').trim() || '#64748b',
          isFinal: Boolean(c.isFinal),
          sortOrder: idx + 1,
        }))
        .filter((c) => c.title.length > 0);

      if (cleanCols.length === 0) {
        return res.status(400).json({ error: 'O quadro precisa manter pelo menos uma coluna nomeada.' });
      }

      const existing = await ensureDefaultColumnsForOwner(userId);
      const keptIds = new Set(cleanCols.filter((c) => c.id).map((c) => c.id!));
      const removedIds = existing.filter((c) => !keptIds.has(c.id)).map((c) => c.id);

      const savedCols: Array<typeof coordinatorTaskColumns.$inferSelect> = [];
      for (const col of cleanCols) {
        if (col.id && existing.some((e) => e.id === col.id)) {
          const [updated] = await db
            .update(coordinatorTaskColumns)
            .set({
              title: col.title,
              color: col.color,
              isFinal: col.isFinal,
              sortOrder: col.sortOrder,
            })
            .where(eq(coordinatorTaskColumns.id, col.id))
            .returning();
          if (updated) {
            savedCols.push(updated);
            await db
              .update(coordinatorTasks)
              .set({
                statusLabel: updated.title,
                statusKey: deriveStatusKeyFromTitle(updated.title, updated.isFinal),
              })
              .where(eq(coordinatorTasks.statusColumnId, updated.id));
          }
        } else {
          const [created] = await db
            .insert(coordinatorTaskColumns)
            .values({
              ownerUserId: userId,
              title: col.title,
              color: col.color,
              isFinal: col.isFinal,
              sortOrder: col.sortOrder,
            })
            .returning();
          if (created) savedCols.push(created);
        }
      }

      // Reconcile tasks from deleted columns into the first column
      if (removedIds.length > 0 && savedCols[0]) {
        const fallback = savedCols[0];
        await db
          .update(coordinatorTasks)
          .set({
            statusColumnId: fallback.id,
            statusLabel: fallback.title,
            statusKey: deriveStatusKeyFromTitle(fallback.title, fallback.isFinal),
          })
          .where(inArray(coordinatorTasks.statusColumnId, removedIds));
        await db.delete(coordinatorTaskColumns).where(inArray(coordinatorTaskColumns.id, removedIds));
      }

      await logTaskAudit(req, 'COORDINATOR_TASK_COLUMNS_UPDATED', userId, {
        columnsCount: savedCols.length,
        titles: savedCols.map((c) => c.title),
      });

      res.json({ columns: savedCols });
    } catch (error) {
      console.error('Update task columns error:', error);
      res.status(500).json({ error: 'Erro ao salvar configuração de colunas.' });
    }
  });

  // ---------------------------------------------------------------------------
  // 3. CRIAR TAREFA (associada ao usuário/coordenador logado)
  // ---------------------------------------------------------------------------
  app.post('/api/collection/coordinator/tasks', requireAuth, requireCollection, async (req: AuthRequest, res) => {
    try {
      const userId = req.authUser!.id;
      const body = (req.body || {}) as {
        title?: string;
        clientId?: number | null;
        titleId?: number | null;
        collaboratorId?: number | null;
        projectLabel?: string;
        originType?: string;
        description?: string;
        solutionNotes?: string;
        priority?: string;
        criticality?: string;
        statusColumnId?: number | null;
        dueAt?: string | null;
        estimatedMinutes?: number | null;
        reviewWithIvi?: boolean;
        subtask?: {
          title?: string;
          description?: string;
          criticality?: string;
          estimatedMinutes?: number | null;
        } | null;
      };

      const title = String(body.title || '').trim();
      if (!title) {
        return res.status(400).json({ error: 'Informe o título da tarefa.' });
      }

      if (body.estimatedMinutes !== undefined && body.estimatedMinutes !== null && Number(body.estimatedMinutes) < 1) {
        return res.status(400).json({ error: 'O tempo estimado deve ser no mínimo 1 minuto.' });
      }

      if (body.subtask?.title?.trim() && !body.subtask?.description?.trim()) {
        return res.status(400).json({
          error: 'Quando uma subtarefa inicial for informada, a descrição da subtarefa é obrigatória.',
        });
      }

      let parsedDueAt: Date | null = null;
      if (body.dueAt !== undefined && body.dueAt !== null && String(body.dueAt).trim() !== '') {
        parsedDueAt = parseSafeDate(body.dueAt);
        if (!parsedDueAt) return res.status(400).json({ error: 'Data de vencimento inválida.' });
      }

      const columns = await ensureDefaultColumnsForOwner(userId);
      const targetCol =
        (body.statusColumnId && columns.find((c) => c.id === Number(body.statusColumnId))) ||
        columns[0];

      let clientName = '';
      let validClientId: number | null = null;
      if (body.clientId) {
        const cid = parsePositiveIntId(body.clientId);
        if (!cid) return res.status(400).json({ error: 'ID de cliente inválido.' });
        const cRows = await db.select().from(clients).where(eq(clients.id, cid)).limit(1);
        if (cRows[0]) {
          if (!isUnitPermitted(req, cRows[0].unitId)) {
            return res.status(403).json({ error: 'Sem permissão para vincular clientes desta unidade.' });
          }
          validClientId = cRows[0].id;
          clientName = cRows[0].fullName;
        }
      }

      let collaboratorName = '';
      let validCollabId: number | null = null;
      if (body.collaboratorId) {
        const colId = parsePositiveIntId(body.collaboratorId);
        if (!colId) return res.status(400).json({ error: 'ID de colaborador inválido.' });
        const colRows = await db
          .select()
          .from(collaborators)
          .where(eq(collaborators.id, colId))
          .limit(1);
        if (colRows[0]) {
          validCollabId = colRows[0].id;
          collaboratorName = colRows[0].name;
        }
      }

      const validTitleId = body.titleId ? parsePositiveIntId(body.titleId) : null;

      let iviReviewNote = '';
      if (body.reviewWithIvi && (body.description?.trim() || title)) {
        try {
          const iviRes = await runIviOrchestrator(
            'Você é Ivi, copiloto da coordenação de cobrança do FinancePro. Avalie em no máximo 2 frases curtas a clareza operacional desta tarefa e sugira 1 critério objetivo de entrega.',
            `Título: ${title}\nDescrição: ${body.description || '(sem descrição)'}\nCliente: ${clientName || 'Não vinculado'}`
          );
          iviReviewNote = iviRes.text;
        } catch {
          iviReviewNote = '';
        }
      }

      const statusKey = deriveStatusKeyFromTitle(targetCol.title, targetCol.isFinal);
      const [created] = await db
        .insert(coordinatorTasks)
        .values({
          ownerUserId: userId,
          ownerName: req.authUser!.name,
          unitId: req.activeUnitId || req.authUser!.defaultUnitId || null,
          clientId: validClientId,
          clientName,
          titleId: validTitleId,
          collaboratorId: validCollabId,
          collaboratorName,
          projectLabel: String(body.projectLabel || '').trim(),
          originType: String(body.originType || 'direta').trim(),
          title,
          description: String(body.description || '').trim(),
          solutionNotes: String(body.solutionNotes || '').trim(),
          priority: String(body.priority || 'media').trim().toLowerCase(),
          criticality: String(body.criticality || 'medio').trim().toLowerCase(),
          statusColumnId: targetCol.id,
          statusKey,
          statusLabel: targetCol.title,
          isCompleted: targetCol.isFinal,
          dueAt: parsedDueAt,
          estimatedMinutes: body.estimatedMinutes ? Math.max(1, Math.round(Number(body.estimatedMinutes))) : null,
          iviReviewNote,
          completedAt: targetCol.isFinal ? new Date() : null,
          completedByName: targetCol.isFinal ? req.authUser!.name : '',
        })
        .returning();

      if (body.subtask?.title?.trim()) {
        await db.insert(coordinatorTaskSubtasks).values({
          taskId: created.id,
          sortOrder: 1,
          title: body.subtask.title.trim(),
          description: String(body.subtask.description || '').trim(),
          criticality: String(body.subtask.criticality || 'medio').trim().toLowerCase(),
          priority: 'media',
          estimatedMinutes: body.subtask.estimatedMinutes
            ? Math.max(1, Math.round(Number(body.subtask.estimatedMinutes)))
            : null,
          status: 'PENDENTE',
        });
      }

      await logTaskAudit(req, 'COORDINATOR_TASK_CREATED', created.id, {
        title: created.title,
        ownerUserId: userId,
        clientName,
        criticality: created.criticality,
      });

      await dispatchIviSectorNotification(
        {
          targetSector: 'cobranca',
          targetUnitId: req.activeUnitId || null,
          relatedEntityType: 'coordinator_task',
          relatedEntityId: created.id,
          senderName: 'Ivi IA · Coordenação Cobrança',
          subject: `Nova Tarefa de Cobrança · ${created.title}`,
          body: `${req.authUser!.name} atribuiu a tarefa "${created.title}"${collaboratorName ? ` para ${collaboratorName}` : ''} (${created.criticality.toUpperCase()}).`,
        },
        db,
        deps.broadcast
      );

      deps.broadcast('collection:payment', { type: 'task_created', taskId: created.id });
      res.json({ task: created });
    } catch (error) {
      console.error('Create coordinator task error:', error);
      res.status(500).json({ error: 'Erro ao criar tarefa.' });
    }
  });

  // ---------------------------------------------------------------------------
  // 4. ATUALIZAR / MOVER / ENCERRAR TAREFA (§5, §6.1, §8)
  // ---------------------------------------------------------------------------
  app.patch('/api/collection/coordinator/tasks/:id', requireAuth, requireCollection, async (req: AuthRequest, res) => {
    try {
      const taskId = parsePositiveIntId(req.params.id);
      if (!taskId) return res.status(400).json({ error: 'ID de tarefa inválido.' });
      const userId = req.authUser!.id;
      const access = await getTaskWithAccess(taskId, userId);
      if (!access.task) {
        return res.status(404).json({ error: 'Tarefa não encontrada ou sem permissão de acesso.' });
      }
      if (access.permission === 'view') {
        return res.status(403).json({ error: 'Você possui acesso somente de leitura nesta tarefa compartilhada.' });
      }

      const task = access.task;
      const body = (req.body || {}) as {
        title?: string;
        clientId?: number | null;
        collaboratorId?: number | null;
        projectLabel?: string;
        description?: string;
        solutionNotes?: string;
        occurrenceNotes?: string;
        blockingReason?: string;
        pauseReason?: string;
        cancelReason?: string;
        priority?: string;
        criticality?: string;
        statusColumnId?: number | null;
        statusKey?: 'PENDENTE' | 'EM_EXECUCAO' | 'PAUSADO' | 'CONCLUIDO' | 'CANCELADO' | string;
        dueAt?: string | null;
        estimatedMinutes?: number | null;
        isCompleted?: boolean;
        validateClosureWithIvi?: boolean;
      };

      const ownerColumns = await ensureDefaultColumnsForOwner(task.ownerUserId);
      const requestedStatusKey = body.statusKey ? String(body.statusKey).toUpperCase() : null;
      const statusChangeRequested =
        requestedStatusKey !== null ||
        body.statusColumnId !== undefined ||
        body.isCompleted !== undefined;

      let nextCol = body.statusColumnId
        ? ownerColumns.find((c) => c.id === Number(body.statusColumnId)) || null
        : null;

      if (!nextCol && requestedStatusKey) {
        nextCol =
          ownerColumns.find(
            (c) => deriveStatusKeyFromTitle(c.title, c.isFinal) === requestedStatusKey
          ) || null;
      }

      if (body.isCompleted === true && (!nextCol || !nextCol.isFinal)) {
        nextCol =
          ownerColumns.find((c) => c.isFinal) || ownerColumns[ownerColumns.length - 1] || nextCol;
      }

      const resolvedStatusKey = statusChangeRequested
        ? requestedStatusKey ||
          (nextCol
            ? deriveStatusKeyFromTitle(nextCol.title, nextCol.isFinal)
            : body.isCompleted === true
            ? 'CONCLUIDO'
            : task.statusKey)
        : task.statusKey;

      const resolvedStatusLabel = statusChangeRequested
        ? nextCol?.title ||
          (resolvedStatusKey === 'PAUSADO'
            ? 'Pausado'
            : resolvedStatusKey === 'CANCELADO'
            ? 'Cancelado'
            : resolvedStatusKey === 'CONCLUIDO'
            ? 'Concluído'
            : resolvedStatusKey === 'EM_EXECUCAO'
            ? 'Em Execução'
            : 'Pendente')
        : task.statusLabel;

      const resolvedStatusColumnId = statusChangeRequested
        ? nextCol
          ? nextCol.id
          : resolvedStatusKey === 'PAUSADO' || resolvedStatusKey === 'CANCELADO'
          ? null
          : task.statusColumnId
        : task.statusColumnId;

      const targetWillComplete = statusChangeRequested
        ? Boolean(
            resolvedStatusKey === 'CONCLUIDO' ||
              nextCol?.isFinal ||
              body.isCompleted === true
          )
        : task.isCompleted;

      const nextClientId =
        body.clientId !== undefined ? (body.clientId ? Number(body.clientId) : null) : task.clientId;

      let nextBlocking =
        body.blockingReason !== undefined
          ? String(body.blockingReason || '').trim()
          : task.blockingReason;
      if (resolvedStatusKey === 'PAUSADO') {
        const reason = String(body.pauseReason || body.blockingReason || '').trim();
        nextBlocking = reason || nextBlocking || 'Pausada pela coordenação';
      } else if (
        statusChangeRequested &&
        task.statusKey === 'PAUSADO' &&
        (resolvedStatusKey === 'PENDENTE' || resolvedStatusKey === 'EM_EXECUCAO') &&
        body.blockingReason === undefined
      ) {
        nextBlocking = '';
      }

      let nextOccurrenceNotes =
        body.occurrenceNotes !== undefined
          ? String(body.occurrenceNotes)
          : task.occurrenceNotes;
      if (resolvedStatusKey === 'CANCELADO' && body.cancelReason?.trim()) {
        const cleanCancel = body.cancelReason.trim();
        nextOccurrenceNotes = nextOccurrenceNotes.trim()
          ? `${nextOccurrenceNotes.trim()}\n[Cancelamento] ${cleanCancel}`
          : `[Cancelamento] ${cleanCancel}`;
      }

      // Guide §8: validate subtasks & closure notes when transitioning to completed
      if (statusChangeRequested && targetWillComplete) {
        const subs = await db
          .select()
          .from(coordinatorTaskSubtasks)
          .where(eq(coordinatorTaskSubtasks.taskId, task.id));
        const pendingSubs = subs.filter((s) => s.status !== 'CONCLUIDO');
        if (pendingSubs.length > 0) {
          return res.status(400).json({
            error: `Existem ${pendingSubs.length} subtarefa(s) pendente(s). Conclua todas as subtarefas antes de encerrar a tarefa.`,
          });
        }
        const occ = nextOccurrenceNotes.trim();
        const sol =
          body.solutionNotes !== undefined ? String(body.solutionNotes).trim() : task.solutionNotes.trim();
        if (!occ && !sol) {
          return res.status(400).json({
            error: 'Registrar Encerramento exige preenchimento operacional em Ocorrência ou Solução Adotada.',
          });
        }
      }

      if (
        statusChangeRequested &&
        nextBlocking &&
        nextCol &&
        !nextCol.isFinal &&
        resolvedStatusKey !== 'PAUSADO' &&
        resolvedStatusKey !== 'CANCELADO' &&
        nextCol.sortOrder > 1 &&
        task.statusColumnId !== nextCol.id
      ) {
        return res.status(400).json({
          error: `Tarefa possui bloqueio registrado ("${nextBlocking}"). Remova o bloqueio antes de avançar a etapa.`,
        });
      }

      let clientName = task.clientName;
      if (body.clientId !== undefined) {
        if (nextClientId) {
          const cRows = await db.select().from(clients).where(eq(clients.id, nextClientId)).limit(1);
          clientName = cRows[0]?.fullName || '';
        } else {
          clientName = '';
        }
      }

      let nextCollabId = task.collaboratorId;
      let nextCollabName = task.collaboratorName;
      if (body.collaboratorId !== undefined) {
        if (body.collaboratorId) {
          const colRows = await db
            .select()
            .from(collaborators)
            .where(eq(collaborators.id, Number(body.collaboratorId)))
            .limit(1);
          nextCollabId = colRows[0]?.id ?? null;
          nextCollabName = colRows[0]?.name || '';
        } else {
          nextCollabId = null;
          nextCollabName = '';
        }
      }

      // Stop running stopwatch cleanly upon completion, pause, or cancellation
      let timerRunningSince = task.timerRunningSince;
      let timerAccumulatedSeconds = task.timerAccumulatedSeconds;
      let timerPauseLogsJson = Array.isArray(task.timerPauseLogsJson) ? [...task.timerPauseLogsJson] : [];
      if (
        statusChangeRequested &&
        (targetWillComplete || resolvedStatusKey === 'PAUSADO' || resolvedStatusKey === 'CANCELADO') &&
        task.timerRunningSince
      ) {
        const startedMs = new Date(task.timerRunningSince).getTime();
        const elapsedSec = Math.max(1, Math.round((Date.now() - startedMs) / 1000));
        timerAccumulatedSeconds += elapsedSec;
        timerPauseLogsJson.push({
          startedAt: new Date(startedMs).toISOString(),
          pausedAt: new Date().toISOString(),
          durationSeconds: elapsedSec,
          reason:
            resolvedStatusKey === 'PAUSADO'
              ? String(body.pauseReason || body.blockingReason || 'Tarefa pausada pela coordenação').trim()
              : resolvedStatusKey === 'CANCELADO'
              ? String(body.cancelReason || 'Tarefa cancelada pela coordenação').trim()
              : 'Encerramento da tarefa',
          userName: req.authUser!.name,
        });
        timerRunningSince = null;
      }

      let iviReviewNote = task.iviReviewNote;
      if (statusChangeRequested && targetWillComplete && body.validateClosureWithIvi) {
        try {
          const occ = nextOccurrenceNotes;
          const sol = body.solutionNotes ?? task.solutionNotes;
          const iviRes = await runIviOrchestrator(
            'Você é Ivi, auditora de tarefas de cobrança. Valide de forma objetiva (máx. 2 frases) se o encerramento descreve causa e solução coerentes.',
            `Tarefa: ${body.title || task.title}\nOcorrência: ${occ}\nSolução adotada: ${sol}`
          );
          iviReviewNote = iviRes.text;
        } catch {
          // Non-blocking fallback
        }
      }

      let nextDueAt = task.dueAt;
      if (body.dueAt !== undefined) {
        if (body.dueAt === null || String(body.dueAt).trim() === '') {
          nextDueAt = null;
        } else {
          const parsed = parseSafeDate(body.dueAt);
          if (!parsed) return res.status(400).json({ error: 'Data de vencimento inválida.' });
          nextDueAt = parsed;
        }
      }

      const [updated] = await db
        .update(coordinatorTasks)
        .set({
          title: body.title !== undefined && body.title.trim() ? body.title.trim() : task.title,
          clientId: nextClientId,
          clientName,
          collaboratorId: nextCollabId,
          collaboratorName: nextCollabName,
          projectLabel:
            body.projectLabel !== undefined ? String(body.projectLabel).trim() : task.projectLabel,
          description:
            body.description !== undefined ? String(body.description) : task.description,
          solutionNotes:
            body.solutionNotes !== undefined ? String(body.solutionNotes) : task.solutionNotes,
          occurrenceNotes: nextOccurrenceNotes,
          blockingReason: nextBlocking,
          priority:
            body.priority !== undefined ? String(body.priority).toLowerCase() : task.priority,
          criticality:
            body.criticality !== undefined ? String(body.criticality).toLowerCase() : task.criticality,
          statusColumnId: resolvedStatusColumnId,
          statusKey: resolvedStatusKey,
          statusLabel: resolvedStatusLabel,
          isCompleted: targetWillComplete,
          dueAt: nextDueAt,
          estimatedMinutes:
            body.estimatedMinutes !== undefined
              ? body.estimatedMinutes
                ? Math.max(1, Math.round(Number(body.estimatedMinutes)))
                : null
              : task.estimatedMinutes,
          timerRunningSince,
          timerAccumulatedSeconds,
          timerPauseLogsJson,
          iviReviewNote,
          completedAt: targetWillComplete ? task.completedAt || new Date() : null,
          completedByName: targetWillComplete ? task.completedByName || req.authUser!.name : '',
          updatedAt: new Date(),
        })
        .where(eq(coordinatorTasks.id, task.id))
        .returning();

      const auditAction =
        resolvedStatusKey === 'CONCLUIDO'
          ? 'COORDINATOR_TASK_COMPLETED'
          : resolvedStatusKey === 'PAUSADO'
          ? 'COORDINATOR_TASK_PAUSED'
          : resolvedStatusKey === 'CANCELADO'
          ? 'COORDINATOR_TASK_CANCELLED'
          : 'COORDINATOR_TASK_UPDATED';

      await logTaskAudit(req, auditAction, task.id, {
        statusKey: updated.statusKey,
        statusLabel: updated.statusLabel,
        isCompleted: updated.isCompleted,
        dueAt: updated.dueAt,
      });

      deps.broadcast('collection:payment', { type: 'task_updated', taskId: updated.id });
      res.json({ task: updated });
    } catch (error) {
      console.error('Update coordinator task error:', error);
      res.status(500).json({ error: 'Erro ao atualizar tarefa.' });
    }
  });

  // ---------------------------------------------------------------------------
  // 5. EXCLUIR TAREFA (INDIVIDUAL OU EM LOTE)
  // ---------------------------------------------------------------------------
  app.delete('/api/collection/coordinator/tasks/:id', requireAuth, requireCollection, async (req: AuthRequest, res) => {
    try {
      const taskId = parsePositiveIntId(req.params.id);
      if (!taskId) return res.status(400).json({ error: 'ID de tarefa inválido.' });
      const userId = req.authUser!.id;
      const rows = await db.select().from(coordinatorTasks).where(eq(coordinatorTasks.id, taskId)).limit(1);
      const task = rows[0];
      if (!task) return res.status(404).json({ error: 'Tarefa não encontrada.' });
      if (task.ownerUserId !== userId && req.authUser!.role !== 'admin') {
        return res.status(403).json({ error: 'Apenas o coordenador proprietário pode excluir esta tarefa.' });
      }
      await db.delete(coordinatorTasks).where(eq(coordinatorTasks.id, taskId));
      await logTaskAudit(req, 'COORDINATOR_TASK_DELETED', taskId, { title: task.title });
      deps.broadcast('collection:payment', { type: 'task_deleted', taskId });
      res.json({ ok: true });
    } catch (error) {
      console.error('Delete coordinator task error:', error);
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao excluir tarefa.') });
    }
  });

  app.post('/api/collection/coordinator/tasks/batch-delete', requireAuth, requireCollection, async (req: AuthRequest, res) => {
    try {
      const userId = req.authUser!.id;
      const ids = parsePositiveIntArray(req.body?.taskIds);
      if (ids.length === 0) return res.status(400).json({ error: 'Selecione ao menos uma tarefa válida.' });

      const rows = await db.select().from(coordinatorTasks).where(inArray(coordinatorTasks.id, ids));
      const deletable = rows.filter((t) => t.ownerUserId === userId || req.authUser!.role === 'admin');
      if (deletable.length === 0) {
        return res.status(403).json({ error: 'Nenhuma das tarefas selecionadas pertence ao seu usuário para exclusão.' });
      }
      const delIds = deletable.map((d) => d.id);
      await db.delete(coordinatorTasks).where(inArray(coordinatorTasks.id, delIds));
      await logTaskAudit(req, 'COORDINATOR_TASKS_BATCH_DELETED', delIds.join(','), {
        count: delIds.length,
      });
      res.json({ ok: true, deletedCount: delIds.length });
    } catch (error) {
      console.error('Batch delete tasks error:', error);
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao excluir tarefas selecionadas.') });
    }
  });

  // ---------------------------------------------------------------------------
  // 6. CRONÔMETRO DA TAREFA (Iniciar / Pausar com justificativa §6.2)
  // ---------------------------------------------------------------------------
  app.post('/api/collection/coordinator/tasks/:id/timer', requireAuth, requireCollection, async (req: AuthRequest, res) => {
    try {
      const taskId = parsePositiveIntId(req.params.id);
      if (!taskId) return res.status(400).json({ error: 'ID de tarefa inválido.' });
      const userId = req.authUser!.id;
      const access = await getTaskWithAccess(taskId, userId);
      if (!access.task || access.permission === 'view') {
        return res.status(403).json({ error: 'Sem permissão para operar o cronômetro desta tarefa.' });
      }
      const task = access.task;
      const { action, reason } = (req.body || {}) as { action: 'start' | 'pause'; reason?: string };

      if (action === 'start') {
        if (!task.clientId) {
          return res.status(400).json({
            error: 'Vincule um cliente à tarefa antes de iniciar o cronômetro.',
          });
        }
        if (task.blockingReason?.trim()) {
          return res.status(400).json({
            error: `Cronômetro bloqueado: "${task.blockingReason}".`,
          });
        }
        if (task.timerRunningSince) {
          return res.json({ task });
        }
        const [updated] = await db
          .update(coordinatorTasks)
          .set({ timerRunningSince: new Date(), updatedAt: new Date() })
          .where(eq(coordinatorTasks.id, task.id))
          .returning();
        return res.json({ task: updated });
      }

      if (action === 'pause') {
        const cleanReason = String(reason || '').trim();
        if (!cleanReason) {
          return res.status(400).json({ error: 'Informe a justificativa de pausa do cronômetro.' });
        }
        if (!task.timerRunningSince) {
          return res.json({ task });
        }
        const startedMs = new Date(task.timerRunningSince).getTime();
        const elapsedSec = Math.max(1, Math.round((Date.now() - startedMs) / 1000));
        const nextLogs: TaskTimerPauseEntry[] = [
          ...(Array.isArray(task.timerPauseLogsJson) ? task.timerPauseLogsJson : []),
          {
            startedAt: new Date(startedMs).toISOString(),
            pausedAt: new Date().toISOString(),
            durationSeconds: elapsedSec,
            reason: cleanReason,
            userName: req.authUser!.name,
          },
        ];
        const [updated] = await db
          .update(coordinatorTasks)
          .set({
            timerRunningSince: null,
            timerAccumulatedSeconds: task.timerAccumulatedSeconds + elapsedSec,
            timerPauseLogsJson: nextLogs,
            updatedAt: new Date(),
          })
          .where(eq(coordinatorTasks.id, task.id))
          .returning();
        return res.json({ task: updated });
      }

      res.status(400).json({ error: 'Ação de cronômetro inválida.' });
    } catch (error) {
      console.error('Task timer error:', error);
      res.status(500).json({ error: 'Erro ao atualizar cronômetro da tarefa.' });
    }
  });

  // ---------------------------------------------------------------------------
  // 7. SUBTAREFAS CRUD + CRONÔMETRO + PRECEDÊNCIA (§4.3 & §5.3)
  // ---------------------------------------------------------------------------
  app.post('/api/collection/coordinator/tasks/:id/subtasks', requireAuth, requireCollection, async (req: AuthRequest, res) => {
    try {
      const taskId = parsePositiveIntId(req.params.id);
      if (!taskId) return res.status(400).json({ error: 'ID de tarefa inválido.' });
      const access = await getTaskWithAccess(taskId, req.authUser!.id);
      if (!access.task || access.permission === 'view') {
        return res.status(403).json({ error: 'Sem permissão para adicionar subtarefa.' });
      }

      const body = (req.body || {}) as {
        title?: string;
        description?: string;
        criticality?: string;
        priority?: string;
        assignedCollaboratorId?: number | null;
        dueAt?: string | null;
        estimatedMinutes?: number | null;
        requiresPredecessor?: boolean;
      };
      const title = String(body.title || '').trim();
      if (!title) return res.status(400).json({ error: 'Informe o título da subtarefa.' });

      let subDueAt: Date | null = null;
      if (body.dueAt !== undefined && body.dueAt !== null && String(body.dueAt).trim() !== '') {
        subDueAt = parseSafeDate(body.dueAt);
        if (!subDueAt) return res.status(400).json({ error: 'Data de vencimento da subtarefa inválida.' });
      }

      const existingSubs = await db
        .select()
        .from(coordinatorTaskSubtasks)
        .where(eq(coordinatorTaskSubtasks.taskId, taskId));
      const nextSort = existingSubs.length + 1;

      let collabName = '';
      let validCollabId: number | null = null;
      if (body.assignedCollaboratorId) {
        const colId = parsePositiveIntId(body.assignedCollaboratorId);
        if (!colId) return res.status(400).json({ error: 'ID de colaborador inválido.' });
        const colRows = await db
          .select()
          .from(collaborators)
          .where(eq(collaborators.id, colId))
          .limit(1);
        if (colRows[0]) {
          validCollabId = colRows[0].id;
          collabName = colRows[0].name;
        }
      }

      const [created] = await db
        .insert(coordinatorTaskSubtasks)
        .values({
          taskId,
          sortOrder: nextSort,
          title,
          description: String(body.description || '').trim(),
          priority: String(body.priority || 'media').toLowerCase(),
          criticality: String(body.criticality || 'medio').toLowerCase(),
          assignedCollaboratorId: validCollabId,
          assignedCollaboratorName: collabName,
          dueAt: subDueAt,
          estimatedMinutes: body.estimatedMinutes
            ? Math.max(1, Math.round(Number(body.estimatedMinutes)))
            : null,
          requiresPredecessor: Boolean(body.requiresPredecessor),
          status: 'PENDENTE',
        })
        .returning();

      res.json({ subtask: created });
    } catch (error) {
      console.error('Create subtask error:', error);
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao criar subtarefa.') });
    }
  });

  app.patch('/api/collection/coordinator/tasks/:id/subtasks/:subId', requireAuth, requireCollection, async (req: AuthRequest, res) => {
    try {
      const taskId = parsePositiveIntId(req.params.id);
      const subId = parsePositiveIntId(req.params.subId);
      if (!taskId || !subId) return res.status(400).json({ error: 'Identificador inválido.' });
      const access = await getTaskWithAccess(taskId, req.authUser!.id);
      if (!access.task || access.permission === 'view') {
        return res.status(403).json({ error: 'Sem permissão para editar subtarefa.' });
      }

      const subs = await db
        .select()
        .from(coordinatorTaskSubtasks)
        .where(eq(coordinatorTaskSubtasks.taskId, taskId))
        .orderBy(asc(coordinatorTaskSubtasks.sortOrder), asc(coordinatorTaskSubtasks.id));
      const idx = subs.findIndex((s) => s.id === subId);
      if (idx < 0) return res.status(404).json({ error: 'Subtarefa não encontrada.' });
      const sub = subs[idx];

      const body = (req.body || {}) as {
        title?: string;
        description?: string;
        solutionNotes?: string;
        priority?: string;
        criticality?: string;
        assignedCollaboratorId?: number | null;
        dueAt?: string | null;
        estimatedMinutes?: number | null;
        requiresPredecessor?: boolean;
        status?: 'PENDENTE' | 'CONCLUIDO';
      };

      if (body.status === 'CONCLUIDO' && (body.requiresPredecessor ?? sub.requiresPredecessor) && idx > 0) {
        const prev = subs[idx - 1];
        if (prev && prev.status !== 'CONCLUIDO') {
          return res.status(400).json({
            error: `Conclua a subtarefa anterior ("${prev.title}") antes de encerrar esta subtarefa.`,
          });
        }
      }

      let collabId = sub.assignedCollaboratorId;
      let collabName = sub.assignedCollaboratorName;
      if (body.assignedCollaboratorId !== undefined) {
        if (body.assignedCollaboratorId) {
          const colRows = await db
            .select()
            .from(collaborators)
            .where(eq(collaborators.id, Number(body.assignedCollaboratorId)))
            .limit(1);
          collabId = colRows[0]?.id ?? null;
          collabName = colRows[0]?.name || '';
        } else {
          collabId = null;
          collabName = '';
        }
      }

      const nextStatus = body.status || sub.status;
      let timerRunningSince = sub.timerRunningSince;
      let timerAccumulatedSeconds = sub.timerAccumulatedSeconds;
      if (nextStatus === 'CONCLUIDO' && sub.timerRunningSince) {
        timerAccumulatedSeconds += Math.max(
          1,
          Math.round((Date.now() - new Date(sub.timerRunningSince).getTime()) / 1000)
        );
        timerRunningSince = null;
      }

      let nextSubDueAt = sub.dueAt;
      if (body.dueAt !== undefined) {
        if (body.dueAt === null || String(body.dueAt).trim() === '') {
          nextSubDueAt = null;
        } else {
          const parsed = parseSafeDate(body.dueAt);
          if (!parsed) return res.status(400).json({ error: 'Data de vencimento da subtarefa inválida.' });
          nextSubDueAt = parsed;
        }
      }

      const [updated] = await db
        .update(coordinatorTaskSubtasks)
        .set({
          title: body.title !== undefined && body.title.trim() ? body.title.trim() : sub.title,
          description: body.description !== undefined ? String(body.description) : sub.description,
          solutionNotes: body.solutionNotes !== undefined ? String(body.solutionNotes) : sub.solutionNotes,
          priority: body.priority !== undefined ? String(body.priority).toLowerCase() : sub.priority,
          criticality:
            body.criticality !== undefined ? String(body.criticality).toLowerCase() : sub.criticality,
          assignedCollaboratorId: collabId,
          assignedCollaboratorName: collabName,
          dueAt: nextSubDueAt,
          estimatedMinutes:
            body.estimatedMinutes !== undefined
              ? body.estimatedMinutes
                ? Math.max(1, Math.round(Number(body.estimatedMinutes)))
                : null
              : sub.estimatedMinutes,
          requiresPredecessor:
            body.requiresPredecessor !== undefined ? Boolean(body.requiresPredecessor) : sub.requiresPredecessor,
          status: nextStatus,
          completedAt: nextStatus === 'CONCLUIDO' ? sub.completedAt || new Date() : null,
          timerRunningSince,
          timerAccumulatedSeconds,
          updatedAt: new Date(),
        })
        .where(eq(coordinatorTaskSubtasks.id, sub.id))
        .returning();

      res.json({ subtask: updated });
    } catch (error) {
      console.error('Update subtask error:', error);
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao atualizar subtarefa.') });
    }
  });

  app.post('/api/collection/coordinator/tasks/:id/subtasks/:subId/timer', requireAuth, requireCollection, async (req: AuthRequest, res) => {
    try {
      const taskId = parsePositiveIntId(req.params.id);
      const subId = parsePositiveIntId(req.params.subId);
      if (!taskId || !subId) return res.status(400).json({ error: 'Identificador inválido.' });
      const access = await getTaskWithAccess(taskId, req.authUser!.id);
      if (!access.task || access.permission === 'view') {
        return res.status(403).json({ error: 'Sem permissão para operar o cronômetro.' });
      }

      const subs = await db
        .select()
        .from(coordinatorTaskSubtasks)
        .where(eq(coordinatorTaskSubtasks.taskId, taskId))
        .orderBy(asc(coordinatorTaskSubtasks.sortOrder), asc(coordinatorTaskSubtasks.id));
      const idx = subs.findIndex((s) => s.id === subId);
      if (idx < 0) return res.status(404).json({ error: 'Subtarefa não encontrada.' });
      const sub = subs[idx];
      const { action, reason } = (req.body || {}) as { action: 'start' | 'pause'; reason?: string };

      if (action === 'start') {
        if (sub.requiresPredecessor && idx > 0 && subs[idx - 1].status !== 'CONCLUIDO') {
          return res.status(400).json({
            error: `Subtarefa bloqueada: conclua "${subs[idx - 1].title}" antes de iniciar o cronômetro.`,
          });
        }
        const [updated] = await db
          .update(coordinatorTaskSubtasks)
          .set({ timerRunningSince: new Date(), updatedAt: new Date() })
          .where(eq(coordinatorTaskSubtasks.id, sub.id))
          .returning();
        return res.json({ subtask: updated });
      }

      const cleanReason = String(reason || '').trim();
      if (!cleanReason) return res.status(400).json({ error: 'Informe o motivo da pausa.' });
      if (!sub.timerRunningSince) return res.json({ subtask: sub });
      const startedMs = new Date(sub.timerRunningSince).getTime();
      const elapsedSec = Math.max(1, Math.round((Date.now() - startedMs) / 1000));
      const [updated] = await db
        .update(coordinatorTaskSubtasks)
        .set({
          timerRunningSince: null,
          timerAccumulatedSeconds: sub.timerAccumulatedSeconds + elapsedSec,
          timerPauseLogsJson: [
            ...(Array.isArray(sub.timerPauseLogsJson) ? sub.timerPauseLogsJson : []),
            {
              startedAt: new Date(startedMs).toISOString(),
              pausedAt: new Date().toISOString(),
              durationSeconds: elapsedSec,
              reason: cleanReason,
              userName: req.authUser!.name,
            },
          ],
          updatedAt: new Date(),
        })
        .where(eq(coordinatorTaskSubtasks.id, sub.id))
        .returning();
      res.json({ subtask: updated });
    } catch (error) {
      console.error('Subtask timer error:', error);
      res.status(500).json({ error: 'Erro no cronômetro da subtarefa.' });
    }
  });

  app.delete('/api/collection/coordinator/tasks/:id/subtasks/:subId', requireAuth, requireCollection, async (req: AuthRequest, res) => {
    try {
      const taskId = parsePositiveIntId(req.params.id);
      const subId = parsePositiveIntId(req.params.subId);
      if (!taskId || !subId) return res.status(400).json({ error: 'Identificador inválido.' });
      const access = await getTaskWithAccess(taskId, req.authUser!.id);
      if (!access.task || access.permission === 'view') {
        return res.status(403).json({ error: 'Sem permissão para excluir subtarefa.' });
      }
      const deleted = await db
        .delete(coordinatorTaskSubtasks)
        .where(and(eq(coordinatorTaskSubtasks.id, subId), eq(coordinatorTaskSubtasks.taskId, taskId)))
        .returning({ id: coordinatorTaskSubtasks.id });
      if (deleted.length === 0) return res.status(404).json({ error: 'Subtarefa não encontrada nesta tarefa.' });
      res.json({ ok: true });
    } catch (error) {
      console.error('Delete subtask error:', error);
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao excluir subtarefa.') });
    }
  });

  // ---------------------------------------------------------------------------
  // 8. COMPARTILHAMENTO ENTRE COORDENADORES (§6.6 — NÃO TRANSFERE PROPRIEDADE)
  // ---------------------------------------------------------------------------
  app.post('/api/collection/coordinator/tasks/:id/shares', requireAuth, requireCollection, async (req: AuthRequest, res) => {
    try {
      const taskId = parsePositiveIntId(req.params.id);
      if (!taskId) return res.status(400).json({ error: 'ID de tarefa inválido.' });
      const userId = req.authUser!.id;
      const rows = await db.select().from(coordinatorTasks).where(eq(coordinatorTasks.id, taskId)).limit(1);
      const task = rows[0];
      if (!task) return res.status(404).json({ error: 'Tarefa não encontrada.' });
      if (task.ownerUserId !== userId && req.authUser!.role !== 'admin') {
        return res.status(403).json({ error: 'Apenas o coordenador proprietário pode compartilhar esta tarefa.' });
      }

      const targetUserId = parsePositiveIntId(req.body?.sharedWithUserId);
      const permission = req.body?.permission === 'view' ? 'view' : 'edit';
      if (!targetUserId || targetUserId === task.ownerUserId) {
        return res.status(400).json({ error: 'Selecione outro coordenador válido para compartilhar.' });
      }

      const targetRows = await db.select().from(users).where(eq(users.id, targetUserId)).limit(1);
      const targetUser = targetRows[0];
      if (!targetUser || !targetUser.active) {
        return res.status(404).json({ error: 'Coordenador destinatário não localizado ou inativo.' });
      }

      const existing = await db
        .select()
        .from(coordinatorTaskShares)
        .where(eq(coordinatorTaskShares.taskId, taskId));
      const dup = existing.find((s) => s.sharedWithUserId === targetUserId);
      if (dup) {
        const [updated] = await db
          .update(coordinatorTaskShares)
          .set({ permission })
          .where(eq(coordinatorTaskShares.id, dup.id))
          .returning();
        return res.json({ share: updated });
      }

      const [share] = await db
        .insert(coordinatorTaskShares)
        .values({
          taskId,
          ownerUserId: task.ownerUserId,
          sharedWithUserId: targetUser.id,
          sharedWithName: targetUser.name,
          sharedByName: req.authUser!.name,
          permission,
        })
        .returning();

      await logTaskAudit(req, 'COORDINATOR_TASK_SHARED', taskId, {
        sharedWithUserId: targetUser.id,
        sharedWithName: targetUser.name,
        permission,
      });

      await dispatchIviSectorNotification(
        {
          targetSector: 'cobranca',
          targetUnitId: req.activeUnitId || null,
          recipientId: targetUser.id,
          targetGroupId: targetUser.groupId,
          relatedEntityType: 'coordinator_task',
          relatedEntityId: taskId,
          senderName: 'Ivi IA · Coordenação Cobrança',
          subject: `Tarefa Compartilhada · ${task.title}`,
          body: `${req.authUser!.name} compartilhou a tarefa "${task.title}" com ${targetUser.name} (permissão: ${permission === 'view' ? 'Visualização' : 'Edição'}).`,
        },
        db,
        deps.broadcast
      );

      deps.broadcast('collection:payment', { type: 'task_shared', taskId, targetUserId: targetUser.id });
      res.json({ share });
    } catch (error) {
      console.error('Share task error:', error);
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao conceder compartilhamento.') });
    }
  });

  app.delete('/api/collection/coordinator/tasks/:id/shares/:shareId', requireAuth, requireCollection, async (req: AuthRequest, res) => {
    try {
      const taskId = parsePositiveIntId(req.params.id);
      const shareId = parsePositiveIntId(req.params.shareId);
      if (!taskId || !shareId) return res.status(400).json({ error: 'Identificador inválido.' });
      const userId = req.authUser!.id;
      const rows = await db.select().from(coordinatorTasks).where(eq(coordinatorTasks.id, taskId)).limit(1);
      const task = rows[0];
      if (!task) return res.status(404).json({ error: 'Tarefa não encontrada.' });
      if (task.ownerUserId !== userId && req.authUser!.role !== 'admin') {
        return res.status(403).json({ error: 'Apenas o proprietário pode revogar acessos desta tarefa.' });
      }

      const deleted = await db
        .delete(coordinatorTaskShares)
        .where(and(eq(coordinatorTaskShares.id, shareId), eq(coordinatorTaskShares.taskId, taskId)))
        .returning({ id: coordinatorTaskShares.id });
      if (deleted.length === 0) return res.status(404).json({ error: 'Compartilhamento não encontrado nesta tarefa.' });
      await logTaskAudit(req, 'COORDINATOR_TASK_SHARE_REVOKED', taskId, { shareId });
      deps.broadcast('collection:payment', { type: 'task_share_revoked', taskId });
      res.json({ ok: true });
    } catch (error) {
      console.error('Revoke share error:', error);
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao revogar compartilhamento.') });
    }
  });

  // ---------------------------------------------------------------------------
  // 9. ANEXOS NO BUCKETDAINVICTA & VISUALIZAÇÃO
  // ---------------------------------------------------------------------------
  app.post(
    '/api/collection/coordinator/tasks/:id/attachments',
    requireAuth,
    requireCollection,
    taskAttachmentUpload.single('file'),
    async (req: AuthRequest, res) => {
      try {
        const taskId = parsePositiveIntId(req.params.id);
        if (!taskId) return res.status(400).json({ error: 'ID de tarefa inválido.' });
        const access = await getTaskWithAccess(taskId, req.authUser!.id);
        if (!access.task || access.permission === 'view') {
          return res.status(403).json({ error: 'Sem permissão para anexar arquivos nesta tarefa.' });
        }

        const file = req.file;
        if (!file) return res.status(400).json({ error: 'Selecione um arquivo para anexar.' });
        const validationError = validateUploadFile(file.originalname, file.mimetype, file.size);
        if (validationError) return res.status(400).json({ error: validationError });

        const task = access.task;
        const unitId = task.unitId || req.activeUnitId || 1;
        const folderPath = `bucketdainvicta/U${unitId}/COORDENACAO/TAREFAS/T${task.id}`;
        const stored = await putBucketObject(file.buffer, {
          folderPath,
          mimeType: file.mimetype,
          originalName: sanitizeFileName(file.originalname),
        });

        let documentObjectId: number | null = null;
        if (task.clientId) {
          const [doc] = await db
            .insert(documentObjects)
            .values({
              clientId: task.clientId,
              admissionId: null,
              folderPath,
              fileName: sanitizeFileName(file.originalname),
              docCategory: 'tarefa_coordenacao',
              mimeType: file.mimetype,
              sizeBytes: stored.sizeBytes,
              sha256Hash: stored.sha256Hash,
              storageUri: stored.storageUri,
              uploadedBy: req.authUser!.name,
              unitId,
            })
            .returning();
          documentObjectId = doc.id;
        }

        const [attachment] = await db
          .insert(coordinatorTaskAttachments)
          .values({
            taskId: task.id,
            subtaskId: req.body?.subtaskId ? parsePositiveIntId(req.body.subtaskId) : null,
            documentObjectId,
            source: 'local_bucket',
            fileName: sanitizeFileName(file.originalname),
            mimeType: file.mimetype,
            sizeBytes: stored.sizeBytes,
            externalUrl: stored.storageUri,
            addedByName: req.authUser!.name,
          })
          .returning();

        res.json({ attachment });
      } catch (error) {
        console.error('Upload task attachment error:', error);
        res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao armazenar anexo no bucketdainvicta.') });
      }
    }
  );

  app.get('/api/collection/coordinator/tasks/:id/attachments/:attId/file', requireAuth, requireCollection, async (req: AuthRequest, res) => {
    try {
      const taskId = parsePositiveIntId(req.params.id);
      const attId = parsePositiveIntId(req.params.attId);
      if (!taskId || !attId) return res.status(400).json({ error: 'Identificador inválido.' });
      const access = await getTaskWithAccess(taskId, req.authUser!.id);
      if (!access.task) return res.status(403).json({ error: 'Sem acesso a este anexo.' });

      const rows = await db
        .select()
        .from(coordinatorTaskAttachments)
        .where(eq(coordinatorTaskAttachments.id, attId))
        .limit(1);
      const att = rows[0];
      if (!att || att.taskId !== taskId) {
        return res.status(404).json({ error: 'Anexo não localizado.' });
      }

      const buf = await getBucketObjectBuffer(att.externalUrl);
      if (!buf) return res.status(404).json({ error: 'Objeto binário não encontrado no bucket.' });

      const inline = canPreviewInline(att.mimeType);
      res.setHeader('Content-Type', att.mimeType || 'application/octet-stream');
      res.setHeader(
        'Content-Disposition',
        `${inline ? 'inline' : 'attachment'}; filename="${encodeURIComponent(att.fileName)}"`
      );
      res.send(buf);
    } catch (error) {
      console.error('Download task attachment error:', error);
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao carregar arquivo anexo.') });
    }
  });

  app.delete('/api/collection/coordinator/tasks/:id/attachments/:attId', requireAuth, requireCollection, async (req: AuthRequest, res) => {
    try {
      const taskId = parsePositiveIntId(req.params.id);
      const attId = parsePositiveIntId(req.params.attId);
      if (!taskId || !attId) return res.status(400).json({ error: 'Identificador inválido.' });
      const access = await getTaskWithAccess(taskId, req.authUser!.id);
      if (!access.task || access.permission === 'view') {
        return res.status(403).json({ error: 'Sem permissão para remover anexo.' });
      }
      const deleted = await db
        .delete(coordinatorTaskAttachments)
        .where(and(eq(coordinatorTaskAttachments.id, attId), eq(coordinatorTaskAttachments.taskId, taskId)))
        .returning({ id: coordinatorTaskAttachments.id });
      if (deleted.length === 0) return res.status(404).json({ error: 'Anexo não encontrado nesta tarefa.' });
      res.json({ ok: true });
    } catch (error) {
      console.error('Delete task attachment error:', error);
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao remover anexo.') });
    }
  });

  // ---------------------------------------------------------------------------
  // 10. REVISÃO E SUGESTÕES DA IVI PARA TAREFAS DA COORDENAÇÃO
  // ---------------------------------------------------------------------------
  app.post('/api/collection/coordinator/tasks/ivi-review', requireAuth, requireCollection, async (req: AuthRequest, res) => {
    try {
      const { mode, title, description, occurrence, solution } = (req.body || {}) as {
        mode?: 'creation' | 'closure';
        title?: string;
        description?: string;
        occurrence?: string;
        solution?: string;
      };

      const system =
        mode === 'closure'
          ? 'Você é Ivi, assistente de auditoria de tarefas do FinancePro. Avalie se a Ocorrência e a Solução Adotada explicam claramente o que aconteceu e o que foi resolvido. Responda em JSON puro: {"approved": boolean, "feedback": "string curta PT-BR", "suggestion": "string opcional"}'
          : 'Você é Ivi, assistente de gestão de tarefas do FinancePro. Avalie a clareza operacional da descrição da tarefa. Responda em JSON puro: {"approved": boolean, "feedback": "string curta PT-BR", "suggestion": "string opcional"}';

      const userPrompt =
        mode === 'closure'
          ? `Tarefa: ${title || '-'}\nOcorrência: ${occurrence || '-'}\nSolução Adotada: ${solution || '-'}`
          : `Tarefa: ${title || '-'}\nDescrição: ${description || '-'}`;

      const result = await runIviOrchestrator(system, userPrompt);
      try {
        const cleaned = result.text.replace(/```json\s*|\s*```/g, '').trim();
        const parsed = JSON.parse(cleaned) as { approved?: boolean; feedback?: string; suggestion?: string };
        return res.json({
          approved: parsed.approved !== false,
          feedback: parsed.feedback || result.text,
          suggestion: parsed.suggestion || '',
          provider: result.provider,
        });
      } catch {
        return res.json({
          approved: true,
          feedback: result.text,
          suggestion: '',
          provider: result.provider,
        });
      }
    } catch (error) {
      console.error('Ivi task review error:', error);
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao consultar Ivi para revisão da tarefa.') });
    }
  });

  app.post('/api/collection/coordinator/tasks/ivi-suggest', requireAuth, requireCollection, async (req: AuthRequest, res) => {
    try {
      const todayIso = new Date().toISOString().slice(0, 10);
      const allowedUnits = getAllowedUnitIds(req);
      const allowUnit = (uId: number | null | undefined) =>
        allowedUnits === null || (uId != null && allowedUnits.includes(uId));

      const [rawAllTitles, rawAllClients, rawAllNotes] = await Promise.all([
        db.select().from(financialTitles),
        db.select({ id: clients.id, fullName: clients.fullName, unitId: clients.unitId }).from(clients),
        db.select().from(collectionNotes).orderBy(desc(collectionNotes.createdAt)).limit(60),
      ]);
      const allTitles = allowedUnits === null ? rawAllTitles : rawAllTitles.filter((t) => allowUnit(t.unitId));
      const allClients = allowedUnits === null ? rawAllClients : rawAllClients.filter((c) => allowUnit(c.unitId));
      const allNotes = allowedUnits === null ? rawAllNotes : rawAllNotes.filter((n) => allowUnit(n.unitId));

      const clientMap = new Map(allClients.map((c) => [c.id, c.fullName]));
      const overdueTop = allTitles
        .filter((t) => {
          if ((t.scope || 'RECEBER').toUpperCase() !== 'RECEBER') return false;
          const st = String(t.status || '').toUpperCase();
          if (['PAGO', 'CANCELADO', 'AGRUPADO', 'FATURA_GERADA'].includes(st)) return false;
          return t.dueDate && new Date(t.dueDate).toISOString().slice(0, 10) < todayIso;
        })
        .sort((a, b) => Number(b.currentBalanceCents || b.amountCents || 0) - Number(a.currentBalanceCents || a.amountCents || 0))
        .slice(0, 4);

      const cancelReqs = allNotes.filter((n) => n.negotiationStatus === 'SOLICITA_CANCELAMENTO').slice(0, 3);

      const suggestions: Array<{
        title: string;
        description: string;
        criticality: 'alto' | 'critico' | 'medio';
        clientId: number | null;
        clientName: string;
        projectLabel: string;
      }> = [];

      for (const reqNote of cancelReqs) {
        const cName = clientMap.get(reqNote.clientId) || `Cliente #${reqNote.clientId}`;
        suggestions.push({
          title: `Avaliar solicitação de cancelamento · ${cName}`,
          description: `Tratar pedido registrado por ${reqNote.collaboratorName || 'Operador'} em ${reqNote.contactDate}: "${reqNote.note.slice(0, 140)}". Validar retenção ou encerramento contratual.`,
          criticality: 'critico',
          clientId: reqNote.clientId,
          clientName: cName,
          projectLabel: 'Retenção & Cancelamentos',
        });
      }

      for (const t of overdueTop) {
        if (suggestions.length >= 4) break;
        const cName = clientMap.get(t.clientId) || t.clientName || `Cliente #${t.clientId}`;
        const valReais = (Number(t.currentBalanceCents || t.amountCents || 0) / 100).toLocaleString('pt-BR', {
          style: 'currency',
          currency: 'BRL',
        });
        suggestions.push({
          title: `Cobrança prioritária · ${cName} (${valReais})`,
          description: `Título ${t.documentNumber || t.titleCode} vencido em ${new Date(t.dueDate).toLocaleDateString('pt-BR')}. Alinhar estratégia de acordo ou envio de link de pagamento.`,
          criticality: Number(t.currentBalanceCents || t.amountCents || 0) >= 300000 ? 'alto' : 'medio',
          clientId: t.clientId,
          clientName: cName,
          projectLabel: 'Cobrança Ativa',
        });
      }

      res.json({ suggestions });
    } catch (error) {
      console.error('Ivi task suggest error:', error);
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao gerar sugestões de tarefas com a Ivi.') });
    }
  });
}
