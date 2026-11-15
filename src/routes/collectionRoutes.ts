import type { Express } from 'express';
import multer from 'multer';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import {
  admissions,
  auditLogs,
  banks,
  bankServices,
  clients,
  collaborators,
  collectionCases,
  collectionNotes,
  collectionReports,
  documentObjects,
  financialTitles,
  gotalkChannels,
  gotalkHsmTemplates,
  gotalkOperators,
  legalMovements,
  legalProcesses,
  modalities,
  negotiations,
  paymentCategories,
  recalcScenarios,
  seriesCatalog,
  systemSettings,
  titleSettlements,
  units,
  users,
  whatsappMessages,
  whatsappThreads,
  type CollectionCancelRequestInfo,
} from '../db/schema.ts';
import { ensureCommonCadastrosSeed, ensureInitialSeed } from '../db/seed.ts';
import { AuthRequest, requireAuth } from '../middleware/auth.ts';
import { syncClientLegalAndEscavadorStatus } from '../services/legalSync.ts';
import { putBucketObject, sanitizeFileName, validateUploadFile } from '../services/bucketStorage.ts';
import {
  iviAnalyzeCollectionInsights,
  iviBuildCollectionReport,
  iviSummarizeCollectionWhatsapp,
  runIviOrchestrator,
} from '../services/ivi.ts';

const receiptUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

const EXCLUDED_PORTFOLIO_STATUSES = new Set([
  'CANCELADO',
  'AGRUPADO',
  'PAGO',
  'FATURA_GERADA',
  'ADIANTAMENTO',
  'ADIANTAMENTO_PARCIAL',
  'DEVOLUCAO',
  'DEVOLUCAO_VINCULADA',
  'DEVOLUCAO_PARCIAL',
]);

const ELIGIBLE_ADMISSION_STATUSES = new Set([
  'auditada',
  'aprovada',
  'finalizada',
  'concluido',
  'em_andamento',
]);

function normStatusUpper(raw: string | null | undefined): string {
  const s = String(raw || 'ABERTO').trim().toUpperCase();
  if (s === 'VENCIDO') return 'ABERTO';
  return s;
}

export function registerCollectionRoutes(
  app: Express,
  deps: { broadcast: (event: string, payload: unknown) => void }
) {
  // ---------------------------------------------------------------------------
  // 1. OPERACIONAL: Carregar carteira de casos + títulos vencidos + notas DB
  // ---------------------------------------------------------------------------
  app.get('/api/collection', requireAuth, async (_req: AuthRequest, res) => {
    try {
      await ensureInitialSeed();
      await ensureCommonCadastrosSeed();

      const [cases, titles, settlements, allClients, cats, allUsers, docs, collabs, notes] = await Promise.all([
        db.select().from(collectionCases).orderBy(desc(collectionCases.priorityValueCents)),
        db.select().from(financialTitles).orderBy(asc(financialTitles.dueDate), asc(financialTitles.id)),
        db.select().from(titleSettlements).orderBy(desc(titleSettlements.settlementDate), desc(titleSettlements.id)),
        db.select().from(clients),
        db.select().from(paymentCategories),
        db.select({ id: users.id, name: users.name, role: users.role, points: users.points }).from(users),
        db.select().from(documentObjects).where(isNull(documentObjects.deletedAt)),
        db.select().from(collaborators).orderBy(asc(collaborators.name)),
        db.select().from(collectionNotes).orderBy(desc(collectionNotes.createdAt)),
      ]);

      res.json({
        cases,
        titles,
        settlements,
        clients: allClients,
        categories: cats,
        operators: allUsers,
        collaborators: collabs,
        documents: docs,
        notes,
      });
    } catch (error) {
      console.error('Collection get error:', error);
      res.status(500).json({ error: 'Erro ao carregar módulo de cobrança.' });
    }
  });

  // ---------------------------------------------------------------------------
  // 2. COORDENAÇÃO: Carga completa global da carteira RECEBER + KPIs + auxiliares
  // ---------------------------------------------------------------------------
  app.get('/api/collection/coordinator', requireAuth, async (_req: AuthRequest, res) => {
    try {
      await ensureInitialSeed();
      await ensureCommonCadastrosSeed();

      const [
        receberTitles,
        allClients,
        allCollabs,
        allUsers,
        allAdmissions,
        allDocs,
        allUnits,
        allBanks,
        allBankServices,
        allModalities,
        allSeries,
        notesRows,
        allProcesses,
        allScenarios,
        allNegotiations,
        allSettlements,
        savedReports,
        threads,
        messages,
        channels,
        operators,
        hsmTemplates,
        gotalkCfgRows,
      ] = await Promise.all([
        db
          .select()
          .from(financialTitles)
          .where(eq(financialTitles.scope, 'RECEBER'))
          .orderBy(asc(financialTitles.dueDate), asc(financialTitles.id)),
        db.select().from(clients).orderBy(asc(clients.fullName)),
        db.select().from(collaborators).orderBy(asc(collaborators.name)),
        db
          .select({
            id: users.id,
            name: users.name,
            email: users.email,
            role: users.role,
            points: users.points,
            whatsappPhone: users.whatsappPhone,
          })
          .from(users),
        db.select().from(admissions).orderBy(desc(admissions.createdAt)),
        db.select().from(documentObjects).where(isNull(documentObjects.deletedAt)),
        db.select().from(units).orderBy(asc(units.id)),
        db.select().from(banks).orderBy(asc(banks.name)),
        db.select().from(bankServices).orderBy(asc(bankServices.name)),
        db.select().from(modalities).orderBy(asc(modalities.description)),
        db.select().from(seriesCatalog).orderBy(asc(seriesCatalog.sigla)),
        db.select().from(collectionNotes).orderBy(desc(collectionNotes.createdAt)),
        db.select().from(legalProcesses).orderBy(desc(legalProcesses.lastMovementAt)),
        db.select().from(recalcScenarios),
        db.select().from(negotiations).orderBy(desc(negotiations.id)),
        db.select().from(titleSettlements).orderBy(desc(titleSettlements.settlementDate), desc(titleSettlements.id)),
        db.select().from(collectionReports).orderBy(desc(collectionReports.createdAt)),
        db.select().from(whatsappThreads).orderBy(desc(whatsappThreads.updatedAt)),
        db.select().from(whatsappMessages).orderBy(asc(whatsappMessages.createdAt)),
        db.select({
          id: gotalkChannels.id,
          name: gotalkChannels.name,
          phoneNumber: gotalkChannels.phoneNumber,
          unitId: gotalkChannels.unitId,
          notes: gotalkChannels.notes,
          isPrimary: gotalkChannels.isPrimary,
          isActive: gotalkChannels.isActive,
        }).from(gotalkChannels).orderBy(asc(gotalkChannels.id)),
        db.select().from(gotalkOperators).orderBy(asc(gotalkOperators.id)),
        db.select().from(gotalkHsmTemplates).orderBy(asc(gotalkHsmTemplates.templateName)),
        db.select().from(systemSettings).where(eq(systemSettings.key, 'gotalk_config')).limit(1),
      ]);

      // Títulos elegíveis ativos para KPIs (PADRAO e fora da lista de exclusão)
      const portfolioTitles = receberTitles.filter((t) => {
        const type = String(t.titleType || 'PADRAO').toUpperCase();
        const st = normStatusUpper(t.status);
        return type === 'PADRAO' && !EXCLUDED_PORTFOLIO_STATUSES.has(st);
      });

      // Títulos pagos (PADRAO + PAGO) para cálculo exato de Taxa de Recuperação & DSO
      const paidTitles = receberTitles.filter((t) => {
        const type = String(t.titleType || 'PADRAO').toUpperCase();
        const st = String(t.status || '').trim().toUpperCase();
        return type === 'PADRAO' && st === 'PAGO';
      });

      // Títulos para o Data Grid da Coordenação: inclui ativos + PAGO (Recebimento Total) e PARCIAL (Recebimento Parcial)
      const gridTitles = receberTitles.filter((t) => {
        const type = String(t.titleType || 'PADRAO').toUpperCase();
        if (type !== 'PADRAO') return false;
        const st = normStatusUpper(t.status);
        if (st === 'PAGO') return true;
        return !EXCLUDED_PORTFOLIO_STATUSES.has(st);
      });

      // Resumo global Fichas & Aditivos por cliente (especificação §1.5 & §3.3)
      const eligibleAdmIdsByClient = new Map<number, number[]>();
      for (const adm of allAdmissions) {
        const st = String(adm.status || '').toLowerCase();
        if (!ELIGIBLE_ADMISSION_STATUSES.has(st)) continue;
        const list = eligibleAdmIdsByClient.get(adm.clientId) || [];
        list.push(adm.id);
        eligibleAdmIdsByClient.set(adm.clientId, list);
      }

      const addendumsByAdmission = new Map<number, { count: number; latestDate: string | null }>();
      for (const doc of allDocs) {
        if (!doc.admissionId) continue;
        if (doc.docCategory !== 'aditivo') continue;
        const prev = addendumsByAdmission.get(doc.admissionId) || { count: 0, latestDate: null };
        const createdIso = doc.createdAt ? new Date(doc.createdAt).toISOString() : null;
        prev.count += 1;
        if (createdIso && (!prev.latestDate || createdIso > prev.latestDate)) {
          prev.latestDate = createdIso;
        }
        addendumsByAdmission.set(doc.admissionId, prev);
      }

      const admissionSummaryByClient: Record<number, { fichas: number; aditivos: number; latestAddendumDate: string | null }> = {};
      for (const [cId, admIds] of eligibleAdmIdsByClient.entries()) {
        let aditivos = 0;
        let latest: string | null = null;
        for (const admId of admIds) {
          const info = addendumsByAdmission.get(admId);
          if (info) {
            aditivos += info.count;
            if (info.latestDate && (!latest || info.latestDate > latest)) {
              latest = info.latestDate;
            }
          }
        }
        admissionSummaryByClient[cId] = {
          fichas: admIds.length,
          aditivos,
          latestAddendumDate: latest,
        };
      }

      const banksWithServices = allBanks.map((b) => ({
        ...b,
        services: allBankServices.filter((s) => s.bankId === b.id),
      }));

      const gotalkConfig = gotalkCfgRows[0]?.value || {};
      const gotalkEnabled = Boolean(
        process.env.GOTALK_TOKEN ||
          (gotalkConfig as Record<string, unknown>).enabled ||
          channels.some((c) => c.isActive) ||
          threads.length > 0
      );

      res.json({
        portfolioTitles,
        paidTitles,
        gridTitles,
        allReceberTitles: receberTitles,
        clients: allClients,
        collaborators: allCollabs,
        users: allUsers,
        admissions: allAdmissions,
        documents: allDocs,
        units: allUnits,
        banks: banksWithServices,
        modalities: allModalities,
        series: allSeries,
        collectionNotes: notesRows,
        legalProcesses: allProcesses,
        recalcScenarios: allScenarios,
        negotiations: allNegotiations,
        titleSettlements: allSettlements,
        collectionReports: savedReports,
        admissionSummaryByClient,
        gotalkEnabled,
        whatsappThreads: threads,
        whatsappMessages: messages,
        gotalkChannels: channels,
        gotalkOperators: operators,
        gotalkHsmTemplates: hsmTemplates,
      });
    } catch (error) {
      console.error('GET /api/collection/coordinator error:', error);
      res.status(500).json({ error: 'Erro ao carregar carteira de coordenação.' });
    }
  });

  // ---------------------------------------------------------------------------
  // 3. COORDENAÇÃO: Atribuição & Transferência em lote (audit_logs completo)
  // ---------------------------------------------------------------------------
  app.post('/api/collection/coordinator/assign', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { titleIds, collaboratorId, collectionStatus, transferReason } = req.body as {
        titleIds?: number[];
        collaboratorId?: number;
        collectionStatus?: string;
        transferReason?: string;
      };

      const cleanIds = Array.isArray(titleIds)
        ? [...new Set(titleIds.map(Number).filter((n) => Number.isInteger(n) && n > 0))]
        : [];
      if (!collaboratorId || Number(collaboratorId) <= 0) {
        return res.status(400).json({ error: 'Selecione um colaborador.' });
      }
      if (cleanIds.length === 0) {
        return res.status(400).json({ error: 'Selecione pelo menos um título.' });
      }

      const [collab] = await db
        .select()
        .from(collaborators)
        .where(eq(collaborators.id, Number(collaboratorId)))
        .limit(1);
      if (!collab) {
        return res.status(404).json({ error: 'Colaborador responsável não encontrado.' });
      }

      const targetTitles = await db
        .select()
        .from(financialTitles)
        .where(inArray(financialTitles.id, cleanIds));
      if (targetTitles.length === 0) {
        return res.status(404).json({ error: 'Nenhum título válido encontrado.' });
      }

      const clientIds = [...new Set(targetTitles.map((t) => t.clientId))];
      const linkedClients = await db
        .select()
        .from(clients)
        .where(inArray(clients.id, clientIds));
      const blockedClients = linkedClients.filter(
        (c) => c.status === 'suspenso' || c.status === 'cancelado'
      );
      if (blockedClients.length > 0) {
        return res.status(403).json({
          error: 'Existem títulos de clientes bloqueados na seleção. Não é possível atribuir/transferir cobrança.',
          blockedClients: blockedClients.map((c) => c.fullName),
        });
      }

      const nextSituation = ['EM_DIA', 'COBRAR', 'NAO_COBRAR'].includes(String(collectionStatus || ''))
        ? String(collectionStatus)
        : 'COBRAR';

      const existingCollabs = await db.select().from(collaborators);
      const collabMap = new Map(existingCollabs.map((c) => [c.id, c.name]));

      const updatedRows = await db
        .update(financialTitles)
        .set({
          assignedCollaboratorId: collab.id,
          collectionStatus: nextSituation,
          updatedAt: new Date(),
        })
        .where(inArray(financialTitles.id, cleanIds))
        .returning();

      const clientMap = new Map(linkedClients.map((c) => [c.id, c]));
      let assignedCount = 0;
      let transferredCount = 0;

      for (const prev of targetTitles) {
        const isTransfer = Boolean(prev.assignedCollaboratorId && prev.assignedCollaboratorId !== collab.id);
        if (isTransfer) transferredCount += 1;
        else if (!prev.assignedCollaboratorId) assignedCount += 1;

        const prevCollabName = prev.assignedCollaboratorId
          ? collabMap.get(prev.assignedCollaboratorId) || `#${prev.assignedCollaboratorId}`
          : 'Sem atribuição';

        const changes: Array<{ field: string; from: string; to: string }> = [
          {
            field: isTransfer ? 'Transferência de Operador' : 'Responsável Cobrança',
            from: prevCollabName,
            to: collab.name,
          },
          {
            field: 'Situação Cobrança',
            from: prev.collectionStatus || 'EM_DIA',
            to: nextSituation,
          },
        ];
        if (transferReason?.trim()) {
          changes.push({
            field: 'Motivo / Observação',
            from: '—',
            to: transferReason.trim(),
          });
        }

        await db.insert(auditLogs).values({
          userId: req.authUser?.id ?? null,
          userName: req.authUser?.name || 'Sistema',
          action: isTransfer ? 'TRANSFER_COLLECTION' : 'ASSIGN_COLLECTION',
          entityType: 'CONTA_RECEBER',
          entityId: String(prev.id),
          details: {
            changes,
            isTransfer,
            fromCollaboratorId: prev.assignedCollaboratorId || null,
            toCollaboratorId: collab.id,
            transferReason: transferReason?.trim() || null,
          },
          unitId: prev.unitId,
        });

        const existingCase = await db
          .select()
          .from(collectionCases)
          .where(eq(collectionCases.titleId, prev.id))
          .limit(1);

        if (existingCase[0]) {
          const transferNote = isTransfer
            ? `\n[Transferido de ${prevCollabName} para ${collab.name} por ${req.authUser?.name || 'Coordenação'}${
                transferReason?.trim() ? `: ${transferReason.trim()}` : ''
              }]`
            : '';
          await db
            .update(collectionCases)
            .set({
              assignedCollectorId: collab.userId ?? existingCase[0].assignedCollectorId,
              conversationSummary: transferNote
                ? `${existingCase[0].conversationSummary || ''}${transferNote}`.trim()
                : existingCase[0].conversationSummary,
              updatedAt: new Date(),
            })
            .where(eq(collectionCases.id, existingCase[0].id));
        } else if (normStatusUpper(prev.status) !== 'PAGO' && normStatusUpper(prev.status) !== 'CANCELADO') {
          const cl = clientMap.get(prev.clientId);
          await db.insert(collectionCases).values({
            titleId: prev.id,
            clientId: prev.clientId,
            unitId: prev.unitId,
            assignedCollectorId: collab.userId ?? null,
            stateCode: (cl?.state || 'PE').toUpperCase().slice(0, 2),
            priorityValueCents: Number(prev.currentBalanceCents || prev.amountCents || 0),
            status: 'em_cobranca',
            conversationSummary: `Atribuído pela Coordenação para ${collab.name}.`,
          });
        }
      }

      deps.broadcast('collection:payment', {
        type: transferredCount > 0 ? 'transfer' : 'assign',
        count: updatedRows.length,
        assignedCount,
        transferredCount,
        collaboratorName: collab.name,
        operator: req.authUser?.name || 'Coordenação',
      });

      res.json({
        updatedCount: updatedRows.length,
        assignedCount,
        transferredCount,
        collaborator: collab,
        titles: updatedRows,
      });
    } catch (error) {
      console.error('POST /api/collection/coordinator/assign error:', error);
      res.status(500).json({ error: 'Erro ao atribuir/transferir colaborador aos títulos.' });
    }
  });

  // ---------------------------------------------------------------------------
  // 4. OPERACIONAL: Baixar pagamento (via case ou diretamente via titleId vencido)
  // ---------------------------------------------------------------------------
  app.post('/api/collection/cases/:id/settle', requireAuth, async (req: AuthRequest, res) => {
    try {
      const caseId = Number(req.params.id);
      const { categoryId, receiptDocId } = req.body as { categoryId?: number; receiptDocId?: number };
      const rows = await db.select().from(collectionCases).where(eq(collectionCases.id, caseId)).limit(1);
      const colCase = rows[0];
      if (!colCase) return res.status(404).json({ error: 'Caso de cobrança não encontrado.' });

      await db
        .update(financialTitles)
        .set({
          status: 'pago',
          currentBalanceCents: 0,
          paidAt: new Date(),
          ...(categoryId ? { categoryId } : {}),
          ...(receiptDocId ? { receiptDocId } : {}),
          collectorId: req.authUser!.id,
          updatedAt: new Date(),
        })
        .where(eq(financialTitles.id, colCase.titleId));

      const points = 25;
      const [updatedCase] = await db
        .update(collectionCases)
        .set({ status: 'pago', pointsAwarded: colCase.pointsAwarded + points, updatedAt: new Date() })
        .where(eq(collectionCases.id, caseId))
        .returning();

      await db
        .update(users)
        .set({ points: sql`${users.points} + ${points}` })
        .where(eq(users.id, req.authUser!.id));

      deps.broadcast('collection:payment', { caseId, operator: req.authUser!.name, points });
      res.json({ case: updatedCase, pointsAwarded: points });
    } catch (error) {
      console.error('Settle collection error:', error);
      res.status(500).json({ error: 'Erro ao baixar título em cobrança.' });
    }
  });

  app.post('/api/collection/titles/:titleId/ensure-case', requireAuth, async (req: AuthRequest, res) => {
    try {
      const titleId = Number(req.params.titleId);
      const existing = await db
        .select()
        .from(collectionCases)
        .where(eq(collectionCases.titleId, titleId))
        .limit(1);
      if (existing[0]) return res.json({ case: existing[0] });

      const [titleRow] = await db
        .select()
        .from(financialTitles)
        .where(eq(financialTitles.id, titleId))
        .limit(1);
      if (!titleRow) return res.status(404).json({ error: 'Título não encontrado.' });

      const [cl] = await db.select().from(clients).where(eq(clients.id, titleRow.clientId)).limit(1);
      let linkedUserId: number | null = req.authUser?.id ?? null;
      if (titleRow.assignedCollaboratorId) {
        const [collab] = await db
          .select({ userId: collaborators.userId })
          .from(collaborators)
          .where(eq(collaborators.id, titleRow.assignedCollaboratorId))
          .limit(1);
        if (collab?.userId) linkedUserId = collab.userId;
      }

      const [created] = await db
        .insert(collectionCases)
        .values({
          titleId: titleRow.id,
          clientId: titleRow.clientId,
          unitId: titleRow.unitId,
          assignedCollectorId: linkedUserId,
          stateCode: (cl?.state || 'PE').toUpperCase().slice(0, 2),
          priorityValueCents: Number(titleRow.currentBalanceCents || titleRow.amountCents || 0),
          status: normStatusUpper(titleRow.status) === 'PAGO' ? 'pago' : 'em_cobranca',
          conversationSummary: '',
        })
        .returning();

      res.json({ case: created });
    } catch (error) {
      console.error('POST /api/collection/titles/:titleId/ensure-case error:', error);
      res.status(500).json({ error: 'Erro ao abrir tratativa do título vencido.' });
    }
  });

  // ---------------------------------------------------------------------------
  // 5. SUSPENSÃO / CANCELAMENTO / REATIVAÇÃO INTEGRADA AO JURÍDICO & ESCAVADOR
  // ---------------------------------------------------------------------------
  app.post('/api/collection/clients/:clientId/status', requireAuth, async (req: AuthRequest, res) => {
    try {
      const clientId = Number(req.params.clientId);
      const { status, reason, cancelFutureTitles } = req.body as {
        status: 'suspenso' | 'cancelado' | 'ativo';
        reason?: string;
        cancelFutureTitles?: boolean;
      };
      if ((status === 'suspenso' || status === 'cancelado') && !reason?.trim()) {
        return res.status(400).json({ error: 'Informe a causa da suspensão/cancelamento.' });
      }

      const synced = await syncClientLegalAndEscavadorStatus({
        clientId,
        targetStatus: status,
        reason:
          reason?.trim() ||
          (status === 'ativo' ? 'Retorno ao status normal registrado em Cobrança.' : ''),
        actorUserId: req.authUser!.id,
        actorUserName: req.authUser!.name,
        unitId: req.activeUnitId,
        originLabel: 'Cobrança',
        cancelFutureTitles: Boolean(cancelFutureTitles),
      });
      if (!synced) return res.status(404).json({ error: 'Cliente não encontrado.' });

      deps.broadcast('legal:update', {
        clientId,
        status,
        escavadorMonitored: synced.escavadorMonitored,
        affectedProcessesCount: synced.affectedProcessesCount,
      });
      deps.broadcast('collection:payment', {
        clientId,
        status,
        operator: req.authUser!.name,
      });

      res.json({
        client: synced.client,
        affectedProcessesCount: synced.affectedProcessesCount,
        escavadorMonitored: synced.escavadorMonitored,
        escavadorActionSummary: synced.escavadorActionSummary,
      });
    } catch (error) {
      console.error('Client status error:', error);
      res.status(500).json({ error: 'Erro ao atualizar status do cliente.' });
    }
  });

  // ---------------------------------------------------------------------------
  // 6. NOTAS DE COBRANÇA & SOLICITAÇÕES DE CANCELAMENTO (PostgreSQL)
  // ---------------------------------------------------------------------------
  app.get('/api/collection-notes', requireAuth, async (req: AuthRequest, res) => {
    try {
      const clientId = req.query.clientId ? Number(req.query.clientId) : null;
      const collaboratorId = req.query.collaboratorId ? Number(req.query.collaboratorId) : null;
      const titleId = req.query.titleId ? Number(req.query.titleId) : null;
      const negotiationStatus = req.query.negotiationStatus ? String(req.query.negotiationStatus) : null;

      const conditions = [];
      if (clientId) conditions.push(eq(collectionNotes.clientId, clientId));
      if (collaboratorId) conditions.push(eq(collectionNotes.collaboratorId, collaboratorId));
      if (titleId) conditions.push(eq(collectionNotes.titleId, titleId));
      if (negotiationStatus) conditions.push(eq(collectionNotes.negotiationStatus, negotiationStatus));

      const rows =
        conditions.length > 0
          ? await db
              .select()
              .from(collectionNotes)
              .where(and(...conditions))
              .orderBy(desc(collectionNotes.createdAt))
          : await db.select().from(collectionNotes).orderBy(desc(collectionNotes.createdAt));

      res.json({ notes: rows });
    } catch (error) {
      console.error('GET /api/collection-notes error:', error);
      res.status(500).json({ error: 'Erro ao listar notas de cobrança.' });
    }
  });

  app.post('/api/collection-notes', requireAuth, async (req: AuthRequest, res) => {
    try {
      const b = req.body as {
        titleId?: number | null;
        clientId?: number;
        collaboratorId?: number | null;
        collaboratorName?: string;
        contactDate?: string;
        contactTime?: string;
        channel?: string;
        negotiationStatus?: string;
        note?: string;
        cancelRequest?: CollectionCancelRequestInfo | null;
      };

      const clientId = Number(b.clientId || 0);
      const noteText = String(b.note || '').trim();
      if (!clientId) return res.status(400).json({ error: 'Cliente é obrigatório para registrar a nota.' });
      if (!noteText) return res.status(400).json({ error: 'Informe a descrição da nota/tratativa.' });

      const [clientRow] = await db.select().from(clients).where(eq(clients.id, clientId)).limit(1);
      if (!clientRow) return res.status(404).json({ error: 'Cliente não encontrado.' });

      let resolvedCollabName = String(b.collaboratorName || '').trim() || req.authUser?.name || 'Equipe';
      if (b.collaboratorId) {
        const [collabRow] = await db
          .select()
          .from(collaborators)
          .where(eq(collaborators.id, Number(b.collaboratorId)))
          .limit(1);
        if (collabRow) resolvedCollabName = collabRow.name;
      }

      const validNegotiations = new Set([
        'FECHADA',
        'AGUARDANDO_CONTATO',
        'ENCAMINHOU_BOLETO',
        'RECUSA_DIVIDA',
        'OUTROS',
        'SOLICITA_CANCELAMENTO',
      ]);
      const negotiationStatus = validNegotiations.has(String(b.negotiationStatus || ''))
        ? String(b.negotiationStatus)
        : 'AGUARDANDO_CONTATO';

      const todayIso = new Date().toISOString().slice(0, 10);
      const cancelRequestPayload: CollectionCancelRequestInfo | null =
        negotiationStatus === 'SOLICITA_CANCELAMENTO'
          ? {
              requestDate: b.cancelRequest?.requestDate || todayIso,
              admissionId: b.cancelRequest?.admissionId ?? null,
              admissionContract: b.cancelRequest?.admissionContract || '',
              notes: b.cancelRequest?.notes ?? noteText,
            }
          : b.cancelRequest || null;

      const [created] = await db
        .insert(collectionNotes)
        .values({
          titleId: b.titleId ? Number(b.titleId) : null,
          clientId,
          collaboratorId: b.collaboratorId ? Number(b.collaboratorId) : null,
          collaboratorName: resolvedCollabName,
          userId: req.authUser?.id ?? null,
          unitId: clientRow.unitId || req.activeUnitId || 1,
          contactDate: b.contactDate || todayIso,
          contactTime: b.contactTime || '00:00',
          channel: String(b.channel || 'TELEFONE'),
          negotiationStatus,
          note: noteText,
          cancelRequest: cancelRequestPayload,
        })
        .returning();

      deps.broadcast('collection:note', { action: 'created', note: created });
      res.status(201).json({ note: created });
    } catch (error) {
      console.error('POST /api/collection-notes error:', error);
      res.status(500).json({ error: 'Erro ao salvar nota de cobrança.' });
    }
  });

  app.put('/api/collection-notes/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      const [existing] = await db.select().from(collectionNotes).where(eq(collectionNotes.id, id)).limit(1);
      if (!existing) return res.status(404).json({ error: 'Nota não encontrada.' });

      const b = req.body as Partial<{
        negotiationStatus: string;
        note: string;
        channel: string;
        cancelRequest: CollectionCancelRequestInfo | null;
      }>;
      if (b.note !== undefined && !String(b.note).trim()) {
        return res.status(400).json({ error: 'O texto da nota não pode ser vazio.' });
      }

      const [updated] = await db
        .update(collectionNotes)
        .set({
          ...(b.negotiationStatus ? { negotiationStatus: b.negotiationStatus } : {}),
          ...(b.note !== undefined ? { note: String(b.note).trim() } : {}),
          ...(b.channel ? { channel: b.channel } : {}),
          ...(b.cancelRequest !== undefined ? { cancelRequest: b.cancelRequest } : {}),
          updatedAt: new Date(),
        })
        .where(eq(collectionNotes.id, id))
        .returning();

      deps.broadcast('collection:note', { action: 'updated', note: updated });
      res.json({ note: updated });
    } catch (error) {
      console.error('PUT /api/collection-notes/:id error:', error);
      res.status(500).json({ error: 'Erro ao atualizar nota de cobrança.' });
    }
  });

  app.delete('/api/collection-notes/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      const [existing] = await db.select().from(collectionNotes).where(eq(collectionNotes.id, id)).limit(1);
      if (!existing) return res.status(404).json({ error: 'Nota não encontrada.' });

      await db.delete(collectionNotes).where(eq(collectionNotes.id, id));
      deps.broadcast('collection:note', { action: 'deleted', id });
      res.json({ ok: true });
    } catch (error) {
      console.error('DELETE /api/collection-notes/:id error:', error);
      res.status(500).json({ error: 'Não foi possível excluir a solicitação.' });
    }
  });

  // ---------------------------------------------------------------------------
  // 7. DETALHE DO CLIENTE / FICHAS E ADITIVOS PARA MODAL DA COORDENAÇÃO (§3.3 / §4.5)
  // ---------------------------------------------------------------------------
  app.post('/api/admissions/collection-summary', requireAuth, async (req: AuthRequest, res) => {
    try {
      const clientIds = Array.isArray(req.body?.clientIds)
        ? (req.body.clientIds as unknown[]).map(Number).filter((n) => Number.isInteger(n) && n > 0)
        : [];
      if (clientIds.length === 0) return res.json({ summary: {} });

      const [clientAdmissions, docs] = await Promise.all([
        db.select().from(admissions).where(inArray(admissions.clientId, clientIds)),
        db
          .select()
          .from(documentObjects)
          .where(and(inArray(documentObjects.clientId, clientIds), eq(documentObjects.docCategory, 'aditivo'), isNull(documentObjects.deletedAt))),
      ]);

      const summary: Record<number, { fichas: number; aditivos: number; latestAddendumDate: string | null }> = {};
      for (const cid of clientIds) {
        const eligibleAdms = clientAdmissions.filter(
          (a) => a.clientId === cid && ELIGIBLE_ADMISSION_STATUSES.has(String(a.status || '').toLowerCase())
        );
        const admIdSet = new Set(eligibleAdms.map((a) => a.id));
        const clientAddendums = docs.filter((d) => d.admissionId && admIdSet.has(d.admissionId));
        let latest: string | null = null;
        for (const ad of clientAddendums) {
          const iso = ad.createdAt ? new Date(ad.createdAt).toISOString() : null;
          if (iso && (!latest || iso > latest)) latest = iso;
        }
        summary[cid] = {
          fichas: eligibleAdms.length,
          aditivos: clientAddendums.length,
          latestAddendumDate: latest,
        };
      }
      res.json({ summary });
    } catch (error) {
      console.error('POST /api/admissions/collection-summary error:', error);
      res.status(500).json({ error: 'Erro ao calcular resumo de fichas e aditivos.' });
    }
  });

  app.get('/api/admissions/client-detail/:clientId', requireAuth, async (req: AuthRequest, res) => {
    try {
      const clientId = Number(req.params.clientId);
      const clientAdmissions = await db
        .select()
        .from(admissions)
        .where(eq(admissions.clientId, clientId))
        .orderBy(desc(admissions.createdAt))
        .limit(50);

      const eligibleAdmissions = clientAdmissions.filter((a) =>
        ELIGIBLE_ADMISSION_STATUSES.has(String(a.status || '').toLowerCase())
      );

      const admIds = clientAdmissions.map((a) => a.id);
      const [docs, linkedTitles] = await Promise.all([
        admIds.length > 0
          ? db
              .select()
              .from(documentObjects)
              .where(and(inArray(documentObjects.admissionId, admIds), isNull(documentObjects.deletedAt)))
          : Promise.resolve([]),
        admIds.length > 0
          ? db
              .select()
              .from(financialTitles)
              .where(and(eq(financialTitles.clientId, clientId), eq(financialTitles.scope, 'RECEBER')))
              .orderBy(asc(financialTitles.dueDate), asc(financialTitles.id))
              .limit(200)
          : db
              .select()
              .from(financialTitles)
              .where(and(eq(financialTitles.clientId, clientId), eq(financialTitles.scope, 'RECEBER')))
              .orderBy(asc(financialTitles.dueDate), asc(financialTitles.id))
              .limit(200),
      ]);

      const admissionsDetail = eligibleAdmissions.map((adm) => {
        const admAddendums = docs.filter((d) => d.admissionId === adm.id && d.docCategory === 'aditivo');
        const latestAddendumDate = admAddendums
          .map((d) => (d.createdAt ? new Date(d.createdAt).toISOString() : ''))
          .filter(Boolean)
          .sort()
          .reverse()[0] || null;
        const parcelas = linkedTitles.filter((t) => t.admissionId === adm.id);
        return {
          admissionId: adm.id,
          contractNumber: adm.contractNumber,
          protocolCode: adm.protocolCode,
          status: adm.status,
          addendumsCount: admAddendums.length,
          hasAddendum: admAddendums.length > 0,
          latestAddendumDate,
          addendums: admAddendums,
          parcelas,
        };
      });

      res.json({
        admissionsDetail,
        allClientTitles: linkedTitles,
      });
    } catch (error) {
      console.error('GET /api/admissions/client-detail/:clientId error:', error);
      res.status(500).json({ error: 'Erro ao consultar detalhamento do cliente.' });
    }
  });

  // Consulta histórica jurídica / auditoria para Ficha (sem disparar nova varredura Escavador)
  app.get('/api/admissions/:id/legal-scan', requireAuth, async (req: AuthRequest, res) => {
    try {
      const admissionId = Number(req.params.id);
      const [adm] = await db.select().from(admissions).where(eq(admissions.id, admissionId)).limit(1);
      if (!adm) return res.status(404).json({ error: 'Ficha de admissão não encontrada.' });

      const processes = await db
        .select()
        .from(legalProcesses)
        .where(eq(legalProcesses.admissionId, admissionId))
        .orderBy(desc(legalProcesses.lastMovementAt));

      const procIds = processes.map((p) => p.id);
      const movements =
        procIds.length > 0
          ? await db
              .select()
              .from(legalMovements)
              .where(inArray(legalMovements.processId, procIds))
              .orderBy(desc(legalMovements.createdAt))
          : [];

      const lastProcess = processes[0] || null;
      const lastMovement = movements[0] || null;
      res.json({
        legalScan: {
          performed: processes.length > 0 || adm.escavadorAlert,
          lastUpdate: lastProcess?.escavadorUpdatedAt || lastProcess?.lastMovementAt || adm.auditedAt || null,
          found: processes.length > 0,
          processNumber: lastProcess?.processNumber || null,
          courtName: lastProcess?.courtName || null,
          lastMovement: lastMovement?.originalDispatch || lastProcess?.escavadorLastActionNote || null,
          allProcesses: processes.map((p) => {
            const pMov = movements.find((m) => m.processId === p.id);
            return {
              id: p.id,
              numeroProcesso: p.processNumber,
              tribunal: p.courtName,
              classe: p.actionType,
              status: p.status,
              hasSearchSeizure: p.hasSearchSeizure,
              vehicleSeized: p.vehicleSeized,
              ultimaMovimentacao: pMov?.originalDispatch || p.escavadorLastActionNote || null,
              lastMovementAt: p.lastMovementAt,
            };
          }),
        },
        critiques: adm.auditCritiquesJson || [],
      });
    } catch (error) {
      console.error('GET /api/admissions/:id/legal-scan error:', error);
      res.status(500).json({ error: 'Erro ao carregar histórico jurídico da ficha.' });
    }
  });

  // ---------------------------------------------------------------------------
  // 8. COMPROVANTE DE PAGAMENTO NO BUCKET DA INVICTA (Anexar e Vincular ao Título)
  // ---------------------------------------------------------------------------
  app.post(
    '/api/financial-titles/:id/receipt',
    requireAuth,
    receiptUpload.single('file'),
    async (req: AuthRequest, res) => {
      try {
        const titleId = Number(req.params.id);
        const [titleRow] = await db
          .select()
          .from(financialTitles)
          .where(eq(financialTitles.id, titleId))
          .limit(1);
        if (!titleRow) return res.status(404).json({ error: 'Título financeiro não encontrado.' });

        const file = req.file;
        if (!file) return res.status(400).json({ error: 'Selecione um arquivo de comprovante.' });

        const validationErr = validateUploadFile(file.originalname, file.mimetype, file.size);
        if (validationErr) return res.status(400).json({ error: validationErr });

        const safeFileName = sanitizeFileName(file.originalname);
        const targetUnitId = titleRow.unitId || req.activeUnitId || 1;
        const folderPath = `bucketdainvicta/U${targetUnitId}/C${titleRow.clientId}/COMPROVANTES`;

        const stored = await putBucketObject(file.buffer, {
          folderPath,
          mimeType: file.mimetype,
          originalName: safeFileName,
        });

        const [doc] = await db
          .insert(documentObjects)
          .values({
            clientId: titleRow.clientId,
            admissionId: titleRow.admissionId ?? null,
            folderPath,
            fileName: safeFileName,
            docCategory: 'comprovante',
            mimeType: file.mimetype || 'application/octet-stream',
            sizeBytes: stored.sizeBytes,
            sha256Hash: stored.sha256Hash,
            storageUri: stored.storageUri,
            uploadedBy: req.authUser?.name || 'Coordenação',
            unitId: targetUnitId,
          })
          .returning();

        const [updatedTitle] = await db
          .update(financialTitles)
          .set({
            receiptDocId: doc.id,
            updatedAt: new Date(),
          })
          .where(eq(financialTitles.id, titleId))
          .returning();

        await db.insert(auditLogs).values({
          userId: req.authUser?.id ?? null,
          userName: req.authUser?.name || 'Sistema',
          action: 'ATTACH_RECEIPT',
          entityType: 'CONTA_RECEBER',
          entityId: String(titleId),
          details: {
            changes: [
              {
                field: 'Comprovante (Bucket da Invicta)',
                from: titleRow.receiptDocId ? `Doc #${titleRow.receiptDocId}` : 'Sem comprovante',
                to: `${doc.fileName} (#${doc.id})`,
              },
            ],
            documentId: doc.id,
            sha256Hash: stored.sha256Hash,
            backend: stored.backend,
          },
          unitId: targetUnitId,
        });

        deps.broadcast('collection:payment', {
          type: 'receipt_attached',
          titleId,
          docId: doc.id,
          operator: req.authUser?.name || 'Coordenação',
        });

        res.json({
          document: doc,
          title: updatedTitle,
          backend: stored.backend,
          deduplicated: stored.deduplicated,
        });
      } catch (error) {
        console.error('POST /api/financial-titles/:id/receipt error:', error);
        res.status(500).json({ error: 'Erro ao gravar comprovante no bucket da Invicta.' });
      }
    }
  );

  // ---------------------------------------------------------------------------
  // 9. ESPELHAMENTO SILENCIOSO DA TELA DO OPERADOR (Somente Leitura — ZERO Notificações)
  // ---------------------------------------------------------------------------
  app.get('/api/collection/coordinator/operator-mirror/:collaboratorId', requireAuth, async (req: AuthRequest, res) => {
    try {
      const collaboratorId = Number(req.params.collaboratorId);
      const [collab] = await db
        .select()
        .from(collaborators)
        .where(eq(collaborators.id, collaboratorId))
        .limit(1);
      if (!collab) return res.status(404).json({ error: 'Colaborador não encontrado.' });

      const [allTitles, allCases, allClients, allNotes, allUsers] = await Promise.all([
        db
          .select()
          .from(financialTitles)
          .where(eq(financialTitles.scope, 'RECEBER'))
          .orderBy(asc(financialTitles.dueDate), asc(financialTitles.id)),
        db.select().from(collectionCases),
        db.select().from(clients),
        db.select().from(collectionNotes).orderBy(desc(collectionNotes.createdAt)),
        db
          .select({
            id: users.id,
            name: users.name,
            email: users.email,
            role: users.role,
            points: users.points,
          })
          .from(users),
      ]);

      const rankingUsers = [...allUsers].sort((a, b) => b.points - a.points);
      const linkedUserIndex = collab.userId ? rankingUsers.findIndex((u) => u.id === collab.userId) : -1;
      const linkedUser = linkedUserIndex >= 0 ? rankingUsers[linkedUserIndex] : null;

      const clientMap = new Map(allClients.map((c) => [c.id, c]));
      const caseByTitle = new Map(allCases.map((c) => [c.titleId, c]));

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const calcAging = (due: Date | string) => {
        const d = new Date(due);
        if (Number.isNaN(d.getTime())) return 0;
        d.setHours(0, 0, 0, 0);
        return Math.floor((today.getTime() - d.getTime()) / 86_400_000);
      };

      const operatorTitles = allTitles.filter((t) => {
        if (String(t.titleType || 'PADRAO').toUpperCase() !== 'PADRAO') return false;
        const st = normStatusUpper(t.status);
        if (st === 'CANCELADO' || st === 'AGRUPADO' || st === 'FATURA_GERADA') return false;
        const c = caseByTitle.get(t.id);
        return (
          t.assignedCollaboratorId === collaboratorId ||
          (collab.userId != null && c?.assignedCollectorId === collab.userId)
        );
      });

      const queue = operatorTitles
        .map((t) => {
          const cl = clientMap.get(t.clientId);
          const colCase = caseByTitle.get(t.id);
          const agingDays = calcAging(t.dueDate);
          const st = normStatusUpper(t.status);
          const effectiveCaseStatus =
            st === 'PAGO'
              ? 'pago'
              : cl?.status === 'suspenso'
              ? 'suspenso'
              : cl?.status === 'cancelado'
              ? 'cancelado'
              : colCase?.status || 'em_cobranca';
          return {
            titleId: t.id,
            caseId: colCase?.id ?? null,
            clientId: t.clientId,
            clientName: cl?.fullName || t.clientName || `Cliente #${t.clientId}`,
            clientCpfCnpj: cl?.cpfCnpj || '',
            clientStatus: cl?.status || 'ativo',
            documentNumber: t.documentNumber || t.titleCode,
            titleCode: t.titleCode,
            description: t.description || '',
            dueDate: t.dueDate ? new Date(t.dueDate).toISOString() : '',
            agingDays,
            amountCents: Number(t.originalValueCents || t.amountCents || 0),
            currentBalanceCents: Number(st === 'PAGO' ? 0 : t.currentBalanceCents ?? t.amountCents ?? 0),
            status: t.status,
            collectionStatus: t.collectionStatus || 'COBRAR',
            stateCode: (colCase?.stateCode || cl?.state || 'PE').toUpperCase(),
            conversationSummary: colCase?.conversationSummary || '',
            pointsAwarded: colCase?.pointsAwarded || 0,
            _sortStatus: effectiveCaseStatus,
          };
        })
        .sort((a, b) => {
          if (a._sortStatus === 'em_cobranca' && b._sortStatus !== 'em_cobranca') return -1;
          if (b._sortStatus === 'em_cobranca' && a._sortStatus !== 'em_cobranca') return 1;
          if (b.agingDays !== a.agingDays) return b.agingDays - a.agingDays;
          return b.currentBalanceCents - a.currentBalanceCents;
        })
        .map(({ _sortStatus: _unused, ...rest }) => rest);

      const titleIdSet = new Set(operatorTitles.map((t) => t.id));
      const operatorNotes = allNotes.filter(
        (n) =>
          n.collaboratorId === collaboratorId ||
          (collab.userId != null && n.userId === collab.userId) ||
          (n.titleId != null && titleIdSet.has(n.titleId))
      );

      const openQueue = queue.filter((q) => normStatusUpper(q.status) !== 'PAGO');
      const paidQueue = queue.filter((q) => normStatusUpper(q.status) === 'PAGO');
      const overdueQueue = openQueue.filter((q) => q.agingDays > 0);

      res.json({
        collaborator: collab,
        linkedUser: linkedUser
          ? {
              ...linkedUser,
              rankPosition: linkedUserIndex + 1,
            }
          : null,
        metrics: {
          totalAssignedCount: openQueue.length,
          overdueCount: overdueQueue.length,
          openBalanceCents: openQueue.reduce((s, q) => s + q.currentBalanceCents, 0),
          overdueBalanceCents: overdueQueue.reduce((s, q) => s + q.currentBalanceCents, 0),
          paidCount: paidQueue.length,
          recoveredCents: paidQueue.reduce((s, q) => s + q.amountCents, 0),
          notesCount: operatorNotes.length,
          cancelRequestsCount: operatorNotes.filter((n) => n.negotiationStatus === 'SOLICITA_CANCELAMENTO').length,
        },
        queue,
        notes: operatorNotes,
      });
    } catch (error) {
      console.error('GET /api/collection/coordinator/operator-mirror error:', error);
      res.status(500).json({ error: 'Erro ao carregar visão silenciosa do operador.' });
    }
  });

  // ---------------------------------------------------------------------------
  // 10. IVI COBRANÇA: Resumo WhatsApp (3-Colunas), Insights Proativos e Relatórios Salvos
  // ---------------------------------------------------------------------------
  app.post('/api/collection/coordinator/whatsapp-summary', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { clientId, threadId } = (req.body || {}) as { clientId?: number; threadId?: number };
      if (!clientId) return res.status(400).json({ error: 'clientId obrigatório.' });

      const [clientRows, threads, clientTitles] = await Promise.all([
        db.select().from(clients).where(eq(clients.id, Number(clientId))).limit(1),
        db.select().from(whatsappThreads).orderBy(desc(whatsappThreads.updatedAt)),
        db
          .select()
          .from(financialTitles)
          .where(and(eq(financialTitles.clientId, Number(clientId)), eq(financialTitles.scope, 'RECEBER'))),
      ]);
      const cl = clientRows[0];
      if (!cl) return res.status(404).json({ error: 'Cliente não encontrado.' });

      const phoneDigits = (cl.whatsapp || cl.phone || '').replace(/\D/g, '').slice(-8);
      const clientThreads = threads.filter(
        (th) =>
          th.clientId === cl.id ||
          (phoneDigits.length >= 8 && th.contactPhone.replace(/\D/g, '').endsWith(phoneDigits))
      );
      const targetThreads = threadId
        ? clientThreads.filter((th) => th.id === Number(threadId))
        : clientThreads;
      const effectiveThreads = targetThreads.length > 0 ? targetThreads : clientThreads;
      const threadIds = effectiveThreads.map((t) => t.id);
      const messages =
        threadIds.length > 0
          ? await db
              .select()
              .from(whatsappMessages)
              .where(inArray(whatsappMessages.threadId, threadIds))
              .orderBy(asc(whatsappMessages.createdAt))
          : [];

      const threadProviderMap = new Map(effectiveThreads.map((t) => [t.id, t.provider]));
      const activeThread = effectiveThreads[0] || null;
      const openBalanceCents = clientTitles
        .filter((t) => !EXCLUDED_PORTFOLIO_STATUSES.has(normStatusUpper(t.status)))
        .reduce((s, t) => s + Number(t.currentBalanceCents ?? t.amountCents ?? 0), 0);

      const providerSet = [...new Set(effectiveThreads.map((t) => t.provider.toUpperCase()))];
      const summary = await iviSummarizeCollectionWhatsapp({
        clientName: cl.fullName,
        cpfCnpj: cl.cpfCnpj,
        operatorName: activeThread?.operatorName || 'Operador da Equipe',
        providerLabel: providerSet.join(' + ') || 'WhatsApp',
        openBalanceFormatted: (openBalanceCents / 100).toLocaleString('pt-BR', {
          style: 'currency',
          currency: 'BRL',
        }),
        messages: messages.map((m) => ({
          direction: m.direction,
          senderName: m.senderName,
          contentType: m.contentType,
          body: m.body,
          audioTranscript: m.iviAudioTranscript,
          createdAt: m.createdAt ? new Date(m.createdAt).toLocaleString('pt-BR') : '',
          provider: threadProviderMap.get(m.threadId) || 'gotalk',
        })),
      });

      res.json(summary);
    } catch (error) {
      console.error('POST /api/collection/coordinator/whatsapp-summary error:', error);
      res.status(500).json({ error: 'Erro ao gerar resumo da Ivi para conversa WhatsApp.' });
    }
  });

  app.post('/api/collection/coordinator/ivi-insights', requireAuth, async (_req: AuthRequest, res) => {
    try {
      const [receberTitles, allClients, allCollabs, notesRows] = await Promise.all([
        db.select().from(financialTitles).where(eq(financialTitles.scope, 'RECEBER')),
        db.select().from(clients),
        db.select().from(collaborators),
        db.select().from(collectionNotes),
      ]);

      const clientMap = new Map(allClients.map((c) => [c.id, c]));
      const collabMap = new Map(allCollabs.map((c) => [c.id, c]));

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const calcAging = (due: Date | string) => {
        const d = new Date(due);
        if (Number.isNaN(d.getTime())) return 0;
        d.setHours(0, 0, 0, 0);
        return Math.floor((today.getTime() - d.getTime()) / 86_400_000);
      };

      const padraoTitles = receberTitles.filter(
        (t) => String(t.titleType || 'PADRAO').toUpperCase() === 'PADRAO'
      );
      const activeTitles = padraoTitles.filter(
        (t) => !EXCLUDED_PORTFOLIO_STATUSES.has(normStatusUpper(t.status))
      );
      const paidTitles = padraoTitles.filter((t) => normStatusUpper(t.status) === 'PAGO');
      const partialTitles = activeTitles.filter((t) => normStatusUpper(t.status) === 'PARCIAL');

      let overdueCount = 0;
      let overdueBalanceCents = 0;
      let unassignedOverdueCount = 0;
      let unassignedOverdueCents = 0;
      let over60DaysCount = 0;
      let over60DaysCents = 0;
      let blockedWithOpenTitlesCount = 0;

      const byUf = new Map<string, { uf: string; overdueCents: number; count: number }>();
      const byOp = new Map<number, { collaboratorId: number; name: string; count: number; overdueCents: number }>();

      for (const t of activeTitles) {
        const bal = Number(t.currentBalanceCents ?? t.amountCents ?? 0);
        const days = calcAging(t.dueDate);
        const cl = clientMap.get(t.clientId);
        if (cl && (cl.status === 'suspenso' || cl.status === 'cancelado')) {
          blockedWithOpenTitlesCount += 1;
        }
        if (days > 0) {
          overdueCount += 1;
          overdueBalanceCents += bal;
          if (!t.assignedCollaboratorId) {
            unassignedOverdueCount += 1;
            unassignedOverdueCents += bal;
          }
          if (days > 60) {
            over60DaysCount += 1;
            over60DaysCents += bal;
          }
          const uf = (cl?.state || 'N/I').toUpperCase();
          const ufEntry = byUf.get(uf) || { uf, overdueCents: 0, count: 0 };
          ufEntry.overdueCents += bal;
          ufEntry.count += 1;
          byUf.set(uf, ufEntry);

          if (t.assignedCollaboratorId) {
            const opEntry = byOp.get(t.assignedCollaboratorId) || {
              collaboratorId: t.assignedCollaboratorId,
              name: collabMap.get(t.assignedCollaboratorId)?.name || `#${t.assignedCollaboratorId}`,
              count: 0,
              overdueCents: 0,
            };
            opEntry.count += 1;
            opEntry.overdueCents += bal;
            byOp.set(t.assignedCollaboratorId, opEntry);
          }
        }
      }

      const payload = await iviAnalyzeCollectionInsights({
        totalActiveCount: activeTitles.length,
        overdueCount,
        partialCount: partialTitles.length,
        paidCount: paidTitles.length,
        totalOpenCents: activeTitles.reduce((s, t) => s + Number(t.currentBalanceCents ?? t.amountCents ?? 0), 0),
        overdueBalanceCents,
        recoveredCents: paidTitles.reduce((s, t) => s + Number(t.originalValueCents || t.amountCents || 0), 0),
        unassignedOverdueCount,
        unassignedOverdueCents,
        over60DaysCount,
        over60DaysCents,
        blockedWithOpenTitlesCount,
        pendingCancelRequestsCount: notesRows.filter(
          (n) => n.negotiationStatus === 'SOLICITA_CANCELAMENTO' && Boolean(n.cancelRequest)
        ).length,
        partialMissingReceiptCount: partialTitles.filter((t) => !t.receiptDocId).length,
        paidMissingReceiptCount: paidTitles.filter((t) => !t.receiptDocId).length,
        topBanks: [],
        topUfs: [...byUf.values()].sort((a, b) => b.overdueCents - a.overdueCents).slice(0, 5),
        operatorLoad: [...byOp.values()].sort((a, b) => b.overdueCents - a.overdueCents).slice(0, 8),
      });

      res.json(payload);
    } catch (error) {
      console.error('POST /api/collection/coordinator/ivi-insights error:', error);
      res.status(500).json({ error: 'Erro ao gerar insights da Ivi.' });
    }
  });

  app.post('/api/collection/coordinator/reports', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { reportType, customPrompt } = (req.body || {}) as {
        reportType?: 'carteira_vencida' | 'ranking_operadores' | 'recebimentos' | 'inadimplencia_uf' | 'custom_ivi';
        customPrompt?: string;
      };

      const [receberTitles, settlementsRows, allClients, allCollabs, allUsers, notesRows] = await Promise.all([
        db.select().from(financialTitles).where(eq(financialTitles.scope, 'RECEBER')),
        db.select().from(titleSettlements),
        db.select().from(clients),
        db.select().from(collaborators),
        db.select({ id: users.id, name: users.name, role: users.role, points: users.points }).from(users),
        db.select().from(collectionNotes),
      ]);

      const clientMap = new Map(allClients.map((c) => [c.id, c]));
      const collabMap = new Map(allCollabs.map((c) => [c.id, c]));
      const collabByUserId = new Map<number, typeof allCollabs[number]>();
      for (const c of allCollabs) {
        if (c.userId != null) collabByUserId.set(c.userId, c);
      }
      const userMap = new Map(allUsers.map((u) => [u.id, u]));

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const calcAging = (due: Date | string) => {
        const d = new Date(due);
        if (Number.isNaN(d.getTime())) return 0;
        d.setHours(0, 0, 0, 0);
        return Math.floor((today.getTime() - d.getTime()) / 86_400_000);
      };

      const eligibleTitles = receberTitles.filter((t) => {
        if (String(t.titleType || 'PADRAO').toUpperCase() !== 'PADRAO') return false;
        const st = normStatusUpper(t.status);
        if (st === 'PAGO') return true;
        return !EXCLUDED_PORTFOLIO_STATUSES.has(st);
      });

      const titleInputs = eligibleTitles.map((t) => {
        const cl = clientMap.get(t.clientId);
        const st = normStatusUpper(t.status);
        const agingDays = st === 'PAGO' ? 0 : calcAging(t.dueDate);
        return {
          id: t.id,
          documentNumber: t.documentNumber || t.titleCode,
          titleCode: t.titleCode,
          clientId: t.clientId,
          clientName: cl?.fullName || t.clientName || `Cliente #${t.clientId}`,
          clientUf: (cl?.state || 'N/I').toUpperCase(),
          bankName: '',
          dueDateIso: t.dueDate ? new Date(t.dueDate).toISOString().slice(0, 10) : '',
          agingDays,
          originalValueCents: Number(t.originalValueCents || t.amountCents || 0),
          currentBalanceCents: Number(st === 'PAGO' ? 0 : t.currentBalanceCents ?? t.amountCents ?? 0),
          status: t.status,
          collectionStatus: t.collectionStatus || 'EM_DIA',
          collaboratorName: t.assignedCollaboratorId
            ? collabMap.get(t.assignedCollaboratorId)?.name || `#${t.assignedCollaboratorId}`
            : 'Sem atribuição',
          hasReceipt: Boolean(t.receiptDocId),
        };
      });

      const settlementsByTitle = new Map<number, number>();
      for (const s of settlementsRows) {
        settlementsByTitle.set(
          s.titleId,
          (settlementsByTitle.get(s.titleId) || 0) + Number(s.amountCents || 0)
        );
      }

      const operatorsRanking = allCollabs.map((collab) => {
        const linkedUser = collab.userId ? userMap.get(collab.userId) : undefined;
        const cTitles = eligibleTitles.filter(
          (t) =>
            t.assignedCollaboratorId === collab.id ||
            (!t.assignedCollaboratorId && t.collectorId != null && collabByUserId.get(t.collectorId)?.id === collab.id)
        );
        const openTitles = cTitles.filter((t) => normStatusUpper(t.status) !== 'PAGO');
        const paidTitles = cTitles.filter((t) => normStatusUpper(t.status) === 'PAGO');
        const overdueTitles = openTitles.filter((t) => calcAging(t.dueDate) > 0);
        const cNotes = notesRows.filter(
          (n) => n.collaboratorId === collab.id || (collab.userId != null && n.userId === collab.userId)
        );
        const closedTitleIds = new Set<number>();
        let recoveredCents = 0;
        for (const t of cTitles) {
          const st = normStatusUpper(t.status);
          const orig = Number(t.originalValueCents || t.amountCents || 0);
          const bal = Number(t.currentBalanceCents ?? t.amountCents ?? 0);
          const settled = settlementsByTitle.get(t.id) || 0;
          if (st === 'PAGO') {
            closedTitleIds.add(t.id);
            recoveredCents += settled > 0 ? settled : orig;
          } else if (settled > 0 || (st === 'PARCIAL' && orig > bal)) {
            closedTitleIds.add(t.id);
            recoveredCents += settled > 0 ? settled : Math.max(0, orig - bal);
          }
        }
        const closedNotes = cNotes.filter((n) => n.negotiationStatus === 'FECHADA');
        const extraClosedAgreements = closedNotes.filter((n) => !n.titleId || !closedTitleIds.has(n.titleId)).length;
        const closedRecoveriesCount = closedTitleIds.size + extraClosedAgreements;
        return {
          name: collab.name,
          role: collab.jobTitle || linkedUser?.role || 'Cobrança',
          points: linkedUser?.points || 0,
          closedRecoveriesCount,
          assignedCount: openTitles.length,
          overdueCount: overdueTitles.length,
          openBalanceCents: openTitles.reduce((s, t) => s + Number(t.currentBalanceCents ?? t.amountCents ?? 0), 0),
          recoveredCount: paidTitles.length,
          recoveredCents,
          notesCount: cNotes.length,
        };
      }).sort((a, b) => b.closedRecoveriesCount - a.closedRecoveriesCount || b.recoveredCents - a.recoveredCents);

      const built = await iviBuildCollectionReport({
        reportType: reportType || 'carteira_vencida',
        customPrompt,
        titles: titleInputs,
        operatorsRanking,
      });

      const [saved] = await db
        .insert(collectionReports)
        .values({
          title: built.title,
          reportType: built.reportType,
          prompt: built.prompt,
          executiveSummary: built.executiveSummary,
          insightsJson: built.insightsJson,
          columnsJson: built.columnsJson,
          rowsJson: built.rowsJson,
          chartSeriesJson: built.chartSeriesJson,
          provider: built.provider,
          createdByUserId: req.authUser?.id ?? null,
          createdByName: req.authUser?.name || 'Coordenação',
          unitId: req.activeUnitId || 1,
        })
        .returning();

      res.status(201).json({ report: saved });
    } catch (error) {
      console.error('POST /api/collection/coordinator/reports error:', error);
      res.status(500).json({ error: 'Erro ao montar e salvar relatório da Ivi.' });
    }
  });

  app.delete('/api/collection/coordinator/reports/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      const [existing] = await db
        .select()
        .from(collectionReports)
        .where(eq(collectionReports.id, id))
        .limit(1);
      if (!existing) return res.status(404).json({ error: 'Relatório não encontrado.' });
      await db.delete(collectionReports).where(eq(collectionReports.id, id));
      res.json({ ok: true });
    } catch (error) {
      console.error('DELETE /api/collection/coordinator/reports/:id error:', error);
      res.status(500).json({ error: 'Erro ao remover relatório salvo.' });
    }
  });

  app.post('/api/collection/coordinator/ivi-state-analysis', requireAuth, async (req: AuthRequest, res) => {
    try {
      const body = (req.body || {}) as {
        month?: string;
        monthLabel?: string;
        collaboratorLabel?: string;
        monthlyTotals?: {
          monthDebtCents: number;
          monthOverdueDebtCents: number;
          monthRecoveredCents: number;
          monthRecoveryRatePct: number;
          monthOpenCount: number;
          monthSettledCount: number;
        };
        stateBreakdown?: Array<{
          uf: string;
          clientsCount: number;
          openTitlesCount: number;
          debtBalanceCents: number;
          overdueDebtCents: number;
          recoveredTotalCents: number;
          recoveryRatePct: number;
          monthDebtCents: number;
          monthRecoveredCents: number;
          monthRecoveryRatePct: number;
        }>;
      };

      const month = String(body.month || new Date().toISOString().slice(0, 7));
      const monthLabel = String(body.monthLabel || month);
      const states = Array.isArray(body.stateBreakdown) ? body.stateBreakdown : [];
      const totals = body.monthlyTotals || {
        monthDebtCents: 0,
        monthOverdueDebtCents: 0,
        monthRecoveredCents: 0,
        monthRecoveryRatePct: 0,
        monthOpenCount: 0,
        monthSettledCount: 0,
      };

      const topDebtUf = [...states].sort((a, b) => b.debtBalanceCents - a.debtBalanceCents)[0];
      const topRecUf = [...states].sort((a, b) => b.recoveredTotalCents - a.recoveredTotalCents)[0];
      const worstOverdueUf = [...states].sort((a, b) => b.overdueDebtCents - a.overdueDebtCents)[0];

      const fmtBRL = (cents: number) =>
        (Number(cents || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

      const fallbackSummary =
        states.length === 0
          ? `Sem registros estaduais ativos para ${monthLabel} com os filtros atuais.`
          : `No recorte de ${monthLabel} (${body.collaboratorLabel || 'Carteira Global'}), o endividamento acumulado do mês soma ${fmtBRL(totals.monthDebtCents)} (com ${fmtBRL(totals.monthOverdueDebtCents)} já vencido) frente a ${fmtBRL(totals.monthRecoveredCents)} recuperados no mês (eficiência mensal de ${totals.monthRecoveryRatePct.toFixed(1)}%). A maior concentração de saldo devedor está em ${topDebtUf?.uf || 'N/I'} (${fmtBRL(topDebtUf?.debtBalanceCents || 0)}), enquanto ${topRecUf?.uf || 'N/I'} lidera em recuperação acumulada (${fmtBRL(topRecUf?.recoveredTotalCents || 0)}).`;

      const fallbackHighlights: string[] = [];
      if (topDebtUf) {
        fallbackHighlights.push(
          `Concentração estadual: ${topDebtUf.uf} concentra ${fmtBRL(topDebtUf.debtBalanceCents)} em aberto (${topDebtUf.openTitlesCount} títulos de ${topDebtUf.clientsCount} clientes), exigindo cadência prioritária.`
        );
      }
      if (worstOverdueUf && worstOverdueUf.overdueDebtCents > 0) {
        fallbackHighlights.push(
          `Risco vencido em ${worstOverdueUf.uf}: ${fmtBRL(worstOverdueUf.overdueDebtCents)} já vencidos na carteira geral; avaliar escalonamento jurídico ou campanha de acordo.`
        );
      }
      if (topRecUf) {
        fallbackHighlights.push(
          `Melhor tração de caixa: ${topRecUf.uf} registra ${fmtBRL(topRecUf.recoveredTotalCents)} recuperados no total (${topRecUf.recoveryRatePct.toFixed(1)}% de conversão estadual).`
        );
      }
      fallbackHighlights.push(
        `Acumulado de ${monthLabel}: ${fmtBRL(totals.monthRecoveredCents)} recuperados sobre ${fmtBRL(totals.monthDebtCents)} previstos no mês (${totals.monthSettledCount} liquidação/baixa registrada).`
      );

      const fallbackFocusUfs = [...states]
        .filter((s) => s.overdueDebtCents > 0 || s.debtBalanceCents > 0)
        .sort((a, b) => b.overdueDebtCents - a.overdueDebtCents || b.debtBalanceCents - a.debtBalanceCents)
        .slice(0, 3)
        .map((s) => s.uf);

      try {
        const promptData = {
          month: monthLabel,
          filtro: body.collaboratorLabel || 'Carteira Global',
          acumuladoMes: {
            endividamentoMes: fmtBRL(totals.monthDebtCents),
            vencidoMes: fmtBRL(totals.monthOverdueDebtCents),
            recuperadoMes: fmtBRL(totals.monthRecoveredCents),
            taxaRecuperacaoMesPct: Number(totals.monthRecoveryRatePct.toFixed(1)),
          },
          estadosTop: states.slice(0, 10).map((s) => ({
            uf: s.uf,
            clientes: s.clientsCount,
            titulosAbertos: s.openTitlesCount,
            endividamentoTotal: fmtBRL(s.debtBalanceCents),
            vencidoTotal: fmtBRL(s.overdueDebtCents),
            recuperadoTotal: fmtBRL(s.recoveredTotalCents),
            taxaRecuperacaoGeralPct: Number(s.recoveryRatePct.toFixed(1)),
            endividamentoMes: fmtBRL(s.monthDebtCents),
            recuperadoMes: fmtBRL(s.monthRecoveredCents),
            taxaRecuperacaoMesPct: Number(s.monthRecoveryRatePct.toFixed(1)),
          })),
        };

        const aiResult = await runIviOrchestrator(
          'Você é Ivi, analista executiva de cobrança do FinancePro. Analise os indicadores de endividamento e recuperação por Estado (UF) e os indicadores acumulados para o mês. Responda EXCLUSIVAMENTE em JSON válido: {"executiveSummary": "texto executivo conciso em PT-BR (máx 3 frases)", "highlights": ["insight 1", "insight 2", "insight 3", "insight 4"], "focusUfs": ["UF1", "UF2"]}.',
          JSON.stringify(promptData)
        );

        const cleaned = aiResult.text.replace(/```json\s*|\s*```/g, '').trim();
        const parsed = JSON.parse(cleaned) as {
          executiveSummary?: string;
          highlights?: string[];
          focusUfs?: string[];
        };

        return res.json({
          month,
          executiveSummary: parsed.executiveSummary || fallbackSummary,
          highlights:
            Array.isArray(parsed.highlights) && parsed.highlights.length > 0
              ? parsed.highlights
              : fallbackHighlights,
          focusUfs:
            Array.isArray(parsed.focusUfs) && parsed.focusUfs.length > 0
              ? parsed.focusUfs
              : fallbackFocusUfs,
          provider: aiResult.provider,
          generatedAt: new Date().toISOString(),
        });
      } catch {
        return res.json({
          month,
          executiveSummary: fallbackSummary,
          highlights: fallbackHighlights,
          focusUfs: fallbackFocusUfs,
          provider: 'ivi_heuristica_local',
          generatedAt: new Date().toISOString(),
        });
      }
    } catch (error) {
      console.error('POST /api/collection/coordinator/ivi-state-analysis error:', error);
      res.status(500).json({ error: 'Erro ao gerar análise estadual e mensal da Ivi.' });
    }
  });
}
