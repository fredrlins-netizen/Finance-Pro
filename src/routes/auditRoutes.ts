import type { Express } from 'express';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import {
  admissions,
  auditChecklistItems,
  auditLogs,
  bearers,
  clients,
  documentObjects,
  documentTypes,
  financialTitles,
  internalMessages,
  iviAuditDecisionsCache,
  IviAuditAnalysisSnapshot,
  IviChecklistVerificationItem,
  legalMovements,
  legalProcesses,
  negotiations,
  paymentCategories,
  recalcScenarios,
  units,
} from '../db/schema.ts';
import { AuthRequest, getAllowedUnitIds, isUnitPermitted, requireAuth, requireModule } from '../middleware/auth.ts';
import { dispatchIviSectorNotification } from '../services/internalMessaging.ts';
import { getBucketObjectBuffer } from '../services/bucketStorage.ts';
import { getEntityTypeAliases, normalizeAuditLogRecord } from '../utils/auditDiff.ts';
import { parseFiniteNumber, parsePositiveIntId, parseSafeDate, sanitizeErrorMessage } from '../utils/validation.ts';
import {
  buildChecklistVerificationReport,
  computeAuditFingerprint,
  iviAnalyzeAuditDossier,
  iviAskAboutAuditDossier,
  iviGenerateAuditInsightsPanel,
  iviInspectAuditDocument,
  iviSweepChecklistLocal,
  iviTranslateLegalDispatch,
} from '../services/ivi.ts';

function formatBrlServer(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function parseIsoDateStrict(raw: unknown, fallback: Date): Date | null {
  if (raw === undefined || raw === null || String(raw).trim() === '') return fallback;
  return parseSafeDate(raw);
}

async function resolveDefaultAuditBillingRefs() {
  const [cats, docTypes, allBearers] = await Promise.all([
    db.select().from(paymentCategories),
    db.select().from(documentTypes),
    db.select().from(bearers),
  ]);
  const defaultCat = cats[0] || null;
  const boletoDocType =
    docTypes.find((d) => d.active && d.description.toLowerCase().includes('boleto')) ||
    docTypes.find((d) => d.active) ||
    null;
  const collectionBearer =
    allBearers.find((b) => b.active && b.name.toLowerCase().includes('cobran')) ||
    allBearers.find((b) => b.active && String(b.type || '').toUpperCase() === 'BANCO') ||
    allBearers.find((b) => b.active) ||
    null;
  return { defaultCat, boletoDocType, collectionBearer };
}

export function registerAuditRoutes(
  app: Express,
  deps: { broadcast: (event: string, payload: unknown) => void }
) {
  const { broadcast } = deps;

  async function findCachedDecision(params: {
    admissionId: number;
    decisionType: 'checklist_sweep' | 'document_insights' | 'document_inspection';
    cacheKeyHash: string;
    documentId?: number | null;
  }) {
    const conds = [
      eq(iviAuditDecisionsCache.admissionId, params.admissionId),
      eq(iviAuditDecisionsCache.decisionType, params.decisionType),
      eq(iviAuditDecisionsCache.cacheKeyHash, params.cacheKeyHash),
      params.documentId
        ? eq(iviAuditDecisionsCache.documentId, params.documentId)
        : isNull(iviAuditDecisionsCache.documentId),
    ];
    const [hit] = await db
      .select()
      .from(iviAuditDecisionsCache)
      .where(and(...conds))
      .orderBy(desc(iviAuditDecisionsCache.id))
      .limit(1);
    if (!hit) return null;

    const [updated] = await db
      .update(iviAuditDecisionsCache)
      .set({
        aiCallsSaved: sql`${iviAuditDecisionsCache.aiCallsSaved} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(iviAuditDecisionsCache.id, hit.id))
      .returning();
    return updated || hit;
  }

  async function upsertCachedDecision(params: {
    admissionId: number;
    documentId?: number | null;
    decisionType: 'checklist_sweep' | 'document_insights' | 'document_inspection';
    cacheKeyHash: string;
    verdict: string;
    inconsistenciesCount: number;
    attentionCount: number;
    summaryText: string;
    checklistReportJson: IviChecklistVerificationItem[];
    payloadJson: Record<string, unknown>;
    sourceEngine: string;
  }) {
    const conds = [
      eq(iviAuditDecisionsCache.admissionId, params.admissionId),
      eq(iviAuditDecisionsCache.decisionType, params.decisionType),
      params.documentId
        ? eq(iviAuditDecisionsCache.documentId, params.documentId)
        : isNull(iviAuditDecisionsCache.documentId),
    ];
    const [existing] = await db
      .select()
      .from(iviAuditDecisionsCache)
      .where(and(...conds))
      .limit(1);

    if (existing) {
      const [updated] = await db
        .update(iviAuditDecisionsCache)
        .set({
          cacheKeyHash: params.cacheKeyHash,
          verdict: params.verdict,
          inconsistenciesCount: params.inconsistenciesCount,
          attentionCount: params.attentionCount,
          summaryText: params.summaryText,
          checklistReportJson: params.checklistReportJson,
          payloadJson: params.payloadJson,
          sourceEngine: params.sourceEngine,
          updatedAt: new Date(),
        })
        .where(eq(iviAuditDecisionsCache.id, existing.id))
        .returning();
      return updated;
    }

    const [inserted] = await db
      .insert(iviAuditDecisionsCache)
      .values({
        admissionId: params.admissionId,
        documentId: params.documentId ?? null,
        decisionType: params.decisionType,
        cacheKeyHash: params.cacheKeyHash,
        verdict: params.verdict,
        inconsistenciesCount: params.inconsistenciesCount,
        attentionCount: params.attentionCount,
        summaryText: params.summaryText,
        checklistReportJson: params.checklistReportJson,
        payloadJson: params.payloadJson,
        sourceEngine: params.sourceEngine,
        aiCallsSaved: 0,
      })
      .returning();
    return inserted;
  }

  // 1. Contexto completo do dossiê para Auditoria & Boletos (1 único round-trip)
  app.get('/api/audit/:admissionId/context', requireAuth, requireModule('audit'), async (req: AuthRequest, res) => {
    try {
      const admissionId = parsePositiveIntId(req.params.admissionId);
      if (!admissionId) return res.status(400).json({ error: 'ID de admissão inválido.' });

      const [adm] = await db.select().from(admissions).where(eq(admissions.id, admissionId)).limit(1);
      if (!adm) return res.status(404).json({ error: 'Ficha de admissão não encontrada.' });
      if (!isUnitPermitted(req, adm.unitId)) {
        return res.status(403).json({ error: 'Sem permissão para acessar admissão desta unidade.' });
      }

      const [
        clientRows,
        titularRows,
        unitRows,
        allDocs,
        linkedTitles,
        scenarios,
        processes,
        logs,
        checklist,
      ] = await Promise.all([
        db.select().from(clients).where(eq(clients.id, adm.clientId)).limit(1),
        adm.assetOwnerId
          ? db.select().from(clients).where(eq(clients.id, adm.assetOwnerId)).limit(1)
          : Promise.resolve([]),
        db.select().from(units).where(eq(units.id, adm.unitId)).limit(1),
        db
          .select()
          .from(documentObjects)
          .where(eq(documentObjects.clientId, adm.clientId))
          .orderBy(desc(documentObjects.id)),
        db
          .select()
          .from(financialTitles)
          .where(and(eq(financialTitles.admissionId, adm.id), eq(financialTitles.scope, 'RECEBER')))
          .orderBy(financialTitles.installmentNumber, financialTitles.dueDate),
        db
          .select()
          .from(recalcScenarios)
          .where(eq(recalcScenarios.admissionId, adm.id))
          .orderBy(desc(recalcScenarios.id)),
        db
          .select()
          .from(legalProcesses)
          .where(eq(legalProcesses.admissionId, adm.id))
          .orderBy(desc(legalProcesses.id)),
        db
          .select()
          .from(auditLogs)
          .where(
            and(
              inArray(auditLogs.entityType, getEntityTypeAliases('admissions')),
              eq(auditLogs.entityId, String(adm.id))
            )
          )
          .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
          .limit(200),
        db.select().from(auditChecklistItems).orderBy(auditChecklistItems.sortOrder, auditChecklistItems.id),
      ]);

      const isAdmin = req.authUser?.role === 'admin';
      const allowedUnits = req.authUser?.allowedUnitIds || [];
      const visibleDocs = allDocs.filter(
        (d) =>
          !d.deletedAt &&
          (d.admissionId === adm.id || d.admissionId === null) &&
          (isAdmin || allowedUnits.includes(d.unitId))
      );

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
        titular: titularRows[0] || null,
        unit: unitRows[0] || null,
        documents: visibleDocs,
        titles: linkedTitles,
        recalcScenarios: scenarios,
        legalProcesses: processes,
        legalMovements: movements,
        auditLogs: logs.map((r) => normalizeAuditLogRecord(r)),
        checklistItems: checklist,
      });
    } catch (error) {
      console.error('GET /api/audit/:admissionId/context error:', error);
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao carregar contexto do dossiê.') });
    }
  });

  // 2. Salvar progresso real da auditoria (checklist + parecer manual + veículo elétrico + status Em Análise)
  app.patch('/api/audit/:admissionId/progress', requireAuth, requireModule('audit'), async (req: AuthRequest, res) => {
    try {
      const admissionId = parsePositiveIntId(req.params.admissionId);
      if (!admissionId) return res.status(400).json({ error: 'ID de admissão inválido.' });
      const body = (req.body || {}) as {
        status?: 'aguardando_auditoria' | 'auditada';
        checklistState?: Record<string, boolean>;
        auditManualNotes?: string;
        isElectricVehicle?: boolean;
        escavadorAlert?: boolean;
      };

      const [adm] = await db.select().from(admissions).where(eq(admissions.id, admissionId)).limit(1);
      if (!adm) return res.status(404).json({ error: 'Ficha de admissão não encontrada.' });
      if (!isUnitPermitted(req, adm.unitId)) {
        return res.status(403).json({ error: 'Sem permissão para alterar admissão desta unidade.' });
      }

      const nextStatus =
        body.status && ['aguardando_auditoria', 'auditada'].includes(body.status) && ['aguardando_auditoria', 'devolvida_admissao', 'retorno_auditoria', 'auditada'].includes(adm.status)
          ? body.status
          : adm.status;

      const nextNotes =
        body.auditManualNotes !== undefined ? String(body.auditManualNotes) : adm.auditManualNotes;
      const notesChanged =
        body.auditManualNotes !== undefined &&
        nextNotes.trim() !== String(adm.auditManualNotes || '').trim();
      const authorLabel = req.authUser?.name || req.authUser?.email || 'Auditor';
      const now = new Date();
      const prevConsiderations = Array.isArray(adm.auditConsiderationsJson)
        ? adm.auditConsiderationsJson
        : [];
      const nextConsiderations =
        notesChanged && nextNotes.trim()
          ? [
              ...prevConsiderations,
              {
                id: `cons-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
                authorName: authorLabel,
                text: nextNotes.trim(),
                createdAt: now.toISOString(),
              },
            ]
          : prevConsiderations;

      const [updated] = await db
        .update(admissions)
        .set({
          status: nextStatus,
          auditChecklistStateJson: body.checklistState ?? adm.auditChecklistStateJson ?? {},
          auditManualNotes: nextNotes,
          auditManualNotesBy: notesChanged
            ? authorLabel
            : adm.auditManualNotesBy || '',
          auditManualNotesAt: notesChanged ? now : adm.auditManualNotesAt,
          auditConsiderationsJson: nextConsiderations,
          isElectricVehicle: body.isElectricVehicle !== undefined ? Boolean(body.isElectricVehicle) : adm.isElectricVehicle,
          escavadorAlert: body.escavadorAlert !== undefined ? Boolean(body.escavadorAlert) : adm.escavadorAlert,
          auditorId: req.authUser?.id ?? adm.auditorId,
        })
        .where(eq(admissions.id, admissionId))
        .returning();

      await db.insert(auditLogs).values({
        userId: req.authUser?.id ?? null,
        userName: req.authUser?.name || 'Auditor',
        action: 'AUDIT_PROGRESS_SAVED',
        entityType: 'admission',
        entityId: String(admissionId),
        details: {
          status: nextStatus,
          checkedItemsCount: Object.values(updated.auditChecklistStateJson || {}).filter(Boolean).length,
          hasManualNotes: Boolean(updated.auditManualNotes?.trim()),
          isElectricVehicle: updated.isElectricVehicle,
        },
        unitId: adm.unitId,
      });

      res.json({ admission: updated });
    } catch (error) {
      console.error('PATCH /api/audit/:admissionId/progress error:', error);
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao salvar progresso da auditoria.') });
    }
  });

  // 3. Gerar Boletos / Lançamentos vinculados à admissão (Taxa Adm / 1ª Parcela / Par Inicial)
  app.post('/api/audit/:admissionId/generate-boletos', requireAuth, requireModule('audit'), async (req: AuthRequest, res) => {
    try {
      const admissionId = parsePositiveIntId(req.params.admissionId);
      if (!admissionId) return res.status(400).json({ error: 'ID de admissão inválido.' });
      const body = (req.body || {}) as {
        mode?: 'taxa_adm' | 'primeira_parcela' | 'par_inicial';
        boletoProvider?: string;
        amountCents?: number;
        dueDate?: string;
        description?: string;
        allowDuplicate?: boolean;
      };

      const [adm] = await db.select().from(admissions).where(eq(admissions.id, admissionId)).limit(1);
      if (!adm) return res.status(404).json({ error: 'Admissão não encontrada.' });
      if (!isUnitPermitted(req, adm.unitId)) {
        return res.status(403).json({ error: 'Sem permissão para gerar boletos nesta unidade.' });
      }

      const [clRows, existingTitles] = await Promise.all([
        db.select().from(clients).where(eq(clients.id, adm.clientId)).limit(1),
        db
          .select()
          .from(financialTitles)
          .where(and(eq(financialTitles.admissionId, adm.id), eq(financialTitles.scope, 'RECEBER'))),
      ]);
      const client = clRows[0];
      const activeTitles = existingTitles.filter((t) => String(t.status).toUpperCase() !== 'CANCELADO');

      const mode = body.boletoProvider ? body.mode || 'par_inicial' : body.mode || 'par_inicial';
      if (!body.allowDuplicate && mode === 'par_inicial' && activeTitles.length >= 2) {
        return res.status(409).json({
          error: `Já existem ${activeTitles.length} título(s) ativo(s) vinculados a esta admissão. Edite os existentes ou marque "Permitir geração adicional".`,
        });
      }

      const provider = body.boletoProvider || 'santander';
      const { defaultCat, boletoDocType, collectionBearer } = await resolveDefaultAuditBillingRefs();
      const now = new Date();

      let singleDueDate: Date | null = null;
      let singleValCents = 0;
      if (mode === 'taxa_adm' || mode === 'primeira_parcela') {
        const isFirst = mode === 'primeira_parcela';
        const defaultDue = new Date(Date.now() + (isFirst ? 30 : 5) * 86400000);
        singleDueDate = parseIsoDateStrict(body.dueDate, defaultDue);
        if (!singleDueDate) {
          return res.status(400).json({ error: 'Data de vencimento inválida.' });
        }
        const rawAmt = body.amountCents !== undefined
          ? parseFiniteNumber(body.amountCents)
          : Number(isFirst ? adm.initialInstallmentCents : adm.serviceInitialCents || adm.initialInstallmentCents || 50000);
        if (rawAmt === null || rawAmt <= 0) {
          return res.status(400).json({ error: 'Valor do boleto inválido.' });
        }
        singleValCents = Math.max(100, Math.round(rawAmt));
      }

      const created = await db.transaction(async (tx) => {
        const insertedList: typeof existingTitles = [];
        if (mode === 'taxa_adm' || mode === 'primeira_parcela') {
          const isFirst = mode === 'primeira_parcela';
          const seqNum = isFirst ? 2 : 1;
          const docNum = isFirst ? `${adm.contractNumber}-01` : adm.contractNumber;
          const desc =
            body.description?.trim() ||
            `${isFirst ? '1ª Parcela' : 'Taxa Administrativa'} — Contrato #${adm.contractNumber} | ${client?.fullName || 'Cliente'} (${adm.bankName})`;

          const [title] = await tx
            .insert(financialTitles)
            .values({
              titleCode: `TIT-${now.getFullYear()}-${adm.id}-${Date.now().toString().slice(-4)}`,
              scope: 'RECEBER',
              titleType: 'PADRAO',
              origin: 'AUDITORIA',
              documentNumber: docNum,
              description: desc,
              clientId: adm.clientId,
              clientName: client?.fullName || '',
              admissionId: adm.id,
              unitId: adm.unitId,
              categoryId: defaultCat?.id || null,
              documentTypeId: boletoDocType?.id || null,
              bearerId: collectionBearer?.id || null,
              sellerId: adm.consultantId || null,
              assignedCollaboratorId: adm.consultantId || null,
              installmentNumber: seqNum,
              totalInstallments: adm.installmentsCount || 2,
              isInitialFee: !isFirst,
              amountCents: singleValCents,
              originalValueCents: singleValCents,
              currentBalanceCents: singleValCents,
              issueDate: now,
              dueDate: singleDueDate!,
              status: 'ABERTO',
              collectionStatus: 'COBRAR',
              boletoProvider: provider,
              barcode: `03399.63290 64000.00${adm.id} 00100.${seqNum}01014 8 ${Math.floor(10000000000000 + Math.random() * 89999999999999)}`,
              ourNumber: `${adm.id}00${Date.now().toString().slice(-4)}`,
              contractNumber: adm.contractNumber,
            })
            .returning();
          insertedList.push(title);
        } else {
          for (let i = 1; i <= 2; i++) {
            const valCents = Math.max(100, Number(adm.initialInstallmentCents || 50000));
            const dueDate = new Date(Date.now() + (i === 1 ? 5 : 35) * 86400000);
            const [title] = await tx
              .insert(financialTitles)
              .values({
                titleCode: `TIT-${now.getFullYear()}-${adm.id}0${i}-${Math.floor(100 + Math.random() * 899)}`,
                scope: 'RECEBER',
                titleType: 'PADRAO',
                origin: 'AUDITORIA',
                documentNumber: i === 1 ? adm.contractNumber : `${adm.contractNumber}-01`,
                description: `${i === 1 ? 'Taxa Administrativa' : '1ª Parcela'} — Contrato #${adm.contractNumber} | ${client?.fullName || 'Cliente'} (${adm.bankName})`,
                clientId: adm.clientId,
                clientName: client?.fullName || '',
                admissionId: adm.id,
                unitId: adm.unitId,
                categoryId: defaultCat?.id || null,
                documentTypeId: boletoDocType?.id || null,
                bearerId: collectionBearer?.id || null,
                sellerId: adm.consultantId || null,
                assignedCollaboratorId: adm.consultantId || null,
                installmentNumber: i,
                totalInstallments: adm.installmentsCount || 2,
                isInitialFee: true,
                amountCents: valCents,
                originalValueCents: valCents,
                currentBalanceCents: valCents,
                issueDate: now,
                dueDate,
                status: 'ABERTO',
                collectionStatus: 'COBRAR',
                boletoProvider: provider,
                barcode: `03399.63290 64000.00${adm.id} 00100.${i}01014 8 ${Math.floor(10000000000000 + Math.random() * 89999999999999)}`,
                ourNumber: `${adm.id}000${i}${Math.floor(10 + Math.random() * 89)}`,
                contractNumber: adm.contractNumber,
              })
              .returning();
            insertedList.push(title);
          }
        }

        await tx.insert(auditLogs).values({
          userId: req.authUser?.id ?? null,
          userName: req.authUser?.name || 'Auditor',
          action: 'AUDIT_BOLETOS_GENERATED',
          entityType: 'admission',
          entityId: String(adm.id),
          details: {
            mode,
            provider,
            count: insertedList.length,
            titleCodes: insertedList.map((c) => c.titleCode),
          },
          unitId: adm.unitId,
        });

        return insertedList;
      });

      res.json({ titles: created });
    } catch (error) {
      console.error('POST /api/audit/:admissionId/generate-boletos error:', error);
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao gerar lançamentos financeiros da auditoria.') });
    }
  });

  // 4. Aprovar Auditoria + Emitir 2 Boletos (se ainda não gerados) + Rotear Jurídico/Negociações + Notificar
  app.post('/api/audit/:admissionId/approve', requireAuth, requireModule('audit'), async (req: AuthRequest, res) => {
    try {
      const admissionId = parsePositiveIntId(req.params.admissionId);
      if (!admissionId) return res.status(400).json({ error: 'ID de admissão inválido.' });
      const {
        boletoProvider,
        hasSearchSeizure,
        checklistState,
        auditManualNotes,
        isElectricVehicle,
        forceElectricOverride,
        notifyDepartments,
      } = (req.body || {}) as {
        boletoProvider?: string;
        hasSearchSeizure?: boolean;
        checklistState?: Record<string, boolean>;
        auditManualNotes?: string;
        isElectricVehicle?: boolean;
        forceElectricOverride?: boolean;
        notifyDepartments?: boolean;
      };

      const rows = await db.select().from(admissions).where(eq(admissions.id, admissionId)).limit(1);
      const adm = rows[0];
      if (!adm) return res.status(404).json({ error: 'Admissão não encontrada.' });
      if (!isUnitPermitted(req, adm.unitId)) {
        return res.status(403).json({ error: 'Sem permissão para aprovar admissão desta unidade.' });
      }

      const effectiveElectric =
        isElectricVehicle !== undefined ? Boolean(isElectricVehicle) : Boolean(adm.isElectricVehicle);
      if (effectiveElectric && !forceElectricOverride) {
        return res.status(409).json({
          error:
            'Veículo elétrico sinalizado nesta ficha. Confirme a exceção operacional na conferência ou devolva ao Comercial antes de finalizar.',
          code: 'ELECTRIC_VEHICLE_BLOCKED',
        });
      }

      const [clientRows, existingProcs] = await Promise.all([
        db.select().from(clients).where(eq(clients.id, adm.clientId)).limit(1),
        db.select().from(legalProcesses).where(eq(legalProcesses.admissionId, adm.id)),
      ]);
      const client = clientRows[0];

      const provider = boletoProvider || 'santander';
      const slaMinutes = Math.max(
        5,
        Math.round((Date.now() - new Date(adm.submittedToAuditAt || adm.createdAt).getTime()) / 60000)
      );

      const approveNotes = auditManualNotes !== undefined ? String(auditManualNotes) : adm.auditManualNotes;
      const approveNotesChanged =
        auditManualNotes !== undefined && approveNotes.trim() !== String(adm.auditManualNotes || '').trim();
      const approveAuthor = req.authUser?.name || req.authUser?.email || 'Auditor';
      const approveNow = new Date();
      const prevApproveCons = Array.isArray(adm.auditConsiderationsJson) ? adm.auditConsiderationsJson : [];
      const nextApproveCons =
        approveNotesChanged && approveNotes.trim()
          ? [
              ...prevApproveCons,
              {
                id: `cons-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
                authorName: approveAuthor,
                text: approveNotes.trim(),
                createdAt: approveNow.toISOString(),
              },
            ]
          : prevApproveCons;

      let searchSeizureDispatchText = '';
      if (hasSearchSeizure && existingProcs.length === 0) {
        const dispatch = 'Varredura Escavador/Detran identificou distribuição de ação de busca e apreensão com restrição RENAJUD ativa.';
        const tr = await iviTranslateLegalDispatch(dispatch);
        searchSeizureDispatchText = tr.text;
      }

      const { defaultCat, boletoDocType, collectionBearer } = await resolveDefaultAuditBillingRefs();

      const txResult = await db.transaction(async (tx) => {
        const [updatedAdm] = await tx
          .update(admissions)
          .set({
            status: 'aprovada',
            auditorId: req.authUser!.id,
            activeReviewerId: null,
            activeReviewerName: '',
            activeReviewerSince: null,
            auditedAt: approveNow,
            slaMinutes,
            escavadorAlert: Boolean(hasSearchSeizure),
            isElectricVehicle: effectiveElectric,
            auditChecklistStateJson: checklistState ?? adm.auditChecklistStateJson ?? {},
            auditManualNotes: approveNotes,
            auditManualNotesBy: approveNotesChanged ? approveAuthor : adm.auditManualNotesBy || '',
            auditManualNotesAt: approveNotesChanged ? approveNow : adm.auditManualNotesAt,
            auditConsiderationsJson: nextApproveCons,
          })
          .where(eq(admissions.id, admissionId))
          .returning();

        const txExistingTitles = await tx
          .select()
          .from(financialTitles)
          .where(and(eq(financialTitles.admissionId, adm.id), eq(financialTitles.scope, 'RECEBER')));
        const activeTitles = txExistingTitles.filter((t) => String(t.status).toUpperCase() !== 'CANCELADO');
        const createdTitles = [];

        if (activeTitles.length === 0) {
          const now = new Date();
          for (let i = 1; i <= 2; i++) {
            const valCents = Math.max(100, Number(adm.initialInstallmentCents || 50000));
            const dueDate = new Date(Date.now() + (i === 1 ? 5 : 35) * 86400000);
            const [title] = await tx
              .insert(financialTitles)
              .values({
                titleCode: `TIT-${now.getFullYear()}-${admissionId}0${i}-${Math.floor(100 + Math.random() * 899)}`,
                scope: 'RECEBER',
                titleType: 'PADRAO',
                origin: 'AUDITORIA',
                documentNumber: i === 1 ? adm.contractNumber : `${adm.contractNumber}-01`,
                description: `${i === 1 ? 'Taxa Administrativa' : '1ª Parcela'} — Contrato #${adm.contractNumber} | ${client?.fullName || 'Cliente'} (${adm.bankName})`,
                clientId: adm.clientId,
                clientName: client?.fullName || '',
                admissionId: adm.id,
                unitId: adm.unitId,
                categoryId: defaultCat?.id || null,
                documentTypeId: boletoDocType?.id || null,
                bearerId: collectionBearer?.id || null,
                sellerId: adm.consultantId || null,
                assignedCollaboratorId: adm.consultantId || null,
                installmentNumber: i,
                totalInstallments: adm.installmentsCount || 2,
                isInitialFee: true,
                amountCents: valCents,
                originalValueCents: valCents,
                currentBalanceCents: valCents,
                issueDate: now,
                dueDate,
                status: 'ABERTO',
                collectionStatus: 'COBRAR',
                boletoProvider: provider,
                barcode: `03399.63290 64000.00${admissionId} 00100.${i}01014 8 ${Math.floor(10000000000000 + Math.random() * 89999999999999)}`,
                ourNumber: `${admissionId}000${i}`,
                contractNumber: adm.contractNumber,
              })
              .returning();
            createdTitles.push(title);
          }
        }

        const txExistingProcs = await tx.select().from(legalProcesses).where(eq(legalProcesses.admissionId, adm.id));
        let legalProc = txExistingProcs[0];
        if (!legalProc) {
          const processNumber = `00${Math.floor(10000 + Math.random() * 89999)}-${Math.floor(10 + Math.random() * 89)}.2026.8.17.2001`;
          const [insertedProc] = await tx
            .insert(legalProcesses)
            .values({
              processNumber,
              clientId: adm.clientId,
              admissionId: adm.id,
              unitId: adm.unitId,
              courtName: hasSearchSeizure ? 'TJPE - Vara Cível (Varredura Escavador)' : 'Acompanhamento Preventivo Escavador + Detran',
              actionType: hasSearchSeizure ? 'busca_apreensao' : 'revisional',
              hasSearchSeizure: Boolean(hasSearchSeizure),
              vehicleSeized: false,
              status: hasSearchSeizure ? 'alerta_movimentacao' : 'em_acompanhamento',
              hasUnreadMovement: Boolean(hasSearchSeizure),
            })
            .returning();
          legalProc = insertedProc;

          if (hasSearchSeizure) {
            await tx.insert(legalMovements).values({
              processId: legalProc.id,
              source: 'detran_scan',
              originalDispatch: 'Varredura Escavador/Detran identificou distribuição de ação de busca e apreensão com restrição RENAJUD ativa.',
              iviTranslationPtBr: searchSeizureDispatchText,
            });
          }
        }

        const txExistingNegs = await tx.select().from(negotiations).where(eq(negotiations.admissionId, adm.id));
        if (txExistingNegs.length === 0) {
          await tx.insert(negotiations).values({
            admissionId: adm.id,
            clientId: adm.clientId,
            unitId: adm.unitId,
            bankName: adm.bankName,
            originalDebtCents: adm.debtAmountCents,
            targetReductionPct: 55,
            currentReductionPct: 0,
            estimatedSavingsCents: 0,
            targetDeadline: new Date(Date.now() + 45 * 86400000),
            status: 'em_negociacao',
          });
        }

        await tx.insert(auditLogs).values({
          userId: req.authUser!.id,
          userName: req.authUser!.name,
          action: 'AUDIT_APPROVED',
          entityType: 'admission',
          entityId: String(adm.id),
          details: {
            provider,
            boletosGeradosAgora: createdTitles.length,
            boletosExistentes: activeTitles.length,
            hasSearchSeizure: Boolean(hasSearchSeizure),
          },
          unitId: adm.unitId,
        });

        const dispatchedMessages: Array<typeof internalMessages.$inferSelect> = [];
        if (notifyDepartments !== false) {
          const clientLabel = client?.fullName || `Cliente #${adm.clientId}`;
          const mJur = await dispatchIviSectorNotification(
            {
              targetSector: 'juridico',
              targetUnitId: adm.unitId,
              relatedEntityType: 'legal_process',
              relatedEntityId: legalProc.id,
              senderName: 'Ivi IA · Auditoria',
              subject: `Auditoria Aprovada · ${adm.protocolCode}`,
              body: `Dossiê de ${clientLabel} (${adm.bankName}, Contrato ${adm.contractNumber}) aprovado na Auditoria por ${req.authUser!.name} e encaminhado para Jurídico & Escavador.${hasSearchSeizure ? ' [ALERTA BUSCA E APREENSÃO]' : ''}`,
            },
            tx
          );
          const mNeg = await dispatchIviSectorNotification(
            {
              targetSector: 'negociacoes',
              targetUnitId: adm.unitId,
              relatedEntityType: 'admission',
              relatedEntityId: adm.id,
              senderName: 'Ivi IA · Auditoria',
              subject: `Dossiê liberado para Negociações · ${adm.protocolCode}`,
              body: `Contrato ${adm.contractNumber} (${adm.bankName} · ${clientLabel}) aprovado pela Auditoria e aberto em Negociações Bancárias.`,
            },
            tx
          );
          const mFin = await dispatchIviSectorNotification(
            {
              targetSector: 'financeiro',
              targetUnitId: adm.unitId,
              relatedEntityType: 'admission',
              relatedEntityId: adm.id,
              senderName: 'Ivi IA · Auditoria',
              subject: `Boletos Liberados · ${adm.protocolCode}`,
              body: `Auditoria concluída para ${clientLabel} (Contrato ${adm.contractNumber}). Parcela inicial de ${formatBrlServer(adm.initialInstallmentCents || 50000)} disponível em Administração Financeira.`,
            },
            tx
          );
          dispatchedMessages.push(mJur, mNeg, mFin);
        }

        return { updatedAdm, createdTitles, activeTitles, legalProc, dispatchedMessages };
      });

      for (const msg of txResult.dispatchedMessages) {
        broadcast('internal:message', msg);
      }

      broadcast('legal:update', {
        processNumber: txResult.legalProc.processNumber,
        hasSearchSeizure: Boolean(hasSearchSeizure),
      });

      res.json({
        admission: txResult.updatedAdm,
        titles: txResult.createdTitles.length > 0 ? txResult.createdTitles : txResult.activeTitles,
        legalProcess: txResult.legalProc,
        generatedNow: txResult.createdTitles.length,
      });
    } catch (error) {
      console.error('Audit approve error:', error);
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao aprovar auditoria.') });
    }
  });

  // 5. Devolver para Admissão / Comercial (persistindo checklist e notas também)
  app.post('/api/audit/:admissionId/reject', requireAuth, requireModule('audit'), async (req: AuthRequest, res) => {
    try {
      const admissionId = parsePositiveIntId(req.params.admissionId);
      if (!admissionId) return res.status(400).json({ error: 'ID de admissão inválido.' });
      const { reason, checklistState, auditManualNotes } = (req.body || {}) as {
        reason: string;
        checklistState?: Record<string, boolean>;
        auditManualNotes?: string;
      };
      if (!reason?.trim()) return res.status(400).json({ error: 'Informe o problema encontrado para devolução.' });

      const rows = await db.select().from(admissions).where(eq(admissions.id, admissionId)).limit(1);
      const adm = rows[0];
      if (!adm) return res.status(404).json({ error: 'Admissão não encontrada.' });
      if (!isUnitPermitted(req, adm.unitId)) {
        return res.status(403).json({ error: 'Sem permissão para devolver admissão desta unidade.' });
      }

      const prevCritiques = Array.isArray(adm.auditCritiquesJson) ? adm.auditCritiquesJson : [];
      const nextRound = prevCritiques.length + 1;
      const updatedCritiques = [
        ...prevCritiques,
        {
          id: `crit-${Date.now()}`,
          round: nextRound,
          author: req.authUser!.name,
          reason: reason.trim(),
          createdAt: new Date().toISOString(),
        },
      ];

      const rejectNotes = auditManualNotes !== undefined ? String(auditManualNotes) : adm.auditManualNotes;
      const rejectNotesChanged =
        auditManualNotes !== undefined && rejectNotes.trim() !== String(adm.auditManualNotes || '').trim();
      const rejectAuthor = req.authUser?.name || req.authUser?.email || 'Auditor';
      const rejectNow = new Date();
      const prevRejectCons = Array.isArray(adm.auditConsiderationsJson) ? adm.auditConsiderationsJson : [];
      const nextRejectCons =
        rejectNotesChanged && rejectNotes.trim()
          ? [
              ...prevRejectCons,
              {
                id: `cons-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
                authorName: rejectAuthor,
                text: rejectNotes.trim(),
                createdAt: rejectNow.toISOString(),
              },
            ]
          : prevRejectCons;

      const updated = await db.transaction(async (tx) => {
        const [updatedAdm] = await tx
          .update(admissions)
          .set({
            status: 'devolvida_admissao',
            auditRejectionReason: reason.trim(),
            auditCritiquesJson: updatedCritiques,
            auditChecklistStateJson: checklistState ?? adm.auditChecklistStateJson ?? {},
            auditManualNotes: rejectNotes,
            auditManualNotesBy: rejectNotesChanged ? rejectAuthor : adm.auditManualNotesBy || '',
            auditManualNotesAt: rejectNotesChanged ? rejectNow : adm.auditManualNotesAt,
            auditConsiderationsJson: nextRejectCons,
            returnedCount: (adm.returnedCount || 0) + 1,
            auditorId: req.authUser!.id,
            activeReviewerId: null,
            activeReviewerName: '',
            activeReviewerSince: null,
            auditedAt: rejectNow,
          })
          .where(eq(admissions.id, admissionId))
          .returning();

        await tx.insert(auditLogs).values({
          userId: req.authUser!.id,
          userName: req.authUser!.name,
          action: 'AUDIT_RETURNED',
          entityType: 'admission',
          entityId: String(adm.id),
          details: { round: nextRound, reason: reason.trim() },
          unitId: adm.unitId,
        });

        const rejectMsg = await dispatchIviSectorNotification(
          {
            targetSector: 'admissao',
            targetUnitId: adm.unitId,
            recipientId: adm.consultantId,
            relatedEntityType: 'admission',
            relatedEntityId: adm.id,
            senderName: 'Ivi IA · Auditoria',
            subject: `Devolução de Auditoria (Round ${nextRound}) · ${adm.protocolCode}`,
            body: `Auditoria (${req.authUser!.name}) devolveu a ficha ${adm.protocolCode} para Comercial → Admissão: ${reason.trim()}.`,
          },
          tx
        );

        return { updatedAdm, rejectMsg };
      });

      broadcast('internal:message', updated.rejectMsg);
      broadcast('audit:update', { admissionId: adm.id, status: 'devolvida_admissao' });
      res.json({ admission: updated.updatedAdm });
    } catch (error) {
      console.error('Audit reject error:', error);
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao devolver admissão.') });
    }
  });

  // 6. Ivi · Verificação de Checklist e Análise (com cache em base de dados para minimizar custos de IA)
  app.post('/api/audit/:admissionId/ivi-analyze', requireAuth, requireModule('audit'), async (req: AuthRequest, res) => {
    try {
      const admissionId = parsePositiveIntId(req.params.admissionId);
      if (!admissionId) return res.status(400).json({ error: 'ID de admissão inválido.' });
      const { forceAi } = (req.body || {}) as { forceAi?: boolean };
      const [adm] = await db.select().from(admissions).where(eq(admissions.id, admissionId)).limit(1);
      if (!adm) return res.status(404).json({ error: 'Admissão não encontrada.' });
      if (!isUnitPermitted(req, adm.unitId)) {
        return res.status(403).json({ error: 'Sem permissão para analisar admissão desta unidade.' });
      }

      const [clientRows, titularRows, docs, titles, procs, allChecklist] = await Promise.all([
        db.select().from(clients).where(eq(clients.id, adm.clientId)).limit(1),
        adm.assetOwnerId ? db.select().from(clients).where(eq(clients.id, adm.assetOwnerId)).limit(1) : Promise.resolve([]),
        db.select().from(documentObjects).where(eq(documentObjects.clientId, adm.clientId)),
        db.select().from(financialTitles).where(eq(financialTitles.admissionId, adm.id)),
        db.select().from(legalProcesses).where(eq(legalProcesses.admissionId, adm.id)),
        db.select().from(auditChecklistItems).orderBy(auditChecklistItems.sortOrder, auditChecklistItems.id),
      ]);

      const client = clientRows[0];
      const titular = titularRows[0];
      const visibleDocs = docs.filter((d) => !d.deletedAt && (d.admissionId === adm.id || d.admissionId === null));
      const modText = `${adm.modality || ''} ${adm.debtType || ''}`.toLowerCase();
      const checklistState = adm.auditChecklistStateJson || {};
      const applicableChecklist = allChecklist
        .filter((item) => {
          if (!item.active) return false;
          const cond = (item.modalityCondition || '').trim().toLowerCase();
          return !cond || modText.includes(cond);
        })
        .map((item) => ({
          id: item.id,
          sortOrder: item.sortOrder,
          title: item.title,
          description: item.description,
          modalityCondition: item.modalityCondition || '',
          checked: Boolean(checklistState[String(item.id)]),
        }));

      const checkedCount = applicableChecklist.filter((c) => c.checked).length;
      const critiques = Array.isArray(adm.auditCritiquesJson) ? adm.auditCritiquesJson : [];
      const lastCritique = critiques.length > 0 ? critiques[critiques.length - 1]?.reason : adm.auditRejectionReason;

      const cacheKeyHash = computeAuditFingerprint({
        admissionId: adm.id,
        status: adm.status,
        clientCpfCnpj: client?.cpfCnpj || '',
        titularCpfCnpj: titular?.cpfCnpj || '',
        bankName: adm.bankName,
        contractNumber: adm.contractNumber,
        debtAmountCents: adm.debtAmountCents,
        debtTotalInstallments: adm.debtTotalInstallments,
        debtPaidInstallments: adm.debtPaidInstallments,
        debtOverdueInstallments: adm.debtOverdueInstallments,
        isElectricVehicle: adm.isElectricVehicle,
        escavadorAlert: adm.escavadorAlert,
        docs: visibleDocs.map((d) => `${d.id}:${d.sha256Hash}:${d.docCategory}`).sort(),
        checklist: applicableChecklist.map((c) => `${c.id}:${c.title}:${c.checked}`),
        lastCritique: lastCritique || '',
      });

      // Consulta primeiro a base de dados do próprio sistema antes de acionar qualquer modelo de IA
      if (!forceAi) {
        const cached = await findCachedDecision({
          admissionId: adm.id,
          decisionType: 'checklist_sweep',
          cacheKeyHash,
        });
        if (cached && cached.payloadJson && Object.keys(cached.payloadJson).length > 0) {
          const cachedSnap = {
            ...(cached.payloadJson as unknown as IviAuditAnalysisSnapshot),
            fromDatabaseCache: true,
            aiCallsSaved: cached.aiCallsSaved,
          };
          await db.update(admissions).set({ iviAuditAnalysisJson: cachedSnap }).where(eq(admissions.id, adm.id));
          return res.json({ analysis: cachedSnap, fromCache: true });
        }
      }

      const dossierInput = {
        protocolCode: adm.protocolCode,
        status: adm.status,
        debtType: adm.debtType,
        modality: adm.modality,
        bankName: adm.bankName,
        contractNumber: adm.contractNumber,
        clientName: client?.fullName || 'Cliente',
        clientCpfCnpj: client?.cpfCnpj || '',
        titularName: titular?.fullName || null,
        titularCpfCnpj: titular?.cpfCnpj || null,
        debtAmountFormatted: formatBrlServer(adm.debtAmountCents),
        financedAmountFormatted: formatBrlServer(adm.financedAmountCents || adm.debtAmountCents),
        serviceFeeFormatted: formatBrlServer(adm.serviceFeeCents),
        initialInstallmentFormatted: formatBrlServer(adm.initialInstallmentCents || 50000),
        installmentsCount: adm.installmentsCount,
        debtTotalInstallments: adm.debtTotalInstallments,
        debtPaidInstallments: adm.debtPaidInstallments,
        debtOverdueInstallments: adm.debtOverdueInstallments,
        vehicleInfo: adm.vehicleInfo || [adm.vehicleBrand, adm.vehicleModel, adm.vehicleYear].filter(Boolean).join(' '),
        vehiclePlate: adm.vehiclePlate,
        isElectricVehicle: Boolean(adm.isElectricVehicle),
        escavadorAlert: Boolean(adm.escavadorAlert),
        documents: visibleDocs.map((d) => ({
          fileName: d.fileName,
          docCategory: d.docCategory,
          mimeType: d.mimeType,
        })),
        critiquesCount: critiques.length,
        lastCritiqueReason: lastCritique,
        checklistTotal: applicableChecklist.length,
        checklistChecked: checkedCount,
        existingTitlesCount: titles.filter((t) => String(t.status).toUpperCase() !== 'CANCELADO').length,
        legalProcessesSummary: procs.map((p) => `${p.processNumber} (${p.actionType})`).join('; ') || 'Nenhum',
        notes: adm.notes,
      };

      const checklistReport = buildChecklistVerificationReport(dossierInput, applicableChecklist);
      const localSnap = iviSweepChecklistLocal({
        dossier: dossierInput,
        applicableChecklist,
        cacheKeyHash,
      });

      let finalSnap: IviAuditAnalysisSnapshot = localSnap;
      if (forceAi) {
        const aiAnalysis = await iviAnalyzeAuditDossier(dossierInput);
        finalSnap = {
          ...aiAnalysis,
          inconsistenciesCount: checklistReport.inconsistenciesCount,
          attentionMeasuresCount: checklistReport.attentionMeasuresCount,
          checklistItemsChecked: checklistReport.items,
          fromDatabaseCache: false,
          aiCallsSaved: 0,
          cacheKeyHash,
        };
      }

      await upsertCachedDecision({
        admissionId: adm.id,
        decisionType: 'checklist_sweep',
        cacheKeyHash,
        verdict: finalSnap.verdict,
        inconsistenciesCount: finalSnap.inconsistenciesCount || 0,
        attentionCount: finalSnap.attentionMeasuresCount || 0,
        summaryText: finalSnap.executiveSummary,
        checklistReportJson: checklistReport.items,
        payloadJson: finalSnap as unknown as Record<string, unknown>,
        sourceEngine: finalSnap.provider,
      });

      await db
        .update(admissions)
        .set({ iviAuditAnalysisJson: finalSnap })
        .where(eq(admissions.id, adm.id));

      await db.insert(auditLogs).values({
        userId: req.authUser?.id ?? null,
        userName: req.authUser?.name || 'Ivi IA',
        action: 'IVI_AUDIT_ANALYZED',
        entityType: 'admission',
        entityId: String(adm.id),
        details: {
          verdict: finalSnap.verdict,
          provider: finalSnap.provider,
          inconsistenciesCount: finalSnap.inconsistenciesCount,
          attentionMeasuresCount: finalSnap.attentionMeasuresCount,
        },
        unitId: adm.unitId,
      });

      res.json({ analysis: finalSnap, fromCache: false });
    } catch (error) {
      console.error('POST /api/audit/:admissionId/ivi-analyze error:', error);
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao executar verificação do checklist pela Ivi.') });
    }
  });

  // 7. Ivi · Inspeção Multimodal de Documento Anexado (com cache em base por SHA-256)
  app.post('/api/audit/:admissionId/ivi-inspect-document', requireAuth, requireModule('audit'), async (req: AuthRequest, res) => {
    try {
      const admissionId = parsePositiveIntId(req.params.admissionId);
      if (!admissionId) return res.status(400).json({ error: 'ID de admissão inválido.' });
      const documentId = parsePositiveIntId(req.body?.documentId);
      const forceAi = Boolean(req.body?.forceAi);
      if (!documentId) return res.status(400).json({ error: 'documentId é obrigatório.' });

      const [admRows, docRows] = await Promise.all([
        db.select().from(admissions).where(eq(admissions.id, admissionId)).limit(1),
        db.select().from(documentObjects).where(eq(documentObjects.id, documentId)).limit(1),
      ]);
      const adm = admRows[0];
      const doc = docRows[0];
      if (!adm) return res.status(404).json({ error: 'Admissão não encontrada.' });
      if (!isUnitPermitted(req, adm.unitId)) {
        return res.status(403).json({ error: 'Sem permissão para auditar admissão desta unidade.' });
      }
      if (!doc || doc.deletedAt) return res.status(404).json({ error: 'Documento não encontrado ou na lixeira.' });
      if (!isUnitPermitted(req, doc.unitId)) {
        return res.status(403).json({ error: 'Sem permissão para ler documento desta unidade.' });
      }

      const [clientRows, titularRows] = await Promise.all([
        db.select().from(clients).where(eq(clients.id, adm.clientId)).limit(1),
        adm.assetOwnerId ? db.select().from(clients).where(eq(clients.id, adm.assetOwnerId)).limit(1) : Promise.resolve([]),
      ]);
      const client = clientRows[0];
      const titular = titularRows[0];
      const dossierExpected = {
        protocolCode: adm.protocolCode,
        clientName: client?.fullName || 'Cliente',
        clientCpfCnpj: client?.cpfCnpj || '',
        titularName: titular?.fullName || null,
        bankName: adm.bankName,
        contractNumber: adm.contractNumber,
        vehiclePlate: adm.vehiclePlate,
        vehicleModel: [adm.vehicleBrand, adm.vehicleModel, adm.vehicleYear].filter(Boolean).join(' ') || adm.vehicleInfo,
      };
      const docHash = computeAuditFingerprint({ docId: doc.id, sha256: doc.sha256Hash, dossierExpected });

      if (!forceAi) {
        const cached = await findCachedDecision({
          admissionId: adm.id,
          decisionType: 'document_inspection',
          documentId: doc.id,
          cacheKeyHash: docHash,
        });
        if (cached && cached.payloadJson && Object.keys(cached.payloadJson).length > 0) {
          return res.json({ inspection: cached.payloadJson, fromCache: true });
        }
      }

      const buf = await getBucketObjectBuffer(doc.sha256Hash, doc.storageUri);
      const inspection = await iviInspectAuditDocument({
        documentId: doc.id,
        fileName: doc.fileName,
        docCategory: doc.docCategory,
        mimeType: doc.mimeType,
        buffer: buf,
        dossierExpected,
      });

      await upsertCachedDecision({
        admissionId: adm.id,
        documentId: doc.id,
        decisionType: 'document_inspection',
        cacheKeyHash: docHash,
        verdict: inspection.matchesDossier,
        inconsistenciesCount: inspection.matchesDossier === 'DIVERGENCIA' || inspection.legibility === 'ILEGIVEL' ? 1 : 0,
        attentionCount: inspection.matchesDossier === 'NAO_IDENTIFICADO' || inspection.legibility === 'PARCIAL' ? 1 : 0,
        summaryText: inspection.summary,
        checklistReportJson: [],
        payloadJson: inspection as unknown as Record<string, unknown>,
        sourceEngine: inspection.provider,
      });

      await db.insert(auditLogs).values({
        userId: req.authUser?.id ?? null,
        userName: req.authUser?.name || 'Ivi IA',
        action: 'IVI_DOCUMENT_INSPECTED',
        entityType: 'admission',
        entityId: String(adm.id),
        details: {
          documentId: doc.id,
          fileName: doc.fileName,
          legibility: inspection.legibility,
          matchesDossier: inspection.matchesDossier,
        },
        unitId: adm.unitId,
      });

      res.json({ inspection, fromCache: false });
    } catch (error) {
      console.error('POST /api/audit/:admissionId/ivi-inspect-document error:', error);
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao inspecionar documento com a Ivi.') });
    }
  });

  // 8. Ivi · Pergunta Contextual sobre este Dossiê de Auditoria
  app.post('/api/audit/:admissionId/ivi-ask', requireAuth, requireModule('audit'), async (req: AuthRequest, res) => {
    try {
      const admissionId = parsePositiveIntId(req.params.admissionId);
      if (!admissionId) return res.status(400).json({ error: 'ID de admissão inválido.' });
      const { question } = (req.body || {}) as { question?: string };
      if (!question?.trim()) return res.status(400).json({ error: 'Informe uma pergunta para a Ivi.' });

      const [adm] = await db.select().from(admissions).where(eq(admissions.id, admissionId)).limit(1);
      if (!adm) return res.status(404).json({ error: 'Admissão não encontrada.' });
      if (!isUnitPermitted(req, adm.unitId)) {
        return res.status(403).json({ error: 'Sem permissão para consultar admissão desta unidade.' });
      }

      const [clientRows, docs] = await Promise.all([
        db.select().from(clients).where(eq(clients.id, adm.clientId)).limit(1),
        db.select().from(documentObjects).where(eq(documentObjects.clientId, adm.clientId)),
      ]);
      const client = clientRows[0];
      const activeDocs = docs.filter((d) => !d.deletedAt && (d.admissionId === adm.id || d.admissionId === null));

      const contextText = [
        `Protocolo: ${adm.protocolCode} | Status: ${adm.status}`,
        `Cliente: ${client?.fullName || ''} (${client?.cpfCnpj || ''})`,
        `Banco: ${adm.bankName} | Contrato: ${adm.contractNumber} | Modalidade: ${adm.modality} (${adm.debtType})`,
        `Passivo: ${formatBrlServer(adm.debtAmountCents)} | Financiado: ${formatBrlServer(adm.financedAmountCents)} | Honorários: ${formatBrlServer(adm.serviceFeeCents)} | Parcela inicial: ${formatBrlServer(adm.initialInstallmentCents)} (${adm.installmentsCount}x)`,
        `Parcelas banco: ${adm.debtPaidInstallments} pagas, ${adm.debtOverdueInstallments} em atraso de ${adm.debtTotalInstallments}`,
        `Veículo: ${adm.vehicleBrand} ${adm.vehicleModel} ${adm.vehicleYear} Placa ${adm.vehiclePlate} (Elétrico: ${adm.isElectricVehicle ? 'Sim' : 'Não'})`,
        `Documentos anexados (${activeDocs.length}): ${activeDocs.map((d) => `${d.fileName} [${d.docCategory}]`).join(', ') || 'Nenhum'}`,
        `Parecer manual do auditor: ${adm.auditManualNotes || 'Vazio'}`,
        `Devoluções anteriores (${adm.returnedCount}): ${adm.auditRejectionReason || 'Nenhuma'}`,
      ].join('\n');

      const out = await iviAskAboutAuditDossier({
        question: question.trim(),
        dossierContextText: contextText,
      });

      res.json({ answer: out.text, provider: out.provider });
    } catch (error) {
      console.error('POST /api/audit/:admissionId/ivi-ask error:', error);
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao consultar a Ivi neste dossiê.') });
    }
  });

  // 9. Painel de Insights Ivi (Análise automática do documento selecionado + cache em DB para reduzir custos de IA)
  app.post('/api/audit/:admissionId/ivi-insights', requireAuth, requireModule('audit'), async (req: AuthRequest, res) => {
    try {
      const admissionId = parsePositiveIntId(req.params.admissionId);
      if (!admissionId) return res.status(400).json({ error: 'ID de admissão inválido.' });
      const { documentId, checklistState, forceAi } = (req.body || {}) as {
        documentId?: number | null;
        checklistState?: Record<string, boolean>;
        forceAi?: boolean;
      };

      const [adm] = await db.select().from(admissions).where(eq(admissions.id, admissionId)).limit(1);
      if (!adm) return res.status(404).json({ error: 'Admissão não encontrada.' });
      if (!isUnitPermitted(req, adm.unitId)) {
        return res.status(403).json({ error: 'Sem permissão para analisar insights desta unidade.' });
      }

      const [clientRows, titularRows, docs, titles, procs, allChecklist] = await Promise.all([
        db.select().from(clients).where(eq(clients.id, adm.clientId)).limit(1),
        adm.assetOwnerId ? db.select().from(clients).where(eq(clients.id, adm.assetOwnerId)).limit(1) : Promise.resolve([]),
        db.select().from(documentObjects).where(eq(documentObjects.clientId, adm.clientId)).orderBy(desc(documentObjects.id)),
        db.select().from(financialTitles).where(eq(financialTitles.admissionId, adm.id)),
        db.select().from(legalProcesses).where(eq(legalProcesses.admissionId, adm.id)),
        db.select().from(auditChecklistItems).orderBy(auditChecklistItems.sortOrder, auditChecklistItems.id),
      ]);

      const client = clientRows[0];
      const titular = titularRows[0];
      const isAdmin = req.authUser?.role === 'admin';
      const allowedUnits = req.authUser?.allowedUnitIds || [];
      const visibleDocs = docs.filter(
        (d) =>
          !d.deletedAt &&
          (d.admissionId === adm.id || d.admissionId === null) &&
          (isAdmin || allowedUnits.includes(d.unitId))
      );

      const targetDoc = documentId
        ? visibleDocs.find((d) => d.id === Number(documentId)) || null
        : visibleDocs[0] || null;

      const modText = `${adm.modality || ''} ${adm.debtType || ''}`.toLowerCase();
      const effectiveChecklistMap = checklistState || adm.auditChecklistStateJson || {};
      const applicableChecklist = allChecklist
        .filter((item) => {
          if (!item.active) return false;
          const cond = (item.modalityCondition || '').trim().toLowerCase();
          return !cond || modText.includes(cond);
        })
        .map((item) => ({
          id: item.id,
          sortOrder: item.sortOrder,
          title: item.title,
          description: item.description,
          modalityCondition: item.modalityCondition || '',
          checked: Boolean(effectiveChecklistMap[String(item.id)]),
        }));

      const critiques = Array.isArray(adm.auditCritiquesJson) ? adm.auditCritiquesJson : [];
      const lastCritique = critiques.length > 0 ? critiques[critiques.length - 1]?.reason : adm.auditRejectionReason;
      const checkedCount = applicableChecklist.filter((c) => c.checked).length;

      const insightsCacheHash = computeAuditFingerprint({
        admissionId: adm.id,
        documentId: targetDoc?.id || null,
        docSha: targetDoc?.sha256Hash || '',
        status: adm.status,
        isElectricVehicle: adm.isElectricVehicle,
        escavadorAlert: adm.escavadorAlert,
        docs: visibleDocs.map((d) => `${d.id}:${d.sha256Hash}:${d.docCategory}`).sort(),
        checklist: applicableChecklist.map((c) => `${c.id}:${c.checked}`),
      });

      if (!forceAi) {
        const cachedInsights = await findCachedDecision({
          admissionId: adm.id,
          decisionType: 'document_insights',
          documentId: targetDoc?.id || null,
          cacheKeyHash: insightsCacheHash,
        });
        if (cachedInsights && cachedInsights.payloadJson && Object.keys(cachedInsights.payloadJson).length > 0) {
          return res.json({
            insights: {
              ...cachedInsights.payloadJson,
              fromDatabaseCache: true,
              aiCallsSaved: cachedInsights.aiCallsSaved,
            },
          });
        }
      }

      const dossierExpected = {
        protocolCode: adm.protocolCode,
        clientName: client?.fullName || 'Cliente',
        clientCpfCnpj: client?.cpfCnpj || '',
        titularName: titular?.fullName || null,
        bankName: adm.bankName,
        contractNumber: adm.contractNumber,
        vehiclePlate: adm.vehiclePlate,
        vehicleModel: [adm.vehicleBrand, adm.vehicleModel, adm.vehicleYear].filter(Boolean).join(' ') || adm.vehicleInfo,
      };

      // Check cached document inspection by SHA-256 first to avoid calling Gemini Vision again
      let cachedDocInspection: Awaited<ReturnType<typeof iviInspectAuditDocument>> | null = null;
      let targetBuffer: Buffer | null = null;
      if (targetDoc) {
        const docHash = computeAuditFingerprint({ docId: targetDoc.id, sha256: targetDoc.sha256Hash, dossierExpected });
        if (!forceAi) {
          const hitDoc = await findCachedDecision({
            admissionId: adm.id,
            decisionType: 'document_inspection',
            documentId: targetDoc.id,
            cacheKeyHash: docHash,
          });
          if (hitDoc && hitDoc.payloadJson && Object.keys(hitDoc.payloadJson).length > 0) {
            cachedDocInspection = hitDoc.payloadJson as unknown as Awaited<ReturnType<typeof iviInspectAuditDocument>>;
          }
        }
        if (!cachedDocInspection) {
          targetBuffer = await getBucketObjectBuffer(targetDoc.sha256Hash, targetDoc.storageUri);
        }
      }

      const insights = await iviGenerateAuditInsightsPanel({
        admissionId: adm.id,
        cachedDocInspection,
        skipAiRefinement: Boolean(cachedDocInspection) && !forceAi,
        dossier: {
          protocolCode: adm.protocolCode,
          status: adm.status,
          debtType: adm.debtType,
          modality: adm.modality,
          bankName: adm.bankName,
          contractNumber: adm.contractNumber,
          clientName: client?.fullName || 'Cliente',
          clientCpfCnpj: client?.cpfCnpj || '',
          titularName: titular?.fullName || null,
          titularCpfCnpj: titular?.cpfCnpj || null,
          debtAmountFormatted: formatBrlServer(adm.debtAmountCents),
          financedAmountFormatted: formatBrlServer(adm.financedAmountCents || adm.debtAmountCents),
          serviceFeeFormatted: formatBrlServer(adm.serviceFeeCents),
          initialInstallmentFormatted: formatBrlServer(adm.initialInstallmentCents || 50000),
          installmentsCount: adm.installmentsCount,
          debtTotalInstallments: adm.debtTotalInstallments,
          debtPaidInstallments: adm.debtPaidInstallments,
          debtOverdueInstallments: adm.debtOverdueInstallments,
          vehicleInfo: adm.vehicleInfo || [adm.vehicleBrand, adm.vehicleModel, adm.vehicleYear].filter(Boolean).join(' '),
          vehiclePlate: adm.vehiclePlate,
          isElectricVehicle: Boolean(adm.isElectricVehicle),
          escavadorAlert: Boolean(adm.escavadorAlert),
          documents: visibleDocs.map((d) => ({
            fileName: d.fileName,
            docCategory: d.docCategory,
            mimeType: d.mimeType,
          })),
          critiquesCount: critiques.length,
          lastCritiqueReason: lastCritique,
          checklistTotal: applicableChecklist.length,
          checklistChecked: checkedCount,
          existingTitlesCount: titles.filter((t) => String(t.status).toUpperCase() !== 'CANCELADO').length,
          legalProcessesSummary: procs.map((p) => `${p.processNumber} (${p.actionType})`).join('; ') || 'Nenhum',
          notes: adm.notes,
        },
        applicableChecklist,
        selectedDoc: targetDoc
          ? {
              documentId: targetDoc.id,
              fileName: targetDoc.fileName,
              docCategory: targetDoc.docCategory,
              mimeType: targetDoc.mimeType,
              buffer: targetBuffer,
              dossierExpected,
            }
          : null,
      });

      // Cache document inspection if newly executed
      if (targetDoc && insights.documentInspection && !cachedDocInspection) {
        const docHash = computeAuditFingerprint({ docId: targetDoc.id, sha256: targetDoc.sha256Hash, dossierExpected });
        await upsertCachedDecision({
          admissionId: adm.id,
          documentId: targetDoc.id,
          decisionType: 'document_inspection',
          cacheKeyHash: docHash,
          verdict: insights.documentInspection.matchesDossier,
          inconsistenciesCount:
            insights.documentInspection.matchesDossier === 'DIVERGENCIA' ||
            insights.documentInspection.legibility === 'ILEGIVEL'
              ? 1
              : 0,
          attentionCount:
            insights.documentInspection.matchesDossier === 'NAO_IDENTIFICADO' ||
            insights.documentInspection.legibility === 'PARCIAL'
              ? 1
              : 0,
          summaryText: insights.documentInspection.summary,
          checklistReportJson: [],
          payloadJson: insights.documentInspection as unknown as Record<string, unknown>,
          sourceEngine: insights.documentInspection.provider,
        });
      }

      // Persist insights decision in DB cache
      await upsertCachedDecision({
        admissionId: adm.id,
        documentId: targetDoc?.id || null,
        decisionType: 'document_insights',
        cacheKeyHash: insightsCacheHash,
        verdict: insights.recommendedDecision,
        inconsistenciesCount: insights.inconsistenciesCount || 0,
        attentionCount: insights.attentionMeasuresCount || 0,
        summaryText: insights.decisionRationale,
        checklistReportJson: [],
        payloadJson: insights as unknown as Record<string, unknown>,
        sourceEngine: insights.provider,
      });

      await db.insert(auditLogs).values({
        userId: req.authUser?.id ?? null,
        userName: req.authUser?.name || 'Ivi IA',
        action: 'IVI_INSIGHTS_PANEL_ANALYZED',
        entityType: 'admission',
        entityId: String(adm.id),
        details: {
          documentId: targetDoc?.id || null,
          recommendedDecision: insights.recommendedDecision,
          provider: insights.provider,
        },
        unitId: adm.unitId,
      });

      res.json({ insights });
    } catch (error) {
      console.error('POST /api/audit/:admissionId/ivi-insights error:', error);
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao gerar Painel de Insights da Ivi.') });
    }
  });

  // 10. Registrar Consideração do Usuário na Auditoria (carimbando nome, data e hora)
  app.post('/api/audit/:admissionId/considerations', requireAuth, requireModule('audit'), async (req: AuthRequest, res) => {
    try {
      const admissionId = parsePositiveIntId(req.params.admissionId);
      if (!admissionId) return res.status(400).json({ error: 'ID de admissão inválido.' });
      const { text } = (req.body || {}) as { text?: string };
      const cleanText = String(text || '').trim();
      if (!cleanText) {
        return res.status(400).json({ error: 'Digite uma consideração antes de salvar.' });
      }

      const [adm] = await db.select().from(admissions).where(eq(admissions.id, admissionId)).limit(1);
      if (!adm) return res.status(404).json({ error: 'Admissão não encontrada.' });
      if (!isUnitPermitted(req, adm.unitId)) {
        return res.status(403).json({ error: 'Sem permissão para registrar consideração nesta unidade.' });
      }

      const authorName = req.authUser?.name || req.authUser?.email || 'Usuário';
      const now = new Date();
      const entry = {
        id: `cons-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        authorName,
        text: cleanText,
        createdAt: now.toISOString(),
      };
      const prev = Array.isArray(adm.auditConsiderationsJson) ? adm.auditConsiderationsJson : [];
      const nextList = [...prev, entry];

      const [updated] = await db
        .update(admissions)
        .set({
          auditManualNotes: cleanText,
          auditManualNotesBy: authorName,
          auditManualNotesAt: now,
          auditConsiderationsJson: nextList,
          auditorId: req.authUser?.id ?? adm.auditorId,
        })
        .where(eq(admissions.id, admissionId))
        .returning();

      await db.insert(auditLogs).values({
        userId: req.authUser?.id ?? null,
        userName: authorName,
        action: 'AUDIT_CONSIDERATION_ADDED',
        entityType: 'admission',
        entityId: String(adm.id),
        details: { text: cleanText, recordedAt: now.toISOString() },
        unitId: adm.unitId,
      });

      res.json({ admission: updated, consideration: entry });
    } catch (error) {
      console.error('POST /api/audit/:admissionId/considerations error:', error);
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao registrar consideração do usuário.') });
    }
  });

  // 11. Varredura em lote do Checklist pela Ivi (sem chamadas externas de IA, gravando decisões na base)
  app.post('/api/audit/ivi-sweep-all', requireAuth, requireModule('audit'), async (req: AuthRequest, res) => {
    try {
      const { onlyMissing } = (req.body || {}) as { onlyMissing?: boolean };
      const allowedUnitIds = getAllowedUnitIds(req);
      const [rawAdmissions, allClients, allDocs, allTitles, allProcs, allChecklist] = await Promise.all([
        allowedUnitIds === null
          ? db.select().from(admissions).orderBy(desc(admissions.id))
          : allowedUnitIds.length === 0
          ? Promise.resolve([])
          : db.select().from(admissions).where(inArray(admissions.unitId, allowedUnitIds)).orderBy(desc(admissions.id)),
        db.select().from(clients),
        db.select().from(documentObjects),
        db.select().from(financialTitles).where(eq(financialTitles.scope, 'RECEBER')),
        db.select().from(legalProcesses),
        db.select().from(auditChecklistItems).orderBy(auditChecklistItems.sortOrder, auditChecklistItems.id),
      ]);
      const allAdmissions = rawAdmissions;

      let sweptCount = 0;
      let cacheHits = 0;
      let newlyEvaluated = 0;

      for (const adm of allAdmissions) {
        if (onlyMissing && adm.iviAuditAnalysisJson?.checklistItemsChecked?.length) {
          continue;
        }
        const client = allClients.find((c) => c.id === adm.clientId);
        const titular = adm.assetOwnerId ? allClients.find((c) => c.id === adm.assetOwnerId) : null;
        const visibleDocs = allDocs.filter(
          (d) =>
            !d.deletedAt &&
            (d.admissionId === adm.id || d.admissionId === null) &&
            (allowedUnitIds === null || allowedUnitIds.includes(d.unitId))
        );
        const modText = `${adm.modality || ''} ${adm.debtType || ''}`.toLowerCase();
        const checklistState = adm.auditChecklistStateJson || {};
        const applicableChecklist = allChecklist
          .filter((item) => {
            if (!item.active) return false;
            const cond = (item.modalityCondition || '').trim().toLowerCase();
            return !cond || modText.includes(cond);
          })
          .map((item) => ({
            id: item.id,
            sortOrder: item.sortOrder,
            title: item.title,
            description: item.description,
            modalityCondition: item.modalityCondition || '',
            checked: Boolean(checklistState[String(item.id)]),
          }));

        const critiques = Array.isArray(adm.auditCritiquesJson) ? adm.auditCritiquesJson : [];
        const lastCritique = critiques.length > 0 ? critiques[critiques.length - 1]?.reason : adm.auditRejectionReason;
        const cacheKeyHash = computeAuditFingerprint({
          admissionId: adm.id,
          status: adm.status,
          clientCpfCnpj: client?.cpfCnpj || '',
          titularCpfCnpj: titular?.cpfCnpj || '',
          bankName: adm.bankName,
          contractNumber: adm.contractNumber,
          debtAmountCents: adm.debtAmountCents,
          debtTotalInstallments: adm.debtTotalInstallments,
          debtPaidInstallments: adm.debtPaidInstallments,
          debtOverdueInstallments: adm.debtOverdueInstallments,
          isElectricVehicle: adm.isElectricVehicle,
          escavadorAlert: adm.escavadorAlert,
          docs: visibleDocs.map((d) => `${d.id}:${d.sha256Hash}:${d.docCategory}`).sort(),
          checklist: applicableChecklist.map((c) => `${c.id}:${c.title}:${c.checked}`),
          lastCritique: lastCritique || '',
        });

        sweptCount++;
        const cached = await findCachedDecision({
          admissionId: adm.id,
          decisionType: 'checklist_sweep',
          cacheKeyHash,
        });
        if (cached && cached.payloadJson && Object.keys(cached.payloadJson).length > 0) {
          cacheHits++;
          const cachedSnap = {
            ...(cached.payloadJson as unknown as IviAuditAnalysisSnapshot),
            fromDatabaseCache: true,
            aiCallsSaved: cached.aiCallsSaved,
          };
          await db.update(admissions).set({ iviAuditAnalysisJson: cachedSnap }).where(eq(admissions.id, adm.id));
          continue;
        }

        const admTitles = allTitles.filter(
          (t) => t.admissionId === adm.id && String(t.status).toUpperCase() !== 'CANCELADO'
        );
        const admProcs = allProcs.filter((p) => p.admissionId === adm.id);
        const dossierInput = {
          protocolCode: adm.protocolCode,
          status: adm.status,
          debtType: adm.debtType,
          modality: adm.modality,
          bankName: adm.bankName,
          contractNumber: adm.contractNumber,
          clientName: client?.fullName || 'Cliente',
          clientCpfCnpj: client?.cpfCnpj || '',
          titularName: titular?.fullName || null,
          titularCpfCnpj: titular?.cpfCnpj || null,
          debtAmountFormatted: formatBrlServer(adm.debtAmountCents),
          financedAmountFormatted: formatBrlServer(adm.financedAmountCents || adm.debtAmountCents),
          serviceFeeFormatted: formatBrlServer(adm.serviceFeeCents),
          initialInstallmentFormatted: formatBrlServer(adm.initialInstallmentCents || 50000),
          installmentsCount: adm.installmentsCount,
          debtTotalInstallments: adm.debtTotalInstallments,
          debtPaidInstallments: adm.debtPaidInstallments,
          debtOverdueInstallments: adm.debtOverdueInstallments,
          vehicleInfo: adm.vehicleInfo || [adm.vehicleBrand, adm.vehicleModel, adm.vehicleYear].filter(Boolean).join(' '),
          vehiclePlate: adm.vehiclePlate,
          isElectricVehicle: Boolean(adm.isElectricVehicle),
          escavadorAlert: Boolean(adm.escavadorAlert),
          documents: visibleDocs.map((d) => ({
            fileName: d.fileName,
            docCategory: d.docCategory,
            mimeType: d.mimeType,
          })),
          critiquesCount: critiques.length,
          lastCritiqueReason: lastCritique,
          checklistTotal: applicableChecklist.length,
          checklistChecked: applicableChecklist.filter((c) => c.checked).length,
          existingTitlesCount: admTitles.length,
          legalProcessesSummary: admProcs.map((p) => `${p.processNumber} (${p.actionType})`).join('; ') || 'Nenhum',
          notes: adm.notes,
        };

        const localSnap = iviSweepChecklistLocal({
          dossier: dossierInput,
          applicableChecklist,
          cacheKeyHash,
        });

        await upsertCachedDecision({
          admissionId: adm.id,
          decisionType: 'checklist_sweep',
          cacheKeyHash,
          verdict: localSnap.verdict,
          inconsistenciesCount: localSnap.inconsistenciesCount || 0,
          attentionCount: localSnap.attentionMeasuresCount || 0,
          summaryText: localSnap.executiveSummary,
          checklistReportJson: localSnap.checklistItemsChecked || [],
          payloadJson: localSnap as unknown as Record<string, unknown>,
          sourceEngine: 'local_rules_db',
        });

        await db.update(admissions).set({ iviAuditAnalysisJson: localSnap }).where(eq(admissions.id, adm.id));
        newlyEvaluated++;
      }

      const statsRows = await db
        .select({ totalSaved: sql<number>`coalesce(sum(${iviAuditDecisionsCache.aiCallsSaved}), 0)` })
        .from(iviAuditDecisionsCache);

      broadcast('audit:update', { sweptCount, newlyEvaluated });
      res.json({
        sweptCount,
        cacheHits,
        newlyEvaluated,
        totalAiCallsSaved: Number(statsRows[0]?.totalSaved || 0),
      });
    } catch (error) {
      console.error('POST /api/audit/ivi-sweep-all error:', error);
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao executar varredura em lote do checklist.') });
    }
  });

  // 12. Bloquear/Marcar em análise quando usuário abre o modal do cliente no Data Grid
  app.post('/api/audit/:admissionId/lock', requireAuth, requireModule('audit'), async (req: AuthRequest, res) => {
    try {
      const admissionId = parsePositiveIntId(req.params.admissionId);
      if (!admissionId) return res.status(400).json({ error: 'ID de admissão inválido.' });
      const [adm] = await db.select().from(admissions).where(eq(admissions.id, admissionId)).limit(1);
      if (!adm) return res.status(404).json({ error: 'Admissão não encontrada.' });
      if (!isUnitPermitted(req, adm.unitId)) {
        return res.status(403).json({ error: 'Sem permissão para bloquear admissão desta unidade.' });
      }
      const reviewerName = req.authUser?.name || req.authUser?.email || 'Auditor';
      const now = new Date();
      const [updated] = await db
        .update(admissions)
        .set({
          activeReviewerId: req.authUser!.id,
          activeReviewerName: reviewerName,
          activeReviewerSince: now,
        })
        .where(eq(admissions.id, admissionId))
        .returning();

      broadcast('audit:lock', {
        admissionId: updated.id,
        activeReviewerName: reviewerName,
        activeReviewerSince: now.toISOString(),
      });
      res.json({ admission: updated });
    } catch (error) {
      console.error('POST /api/audit/:admissionId/lock error:', error);
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao registrar usuário em análise.') });
    }
  });

  // 13. Liberar sinalização de análise ao fechar o modal do cliente
  app.post('/api/audit/:admissionId/unlock', requireAuth, requireModule('audit'), async (req: AuthRequest, res) => {
    try {
      const admissionId = parsePositiveIntId(req.params.admissionId);
      if (!admissionId) return res.status(400).json({ error: 'ID de admissão inválido.' });
      const [adm] = await db.select().from(admissions).where(eq(admissions.id, admissionId)).limit(1);
      if (!adm) return res.status(404).json({ error: 'Admissão não encontrada.' });
      if (!isUnitPermitted(req, adm.unitId)) {
        return res.status(403).json({ error: 'Sem permissão para liberar admissão desta unidade.' });
      }

      const isAdmin = req.authUser?.role === 'admin';
      if (adm.activeReviewerId && adm.activeReviewerId !== req.authUser?.id && !isAdmin) {
        return res.json({ admission: adm, keptOtherReviewer: true });
      }

      const [updated] = await db
        .update(admissions)
        .set({
          activeReviewerId: null,
          activeReviewerName: '',
          activeReviewerSince: null,
        })
        .where(eq(admissions.id, admissionId))
        .returning();

      broadcast('audit:lock', {
        admissionId,
        activeReviewerName: '',
        activeReviewerSince: null,
      });
      res.json({ admission: updated });
    } catch (error) {
      console.error('POST /api/audit/:admissionId/unlock error:', error);
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao liberar status em análise.') });
    }
  });

  // 14. Estatísticas do Cache de Decisões Ivi (economia de IA)
  app.get('/api/audit/cache-stats', requireAuth, requireModule('audit'), async (req: AuthRequest, res) => {
    try {
      const allowedUnits = getAllowedUnitIds(req);
      let row;
      if (allowedUnits === null) {
        [row] = await db
          .select({
            cachedDecisions: sql<number>`count(*)`,
            totalAiCallsSaved: sql<number>`coalesce(sum(${iviAuditDecisionsCache.aiCallsSaved}), 0)`,
          })
          .from(iviAuditDecisionsCache);
      } else if (allowedUnits.length === 0) {
        row = { cachedDecisions: 0, totalAiCallsSaved: 0 };
      } else {
        const unitAdmissions = await db
          .select({ id: admissions.id })
          .from(admissions)
          .where(inArray(admissions.unitId, allowedUnits));
        const admIds = unitAdmissions.map((a) => a.id);
        if (admIds.length === 0) {
          row = { cachedDecisions: 0, totalAiCallsSaved: 0 };
        } else {
          [row] = await db
            .select({
              cachedDecisions: sql<number>`count(*)`,
              totalAiCallsSaved: sql<number>`coalesce(sum(${iviAuditDecisionsCache.aiCallsSaved}), 0)`,
            })
            .from(iviAuditDecisionsCache)
            .where(inArray(iviAuditDecisionsCache.admissionId, admIds));
        }
      }
      res.json({
        cachedDecisions: Number(row?.cachedDecisions || 0),
        totalAiCallsSaved: Number(row?.totalAiCallsSaved || 0),
      });
    } catch (error) {
      console.error('GET /api/audit/cache-stats error:', error);
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao consultar cache de decisões da Ivi.') });
    }
  });
}
