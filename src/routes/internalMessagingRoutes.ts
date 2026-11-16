import { Express, Response } from 'express';
import { desc, eq, inArray } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { auditLogs, internalMessages, units, userGroups, users } from '../db/schema.ts';
import { AuthRequest, getAllowedUnitIds, isUnitPermitted, requireAuth } from '../middleware/auth.ts';
import {
  getSectorMeta,
  normalizeSectorKey,
  SECTOR_CATALOG,
  SectorKey,
} from '../services/internalMessaging.ts';

function sanitizeError(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

export interface InternalMessageSectorSummary {
  sector: SectorKey;
  label: string;
  shortLabel: string;
  defaultModuleId: string;
  unreadMessages: number;
  autoIviUnread: number;
  manualUnread: number;
  totalMessages: number;
  latestMessageAt: string | null;
  latestSubject: string;
}

function isMessageVisibleToUser(
  m: typeof internalMessages.$inferSelect,
  authUser: NonNullable<AuthRequest['authUser']>
): boolean {
  if (authUser.role === 'admin') return true;
  if (m.recipientId === authUser.id || m.senderId === authUser.id) return true;

  const allowedUnits = Array.isArray(authUser.allowedUnitIds) ? authUser.allowedUnitIds : [];
  if (m.targetUnitId !== null && m.targetUnitId !== undefined) {
    if (!allowedUnits.includes(m.targetUnitId)) {
      return false;
    }
  }

  if (m.targetGroupId !== null && m.targetGroupId !== undefined) {
    return m.targetGroupId === authUser.groupId;
  }

  // Mensagens automáticas da Ivi sem grupo específico são visíveis na unidade permitida
  return true;
}

export function registerInternalMessagingRoutes(
  app: Express,
  deps: { broadcast: (event: string, payload: unknown) => void }
) {
  app.get('/api/internal-messages', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      const authUser = req.authUser!;
      const isAdmin = authUser.role === 'admin';
      const sectorFilterRaw = typeof req.query.sector === 'string' ? req.query.sector.trim() : '';
      const unreadOnly = req.query.unreadOnly === 'true' || req.query.unreadOnly === '1';

      const [allMessages, allGroups, allUnits, allUsers] = await Promise.all([
        db.select().from(internalMessages).orderBy(desc(internalMessages.id)).limit(250),
        db.select().from(userGroups).orderBy(userGroups.id),
        db.select().from(units).orderBy(units.id),
        db
          .select({
            id: users.id,
            name: users.name,
            email: users.email,
            role: users.role,
            groupId: users.groupId,
            defaultUnitId: users.defaultUnitId,
            active: users.active,
          })
          .from(users)
          .orderBy(users.name),
      ]);

      const groupMap = new Map(allGroups.map((g) => [g.id, g]));
      const unitMap = new Map(allUnits.map((u) => [u.id, u]));
      const userMap = new Map(allUsers.map((u) => [u.id, u]));

      const visibleMessages = allMessages.filter((m) => isMessageVisibleToUser(m, authUser));

      const summaryMap = new Map<SectorKey, InternalMessageSectorSummary>();
      for (const sec of SECTOR_CATALOG) {
        summaryMap.set(sec.key, {
          sector: sec.key,
          label: sec.label,
          shortLabel: sec.shortLabel,
          defaultModuleId: sec.defaultModuleId,
          unreadMessages: 0,
          autoIviUnread: 0,
          manualUnread: 0,
          totalMessages: 0,
          latestMessageAt: null,
          latestSubject: '',
        });
      }

      const enrichedAll = visibleMessages.map((m) => {
        const sectorKey = normalizeSectorKey(m.targetSector, m.subject);
        const sectorMeta = getSectorMeta(sectorKey);
        const readList = Array.isArray(m.readByUserIds) ? m.readByUserIds : [];
        const isRead = readList.includes(authUser.id);
        const isUnread = !isRead;

        const grpName =
          m.targetGroupName ||
          (m.targetGroupId ? groupMap.get(m.targetGroupId)?.name || `Grupo #${m.targetGroupId}` : 'Todos os Grupos');
        const unitObj = m.targetUnitId ? unitMap.get(m.targetUnitId) : undefined;
        const unitLabel =
          m.targetUnitName || (unitObj ? `${unitObj.code} · ${unitObj.name}` : 'Todas as Unidades');
        const recipientObj = m.recipientId ? userMap.get(m.recipientId) : undefined;
        const senderGroupObj = m.senderGroupId ? groupMap.get(m.senderGroupId) : undefined;

        const bucket = summaryMap.get(sectorKey);
        if (bucket) {
          bucket.totalMessages += 1;
          if (isUnread) {
            bucket.unreadMessages += 1;
            if (m.isAutoIvi) bucket.autoIviUnread += 1;
            else bucket.manualUnread += 1;
          }
          if (!bucket.latestMessageAt) {
            bucket.latestMessageAt = m.createdAt ? new Date(m.createdAt).toISOString() : null;
            bucket.latestSubject = m.subject;
          }
        }

        return {
          ...m,
          targetSector: sectorKey,
          sectorLabel: sectorMeta.label,
          sectorShortLabel: sectorMeta.shortLabel,
          targetModuleId: sectorMeta.defaultModuleId,
          targetGroupName: grpName,
          targetUnitName: unitLabel,
          senderGroupName: senderGroupObj?.name || '',
          recipientName: recipientObj?.name || '',
          isUnread,
          isRead,
        };
      });

      const normalizedFilterSector =
        sectorFilterRaw && sectorFilterRaw !== 'all' ? normalizeSectorKey(sectorFilterRaw) : '';

      const filteredMessages = enrichedAll.filter((m) => {
        if (normalizedFilterSector && m.targetSector !== normalizedFilterSector) return false;
        if (unreadOnly && !m.isUnread) return false;
        return true;
      });

      const allowedUnitIds = getAllowedUnitIds(req);
      const availableUnits = isAdmin
        ? allUnits.filter((u) => u.active !== false)
        : allUnits.filter((u) => (allowedUnitIds || []).includes(u.id));

      const ownGroup = authUser.groupId ? groupMap.get(authUser.groupId) || null : null;
      const availableGroups = isAdmin ? allGroups : ownGroup ? [ownGroup] : [];

      const availableRecipients = allUsers
        .filter((u) => u.active)
        .filter((u) => (isAdmin ? true : Boolean(authUser.groupId) && u.groupId === authUser.groupId));

      const sectorSummary = SECTOR_CATALOG.map((s) => summaryMap.get(s.key)!);
      const totalUnreadMessages = sectorSummary.reduce((acc, s) => acc + s.unreadMessages, 0);

      res.json({
        messages: filteredMessages,
        sectorSummary,
        totalUnreadMessages,
        sectorsCatalog: SECTOR_CATALOG,
        capabilities: {
          isAdmin,
          ownGroupId: authUser.groupId,
          ownGroupName: ownGroup?.name || 'Sem grupo vinculado',
          activeUnitId: req.activeUnitId || authUser.defaultUnitId || null,
          availableGroups: availableGroups.map((g) => ({
            id: g.id,
            name: g.name,
            description: g.description,
          })),
          availableUnits: availableUnits.map((u) => ({
            id: u.id,
            code: u.code,
            name: u.name,
          })),
          availableRecipients: availableRecipients.map((u) => ({
            id: u.id,
            name: u.name,
            email: u.email,
            groupId: u.groupId,
            role: u.role,
          })),
        },
      });
    } catch (error) {
      console.error('GET /api/internal-messages error:', error);
      res.status(500).json({ error: sanitizeError(error, 'Erro ao carregar mensageria interna.') });
    }
  });

  const handleSendInternalMessage = async (req: AuthRequest, res: Response) => {
    try {
      const authUser = req.authUser!;
      const isAdmin = authUser.role === 'admin';
      const bodyPayload = (req.body || {}) as {
        targetSector?: string;
        targetGroupId?: number | string | null;
        targetUnitId?: number | string | null;
        recipientId?: number | string | null;
        subject?: string;
        body?: string;
      };

      const subject = String(bodyPayload.subject || '').trim();
      const body = String(bodyPayload.body || '').trim();
      if (!subject || !body) {
        return res.status(400).json({ error: 'Informe o assunto e o conteúdo da mensagem.' });
      }

      const sectorKey = normalizeSectorKey(bodyPayload.targetSector, subject);
      const sectorMeta = getSectorMeta(sectorKey);

      const rawGroup = bodyPayload.targetGroupId;
      const isGroupAllRequested =
        rawGroup === null ||
        rawGroup === '' ||
        (typeof rawGroup === 'string' && rawGroup.trim().toUpperCase() === 'ALL');

      const rawUnit = bodyPayload.targetUnitId;
      const isUnitAllRequested =
        rawUnit === null ||
        rawUnit === '' ||
        (typeof rawUnit === 'string' && rawUnit.trim().toUpperCase() === 'ALL');

      let resolvedGroupId: number | null = null;
      let resolvedGroupName = '';
      let resolvedUnitId: number | null = null;
      let resolvedUnitName = '';

      if (!isAdmin) {
        // Regra 02: Usuários NÃO administradores enviam exclusivamente para o próprio grupo e unidade autorizada.
        if (!authUser.groupId) {
          return res.status(403).json({
            error:
              'Seu usuário não está vinculado a nenhum grupo de usuários. Apenas usuários com grupo ou administradores podem enviar mensagens.',
          });
        }

        if (isGroupAllRequested) {
          return res.status(403).json({
            error:
              'Permissão negada: apenas administradores podem enviar mensagens para todos os grupos da empresa.',
          });
        }

        if (rawGroup !== undefined) {
          const parsedGroupId = Number(rawGroup);
          if (!Number.isSafeInteger(parsedGroupId) || parsedGroupId !== authUser.groupId) {
            return res.status(403).json({
              error:
                'Permissão negada: usuários podem enviar mensagens exclusivamente para o seu próprio grupo de usuários.',
            });
          }
        }

        resolvedGroupId = authUser.groupId;

        if (isUnitAllRequested) {
          return res.status(403).json({
            error:
              'Permissão negada: apenas administradores podem enviar mensagens para todas as unidades da empresa.',
          });
        }

        const candidateUnitId =
          rawUnit !== undefined
            ? Number(rawUnit)
            : Number(req.activeUnitId || authUser.defaultUnitId || 0);
        if (!Number.isSafeInteger(candidateUnitId) || candidateUnitId <= 0 || !isUnitPermitted(req, candidateUnitId)) {
          return res.status(403).json({
            error: 'Permissão negada: unidade de destino não autorizada para seu usuário.',
          });
        }
        resolvedUnitId = candidateUnitId;
      } else {
        // Administrador pode enviar para todos os grupos e todas as unidades, ou escolher grupo/unidade específicos
        if (rawGroup === undefined || isGroupAllRequested) {
          resolvedGroupId = null;
          resolvedGroupName = 'Todos os Grupos da Empresa';
        } else {
          const parsedGroupId = Number(rawGroup);
          if (!Number.isSafeInteger(parsedGroupId) || parsedGroupId <= 0) {
            return res.status(400).json({ error: 'Grupo de usuários inválido.' });
          }
          resolvedGroupId = parsedGroupId;
        }

        if (rawUnit === undefined || isUnitAllRequested) {
          resolvedUnitId = null;
          resolvedUnitName = 'Todas as Unidades da Empresa';
        } else {
          const parsedUnitId = Number(rawUnit);
          if (!Number.isSafeInteger(parsedUnitId) || parsedUnitId <= 0) {
            return res.status(400).json({ error: 'Unidade de destino inválida.' });
          }
          resolvedUnitId = parsedUnitId;
        }
      }

      if (resolvedGroupId !== null) {
        const [grp] = await db
          .select()
          .from(userGroups)
          .where(eq(userGroups.id, resolvedGroupId))
          .limit(1);
        if (!grp) {
          return res.status(404).json({ error: 'Grupo de usuários destinatário não encontrado.' });
        }
        resolvedGroupName = grp.name;
      }

      if (resolvedUnitId !== null) {
        const [unitRow] = await db
          .select()
          .from(units)
          .where(eq(units.id, resolvedUnitId))
          .limit(1);
        if (!unitRow) {
          return res.status(404).json({ error: 'Unidade destinatária não encontrada.' });
        }
        resolvedUnitName = `${unitRow.code} · ${unitRow.name}`;
      }

      let resolvedRecipientId: number | null = null;
      if (
        bodyPayload.recipientId !== undefined &&
        bodyPayload.recipientId !== null &&
        String(bodyPayload.recipientId).trim() !== ''
      ) {
        const parsedRecipientId = Number(bodyPayload.recipientId);
        if (!Number.isSafeInteger(parsedRecipientId) || parsedRecipientId <= 0) {
          return res.status(400).json({ error: 'Destinatário inválido.' });
        }
        const [recUser] = await db
          .select()
          .from(users)
          .where(eq(users.id, parsedRecipientId))
          .limit(1);
        if (!recUser || !recUser.active) {
          return res.status(404).json({ error: 'Usuário destinatário não encontrado ou inativo.' });
        }
        if (!isAdmin && recUser.groupId !== authUser.groupId) {
          return res.status(403).json({
            error:
              'Permissão negada: usuários não administradores só podem direcionar mensagens a membros do próprio grupo.',
          });
        }
        resolvedRecipientId = recUser.id;
      }

      const [created] = await db
        .insert(internalMessages)
        .values({
          senderId: authUser.id,
          senderName: authUser.name,
          senderGroupId: authUser.groupId,
          recipientId: resolvedRecipientId,
          targetSector: sectorKey,
          targetGroupId: resolvedGroupId,
          targetGroupName: resolvedGroupName,
          targetUnitId: resolvedUnitId,
          targetUnitName: resolvedUnitName,
          isAutoIvi: false,
          eventType: 'manual_message',
          relatedEntityType: '',
          relatedEntityId: '',
          subject,
          body,
          readByUserIds: [],
        })
        .returning();

      await db.insert(auditLogs).values({
        userId: authUser.id,
        userName: authUser.name,
        action: 'INTERNAL_MESSAGE_SENT',
        entityType: 'internal_message',
        entityId: String(created.id),
        details: {
          targetSector: sectorKey,
          targetGroupId: resolvedGroupId,
          targetGroupName: resolvedGroupName,
          targetUnitId: resolvedUnitId,
          targetUnitName: resolvedUnitName,
          recipientId: resolvedRecipientId,
          subject,
        },
        unitId: resolvedUnitId || req.activeUnitId || authUser.defaultUnitId || null,
      });

      deps.broadcast('internal:message', {
        ...created,
        sector: sectorKey,
        sectorLabel: sectorMeta.label,
      });

      res.json({
        message: {
          ...created,
          sectorLabel: sectorMeta.label,
          targetModuleId: sectorMeta.defaultModuleId,
        },
      });
    } catch (error) {
      console.error('POST /api/internal-messages error:', error);
      res.status(500).json({ error: sanitizeError(error, 'Erro ao enviar mensagem interna.') });
    }
  };

  app.post('/api/internal-messages', requireAuth, handleSendInternalMessage);
  app.post('/api/messages', requireAuth, handleSendInternalMessage);

  app.post('/api/internal-messages/mark-read', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      const authUser = req.authUser!;
      const { messageIds, sector, markAll } = (req.body || {}) as {
        messageIds?: number[];
        sector?: string;
        markAll?: boolean;
      };

      const targetSectorKey = sector ? normalizeSectorKey(sector) : null;
      const rows =
        Array.isArray(messageIds) && messageIds.length > 0
          ? await db
              .select()
              .from(internalMessages)
              .where(inArray(internalMessages.id, messageIds.map((id) => Number(id)).filter((n) => Number.isSafeInteger(n) && n > 0)))
          : await db.select().from(internalMessages).orderBy(desc(internalMessages.id)).limit(300);

      const visible = rows.filter((m) => isMessageVisibleToUser(m, authUser));
      const toMark = visible.filter((m) => {
        const readList = Array.isArray(m.readByUserIds) ? m.readByUserIds : [];
        if (readList.includes(authUser.id)) return false;
        if (Array.isArray(messageIds) && messageIds.length > 0) return true;
        if (markAll) return true;
        if (targetSectorKey) {
          return normalizeSectorKey(m.targetSector, m.subject) === targetSectorKey;
        }
        return false;
      });

      let updatedCount = 0;
      const now = new Date();
      for (const m of toMark) {
        const nextReaders = Array.from(
          new Set([...(Array.isArray(m.readByUserIds) ? m.readByUserIds : []), authUser.id])
        );
        await db
          .update(internalMessages)
          .set({
            readByUserIds: nextReaders,
            readAt: m.readAt || now,
          })
          .where(eq(internalMessages.id, m.id));
        updatedCount += 1;
      }

      if (updatedCount > 0) {
        deps.broadcast('internal:message:read', {
          userId: authUser.id,
          sector: targetSectorKey,
          updatedCount,
        });
      }

      res.json({ ok: true, updatedCount });
    } catch (error) {
      console.error('POST /api/internal-messages/mark-read error:', error);
      res.status(500).json({ error: sanitizeError(error, 'Erro ao marcar mensagens como lidas.') });
    }
  });
}
