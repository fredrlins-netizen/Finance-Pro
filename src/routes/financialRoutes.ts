import crypto from 'node:crypto';
import type { Express } from 'express';
import { and, asc, count, desc, eq, ilike, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import {
  admissions,
  auditLogs,
  bankAccounts,
  bankMovements,
  bearers,
  chartOfAccounts,
  clients,
  collaborators,
  collectionCases,
  departments,
  documentObjects,
  documentTypes,
  financialTitles,
  legalMovements,
  legalProcesses,
  negotiations,
  recalcScenarios,
  systemSettings,
  titleSettlements,
  whatsappMessages,
  whatsappThreads,
} from '../db/schema.ts';
import { ensureInitialSeed } from '../db/seed.ts';
import {
  AuthRequest,
  getAllowedUnitIds,
  isUnitPermitted,
  requireAnyModule,
  requireAuth,
  requireModule,
} from '../middleware/auth.ts';
import { iviDraftCollectionMessage } from '../services/ivi.ts';
import { dispatchIviSectorNotification } from '../services/internalMessaging.ts';
import { emitSantanderBoletoForTitle, emitSantanderPixForTitle } from '../services/santander.ts';
import { getEntityLabel, getEntityTypeAliases, normalizeAuditLogRecord } from '../utils/auditDiff.ts';
import {
  parseFiniteNumber,
  parsePositiveIntArray,
  parsePositiveIntId,
  parseSafeDate,
  sanitizeErrorMessage,
} from '../utils/validation.ts';

class ValidationError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

function entityTypeForScope(scope: string): string {
  return String(scope).toUpperCase() === 'PAGAR' ? 'CONTA_PAGAR' : 'CONTA_RECEBER';
}

function normStatusUpper(raw: string | null | undefined): string {
  const s = String(raw || 'ABERTO').trim().toUpperCase();
  if (s === 'VENCIDO') return 'ABERTO';
  return s;
}

function formatCentsPtBr(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function parseDateIso(val: unknown, fallback?: Date): Date {
  if (val === null || val === undefined || String(val).trim() === '') {
    return fallback || new Date();
  }
  const d = parseSafeDate(val);
  if (!d) {
    throw new ValidationError('Data informada em formato inválido.', 400);
  }
  return d;
}

async function writeTitleAudit(
  req: AuthRequest,
  action: string,
  scope: string,
  entityId: number | string,
  changes: Array<{ field: string; from: string; to: string }>,
  unitId?: number | null
) {
  await db.insert(auditLogs).values({
    userId: req.authUser?.id ?? null,
    userName: req.authUser?.name || 'Sistema',
    action,
    entityType: entityTypeForScope(scope),
    entityId: String(entityId),
    details: { changes },
    unitId: unitId ?? req.activeUnitId ?? 1,
  });
}

export function registerFinancialRoutes(
  app: Express,
  deps: { broadcast: (event: string, payload: unknown) => void }
) {
  const requireFinColl = requireAnyModule('finance', 'collection', 'audit');

  // 1. Listar títulos financeiros por escopo (RECEBER | PAGAR), com paginação e baixas agregadas
  app.get('/api/financial-titles', requireAuth, requireFinColl, async (req: AuthRequest, res) => {
    try {
      await ensureInitialSeed();
      const scopeParam = String(req.query.scope || 'RECEBER').toUpperCase();
      const scope = scopeParam === 'PAGAR' ? 'PAGAR' : 'RECEBER';
      const search = String(req.query.search || '').trim().toLowerCase();
      const rawPage = Number(req.query.page || 1);
      const rawPageSize = Number(req.query.pageSize || 50);
      const page = Number.isFinite(rawPage) ? Math.max(1, Math.trunc(rawPage)) : 1;
      const pageSize = Number.isFinite(rawPageSize) ? Math.min(200, Math.max(10, Math.trunc(rawPageSize))) : 50;
      const allowedUnits = getAllowedUnitIds(req);

      const allClients = await db.select().from(clients);
      const clientMap = new Map(allClients.map((c) => [c.id, c]));

      const rows = await db
        .select()
        .from(financialTitles)
        .where(
          allowedUnits !== null
            ? and(eq(financialTitles.scope, scope), inArray(financialTitles.unitId, allowedUnits))
            : eq(financialTitles.scope, scope)
        )
        .orderBy(asc(financialTitles.dueDate), asc(financialTitles.id));

      const filtered = search
        ? rows.filter((r) => {
            const clName = (r.clientName || clientMap.get(r.clientId)?.fullName || '').toLowerCase();
            const doc = (r.documentNumber || r.titleCode || '').toLowerCase();
            const descText = (r.description || '').toLowerCase();
            return clName.includes(search) || doc.includes(search) || descText.includes(search);
          })
        : rows;

      const total = filtered.length;
      const offset = (page - 1) * pageSize;
      const paged = filtered.slice(offset, offset + pageSize);

      const titleIds = paged.map((t) => t.id);
      const settlementsList =
        titleIds.length > 0
          ? await db
              .select()
              .from(titleSettlements)
              .where(inArray(titleSettlements.titleId, titleIds))
              .orderBy(desc(titleSettlements.settlementDate), desc(titleSettlements.id))
          : [];

      const settlementsByTitle: Record<number, typeof settlementsList> = {};
      for (const s of settlementsList) {
        if (!settlementsByTitle[s.titleId]) settlementsByTitle[s.titleId] = [];
        settlementsByTitle[s.titleId].push(s);
      }

      res.json({
        titles: paged,
        total,
        page,
        pageSize,
        settlementsByTitle,
      });
    } catch (error) {
      console.error('GET /api/financial-titles error:', error);
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao listar títulos financeiros.') });
    }
  });

  // 2. Criar título financeiro (RECEBER ou PAGAR)
  app.post('/api/financial-titles', requireAuth, requireFinColl, async (req: AuthRequest, res) => {
    try {
      const b = (req.body || {}) as Record<string, unknown>;
      const scope = String(b.scope || 'RECEBER').toUpperCase() === 'PAGAR' ? 'PAGAR' : 'RECEBER';
      const documentNumber = String(b.documentNumber || '').trim();
      const clientId = parsePositiveIntId(b.clientId);
      const documentTypeId = parsePositiveIntId(b.documentTypeId);
      const bearerId = parsePositiveIntId(b.bearerId);
      const description = String(b.description || '').trim();
      const rawAmount = parseFiniteNumber(b.amountCents);
      const amountCents = rawAmount !== null ? Math.round(rawAmount) : 0;

      if (!documentNumber) return res.status(400).json({ error: 'Nº Documento é obrigatório.' });
      if (!clientId) {
        return res.status(400).json({
          error: scope === 'PAGAR' ? 'Selecione um Fornecedor válido.' : 'Selecione um Parceiro / Cliente válido.',
        });
      }
      if (!documentTypeId) return res.status(400).json({ error: 'Tipo de Documento é obrigatório.' });
      if (!bearerId) return res.status(400).json({ error: 'Portador é obrigatório.' });
      if (!description) return res.status(400).json({ error: 'Histórico é obrigatório.' });
      if (amountCents <= 0) return res.status(400).json({ error: 'Valor Total deve ser maior que zero.' });

      const [clientRow] = await db.select().from(clients).where(eq(clients.id, clientId)).limit(1);
      if (!clientRow) return res.status(404).json({ error: 'Cadastro de pessoa não encontrado.' });
      if (!isUnitPermitted(req, clientRow.unitId)) {
        return res.status(403).json({ error: 'Sem permissão para operar cadastros desta unidade.' });
      }
      if (clientRow.status === 'suspenso' || clientRow.status === 'cancelado') {
        return res.status(403).json({
          error: `Operação bloqueada: ${clientRow.fullName} está com status "${clientRow.status.toUpperCase()}".`,
        });
      }

      const unitId = parsePositiveIntId(b.unitId) || clientRow.unitId || req.activeUnitId || 1;
      if (!isUnitPermitted(req, unitId)) {
        return res.status(403).json({ error: 'Sem permissão para criar títulos na unidade informada.' });
      }

      const admissionId = b.admissionId ? parsePositiveIntId(b.admissionId) : null;
      const chartAccountId = b.chartAccountId ? parsePositiveIntId(b.chartAccountId) : null;
      const departmentId = b.departmentId ? parsePositiveIntId(b.departmentId) : null;
      const bankAccountId = b.bankAccountId ? parsePositiveIntId(b.bankAccountId) : null;
      const sellerId = b.sellerId ? parsePositiveIntId(b.sellerId) : null;
      const assignedCollaboratorId = b.assignedCollaboratorId ? parsePositiveIntId(b.assignedCollaboratorId) : null;

      const titleType = ['PADRAO', 'ADIANTAMENTO', 'DEVOLUCAO', 'FATURA'].includes(String(b.titleType || '').toUpperCase())
        ? String(b.titleType).toUpperCase()
        : 'PADRAO';
      const isProtested = titleType === 'PADRAO' && Boolean(b.isProtested);
      const isProvision = titleType === 'PADRAO' && !isProtested && Boolean(b.isProvision);

      let initialStatus = 'ABERTO';
      if (titleType === 'ADIANTAMENTO') initialStatus = 'ADIANTAMENTO';
      else if (titleType === 'DEVOLUCAO') initialStatus = 'DEVOLUCAO';
      else if (isProtested) initialStatus = 'PROTESTADO';
      else if (isProvision) initialStatus = 'PROVISAO';

      const issueDate = parseDateIso(b.issueDate, new Date());
      const dueDate = parseDateIso(b.dueDate, new Date());
      const forecastDate = parseDateIso(b.forecastDate, dueDate);
      const discountValidUntil = b.discountValidUntil ? parseDateIso(b.discountValidUntil) : null;
      const prefix = scope === 'PAGAR' ? 'PAG' : 'REC';
      const titleCode = `${prefix}-${new Date().getFullYear()}-${Date.now().toString().slice(-6)}-${Math.floor(10 + Math.random() * 89)}`;

      const interestVal = parseFiniteNumber(b.interestCents) ?? 0;
      const fineVal = parseFiniteNumber(b.fineCents) ?? 0;
      const discountVal = parseFiniteNumber(b.discountCents) ?? 0;
      const instNum = parsePositiveIntId(b.installmentNumber) || 1;
      const totInst = parsePositiveIntId(b.totalInstallments) || 1;

      const [created] = await db
        .insert(financialTitles)
        .values({
          titleCode,
          scope,
          titleType,
          origin: String(b.origin || 'MANUAL'),
          documentNumber,
          description,
          clientId,
          clientName: clientRow.fullName,
          admissionId,
          unitId,
          chartAccountId,
          documentTypeId,
          bearerId,
          departmentId,
          bankAccountId,
          sellerId,
          assignedCollaboratorId,
          installmentNumber: instNum,
          totalInstallments: totInst,
          isInitialFee: false,
          amountCents,
          originalValueCents: amountCents,
          currentBalanceCents: amountCents,
          interestCents: Math.max(0, Math.round(interestVal)),
          fineCents: Math.max(0, Math.round(fineVal)),
          discountCents: Math.max(0, Math.round(discountVal)),
          discountValidUntil,
          issueDate,
          dueDate,
          forecastDate,
          status: initialStatus,
          collectionStatus: scope === 'RECEBER' ? String(b.collectionStatus || 'COBRAR') : 'EM_DIA',
          accountingType: String(b.accountingType || 'NAO_CONTABIL'),
          isProtested,
          isProvision,
          boletoProvider: 'santander',
        })
        .returning();

      await writeTitleAudit(
        req,
        'CREATE_TITLE',
        scope,
        created.id,
        [
          { field: 'Documento', from: '', to: created.documentNumber },
          { field: scope === 'PAGAR' ? 'Fornecedor' : 'Parceiro', from: '', to: clientRow.fullName },
          { field: 'Valor', from: '', to: formatCentsPtBr(created.amountCents) },
          { field: 'Vencimento', from: '', to: created.dueDate.toISOString().slice(0, 10) },
          { field: 'Status', from: '', to: created.status },
        ],
        unitId
      );

      if (scope === 'RECEBER' && created.collectionStatus === 'COBRAR') {
        await dispatchIviSectorNotification(
          {
            targetSector: 'cobranca',
            targetUnitId: unitId,
            relatedEntityType: 'financial_title',
            relatedEntityId: created.id,
            senderName: 'Ivi IA · Financeiro',
            subject: `Novo Título em Carteira · ${clientRow.fullName}`,
            body: `Título ${created.documentNumber} (${formatCentsPtBr(created.amountCents)}, venc. ${created.dueDate.toISOString().slice(0, 10)}) lançado para acompanhamento de Cobrança.`,
          },
          db,
          deps.broadcast
        );
      } else {
        await dispatchIviSectorNotification(
          {
            targetSector: 'financeiro',
            targetUnitId: unitId,
            relatedEntityType: 'financial_title',
            relatedEntityId: created.id,
            senderName: 'Ivi IA · Financeiro',
            subject: `Novo Lançamento (${scope}) · ${created.documentNumber}`,
            body: `Lançamento para ${clientRow.fullName} no valor de ${formatCentsPtBr(created.amountCents)} registrado em Administração Financeira.`,
          },
          db,
          deps.broadcast
        );
      }

      let finalTitle = created;
      let santanderWarning: string | undefined;
      if (scope === 'RECEBER' && (b.emitSantanderBoleto || b.emitSantanderPix)) {
        try {
          if (b.emitSantanderBoleto) {
            const resBol = await emitSantanderBoletoForTitle({
              titleId: created.id,
              bankAccountId,
              actorName: req.authUser?.name || 'Financeiro',
            });
            finalTitle = resBol.title;
          }
          if (b.emitSantanderPix) {
            const resPix = await emitSantanderPixForTitle({
              titleId: created.id,
              bankAccountId,
              chargeType: b.pixChargeType === 'cob' ? 'cob' : undefined,
              actorName: req.authUser?.name || 'Financeiro',
            });
            finalTitle = resPix.title;
          }
        } catch (emErr) {
          santanderWarning = emErr instanceof Error ? emErr.message : 'Título salvo, mas emissão Santander falhou.';
        }
      }

      res.json({ title: finalTitle, ...(santanderWarning ? { santanderWarning } : {}) });
    } catch (error) {
      console.error('POST /api/financial-titles error:', error);
      const status = error instanceof ValidationError ? error.statusCode : 500;
      res.status(status).json({ error: sanitizeErrorMessage(error, 'Erro ao criar título.') });
    }
  });

  // 3. Atualizar título financeiro
  app.put('/api/financial-titles/:id', requireAuth, requireFinColl, async (req: AuthRequest, res) => {
    try {
      const id = parsePositiveIntId(req.params.id);
      if (!id) return res.status(400).json({ error: 'ID de título inválido.' });
      const [existing] = await db.select().from(financialTitles).where(eq(financialTitles.id, id)).limit(1);
      if (!existing) return res.status(404).json({ error: 'Título não encontrado.' });
      if (!isUnitPermitted(req, existing.unitId)) {
        return res.status(403).json({ error: 'Sem permissão para alterar títulos desta unidade.' });
      }

      const b = (req.body || {}) as Record<string, unknown>;
      const scope = existing.scope || 'RECEBER';
      const clientId = b.clientId !== undefined ? parsePositiveIntId(b.clientId) : existing.clientId;
      if (!clientId) return res.status(400).json({ error: 'Cliente / Fornecedor inválido.' });
      const [clientRow] = await db.select().from(clients).where(eq(clients.id, clientId)).limit(1);
      if (!clientRow) return res.status(404).json({ error: 'Cadastro de pessoa não encontrado.' });
      if (!isUnitPermitted(req, clientRow.unitId)) {
        return res.status(403).json({ error: 'Sem permissão para vincular cadastro de outra unidade.' });
      }
      if (b.unitId !== undefined) {
        const nextUnitId = parsePositiveIntId(b.unitId);
        if (!nextUnitId || !isUnitPermitted(req, nextUnitId)) {
          return res.status(403).json({ error: 'Sem permissão para mover título para esta unidade.' });
        }
      }
      if (clientRow.status === 'suspenso' || clientRow.status === 'cancelado') {
        return res.status(403).json({
          error: `Operação bloqueada: ${clientRow.fullName} está com status "${clientRow.status.toUpperCase()}".`,
        });
      }

      const documentNumber = String(b.documentNumber ?? existing.documentNumber).trim();
      const description = String(b.description ?? existing.description).trim();
      if (!documentNumber || !description) {
        return res.status(400).json({ error: 'Nº Documento e Histórico são obrigatórios.' });
      }

      const existingUpper = normStatusUpper(existing.status);
      const isFinalOrGrouped = ['PAGO', 'CANCELADO', 'AGRUPADO', 'FATURA_GERADA'].includes(existingUpper);
      const titleType = ['PADRAO', 'ADIANTAMENTO', 'DEVOLUCAO', 'FATURA'].includes(String(b.titleType || existing.titleType))
        ? String(b.titleType || existing.titleType)
        : existing.titleType;

      const requestedStatusRaw = b.status ? normStatusUpper(String(b.status)) : '';
      const explicitEditableStatus = ['ABERTO', 'PARCIAL', 'PROTESTADO', 'PROVISAO'].includes(requestedStatusRaw)
        ? requestedStatusRaw
        : '';

      let nextProtested = !isFinalOrGrouped && titleType === 'PADRAO' ? Boolean(b.isProtested) : existing.isProtested;
      let nextProvision = !isFinalOrGrouped && titleType === 'PADRAO' && !nextProtested ? Boolean(b.isProvision) : existing.isProvision;
      if (!isFinalOrGrouped && explicitEditableStatus) {
        nextProtested = explicitEditableStatus === 'PROTESTADO';
        nextProvision = explicitEditableStatus === 'PROVISAO';
      }

      let nextStatus = existing.status;
      if (!isFinalOrGrouped) {
        if (titleType === 'ADIANTAMENTO') nextStatus = 'ADIANTAMENTO';
        else if (titleType === 'DEVOLUCAO') nextStatus = 'DEVOLUCAO';
        else if (explicitEditableStatus) nextStatus = explicitEditableStatus;
        else if (nextProtested) nextStatus = 'PROTESTADO';
        else if (nextProvision) nextStatus = 'PROVISAO';
        else nextStatus = existingUpper === 'PARCIAL' ? 'PARCIAL' : 'ABERTO';
      }

      const nextAmountCents =
        b.amountCents !== undefined && !Number.isNaN(Number(b.amountCents)) && Number(b.amountCents) >= 0
          ? Math.round(Number(b.amountCents))
          : existing.amountCents;
      const settledRows = await db.select().from(titleSettlements).where(eq(titleSettlements.titleId, id));
      const settledSum = settledRows.reduce((acc, s) => acc + Number(s.amountCents || 0), 0);
      const nextOriginalCents = existing.originalValueCents > 0 ? existing.originalValueCents : existing.amountCents;
      const nextBalance =
        existingUpper === 'CANCELADO' || existingUpper === 'AGRUPADO' || existingUpper === 'PAGO'
          ? 0
          : Math.max(0, nextAmountCents - settledSum);

      const nextDueDate = b.dueDate ? parseDateIso(b.dueDate, existing.dueDate) : existing.dueDate;
      const nextIssueDate = b.issueDate ? parseDateIso(b.issueDate, existing.issueDate) : existing.issueDate;
      const nextForecastDate =
        b.forecastDate === null || b.forecastDate === ''
          ? null
          : b.forecastDate
          ? parseDateIso(b.forecastDate, nextDueDate)
          : existing.forecastDate;

      const nextAssignedCollaboratorId =
        b.assignedCollaboratorId !== undefined
          ? b.assignedCollaboratorId
            ? Number(b.assignedCollaboratorId)
            : null
          : existing.assignedCollaboratorId;

      const [updated] = await db
        .update(financialTitles)
        .set({
          titleType,
          documentNumber,
          description,
          clientId,
          clientName: clientRow.fullName,
          unitId: b.unitId ? Number(b.unitId) : existing.unitId,
          chartAccountId: b.chartAccountId !== undefined ? (b.chartAccountId ? Number(b.chartAccountId) : null) : existing.chartAccountId,
          documentTypeId: b.documentTypeId !== undefined ? (b.documentTypeId ? Number(b.documentTypeId) : null) : existing.documentTypeId,
          bearerId: b.bearerId !== undefined ? (b.bearerId ? Number(b.bearerId) : null) : existing.bearerId,
          departmentId: b.departmentId !== undefined ? (b.departmentId ? Number(b.departmentId) : null) : existing.departmentId,
          bankAccountId: b.bankAccountId !== undefined ? (b.bankAccountId ? Number(b.bankAccountId) : null) : existing.bankAccountId,
          sellerId: b.sellerId !== undefined ? (b.sellerId ? Number(b.sellerId) : null) : existing.sellerId,
          assignedCollaboratorId: nextAssignedCollaboratorId,
          installmentNumber:
            !existing.parentId && !existing.recurrenceId && b.installmentNumber
              ? Math.max(1, Number(b.installmentNumber))
              : existing.installmentNumber,
          totalInstallments:
            !existing.parentId && !existing.recurrenceId && b.totalInstallments
              ? Math.max(1, Number(b.totalInstallments))
              : existing.totalInstallments,
          amountCents: nextAmountCents,
          originalValueCents: nextOriginalCents,
          currentBalanceCents: nextBalance,
          interestCents: b.interestCents !== undefined ? Math.max(0, Math.round(Number(b.interestCents))) : existing.interestCents,
          fineCents: b.fineCents !== undefined ? Math.max(0, Math.round(Number(b.fineCents))) : existing.fineCents,
          discountCents: b.discountCents !== undefined ? Math.max(0, Math.round(Number(b.discountCents))) : existing.discountCents,
          discountValidUntil: b.discountValidUntil ? parseDateIso(b.discountValidUntil) : existing.discountValidUntil,
          issueDate: nextIssueDate,
          dueDate: nextDueDate,
          forecastDate: nextForecastDate,
          collectionStatus:
            scope === 'RECEBER' ? String(b.collectionStatus || existing.collectionStatus || 'COBRAR') : existing.collectionStatus,
          accountingType: String(b.accountingType || existing.accountingType || 'NAO_CONTABIL'),
          isProtested: nextProtested,
          isProvision: nextProvision,
          status: nextStatus,
          updatedAt: new Date(),
        })
        .where(eq(financialTitles.id, id))
        .returning();

      const changes: Array<{ field: string; from: string; to: string }> = [];
      if (existing.documentNumber !== updated.documentNumber) {
        changes.push({ field: 'Nº Documento', from: existing.documentNumber, to: updated.documentNumber });
      }
      if (existing.description !== updated.description) {
        changes.push({ field: 'Histórico', from: existing.description, to: updated.description });
      }
      if (existing.dueDate.toISOString().slice(0, 10) !== updated.dueDate.toISOString().slice(0, 10)) {
        changes.push({
          field: 'Vencimento',
          from: existing.dueDate.toISOString().slice(0, 10),
          to: updated.dueDate.toISOString().slice(0, 10),
        });
      }
      const prevForecast = existing.forecastDate ? existing.forecastDate.toISOString().slice(0, 10) : '—';
      const nextForecastStr = updated.forecastDate ? updated.forecastDate.toISOString().slice(0, 10) : '—';
      if (prevForecast !== nextForecastStr) {
        changes.push({ field: 'Previsão Recebimento', from: prevForecast, to: nextForecastStr });
      }
      if (existing.amountCents !== updated.amountCents) {
        changes.push({
          field: 'Valor Total',
          from: formatCentsPtBr(existing.amountCents),
          to: formatCentsPtBr(updated.amountCents),
        });
      }
      if (existing.interestCents !== updated.interestCents) {
        changes.push({ field: 'Juros', from: formatCentsPtBr(existing.interestCents), to: formatCentsPtBr(updated.interestCents) });
      }
      if (existing.fineCents !== updated.fineCents) {
        changes.push({ field: 'Multa', from: formatCentsPtBr(existing.fineCents), to: formatCentsPtBr(updated.fineCents) });
      }
      if (existing.discountCents !== updated.discountCents) {
        changes.push({ field: 'Desconto', from: formatCentsPtBr(existing.discountCents), to: formatCentsPtBr(updated.discountCents) });
      }
      if (existing.status !== updated.status) {
        changes.push({ field: 'Status', from: existing.status, to: updated.status });
      }
      if ((existing.collectionStatus || 'COBRAR') !== (updated.collectionStatus || 'COBRAR')) {
        changes.push({
          field: 'Situação Cobrança',
          from: existing.collectionStatus || 'COBRAR',
          to: updated.collectionStatus || 'COBRAR',
        });
      }
      if ((existing.assignedCollaboratorId ?? null) !== (updated.assignedCollaboratorId ?? null)) {
        const allCollabs = await db.select().from(collaborators);
        const cMap = new Map(allCollabs.map((c) => [c.id, c.name]));
        const fromName = existing.assignedCollaboratorId
          ? cMap.get(existing.assignedCollaboratorId) || `#${existing.assignedCollaboratorId}`
          : 'Sem atribuição';
        const toName = updated.assignedCollaboratorId
          ? cMap.get(updated.assignedCollaboratorId) || `#${updated.assignedCollaboratorId}`
          : 'Sem atribuição';
        changes.push({
          field: existing.assignedCollaboratorId ? 'Transferência de Operador' : 'Responsável Cobrança',
          from: fromName,
          to: toName,
        });
      }
      if (changes.length === 0) {
        changes.push({ field: 'Atualização', from: 'Dados mantidos', to: 'Classificações atualizadas' });
      }

      if (scope === 'RECEBER' && (existing.assignedCollaboratorId ?? null) !== (updated.assignedCollaboratorId ?? null)) {
        let linkedUserId: number | null = null;
        if (updated.assignedCollaboratorId) {
          const [collabRow] = await db
            .select({ userId: collaborators.userId })
            .from(collaborators)
            .where(eq(collaborators.id, updated.assignedCollaboratorId))
            .limit(1);
          linkedUserId = collabRow?.userId ?? null;
        }
        await db
          .update(collectionCases)
          .set({ assignedCollectorId: linkedUserId, updatedAt: new Date() })
          .where(eq(collectionCases.titleId, id));
      }

      const auditAction =
        existing.assignedCollaboratorId &&
        updated.assignedCollaboratorId &&
        existing.assignedCollaboratorId !== updated.assignedCollaboratorId
          ? 'TRANSFER_COLLECTION'
          : 'UPDATE_TITLE';
      await writeTitleAudit(req, auditAction, scope, id, changes, updated.unitId);
      deps.broadcast('collection:payment', { titleId: id, operator: req.authUser?.name || 'Sistema' });
      res.json({ title: updated });
    } catch (error) {
      console.error('PUT /api/financial-titles/:id error:', error);
      const status = error instanceof ValidationError ? error.statusCode : 500;
      res.status(status).json({ error: sanitizeErrorMessage(error, 'Erro ao atualizar título.') });
    }
  });

  // 4. Excluir título definitivamente (somente CANCELADO e sem liquidações/vínculos pagos)
  app.delete('/api/financial-titles/:id', requireAuth, requireFinColl, async (req: AuthRequest, res) => {
    try {
      const id = parsePositiveIntId(req.params.id);
      if (!id) return res.status(400).json({ error: 'ID de título inválido.' });
      const [existing] = await db.select().from(financialTitles).where(eq(financialTitles.id, id)).limit(1);
      if (!existing) return res.status(404).json({ error: 'Título não encontrado.' });
      if (!isUnitPermitted(req, existing.unitId)) {
        return res.status(403).json({ error: 'Sem permissão para excluir títulos desta unidade.' });
      }

      if (normStatusUpper(existing.status) !== 'CANCELADO') {
        return res.status(409).json({
          error: 'Exclusão definitiva permitida somente para títulos com status CANCELADO. Cancele o título antes de excluir.',
        });
      }

      const [settleCount] = await db
        .select({ v: count() })
        .from(titleSettlements)
        .where(eq(titleSettlements.titleId, id));
      if (Number(settleCount?.v || 0) > 0) {
        return res.status(409).json({
          error: 'Este título possui histórico de baixas vinculado e não pode ser excluído permanentemente.',
        });
      }

      const [childCount] = await db
        .select({ v: count() })
        .from(financialTitles)
        .where(eq(financialTitles.parentId, id));
      if (Number(childCount?.v || 0) > 0) {
        return res.status(409).json({
          error: 'Existem parcelas recorrentes vinculadas a este título modelo.',
        });
      }

      await db.transaction(async (tx) => {
        await tx.delete(collectionCases).where(eq(collectionCases.titleId, id));
        await tx.delete(financialTitles).where(eq(financialTitles.id, id));
      });
      await writeTitleAudit(
        req,
        'DELETE_TITLE',
        existing.scope || 'RECEBER',
        id,
        [{ field: 'Título Excluído', from: `${existing.documentNumber || existing.titleCode} · ${formatCentsPtBr(existing.amountCents)}`, to: 'REMOVIDO' }],
        existing.unitId
      );
      res.json({ ok: true });
    } catch (error) {
      console.error('DELETE /api/financial-titles/:id error:', error);
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao excluir título.') });
    }
  });

  // 5. Listar baixas de um título
  app.get('/api/financial-titles/:id/settlements', requireAuth, requireFinColl, async (req: AuthRequest, res) => {
    try {
      const titleId = parsePositiveIntId(req.params.id);
      if (!titleId) return res.status(400).json({ error: 'ID de título inválido.' });
      const [titleRow] = await db.select({ id: financialTitles.id, unitId: financialTitles.unitId }).from(financialTitles).where(eq(financialTitles.id, titleId)).limit(1);
      if (!titleRow) return res.status(404).json({ error: 'Título não encontrado.' });
      if (!isUnitPermitted(req, titleRow.unitId)) {
        return res.status(403).json({ error: 'Sem permissão para consultar baixas desta unidade.' });
      }
      const rows = await db
        .select()
        .from(titleSettlements)
        .where(eq(titleSettlements.titleId, titleId))
        .orderBy(desc(titleSettlements.settlementDate), desc(titleSettlements.id));
      res.json({ settlements: rows });
    } catch (error) {
      console.error('GET settlements error:', error);
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao consultar baixas do título.') });
    }
  });

  // 6. Baixa Total / Parcial em Lote (Transacional + Movimento Bancário + Saldo)
  app.post('/api/financial-titles/settle-batch', requireAuth, requireFinColl, async (req: AuthRequest, res) => {
    try {
      const b = (req.body || {}) as {
        titleIds: number[];
        scope?: string;
        mode?: 'total' | 'parcial';
        paymentDate?: string;
        amountPaidCents?: number;
        interestCents?: number;
        fineCents?: number;
        discountCents?: number;
        bankAccountId: number;
        history?: string;
        paymentMethod?: string;
      };

      const titleIds = parsePositiveIntArray(b.titleIds);
      const bankAccountId = parsePositiveIntId(b.bankAccountId);
      if (titleIds.length === 0) return res.status(400).json({ error: 'Selecione ao menos um título.' });
      if (!bankAccountId) return res.status(400).json({ error: 'Selecione uma conta bancária válida para a baixa.' });

      const mode = b.mode === 'parcial' ? 'parcial' : 'total';
      const paymentDate = parseDateIso(b.paymentDate, new Date());
      const paymentDateStr = paymentDate.toISOString().slice(0, 10);
      const interestTotalCents = Math.max(0, Math.round(parseFiniteNumber(b.interestCents) ?? 0));
      const fineTotalCents = Math.max(0, Math.round(parseFiniteNumber(b.fineCents) ?? 0));
      const discountTotalCents = Math.max(0, Math.round(parseFiniteNumber(b.discountCents) ?? 0));
      const paymentMethod = String(b.paymentMethod || 'Depósito / Transferência');

      const result = await db.transaction(async (tx) => {
        const titles = await tx
          .select()
          .from(financialTitles)
          .where(inArray(financialTitles.id, titleIds))
          .orderBy(asc(financialTitles.dueDate), asc(financialTitles.id));

        if (titles.length !== titleIds.length) {
          throw new ValidationError('Um ou mais títulos selecionados não foram encontrados.', 404);
        }

        const firstScope = titles[0].scope || 'RECEBER';
        const firstClientId = titles[0].clientId;
        const [clientRow] = await tx.select().from(clients).where(eq(clients.id, firstClientId)).limit(1);
        if (clientRow && (clientRow.status === 'suspenso' || clientRow.status === 'cancelado')) {
          throw new ValidationError(`Operação bloqueada: ${clientRow.fullName} está "${clientRow.status.toUpperCase()}".`, 403);
        }

        for (const t of titles) {
          if (!isUnitPermitted(req, t.unitId)) {
            throw new ValidationError(`Sem permissão para baixar o título ${t.documentNumber || t.titleCode} desta unidade.`, 403);
          }
          if (t.clientId !== firstClientId) {
            throw new ValidationError('Todos os títulos selecionados para baixa devem pertencer à mesma pessoa/fornecedor.', 400);
          }
          const st = normStatusUpper(t.status);
          if (st === 'CANCELADO' || st === 'AGRUPADO' || st === 'PAGO') {
            throw new ValidationError(`O título ${t.documentNumber || t.titleCode} (${st}) não pode ser baixado.`, 409);
          }
          if (t.isProtested || t.isProvision) {
            throw new ValidationError(`O título ${t.documentNumber || t.titleCode} exige liberação prévia de Protesto/Provisão.`, 409);
          }
        }

        const [bankAcc] = await tx.select().from(bankAccounts).where(eq(bankAccounts.id, bankAccountId)).limit(1);
        if (!bankAcc) throw new ValidationError('Conta bancária não encontrada.', 404);
        if (!isUnitPermitted(req, bankAcc.unitId)) {
          throw new ValidationError('Sem permissão para movimentar esta conta bancária.', 403);
        }

        const getBalance = (t: typeof titles[number]) => {
          if (t.currentBalanceCents > 0) return t.currentBalanceCents;
          return normStatusUpper(t.status) === 'PAGO' ? 0 : t.amountCents;
        };

        const totalSelectedBalance = titles.reduce((acc, t) => acc + getBalance(t), 0);
        if (totalSelectedBalance <= 0) throw new Error('Os títulos selecionados não possuem saldo em aberto.');

        let targetPrincipalTotal =
          mode === 'total'
            ? totalSelectedBalance
            : Math.min(totalSelectedBalance, Math.max(1, Math.round(Number(b.amountPaidCents || 0))));

        if (targetPrincipalTotal <= 0) throw new Error('O valor da baixa deve ser maior que zero.');

        // Distribute proportionally across selected titles so partial batches are accurate too
        const allocations = titles.map((t, idx) => {
          const bal = getBalance(t);
          if (titles.length === 1) {
            return {
              title: t,
              bal,
              principal: targetPrincipalTotal,
              interest: interestTotalCents,
              fine: fineTotalCents,
              discount: discountTotalCents,
            };
          }
          const ratio = bal / totalSelectedBalance;
          const isLast = idx === titles.length - 1;
          const prevSumP = titles.slice(0, idx).reduce((a, x) => a + Math.round((getBalance(x) / totalSelectedBalance) * targetPrincipalTotal), 0);
          const prevSumI = titles.slice(0, idx).reduce((a, x) => a + Math.round((getBalance(x) / totalSelectedBalance) * interestTotalCents), 0);
          const prevSumF = titles.slice(0, idx).reduce((a, x) => a + Math.round((getBalance(x) / totalSelectedBalance) * fineTotalCents), 0);
          const prevSumD = titles.slice(0, idx).reduce((a, x) => a + Math.round((getBalance(x) / totalSelectedBalance) * discountTotalCents), 0);

          const principal = isLast ? Math.max(0, targetPrincipalTotal - prevSumP) : Math.round(ratio * targetPrincipalTotal);
          const interest = isLast ? Math.max(0, interestTotalCents - prevSumI) : Math.round(ratio * interestTotalCents);
          const fine = isLast ? Math.max(0, fineTotalCents - prevSumF) : Math.round(ratio * fineTotalCents);
          const discount = isLast ? Math.max(0, discountTotalCents - prevSumD) : Math.round(ratio * discountTotalCents);
          return { title: t, bal, principal, interest, fine, discount };
        });

        const totalMovedCents = Math.max(
          1,
          allocations.reduce((acc, a) => acc + Math.max(0, a.principal + a.interest + a.fine - a.discount), 0)
        );

        const isReceber = firstScope === 'RECEBER';
        const batchUuid = crypto.randomUUID();
        const firstTitle = titles[0];
        const movDesc =
          String(b.history || '').trim() ||
          (titles.length > 1
            ? `Baixa em lote - ${clientRow?.fullName || 'Parceiro'} - ${titles.length} título(s)`
            : `Baixa - ${firstTitle.description || firstTitle.documentNumber || firstTitle.titleCode}`);
        const movDoc = titles.length > 1 ? 'LOTE' : firstTitle.documentNumber || firstTitle.titleCode || 'AVULSO';

        let resolvedCatName = isReceber ? 'Recebimento' : 'Pagamento';
        if (firstTitle.chartAccountId) {
          const [catRow] = await tx.select().from(chartOfAccounts).where(eq(chartOfAccounts.id, firstTitle.chartAccountId)).limit(1);
          if (catRow) resolvedCatName = `${catRow.code} - ${catRow.name}`;
        }

        const [createdMov] = await tx
          .insert(bankMovements)
          .values({
            bankAccountId: bankAcc.id,
            movementType: isReceber ? 'CREDITO' : 'DEBITO',
            amountCents: totalMovedCents,
            description: movDesc,
            documentNumber: movDoc,
            movementDate: paymentDate,
            categoryId: firstTitle.chartAccountId ?? null,
            categoryName: resolvedCatName,
            origin: isReceber ? 'BAIXA_RECEBER' : 'BAIXA_PAGAR',
            status: 'CONCILIADO',
            reconciled: true,
            reconciliationDate: paymentDateStr,
            compensationDate: paymentDateStr,
            titleId: firstTitle.id,
            titleSource: isReceber ? 'RECEBER' : 'PAGAR',
            unitId: firstTitle.unitId,
          })
          .returning();

        const nextAccBalance =
          bankAcc.currentBalanceCents + (isReceber ? totalMovedCents : -totalMovedCents);
        await tx
          .update(bankAccounts)
          .set({ currentBalanceCents: nextAccBalance })
          .where(eq(bankAccounts.id, bankAcc.id));

        for (const alloc of allocations) {
          const netTitlePaid = Math.max(0, alloc.principal + alloc.interest + alloc.fine - alloc.discount);
          const principalSettled = mode === 'total' && alloc.discount > 0 && alloc.principal >= alloc.bal
            ? alloc.bal
            : Math.min(alloc.bal, alloc.principal);
          const newBal = Math.max(0, alloc.bal - principalSettled);
          const nextTitleStatus = newBal === 0 ? 'pago' : 'PARCIAL';

          await tx.insert(titleSettlements).values({
            titleId: alloc.title.id,
            settlementDate: paymentDate,
            principalCents: principalSettled,
            interestCents: alloc.interest,
            fineCents: alloc.fine,
            discountCents: alloc.discount,
            amountCents: netTitlePaid,
            origin: titles.length > 1 ? 'BAIXA EM LOTE' : 'BAIXA MANUAL',
            paymentMethod,
            history: movDesc,
            bankAccountId: bankAcc.id,
            movementId: createdMov.id,
            batchUuid,
            createdByName: req.authUser?.name || 'Sistema',
          });

          await tx
            .update(financialTitles)
            .set({
              currentBalanceCents: newBal,
              status: nextTitleStatus,
              paidAt: newBal === 0 ? paymentDate : alloc.title.paidAt,
              collectorId: req.authUser?.id ?? alloc.title.collectorId,
              updatedAt: new Date(),
            })
            .where(eq(financialTitles.id, alloc.title.id));

          await tx.insert(auditLogs).values({
            userId: req.authUser?.id ?? null,
            userName: req.authUser?.name || 'Sistema',
            action: 'SETTLE_TITLE',
            entityType: entityTypeForScope(firstScope),
            entityId: String(alloc.title.id),
            details: {
              changes: [
                { field: 'Saldo Anterior', from: formatCentsPtBr(alloc.bal), to: formatCentsPtBr(newBal) },
                { field: 'Valor Baixado', from: '—', to: formatCentsPtBr(netTitlePaid) },
                { field: 'Conta Bancária', from: '—', to: bankAcc.bankName },
                { field: 'Movimento', from: '—', to: `#${createdMov.id}` },
              ],
            },
            unitId: alloc.title.unitId,
          });
        }

        await tx.insert(auditLogs).values({
          userId: req.authUser?.id ?? null,
          userName: req.authUser?.name || 'Sistema',
          action: 'CREATE_BANK_MOVEMENT',
          entityType: 'bank_movement',
          entityId: String(createdMov.id),
          details: {
            changes: [
              { field: 'Origem', from: '', to: isReceber ? 'BAIXA_RECEBER' : 'BAIXA_PAGAR' },
              { field: 'Valor', from: '', to: formatCentsPtBr(totalMovedCents) },
              { field: 'Descrição', from: '', to: movDesc },
            ],
          },
          unitId: firstTitle.unitId,
        });

        return { settledCount: allocations.length, movementId: createdMov.id, totalMovedCents };
      });

      deps.broadcast('collection:payment', {
        operator: req.authUser?.name || 'Equipe',
        points: result.settledCount * 10,
      });

      res.json(result);
    } catch (error) {
      console.error('POST /api/financial-titles/settle-batch error:', error);
      const status = error instanceof ValidationError ? error.statusCode : 400;
      res.status(status).json({ error: sanitizeErrorMessage(error, 'Erro ao registrar baixa.') });
    }
  });

  // 7. Estornar / Cancelar baixas selecionadas (estorna títulos + atualiza/remove movimento bancário vinculado)
  app.post('/api/financial-titles/cancel-settlements', requireAuth, requireFinColl, async (req: AuthRequest, res) => {
    try {
      const { settlementIds } = (req.body || {}) as { settlementIds: number[] };
      const ids = parsePositiveIntArray(settlementIds);
      if (ids.length === 0) return res.status(400).json({ error: 'Selecione ao menos uma baixa para cancelar.' });

      const result = await db.transaction(async (tx) => {
        const targets = await tx
          .select()
          .from(titleSettlements)
          .where(inArray(titleSettlements.id, ids));
        if (targets.length === 0) throw new ValidationError('Baixas selecionadas não encontradas.', 404);

        const affectedTitleIds = Array.from(new Set(targets.map((t) => t.titleId)));
        const affectedTitleRows = await tx
          .select()
          .from(financialTitles)
          .where(inArray(financialTitles.id, affectedTitleIds));
        for (const t of affectedTitleRows) {
          if (!isUnitPermitted(req, t.unitId)) {
            throw new ValidationError('Sem permissão para estornar baixas desta unidade.', 403);
          }
        }

        const affectedMovementIds = Array.from(
          new Set(targets.map((t) => t.movementId).filter((m): m is number => Boolean(m && m > 0)))
        );

        await tx.delete(titleSettlements).where(inArray(titleSettlements.id, ids));

        for (const tid of affectedTitleIds) {
          const [t] = await tx.select().from(financialTitles).where(eq(financialTitles.id, tid)).limit(1);
          if (!t) continue;
          const remaining = await tx.select().from(titleSettlements).where(eq(titleSettlements.titleId, tid));
          const remainingPrincipal = remaining.reduce((acc, s) => acc + (s.principalCents > 0 ? s.principalCents : s.amountCents), 0);
          const orig = t.originalValueCents > 0 ? t.originalValueCents : t.amountCents;
          const nextBal = Math.max(0, orig - remainingPrincipal);
          const nextStatus = nextBal === 0 ? 'pago' : remaining.length > 0 ? 'PARCIAL' : 'ABERTO';

          await tx
            .update(financialTitles)
            .set({
              currentBalanceCents: nextBal,
              status: nextStatus,
              paidAt: nextBal === 0 ? t.paidAt : null,
              updatedAt: new Date(),
            })
            .where(eq(financialTitles.id, tid));

          await tx.insert(auditLogs).values({
            userId: req.authUser?.id ?? null,
            userName: req.authUser?.name || 'Sistema',
            action: 'CANCEL_SETTLEMENT',
            entityType: entityTypeForScope(t.scope || 'RECEBER'),
            entityId: String(tid),
            details: {
              changes: [
                { field: 'Baixa Estornada', from: formatCentsPtBr(t.currentBalanceCents), to: formatCentsPtBr(nextBal) },
                { field: 'Status', from: t.status, to: nextStatus },
              ],
            },
            unitId: t.unitId,
          });
        }

        // Sync linked bank movements cleanly
        for (const movId of affectedMovementIds) {
          const [mov] = await tx.select().from(bankMovements).where(eq(bankMovements.id, movId)).limit(1);
          if (!mov) continue;
          const reversedSum = targets
            .filter((s) => s.movementId === movId)
            .reduce((acc, s) => acc + Number(s.amountCents || 0), 0);
          const remainingLinked = await tx
            .select()
            .from(titleSettlements)
            .where(eq(titleSettlements.movementId, movId));

          const [acc] = await tx.select().from(bankAccounts).where(eq(bankAccounts.id, mov.bankAccountId)).limit(1);
          const isCredit = String(mov.movementType).toUpperCase() === 'CREDITO' || String(mov.movementType).toUpperCase() === 'ENTRADA';

          if (remainingLinked.length === 0) {
            await tx.delete(bankMovements).where(eq(bankMovements.id, movId));
            if (acc) {
              const delta = isCredit ? -mov.amountCents : mov.amountCents;
              await tx
                .update(bankAccounts)
                .set({ currentBalanceCents: acc.currentBalanceCents + delta })
                .where(eq(bankAccounts.id, acc.id));
            }
          } else {
            const newMovAmt = Math.max(0, mov.amountCents - reversedSum);
            await tx
              .update(bankMovements)
              .set({ amountCents: newMovAmt })
              .where(eq(bankMovements.id, movId));
            if (acc && reversedSum > 0) {
              const delta = isCredit ? -reversedSum : reversedSum;
              await tx
                .update(bankAccounts)
                .set({ currentBalanceCents: acc.currentBalanceCents + delta })
                .where(eq(bankAccounts.id, acc.id));
            }
          }
        }

        return { cancelledCount: targets.length };
      });

      res.json(result);
    } catch (error) {
      console.error('POST /api/financial-titles/cancel-settlements error:', error);
      const status = error instanceof ValidationError ? error.statusCode : 400;
      res.status(status).json({ error: sanitizeErrorMessage(error, 'Erro ao cancelar baixas.') });
    }
  });

  // 8. Vincular / Deduzir Adiantamento ou Devolução com persistência real no banco
  app.post('/api/financial-titles/link-deductions', requireAuth, requireFinColl, async (req: AuthRequest, res) => {
    try {
      const b = (req.body || {}) as {
        targetTitleIds: number[];
        links: Array<{ sourceTitleId: number; amountCents: number }>;
      };
      const targetIds = parsePositiveIntArray(b.targetTitleIds);
      const links = Array.isArray(b.links)
        ? b.links
            .map((l) => ({
              sourceTitleId: parsePositiveIntId(l?.sourceTitleId),
              amountCents: parseFiniteNumber(l?.amountCents),
            }))
            .filter((l): l is { sourceTitleId: number; amountCents: number } => Boolean(l.sourceTitleId && l.amountCents && l.amountCents > 0))
        : [];
      if (targetIds.length === 0 || links.length === 0) {
        return res.status(400).json({ error: 'Informe os títulos de destino e créditos válidos a vincular.' });
      }

      const sourceIds = Array.from(new Set(links.map((l) => l.sourceTitleId)));

      const result = await db.transaction(async (tx) => {
        const targets = await tx
          .select()
          .from(financialTitles)
          .where(inArray(financialTitles.id, targetIds))
          .orderBy(asc(financialTitles.dueDate));
        if (targets.length !== targetIds.length) {
          throw new ValidationError('Um ou mais títulos de destino não foram encontrados.', 404);
        }
        const sources = await tx
          .select()
          .from(financialTitles)
          .where(inArray(financialTitles.id, sourceIds));
        if (sources.length !== sourceIds.length) {
          throw new ValidationError('Um ou mais créditos de origem não foram encontrados.', 404);
        }

        for (const t of [...targets, ...sources]) {
          if (!isUnitPermitted(req, t.unitId)) {
            throw new ValidationError('Sem permissão para vincular deduções em títulos desta unidade.', 403);
          }
        }

        for (const l of links) {
          const src = sources.find((s) => s.id === l.sourceTitleId);
          if (!src) throw new ValidationError('Crédito de origem não encontrado.', 404);
          const curBal = src.currentBalanceCents > 0 ? src.currentBalanceCents : src.amountCents;
          if (curBal <= 0 || Math.round(l.amountCents) > curBal) {
            throw new ValidationError(`Saldo insuficiente no crédito ${src.documentNumber || src.titleCode}.`, 400);
          }
        }

        const totalTargetBal = targets.reduce((a, t) => a + (t.currentBalanceCents > 0 ? t.currentBalanceCents : t.amountCents), 0);
        if (totalTargetBal <= 0) {
          throw new ValidationError('Os títulos de destino não possuem saldo disponível para dedução.', 400);
        }
        const totalDeduct = links.reduce((a, l) => a + Math.round(l.amountCents), 0);
        if (totalDeduct > totalTargetBal) {
          throw new ValidationError('O total de deduções não pode exceder o saldo dos títulos selecionados.', 400);
        }

        const nowIso = new Date().toISOString().slice(0, 10);
        // Update source credits
        for (const l of links) {
          const src = sources.find((s) => s.id === l.sourceTitleId)!;
          const curBal = src.currentBalanceCents > 0 ? src.currentBalanceCents : src.amountCents;
          const used = Math.min(curBal, Math.round(l.amountCents));
          const rem = Math.max(0, curBal - used);
          const isDev = String(src.titleType).toUpperCase() === 'DEVOLUCAO';
          const nextStatus = isDev
            ? rem === 0
              ? 'DEVOLUCAO_VINCULADA'
              : 'DEVOLUCAO_PARCIAL'
            : rem === 0
            ? 'pago'
            : 'ADIANTAMENTO_PARCIAL';
          const destRef = {
            titleId: targets[0].id,
            documentNumber: targets[0].documentNumber || targets[0].titleCode,
            amountCents: used,
            date: nowIso,
          };
          await tx
            .update(financialTitles)
            .set({
              currentBalanceCents: rem,
              status: nextStatus,
              advanceLinks: isDev ? src.advanceLinks : [...(src.advanceLinks || []), destRef],
              returnLinks: isDev ? [...(src.returnLinks || []), destRef] : src.returnLinks,
              updatedAt: new Date(),
            })
            .where(eq(financialTitles.id, src.id));
        }

        // Distribute deductions proportionally to targets & persist compensation settlements
        let remainingToApply = totalDeduct;
        for (let idx = 0; idx < targets.length; idx++) {
          const tgt = targets[idx];
          const curBal = tgt.currentBalanceCents > 0 ? tgt.currentBalanceCents : tgt.amountCents;
          const portion =
            idx === targets.length - 1
              ? Math.min(curBal, remainingToApply)
              : Math.min(curBal, Math.round((curBal / totalTargetBal) * totalDeduct));
          remainingToApply = Math.max(0, remainingToApply - portion);
          if (portion <= 0) continue;

          const newBal = Math.max(0, curBal - portion);
          await tx.insert(titleSettlements).values({
            titleId: tgt.id,
            settlementDate: new Date(),
            principalCents: portion,
            amountCents: portion,
            origin: 'COMPENSACAO',
            paymentMethod: 'Compensação Crédito',
            history: `Compensação Adiantamento/Devolução (${sources.map((s) => s.documentNumber || s.titleCode).join(', ')})`,
            createdByName: req.authUser?.name || 'Sistema',
          });

          await tx
            .update(financialTitles)
            .set({
              currentBalanceCents: newBal,
              status: newBal === 0 ? 'pago' : 'PARCIAL',
              paidAt: newBal === 0 ? new Date() : tgt.paidAt,
              updatedAt: new Date(),
            })
            .where(eq(financialTitles.id, tgt.id));
        }

        return { totalDeduct, coveredFull: totalDeduct >= totalTargetBal };
      });

      res.json(result);
    } catch (error) {
      console.error('POST /api/financial-titles/link-deductions error:', error);
      const status = error instanceof ValidationError ? error.statusCode : 400;
      res.status(status).json({ error: sanitizeErrorMessage(error, 'Erro ao aplicar deduções.') });
    }
  });

  // 9. Liberação de Protesto / Provisão persistente no PostgreSQL
  app.post('/api/financial-titles/:id/release', requireAuth, requireFinColl, async (req: AuthRequest, res) => {
    try {
      const id = parsePositiveIntId(req.params.id);
      if (!id) return res.status(400).json({ error: 'ID de título inválido.' });
      const { releaseType, reason } = (req.body || {}) as { releaseType: 'PROTEST' | 'PROVISION'; reason: string };
      if (!String(reason || '').trim()) {
        return res.status(400).json({ error: 'Motivo da liberação é obrigatório.' });
      }
      const [t] = await db.select().from(financialTitles).where(eq(financialTitles.id, id)).limit(1);
      if (!t) return res.status(404).json({ error: 'Título não encontrado.' });
      if (!isUnitPermitted(req, t.unitId)) {
        return res.status(403).json({ error: 'Sem permissão para liberar títulos desta unidade.' });
      }

      const userName = req.authUser?.name || 'Administrador';
      const entry = {
        type: releaseType === 'PROVISION' ? ('PROVISION' as const) : ('PROTEST' as const),
        user: userName,
        reason: String(reason).trim(),
        releasedAt: new Date().toISOString(),
      };
      const nextProtested = releaseType === 'PROTEST' ? false : t.isProtested;
      const nextProvision = releaseType === 'PROVISION' ? false : t.isProvision;
      const nextStatus = nextProtested ? 'PROTESTADO' : nextProvision ? 'PROVISAO' : 'ABERTO';

      const [updated] = await db
        .update(financialTitles)
        .set({
          isProtested: nextProtested,
          isProvision: nextProvision,
          status: nextStatus,
          releaseLogJson: [...(t.releaseLogJson || []), entry],
          updatedAt: new Date(),
        })
        .where(eq(financialTitles.id, id))
        .returning();

      await writeTitleAudit(
        req,
        releaseType === 'PROVISION' ? 'RELEASE_PROVISION' : 'RELEASE_PROTEST',
        t.scope || 'RECEBER',
        id,
        [
          { field: releaseType === 'PROVISION' ? 'Provisão' : 'Protesto', from: 'BLOQUEADO', to: 'LIBERADO' },
          { field: 'Motivo', from: '', to: entry.reason },
        ],
        t.unitId
      );

      res.json({ title: updated });
    } catch (error) {
      console.error('POST /api/financial-titles/:id/release error:', error);
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao liberar título.') });
    }
  });

  // 10. Calcular impacto antes de cancelar títulos
  app.get('/api/financial-titles/cancel-impact', requireAuth, requireFinColl, async (req: AuthRequest, res) => {
    try {
      const idsParam = String(req.query.ids || '');
      const ids = parsePositiveIntArray(idsParam ? idsParam.split(',').map((x) => x.trim()) : []);
      if (ids.length === 0) {
        return res.json({ collectionNotesCount: 0, negotiationsCount: 0, legalProcessesCount: 0 });
      }

      const allowedUnits = getAllowedUnitIds(req);
      const selected = await db
        .select()
        .from(financialTitles)
        .where(
          allowedUnits !== null
            ? and(inArray(financialTitles.id, ids), inArray(financialTitles.unitId, allowedUnits))
            : inArray(financialTitles.id, ids)
        );
      const allowedTitleIds = selected.map((t) => t.id);
      if (allowedTitleIds.length === 0) {
        return res.json({ collectionNotesCount: 0, negotiationsCount: 0, legalProcessesCount: 0 });
      }
      const admIds = Array.from(new Set(selected.map((t) => t.admissionId).filter((a): a is number => Boolean(a))));

      const [casesCount] = await db
        .select({ v: count() })
        .from(collectionCases)
        .where(inArray(collectionCases.titleId, allowedTitleIds));

      let negotiationsCount = 0;
      let legalProcessesCount = 0;
      if (admIds.length > 0) {
        const negRows = await db.select().from(negotiations).where(inArray(negotiations.admissionId, admIds));
        negotiationsCount = negRows.filter((n) => n.status !== 'cancelada' && n.status !== 'suspensa').length;

        const procRows = await db.select().from(legalProcesses).where(inArray(legalProcesses.admissionId, admIds));
        legalProcessesCount = procRows.filter((p) => p.status !== 'cancelado' && p.status !== 'arquivado').length;
      }

      res.json({
        collectionNotesCount: Number(casesCount?.v || 0),
        negotiationsCount,
        legalProcessesCount,
      });
    } catch (error) {
      console.error('GET /api/financial-titles/cancel-impact error:', error);
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao consultar impacto do cancelamento.') });
    }
  });

  // 11. Cancelar títulos em lote (transacional)
  app.post('/api/financial-titles/batch-cancel', requireAuth, requireFinColl, async (req: AuthRequest, res) => {
    try {
      const { titleIds } = (req.body || {}) as { titleIds: number[] };
      const ids = parsePositiveIntArray(titleIds);
      if (ids.length === 0) return res.status(400).json({ error: 'Selecione ao menos um título válido.' });

      const result = await db.transaction(async (tx) => {
        const rows = await tx.select().from(financialTitles).where(inArray(financialTitles.id, ids));
        const cancelled: number[] = [];
        const blocked: Array<{ id: number; documentNumber: string; reason: string }> = [];

        for (const t of rows) {
          if (!isUnitPermitted(req, t.unitId)) {
            blocked.push({
              id: t.id,
              documentNumber: t.documentNumber || t.titleCode,
              reason: 'Sem permissão para cancelar títulos desta unidade.',
            });
            continue;
          }
          const st = normStatusUpper(t.status);
          if (st === 'PAGO' || st === 'PARCIAL') {
            blocked.push({
              id: t.id,
              documentNumber: t.documentNumber || t.titleCode,
              reason: 'Possui baixa registrada. Cancele as baixas antes.',
            });
            continue;
          }
          if (st === 'CANCELADO' || st === 'AGRUPADO') {
            blocked.push({
              id: t.id,
              documentNumber: t.documentNumber || t.titleCode,
              reason: `Status atual "${st}" não permite cancelamento comum.`,
            });
            continue;
          }

          await tx
            .update(financialTitles)
            .set({ status: 'CANCELADO', currentBalanceCents: 0, updatedAt: new Date() })
            .where(eq(financialTitles.id, t.id));

          await tx
            .update(collectionCases)
            .set({ status: 'cancelado', updatedAt: new Date() })
            .where(and(eq(collectionCases.titleId, t.id), ne(collectionCases.status, 'pago')));

          await tx
            .update(negotiations)
            .set({ status: 'suspensa', negotiationStatus: 'CANCELADA', updatedAt: new Date() })
            .where(eq(negotiations.titleId, t.id));

          if (t.admissionId) {
            await tx
              .update(negotiations)
              .set({ status: 'suspensa', negotiationStatus: 'CANCELADA', updatedAt: new Date() })
              .where(eq(negotiations.admissionId, t.admissionId));
          }

          await tx.insert(auditLogs).values({
            userId: req.authUser?.id ?? null,
            userName: req.authUser?.name || 'Sistema',
            action: 'CANCEL_TITLE',
            entityType: entityTypeForScope(t.scope || 'RECEBER'),
            entityId: String(t.id),
            details: { changes: [{ field: 'Status', from: t.status, to: 'CANCELADO' }] },
            unitId: t.unitId,
          });
          cancelled.push(t.id);
        }

        return { cancelledCount: cancelled.length, cancelledIds: cancelled, blocked };
      });

      res.json(result);
    } catch (error) {
      console.error('POST /api/financial-titles/batch-cancel error:', error);
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao cancelar títulos.') });
    }
  });

  // 12. Cancelar fatura (com rollback transacional do grupo e reabertura dos títulos de origem)
  app.patch('/api/financial-titles/:id/cancel', requireAuth, requireFinColl, async (req: AuthRequest, res) => {
    try {
      const id = parsePositiveIntId(req.params.id);
      if (!id) return res.status(400).json({ error: 'ID de título inválido.' });
      const [target] = await db.select().from(financialTitles).where(eq(financialTitles.id, id)).limit(1);
      if (!target) return res.status(404).json({ error: 'Título não encontrado.' });
      if (!isUnitPermitted(req, target.unitId)) {
        return res.status(403).json({ error: 'Sem permissão para cancelar títulos desta unidade.' });
      }

      if (target.invoiceGroupId) {
        const result = await db.transaction(async (tx) => {
          const groupRows = await tx
            .select()
            .from(financialTitles)
            .where(eq(financialTitles.invoiceGroupId, target.invoiceGroupId));
          const invoices = groupRows.filter((r) => String(r.titleType).toUpperCase() === 'FATURA');
          const origins = groupRows.filter((r) => String(r.titleType).toUpperCase() !== 'FATURA');

          for (const inv of invoices) {
            const st = normStatusUpper(inv.status);
            if (st === 'PAGO' || st === 'PARCIAL') {
              throw new ValidationError(`A fatura ${inv.documentNumber || inv.titleCode} já possui baixa. Estorne antes de cancelar o grupo.`, 409);
            }
          }

          for (const inv of invoices) {
            await tx
              .update(financialTitles)
              .set({ status: 'CANCELADO', currentBalanceCents: 0, updatedAt: new Date() })
              .where(eq(financialTitles.id, inv.id));
          }

          for (const orig of origins) {
            await tx
              .delete(titleSettlements)
              .where(and(eq(titleSettlements.titleId, orig.id), eq(titleSettlements.origin, 'FATURA GERADA')));
            const restoredBal = orig.originalValueCents > 0 ? orig.originalValueCents : orig.amountCents;
            await tx
              .update(financialTitles)
              .set({
                status: 'ABERTO',
                currentBalanceCents: restoredBal,
                invoiceGroupId: '',
                updatedAt: new Date(),
              })
              .where(eq(financialTitles.id, orig.id));
          }

          return { cancelledInvoices: invoices.length, reopenedOrigins: origins.length };
        });

        await writeTitleAudit(
          req,
          'CANCEL_INVOICE_GROUP',
          target.scope || 'RECEBER',
          id,
          [{ field: 'Grupo Fatura', from: target.invoiceGroupId, to: 'CANCELADO / ORIGENS REABERTAS' }],
          target.unitId
        );
        return res.json(result);
      }

      const st = normStatusUpper(target.status);
      if (st === 'PAGO' || st === 'PARCIAL') {
        return res.status(409).json({ error: 'Título com baixa não pode ser cancelado diretamente.' });
      }
      await db.transaction(async (tx) => {
        await tx
          .update(financialTitles)
          .set({ status: 'CANCELADO', currentBalanceCents: 0, updatedAt: new Date() })
          .where(eq(financialTitles.id, id));
        await tx
          .update(collectionCases)
          .set({ status: 'cancelado', updatedAt: new Date() })
          .where(and(eq(collectionCases.titleId, id), ne(collectionCases.status, 'pago')));
        await tx.insert(auditLogs).values({
          userId: req.authUser?.id ?? null,
          userName: req.authUser?.name || 'Sistema',
          action: 'CANCEL_TITLE',
          entityType: entityTypeForScope(target.scope || 'RECEBER'),
          entityId: String(id),
          details: { changes: [{ field: 'Status', from: target.status, to: 'CANCELADO' }] },
          unitId: target.unitId,
        });
      });
      res.json({ cancelledInvoices: 0, reopenedOrigins: 0 });
    } catch (error) {
      console.error('PATCH /api/financial-titles/:id/cancel error:', error);
      const status = error instanceof ValidationError ? error.statusCode : 400;
      res.status(status).json({ error: sanitizeErrorMessage(error, 'Erro ao cancelar.') });
    }
  });

  // 13. Reabrir título cancelado ou agrupado (transacional)
  app.patch('/api/financial-titles/:id/reopen', requireAuth, requireFinColl, async (req: AuthRequest, res) => {
    try {
      const id = parsePositiveIntId(req.params.id);
      if (!id) return res.status(400).json({ error: 'ID de título inválido.' });
      const [t] = await db.select().from(financialTitles).where(eq(financialTitles.id, id)).limit(1);
      if (!t) return res.status(404).json({ error: 'Título não encontrado.' });
      if (!isUnitPermitted(req, t.unitId)) {
        return res.status(403).json({ error: 'Sem permissão para reabrir títulos desta unidade.' });
      }

      const st = normStatusUpper(t.status);
      if (st !== 'CANCELADO' && st !== 'AGRUPADO') {
        return res.status(400).json({ error: 'Apenas títulos cancelados ou agrupados podem ser reabertos.' });
      }

      const restoredBal = t.originalValueCents > 0 ? t.originalValueCents : t.amountCents;
      const updated = await db.transaction(async (tx) => {
        if (st === 'AGRUPADO') {
          await tx
            .delete(titleSettlements)
            .where(and(eq(titleSettlements.titleId, id), eq(titleSettlements.origin, 'FATURA GERADA')));
        }

        const [row] = await tx
          .update(financialTitles)
          .set({
            status: 'ABERTO',
            currentBalanceCents: restoredBal,
            invoiceGroupId: st === 'AGRUPADO' ? '' : t.invoiceGroupId,
            updatedAt: new Date(),
          })
          .where(eq(financialTitles.id, id))
          .returning();

        await tx.insert(auditLogs).values({
          userId: req.authUser?.id ?? null,
          userName: req.authUser?.name || 'Sistema',
          action: 'REOPEN_TITLE',
          entityType: entityTypeForScope(t.scope || 'RECEBER'),
          entityId: String(id),
          details: {
            changes: [
              { field: 'Status', from: t.status, to: 'ABERTO' },
              { field: 'Saldo Restaurado', from: formatCentsPtBr(t.currentBalanceCents), to: formatCentsPtBr(restoredBal) },
            ],
          },
          unitId: t.unitId,
        });
        return row;
      });
      res.json({ title: updated });
    } catch (error) {
      console.error('PATCH /api/financial-titles/:id/reopen error:', error);
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao reabrir título.') });
    }
  });

  async function buildRecurrencePlan(model: typeof financialTitles.$inferSelect, qty: number) {
    const rawBase = String(model.documentNumber || model.titleCode || '').trim();
    const modelHasBoleto = Boolean(
      (model.barcode || '').trim() ||
        (model.digitableLine || '').trim() ||
        (model.santanderBankSlipId || '').trim()
    );

    const slashMatch = rawBase.match(/^(.*)-(\d{1,3})\/(\d{1,3})$/);
    const dashNumMatch = !slashMatch ? rawBase.match(/^(.*)-(\d{1,3})$/) : null;

    let prefix = rawBase;
    let startSeq = 0;
    let padWidth = 2;
    let useSlashTotal = !modelHasBoleto;

    if (slashMatch) {
      prefix = slashMatch[1];
      startSeq = parseInt(slashMatch[2], 10);
      padWidth = Math.max(2, slashMatch[2].length);
      useSlashTotal = true;
    } else if (dashNumMatch) {
      prefix = dashNumMatch[1];
      startSeq = parseInt(dashNumMatch[2], 10);
      padWidth = Math.max(2, dashNumMatch[2].length);
      useSlashTotal = false;
    }

    const existingRows = await db
      .select({
        documentNumber: financialTitles.documentNumber,
        status: financialTitles.status,
      })
      .from(financialTitles)
      .where(and(eq(financialTitles.scope, model.scope || 'RECEBER'), eq(financialTitles.unitId, model.unitId)));

    const existingSet = new Set<string>();
    for (const r of existingRows) {
      if (normStatusUpper(r.status) === 'CANCELADO') continue;
      const doc = String(r.documentNumber || '').trim().toUpperCase();
      if (!doc) continue;
      existingSet.add(doc);
      // Also index without /NN suffix so 59-2-02 and 59-2-02/12 both detect existence
      const baseOnly = doc.replace(/\/\d{1,3}$/, '');
      existingSet.add(baseOnly);
    }

    const rangeStart = startSeq + 1;
    const rangeEnd = startSeq === 0 ? qty : startSeq < qty ? qty : startSeq + qty;
    const totalInstallments = Math.max(qty, rangeEnd);
    const padTot = String(totalInstallments).padStart(padWidth, '0');

    const baseAmount = model.originalValueCents > 0 ? model.originalValueCents : model.amountCents;
    const skippedDocs: string[] = [];
    const items: Array<{
      installmentNumber: number;
      totalInstallments: number;
      documentNumber: string;
      dueDate: Date;
      dueDateIso: string;
      amountCents: number;
    }> = [];

    for (let n = rangeStart; n <= rangeEnd; n++) {
      const padIdx = String(n).padStart(padWidth, '0');
      const plainDoc = `${prefix}-${padIdx}`;
      const slashDoc = `${plainDoc}/${padTot}`;
      const docNum = useSlashTotal ? slashDoc : plainDoc;

      if (existingSet.has(plainDoc.toUpperCase()) || existingSet.has(slashDoc.toUpperCase())) {
        skippedDocs.push(plainDoc);
        continue;
      }

      const monthOffset = startSeq > 0 ? n - startSeq : n;
      const nextDue = new Date(model.dueDate);
      nextDue.setMonth(nextDue.getMonth() + monthOffset);

      items.push({
        installmentNumber: n,
        totalInstallments,
        documentNumber: docNum,
        dueDate: nextDue,
        dueDateIso: nextDue.toISOString().slice(0, 10),
        amountCents: baseAmount,
      });
    }

    return { modelHasBoleto, startSeq, rangeStart, rangeEnd, totalInstallments, items, skippedDocs };
  }

  // 13b. Prévia da numeração e parcelas do lançamento recorrente
  app.get('/api/financial-titles/:id/recurrence-preview', requireAuth, requireFinColl, async (req: AuthRequest, res) => {
    try {
      const parentId = parsePositiveIntId(req.params.id);
      if (!parentId) return res.status(400).json({ error: 'ID do título modelo inválido.' });

      const qtyRaw = parseFiniteNumber(req.query.count) ?? 12;
      const qty = Math.min(120, Math.max(1, Math.trunc(qtyRaw)));

      const [model] = await db.select().from(financialTitles).where(eq(financialTitles.id, parentId)).limit(1);
      if (!model) return res.status(404).json({ error: 'Título modelo não encontrado.' });
      if (!isUnitPermitted(req, model.unitId)) {
        return res.status(403).json({ error: 'Sem permissão para acessar título desta unidade.' });
      }

      const plan = await buildRecurrencePlan(model, qty);
      res.json({
        modelId: model.id,
        modelDocumentNumber: model.documentNumber || model.titleCode,
        modelHasBoleto: plan.modelHasBoleto,
        skippedDocs: plan.skippedDocs,
        items: plan.items.map((it) => ({
          installmentNumber: it.installmentNumber,
          totalInstallments: it.totalInstallments,
          documentNumber: it.documentNumber,
          dueDateIso: it.dueDateIso,
          amountCents: it.amountCents,
        })),
      });
    } catch (error) {
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao calcular prévia da recorrência.') });
    }
  });

  // 14. Lançamento Recorrente (persistente para RECEBER e PAGAR, com emissão opcional de boletos Santander)
  app.post('/api/financial-titles/create-installments', requireAuth, requireFinColl, async (req: AuthRequest, res) => {
    try {
      const {
        parentTitleId,
        count: installmentCount,
        bankAccountId: rawBankAccountId,
        emitBoletos,
        includePixQr,
      } = (req.body || {}) as {
        parentTitleId: number;
        count: number;
        bankAccountId?: number | null;
        emitBoletos?: boolean;
        includePixQr?: boolean;
      };
      const parentId = parsePositiveIntId(parentTitleId);
      if (!parentId) return res.status(400).json({ error: 'ID do título modelo inválido.' });
      const qtyRaw = parseFiniteNumber(installmentCount) ?? 1;
      const qty = Math.min(120, Math.max(1, Math.trunc(qtyRaw)));
      const [model] = await db.select().from(financialTitles).where(eq(financialTitles.id, parentId)).limit(1);
      if (!model) return res.status(404).json({ error: 'Título modelo não encontrado.' });
      if (!isUnitPermitted(req, model.unitId)) {
        return res.status(403).json({ error: 'Sem permissão para gerar recorrências nesta unidade.' });
      }
      if (normStatusUpper(model.status) === 'CANCELADO') {
        return res.status(400).json({ error: 'Não é possível gerar parcelas a partir de título cancelado.' });
      }

      let resolvedBankAccountId: number | null = model.bankAccountId ?? null;
      let targetAccount: typeof bankAccounts.$inferSelect | null = null;

      if (rawBankAccountId !== undefined && rawBankAccountId !== null) {
        const parsedAccId = parsePositiveIntId(rawBankAccountId);
        if (!parsedAccId) {
          return res.status(400).json({ error: 'Conta corrente selecionada é inválida.' });
        }
        const [acc] = await db.select().from(bankAccounts).where(eq(bankAccounts.id, parsedAccId)).limit(1);
        if (!acc || !isUnitPermitted(req, acc.unitId)) {
          return res.status(403).json({ error: 'Conta corrente não encontrada ou sem permissão.' });
        }
        resolvedBankAccountId = acc.id;
        targetAccount = acc;
      } else if (resolvedBankAccountId) {
        const [acc] = await db
          .select()
          .from(bankAccounts)
          .where(eq(bankAccounts.id, resolvedBankAccountId))
          .limit(1);
        targetAccount = acc || null;
      }

      const shouldEmitBoletos = Boolean(emitBoletos) && String(model.scope || 'RECEBER').toUpperCase() === 'RECEBER';
      if (shouldEmitBoletos && targetAccount && targetAccount.apiProvider !== 'santander') {
        return res.status(400).json({
          error: `A conta "${targetAccount.bankName}" não possui integração API Santander configurada para emissão automática de boletos.`,
        });
      }

      const plan = await buildRecurrencePlan(model, qty);
      if (plan.items.length === 0) {
        return res.status(400).json({
          error:
            plan.skippedDocs.length > 0
              ? `Todas as parcelas numeradas (${plan.skippedDocs.join(', ')}) já existem para este título.`
              : 'Nenhuma nova parcela a gerar para a quantidade informada.',
        });
      }

      const recurrenceId = crypto.randomUUID();
      const createdRows = await db.transaction(async (tx) => {
        const inserted = [];
        for (let idx = 0; idx < plan.items.length; idx++) {
          const item = plan.items[idx];
          const code = `${model.scope === 'PAGAR' ? 'PAG' : 'REC'}-REC-${model.id}-${item.installmentNumber}-${Date.now().toString().slice(-4)}-${idx}`;

          const [child] = await tx
            .insert(financialTitles)
            .values({
              titleCode: code,
              scope: model.scope || 'RECEBER',
              titleType: 'PADRAO',
              origin: 'RECORRENCIA',
              documentNumber: item.documentNumber,
              description: model.description,
              clientId: model.clientId,
              clientName: model.clientName,
              admissionId: model.admissionId,
              unitId: model.unitId,
              chartAccountId: model.chartAccountId,
              documentTypeId: model.documentTypeId,
              bearerId: model.bearerId,
              departmentId: model.departmentId,
              bankAccountId: resolvedBankAccountId,
              sellerId: model.sellerId,
              assignedCollaboratorId: model.assignedCollaboratorId,
              installmentNumber: item.installmentNumber,
              totalInstallments: item.totalInstallments,
              isInitialFee: false,
              amountCents: item.amountCents,
              originalValueCents: item.amountCents,
              currentBalanceCents: item.amountCents,
              issueDate: new Date(),
              dueDate: item.dueDate,
              forecastDate: item.dueDate,
              status: 'ABERTO',
              collectionStatus: model.collectionStatus || 'COBRAR',
              accountingType: model.accountingType || 'NAO_CONTABIL',
              parentId: model.id,
              recurrenceId,
              boletoProvider: targetAccount?.apiProvider === 'santander' ? 'santander' : model.boletoProvider || 'santander',
            })
            .returning();
          inserted.push(child);
        }
        return inserted;
      });

      let emittedCount = 0;
      const emissionErrors: string[] = [];
      let finalChildren = createdRows;

      // Nunca gera/reemite boleto para o título inicial (model) — apenas para os novos lançamentos gerados
      if (shouldEmitBoletos && createdRows.length > 0) {
        const actorName = req.authUser?.name || 'Usuário';
        const refreshedRows: typeof createdRows = [];
        for (const child of createdRows) {
          try {
            const emitted = await emitSantanderBoletoForTitle({
              titleId: child.id,
              bankAccountId: resolvedBankAccountId ?? undefined,
              includePixQr: includePixQr !== undefined ? Boolean(includePixQr) : undefined,
              actorName,
            });
            emittedCount++;
            refreshedRows.push(emitted.title || child);
          } catch (emitErr) {
            const msg = emitErr instanceof Error ? emitErr.message : 'Erro ao emitir boleto Santander';
            if (emissionErrors.length < 5) {
              emissionErrors.push(`${child.documentNumber || child.titleCode}: ${msg}`);
            }
            refreshedRows.push(child);
          }
        }
        finalChildren = refreshedRows;
      }

      await writeTitleAudit(
        req,
        'CREATE_RECURRENCE',
        model.scope || 'RECEBER',
        model.id,
        [
          {
            field: 'Parcelas Recorrentes',
            from: model.documentNumber || model.titleCode,
            to: `${finalChildren.length} parcela(s) gerada(s)${
              plan.skippedDocs.length > 0 ? ` · ${plan.skippedDocs.length} já existente(s) ignorada(s)` : ''
            }${emittedCount > 0 ? ` · ${emittedCount} boleto(s) Santander emitido(s)` : ''}`,
          },
        ],
        model.unitId
      );

      res.json({
        createdCount: finalChildren.length,
        emittedCount,
        skippedDocs: plan.skippedDocs,
        modelHadBoleto: plan.modelHasBoleto,
        emissionErrors,
        children: finalChildren,
      });
    } catch (error) {
      console.error('POST /api/financial-titles/create-installments error:', error);
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao gerar parcelas recorrentes.') });
    }
  });

  // 15. Consultar parcelas filhas de um título modelo
  app.get('/api/financial-titles/:id/children', requireAuth, requireFinColl, async (req: AuthRequest, res) => {
    try {
      const parentId = parsePositiveIntId(req.params.id);
      if (!parentId) return res.status(400).json({ error: 'ID de título inválido.' });
      const [parentRow] = await db.select({ id: financialTitles.id, unitId: financialTitles.unitId }).from(financialTitles).where(eq(financialTitles.id, parentId)).limit(1);
      if (!parentRow) return res.status(404).json({ error: 'Título modelo não encontrado.' });
      if (!isUnitPermitted(req, parentRow.unitId)) {
        return res.status(403).json({ error: 'Sem permissão para consultar parcelas desta unidade.' });
      }
      const rows = await db
        .select()
        .from(financialTitles)
        .where(eq(financialTitles.parentId, parentId))
        .orderBy(asc(financialTitles.installmentNumber), asc(financialTitles.dueDate));
      res.json({ children: rows });
    } catch (error) {
      console.error('GET /api/financial-titles/:id/children error:', error);
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao consultar parcelas vinculadas.') });
    }
  });

  // 16. Gerar Faturas agrupando 2+ títulos elegíveis
  app.post('/api/financial-titles/group-invoice', requireAuth, requireFinColl, async (req: AuthRequest, res) => {
    try {
      const b = (req.body || {}) as {
        titleIds: number[];
        baseDocument: string;
        installments: number;
        firstDueDate: string;
        intervalDays: number;
      };
      const ids = parsePositiveIntArray(b.titleIds);
      if (ids.length < 2) {
        return res.status(400).json({ error: 'Selecione ao menos 2 títulos válidos da mesma pessoa para gerar fatura.' });
      }
      const baseDoc = String(b.baseDocument || '').trim();
      if (!baseDoc) return res.status(400).json({ error: 'Informe o Nº Documento base da fatura.' });

      const installments = Math.min(60, Math.max(1, Math.trunc(parseFiniteNumber(b.installments) ?? 1)));
      const intervalDays = Math.max(1, Math.trunc(parseFiniteNumber(b.intervalDays) ?? 30));
      const firstDue = parseDateIso(b.firstDueDate, new Date(Date.now() + 30 * 86400000));

      const result = await db.transaction(async (tx) => {
        const origins = await tx.select().from(financialTitles).where(inArray(financialTitles.id, ids));
        if (origins.length !== ids.length) throw new ValidationError('Títulos selecionados não encontrados.', 404);

        const firstClientId = origins[0].clientId;
        const scope = origins[0].scope || 'RECEBER';
        for (const o of origins) {
          if (!isUnitPermitted(req, o.unitId)) {
            throw new ValidationError('Sem permissão para faturar títulos desta unidade.', 403);
          }
          if (o.clientId !== firstClientId) {
            throw new ValidationError('Todos os títulos agrupados precisam pertencer à mesma pessoa/fornecedor.', 400);
          }
          const st = normStatusUpper(o.status);
          if (['PAGO', 'CANCELADO', 'AGRUPADO', 'FATURA_GERADA'].includes(st)) {
            throw new ValidationError(`O título ${o.documentNumber || o.titleCode} (${st}) não pode ser agrupado.`, 409);
          }
        }

        const totalBal = origins.reduce((acc, o) => acc + (o.currentBalanceCents > 0 ? o.currentBalanceCents : o.amountCents), 0);
        const invoiceGroupId = crypto.randomUUID();
        const model = origins[0];

        const baseInstallment = Math.floor(totalBal / installments);
        const remainder = totalBal - baseInstallment * installments;

        const createdInvoices = [];
        for (let i = 1; i <= installments; i++) {
          const amt = i === installments ? baseInstallment + remainder : baseInstallment;
          const due = new Date(firstDue.getTime() + (i - 1) * intervalDays * 86400000);
          const pad = String(i).padStart(2, '0');
          const cleanBase = baseDoc.startsWith('FAT-') ? baseDoc : `FAT-${baseDoc}`;
          const docNum = `${cleanBase}-${pad}`;
          const code = `${scope === 'PAGAR' ? 'PAG' : 'REC'}-FAT-${Date.now().toString().slice(-6)}-${i}`;

          const [inv] = await tx
            .insert(financialTitles)
            .values({
              titleCode: code,
              scope,
              titleType: 'FATURA',
              origin: 'FATURAMENTO',
              documentNumber: docNum,
              description: `Fatura agrupada (${origins.length} título(s): ${origins.map((o) => o.documentNumber || o.titleCode).join(', ')})`,
              clientId: model.clientId,
              clientName: model.clientName,
              unitId: model.unitId,
              chartAccountId: model.chartAccountId,
              documentTypeId: model.documentTypeId,
              bearerId: model.bearerId,
              departmentId: model.departmentId,
              bankAccountId: model.bankAccountId,
              installmentNumber: i,
              totalInstallments: installments,
              isInitialFee: false,
              amountCents: amt,
              originalValueCents: amt,
              currentBalanceCents: amt,
              issueDate: new Date(),
              dueDate: due,
              forecastDate: due,
              status: 'FATURA_GERADA',
              collectionStatus: model.collectionStatus || 'COBRAR',
              accountingType: model.accountingType || 'NAO_CONTABIL',
              invoiceGroupId,
              originTitleIds: origins.map((o) => o.id),
            })
            .returning();
          createdInvoices.push(inv);
        }

        for (const orig of origins) {
          await tx.insert(titleSettlements).values({
            titleId: orig.id,
            settlementDate: new Date(),
            principalCents: 0,
            amountCents: 0,
            origin: 'FATURA GERADA',
            paymentMethod: 'Faturamento',
            history: `Agrupado na fatura grupo ${invoiceGroupId.slice(0, 8)}`,
            createdByName: req.authUser?.name || 'Sistema',
          });

          await tx
            .update(financialTitles)
            .set({
              status: 'AGRUPADO',
              currentBalanceCents: 0,
              invoiceGroupId,
              updatedAt: new Date(),
            })
            .where(eq(financialTitles.id, orig.id));
        }

        return { invoiceGroupId, invoices: createdInvoices, scope, unitId: model.unitId };
      });

      await writeTitleAudit(
        req,
        'GROUP_INVOICE',
        result.scope,
        ids[0],
        [{ field: 'Faturamento', from: `${ids.length} títulos`, to: `Grupo ${result.invoiceGroupId.slice(0, 8)}` }],
        result.unitId
      );

      res.json({ invoiceGroupId: result.invoiceGroupId, invoices: result.invoices });
    } catch (error) {
      console.error('POST /api/financial-titles/group-invoice error:', error);
      const status = error instanceof ValidationError ? error.statusCode : 400;
      res.status(status).json({ error: sanitizeErrorMessage(error, 'Erro ao gerar faturas.') });
    }
  });

  // 17. Consulta completa de Admissão para o visualizador de Ficha de Admissão (Contas a Receber)
  app.get('/api/admissions/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const id = parsePositiveIntId(req.params.id);
      if (!id) return res.status(400).json({ error: 'ID de admissão inválido.' });
      const [adm] = await db.select().from(admissions).where(eq(admissions.id, id)).limit(1);
      if (!adm) return res.status(404).json({ error: 'Ficha de admissão não encontrada.' });
      if (!isUnitPermitted(req, adm.unitId)) {
        return res.status(403).json({ error: 'Sem permissão para acessar fichas desta unidade.' });
      }

      const [clientRows, docs, scenarios, processes] = await Promise.all([
        db.select().from(clients).where(eq(clients.id, adm.clientId)).limit(1),
        db.select().from(documentObjects).where(eq(documentObjects.admissionId, adm.id)),
        db.select().from(recalcScenarios).where(eq(recalcScenarios.admissionId, adm.id)),
        db.select().from(legalProcesses).where(eq(legalProcesses.admissionId, adm.id)),
      ]);

      const procIds = processes.map((p) => p.id);
      const movements =
        procIds.length > 0
          ? await db
              .select()
              .from(legalMovements)
              .where(inArray(legalMovements.processId, procIds))
              .orderBy(desc(legalMovements.createdAt))
          : [];

      res.json({
        admission: adm,
        client: clientRows[0] || null,
        documents: docs.filter((d) => !d.deletedAt),
        recalcScenarios: scenarios,
        legalProcesses: processes,
        legalMovements: movements,
      });
    } catch (error) {
      console.error('GET /api/admissions/:id error:', error);
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao carregar ficha de admissão.') });
    }
  });

  // 18. PUT /api/clients/:id para o modal Editar Parceiro / Fornecedor
  app.put('/api/clients/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const id = parsePositiveIntId(req.params.id);
      if (!id) return res.status(400).json({ error: 'ID de cadastro inválido.' });
      const b = (req.body || {}) as Record<string, unknown>;
      const fullName = String(b.fullName || '').trim();
      if (!fullName) return res.status(400).json({ error: 'Nome / Razão Social é obrigatório.' });

      const [existing] = await db.select().from(clients).where(eq(clients.id, id)).limit(1);
      if (!existing) return res.status(404).json({ error: 'Cadastro não encontrado.' });
      if (!isUnitPermitted(req, existing.unitId)) {
        return res.status(403).json({ error: 'Sem permissão para editar cadastros desta unidade.' });
      }

      const [updated] = await db
        .update(clients)
        .set({
          fullName,
          personNature: String(b.personNature || existing.personNature || 'PF'),
          cpfCnpj: String(b.cpfCnpj ?? existing.cpfCnpj),
          phone: String(b.phone ?? existing.phone),
          whatsapp: String(b.whatsapp ?? b.phone ?? existing.whatsapp),
          email: String(b.email ?? existing.email),
          address: String(b.address ?? existing.address),
          addressNumber: String(b.addressNumber ?? existing.addressNumber),
          complement: String(b.complement ?? existing.complement),
          neighborhood: String(b.neighborhood ?? existing.neighborhood),
          city: String(b.city ?? existing.city),
          state: String(b.state ?? existing.state).toUpperCase().slice(0, 2),
          zipCode: String(b.zipCode ?? existing.zipCode),
          notes: String(b.notes ?? existing.notes),
        })
        .where(eq(clients.id, id))
        .returning();

      await db.insert(auditLogs).values({
        userId: req.authUser?.id ?? null,
        userName: req.authUser?.name || 'Sistema',
        action: 'UPDATE_CLIENT_INLINE',
        entityType: 'client',
        entityId: String(id),
        details: {
          changes: [{ field: 'Nome / Razão Social', from: existing.fullName, to: updated.fullName }],
        },
        unitId: updated.unitId,
      });

      res.json({ client: updated });
    } catch (error) {
      console.error('PUT /api/clients/:id error:', error);
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao atualizar cadastro.') });
    }
  });

  // 19. Auditoria detalhada por ID / entidade (até 2000 eventos acumulativos, compatível com legacy e AUTO_UPDATE)
  app.get('/api/audit-logs', requireAuth, async (req: AuthRequest, res) => {
    try {
      const entityId = String(req.query.entityId || '').trim();
      const entityType = String(req.query.entityType || '').trim();
      if (!entityId) return res.json({ logs: [] });

      const allowedUnits = getAllowedUnitIds(req);
      const aliases = entityType ? getEntityTypeAliases(entityType) : [];

      const rows = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            entityId.toLowerCase() !== 'all' ? eq(auditLogs.entityId, entityId) : undefined,
            aliases.length > 0
              ? inArray(auditLogs.entityType, aliases)
              : entityType
              ? eq(auditLogs.entityType, entityType)
              : inArray(auditLogs.entityType, [
                  'CONTA_RECEBER',
                  'CONTA_PAGAR',
                  'financial_title',
                  'financial_titles',
                ]),
            allowedUnits !== null
              ? allowedUnits.length > 0
                ? or(inArray(auditLogs.unitId, allowedUnits), isNull(auditLogs.unitId))
                : isNull(auditLogs.unitId)
              : undefined
          )
        )
        .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
        .limit(2000);

      res.json({ logs: rows.map((r) => normalizeAuditLogRecord(r)) });
    } catch (error) {
      console.error('GET /api/audit-logs error:', error);
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao consultar auditoria.') });
    }
  });

  // 19B. Trilha Global de Auditoria Paginada & Acumulativa (todas as rotinas atuais e futuras)
  app.get('/api/audit-logs/all', requireAuth, async (req: AuthRequest, res) => {
    try {
      const page = Math.max(1, Number(req.query.page || 1) || 1);
      const pageSize = Math.min(200, Math.max(10, Number(req.query.pageSize || 25) || 25));
      const entityType = String(req.query.entityType || '').trim();
      const entityId = String(req.query.entityId || '').trim();
      const search = String(req.query.search || '').trim();
      const allowedUnits = getAllowedUnitIds(req);

      const conditions = [];

      if (entityType && entityType !== 'all') {
        const aliases = Array.from(
          new Set(
            entityType
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
              .flatMap((s) => getEntityTypeAliases(s))
          )
        );
        if (aliases.length > 0) {
          conditions.push(inArray(auditLogs.entityType, aliases));
        } else {
          conditions.push(eq(auditLogs.entityType, entityType));
        }
      }

      if (entityId && entityId !== 'all') {
        conditions.push(eq(auditLogs.entityId, entityId));
      }

      if (allowedUnits !== null) {
        if (allowedUnits.length > 0) {
          conditions.push(or(inArray(auditLogs.unitId, allowedUnits), isNull(auditLogs.unitId)));
        } else {
          conditions.push(isNull(auditLogs.unitId));
        }
      }

      if (search) {
        const pat = `%${search}%`;
        conditions.push(
          or(
            ilike(auditLogs.userName, pat),
            ilike(auditLogs.action, pat),
            ilike(auditLogs.entityType, pat),
            ilike(auditLogs.entityId, pat),
            sql`${auditLogs.details}::text ILIKE ${pat}`
          )
        );
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      const [totalRes, rows, entityRows] = await Promise.all([
        db.select({ value: count() }).from(auditLogs).where(whereClause),
        db
          .select()
          .from(auditLogs)
          .where(whereClause)
          .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
          .limit(pageSize)
          .offset((page - 1) * pageSize),
        db
          .selectDistinct({ entityType: auditLogs.entityType })
          .from(auditLogs)
          .orderBy(asc(auditLogs.entityType)),
      ]);

      const total = Number(totalRes[0]?.value || 0);
      const totalPages = Math.max(1, Math.ceil(total / pageSize));
      const availableEntities = entityRows.map((e) => ({
        entityType: e.entityType,
        label: getEntityLabel(e.entityType),
      }));

      res.json({
        logs: rows.map((r) => normalizeAuditLogRecord(r)),
        total,
        page,
        pageSize,
        totalPages,
        availableEntities,
      });
    } catch (error) {
      console.error('GET /api/audit-logs/all error:', error);
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao consultar trilha global de auditoria.') });
    }
  });

  // 20. RÉGUA DE COBRANÇA IVI (Tela separada com lotes confirmáveis antes do disparo)
  app.get('/api/finance/regua/batches', requireAuth, requireModule('finance'), async (req: AuthRequest, res) => {
    try {
      await ensureInitialSeed();
      const allowedUnits = getAllowedUnitIds(req);
      const [allTitles, allClients, settingRows] = await Promise.all([
        db
          .select()
          .from(financialTitles)
          .where(
            allowedUnits !== null
              ? and(eq(financialTitles.scope, 'RECEBER'), inArray(financialTitles.unitId, allowedUnits))
              : eq(financialTitles.scope, 'RECEBER')
          )
          .orderBy(asc(financialTitles.dueDate)),
        db.select().from(clients),
        db.select().from(systemSettings).where(eq(systemSettings.key, 'regua_cobranca')),
      ]);

      const cfg = (settingRows[0]?.value || { beforeDays1: 15, beforeDays2: 5, afterDays: 7 }) as {
        beforeDays1?: number;
        beforeDays2?: number;
        afterDays?: number;
      };
      const before1 = Number(cfg.beforeDays1 ?? 15);
      const before2 = Number(cfg.beforeDays2 ?? 5);
      const after1 = Number(cfg.afterDays ?? 7);

      const nowMs = Date.now();
      const clientMap = new Map(allClients.map((c) => [c.id, c]));

      const candidates = allTitles
        .filter((t) => {
          const st = normStatusUpper(t.status);
          if (['PAGO', 'CANCELADO', 'AGRUPADO', 'PROVISAO'].includes(st)) return false;
          if (String(t.collectionStatus || 'COBRAR').toUpperCase() === 'NAO_COBRAR') return false;
          const bal = t.currentBalanceCents > 0 ? t.currentBalanceCents : t.amountCents;
          return bal > 0;
        })
        .map((t) => {
          const cl = clientMap.get(t.clientId);
          const daysToDue = Math.round((new Date(t.dueDate).getTime() - nowMs) / 86400000);
          let stageTag: '-15d' | '-5d' | '+7d' = '-15d';
          if (daysToDue < 0) stageTag = '+7d';
          else if (daysToDue <= before2) stageTag = '-5d';
          else stageTag = '-15d';

          const bal = t.currentBalanceCents > 0 ? t.currentBalanceCents : t.amountCents;
          const formatted = formatCentsPtBr(bal);
          const dueBr = new Date(t.dueDate).toLocaleDateString('pt-BR');
          const firstName = (cl?.fullName || t.clientName || 'Cliente').split(' ')[0];

          const suggestedMessage =
            stageTag === '-15d'
              ? `Olá, ${firstName}! Aqui é a Ivi da FinancePro Assessoria. Lembramos com antecedência que sua parcela ${t.installmentNumber}/${t.totalInstallments} (${t.documentNumber || t.titleCode}) no valor de ${formatted} vencerá em ${dueBr}. Caso já deseje a 2ª via do boleto ou chave PIX, é só nos chamar.`
              : stageTag === '-5d'
              ? `Olá, ${firstName}! Tudo bem? Aqui é a Ivi da FinancePro Assessoria. Passando para lembrar que sua parcela (${t.documentNumber || t.titleCode}) de ${formatted} vence em breve, no dia ${dueBr}. Posso reenviar o boleto Santander ou PIX para facilitar?`
              : `Olá, ${firstName}. Aqui é a Ivi da FinancePro Assessoria. Identificamos que sua parcela (${t.documentNumber || t.titleCode}) no valor de ${formatted}, vencida em ${dueBr} (${Math.abs(daysToDue)} dias em atraso), segue em aberto. Estamos à disposição para negociar ou atualizar seu boleto hoje mesmo.`;

          return {
            titleId: t.id,
            titleCode: t.titleCode,
            documentNumber: t.documentNumber || t.titleCode,
            description: t.description || `Parcela ${t.installmentNumber}/${t.totalInstallments}`,
            clientId: t.clientId,
            clientName: cl?.fullName || t.clientName || 'Cliente',
            clientPhone: cl?.phone || '',
            clientWhatsapp: cl?.whatsapp || cl?.phone || '',
            clientEmail: cl?.email || '',
            unitId: t.unitId,
            dueDate: t.dueDate.toISOString(),
            daysOffset: daysToDue,
            stageTag,
            balanceCents: bal,
            installmentNumber: t.installmentNumber,
            totalInstallments: t.totalInstallments,
            alreadySentStages: Array.isArray(t.reguaStageSent) ? t.reguaStageSent : [],
            suggestedMessage,
          };
        });

      res.json({
        config: { beforeDays1: before1, beforeDays2: before2, afterDays: after1 },
        candidates,
      });
    } catch (error) {
      console.error('GET /api/finance/regua/batches error:', error);
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao montar lotes da régua de cobrança.') });
    }
  });

  app.post('/api/finance/regua/confirm-batch', requireAuth, requireModule('finance'), async (req: AuthRequest, res) => {
    try {
      const { stageTag, titleIds, useAiPersonalization, messageOverrides } = (req.body || {}) as {
        stageTag: '-15d' | '-5d' | '+7d';
        titleIds: number[];
        useAiPersonalization?: boolean;
        messageOverrides?: Record<string, string>;
      };

      if (!['-15d', '-5d', '+7d'].includes(String(stageTag))) {
        return res.status(400).json({ error: 'Estágio da régua inválido.' });
      }
      const ids = parsePositiveIntArray(titleIds);
      if (ids.length === 0) return res.status(400).json({ error: 'Selecione ao menos um título no lote para confirmar o envio pela Ivi.' });

      const rawTitles = await db.select().from(financialTitles).where(inArray(financialTitles.id, ids));
      for (const t of rawTitles) {
        if (!isUnitPermitted(req, t.unitId)) {
          return res.status(403).json({ error: 'Sem permissão para disparar régua em títulos desta unidade.' });
        }
      }
      const titles = rawTitles;
      const allClients = await db.select().from(clients);
      const clientMap = new Map(allClients.map((c) => [c.id, c]));

      const dispatched: Array<{ titleId: number; titleCode: string; clientName: string; provider: string; message: string }> = [];

      for (const t of titles) {
        const cl = clientMap.get(t.clientId);
        const bal = t.currentBalanceCents > 0 ? t.currentBalanceCents : t.amountCents;
        const overrideText = messageOverrides?.[String(t.id)]?.trim();
        let messageText = overrideText || '';
        let providerUsed = 'template_confirmado';

        if (!messageText) {
          if (useAiPersonalization) {
            const daysDiff = Math.round((new Date(t.dueDate).getTime() - Date.now()) / 86400000);
            const draft = await iviDraftCollectionMessage({
              clientName: cl?.fullName || t.clientName || 'Cliente',
              amountFormatted: formatCentsPtBr(bal),
              daysOffset: daysDiff < 0 ? Math.abs(daysDiff) : -daysDiff,
              processSummary: `Documento ${t.documentNumber || t.titleCode} (${t.installmentNumber}/${t.totalInstallments})`,
            });
            messageText = draft.text;
            providerUsed = draft.provider;
          } else {
            const dueBr = new Date(t.dueDate).toLocaleDateString('pt-BR');
            const firstName = (cl?.fullName || t.clientName || 'Cliente').split(' ')[0];
            messageText =
              stageTag === '-15d'
                ? `Olá, ${firstName}! Aqui é a Ivi da FinancePro Assessoria. Sua parcela ${t.documentNumber || t.titleCode} no valor de ${formatCentsPtBr(bal)} vence em ${dueBr}.`
                : stageTag === '-5d'
                ? `Olá, ${firstName}! Aqui é a Ivi da FinancePro Assessoria. Lembramos que sua parcela ${t.documentNumber || t.titleCode} (${formatCentsPtBr(bal)}) vence em breve (${dueBr}).`
                : `Olá, ${firstName}. Aqui é a Ivi da FinancePro Assessoria. Consta em aberto sua parcela ${t.documentNumber || t.titleCode} (${formatCentsPtBr(bal)}, vencimento ${dueBr}). Podemos ajudar com a regularização?`;
          }
        }

        const nextStages = Array.from(new Set([...(t.reguaStageSent || []), stageTag]));
        await db
          .update(financialTitles)
          .set({ reguaStageSent: nextStages, updatedAt: new Date() })
          .where(eq(financialTitles.id, t.id));

        // If client has a WhatsApp thread, log outbound Ivi message for complete omnichannel traceability
        const [thread] = await db
          .select()
          .from(whatsappThreads)
          .where(eq(whatsappThreads.clientId, t.clientId))
          .limit(1);
        if (thread) {
          await db.insert(whatsappMessages).values({
            threadId: thread.id,
            direction: 'outbound',
            contentType: 'text',
            body: `[Régua Ivi ${stageTag}] ${messageText}`,
            senderName: 'Ivi IA · Régua Automática',
            operatorName: req.authUser?.name || 'Sistema',
            department: 'Financeiro',
          });
        }

        await writeTitleAudit(
          req,
          'REGUA_IVI_DISPATCH',
          'RECEBER',
          t.id,
          [
            { field: 'Régua Ivi Estágio', from: (t.reguaStageSent || []).join(', ') || '—', to: stageTag },
            { field: 'Mensagem', from: '—', to: messageText.slice(0, 140) },
          ],
          t.unitId
        );

        dispatched.push({
          titleId: t.id,
          titleCode: t.titleCode,
          clientName: cl?.fullName || t.clientName || 'Cliente',
          provider: providerUsed,
          message: messageText,
        });
      }

      res.json({
        dispatchedCount: dispatched.length,
        stageTag,
        dispatched,
      });
    } catch (error) {
      console.error('POST /api/finance/regua/confirm-batch error:', error);
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao confirmar e disparar lote pela Ivi.') });
    }
  });
}
