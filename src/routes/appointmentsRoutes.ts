import type { Express } from 'express';
import { and, asc, desc, eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import {
  appointments,
  auditLogs,
  clients,
  collaborators,
  rolesCatalog,
  scheduleBlocks,
  scheduleServices,
  scheduleWaitlist,
  systemSettings,
  units,
  userGroups,
  users,
  whatsappMessages,
  whatsappThreads,
} from '../db/schema.ts';
import { ensureCommonCadastrosSeed, ensureInitialSeed } from '../db/seed.ts';
import { AuthRequest, getAllowedUnitIds, isUnitPermitted, requireAuth, requireModule } from '../middleware/auth.ts';
import { parsePositiveIntId, sanitizeErrorMessage } from '../utils/validation.ts';
import { normalizePhone, phonesMatchBR, sendGotalkMessage } from '../services/gotalk.ts';
import { dispatchIviSectorNotification } from '../services/internalMessaging.ts';
import { sendUazapiText, UazapiCredentials } from '../services/uazapi.ts';
import type { ScheduleConfig, ScheduleStatusColors } from '../types.ts';

const DEFAULT_STATUS_COLORS: ScheduleStatusColors = {
  aguardando: '#fbbf24',
  agendado: '#3b82f6',
  confirmado: '#10b981',
  cancelado_cliente: '#ef4444',
  cancelado_consultor: '#9ca3af',
  nao_compareceu: '#7f1d1d',
};

const DEFAULT_SCHEDULE_CONFIG: ScheduleConfig = {
  startTime: '08:00',
  endTime: '19:00',
  slotIntervalMinutes: 30,
  statusColors: DEFAULT_STATUS_COLORS,
};

function toDateKey(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function toTimeKey(d: Date): string {
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mi}`;
}

function timeToMinutes(hhmm: string): number {
  const [h, m] = (hhmm || '00:00').split(':').map((x) => Number(x) || 0);
  return h * 60 + m;
}

async function getScheduleConfig(): Promise<ScheduleConfig> {
  const rows = await db
    .select()
    .from(systemSettings)
    .where(eq(systemSettings.key, 'schedule_config'))
    .limit(1);
  const raw = (rows[0]?.value || {}) as Partial<ScheduleConfig>;
  const interval = Number(raw.slotIntervalMinutes || 30);
  const validInterval = ([15, 30, 45, 60].includes(interval) ? interval : 30) as 15 | 30 | 45 | 60;
  return {
    startTime: typeof raw.startTime === 'string' && raw.startTime ? raw.startTime : DEFAULT_SCHEDULE_CONFIG.startTime,
    endTime: typeof raw.endTime === 'string' && raw.endTime ? raw.endTime : DEFAULT_SCHEDULE_CONFIG.endTime,
    slotIntervalMinutes: validInterval,
    statusColors: {
      ...DEFAULT_STATUS_COLORS,
      ...(raw.statusColors || {}),
    },
  };
}

async function getRotationState(): Promise<Record<string, number[]>> {
  const rows = await db
    .select()
    .from(systemSettings)
    .where(eq(systemSettings.key, 'schedule_rotation_state'))
    .limit(1);
  const val = (rows[0]?.value || {}) as { queues?: Record<string, number[]> };
  return val.queues && typeof val.queues === 'object' ? val.queues : {};
}

async function saveRotationState(queues: Record<string, number[]>, executor: typeof db = db) {
  await executor
    .insert(systemSettings)
    .values({
      key: 'schedule_rotation_state',
      value: { queues },
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: systemSettings.key,
      set: {
        value: { queues },
        updatedAt: new Date(),
      },
    });
}

function computeUnitQueues(
  allUnits: Array<{ id: number }>,
  eligibleCollabs: Array<{ id: number; unitId: number }>,
  savedQueues: Record<string, number[]>
): Record<string, number[]> {
  const result: Record<string, number[]> = {};
  for (const u of allUnits) {
    const key = String(u.id);
    const unitCollabIds = eligibleCollabs.filter((c) => c.unitId === u.id).map((c) => c.id);
    const saved = Array.isArray(savedQueues[key]) ? savedQueues[key].map(Number) : [];
    const ordered: number[] = [];
    for (const id of saved) {
      if (unitCollabIds.includes(id) && !ordered.includes(id)) {
        ordered.push(id);
      }
    }
    for (const id of unitCollabIds) {
      if (!ordered.includes(id)) {
        ordered.push(id);
      }
    }
    result[key] = ordered;
  }
  return result;
}

async function logScheduleAudit(
  req: AuthRequest,
  action: string,
  entityType: string,
  entityId: string | number,
  details: Record<string, unknown>,
  unitId?: number | null,
  executor: typeof db = db
) {
  await executor.insert(auditLogs).values({
    userId: req.authUser?.id ?? null,
    userName: req.authUser?.name || 'Sistema',
    action,
    entityType,
    entityId: String(entityId),
    details,
    unitId: unitId ?? req.activeUnitId ?? 1,
  });
}

export function registerAppointmentsRoutes(
  app: Express,
  deps: {
    broadcast: (event: string, payload: unknown) => void;
    resolveUazapiCredentials: (opts?: {
      instanceId?: string | null;
      unitId?: number | null;
      groupId?: number | null;
      moduleId?: string | null;
    }) => Promise<(UazapiCredentials & { dbId?: number }) | null>;
  }
) {
  // ---------------------------------------------------------------------------
  // 1. BOOTSTRAP COMPLETO DA AGENDA
  // ---------------------------------------------------------------------------
  app.get('/api/appointments/bootstrap', requireAuth, requireModule('appointments'), async (req: AuthRequest, res) => {
    try {
      await ensureInitialSeed();
      await ensureCommonCadastrosSeed();

      const [
        allUnits,
        allGroups,
        allRoles,
        allCollabs,
        allUsers,
        allServices,
        allAppts,
        allBlocks,
        allWaitlist,
        allClients,
        config,
        savedQueues,
      ] = await Promise.all([
        db.select().from(units).orderBy(asc(units.id)),
        db.select().from(userGroups).orderBy(asc(userGroups.id)),
        db.select().from(rolesCatalog).orderBy(asc(rolesCatalog.sortOrder), asc(rolesCatalog.name)),
        db.select().from(collaborators).orderBy(asc(collaborators.name)),
        db.select({ id: users.id, name: users.name, groupId: users.groupId, defaultUnitId: users.defaultUnitId }).from(users),
        db.select().from(scheduleServices).orderBy(asc(scheduleServices.name)),
        db.select().from(appointments).orderBy(asc(appointments.scheduledFor)),
        db.select().from(scheduleBlocks).orderBy(desc(scheduleBlocks.startAt)),
        db.select().from(scheduleWaitlist).orderBy(asc(scheduleWaitlist.desiredDate), asc(scheduleWaitlist.desiredTime)),
        db.select({
          id: clients.id,
          fullName: clients.fullName,
          cpfCnpj: clients.cpfCnpj,
          phone: clients.phone,
          whatsapp: clients.whatsapp,
          address: clients.address,
          addressNumber: clients.addressNumber,
          neighborhood: clients.neighborhood,
          city: clients.city,
          state: clients.state,
        }).from(clients),
        getScheduleConfig(),
        getRotationState(),
      ]);

      const isAdmin = req.authUser!.role === 'admin';
      const allowedUnitSet = new Set(
        isAdmin
          ? allUnits.map((u) => u.id)
          : (req.authUser!.allowedUnitIds && req.authUser!.allowedUnitIds.length > 0
              ? req.authUser!.allowedUnitIds
              : [req.authUser!.defaultUnitId || 1])
      );

      const visibleUnits = allUnits.filter((u) => allowedUnitSet.has(u.id));
      const visibleGroups = isAdmin
        ? allGroups
        : allGroups.filter((g) => g.id === req.authUser!.groupId);

      const roleMap = new Map(allRoles.map((r) => [r.id, r]));
      const roleByName = new Map(allRoles.map((r) => [r.name.toLowerCase(), r]));
      const userMap = new Map(allUsers.map((u) => [u.id, u]));
      const clientMap = new Map(allClients.map((c) => [c.id, c]));
      const serviceMap = new Map(allServices.map((s) => [s.id, s]));

      const enrichedCollabs = allCollabs.map((c) => {
        const linkedRole =
          (c.roleId ? roleMap.get(c.roleId) : undefined) ||
          roleByName.get((c.jobTitle || '').trim().toLowerCase());
        const linkedUser = c.userId ? userMap.get(c.userId) : undefined;
        const participates = Boolean(c.participatesInScheduleQueue);
        return {
          id: c.id,
          name: c.name,
          active: c.active,
          unitId: c.unitId,
          roleId: c.roleId,
          jobTitle: linkedRole?.name || c.jobTitle || 'Colaborador',
          userId: c.userId,
          groupId: linkedUser?.groupId ?? null,
          photoUrl: c.photoUrl || '',
          participatesInScheduleQueue: participates,
        };
      });

      const eligibleCollabs = enrichedCollabs.filter((c) => c.active && c.participatesInScheduleQueue);
      const rotationQueues = computeUnitQueues(allUnits, eligibleCollabs, savedQueues);

      const collabById = new Map(enrichedCollabs.map((c) => [c.id, c]));
      const collabByUserId = new Map(
        enrichedCollabs.filter((c) => c.userId).map((c) => [c.userId as number, c])
      );

      const collabsWithQueueMeta = enrichedCollabs.map((c) => {
        const uQueue = rotationQueues[String(c.unitId)] || [];
        const idx = uQueue.indexOf(c.id);
        return {
          ...c,
          queuePosition: idx >= 0 ? idx + 1 : null,
          isNextInQueue: idx === 0,
        };
      });

      const visibleAppts = allAppts
        .filter((a) => allowedUnitSet.has(a.unitId))
        .map((a) => {
          const cl = a.clientId ? clientMap.get(a.clientId) : undefined;
          const colab =
            (a.collaboratorId ? collabById.get(a.collaboratorId) : undefined) ||
            collabByUserId.get(a.consultantId);
          const srv = a.serviceId ? serviceMap.get(a.serviceId) : undefined;
          const startDate = new Date(a.scheduledFor);
          const defaultDur = srv?.durationMinutes || 30;
          const computedEnd = a.endAt
            ? new Date(a.endAt)
            : new Date(startDate.getTime() + defaultDur * 60000);
          const formattedAddr = cl
            ? [cl.address, cl.addressNumber, cl.neighborhood, cl.city && cl.state ? `${cl.city}/${cl.state}` : cl.city]
                .filter(Boolean)
                .join(', ')
            : '';

          return {
            ...a,
            collaboratorId: colab?.id ?? a.collaboratorId ?? null,
            collaboratorName: colab?.name || userMap.get(a.consultantId)?.name || 'Consultor',
            groupId: a.groupId ?? colab?.groupId ?? null,
            serviceId: a.serviceId ?? srv?.id ?? null,
            serviceName: a.serviceName || srv?.name || 'Atendimento Geral',
            clientPhone: cl?.whatsapp || cl?.phone || a.clientPhone,
            clientAddress: formattedAddr,
            clientDocument: cl?.cpfCnpj || '',
            endAt: computedEnd.toISOString(),
          };
        });

      const visibleBlocks = allBlocks
        .filter((b) => allowedUnitSet.has(b.unitId))
        .map((b) => {
          const colab =
            (b.collaboratorId ? collabById.get(b.collaboratorId) : undefined) ||
            (b.consultantId ? collabByUserId.get(b.consultantId) : undefined);
          return {
            ...b,
            collaboratorId: colab?.id ?? b.collaboratorId ?? null,
            collaboratorName:
              colab?.name || (b.consultantId ? userMap.get(b.consultantId)?.name : '') || 'Colaborador',
          };
        });

      const visibleWaitlist = allWaitlist
        .filter((w) => allowedUnitSet.has(w.unitId))
        .map((w) => {
          const cl = clientMap.get(w.clientId);
          const srv = serviceMap.get(w.serviceId);
          const prefColab = w.preferredCollaboratorId
            ? collabById.get(w.preferredCollaboratorId)
            : undefined;
          return {
            ...w,
            clientName: cl?.fullName || `Cliente #${w.clientId}`,
            clientPhone: cl?.whatsapp || cl?.phone || '',
            clientDocument: cl?.cpfCnpj || '',
            serviceName: srv?.name || 'Serviço',
            serviceDurationMinutes: srv?.durationMinutes || 30,
            preferredCollaboratorName: prefColab?.name || '',
          };
        });

      res.json({
        units: visibleUnits,
        groups: visibleGroups,
        collaborators: collabsWithQueueMeta,
        services: allServices,
        appointments: visibleAppts,
        blocks: visibleBlocks,
        waitlist: visibleWaitlist,
        config,
        rotationQueues,
        lastUpdatedAt: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Appointments bootstrap error:', error);
      res.status(500).json({ error: 'Erro ao carregar rotina de Agendamentos.' });
    }
  });

  // ---------------------------------------------------------------------------
  // 2. BUSCA DE CLIENTES & HISTÓRICO DE AGENDAMENTOS DO CLIENTE
  // ---------------------------------------------------------------------------
  app.get('/api/appointments/clients-search', requireAuth, async (req: AuthRequest, res) => {
    try {
      const q = String(req.query.q || '').trim().toLowerCase();
      const allowedUnits = getAllowedUnitIds(req);
      const allClients = await db
        .select({
          id: clients.id,
          fullName: clients.fullName,
          cpfCnpj: clients.cpfCnpj,
          phone: clients.phone,
          whatsapp: clients.whatsapp,
          secondaryPhone: clients.secondaryPhone,
          email: clients.email,
          unitId: clients.unitId,
          status: clients.status,
        })
        .from(clients)
        .orderBy(asc(clients.fullName));

      const qDigits = q.replace(/\D/g, '');
      const matched = allClients
        .filter((c) => {
          if (allowedUnits && !allowedUnits.includes(c.unitId)) return false;
          if (!q) return true;
          if (c.fullName.toLowerCase().includes(q)) return true;
          if (c.email.toLowerCase().includes(q)) return true;
          if (c.cpfCnpj.toLowerCase().includes(q)) return true;
          if (qDigits && (
            c.cpfCnpj.replace(/\D/g, '').includes(qDigits) ||
            c.phone.replace(/\D/g, '').includes(qDigits) ||
            c.whatsapp.replace(/\D/g, '').includes(qDigits) ||
            c.secondaryPhone.replace(/\D/g, '').includes(qDigits)
          )) {
            return true;
          }
          return false;
        })
        .slice(0, 12);

      res.json({ clients: matched });
    } catch (error) {
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao buscar clientes.') });
    }
  });

  app.get('/api/appointments/client-history/:clientId', requireAuth, async (req: AuthRequest, res) => {
    try {
      const clientId = parsePositiveIntId(req.params.clientId);
      if (!clientId) return res.status(400).json({ error: 'ID do cliente inválido.' });
      const [clientRow] = await db.select().from(clients).where(eq(clients.id, clientId)).limit(1);
      if (!clientRow) return res.status(404).json({ error: 'Cliente não encontrado.' });
      if (!isUnitPermitted(req, clientRow.unitId)) {
        return res.status(403).json({ error: 'Unidade não autorizada para consultar histórico deste cliente.' });
      }

      const [rows, allCollabs, allServices] = await Promise.all([
        db.select().from(appointments).where(eq(appointments.clientId, clientId)),
        db.select({ id: collaborators.id, name: collaborators.name, userId: collaborators.userId }).from(collaborators),
        db.select().from(scheduleServices),
      ]);

      const allowedUnits = getAllowedUnitIds(req);
      const visibleRows = allowedUnits ? rows.filter((r) => allowedUnits.includes(r.unitId)) : rows;

      const collabById = new Map(allCollabs.map((c) => [c.id, c.name]));
      const collabByUserId = new Map(
        allCollabs.filter((c) => c.userId).map((c) => [c.userId as number, c.name])
      );
      const srvMap = new Map(allServices.map((s) => [s.id, s.name]));
      const nowMs = Date.now();

      const enriched = visibleRows.map((r) => ({
        id: r.id,
        scheduledFor: r.scheduledFor,
        endAt: r.endAt,
        status: r.status,
        modality: r.modality,
        serviceName: r.serviceName || (r.serviceId ? srvMap.get(r.serviceId) : '') || 'Atendimento',
        collaboratorName:
          (r.collaboratorId ? collabById.get(r.collaboratorId) : '') ||
          collabByUserId.get(r.consultantId) ||
          'Consultor',
        unitId: r.unitId,
      }));

      // Futuros primeiro (ordem crescente), depois passados (ordem decrescente)
      const futures = enriched
        .filter((x) => new Date(x.scheduledFor).getTime() >= nowMs)
        .sort((a, b) => new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime());
      const pasts = enriched
        .filter((x) => new Date(x.scheduledFor).getTime() < nowMs)
        .sort((a, b) => new Date(b.scheduledFor).getTime() - new Date(a.scheduledFor).getTime());

      res.json({ total: enriched.length, items: [...futures, ...pasts] });
    } catch (error) {
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao consultar histórico do cliente.') });
    }
  });

  // ---------------------------------------------------------------------------
  // HELPER DE VERIFICAÇÃO DE BLOQUEIO & NOTIFICAÇÃO WHATSAPP
  // ---------------------------------------------------------------------------
  async function checkCollaboratorBlock(params: {
    collaboratorId: number | null;
    consultantId: number | null;
    startAt: Date;
    endAt: Date;
  }): Promise<{ blocked: boolean; reason?: string }> {
    const blocks = await db.select().from(scheduleBlocks);
    const targetDateKey = toDateKey(params.startAt);
    const weekday = params.startAt.getDay();
    const reqStartMin = timeToMinutes(toTimeKey(params.startAt));
    const reqEndMin = Math.max(reqStartMin + 1, timeToMinutes(toTimeKey(params.endAt)));

    for (const blk of blocks) {
      const sameColab =
        (params.collaboratorId && blk.collaboratorId === params.collaboratorId) ||
        (params.consultantId && blk.consultantId === params.consultantId);
      if (!sameColab) continue;

      const blkStartKey = toDateKey(new Date(blk.startAt));
      const blkEndKey = toDateKey(new Date(blk.endAt));
      if (targetDateKey < blkStartKey || targetDateKey > blkEndKey) continue;

      const days = Array.isArray(blk.weekdays) && blk.weekdays.length > 0 ? blk.weekdays : [0, 1, 2, 3, 4, 5, 6];
      if (!days.includes(weekday)) continue;

      if (blk.allDay !== false) {
        return { blocked: true, reason: blk.reason };
      }

      const blkStartMin = timeToMinutes(blk.startTime || toTimeKey(new Date(blk.startAt)));
      const blkEndMin = timeToMinutes(blk.endTime || toTimeKey(new Date(blk.endAt)));
      if (reqStartMin < blkEndMin && reqEndMin > blkStartMin) {
        return { blocked: true, reason: blk.reason };
      }
    }
    return { blocked: false };
  }

  async function sendConfirmationWhatsapp(opts: {
    req: AuthRequest;
    clientId: number | null;
    clientName: string;
    clientPhone: string;
    unitId: number;
    serviceName: string;
    collaboratorName: string;
    scheduledFor: Date;
    modality: string;
  }): Promise<{ attempted: boolean; ok: boolean; detail: string }> {
    const phone = normalizePhone(opts.clientPhone || '');
    if (!phone) {
      return { attempted: false, ok: false, detail: 'Cliente sem telefone cadastrado para envio.' };
    }

    const whenStr = opts.scheduledFor.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    const modStr =
      opts.modality === 'presencial'
        ? 'Presencial'
        : opts.modality === 'online'
        ? 'OnLine'
        : opts.modality || 'Atendimento';

    const messageText = `Olá ${opts.clientName}! Seu agendamento (${opts.serviceName} · ${modStr}) com ${opts.collaboratorName} está CONFIRMADO para ${whenStr}. Qualquer imprevisto, responda por aqui.`;

    let delivered = false;
    let providerUsed: 'uazapi' | 'gotalk' = 'uazapi';
    let detail = '';

    try {
      const creds = await deps.resolveUazapiCredentials({
        unitId: opts.unitId,
        groupId: opts.req.authUser?.groupId ?? null,
        moduleId: 'appointments',
      });
      if (creds) {
        const res = await sendUazapiText(creds, phone, messageText);
        if (res.dispatched) {
          delivered = true;
          providerUsed = 'uazapi';
          detail = 'Confirmação enviada automaticamente via WhatsApp (UaZapi).';
        } else {
          detail = res.detail || 'Falha UaZapi';
        }
      }

      if (!delivered) {
        const gt = await sendGotalkMessage(phone, messageText, { contactName: opts.clientName });
        if (gt.dispatched) {
          delivered = true;
          providerUsed = 'gotalk';
          detail = 'Confirmação enviada automaticamente via WhatsApp (GoTalk).';
        } else if (!detail) {
          detail = gt.detail || 'Nenhum canal WhatsApp conectado no momento.';
        }
      }

      // Register in internal WhatsApp history thread
      const threads = await db.select().from(whatsappThreads);
      let thread = threads.find((t) => phonesMatchBR(t.contactPhone, phone));
      if (!thread) {
        const [createdTh] = await db
          .insert(whatsappThreads)
          .values({
            clientId: opts.clientId,
            unitId: opts.unitId,
            contactName: opts.clientName,
            contactPhone: phone,
            provider: providerUsed,
            lastMessagePreview: messageText.slice(0, 120),
            updatedAt: new Date(),
          })
          .returning();
        thread = createdTh;
      } else {
        await db
          .update(whatsappThreads)
          .set({ lastMessagePreview: messageText.slice(0, 120), updatedAt: new Date() })
          .where(eq(whatsappThreads.id, thread.id));
      }

      await db.insert(whatsappMessages).values({
        threadId: thread.id,
        direction: 'outbound',
        contentType: 'text',
        body: messageText,
        ackStatus: delivered ? 1 : 0,
        operatorName: opts.req.authUser?.name || 'Agenda FinancePro',
        department: 'Agendamentos',
        senderName: opts.req.authUser?.name || 'Agenda FinancePro',
      });

      return {
        attempted: true,
        ok: delivered,
        detail: delivered ? detail : `Registrado no histórico local; envio externo pendente (${detail}).`,
      };
    } catch (err) {
      return {
        attempted: true,
        ok: false,
        detail: err instanceof Error ? err.message : 'Erro ao disparar confirmação WhatsApp.',
      };
    }
  }

  // ---------------------------------------------------------------------------
  // 3. CRIAR & EDITAR AGENDAMENTO (COM BLOQUEIO, RODÍZIO & WHATSAPP CONFIRMADO)
  // ---------------------------------------------------------------------------
  app.post('/api/appointments', requireAuth, requireModule('appointments'), async (req: AuthRequest, res) => {
    try {
      const body = (req.body || {}) as {
        clientId?: number;
        serviceId?: number;
        collaboratorId?: number | null;
        unitId?: number;
        groupId?: number | null;
        date?: string; // YYYY-MM-DD
        startTime?: string; // HH:mm
        endTime?: string; // HH:mm
        modality?: string; // '' | 'presencial' | 'online'
        status?: string;
        notes?: string;
        waitlistId?: number | null;
        useQueueRotation?: boolean;
      };

      const parsedClientId = parsePositiveIntId(body.clientId);
      const parsedServiceId = parsePositiveIntId(body.serviceId);
      if (!parsedClientId) {
        return res.status(400).json({ error: 'Selecione um cliente cadastrado antes de salvar.' });
      }
      if (!parsedServiceId) {
        return res.status(400).json({ error: 'Selecione um serviço antes de salvar.' });
      }
      if (!body.date || !body.startTime) {
        return res.status(400).json({ error: 'Data e horário inicial são obrigatórios.' });
      }

      const [clientRows, serviceRows, allCollabs, allUnits, allUsers, savedQueues] =
        await Promise.all([
          db.select().from(clients).where(eq(clients.id, parsedClientId)).limit(1),
          db.select().from(scheduleServices).where(eq(scheduleServices.id, parsedServiceId)).limit(1),
          db.select().from(collaborators).orderBy(asc(collaborators.name)),
          db.select().from(units),
          db.select({ id: users.id, groupId: users.groupId }).from(users),
          getRotationState(),
        ]);

      const client = clientRows[0];
      const service = serviceRows[0];
      if (!client) return res.status(404).json({ error: 'Cliente não encontrado.' });
      if (!service) return res.status(404).json({ error: 'Serviço não encontrado.' });

      const targetUnitId = body.unitId ? parsePositiveIntId(body.unitId) : (client.unitId || req.activeUnitId || 1);
      if (!targetUnitId) return res.status(400).json({ error: 'Unidade inválida.' });
      if (!isUnitPermitted(req, targetUnitId)) {
        return res.status(403).json({ error: 'Unidade não autorizada para agendamento.' });
      }
      const startAt = new Date(`${body.date}T${body.startTime}:00`);
      const endAt = body.endTime
        ? new Date(`${body.date}T${body.endTime}:00`)
        : new Date(startAt.getTime() + (service.durationMinutes || 30) * 60000);

      if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
        return res.status(400).json({ error: 'Data ou horário inválido.' });
      }
      if (endAt.getTime() <= startAt.getTime()) {
        return res.status(400).json({ error: 'Horário final deve ser posterior ao horário inicial.' });
      }

      const eligibleCollabs = allCollabs.filter(
        (c) => c.active && Boolean(c.participatesInScheduleQueue)
      );

      const queues = computeUnitQueues(allUnits, eligibleCollabs, savedQueues);
      const unitQueue = queues[String(targetUnitId)] || [];

      let chosenCollabId = body.collaboratorId ? Number(body.collaboratorId) : null;
      if (!chosenCollabId) {
        // Pick first unblocked from unit queue, then any eligible collaborator in unit
        for (const qId of unitQueue) {
          const cand = allCollabs.find((c) => c.id === qId);
          if (!cand) continue;
          const blk = await checkCollaboratorBlock({
            collaboratorId: cand.id,
            consultantId: cand.userId ?? null,
            startAt,
            endAt,
          });
          if (!blk.blocked) {
            chosenCollabId = cand.id;
            break;
          }
        }
        if (!chosenCollabId) {
          const fallback =
            eligibleCollabs.find((c) => c.unitId === targetUnitId) ||
            eligibleCollabs[0] ||
            allCollabs.find((c) => c.active && c.unitId === targetUnitId) ||
            allCollabs[0];
          chosenCollabId = fallback?.id ?? null;
        }
      }

      const chosenCollab = chosenCollabId
        ? allCollabs.find((c) => c.id === chosenCollabId) || null
        : null;

      // Validate schedule block
      const blockCheck = await checkCollaboratorBlock({
        collaboratorId: chosenCollab?.id ?? null,
        consultantId: chosenCollab?.userId ?? null,
        startAt,
        endAt,
      });
      if (blockCheck.blocked) {
        return res.status(409).json({
          error: `Horário bloqueado para ${chosenCollab?.name || 'este consultor'}: ${blockCheck.reason || 'Agenda indisponível'}`,
        });
      }

      const linkedUser = chosenCollab?.userId
        ? allUsers.find((u) => u.id === chosenCollab.userId)
        : undefined;
      const consultantUserId = chosenCollab?.userId || req.authUser!.id;
      const resolvedGroupId = body.groupId ?? linkedUser?.groupId ?? req.authUser!.groupId ?? null;
      const finalStatus = body.status || 'agendado';

      const created = await db.transaction(async (tx) => {
        const [ins] = await tx
          .insert(appointments)
          .values({
            clientId: client.id,
            clientName: client.fullName,
            clientPhone: client.whatsapp || client.phone || '',
            unitId: targetUnitId,
            groupId: resolvedGroupId,
            attendantId: req.authUser!.id,
            consultantId: consultantUserId,
            collaboratorId: chosenCollab?.id ?? null,
            serviceId: service.id,
            serviceName: service.name,
            modality: body.modality || '',
            scheduledFor: startAt,
            endAt,
            status: finalStatus,
            notifiedInternal: true,
            notifiedWhatsapp: finalStatus === 'confirmado',
            notes: String(body.notes || '').trim(),
            createdByName: req.authUser!.name,
            updatedByName: req.authUser!.name,
            updatedAt: new Date(),
          })
          .returning();

        // Rotate unit queue if chosen collaborator was the next in queue
        if (chosenCollab && unitQueue[0] === chosenCollab.id && unitQueue.length > 1) {
          const rotated = [...unitQueue.slice(1), unitQueue[0]];
          queues[String(targetUnitId)] = rotated;
          await saveRotationState(queues, tx as unknown as typeof db);
        } else if (body.useQueueRotation && chosenCollab && unitQueue.includes(chosenCollab.id) && unitQueue.length > 1) {
          const rotated = [...unitQueue.filter((id) => id !== chosenCollab.id), chosenCollab.id];
          queues[String(targetUnitId)] = rotated;
          await saveRotationState(queues, tx as unknown as typeof db);
        }

        // Remove waitlist entry ONLY after appointment is saved successfully
        if (body.waitlistId) {
          const wlId = parsePositiveIntId(body.waitlistId);
          if (wlId) {
            await tx.delete(scheduleWaitlist).where(eq(scheduleWaitlist.id, wlId));
          }
        }

        const agendaMsg = await dispatchIviSectorNotification(
          {
            targetSector: 'agendamentos',
            targetUnitId: targetUnitId,
            recipientId: chosenCollab?.userId ?? null,
            relatedEntityType: 'appointment',
            relatedEntityId: ins.id,
            senderName: 'Ivi IA · Agendamentos',
            subject: `Novo Agendamento (${service.name}) · ${client.fullName}`,
            body: `Compromisso marcado para ${startAt.toLocaleString('pt-BR')} (${body.modality || 'Sem modalidade'}) com ${chosenCollab?.name || 'consultor'}. Registrado por ${req.authUser!.name}.`,
          },
          tx
        );

        return { ins, agendaMsg };
      });

      deps.broadcast('internal:message', created.agendaMsg);

      let whatsappNotification: { attempted: boolean; ok: boolean; detail: string } | null = null;
      if (finalStatus === 'confirmado') {
        whatsappNotification = await sendConfirmationWhatsapp({
          req,
          clientId: client.id,
          clientName: client.fullName,
          clientPhone: client.whatsapp || client.phone || '',
          unitId: targetUnitId,
          serviceName: service.name,
          collaboratorName: chosenCollab?.name || 'Consultor',
          scheduledFor: startAt,
          modality: body.modality || '',
        });
      }

      deps.broadcast('appointments:update', { appointmentId: created.ins.id, unitId: targetUnitId });
      res.status(201).json({ ok: true, appointment: created.ins, whatsappNotification });
    } catch (error) {
      console.error('Create appointment error:', error);
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao criar agendamento.') });
    }
  });

  // ---------------------------------------------------------------------------
  // CONFIGURAÇÕES DA AGENDA (REGISTRADA ANTES DE /:id PARA NÃO CAPTURAR 'config')
  // ---------------------------------------------------------------------------
  app.put('/api/appointments/config', requireAuth, requireModule('appointments'), async (req: AuthRequest, res) => {
    try {
      const body = (req.body || {}) as Partial<ScheduleConfig>;
      const current = await getScheduleConfig();
      const interval = Number(body.slotIntervalMinutes || current.slotIntervalMinutes);
      const next: ScheduleConfig = {
        startTime: body.startTime || current.startTime,
        endTime: body.endTime || current.endTime,
        slotIntervalMinutes: ([15, 30, 45, 60].includes(interval) ? interval : 30) as 15 | 30 | 45 | 60,
        statusColors: {
          ...current.statusColors,
          ...(body.statusColors || {}),
        },
      };

      await db
        .insert(systemSettings)
        .values({
          key: 'schedule_config',
          value: next as unknown as Record<string, unknown>,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: systemSettings.key,
          set: {
            value: next as unknown as Record<string, unknown>,
            updatedAt: new Date(),
          },
        });

      await logScheduleAudit(req, 'SCHEDULE_CONFIG_UPDATE', 'system', 'schedule_config', next as unknown as Record<string, unknown>);
      deps.broadcast('appointments:update', { configUpdated: true });
      res.json({ ok: true, config: next });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Erro ao salvar configurações da agenda.' });
    }
  });

  app.put('/api/appointments/:id', requireAuth, requireModule('appointments'), async (req: AuthRequest, res) => {
    try {
      const id = parsePositiveIntId(req.params.id);
      if (!id) {
        return res.status(400).json({ error: 'Identificador de agendamento inválido.' });
      }
      const existingRows = await db.select().from(appointments).where(eq(appointments.id, id)).limit(1);
      const existing = existingRows[0];
      if (!existing) return res.status(404).json({ error: 'Agendamento não encontrado.' });
      if (!isUnitPermitted(req, existing.unitId)) {
        return res.status(403).json({ error: 'Unidade não autorizada para editar este agendamento.' });
      }

      const body = (req.body || {}) as {
        clientId?: number | null;
        serviceId?: number | null;
        collaboratorId?: number | null;
        unitId?: number;
        groupId?: number | null;
        date?: string;
        startTime?: string;
        endTime?: string;
        modality?: string;
        status?: string;
        notes?: string;
      };

      const targetClientId = body.clientId !== undefined ? body.clientId : existing.clientId;
      let clientName = existing.clientName;
      let clientPhone = existing.clientPhone;
      if (targetClientId) {
        const cRows = await db.select().from(clients).where(eq(clients.id, Number(targetClientId))).limit(1);
        if (cRows[0]) {
          clientName = cRows[0].fullName;
          clientPhone = cRows[0].whatsapp || cRows[0].phone || existing.clientPhone;
        }
      }

      const targetServiceId = body.serviceId !== undefined ? body.serviceId : existing.serviceId;
      let serviceName = existing.serviceName;
      let durationMinutes = 30;
      if (targetServiceId) {
        const sRows = await db.select().from(scheduleServices).where(eq(scheduleServices.id, Number(targetServiceId))).limit(1);
        if (sRows[0]) {
          serviceName = sRows[0].name;
          durationMinutes = sRows[0].durationMinutes || 30;
        }
      }

      const existingStart = new Date(existing.scheduledFor);
      const existingEnd = existing.endAt
        ? new Date(existing.endAt)
        : new Date(existingStart.getTime() + durationMinutes * 60000);
      const originalDurationMs = Math.max(15 * 60000, existingEnd.getTime() - existingStart.getTime());

      const startAt =
        body.date && body.startTime
          ? new Date(`${body.date}T${body.startTime}:00`)
          : existingStart;
      const endAt =
        body.date && body.endTime
          ? new Date(`${body.date}T${body.endTime}:00`)
          : new Date(startAt.getTime() + originalDurationMs);

      if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
        return res.status(400).json({ error: 'Data ou horário inválido.' });
      }
      if (endAt.getTime() <= startAt.getTime()) {
        return res.status(400).json({ error: 'Horário final deve ser posterior ao horário inicial.' });
      }

      const targetCollabId =
        body.collaboratorId !== undefined ? body.collaboratorId : existing.collaboratorId;
      let chosenCollab: { id: number; name: string; userId: number | null } | null = null;
      if (targetCollabId) {
        const colRows = await db
          .select({ id: collaborators.id, name: collaborators.name, userId: collaborators.userId })
          .from(collaborators)
          .where(eq(collaborators.id, Number(targetCollabId)))
          .limit(1);
        chosenCollab = colRows[0] || null;
      }

      const consultantUserId = chosenCollab?.userId || existing.consultantId;
      const blockCheck = await checkCollaboratorBlock({
        collaboratorId: chosenCollab?.id ?? targetCollabId ?? null,
        consultantId: consultantUserId,
        startAt,
        endAt,
      });
      if (blockCheck.blocked) {
        return res.status(409).json({
          error: `Movimento bloqueado: ${chosenCollab?.name || 'consultor'} possui bloqueio ativo (${blockCheck.reason}).`,
        });
      }

      const nextStatus = body.status ?? existing.status;
      const nextUnitId = body.unitId ? parsePositiveIntId(body.unitId) : existing.unitId;
      if (!nextUnitId) return res.status(400).json({ error: 'Unidade inválida.' });
      if (!isUnitPermitted(req, nextUnitId)) {
        return res.status(403).json({ error: 'Unidade de destino não autorizada.' });
      }
      const nextModality = body.modality !== undefined ? body.modality : existing.modality;

      const [updated] = await db
        .update(appointments)
        .set({
          clientId: targetClientId ?? null,
          clientName,
          clientPhone,
          unitId: nextUnitId,
          groupId: body.groupId !== undefined ? body.groupId : existing.groupId,
          consultantId: consultantUserId,
          collaboratorId: chosenCollab?.id ?? targetCollabId ?? null,
          serviceId: targetServiceId ?? null,
          serviceName,
          modality: nextModality,
          scheduledFor: startAt,
          endAt,
          status: nextStatus,
          notes: body.notes !== undefined ? String(body.notes) : existing.notes,
          updatedByName: req.authUser!.name,
          updatedAt: new Date(),
        })
        .where(eq(appointments.id, id))
        .returning();

      await logScheduleAudit(
        req,
        'APPOINTMENT_UPDATE',
        'appointment',
        id,
        {
          clientName,
          statusFrom: existing.status,
          statusTo: nextStatus,
          scheduledFor: startAt.toISOString(),
          collaboratorId: updated.collaboratorId,
        },
        nextUnitId
      );

      let whatsappNotification: { attempted: boolean; ok: boolean; detail: string } | null = null;
      if (nextStatus === 'confirmado' && existing.status !== 'confirmado') {
        whatsappNotification = await sendConfirmationWhatsapp({
          req,
          clientId: updated.clientId,
          clientName: updated.clientName,
          clientPhone: updated.clientPhone,
          unitId: nextUnitId,
          serviceName: updated.serviceName || 'Atendimento',
          collaboratorName: chosenCollab?.name || 'Consultor',
          scheduledFor: startAt,
          modality: updated.modality,
        });
      }

      if (nextStatus !== existing.status && (nextStatus === 'confirmado' || nextStatus === 'compareceu' || nextStatus === 'em_admissao')) {
        await dispatchIviSectorNotification(
          {
            targetSector: 'admissao',
            targetUnitId: nextUnitId,
            recipientId: consultantUserId,
            relatedEntityType: 'appointment',
            relatedEntityId: id,
            senderName: 'Ivi IA · Agendamentos',
            subject: `Cliente ${nextStatus === 'confirmado' ? 'confirmado' : 'encaminhado para Admissão'} · ${clientName}`,
            body: `O agendamento de ${clientName} (${startAt.toLocaleString('pt-BR')}) avançou para "${nextStatus.toUpperCase()}" e está pronto para atendimento em Comercial → Admissão.`,
          },
          db,
          deps.broadcast
        );
      }

      deps.broadcast('appointments:update', { appointmentId: id, unitId: nextUnitId });
      res.json({ ok: true, appointment: updated, whatsappNotification });
    } catch (error) {
      console.error('Update appointment error:', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Erro ao atualizar agendamento.' });
    }
  });

  // ---------------------------------------------------------------------------
  // 4. BLOQUEIOS DE AGENDA (CRIAR E EXCLUIR — SEM EDIÇÃO DIRETA CONF. MANUAL)
  // ---------------------------------------------------------------------------
  app.post('/api/appointments/blocks', requireAuth, requireModule('appointments'), async (req: AuthRequest, res) => {
    try {
      const body = (req.body || {}) as {
        collaboratorId?: number;
        allDay?: boolean;
        startDate?: string;
        endDate?: string;
        startTime?: string;
        endTime?: string;
        weekdays?: number[];
        reason?: string;
      };

      const collaboratorId = parsePositiveIntId(body.collaboratorId);
      if (!collaboratorId) {
        return res.status(400).json({ error: 'Selecione o consultor responsável.' });
      }
      if (!body.reason?.trim()) {
        return res.status(400).json({ error: 'Informe o motivo do bloqueio.' });
      }

      const colRows = await db
        .select()
        .from(collaborators)
        .where(eq(collaborators.id, collaboratorId))
        .limit(1);
      const colab = colRows[0];
      if (!colab) return res.status(404).json({ error: 'Colaborador não encontrado.' });
      if (!isUnitPermitted(req, colab.unitId)) {
        return res.status(403).json({ error: 'Unidade não autorizada para criar bloqueio.' });
      }

      const todayStr = toDateKey(new Date());
      const startDateStr = body.startDate || todayStr;
      const endDateStr = body.endDate || startDateStr;
      const allDay = body.allDay !== false;
      const sTime = allDay ? '00:00' : body.startTime || '08:00';
      const eTime = allDay ? '23:59' : body.endTime || '18:00';
      const weekdays =
        Array.isArray(body.weekdays) && body.weekdays.length > 0
          ? body.weekdays.map(Number)
          : [0, 1, 2, 3, 4, 5, 6];

      const startAt = new Date(`${startDateStr}T${sTime}:00`);
      const endAt = new Date(`${endDateStr}T${eTime}:59`);
      if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
        return res.status(400).json({ error: 'Data ou horário de bloqueio inválido.' });
      }
      if (endAt.getTime() < startAt.getTime()) {
        return res.status(400).json({ error: 'A data/hora final deve ser igual ou posterior ao início.' });
      }

      const [created] = await db
        .insert(scheduleBlocks)
        .values({
          collaboratorId: colab.id,
          consultantId: colab.userId ?? null,
          unitId: colab.unitId,
          allDay,
          startTime: body.startTime || '08:00',
          endTime: body.endTime || '18:00',
          weekdays,
          startAt,
          endAt,
          reason: body.reason.trim(),
          createdBy: req.authUser!.name,
        })
        .returning();

      await logScheduleAudit(
        req,
        'SCHEDULE_BLOCK_CREATE',
        'schedule_block',
        created.id,
        { collaboratorName: colab.name, allDay, startDateStr, endDateStr, reason: created.reason },
        colab.unitId
      );

      deps.broadcast('appointments:update', { blockId: created.id });
      res.status(201).json({ ok: true, block: created });
    } catch (error) {
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao criar bloqueio.') });
    }
  });

  app.delete('/api/appointments/blocks/:id', requireAuth, requireModule('appointments'), async (req: AuthRequest, res) => {
    try {
      const id = parsePositiveIntId(req.params.id);
      if (!id) return res.status(400).json({ error: 'ID de bloqueio inválido.' });
      const rows = await db.select().from(scheduleBlocks).where(eq(scheduleBlocks.id, id)).limit(1);
      if (!rows[0]) return res.status(404).json({ error: 'Bloqueio não encontrado.' });
      if (!isUnitPermitted(req, rows[0].unitId)) {
        return res.status(403).json({ error: 'Unidade não autorizada para remover bloqueio.' });
      }

      await db.delete(scheduleBlocks).where(eq(scheduleBlocks.id, id));
      await logScheduleAudit(req, 'SCHEDULE_BLOCK_DELETE', 'schedule_block', id, { reason: rows[0].reason }, rows[0].unitId);
      deps.broadcast('appointments:update', { blockDeletedId: id });
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao remover bloqueio.') });
    }
  });

  // ---------------------------------------------------------------------------
  // 5. FILA DE ESPERA DE CLIENTES (CRUD COMPLETO)
  // ---------------------------------------------------------------------------
  app.post('/api/appointments/waitlist', requireAuth, requireModule('appointments'), async (req: AuthRequest, res) => {
    try {
      const body = (req.body || {}) as {
        clientId?: number;
        serviceId?: number;
        preferredCollaboratorId?: number | null;
        unitId?: number;
        desiredDate?: string;
        desiredTime?: string;
        notes?: string;
      };
      const clientId = parsePositiveIntId(body.clientId);
      const serviceId = parsePositiveIntId(body.serviceId);
      if (!clientId) return res.status(400).json({ error: 'Selecione um cliente.' });
      if (!serviceId) return res.status(400).json({ error: 'Selecione o serviço pretendido.' });

      const cRows = await db.select().from(clients).where(eq(clients.id, clientId)).limit(1);
      if (!cRows[0]) return res.status(404).json({ error: 'Cliente não encontrado.' });
      const unitId = body.unitId ? parsePositiveIntId(body.unitId) : (cRows[0].unitId || req.activeUnitId || 1);
      if (!unitId) return res.status(400).json({ error: 'Unidade inválida.' });
      if (!isUnitPermitted(req, unitId)) return res.status(403).json({ error: 'Unidade não autorizada.' });

      const [created] = await db
        .insert(scheduleWaitlist)
        .values({
          clientId,
          serviceId,
          preferredCollaboratorId: body.preferredCollaboratorId ? Number(body.preferredCollaboratorId) : null,
          unitId,
          desiredDate: body.desiredDate || toDateKey(new Date()),
          desiredTime: body.desiredTime || '08:00',
          notes: String(body.notes || '').trim(),
          createdBy: req.authUser!.name,
          updatedAt: new Date(),
        })
        .returning();

      await logScheduleAudit(
        req,
        'WAITLIST_CREATE',
        'waitlist',
        created.id,
        { clientName: cRows[0].fullName, desiredDate: created.desiredDate, desiredTime: created.desiredTime },
        unitId
      );
      res.status(201).json({ ok: true, item: created });
    } catch (error) {
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao adicionar à fila de espera.') });
    }
  });

  app.put('/api/appointments/waitlist/:id', requireAuth, requireModule('appointments'), async (req: AuthRequest, res) => {
    try {
      const id = parsePositiveIntId(req.params.id);
      if (!id) return res.status(400).json({ error: 'ID da fila de espera inválido.' });

      const existingRows = await db.select().from(scheduleWaitlist).where(eq(scheduleWaitlist.id, id)).limit(1);
      if (!existingRows[0]) return res.status(404).json({ error: 'Registro da fila não localizado.' });
      if (!isUnitPermitted(req, existingRows[0].unitId)) {
        return res.status(403).json({ error: 'Unidade não autorizada.' });
      }

      const body = (req.body || {}) as {
        clientId?: number;
        serviceId?: number;
        preferredCollaboratorId?: number | null;
        unitId?: number;
        desiredDate?: string;
        desiredTime?: string;
        notes?: string;
      };
      const clientId = parsePositiveIntId(body.clientId);
      const serviceId = parsePositiveIntId(body.serviceId);
      if (!clientId) return res.status(400).json({ error: 'Selecione um cliente.' });
      if (!serviceId) return res.status(400).json({ error: 'Selecione o serviço pretendido.' });

      const nextUnitId = body.unitId ? parsePositiveIntId(body.unitId) : existingRows[0].unitId;
      if (!nextUnitId) return res.status(400).json({ error: 'Unidade inválida.' });
      if (!isUnitPermitted(req, nextUnitId)) return res.status(403).json({ error: 'Unidade não autorizada.' });

      const [updated] = await db
        .update(scheduleWaitlist)
        .set({
          clientId,
          serviceId,
          preferredCollaboratorId: body.preferredCollaboratorId ? Number(body.preferredCollaboratorId) : null,
          unitId: nextUnitId,
          desiredDate: body.desiredDate || toDateKey(new Date()),
          desiredTime: body.desiredTime || '08:00',
          notes: String(body.notes || '').trim(),
          updatedAt: new Date(),
        })
        .where(eq(scheduleWaitlist.id, id))
        .returning();

      if (!updated) return res.status(404).json({ error: 'Registro da fila não localizado.' });
      await logScheduleAudit(req, 'WAITLIST_UPDATE', 'waitlist', id, { desiredDate: updated.desiredDate }, updated.unitId);
      res.json({ ok: true, item: updated });
    } catch (error) {
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao atualizar registro da fila.') });
    }
  });

  app.delete('/api/appointments/waitlist/:id', requireAuth, requireModule('appointments'), async (req: AuthRequest, res) => {
    try {
      const id = parsePositiveIntId(req.params.id);
      if (!id) return res.status(400).json({ error: 'ID da fila de espera inválido.' });
      const rows = await db.select().from(scheduleWaitlist).where(eq(scheduleWaitlist.id, id)).limit(1);
      if (!rows[0]) return res.status(404).json({ error: 'Registro da fila não encontrado.' });
      if (!isUnitPermitted(req, rows[0].unitId)) {
        return res.status(403).json({ error: 'Unidade não autorizada.' });
      }

      await db.delete(scheduleWaitlist).where(eq(scheduleWaitlist.id, id));
      await logScheduleAudit(req, 'WAITLIST_DELETE', 'waitlist', id, {}, rows[0].unitId);
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao remover da fila de espera.') });
    }
  });

  // ---------------------------------------------------------------------------
  // 6. SERVIÇOS DA AGENDA (CRIAR, CONSULTAR, EDITAR — SEM EXCLUSÃO CONF. MANUAL)
  // ---------------------------------------------------------------------------
  app.post('/api/appointments/services', requireAuth, requireModule('appointments'), async (req: AuthRequest, res) => {
    try {
      const body = (req.body || {}) as {
        name?: string;
        durationMinutes?: number;
        priceCents?: number;
        color?: string;
      };
      if (!body.name?.trim()) {
        return res.status(400).json({ error: 'Nome do serviço é obrigatório.' });
      }

      const [created] = await db
        .insert(scheduleServices)
        .values({
          name: body.name.trim(),
          durationMinutes: Math.max(5, Number(body.durationMinutes || 30)),
          priceCents: Math.max(0, Math.round(Number(body.priceCents || 0))),
          color: body.color || '#e0e7ff',
          active: true,
        })
        .returning();

      await logScheduleAudit(req, 'SCHEDULE_SERVICE_CREATE', 'schedule_service', created.id, {
        name: created.name,
        durationMinutes: created.durationMinutes,
      });
      res.status(201).json({ ok: true, service: created });
    } catch (error) {
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao criar serviço.') });
    }
  });

  app.put('/api/appointments/services/:id', requireAuth, requireModule('appointments'), async (req: AuthRequest, res) => {
    try {
      const id = parsePositiveIntId(req.params.id);
      if (!id) return res.status(400).json({ error: 'ID de serviço inválido.' });
      const body = (req.body || {}) as {
        name?: string;
        durationMinutes?: number;
        priceCents?: number;
        color?: string;
      };
      if (!body.name?.trim()) {
        return res.status(400).json({ error: 'Nome do serviço é obrigatório.' });
      }

      const [updated] = await db
        .update(scheduleServices)
        .set({
          name: body.name.trim(),
          durationMinutes: Math.max(5, Number(body.durationMinutes || 30)),
          priceCents: Math.max(0, Math.round(Number(body.priceCents || 0))),
          color: body.color || '#e0e7ff',
          updatedAt: new Date(),
        })
        .where(eq(scheduleServices.id, id))
        .returning();

      if (!updated) return res.status(404).json({ error: 'Serviço não encontrado.' });
      await logScheduleAudit(req, 'SCHEDULE_SERVICE_UPDATE', 'schedule_service', id, {
        name: updated.name,
        durationMinutes: updated.durationMinutes,
      });
      res.json({ ok: true, service: updated });
    } catch (error) {
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao atualizar serviço.') });
    }
  });

  void and;
}
