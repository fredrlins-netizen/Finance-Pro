import type { Express } from 'express';
import { and, asc, desc, eq, inArray, isNull, or } from 'drizzle-orm';
import { db } from '../db/index.ts';
import {
  admissions,
  auditLogs,
  clients,
  collaborators,
  companyLegalProcessAttachments,
  companyLegalProcessDeadlines,
  companyLegalProcessHearings,
  companyLegalProcessMovements,
  companyLegalProcesses,
  documentObjects,
  internalMessages,
  systemSettings,
  units,
  userGroups,
  users,
} from '../db/schema.ts';
import { requireAdmin, requireAuth, requireModule, type AuthRequest } from '../middleware/auth.ts';
import {
  canPreviewInline,
  getBucketObjectBuffer,
  putBucketObject,
  sanitizeFileName,
  validateUploadFile,
} from '../services/bucketStorage.ts';

interface CompanyLegalRouteDeps {
  broadcast: (event: string, payload: unknown) => void;
}

interface IncomingAttachmentPayload {
  id?: string | number;
  title?: string;
  fileName?: string;
  mimeType?: string;
  sizeBytes?: number;
  sha256Hash?: string;
  storageUri?: string;
  fileData?: string;
  createdAt?: string;
}

interface NormalizedFieldChange {
  field: string;
  label: string;
  from: string;
  to: string;
}

const PROCESS_FIELD_LABELS: Array<{ key: string; label: string }> = [
  { key: 'processNumber', label: 'Nº do Processo' },
  { key: 'court', label: 'Vara' },
  { key: 'jurisdiction', label: 'Comarca / Jurisdição' },
  { key: 'type', label: 'Tipo de Ação' },
  { key: 'role', label: 'Papel da Empresa' },
  { key: 'status', label: 'Status' },
  { key: 'subject', label: 'Assunto' },
  { key: 'unitId', label: 'Unidade' },
  { key: 'distributionDate', label: 'Data de Distribuição' },
  { key: 'lastMovementDate', label: 'Última Movimentação' },
  { key: 'opposingParty', label: 'Parte Adversa' },
  { key: 'opposingPartyDocument', label: 'Documento Parte Adversa' },
  { key: 'partnerId', label: 'Parceiro Vinculado' },
  { key: 'opposingPartyLawyer', label: 'Advogado Parte Adversa' },
  { key: 'opposingPartyLawyerOAB', label: 'OAB Parte Adversa' },
  { key: 'responsibleLawyer', label: 'Advogado Responsável' },
  { key: 'responsibleLawyerOAB', label: 'OAB Responsável' },
  { key: 'causeValue', label: 'Valor da Causa' },
  { key: 'provisionValue', label: 'Valor Provisionado' },
  { key: 'riskLevel', label: 'Nível de Risco' },
  { key: 'notes', label: 'Notas / Corpo' },
  { key: 'notesHeader', label: 'Cabeçalho das Notas' },
  { key: 'notesFooter', label: 'Rodapé das Notas' },
];

function parseDataUrlBase64(dataUrl: string): { mimeType: string; buffer: Buffer } | null {
  const raw = String(dataUrl || '').trim();
  const match = /^data:([^;]+);base64,(.+)$/i.exec(raw);
  if (match) {
    return {
      mimeType: match[1] || 'application/octet-stream',
      buffer: Buffer.from(match[2], 'base64'),
    };
  }
  return null;
}

function serializeProcessRow(
  proc: typeof companyLegalProcesses.$inferSelect,
  movements: Array<typeof companyLegalProcessMovements.$inferSelect>,
  deadlines: Array<typeof companyLegalProcessDeadlines.$inferSelect>,
  hearings: Array<typeof companyLegalProcessHearings.$inferSelect>,
  attachments: Array<typeof companyLegalProcessAttachments.$inferSelect>
) {
  return {
    id: proc.id,
    unitId: proc.unitId ?? null,
    processNumber: proc.processNumber,
    court: proc.court || '',
    jurisdiction: proc.jurisdiction || '',
    type: proc.type || 'CÍVEL',
    role: proc.role || 'RÉU',
    opposingParty: proc.opposingParty || '',
    opposingPartyDocument: proc.opposingPartyDocument || '',
    opposingPartyLawyer: proc.opposingPartyLawyer || '',
    opposingPartyLawyerOAB: proc.opposingPartyLawyerOab || '',
    partnerId: proc.partnerId ?? null,
    clientId: proc.clientId ?? null,
    admissionId: proc.admissionId ?? null,
    clientName: proc.clientName || '',
    contractNumber: proc.contractNumber || '',
    responsibleLawyer: proc.responsibleLawyer || '',
    responsibleLawyerOAB: proc.responsibleLawyerOab || '',
    status: proc.status || 'ATIVO',
    subject: proc.subject || '',
    causeValue: proc.causeValue || '',
    provisionValue: proc.provisionValue || '',
    riskLevel: proc.riskLevel || 'MEDIO',
    distributionDate: proc.distributionDate || '',
    lastMovementDate: proc.lastMovementDate || '',
    notes: proc.notes || '',
    notesHeader: proc.notesHeader || '',
    notesFooter: proc.notesFooter || '',
    tags: Array.isArray(proc.tags) ? proc.tags : [],
    movements: movements.map((m) => ({
      id: m.id,
      processId: m.processId,
      date: m.date,
      type: m.type,
      description: m.description,
      source: m.source || '',
      createdAt: m.createdAt instanceof Date ? m.createdAt.toISOString() : String(m.createdAt || ''),
    })),
    deadlines: deadlines.map((d) => ({
      id: d.id,
      processId: d.processId,
      type: d.type,
      description: d.description,
      dueDate: d.dueDate,
      status: d.status,
      responsibleId: d.responsibleId ?? null,
      notes: d.notes || '',
      createdAt: d.createdAt instanceof Date ? d.createdAt.toISOString() : String(d.createdAt || ''),
    })),
    hearings: hearings.map((h) => ({
      id: h.id,
      processId: h.processId,
      type: h.type,
      date: h.date,
      time: h.time,
      location: h.location || '',
      status: h.status,
      notes: h.notes || '',
      createdAt: h.createdAt instanceof Date ? h.createdAt.toISOString() : String(h.createdAt || ''),
    })),
    attachments: attachments.map((a) => ({
      id: a.id,
      processId: a.processId,
      title: a.title || a.fileName,
      fileName: a.fileName,
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
      sha256Hash: a.sha256Hash,
      storageUri: a.storageUri,
      fileUrl: `/api/company-legal/attachments/${a.id}/content`,
      createdAt: a.createdAt instanceof Date ? a.createdAt.toISOString() : String(a.createdAt || ''),
    })),
    createdAt: proc.createdAt instanceof Date ? proc.createdAt.toISOString() : String(proc.createdAt || ''),
    updatedAt: proc.updatedAt instanceof Date ? proc.updatedAt.toISOString() : String(proc.updatedAt || ''),
  };
}

async function loadSerializedProcesses(allowedUnitIds: number[] | null) {
  const procRows =
    allowedUnitIds === null
      ? await db.select().from(companyLegalProcesses).orderBy(desc(companyLegalProcesses.updatedAt))
      : allowedUnitIds.length === 0
      ? []
      : await db
          .select()
          .from(companyLegalProcesses)
          .where(inArray(companyLegalProcesses.unitId, allowedUnitIds))
          .orderBy(desc(companyLegalProcesses.updatedAt));

  if (procRows.length === 0) return [];
  const procIds = procRows.map((p) => p.id);

  const [movRows, dlRows, hrRows, attRows] = await Promise.all([
    db
      .select()
      .from(companyLegalProcessMovements)
      .where(inArray(companyLegalProcessMovements.processId, procIds))
      .orderBy(desc(companyLegalProcessMovements.date), desc(companyLegalProcessMovements.id)),
    db
      .select()
      .from(companyLegalProcessDeadlines)
      .where(inArray(companyLegalProcessDeadlines.processId, procIds))
      .orderBy(asc(companyLegalProcessDeadlines.dueDate), asc(companyLegalProcessDeadlines.id)),
    db
      .select()
      .from(companyLegalProcessHearings)
      .where(inArray(companyLegalProcessHearings.processId, procIds))
      .orderBy(asc(companyLegalProcessHearings.date), asc(companyLegalProcessHearings.time)),
    db
      .select()
      .from(companyLegalProcessAttachments)
      .where(inArray(companyLegalProcessAttachments.processId, procIds))
      .orderBy(desc(companyLegalProcessAttachments.id)),
  ]);

  const movMap = new Map<number, typeof movRows>();
  const dlMap = new Map<number, typeof dlRows>();
  const hrMap = new Map<number, typeof hrRows>();
  const attMap = new Map<number, typeof attRows>();

  for (const m of movRows) {
    const arr = movMap.get(m.processId) || [];
    arr.push(m);
    movMap.set(m.processId, arr);
  }
  for (const d of dlRows) {
    const arr = dlMap.get(d.processId) || [];
    arr.push(d);
    dlMap.set(d.processId, arr);
  }
  for (const h of hrRows) {
    const arr = hrMap.get(h.processId) || [];
    arr.push(h);
    hrMap.set(h.processId, arr);
  }
  for (const a of attRows) {
    const arr = attMap.get(a.processId) || [];
    arr.push(a);
    attMap.set(a.processId, arr);
  }

  return procRows.map((p) =>
    serializeProcessRow(
      p,
      movMap.get(p.id) || [],
      dlMap.get(p.id) || [],
      hrMap.get(p.id) || [],
      attMap.get(p.id) || []
    )
  );
}

async function getSettingValue<T>(key: string): Promise<T | null> {
  const rows = await db.select().from(systemSettings).where(eq(systemSettings.key, key)).limit(1);
  if (!rows[0]) return null;
  return rows[0].value as unknown as T;
}

async function upsertSettingValue(key: string, value: Record<string, unknown>) {
  await db
    .insert(systemSettings)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: systemSettings.key,
      set: { value, updatedAt: new Date() },
    });
}

function getAllowedUnitsScope(req: AuthRequest): number[] | null {
  if (!req.authUser) return [];
  if (req.authUser.role === 'admin') return null;
  return Array.isArray(req.authUser.allowedUnitIds) ? req.authUser.allowedUnitIds : [];
}

function canAccessAnyLegalModule(req: AuthRequest): boolean {
  if (!req.authUser) return false;
  if (req.authUser.role === 'admin') return true;
  const p = req.authUser.modulePermissions || {};
  if (p.acomp_juridico === false) return false;
  const keys = ['jur_dashboard', 'jur_processos', 'jur_prazos'];
  const explicitlyAllFalse = keys.every((k) => p[k] === false);
  return !explicitlyAllFalse;
}

export function registerCompanyLegalRoutes(app: Express, deps: CompanyLegalRouteDeps) {
  const { broadcast } = deps;

  // 1. Bootstrap (processos + unidades + clientes + colaboradores)
  app.get('/api/company-legal/bootstrap', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!canAccessAnyLegalModule(req)) {
        return res.status(403).json({ error: 'Acesso ao módulo Acompanhamento Jurídico não autorizado.' });
      }
      const allowedUnits = getAllowedUnitsScope(req);
      const [processes, unitRows, clientRows, collabRows] = await Promise.all([
        loadSerializedProcesses(allowedUnits),
        db.select().from(units).where(eq(units.active, true)).orderBy(asc(units.id)),
        db.select().from(clients).orderBy(asc(clients.fullName)),
        db.select().from(collaborators).where(eq(collaborators.active, true)).orderBy(asc(collaborators.name)),
      ]);

      res.json({
        processes,
        units: unitRows,
        clients: clientRows,
        collaborators: collabRows,
      });
    } catch (error) {
      console.error('GET /api/company-legal/bootstrap error:', error);
      res.status(500).json({ error: 'Erro ao carregar dados do Acompanhamento Jurídico.' });
    }
  });

  // 2. Dashboard data
  app.get(
    '/api/company-legal/dashboard-data',
    requireAuth,
    requireModule('jur_dashboard'),
    async (req: AuthRequest, res) => {
      try {
        const allowedUnits = getAllowedUnitsScope(req);
        const processes = await loadSerializedProcesses(allowedUnits);
        res.json({ data: processes });
      } catch (error) {
        console.error('GET /api/company-legal/dashboard-data error:', error);
        res.status(500).json({ error: 'Erro ao carregar indicadores do Dashboard Jurídico.' });
      }
    }
  );

  // 3. Paginated list endpoint (server-side filters)
  app.get(
    '/api/company-legal/processes',
    requireAuth,
    requireModule('jur_processos'),
    async (req: AuthRequest, res) => {
      try {
        const allowedUnits = getAllowedUnitsScope(req);
        const page = Math.max(1, Number(req.query.page || 1));
        const limit = Math.min(100, Math.max(1, Number(req.query.limit || 20)));
        const search = String(req.query.search || '').trim().toLowerCase();
        const statusFilter = String(req.query.status || '').trim();
        const typeFilter = String(req.query.type || '').trim();
        const riskFilter = String(req.query.risk_level || req.query.riskLevel || '').trim();
        const unitFilter = req.query.unit_id ? Number(req.query.unit_id) : null;

        let all = await loadSerializedProcesses(allowedUnits);
        if (search) {
          all = all.filter((p) =>
            [p.processNumber, p.opposingParty, p.subject, p.responsibleLawyer, p.court, p.jurisdiction]
              .join(' ')
              .toLowerCase()
              .includes(search)
          );
        }
        if (statusFilter) all = all.filter((p) => p.status === statusFilter);
        if (typeFilter) all = all.filter((p) => p.type === typeFilter);
        if (riskFilter) all = all.filter((p) => p.riskLevel === riskFilter);
        if (unitFilter) all = all.filter((p) => p.unitId === unitFilter);

        const total = all.length;
        const totalPages = Math.max(1, Math.ceil(total / limit));
        const offset = (page - 1) * limit;
        const data = all.slice(offset, offset + limit);

        res.json({ data, total, page, limit, totalPages });
      } catch (error) {
        console.error('GET /api/company-legal/processes error:', error);
        res.status(500).json({ error: 'Erro ao listar processos.' });
      }
    }
  );

  // 4. Single process details
  app.get('/api/company-legal/processes/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!canAccessAnyLegalModule(req)) {
        return res.status(403).json({ error: 'Acesso negado.' });
      }
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'ID inválido.' });

      const rows = await db
        .select()
        .from(companyLegalProcesses)
        .where(eq(companyLegalProcesses.id, id))
        .limit(1);
      const proc = rows[0];
      if (!proc) return res.status(404).json({ error: 'Processo não encontrado.' });

      const allowedUnits = getAllowedUnitsScope(req);
      if (allowedUnits !== null && proc.unitId !== null && !allowedUnits.includes(proc.unitId)) {
        return res.status(403).json({ error: 'Unidade do processo não autorizada.' });
      }

      const [movs, dls, hrs, atts] = await Promise.all([
        db
          .select()
          .from(companyLegalProcessMovements)
          .where(eq(companyLegalProcessMovements.processId, id))
          .orderBy(desc(companyLegalProcessMovements.date), desc(companyLegalProcessMovements.id)),
        db
          .select()
          .from(companyLegalProcessDeadlines)
          .where(eq(companyLegalProcessDeadlines.processId, id))
          .orderBy(asc(companyLegalProcessDeadlines.dueDate), asc(companyLegalProcessDeadlines.id)),
        db
          .select()
          .from(companyLegalProcessHearings)
          .where(eq(companyLegalProcessHearings.processId, id))
          .orderBy(asc(companyLegalProcessHearings.date), asc(companyLegalProcessHearings.time)),
        db
          .select()
          .from(companyLegalProcessAttachments)
          .where(eq(companyLegalProcessAttachments.processId, id))
          .orderBy(desc(companyLegalProcessAttachments.id)),
      ]);

      res.json({ data: serializeProcessRow(proc, movs, dls, hrs, atts) });
    } catch (error) {
      console.error('GET /api/company-legal/processes/:id error:', error);
      res.status(500).json({ error: 'Erro ao carregar processo.' });
    }
  });

  // 5. Create process (transactional + bucket attachments + audit)
  app.post('/api/company-legal/processes', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!canAccessAnyLegalModule(req)) {
        return res.status(403).json({ error: 'Acesso negado.' });
      }
      const body = (req.body || {}) as Record<string, any>;
      const processNumber = String(body.processNumber || body.process_number || '').trim();
      const status = String(body.status || 'ATIVO').trim() || 'ATIVO';
      if (!processNumber) {
        return res.status(400).json({ error: 'O número do processo é obrigatório.' });
      }

      const rawUnitId = body.unitId ?? body.unit_id ?? req.activeUnitId ?? null;
      const unitId = rawUnitId ? Number(rawUnitId) : null;
      const allowedUnits = getAllowedUnitsScope(req);
      if (allowedUnits !== null && unitId !== null && !allowedUnits.includes(unitId)) {
        return res.status(403).json({ error: 'Unidade selecionada não autorizada para este perfil.' });
      }

      const partnerId = body.partnerId || body.partner_id ? Number(body.partnerId || body.partner_id) : null;
      const clientId = body.clientId || body.client_id ? Number(body.clientId || body.client_id) : partnerId;
      const admissionId = body.admissionId || body.admission_id ? Number(body.admissionId || body.admission_id) : null;

      if (unitId) {
        const uExists = await db.select({ id: units.id }).from(units).where(eq(units.id, unitId)).limit(1);
        if (!uExists[0]) return res.status(400).json({ error: 'Unidade informada não encontrada.' });
      }
      if (partnerId) {
        const cExists = await db.select({ id: clients.id }).from(clients).where(eq(clients.id, partnerId)).limit(1);
        if (!cExists[0]) return res.status(400).json({ error: 'Parceiro vinculado não encontrado.' });
      }
      if (admissionId) {
        const aExists = await db.select({ id: admissions.id }).from(admissions).where(eq(admissions.id, admissionId)).limit(1);
        if (!aExists[0]) return res.status(400).json({ error: 'Admissão informada não encontrada.' });
      }

      // Upload new base64 attachments into bucketdainvicta before DB tx
      const rawAttachments: IncomingAttachmentPayload[] = Array.isArray(body.attachments) ? body.attachments : [];
      const preparedAttachments: Array<{
        title: string;
        fileName: string;
        mimeType: string;
        sizeBytes: number;
        sha256Hash: string;
        storageUri: string;
      }> = [];

      for (const att of rawAttachments) {
        const safeName = sanitizeFileName(String(att.fileName || att.title || 'documento.bin'));
        if (att.fileData && typeof att.fileData === 'string' && att.fileData.startsWith('data:')) {
          const parsed = parseDataUrlBase64(att.fileData);
          if (!parsed) {
            return res.status(400).json({ error: `Arquivo "${safeName}" com formato inválido.` });
          }
          if (parsed.buffer.length > 5 * 1024 * 1024) {
            return res.status(400).json({ error: `Arquivo "${safeName}" excede o limite de 5MB.` });
          }
          const validationErr = validateUploadFile(safeName, parsed.mimeType, parsed.buffer.length);
          if (validationErr) {
            return res.status(400).json({ error: validationErr });
          }
          const stored = await putBucketObject(parsed.buffer, {
            folderPath: 'acompanhamento-juridico',
            mimeType: parsed.mimeType,
            originalName: safeName,
          });
          preparedAttachments.push({
            title: String(att.title || safeName).trim() || safeName,
            fileName: safeName,
            mimeType: parsed.mimeType,
            sizeBytes: stored.sizeBytes,
            sha256Hash: stored.sha256Hash,
            storageUri: stored.storageUri,
          });
        } else if (att.sha256Hash && att.storageUri) {
          preparedAttachments.push({
            title: String(att.title || safeName).trim() || safeName,
            fileName: safeName,
            mimeType: String(att.mimeType || 'application/octet-stream'),
            sizeBytes: Number(att.sizeBytes || 0),
            sha256Hash: String(att.sha256Hash),
            storageUri: String(att.storageUri),
          });
        }
      }

      const created = await db.transaction(async (tx) => {
        const [proc] = await tx
          .insert(companyLegalProcesses)
          .values({
            unitId,
            processNumber,
            court: String(body.court || ''),
            jurisdiction: String(body.jurisdiction || ''),
            type: String(body.type || 'CÍVEL'),
            role: String(body.role || 'RÉU'),
            opposingParty: String(body.opposingParty || ''),
            opposingPartyDocument: String(body.opposingPartyDocument || ''),
            opposingPartyLawyer: String(body.opposingPartyLawyer || ''),
            opposingPartyLawyerOab: String(body.opposingPartyLawyerOAB || body.opposingPartyLawyerOab || ''),
            partnerId,
            clientId,
            admissionId,
            clientName: String(body.clientName || ''),
            contractNumber: String(body.contractNumber || ''),
            responsibleLawyer: String(body.responsibleLawyer || ''),
            responsibleLawyerOab: String(body.responsibleLawyerOAB || body.responsibleLawyerOab || ''),
            status,
            subject: String(body.subject || ''),
            causeValue: String(body.causeValue || ''),
            provisionValue: String(body.provisionValue || ''),
            riskLevel: String(body.riskLevel || 'MEDIO'),
            distributionDate: String(body.distributionDate || ''),
            lastMovementDate: String(body.lastMovementDate || ''),
            notes: String(body.notes || ''),
            notesHeader: String(body.notesHeader || ''),
            notesFooter: String(body.notesFooter || ''),
            tags: Array.isArray(body.tags) ? body.tags.map(String) : [],
          })
          .returning();

        const movsInput = Array.isArray(body.movements) ? body.movements : [];
        const insertedMovs = movsInput.length
          ? await tx
              .insert(companyLegalProcessMovements)
              .values(
                movsInput.map((m: Record<string, any>) => ({
                  processId: proc.id,
                  date: String(m.date || new Date().toISOString().slice(0, 10)),
                  type: String(m.type || 'DESPACHO'),
                  description: String(m.description || ''),
                  source: String(m.source || ''),
                }))
              )
              .returning()
          : [];

        const dlsInput = Array.isArray(body.deadlines) ? body.deadlines : [];
        const insertedDls = dlsInput.length
          ? await tx
              .insert(companyLegalProcessDeadlines)
              .values(
                dlsInput.map((d: Record<string, any>) => ({
                  processId: proc.id,
                  type: String(d.type || 'OUTRO'),
                  description: String(d.description || ''),
                  dueDate: String(d.dueDate || ''),
                  status: String(d.status || 'PENDENTE'),
                  responsibleId: d.responsibleId ? Number(d.responsibleId) : null,
                  notes: String(d.notes || ''),
                }))
              )
              .returning()
          : [];

        const hrsInput = Array.isArray(body.hearings) ? body.hearings : [];
        const insertedHrs = hrsInput.length
          ? await tx
              .insert(companyLegalProcessHearings)
              .values(
                hrsInput.map((h: Record<string, any>) => ({
                  processId: proc.id,
                  type: String(h.type || 'INICIAL'),
                  date: String(h.date || ''),
                  time: String(h.time || ''),
                  location: String(h.location || ''),
                  status: String(h.status || 'AGENDADA'),
                  notes: String(h.notes || ''),
                }))
              )
              .returning()
          : [];

        const insertedAtts = preparedAttachments.length
          ? await tx
              .insert(companyLegalProcessAttachments)
              .values(
                preparedAttachments.map((a) => ({
                  processId: proc.id,
                  title: a.title,
                  fileName: a.fileName,
                  mimeType: a.mimeType,
                  sizeBytes: a.sizeBytes,
                  sha256Hash: a.sha256Hash,
                  storageUri: a.storageUri,
                }))
              )
              .returning()
          : [];

        await tx.insert(auditLogs).values({
          userId: req.authUser!.id,
          userName: req.authUser!.name,
          action: 'PROCESS_CREATED',
          entityType: 'company_legal_process',
          entityId: String(proc.id),
          details: {
            description: `Processo ${proc.processNumber} cadastrado.`,
            processNumber: proc.processNumber,
          },
          unitId: proc.unitId,
        });

        return serializeProcessRow(proc, insertedMovs, insertedDls, insertedHrs, insertedAtts);
      });

      broadcast('company_legal:invalidate', { action: 'created', id: created.id });
      res.status(201).json({ data: created });
    } catch (error) {
      console.error('POST /api/company-legal/processes error:', error);
      res.status(500).json({ error: 'Erro ao cadastrar processo jurídico.' });
    }
  });

  // 6. Update process (transactional + field diff audit + child sync + bucket attachments)
  app.put('/api/company-legal/processes/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!canAccessAnyLegalModule(req)) {
        return res.status(403).json({ error: 'Acesso negado.' });
      }
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'ID inválido.' });

      const existingRows = await db
        .select()
        .from(companyLegalProcesses)
        .where(eq(companyLegalProcesses.id, id))
        .limit(1);
      const existing = existingRows[0];
      if (!existing) return res.status(404).json({ error: 'Processo não encontrado.' });

      const allowedUnits = getAllowedUnitsScope(req);
      if (allowedUnits !== null && existing.unitId !== null && !allowedUnits.includes(existing.unitId)) {
        return res.status(403).json({ error: 'Sem permissão para alterar processo desta unidade.' });
      }

      const body = (req.body || {}) as Record<string, any>;
      const nextUnitId =
        body.unitId !== undefined
          ? body.unitId
            ? Number(body.unitId)
            : null
          : existing.unitId;
      if (allowedUnits !== null && nextUnitId !== null && !allowedUnits.includes(nextUnitId)) {
        return res.status(403).json({ error: 'Nova unidade selecionada não autorizada.' });
      }

      const nextProcessNumber =
        body.processNumber !== undefined ? String(body.processNumber).trim() : existing.processNumber;
      if (!nextProcessNumber) {
        return res.status(400).json({ error: 'O número do processo é obrigatório.' });
      }

      const nextPartnerId =
        body.partnerId !== undefined ? (body.partnerId ? Number(body.partnerId) : null) : existing.partnerId;
      const nextClientId =
        body.clientId !== undefined
          ? body.clientId
            ? Number(body.clientId)
            : null
          : nextPartnerId ?? existing.clientId;
      const nextAdmissionId =
        body.admissionId !== undefined
          ? body.admissionId
            ? Number(body.admissionId)
            : null
          : existing.admissionId;

      if (nextUnitId) {
        const uExists = await db.select({ id: units.id }).from(units).where(eq(units.id, nextUnitId)).limit(1);
        if (!uExists[0]) return res.status(400).json({ error: 'Unidade informada não encontrada.' });
      }
      if (nextPartnerId) {
        const cExists = await db.select({ id: clients.id }).from(clients).where(eq(clients.id, nextPartnerId)).limit(1);
        if (!cExists[0]) return res.status(400).json({ error: 'Parceiro vinculado não encontrado.' });
      }
      if (nextAdmissionId) {
        const aExists = await db.select({ id: admissions.id }).from(admissions).where(eq(admissions.id, nextAdmissionId)).limit(1);
        if (!aExists[0]) return res.status(400).json({ error: 'Admissão informada não encontrada.' });
      }

      // Prepare attachments if provided
      let preparedAttachments: Array<{
        title: string;
        fileName: string;
        mimeType: string;
        sizeBytes: number;
        sha256Hash: string;
        storageUri: string;
      }> | null = null;

      if (Array.isArray(body.attachments)) {
        preparedAttachments = [];
        for (const att of body.attachments as IncomingAttachmentPayload[]) {
          const safeName = sanitizeFileName(String(att.fileName || att.title || 'documento.bin'));
          if (att.fileData && typeof att.fileData === 'string' && att.fileData.startsWith('data:')) {
            const parsed = parseDataUrlBase64(att.fileData);
            if (!parsed) {
              return res.status(400).json({ error: `Arquivo "${safeName}" com formato inválido.` });
            }
            if (parsed.buffer.length > 5 * 1024 * 1024) {
              return res.status(400).json({ error: `Arquivo "${safeName}" excede o limite de 5MB.` });
            }
            const validationErr = validateUploadFile(safeName, parsed.mimeType, parsed.buffer.length);
            if (validationErr) {
              return res.status(400).json({ error: validationErr });
            }
            const stored = await putBucketObject(parsed.buffer, {
              folderPath: 'acompanhamento-juridico',
              mimeType: parsed.mimeType,
              originalName: safeName,
            });
            preparedAttachments.push({
              title: String(att.title || safeName).trim() || safeName,
              fileName: safeName,
              mimeType: parsed.mimeType,
              sizeBytes: stored.sizeBytes,
              sha256Hash: stored.sha256Hash,
              storageUri: stored.storageUri,
            });
          } else if (att.sha256Hash && att.storageUri) {
            preparedAttachments.push({
              title: String(att.title || safeName).trim() || safeName,
              fileName: safeName,
              mimeType: String(att.mimeType || 'application/octet-stream'),
              sizeBytes: Number(att.sizeBytes || 0),
              sha256Hash: String(att.sha256Hash),
              storageUri: String(att.storageUri),
            });
          }
        }
      }

      const oldSnapshot: Record<string, string> = {
        processNumber: existing.processNumber || '',
        court: existing.court || '',
        jurisdiction: existing.jurisdiction || '',
        type: existing.type || '',
        role: existing.role || '',
        status: existing.status || '',
        subject: existing.subject || '',
        unitId: existing.unitId ? String(existing.unitId) : '',
        distributionDate: existing.distributionDate || '',
        lastMovementDate: existing.lastMovementDate || '',
        opposingParty: existing.opposingParty || '',
        opposingPartyDocument: existing.opposingPartyDocument || '',
        partnerId: existing.partnerId ? String(existing.partnerId) : '',
        opposingPartyLawyer: existing.opposingPartyLawyer || '',
        opposingPartyLawyerOAB: existing.opposingPartyLawyerOab || '',
        responsibleLawyer: existing.responsibleLawyer || '',
        responsibleLawyerOAB: existing.responsibleLawyerOab || '',
        causeValue: existing.causeValue || '',
        provisionValue: existing.provisionValue || '',
        riskLevel: existing.riskLevel || '',
        notes: existing.notes || '',
        notesHeader: existing.notesHeader || '',
        notesFooter: existing.notesFooter || '',
      };

      const updatedPayload = {
        unitId: nextUnitId,
        processNumber: nextProcessNumber,
        court: body.court !== undefined ? String(body.court || '') : existing.court,
        jurisdiction: body.jurisdiction !== undefined ? String(body.jurisdiction || '') : existing.jurisdiction,
        type: body.type !== undefined ? String(body.type || 'CÍVEL') : existing.type,
        role: body.role !== undefined ? String(body.role || 'RÉU') : existing.role,
        opposingParty: body.opposingParty !== undefined ? String(body.opposingParty || '') : existing.opposingParty,
        opposingPartyDocument:
          body.opposingPartyDocument !== undefined
            ? String(body.opposingPartyDocument || '')
            : existing.opposingPartyDocument,
        opposingPartyLawyer:
          body.opposingPartyLawyer !== undefined
            ? String(body.opposingPartyLawyer || '')
            : existing.opposingPartyLawyer,
        opposingPartyLawyerOab:
          body.opposingPartyLawyerOAB !== undefined || body.opposingPartyLawyerOab !== undefined
            ? String(body.opposingPartyLawyerOAB ?? body.opposingPartyLawyerOab ?? '')
            : existing.opposingPartyLawyerOab,
        partnerId: nextPartnerId,
        clientId: nextClientId,
        admissionId: nextAdmissionId,
        clientName: body.clientName !== undefined ? String(body.clientName || '') : existing.clientName,
        contractNumber: body.contractNumber !== undefined ? String(body.contractNumber || '') : existing.contractNumber,
        responsibleLawyer:
          body.responsibleLawyer !== undefined ? String(body.responsibleLawyer || '') : existing.responsibleLawyer,
        responsibleLawyerOab:
          body.responsibleLawyerOAB !== undefined || body.responsibleLawyerOab !== undefined
            ? String(body.responsibleLawyerOAB ?? body.responsibleLawyerOab ?? '')
            : existing.responsibleLawyerOab,
        status: body.status !== undefined ? String(body.status || 'ATIVO') : existing.status,
        subject: body.subject !== undefined ? String(body.subject || '') : existing.subject,
        causeValue: body.causeValue !== undefined ? String(body.causeValue || '') : existing.causeValue,
        provisionValue: body.provisionValue !== undefined ? String(body.provisionValue || '') : existing.provisionValue,
        riskLevel: body.riskLevel !== undefined ? String(body.riskLevel || 'MEDIO') : existing.riskLevel,
        distributionDate:
          body.distributionDate !== undefined ? String(body.distributionDate || '') : existing.distributionDate,
        lastMovementDate:
          body.lastMovementDate !== undefined ? String(body.lastMovementDate || '') : existing.lastMovementDate,
        notes: body.notes !== undefined ? String(body.notes || '') : existing.notes,
        notesHeader: body.notesHeader !== undefined ? String(body.notesHeader || '') : existing.notesHeader,
        notesFooter: body.notesFooter !== undefined ? String(body.notesFooter || '') : existing.notesFooter,
        tags: Array.isArray(body.tags) ? body.tags.map(String) : existing.tags,
        updatedAt: new Date(),
      };

      const newSnapshot: Record<string, string> = {
        processNumber: updatedPayload.processNumber || '',
        court: updatedPayload.court || '',
        jurisdiction: updatedPayload.jurisdiction || '',
        type: updatedPayload.type || '',
        role: updatedPayload.role || '',
        status: updatedPayload.status || '',
        subject: updatedPayload.subject || '',
        unitId: updatedPayload.unitId ? String(updatedPayload.unitId) : '',
        distributionDate: updatedPayload.distributionDate || '',
        lastMovementDate: updatedPayload.lastMovementDate || '',
        opposingParty: updatedPayload.opposingParty || '',
        opposingPartyDocument: updatedPayload.opposingPartyDocument || '',
        partnerId: updatedPayload.partnerId ? String(updatedPayload.partnerId) : '',
        opposingPartyLawyer: updatedPayload.opposingPartyLawyer || '',
        opposingPartyLawyerOAB: updatedPayload.opposingPartyLawyerOab || '',
        responsibleLawyer: updatedPayload.responsibleLawyer || '',
        responsibleLawyerOAB: updatedPayload.responsibleLawyerOab || '',
        causeValue: updatedPayload.causeValue || '',
        provisionValue: updatedPayload.provisionValue || '',
        riskLevel: updatedPayload.riskLevel || '',
        notes: updatedPayload.notes || '',
        notesHeader: updatedPayload.notesHeader || '',
        notesFooter: updatedPayload.notesFooter || '',
      };

      const changes: NormalizedFieldChange[] = [];
      for (const { key, label } of PROCESS_FIELD_LABELS) {
        const beforeVal = oldSnapshot[key] ?? '';
        const afterVal = newSnapshot[key] ?? '';
        if (beforeVal !== afterVal) {
          changes.push({
            field: key,
            label,
            from: key.startsWith('notes') ? (beforeVal ? '[HTML]' : '(vazio)') : beforeVal || '(vazio)',
            to: key.startsWith('notes') ? (afterVal ? '[HTML atualizado]' : '(vazio)') : afterVal || '(vazio)',
          });
        }
      }

      const result = await db.transaction(async (tx) => {
        const [proc] = await tx
          .update(companyLegalProcesses)
          .set(updatedPayload)
          .where(eq(companyLegalProcesses.id, id))
          .returning();

        let movs: Array<typeof companyLegalProcessMovements.$inferSelect>;
        if (Array.isArray(body.movements)) {
          const prevMovs = await tx
            .select({ id: companyLegalProcessMovements.id })
            .from(companyLegalProcessMovements)
            .where(eq(companyLegalProcessMovements.processId, id));
          await tx.delete(companyLegalProcessMovements).where(eq(companyLegalProcessMovements.processId, id));
          movs = body.movements.length
            ? await tx
                .insert(companyLegalProcessMovements)
                .values(
                  body.movements.map((m: Record<string, any>) => ({
                    processId: id,
                    date: String(m.date || new Date().toISOString().slice(0, 10)),
                    type: String(m.type || 'DESPACHO'),
                    description: String(m.description || ''),
                    source: String(m.source || ''),
                  }))
                )
                .returning()
            : [];
          if (prevMovs.length !== movs.length) {
            changes.push({
              field: 'movements',
              label: 'Movimentações',
              from: `${prevMovs.length} registro(s)`,
              to: `${movs.length} registro(s)`,
            });
          }
        } else {
          movs = await tx
            .select()
            .from(companyLegalProcessMovements)
            .where(eq(companyLegalProcessMovements.processId, id))
            .orderBy(desc(companyLegalProcessMovements.date), desc(companyLegalProcessMovements.id));
        }

        let dls: Array<typeof companyLegalProcessDeadlines.$inferSelect>;
        if (Array.isArray(body.deadlines)) {
          const prevDls = await tx
            .select({ id: companyLegalProcessDeadlines.id })
            .from(companyLegalProcessDeadlines)
            .where(eq(companyLegalProcessDeadlines.processId, id));
          await tx.delete(companyLegalProcessDeadlines).where(eq(companyLegalProcessDeadlines.processId, id));
          dls = body.deadlines.length
            ? await tx
                .insert(companyLegalProcessDeadlines)
                .values(
                  body.deadlines.map((d: Record<string, any>) => ({
                    processId: id,
                    type: String(d.type || 'OUTRO'),
                    description: String(d.description || ''),
                    dueDate: String(d.dueDate || ''),
                    status: String(d.status || 'PENDENTE'),
                    responsibleId: d.responsibleId ? Number(d.responsibleId) : null,
                    notes: String(d.notes || ''),
                  }))
                )
                .returning()
            : [];
          if (prevDls.length !== dls.length) {
            changes.push({
              field: 'deadlines',
              label: 'Prazos',
              from: `${prevDls.length} prazo(s)`,
              to: `${dls.length} prazo(s)`,
            });
          }
        } else {
          dls = await tx
            .select()
            .from(companyLegalProcessDeadlines)
            .where(eq(companyLegalProcessDeadlines.processId, id))
            .orderBy(asc(companyLegalProcessDeadlines.dueDate), asc(companyLegalProcessDeadlines.id));
        }

        let hrs: Array<typeof companyLegalProcessHearings.$inferSelect>;
        if (Array.isArray(body.hearings)) {
          const prevHrs = await tx
            .select({ id: companyLegalProcessHearings.id })
            .from(companyLegalProcessHearings)
            .where(eq(companyLegalProcessHearings.processId, id));
          await tx.delete(companyLegalProcessHearings).where(eq(companyLegalProcessHearings.processId, id));
          hrs = body.hearings.length
            ? await tx
                .insert(companyLegalProcessHearings)
                .values(
                  body.hearings.map((h: Record<string, any>) => ({
                    processId: id,
                    type: String(h.type || 'INICIAL'),
                    date: String(h.date || ''),
                    time: String(h.time || ''),
                    location: String(h.location || ''),
                    status: String(h.status || 'AGENDADA'),
                    notes: String(h.notes || ''),
                  }))
                )
                .returning()
            : [];
          if (prevHrs.length !== hrs.length) {
            changes.push({
              field: 'hearings',
              label: 'Audiências',
              from: `${prevHrs.length} audiência(s)`,
              to: `${hrs.length} audiência(s)`,
            });
          }
        } else {
          hrs = await tx
            .select()
            .from(companyLegalProcessHearings)
            .where(eq(companyLegalProcessHearings.processId, id))
            .orderBy(asc(companyLegalProcessHearings.date), asc(companyLegalProcessHearings.time));
        }

        let atts: Array<typeof companyLegalProcessAttachments.$inferSelect>;
        if (preparedAttachments !== null) {
          const prevAtts = await tx
            .select({ id: companyLegalProcessAttachments.id })
            .from(companyLegalProcessAttachments)
            .where(eq(companyLegalProcessAttachments.processId, id));
          await tx.delete(companyLegalProcessAttachments).where(eq(companyLegalProcessAttachments.processId, id));
          atts = preparedAttachments.length
            ? await tx
                .insert(companyLegalProcessAttachments)
                .values(
                  preparedAttachments.map((a) => ({
                    processId: id,
                    title: a.title,
                    fileName: a.fileName,
                    mimeType: a.mimeType,
                    sizeBytes: a.sizeBytes,
                    sha256Hash: a.sha256Hash,
                    storageUri: a.storageUri,
                  }))
                )
                .returning()
            : [];
          if (prevAtts.length !== atts.length) {
            changes.push({
              field: 'attachments',
              label: 'Anexos',
              from: `${prevAtts.length} arquivo(s)`,
              to: `${atts.length} arquivo(s)`,
            });
          }
        } else {
          atts = await tx
            .select()
            .from(companyLegalProcessAttachments)
            .where(eq(companyLegalProcessAttachments.processId, id))
            .orderBy(desc(companyLegalProcessAttachments.id));
        }

        await tx.insert(auditLogs).values({
          userId: req.authUser!.id,
          userName: req.authUser!.name,
          action: 'PROCESS_UPDATED',
          entityType: 'company_legal_process',
          entityId: String(proc.id),
          details: {
            description: `Processo ${proc.processNumber} atualizado.`,
            changes,
          },
          unitId: proc.unitId,
        });

        return serializeProcessRow(proc, movs, dls, hrs, atts);
      });

      broadcast('company_legal:invalidate', { action: 'updated', id: result.id });
      res.json({ data: result });
    } catch (error) {
      console.error('PUT /api/company-legal/processes/:id error:', error);
      res.status(500).json({ error: 'Erro ao atualizar processo jurídico.' });
    }
  });

  // 7. Delete process
  app.delete('/api/company-legal/processes/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!canAccessAnyLegalModule(req)) {
        return res.status(403).json({ error: 'Acesso negado.' });
      }
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'ID inválido.' });

      const rows = await db
        .select()
        .from(companyLegalProcesses)
        .where(eq(companyLegalProcesses.id, id))
        .limit(1);
      const existing = rows[0];
      if (!existing) return res.status(404).json({ error: 'Processo não encontrado.' });

      const allowedUnits = getAllowedUnitsScope(req);
      if (allowedUnits !== null && existing.unitId !== null && !allowedUnits.includes(existing.unitId)) {
        return res.status(403).json({ error: 'Sem permissão para excluir processo desta unidade.' });
      }

      await db.transaction(async (tx) => {
        await tx.delete(companyLegalProcesses).where(eq(companyLegalProcesses.id, id));
        await tx.insert(auditLogs).values({
          userId: req.authUser!.id,
          userName: req.authUser!.name,
          action: 'PROCESS_DELETED',
          entityType: 'company_legal_process',
          entityId: String(id),
          details: {
            description: `Processo ${existing.processNumber} excluído.`,
            processNumber: existing.processNumber,
          },
          unitId: existing.unitId,
        });
      });

      broadcast('company_legal:invalidate', { action: 'deleted', id });
      res.json({ success: true, message: 'Processo excluído com sucesso.' });
    } catch (error) {
      console.error('DELETE /api/company-legal/processes/:id error:', error);
      res.status(500).json({ error: 'Erro ao excluir processo.' });
    }
  });

  // 8. Audit History per process (up to 500 events)
  app.get('/api/company-legal/processes/:id/audit-history', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!canAccessAnyLegalModule(req)) {
        return res.status(403).json({ error: 'Acesso negado.' });
      }
      const id = String(req.params.id || '').trim();
      if (!id) return res.json({ logs: [] });

      const limit = Math.min(500, Math.max(1, Number(req.query.limit || 500)));
      const rows = await db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.entityType, 'company_legal_process'), eq(auditLogs.entityId, id)))
        .orderBy(desc(auditLogs.createdAt))
        .limit(limit);

      res.json({ logs: rows });
    } catch (error) {
      console.error('GET /api/company-legal/processes/:id/audit-history error:', error);
      res.status(500).json({ error: 'Erro ao consultar histórico de alterações.' });
    }
  });

  // 9. Attachment binary preview / download from bucketdainvicta
  app.get('/api/company-legal/attachments/:id/content', requireAuth, async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'ID inválido.' });

      const attRows = await db
        .select()
        .from(companyLegalProcessAttachments)
        .where(eq(companyLegalProcessAttachments.id, id))
        .limit(1);
      const att = attRows[0];
      if (!att) return res.status(404).json({ error: 'Anexo não encontrado.' });

      const procRows = await db
        .select({ unitId: companyLegalProcesses.unitId })
        .from(companyLegalProcesses)
        .where(eq(companyLegalProcesses.id, att.processId))
        .limit(1);
      const allowedUnits = getAllowedUnitsScope(req);
      if (allowedUnits !== null && procRows[0]?.unitId !== null && !allowedUnits.includes(procRows[0].unitId)) {
        return res.status(403).json({ error: 'Sem permissão para acessar este anexo.' });
      }

      const buf = await getBucketObjectBuffer(att.sha256Hash, att.storageUri);
      if (!buf) return res.status(404).json({ error: 'Arquivo não encontrado no bucket.' });

      const safeName = sanitizeFileName(att.fileName);
      const disposition = req.query.preview === '1' && canPreviewInline(att.mimeType) ? 'inline' : 'attachment';
      res.setHeader('Content-Type', att.mimeType || 'application/octet-stream');
      res.setHeader('Content-Length', String(buf.length));
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'private, max-age=3600');
      res.setHeader('Content-Disposition', `${disposition}; filename="${safeName}"`);
      return res.send(buf);
    } catch (error) {
      console.error('GET /api/company-legal/attachments/:id/content error:', error);
      res.status(500).json({ error: 'Erro ao ler anexo.' });
    }
  });

  // 10. Automated 7 / 5 / 3 day alerts to internal messages
  app.post('/api/company-legal/deadline-alerts', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { summaryText } = (req.body || {}) as { summaryText?: string };
      const bodyText = String(summaryText || '').trim();
      if (!bodyText) return res.status(400).json({ error: 'Resumo vazio.' });

      const todayPrefix = new Date().toISOString().slice(0, 10);
      const recent = await db
        .select()
        .from(internalMessages)
        .where(eq(internalMessages.subject, 'Alerta de Prazos Jurídicos'))
        .orderBy(desc(internalMessages.createdAt))
        .limit(10);

      const alreadySentSameBodyToday = recent.some(
        (m) =>
          m.createdAt instanceof Date &&
          m.createdAt.toISOString().slice(0, 10) === todayPrefix &&
          m.body === bodyText
      );
      if (alreadySentSameBodyToday) {
        return res.json({ ok: true, deduplicated: true });
      }

      const [msg] = await db
        .insert(internalMessages)
        .values({
          senderId: req.authUser!.id,
          senderName: req.authUser!.name,
          recipientId: null,
          targetSector: 'geral',
          subject: 'Alerta de Prazos Jurídicos',
          body: bodyText,
        })
        .returning();

      broadcast('internal:message', msg);
      res.json({ ok: true, message: msg });
    } catch (error) {
      console.error('POST /api/company-legal/deadline-alerts error:', error);
      res.status(500).json({ error: 'Erro ao disparar alerta interno de prazos.' });
    }
  });

  // ===========================================================================
  // SHARED PARTNER DOCUMENTS PANEL & ACL ROUTES (Aba Anexos -> Parceiro)
  // ===========================================================================

  app.get('/api/company-legal/partner-documents', requireAuth, async (req: AuthRequest, res) => {
    try {
      const clientId = Number(req.query.clientId);
      if (!Number.isFinite(clientId)) return res.json({ items: [], total: 0, hasMore: false, nextCursor: null });

      const search = String(req.query.search || '').trim().toLowerCase();
      const filterCat = String(req.query.category || '').trim().toLowerCase();
      const cursor = Math.max(0, Number(req.query.cursor || 0));
      const limit = Math.min(50, Math.max(1, Number(req.query.limit || 25)));

      const allowedUnits = getAllowedUnitsScope(req);
      let docs = await db
        .select()
        .from(documentObjects)
        .where(and(eq(documentObjects.clientId, clientId), isNull(documentObjects.deletedAt)))
        .orderBy(desc(documentObjects.createdAt));

      if (allowedUnits !== null) {
        docs = docs.filter((d) => allowedUnits.includes(d.unitId));
      }

      const folderAcl =
        (await getSettingValue<{ groupIds?: number[]; userIds?: number[] }>(`legal_doc_acl_folder:${clientId}`)) || null;
      const legacyProtections =
        (await getSettingValue<
          Array<{ docId: number; fileName: string; module: string; category: string; protectedBy: string; protectedAt: string }>
        >(`legal_doc_legacy_protections:${clientId}`)) || [];
      const protectedMap = new Map(legacyProtections.map((p) => [p.docId, p]));

      const isAdmin = req.authUser!.role === 'admin';
      const userGroupId = req.authUser!.groupId;
      const userId = req.authUser!.id;

      // Filter & enrich ACL
      const enriched = await Promise.all(
        docs.map(async (d) => {
          const fileAcl = await getSettingValue<{ overrideEnabled?: boolean; groupIds?: number[]; userIds?: number[] }>(
            `legal_doc_acl_file:${d.id}`
          );
          const legacyProt = protectedMap.get(d.id) || null;
          const activeRule = fileAcl?.overrideEnabled ? fileAcl : folderAcl;
          const hasAcl = Boolean(fileAcl?.overrideEnabled || folderAcl || legacyProt);

          let userHasAclAccess = true;
          if (!isAdmin && activeRule && (hasAcl || legacyProt)) {
            const groupsAllowed = Array.isArray(activeRule.groupIds) ? activeRule.groupIds : [];
            const usersAllowed = Array.isArray(activeRule.userIds) ? activeRule.userIds : [];
            if (groupsAllowed.length === 0 && usersAllowed.length === 0) {
              userHasAclAccess = false; // only admins
            } else {
              userHasAclAccess =
                usersAllowed.includes(userId) || Boolean(userGroupId && groupsAllowed.includes(userGroupId));
            }
          }

          if (!userHasAclAccess) return null;

          const isProtectedContract =
            ['contrato', 'admissao_contrato', 'procuracao'].includes(String(d.docCategory || '').toLowerCase()) ||
            String(d.folderPath || '').toLowerCase().includes('/contratos');

          return {
            id: d.id,
            unitId: d.unitId,
            clientId: d.clientId,
            admissionId: d.admissionId,
            fileName: d.fileName,
            folderPath: d.folderPath,
            docCategory: d.docCategory,
            module: 'LEGAL',
            mimeType: d.mimeType,
            sizeBytes: d.sizeBytes,
            sha256Hash: d.sha256Hash,
            uploadedBy: d.uploadedBy,
            createdAt: d.createdAt instanceof Date ? d.createdAt.toISOString() : String(d.createdAt),
            hasAcl,
            hasFileOverride: Boolean(fileAcl?.overrideEnabled),
            isLegacyProtected: Boolean(legacyProt),
            isProtectedContract,
          };
        })
      );

      let filtered = enriched.filter((x): x is NonNullable<typeof x> => x !== null);
      if (filterCat) {
        filtered = filtered.filter((d) => String(d.docCategory || '').toLowerCase() === filterCat);
      }
      if (search) {
        filtered = filtered.filter((d) =>
          [d.fileName, d.folderPath, d.docCategory, d.uploadedBy].join(' ').toLowerCase().includes(search)
        );
      }

      const total = filtered.length;
      const pageItems = filtered.slice(cursor, cursor + limit);
      const nextCursor = cursor + pageItems.length < total ? cursor + pageItems.length : null;

      res.json({
        items: pageItems,
        total,
        hasMore: nextCursor !== null,
        nextCursor,
        folderAclConfigured: Boolean(folderAcl),
      });
    } catch (error) {
      console.error('GET /api/company-legal/partner-documents error:', error);
      res.status(500).json({ error: 'Erro ao listar documentos do parceiro.' });
    }
  });

  app.delete('/api/company-legal/partner-documents/:docId', requireAuth, async (req: AuthRequest, res) => {
    try {
      const docId = Number(req.params.docId);
      if (!Number.isFinite(docId)) return res.status(400).json({ error: 'ID inválido.' });

      const rows = await db.select().from(documentObjects).where(eq(documentObjects.id, docId)).limit(1);
      const doc = rows[0];
      if (!doc || doc.deletedAt) return res.status(404).json({ error: 'Documento não encontrado.' });

      const allowedUnits = getAllowedUnitsScope(req);
      if (allowedUnits !== null && !allowedUnits.includes(doc.unitId)) {
        return res.status(403).json({ error: 'Unidade do documento não autorizada.' });
      }

      const isProtectedContract =
        ['contrato', 'admissao_contrato', 'procuracao'].includes(String(doc.docCategory || '').toLowerCase()) ||
        String(doc.folderPath || '').toLowerCase().includes('/contratos');
      if (isProtectedContract) {
        return res.status(409).json({
          error: 'Arquivo protegido de contrato. Utilize a lixeira específica do dossiê de admissão/contratos para gerenciar este arquivo.',
        });
      }

      await db
        .update(documentObjects)
        .set({ deletedAt: new Date(), deletedBy: req.authUser!.name })
        .where(eq(documentObjects.id, docId));

      await db.insert(auditLogs).values({
        userId: req.authUser!.id,
        userName: req.authUser!.name,
        action: 'DOCUMENT_TRASHED',
        entityType: 'document_object',
        entityId: String(docId),
        details: { fileName: doc.fileName, source: 'company_legal_partner_docs' },
        unitId: doc.unitId,
      });

      res.json({ ok: true });
    } catch (error) {
      console.error('DELETE /api/company-legal/partner-documents/:docId error:', error);
      res.status(500).json({ error: 'Erro ao excluir documento do parceiro.' });
    }
  });

  app.get('/api/company-legal/acl/options', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const search = String(req.query.search || '').trim().toLowerCase();
      const page = Math.max(1, Number(req.query.page || 1));
      const limit = 50;

      const [allGroups, allUsers] = await Promise.all([
        db.select().from(userGroups).orderBy(asc(userGroups.name)),
        db.select().from(users).where(eq(users.active, true)).orderBy(asc(users.name)),
      ]);

      const filteredGroups = search
        ? allGroups.filter((g) => g.name.toLowerCase().includes(search))
        : allGroups;
      const filteredUsers = search
        ? allUsers.filter((u) => [u.name, u.email, u.role].join(' ').toLowerCase().includes(search))
        : allUsers;

      const offset = (page - 1) * limit;
      const pagedUsers = filteredUsers.slice(offset, offset + limit).map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
      }));

      res.json({
        groups: filteredGroups.map((g) => ({ id: g.id, name: g.name })),
        users: pagedUsers,
        totalUsers: filteredUsers.length,
        hasMoreUsers: offset + pagedUsers.length < filteredUsers.length,
      });
    } catch (error) {
      console.error('GET /api/company-legal/acl/options error:', error);
      res.status(500).json({ error: 'Erro ao carregar destinatários ACL.' });
    }
  });

  app.get('/api/company-legal/acl/folders/:clientId', requireAuth, requireAdmin, async (req, res) => {
    const clientId = Number(req.params.clientId);
    const rule = (await getSettingValue<{ groupIds: number[]; userIds: number[] }>(`legal_doc_acl_folder:${clientId}`)) || {
      groupIds: [],
      userIds: [],
    };
    res.json(rule);
  });

  app.put('/api/company-legal/acl/folders/:clientId', requireAuth, requireAdmin, async (req, res) => {
    const clientId = Number(req.params.clientId);
    const body = (req.body || {}) as { groupIds?: number[]; userIds?: number[] };
    const value = {
      groupIds: Array.isArray(body.groupIds) ? body.groupIds.map(Number) : [],
      userIds: Array.isArray(body.userIds) ? body.userIds.map(Number) : [],
    };
    await upsertSettingValue(`legal_doc_acl_folder:${clientId}`, value);
    res.json(value);
  });

  app.get('/api/company-legal/acl/files/:docId', requireAuth, requireAdmin, async (req, res) => {
    const docId = Number(req.params.docId);
    const rule = (await getSettingValue<{ overrideEnabled: boolean; groupIds: number[]; userIds: number[] }>(
      `legal_doc_acl_file:${docId}`
    )) || {
      overrideEnabled: false,
      groupIds: [],
      userIds: [],
    };
    res.json(rule);
  });

  app.put('/api/company-legal/acl/files/:docId', requireAuth, requireAdmin, async (req, res) => {
    const docId = Number(req.params.docId);
    const body = (req.body || {}) as { overrideEnabled?: boolean; groupIds?: number[]; userIds?: number[] };
    const value = {
      overrideEnabled: Boolean(body.overrideEnabled),
      groupIds: body.overrideEnabled && Array.isArray(body.groupIds) ? body.groupIds.map(Number) : [],
      userIds: body.overrideEnabled && Array.isArray(body.userIds) ? body.userIds.map(Number) : [],
    };
    await upsertSettingValue(`legal_doc_acl_file:${docId}`, value);
    res.json(value);
  });

  app.post('/api/company-legal/acl/legacy/:clientId/impact', requireAuth, requireAdmin, async (req, res) => {
    const clientId = Number(req.params.clientId);
    const body = (req.body || {}) as { attachmentIds?: number[] };
    const ids = Array.isArray(body.attachmentIds) ? body.attachmentIds.slice(0, 500).map(Number) : [];
    const folderAcl = await getSettingValue<{ groupIds?: number[]; userIds?: number[] }>(`legal_doc_acl_folder:${clientId}`);
    const docs = ids.length
      ? await db.select().from(documentObjects).where(inArray(documentObjects.id, ids))
      : [];
    res.json({
      legacyCount: docs.length,
      folderConfigured: Boolean(folderAcl),
      groupsCount: folderAcl?.groupIds?.length || 0,
      usersCount: folderAcl?.userIds?.length || 0,
      files: docs.map((d) => ({
        id: d.id,
        fileName: d.fileName,
        module: 'LEGAL',
        category: d.docCategory,
      })),
    });
  });

  app.post('/api/company-legal/acl/legacy/:clientId/protect', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    const clientId = Number(req.params.clientId);
    const body = (req.body || {}) as { attachmentIds?: number[] };
    const ids = Array.isArray(body.attachmentIds) ? body.attachmentIds.slice(0, 500).map(Number) : [];
    const folderAcl = await getSettingValue<{ groupIds?: number[]; userIds?: number[] }>(`legal_doc_acl_folder:${clientId}`);
    if (!folderAcl) {
      return res.status(400).json({ error: 'Configure primeiro a regra de acesso da pasta do parceiro.' });
    }
    const docs = ids.length
      ? await db.select().from(documentObjects).where(inArray(documentObjects.id, ids))
      : [];

    const existing =
      (await getSettingValue<
        Array<{ docId: number; fileName: string; module: string; category: string; protectedBy: string; protectedAt: string }>
      >(`legal_doc_legacy_protections:${clientId}`)) || [];
    const existingIds = new Set(existing.map((x) => x.docId));
    const nowIso = new Date().toISOString();

    const appended = [...existing];
    for (const d of docs) {
      if (!existingIds.has(d.id)) {
        appended.push({
          docId: d.id,
          fileName: d.fileName,
          module: 'LEGAL',
          category: d.docCategory,
          protectedBy: req.authUser!.name,
          protectedAt: nowIso,
        });
      }
    }

    await upsertSettingValue(`legal_doc_legacy_protections:${clientId}`, appended as unknown as Record<string, unknown>);
    res.json({ ok: true, count: appended.length });
  });

  app.get('/api/company-legal/acl/legacy/:clientId/protected', requireAuth, requireAdmin, async (req, res) => {
    const clientId = Number(req.params.clientId);
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = 15;
    const all =
      (await getSettingValue<
        Array<{ docId: number; fileName: string; module: string; category: string; protectedBy: string; protectedAt: string }>
      >(`legal_doc_legacy_protections:${clientId}`)) || [];
    const sorted = [...all].reverse();
    const offset = (page - 1) * limit;
    res.json({
      items: sorted.slice(offset, offset + limit),
      total: sorted.length,
      page,
      totalPages: Math.max(1, Math.ceil(sorted.length / limit)),
    });
  });

  app.delete('/api/company-legal/acl/legacy/:clientId/protect/:docId', requireAuth, requireAdmin, async (req, res) => {
    const clientId = Number(req.params.clientId);
    const docId = Number(req.params.docId);
    const all =
      (await getSettingValue<
        Array<{ docId: number; fileName: string; module: string; category: string; protectedBy: string; protectedAt: string }>
      >(`legal_doc_legacy_protections:${clientId}`)) || [];
    const next = all.filter((x) => x.docId !== docId);
    await upsertSettingValue(`legal_doc_legacy_protections:${clientId}`, next as unknown as Record<string, unknown>);
    res.json({ ok: true });
  });
}
