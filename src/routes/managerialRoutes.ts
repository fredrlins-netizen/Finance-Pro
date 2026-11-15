import type { Express } from 'express';
import { desc } from 'drizzle-orm';
import { db } from '../db/index.ts';
import {
  admissions,
  clients,
  collaborators,
  collectionCases,
  collectionNotes,
  collectionReports,
  financialTitles,
  iviAuditDecisionsCache,
  legalMovements,
  legalProcesses,
  prospectionLeads,
  titleSettlements,
  units,
  users,
  whatsappMessages,
  whatsappThreads,
} from '../db/schema.ts';
import { ensureCommonCadastrosSeed, ensureInitialSeed } from '../db/seed.ts';
import { AuthRequest, requireAuth, requireModule } from '../middleware/auth.ts';
import type { ManagerialDashboardPayload } from '../types.ts';

const EXCLUDED_COLLECTION_STATUSES = new Set([
  'CANCELADO',
  'AGRUPADO',
  'FATURA_GERADA',
  'ADIANTAMENTO',
  'ADIANTAMENTO_PARCIAL',
  'DEVOLUCAO',
  'DEVOLUCAO_VINCULADA',
  'DEVOLUCAO_PARCIAL',
]);

const MONTH_NAMES_PT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

function formatMonthLabel(monthKey: string): string {
  const [yr, mo] = monthKey.split('-');
  const idx = Number(mo) - 1;
  if (!yr || !Number.isFinite(idx) || idx < 0 || idx > 11) return monthKey;
  return `${MONTH_NAMES_PT[idx]}/${yr.slice(2)}`;
}

function toMonthKey(rawDate: Date | string | null | undefined): string {
  if (!rawDate) return '';
  const d = rawDate instanceof Date ? rawDate : new Date(rawDate);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function toDateKey(rawDate: Date | string | null | undefined): string {
  if (!rawDate) return '';
  const d = rawDate instanceof Date ? rawDate : new Date(rawDate);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

function buildRecentMonthKeys(countMonths: number): string[] {
  const now = new Date();
  const keys: string[] = [];
  for (let i = countMonths - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    keys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return keys;
}

function buildRecentDayKeys(countDays: number): string[] {
  const now = new Date();
  const keys: string[] = [];
  for (let i = countDays - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86400000);
    keys.push(d.toISOString().slice(0, 10));
  }
  return keys;
}

function normalizeLegalStatusLabel(status: string): string {
  const s = String(status || '').toLowerCase();
  if (s === 'em_acompanhamento') return 'Em Acompanhamento';
  if (s === 'alerta_movimentacao') return 'Alerta Movimentação';
  if (s === 'apreendido') return 'Veículo Apreendido';
  if (s === 'revertido') return 'Apreensão Revertida';
  if (s === 'suspenso') return 'Suspenso';
  if (s === 'cancelado') return 'Cancelado';
  return status || 'Outros';
}

function normalizeActionTypeLabel(actionType: string): string {
  const s = String(actionType || '').toLowerCase();
  if (s === 'busca_apreensao') return 'Busca e Apreensão';
  if (s === 'revisional') return 'Ação Revisional';
  if (s === 'execucao') return 'Execução de Título';
  return actionType || 'Outros';
}

export function registerManagerialRoutes(app: Express) {
  app.get(
    '/api/managerial-dashboard',
    requireAuth,
    requireModule('managerial_dashboard'),
    async (req: AuthRequest, res) => {
      try {
        await ensureInitialSeed();
        await ensureCommonCadastrosSeed();

        const unitScopeParam = String(req.query.unitScope || 'active').toLowerCase();
        const unitScope: 'active' | 'all' = unitScopeParam === 'all' ? 'all' : 'active';
        const periodDaysRaw = Number(req.query.days || 90);
        const periodDays = Number.isFinite(periodDaysRaw) && periodDaysRaw > 0 ? Math.min(periodDaysRaw, 730) : 90;

        const now = new Date();
        const cutoffMs = now.getTime() - periodDays * 86400000;
        const todayIso = now.toISOString().slice(0, 10);

        const [
          allUnits,
          allUsers,
          allCollabs,
          allClients,
          allTitles,
          allSettlements,
          allCases,
          allNotes,
          allReports,
          allProcesses,
          allMovements,
          allAdmissions,
          allIviCache,
          allLeads,
          allThreads,
          allMessages,
        ] = await Promise.all([
          db.select().from(units),
          db.select({ id: users.id, name: users.name, role: users.role, defaultUnitId: users.defaultUnitId, points: users.points }).from(users),
          db.select().from(collaborators),
          db.select({ id: clients.id, fullName: clients.fullName, unitId: clients.unitId, status: clients.status }).from(clients),
          db.select().from(financialTitles),
          db.select().from(titleSettlements),
          db.select().from(collectionCases),
          db.select().from(collectionNotes),
          db.select().from(collectionReports),
          db.select().from(legalProcesses).orderBy(desc(legalProcesses.lastMovementAt)),
          db.select().from(legalMovements).orderBy(desc(legalMovements.createdAt)),
          db.select({
            id: admissions.id,
            unitId: admissions.unitId,
            status: admissions.status,
            iviAuditAnalysisJson: admissions.iviAuditAnalysisJson,
            auditedAt: admissions.auditedAt,
            createdAt: admissions.createdAt,
          }).from(admissions),
          db.select().from(iviAuditDecisionsCache),
          db.select({
            id: prospectionLeads.id,
            unitId: prospectionLeads.unitId,
            stage: prospectionLeads.stage,
            iviProviderUsed: prospectionLeads.iviProviderUsed,
            aiTranscript: prospectionLeads.aiTranscript,
            summaryText: prospectionLeads.summaryText,
            createdAt: prospectionLeads.createdAt,
          }).from(prospectionLeads),
          db.select({ id: whatsappThreads.id, unitId: whatsappThreads.unitId }).from(whatsappThreads),
          db.select({
            id: whatsappMessages.id,
            threadId: whatsappMessages.threadId,
            contentType: whatsappMessages.contentType,
            iviAudioTranscript: whatsappMessages.iviAudioTranscript,
            createdAt: whatsappMessages.createdAt,
          }).from(whatsappMessages),
        ]);

        const allowedSet =
          req.authUser!.role === 'admin'
            ? new Set(allUnits.map((u) => u.id))
            : new Set(req.authUser!.allowedUnitIds.length > 0 ? req.authUser!.allowedUnitIds : [req.activeUnitId || 1]);

        const activeUnitId = req.activeUnitId || req.authUser!.defaultUnitId || allUnits[0]?.id || 1;
        const unitFilterSet =
          unitScope === 'active'
            ? new Set([activeUnitId])
            : allowedSet;

        const matchUnit = (unitId: number | null | undefined) =>
          unitScope === 'all' && req.authUser!.role === 'admin'
            ? true
            : unitFilterSet.has(Number(unitId || activeUnitId));

        const activeUnitObj = allUnits.find((u) => u.id === activeUnitId);
        const unitLabel =
          unitScope === 'active'
            ? activeUnitObj
              ? `${activeUnitObj.code} · ${activeUnitObj.name}`
              : `Unidade #${activeUnitId}`
            : `Todas as Unidades (${unitFilterSet.size})`;

        // Maps
        const clientMap = new Map(allClients.map((c) => [c.id, c]));
        const userMap = new Map(allUsers.map((u) => [u.id, u]));
        const collabMap = new Map(allCollabs.map((c) => [c.id, c]));

        // ---------------------------------------------------------------------
        // 1. COLLECTION PERFORMANCE
        // ---------------------------------------------------------------------
        const receivableTitles = allTitles.filter(
          (t) =>
            (t.scope || 'RECEBER').toUpperCase() === 'RECEBER' &&
            matchUnit(t.unitId) &&
            !EXCLUDED_COLLECTION_STATUSES.has(String(t.status || '').toUpperCase())
        );

        const titleById = new Map(allTitles.map((t) => [t.id, t]));
        const scopedSettlements = allSettlements.filter((s) => {
          const t = titleById.get(s.titleId);
          return t && (t.scope || 'RECEBER').toUpperCase() === 'RECEBER' && matchUnit(t.unitId);
        });

        let totalActiveTitles = 0;
        let overdueTitlesCount = 0;
        let totalReceivableBalanceCents = 0;
        let overdueBalanceCents = 0;
        let recoveredPeriodCents = 0;

        const agingMap: Record<string, { label: string; count: number; balanceCents: number }> = {
          em_dia: { label: 'Em Dia', count: 0, balanceCents: 0 },
          d1_30: { label: '1–30 dias', count: 0, balanceCents: 0 },
          d31_60: { label: '31–60 dias', count: 0, balanceCents: 0 },
          d61_90: { label: '61–90 dias', count: 0, balanceCents: 0 },
          d90_plus: { label: '+90 dias', count: 0, balanceCents: 0 },
        };

        const statusMap: Record<string, { label: string; count: number; balanceCents: number }> = {
          PAGO: { label: 'Recebimento Total', count: 0, balanceCents: 0 },
          PARCIAL: { label: 'Recebimento Parcial', count: 0, balanceCents: 0 },
          ABERTO: { label: 'Em Aberto / Cobrança', count: 0, balanceCents: 0 },
          PROTESTADO: { label: 'Protestado', count: 0, balanceCents: 0 },
        };

        const opPerfMap = new Map<
          string,
          {
            name: string;
            recoveredCents: number;
            openBalanceCents: number;
            overdueBalanceCents: number;
            titlesCount: number;
            paidCount: number;
            notesCount: number;
            points: number;
          }
        >();

        const ensureOp = (name: string, points = 0) => {
          const clean = name.trim() || 'Não Atribuído';
          let cur = opPerfMap.get(clean);
          if (!cur) {
            cur = {
              name: clean,
              recoveredCents: 0,
              openBalanceCents: 0,
              overdueBalanceCents: 0,
              titlesCount: 0,
              paidCount: 0,
              notesCount: 0,
              points,
            };
            opPerfMap.set(clean, cur);
          } else if (points > cur.points) {
            cur.points = points;
          }
          return cur;
        };

        const resolveOperatorForTitle = (t: (typeof receivableTitles)[number]): { name: string; points: number } => {
          if (t.assignedCollaboratorId && collabMap.has(t.assignedCollaboratorId)) {
            const col = collabMap.get(t.assignedCollaboratorId)!;
            const linkedUser = col.userId ? userMap.get(col.userId) : undefined;
            return { name: col.name, points: linkedUser?.points || 0 };
          }
          if (t.collectorId && userMap.has(t.collectorId)) {
            const u = userMap.get(t.collectorId)!;
            return { name: u.name, points: u.points || 0 };
          }
          const matchingCase = allCases.find((c) => c.titleId === t.id && c.assignedCollectorId);
          if (matchingCase?.assignedCollectorId && userMap.has(matchingCase.assignedCollectorId)) {
            const u = userMap.get(matchingCase.assignedCollectorId)!;
            return { name: u.name, points: u.points || 0 };
          }
          return { name: 'Carteira Geral', points: 0 };
        };

        const titlesWithSettlementIds = new Set(scopedSettlements.map((s) => s.titleId));

        for (const t of receivableTitles) {
          const stRaw = String(t.status || 'ABERTO').toUpperCase();
          const stNorm = stRaw === 'VENCIDO' ? 'ABERTO' : stRaw;
          const origCents = Number(t.originalValueCents || t.amountCents || 0);
          const balCents =
            stNorm === 'PAGO'
              ? 0
              : Number(t.currentBalanceCents > 0 || stNorm !== 'ABERTO' ? t.currentBalanceCents : t.amountCents || 0);
          const dueIso = toDateKey(t.dueDate);
          const dueMs = t.dueDate ? new Date(t.dueDate).getTime() : now.getTime();
          const daysPastDue = Math.floor((now.getTime() - dueMs) / 86400000);
          const isOverdue = stNorm !== 'PAGO' && Boolean(dueIso && dueIso < todayIso);

          if (stNorm === 'PAGO') {
            statusMap.PAGO.count += 1;
            statusMap.PAGO.balanceCents += origCents;
          } else if (stNorm === 'PARCIAL') {
            statusMap.PARCIAL.count += 1;
            statusMap.PARCIAL.balanceCents += balCents;
          } else if (t.isProtested || stNorm === 'PROTESTADO') {
            statusMap.PROTESTADO.count += 1;
            statusMap.PROTESTADO.balanceCents += balCents;
          } else {
            statusMap.ABERTO.count += 1;
            statusMap.ABERTO.balanceCents += balCents;
          }

          if (stNorm !== 'PAGO') {
            totalActiveTitles += 1;
            totalReceivableBalanceCents += balCents;
            if (isOverdue) {
              overdueTitlesCount += 1;
              overdueBalanceCents += balCents;
            }
            if (!isOverdue || daysPastDue <= 0) {
              agingMap.em_dia.count += 1;
              agingMap.em_dia.balanceCents += balCents;
            } else if (daysPastDue <= 30) {
              agingMap.d1_30.count += 1;
              agingMap.d1_30.balanceCents += balCents;
            } else if (daysPastDue <= 60) {
              agingMap.d31_60.count += 1;
              agingMap.d31_60.balanceCents += balCents;
            } else if (daysPastDue <= 90) {
              agingMap.d61_90.count += 1;
              agingMap.d61_90.balanceCents += balCents;
            } else {
              agingMap.d90_plus.count += 1;
              agingMap.d90_plus.balanceCents += balCents;
            }
          }

          // Fallback recovered for legacy paid titles without title_settlements row
          if (stNorm === 'PAGO' && !titlesWithSettlementIds.has(t.id)) {
            const paidTs = t.paidAt ? new Date(t.paidAt).getTime() : new Date(t.updatedAt || t.createdAt).getTime();
            if (paidTs >= cutoffMs) {
              recoveredPeriodCents += origCents;
            }
          }

          const opInfo = resolveOperatorForTitle(t);
          const opEntry = ensureOp(opInfo.name, opInfo.points);
          opEntry.titlesCount += 1;
          if (stNorm === 'PAGO') {
            opEntry.paidCount += 1;
            if (!titlesWithSettlementIds.has(t.id)) {
              opEntry.recoveredCents += origCents;
            }
          } else {
            opEntry.openBalanceCents += balCents;
            if (isOverdue) {
              opEntry.overdueBalanceCents += balCents;
            }
          }
        }

        for (const s of scopedSettlements) {
          const ts = new Date(s.settlementDate || s.createdAt).getTime();
          if (ts >= cutoffMs) {
            recoveredPeriodCents += Number(s.amountCents || 0);
          }
          const t = titleById.get(s.titleId);
          if (t) {
            const opInfo = resolveOperatorForTitle(t);
            const opEntry = ensureOp(opInfo.name, opInfo.points);
            opEntry.recoveredCents += Number(s.amountCents || 0);
          }
        }

        for (const note of allNotes) {
          if (note.unitId && !matchUnit(note.unitId)) continue;
          const opName = note.collaboratorName || (note.userId ? userMap.get(note.userId)?.name : '') || '';
          if (opName) {
            const opEntry = ensureOp(opName);
            opEntry.notesCount += 1;
          }
        }

        // Monthly trend (6 or 12 months depending on periodDays)
        const monthsCount = periodDays > 180 ? 12 : 6;
        const monthKeys = buildRecentMonthKeys(monthsCount);
        const monthlyMap = new Map(
          monthKeys.map((mk) => [
            mk,
            {
              monthKey: mk,
              monthLabel: formatMonthLabel(mk),
              receivedCents: 0,
              overdueCents: 0,
              openedCents: 0,
              recoveredCount: 0,
            },
          ])
        );

        for (const t of receivableTitles) {
          const mkDue = toMonthKey(t.dueDate);
          const bucket = monthlyMap.get(mkDue);
          const stNorm = String(t.status || 'ABERTO').toUpperCase();
          const origCents = Number(t.originalValueCents || t.amountCents || 0);
          const balCents = Number(t.currentBalanceCents || t.amountCents || 0);
          const dueIso = toDateKey(t.dueDate);
          if (bucket && stNorm !== 'PAGO') {
            if (dueIso && dueIso < todayIso) {
              bucket.overdueCents += balCents;
            } else {
              bucket.openedCents += balCents;
            }
          }
          if (stNorm === 'PAGO' && !titlesWithSettlementIds.has(t.id)) {
            const mkPaid = toMonthKey(t.paidAt || t.updatedAt || t.createdAt);
            const paidBucket = monthlyMap.get(mkPaid);
            if (paidBucket) {
              paidBucket.receivedCents += origCents;
              paidBucket.recoveredCount += 1;
            }
          }
        }

        for (const s of scopedSettlements) {
          const mk = toMonthKey(s.settlementDate || s.createdAt);
          const bucket = monthlyMap.get(mk);
          if (bucket) {
            bucket.receivedCents += Number(s.amountCents || 0);
            bucket.recoveredCount += 1;
          }
        }

        const totalReceivableVolumeCents = totalReceivableBalanceCents + recoveredPeriodCents;
        const recoveryRatePct =
          totalReceivableVolumeCents > 0
            ? Number(((recoveredPeriodCents / totalReceivableVolumeCents) * 100).toFixed(1))
            : 0;
        const defaultRatePct =
          totalReceivableBalanceCents > 0
            ? Number(((overdueBalanceCents / totalReceivableBalanceCents) * 100).toFixed(1))
            : 0;

        // ---------------------------------------------------------------------
        // 2. REAL-TIME LEGAL PROCESSES
        // ---------------------------------------------------------------------
        const scopedProcesses = allProcesses.filter((p) => matchUnit(p.unitId));
        const processMap = new Map(scopedProcesses.map((p) => [p.id, p]));
        const scopedMovements = allMovements.filter((m) => processMap.has(m.processId));

        let escavadorMonitored = 0;
        let unreadMovements = 0;
        let searchSeizureCount = 0;
        let vehicleSeizedCount = 0;
        let suspendedOrCancelledCount = 0;

        const legalStatusCounter = new Map<string, number>();
        const legalActionCounter = new Map<string, number>();
        const courtCounter = new Map<string, { count: number; searchSeizureCount: number }>();

        for (const p of scopedProcesses) {
          if (p.escavadorMonitored) escavadorMonitored += 1;
          if (p.hasUnreadMovement) unreadMovements += 1;
          if (p.hasSearchSeizure) searchSeizureCount += 1;
          if (p.vehicleSeized) vehicleSeizedCount += 1;
          if (p.status === 'suspenso' || p.status === 'cancelado') suspendedOrCancelledCount += 1;

          legalStatusCounter.set(p.status, (legalStatusCounter.get(p.status) || 0) + 1);
          legalActionCounter.set(p.actionType, (legalActionCounter.get(p.actionType) || 0) + 1);

          const courtKey = (p.courtName || 'Tribunal não informado').trim();
          const cCur = courtCounter.get(courtKey) || { count: 0, searchSeizureCount: 0 };
          cCur.count += 1;
          if (p.hasSearchSeizure) cCur.searchSeizureCount += 1;
          courtCounter.set(courtKey, cCur);
        }

        // Avg response hours on read/opened movements
        const responseHoursSamples: number[] = [];
        for (const m of scopedMovements) {
          const endRef = m.readCompletedAt || m.openedAt;
          if (endRef && m.createdAt) {
            const diffHrs = (new Date(endRef).getTime() - new Date(m.createdAt).getTime()) / 3600000;
            if (diffHrs >= 0 && diffHrs < 720) {
              responseHoursSamples.push(diffHrs);
            }
          }
        }
        const avgResponseHours =
          responseHoursSamples.length > 0
            ? Number((responseHoursSamples.reduce((a, b) => a + b, 0) / responseHoursSamples.length).toFixed(1))
            : 0;

        const timelineDays = Math.min(periodDays, 30);
        const dayKeys = buildRecentDayKeys(timelineDays);
        const dayMoveMap = new Map(
          dayKeys.map((dk) => [
            dk,
            {
              dateKey: dk,
              dateLabel: `${dk.slice(8, 10)}/${dk.slice(5, 7)}`,
              escavadorWebhook: 0,
              escavadorFallback: 0,
              detranScan: 0,
              total: 0,
            },
          ])
        );

        for (const m of scopedMovements) {
          const dk = toDateKey(m.createdAt);
          const slot = dayMoveMap.get(dk);
          if (!slot) continue;
          const src = String(m.source || 'escavador_webhook');
          if (src === 'escavador_fallback') slot.escavadorFallback += 1;
          else if (src === 'detran_scan') slot.detranScan += 1;
          else slot.escavadorWebhook += 1;
          slot.total += 1;
        }

        const recentLiveFeed = scopedMovements.slice(0, 12).map((m) => {
          const proc = processMap.get(m.processId)!;
          const cli = clientMap.get(proc.clientId);
          return {
            id: m.id,
            processId: proc.id,
            processNumber: proc.processNumber,
            clientName: cli?.fullName || `Cliente #${proc.clientId}`,
            courtName: proc.courtName,
            actionType: proc.actionType,
            status: proc.status,
            source: m.source,
            originalDispatch: m.originalDispatch,
            iviTranslationPtBr: m.iviTranslationPtBr,
            hasUnreadMovement: proc.hasUnreadMovement,
            hasSearchSeizure: proc.hasSearchSeizure,
            vehicleSeized: proc.vehicleSeized,
            createdAt: new Date(m.createdAt).toISOString(),
          };
        });

        // ---------------------------------------------------------------------
        // 3. IVI EFFICIENCY METRICS
        // ---------------------------------------------------------------------
        const scopedAdmissions = allAdmissions.filter((a) => matchUnit(a.unitId));
        const admissionIdSet = new Set(scopedAdmissions.map((a) => a.id));
        const scopedIviCache = allIviCache.filter((c) => admissionIdSet.has(c.admissionId));
        const scopedLeads = allLeads.filter((l) => matchUnit(l.unitId));
        const scopedThreadIds = new Set(allThreads.filter((th) => matchUnit(th.unitId)).map((th) => th.id));
        const scopedMessages = allMessages.filter((m) => scopedThreadIds.has(m.threadId));
        const scopedReports = allReports.filter((r) => !r.unitId || matchUnit(r.unitId));

        let auditSweepsCount = scopedIviCache.length;
        let aiCallsSaved = scopedIviCache.reduce((acc, item) => acc + Number(item.aiCallsSaved || 0), 0);

        const verdictCountMap = new Map<string, number>();
        for (const item of scopedIviCache) {
          verdictCountMap.set(item.verdict, (verdictCountMap.get(item.verdict) || 0) + 1);
        }

        // Also include persisted snapshots in admissions that aren't already represented in cache count
        for (const adm of scopedAdmissions) {
          if (adm.iviAuditAnalysisJson) {
            if (scopedIviCache.length === 0) {
              auditSweepsCount += 1;
              aiCallsSaved += Number(adm.iviAuditAnalysisJson.aiCallsSaved || 0);
              const v = adm.iviAuditAnalysisJson.verdict || 'CONFERIR_PONTOS';
              verdictCountMap.set(v, (verdictCountMap.get(v) || 0) + 1);
            }
          }
        }

        const totalAuditEvaluations = auditSweepsCount + aiCallsSaved;
        const cacheHitRatioPct =
          totalAuditEvaluations > 0 ? Number(((aiCallsSaved / totalAuditEvaluations) * 100).toFixed(1)) : 0;

        const legalTranslationsCount = scopedMovements.filter(
          (m) => Boolean(m.iviTranslationPtBr && m.iviTranslationPtBr.trim())
        ).length;

        const leadsWithIvi = scopedLeads.filter((l) => {
          const transcript = Array.isArray(l.aiTranscript) ? l.aiTranscript : [];
          return Boolean(l.iviProviderUsed || l.summaryText || transcript.some((t) => t.sender === 'ivi'));
        });
        const escalatedLeadsCount = leadsWithIvi.filter((l) => l.stage === 'escalado_humano').length;
        const resolvedByIviLeadsCount = Math.max(0, leadsWithIvi.length - escalatedLeadsCount);
        const humanEscalationRatePct =
          leadsWithIvi.length > 0
            ? Number(((escalatedLeadsCount / leadsWithIvi.length) * 100).toFixed(1))
            : 0;

        const audioTranscriptionsCount =
          scopedMessages.filter((m) => Boolean(m.iviAudioTranscript && m.iviAudioTranscript.trim())).length +
          scopedLeads.reduce((acc, l) => {
            const tr = Array.isArray(l.aiTranscript) ? l.aiTranscript : [];
            return acc + tr.filter((t) => Boolean(t.audioTranscript && t.audioTranscript.trim())).length;
          }, 0);

        const savedReportsCount = scopedReports.length;
        const iviTotalInteractions =
          auditSweepsCount +
          aiCallsSaved +
          legalTranslationsCount +
          leadsWithIvi.length +
          audioTranscriptionsCount +
          savedReportsCount;

        // Provider usage distribution
        const providerMap = new Map<string, number>();
        const bumpProvider = (raw: string | null | undefined) => {
          const clean = String(raw || '').trim().toLowerCase();
          if (!clean) return;
          const normalized =
            clean.includes('gemini')
              ? 'Gemini'
              : clean.includes('claude')
              ? 'Claude'
              : clean.includes('openai') || clean.includes('gpt')
              ? 'OpenAI'
              : clean.includes('deepseek')
              ? 'DeepSeek'
              : clean.includes('local') || clean.includes('rules')
              ? 'Cache Regras DB'
              : clean.toUpperCase();
          providerMap.set(normalized, (providerMap.get(normalized) || 0) + 1);
        };
        for (const l of scopedLeads) bumpProvider(l.iviProviderUsed);
        for (const c of scopedIviCache) bumpProvider(c.sourceEngine);
        for (const r of scopedReports) bumpProvider(r.provider);

        // Capability breakdown
        const totalAuditableAdmissions = scopedAdmissions.filter((a) =>
          ['aguardando_auditoria', 'auditada', 'aprovada', 'devolvida_admissao', 'retorno_auditoria', 'finalizada', 'concluido'].includes(a.status)
        ).length;
        const auditManualOnly = Math.max(0, totalAuditableAdmissions - auditSweepsCount);

        const legalTotalMovs = scopedMovements.length;
        const legalManualOnly = Math.max(0, legalTotalMovs - legalTranslationsCount);

        const totalAudios = scopedMessages.filter((m) => m.contentType === 'audio').length;
        const audioPending = Math.max(0, totalAudios - audioTranscriptionsCount);

        const byCapability = [
          {
            area: 'auditoria',
            label: 'Auditoria & Cache BD',
            automationsCount: auditSweepsCount + aiCallsSaved,
            cacheOrSelfResolved: aiCallsSaved,
            escalatedOrManual: auditManualOnly,
            efficiencyPct:
              auditSweepsCount + aiCallsSaved + auditManualOnly > 0
                ? Number((((auditSweepsCount + aiCallsSaved) / (auditSweepsCount + aiCallsSaved + auditManualOnly)) * 100).toFixed(1))
                : 0,
          },
          {
            area: 'juridico',
            label: 'Tradução Escavador',
            automationsCount: legalTranslationsCount,
            cacheOrSelfResolved: legalTranslationsCount,
            escalatedOrManual: legalManualOnly,
            efficiencyPct:
              legalTotalMovs > 0 ? Number(((legalTranslationsCount / legalTotalMovs) * 100).toFixed(1)) : 0,
          },
          {
            area: 'prospeccao',
            label: 'Triagem Prospecção',
            automationsCount: leadsWithIvi.length,
            cacheOrSelfResolved: resolvedByIviLeadsCount,
            escalatedOrManual: escalatedLeadsCount,
            efficiencyPct:
              leadsWithIvi.length > 0
                ? Number(((resolvedByIviLeadsCount / leadsWithIvi.length) * 100).toFixed(1))
                : 0,
          },
          {
            area: 'whatsapp_audio',
            label: 'Transcrição de Áudios',
            automationsCount: audioTranscriptionsCount,
            cacheOrSelfResolved: audioTranscriptionsCount,
            escalatedOrManual: audioPending,
            efficiencyPct:
              audioTranscriptionsCount + audioPending > 0
                ? Number(((audioTranscriptionsCount / (audioTranscriptionsCount + audioPending)) * 100).toFixed(1))
                : 0,
          },
          {
            area: 'relatorios_cobranca',
            label: 'Relatórios Cobrança',
            automationsCount: savedReportsCount,
            cacheOrSelfResolved: savedReportsCount,
            escalatedOrManual: 0,
            efficiencyPct: savedReportsCount > 0 ? 100 : 0,
          },
        ];

        // Ivi efficiency timeline by month
        const iviTimelineMap = new Map(
          monthKeys.map((mk) => [
            mk,
            {
              monthKey: mk,
              monthLabel: formatMonthLabel(mk),
              aiExecutions: 0,
              dbCacheHits: 0,
              legalTranslations: 0,
              audioTranscripts: 0,
            },
          ])
        );

        for (const c of scopedIviCache) {
          const slot = iviTimelineMap.get(toMonthKey(c.createdAt));
          if (slot) {
            slot.aiExecutions += 1;
            slot.dbCacheHits += Number(c.aiCallsSaved || 0);
          }
        }
        for (const m of scopedMovements) {
          if (!m.iviTranslationPtBr) continue;
          const slot = iviTimelineMap.get(toMonthKey(m.createdAt));
          if (slot) slot.legalTranslations += 1;
        }
        for (const msg of scopedMessages) {
          if (!msg.iviAudioTranscript) continue;
          const slot = iviTimelineMap.get(toMonthKey(msg.createdAt));
          if (slot) slot.audioTranscripts += 1;
        }
        for (const l of leadsWithIvi) {
          const slot = iviTimelineMap.get(toMonthKey(l.createdAt));
          if (slot) slot.aiExecutions += 1;
        }

        const payload: ManagerialDashboardPayload = {
          meta: {
            generatedAt: now.toISOString(),
            unitScope,
            unitLabel,
            periodDays,
            totalUnitsIncluded: unitFilterSet.size,
          },
          kpis: {
            totalActiveTitles,
            overdueTitlesCount,
            totalReceivableBalanceCents,
            overdueBalanceCents,
            recoveredPeriodCents,
            recoveryRatePct,
            defaultRatePct,
            activeLegalProcesses: scopedProcesses.filter(
              (p) => p.status !== 'suspenso' && p.status !== 'cancelado'
            ).length,
            unreadLegalMovements: unreadMovements,
            seizureRiskProcesses: scopedProcesses.filter((p) => p.hasSearchSeizure || p.vehicleSeized).length,
            iviTotalInteractions,
            iviAiCallsSaved: aiCallsSaved,
          },
          collection: {
            monthlyTrend: Array.from(monthlyMap.values()),
            agingBuckets: Object.entries(agingMap).map(([key, v]) => ({ key, ...v })),
            statusBreakdown: Object.entries(statusMap).map(([status, v]) => ({ status, ...v })),
            operatorRanking: Array.from(opPerfMap.values())
              .sort((a, b) => b.recoveredCents - a.recoveredCents || b.points - a.points)
              .slice(0, 10),
          },
          legal: {
            realtimeSnapshotAt: now.toISOString(),
            summary: {
              totalProcesses: scopedProcesses.length,
              escavadorMonitored,
              unreadMovements,
              searchSeizureCount,
              vehicleSeizedCount,
              suspendedOrCancelledCount,
              avgResponseHours,
            },
            byStatus: Array.from(legalStatusCounter.entries()).map(([status, count]) => ({
              status,
              label: normalizeLegalStatusLabel(status),
              count,
            })),
            byActionType: Array.from(legalActionCounter.entries()).map(([actionType, count]) => ({
              actionType,
              label: normalizeActionTypeLabel(actionType),
              count,
            })),
            byCourt: Array.from(courtCounter.entries())
              .map(([courtName, info]) => ({ courtName, ...info }))
              .sort((a, b) => b.count - a.count)
              .slice(0, 8),
            movementsTimeline: Array.from(dayMoveMap.values()),
            recentLiveFeed,
          },
          ivi: {
            summary: {
              totalAutomations: iviTotalInteractions,
              auditSweepsCount,
              aiCallsSaved,
              cacheHitRatioPct,
              legalTranslationsCount,
              prospectionLeadsHandled: leadsWithIvi.length,
              humanEscalationRatePct,
              audioTranscriptionsCount,
              savedReportsCount,
            },
            byCapability,
            auditVerdicts: Array.from(verdictCountMap.entries()).map(([verdict, count]) => ({
              verdict,
              label:
                verdict === 'APROVAR'
                  ? 'Aprovação Sugerida'
                  : verdict === 'DEVOLVER_COMERCIAL'
                  ? 'Devolver Comercial'
                  : 'Conferir Pontos',
              count,
            })),
            providerUsage: Array.from(providerMap.entries())
              .map(([provider, count]) => ({ provider, count }))
              .sort((a, b) => b.count - a.count),
            efficiencyTimeline: Array.from(iviTimelineMap.values()),
          },
        };

        res.json(payload);
      } catch (error) {
        console.error('Managerial dashboard error:', error);
        res.status(500).json({ error: 'Erro ao consolidar indicadores do Dashboard Gerencial.' });
      }
    }
  );
}
