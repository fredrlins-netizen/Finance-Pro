import React, { useMemo, useState } from 'react';
import { FileSpreadsheet, FileText } from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatBRL } from '../../lib/api.ts';
import {
  exportDashboardSnapshotToExcel,
  exportDashboardSnapshotToPdf,
} from '../../lib/collectionExport.ts';
import {
  Client,
  CollaboratorItem,
  FinancialTitle,
  StateDebtRecoveryMetric,
  TitleSettlement,
} from '../../types.ts';
import {
  computeAgingDays,
  formatDueDateLocalBR,
  getAgingBucket,
  toIsoDateInput,
} from './CollectionCoordinatorModalViews.tsx';
import { computeTitleFinancialBreakdown } from './CollectionOperationalModals.tsx';

interface CollectionOperationalDashboardProps {
  isAdmin: boolean;
  operatorLabel: string;
  scopedPortfolioTitles: FinancialTitle[];
  scopedPaidTitles: FinancialTitle[];
  scopedAllTitles: FinancialTitle[];
  settlements: TitleSettlement[];
  clients: Client[];
  collaborators: CollaboratorItem[];
  settledByTitleMap: Map<number, number>;
  onSelectAgingBucket: (bucketKey: string) => void;
}

export const CollectionOperationalDashboard: React.FC<CollectionOperationalDashboardProps> = ({
  isAdmin,
  operatorLabel,
  scopedPortfolioTitles,
  scopedPaidTitles,
  scopedAllTitles,
  settlements,
  clients,
  collaborators,
  settledByTitleMap,
  onSelectAgingBucket,
}) => {
  const [dueFrom, setDueFrom] = useState('');
  const [dueTo, setDueTo] = useState('');
  const [collaboratorFilter, setCollaboratorFilter] = useState('');
  const [refMonth, setRefMonth] = useState(() => toIsoDateInput(new Date()).slice(0, 7));

  const todayIso = useMemo(() => toIsoDateInput(new Date()), []);
  const clientMap = useMemo(() => new Map(clients.map((c) => [c.id, c])), [clients]);
  const collabMap = useMemo(() => new Map(collaborators.map((c) => [c.id, c])), [collaborators]);
  const scopedTitleById = useMemo(
    () => new Map(scopedAllTitles.map((t) => [t.id, t])),
    [scopedAllTitles]
  );

  const matchesCollab = (t: FinancialTitle) => {
    if (!isAdmin || !collaboratorFilter) return true;
    if (collaboratorFilter === '__unassigned__') return !t.assignedCollaboratorId;
    return String(t.assignedCollaboratorId || '') === collaboratorFilter;
  };

  const matchesPeriod = (t: FinancialTitle) => {
    const dIso = toIsoDateInput(t.dueDate);
    if (dueFrom && (!dIso || dIso < dueFrom)) return false;
    if (dueTo && (!dIso || dIso > dueTo)) return false;
    return true;
  };

  // Indicadores de Hoje (calculados sobre a carteira do escopo + filtro de responsável)
  const todayStats = useMemo(() => {
    let dueTodayCount = 0;
    let dueTodayCents = 0;
    let overdueAccumCount = 0;
    let overdueAccumCents = 0;

    for (const t of scopedPortfolioTitles) {
      if (!matchesCollab(t)) continue;
      const b = computeTitleFinancialBreakdown(t, settledByTitleMap);
      const dIso = toIsoDateInput(t.dueDate);
      const days = computeAgingDays(t.dueDate);
      if (dIso === todayIso) {
        dueTodayCount += 1;
        dueTodayCents += b.balanceCents;
      }
      if (days > 0) {
        overdueAccumCount += 1;
        overdueAccumCents += b.balanceCents;
      }
    }

    const settledTodayTitleIds = new Set<number>();
    let settledTodayCount = 0;
    let settledTodayCents = 0;

    for (const s of settlements) {
      const sIso = toIsoDateInput(s.settlementDate);
      if (sIso !== todayIso) continue;
      const linked = scopedTitleById.get(s.titleId);
      if (!linked || !matchesCollab(linked)) continue;
      const val = Number(s.amountCents || 0);
      if (val <= 0) continue;
      settledTodayTitleIds.add(linked.id);
      settledTodayCount += 1;
      settledTodayCents += val;
    }

    for (const t of scopedPaidTitles) {
      if (settledTodayTitleIds.has(t.id) || !matchesCollab(t)) continue;
      const pIso = toIsoDateInput(t.paidAt);
      if (pIso !== todayIso) continue;
      const val = Number(t.originalValueCents || t.amountCents || 0);
      if (val <= 0) continue;
      settledTodayCount += 1;
      settledTodayCents += val;
    }

    return {
      dueTodayCount,
      dueTodayCents,
      overdueAccumCount,
      overdueAccumCents,
      settledTodayCount,
      settledTodayCents,
    };
  }, [
    scopedPortfolioTitles,
    scopedPaidTitles,
    settlements,
    scopedTitleById,
    settledByTitleMap,
    todayIso,
    isAdmin,
    collaboratorFilter,
  ]);

  // Indicadores Acumulados & Período (100% alinhados com CollectionCoordinatorView)
  const periodStats = useMemo(() => {
    const filteredActive = scopedPortfolioTitles.filter(
      (t) => matchesCollab(t) && matchesPeriod(t)
    );
    const filteredPaid = scopedPaidTitles.filter((t) => matchesCollab(t) && matchesPeriod(t));
    const filteredCombined = [...filteredActive, ...filteredPaid];

    let totalCount = filteredActive.length;
    let overdueCount = 0;
    let totalBalanceCents = 0;
    let overdueBalanceCents = 0;

    // Recálculo Financeiro Consolidado
    let recalcOriginalCents = 0;
    let recalcInterestCents = 0;
    let recalcFineCents = 0;
    let recalcDiscountCents = 0;
    let recalcUpdatedCents = 0;
    let recalcReceivedCents = 0;
    let recalcBalanceCents = 0;

    const bucketsMap: Record<string, { count: number; balanceCents: number }> = {
      a_vencer: { count: 0, balanceCents: 0 },
      '1_30': { count: 0, balanceCents: 0 },
      '31_60': { count: 0, balanceCents: 0 },
      '61_90': { count: 0, balanceCents: 0 },
      '90_plus': { count: 0, balanceCents: 0 },
    };

    const collabGroups = new Map<
      string,
      { name: string; count: number; balanceCents: number; overdueBalanceCents: number }
    >();

    const stateGroups = new Map<
      string,
      {
        uf: string;
        clientIds: Set<number>;
        openTitlesCount: number;
        debtBalanceCents: number;
        overdueDebtCents: number;
        recoveredTotalCents: number;
        monthOpenCount: number;
        monthDebtCents: number;
        monthOverdueDebtCents: number;
        monthRecoveredCents: number;
      }
    >();

    const getUfBucket = (clientId: number) => {
      const uf = String(clientMap.get(clientId)?.state || 'N/I').trim().toUpperCase() || 'N/I';
      let item = stateGroups.get(uf);
      if (!item) {
        item = {
          uf,
          clientIds: new Set<number>(),
          openTitlesCount: 0,
          debtBalanceCents: 0,
          overdueDebtCents: 0,
          recoveredTotalCents: 0,
          monthOpenCount: 0,
          monthDebtCents: 0,
          monthOverdueDebtCents: 0,
          monthRecoveredCents: 0,
        };
        stateGroups.set(uf, item);
      }
      return item;
    };

    let partialRecoveredInActiveCents = 0;
    let monthOpenCount = 0;
    let monthDebtCents = 0;
    let monthOverdueDebtCents = 0;

    for (const t of filteredActive) {
      const b = computeTitleFinancialBreakdown(t, settledByTitleMap);
      const days = computeAgingDays(t.dueDate);
      const bucketKey = getAgingBucket(days);

      totalBalanceCents += b.balanceCents;
      if (days > 0) {
        overdueCount += 1;
        overdueBalanceCents += b.balanceCents;
      }
      if (b.receivedCents > 0) {
        partialRecoveredInActiveCents += b.receivedCents;
      }

      bucketsMap[bucketKey].count += 1;
      bucketsMap[bucketKey].balanceCents += b.balanceCents;

      const cKey = t.assignedCollaboratorId ? String(t.assignedCollaboratorId) : '__none__';
      const cName = t.assignedCollaboratorId
        ? collabMap.get(t.assignedCollaboratorId)?.name || `#${t.assignedCollaboratorId}`
        : 'Sem Atribuição';
      const cGrp = collabGroups.get(cKey) || {
        name: cName,
        count: 0,
        balanceCents: 0,
        overdueBalanceCents: 0,
      };
      cGrp.count += 1;
      cGrp.balanceCents += b.balanceCents;
      if (days > 0) cGrp.overdueBalanceCents += b.balanceCents;
      collabGroups.set(cKey, cGrp);

      const ufEntry = getUfBucket(t.clientId);
      ufEntry.clientIds.add(t.clientId);
      ufEntry.openTitlesCount += 1;
      ufEntry.debtBalanceCents += b.balanceCents;
      if (days > 0) ufEntry.overdueDebtCents += b.balanceCents;
      if (b.receivedCents > 0) ufEntry.recoveredTotalCents += b.receivedCents;

      const dueIso = toIsoDateInput(t.dueDate);
      if (dueIso.startsWith(refMonth)) {
        monthOpenCount += 1;
        monthDebtCents += b.balanceCents;
        ufEntry.monthOpenCount += 1;
        ufEntry.monthDebtCents += b.balanceCents;
        if (days > 0) {
          monthOverdueDebtCents += b.balanceCents;
          ufEntry.monthOverdueDebtCents += b.balanceCents;
        }
      }
    }

    for (const t of filteredCombined) {
      const b = computeTitleFinancialBreakdown(t, settledByTitleMap);
      recalcOriginalCents += b.originalCents;
      recalcInterestCents += b.interestCents;
      recalcFineCents += b.fineCents;
      recalcDiscountCents += b.discountCents;
      recalcUpdatedCents += b.updatedCents;
      recalcReceivedCents += b.receivedCents;
      recalcBalanceCents += b.balanceCents;
    }

    let recoveredPaidCents = 0;
    for (const t of filteredPaid) {
      const b = computeTitleFinancialBreakdown(t, settledByTitleMap);
      recoveredPaidCents += b.receivedCents;
      const ufEntry = getUfBucket(t.clientId);
      ufEntry.clientIds.add(t.clientId);
      ufEntry.recoveredTotalCents += b.receivedCents;
    }

    const recoveredCents = recoveredPaidCents + partialRecoveredInActiveCents;
    const defaultRate = totalCount > 0 ? (100 * overdueCount) / totalCount : 0;
    const totalPortfolioDenom = totalBalanceCents + recoveredCents;
    const recoveryRate = totalPortfolioDenom > 0 ? (100 * recoveredCents) / totalPortfolioDenom : 0;

    const avgBalance = totalCount > 0 ? totalBalanceCents / totalCount : 0;
    const dailyRevenue = recoveredCents > 0 ? recoveredCents / 30 : 1;
    const dsoDays =
      totalCount > 0 && dailyRevenue > 0 ? Math.round((avgBalance / dailyRevenue) * 30) : 0;

    // Recuperação mensal
    let monthRecoveredCents = 0;
    let monthSettledCount = 0;
    const settledInMonthIds = new Set<number>();
    for (const s of settlements) {
      const sIso = toIsoDateInput(s.settlementDate);
      if (!sIso.startsWith(refMonth)) continue;
      const linked = scopedTitleById.get(s.titleId);
      if (!linked || !matchesCollab(linked)) continue;
      const val = Number(s.amountCents || 0);
      if (val <= 0) continue;
      settledInMonthIds.add(linked.id);
      monthRecoveredCents += val;
      monthSettledCount += 1;
      const ufEntry = getUfBucket(linked.clientId);
      ufEntry.clientIds.add(linked.clientId);
      ufEntry.monthRecoveredCents += val;
    }

    for (const t of scopedPaidTitles) {
      if (settledInMonthIds.has(t.id) || !matchesCollab(t)) continue;
      const pIso = toIsoDateInput(t.paidAt || t.dueDate);
      if (!pIso.startsWith(refMonth)) continue;
      const val = Number(t.originalValueCents || t.amountCents || 0);
      if (val <= 0) continue;
      monthRecoveredCents += val;
      monthSettledCount += 1;
      const ufEntry = getUfBucket(t.clientId);
      ufEntry.clientIds.add(t.clientId);
      ufEntry.monthRecoveredCents += val;
    }

    const monthDenom = monthDebtCents + monthRecoveredCents;
    const monthRecoveryRatePct = monthDenom > 0 ? (100 * monthRecoveredCents) / monthDenom : 0;

    const agingBuckets = [
      { key: 'a_vencer', label: 'A Vencer', ...bucketsMap.a_vencer, barClass: 'bg-emerald-600' },
      { key: '1_30', label: '1–30 dias', ...bucketsMap['1_30'], barClass: 'bg-amber-500' },
      { key: '31_60', label: '31–60 dias', ...bucketsMap['31_60'], barClass: 'bg-orange-500' },
      { key: '61_90', label: '61–90 dias', ...bucketsMap['61_90'], barClass: 'bg-red-500' },
      { key: '90_plus', label: '90+ dias', ...bucketsMap['90_plus'], barClass: 'bg-red-700' },
    ];

    // Evolução Diária — Saldo Acumulado por data de vencimento no recorte
    const byDateMap = new Map<string, { openCents: number; recoveredCents: number }>();
    for (const t of filteredActive) {
      const dIso = toIsoDateInput(t.dueDate);
      if (!dIso) continue;
      const b = computeTitleFinancialBreakdown(t, settledByTitleMap);
      const entry = byDateMap.get(dIso) || { openCents: 0, recoveredCents: 0 };
      entry.openCents += b.balanceCents;
      if (b.receivedCents > 0) entry.recoveredCents += b.receivedCents;
      byDateMap.set(dIso, entry);
    }
    for (const t of filteredPaid) {
      const dIso = toIsoDateInput(t.paidAt || t.dueDate);
      if (!dIso) continue;
      const b = computeTitleFinancialBreakdown(t, settledByTitleMap);
      const entry = byDateMap.get(dIso) || { openCents: 0, recoveredCents: 0 };
      entry.recoveredCents += b.receivedCents;
      byDateMap.set(dIso, entry);
    }

    const sortedDates = [...byDateMap.keys()].sort();
    let runningBalanceCents = 0;
    let runningRecoveredCents = 0;
    const dailyEvolution = sortedDates.slice(-45).map((iso) => {
      const row = byDateMap.get(iso)!;
      runningBalanceCents += row.openCents;
      runningRecoveredCents += row.recoveredCents;
      return {
        dateLabel: formatDueDateLocalBR(iso).slice(0, 5),
        fullDate: formatDueDateLocalBR(iso),
        saldoAcumuladoReais: Number((runningBalanceCents / 100).toFixed(2)),
        recuperadoAcumuladoReais: Number((runningRecoveredCents / 100).toFixed(2)),
      };
    });

    const stateMetrics: StateDebtRecoveryMetric[] = [...stateGroups.values()]
      .map((s) => {
        const gDenom = s.debtBalanceCents + s.recoveredTotalCents;
        const mDenom = s.monthDebtCents + s.monthRecoveredCents;
        return {
          uf: s.uf,
          clientsCount: s.clientIds.size,
          openTitlesCount: s.openTitlesCount,
          debtBalanceCents: s.debtBalanceCents,
          overdueDebtCents: s.overdueDebtCents,
          recoveredTotalCents: s.recoveredTotalCents,
          recoveryRatePct: gDenom > 0 ? (100 * s.recoveredTotalCents) / gDenom : 0,
          monthOpenCount: s.monthOpenCount,
          monthDebtCents: s.monthDebtCents,
          monthOverdueDebtCents: s.monthOverdueDebtCents,
          monthRecoveredCents: s.monthRecoveredCents,
          monthRecoveryRatePct: mDenom > 0 ? (100 * s.monthRecoveredCents) / mDenom : 0,
        };
      })
      .sort((a, b) => b.debtBalanceCents - a.debtBalanceCents);

    return {
      filteredActive,
      totalCount,
      overdueCount,
      defaultRate,
      totalBalanceCents,
      overdueBalanceCents,
      recoveredCents,
      recoveryRate,
      dsoDays,
      recalc: {
        originalCents: recalcOriginalCents,
        interestCents: recalcInterestCents,
        fineCents: recalcFineCents,
        discountCents: recalcDiscountCents,
        updatedCents: recalcUpdatedCents,
        receivedCents: recalcReceivedCents,
        balanceCents: recalcBalanceCents,
      },
      agingBuckets,
      dailyEvolution,
      collabPerformance: [...collabGroups.values()].sort((a, b) => b.balanceCents - a.balanceCents),
      stateMetrics,
      monthlyAccumulated: {
        month: refMonth,
        monthLabel: refMonth,
        monthDebtCents,
        monthOverdueDebtCents,
        monthRecoveredCents,
        monthRecoveryRatePct,
        monthOpenCount,
        monthSettledCount,
      },
    };
  }, [
    scopedPortfolioTitles,
    scopedPaidTitles,
    settlements,
    scopedTitleById,
    settledByTitleMap,
    clientMap,
    collabMap,
    dueFrom,
    dueTo,
    collaboratorFilter,
    refMonth,
    isAdmin,
  ]);

  const filterDescription = useMemo(() => {
    const parts = [operatorLabel];
    if (isAdmin && collaboratorFilter) {
      parts.push(
        collaboratorFilter === '__unassigned__'
          ? 'Sem Atribuição'
          : collabMap.get(Number(collaboratorFilter))?.name || collaboratorFilter
      );
    }
    if (dueFrom || dueTo) {
      parts.push(`Vencimento ${dueFrom || '...'} até ${dueTo || '...'}`);
    }
    return parts.join(' · ');
  }, [operatorLabel, isAdmin, collaboratorFilter, collabMap, dueFrom, dueTo]);

  const buildExportInput = () => ({
    totalCount: periodStats.totalCount,
    overdueCount: periodStats.overdueCount,
    defaultRate: periodStats.defaultRate,
    totalBalanceCents: periodStats.totalBalanceCents,
    overdueBalanceCents: periodStats.overdueBalanceCents,
    recoveredCents: periodStats.recoveredCents,
    recoveryRate: periodStats.recoveryRate,
    dsoDays: periodStats.dsoDays,
    agingBuckets: periodStats.agingBuckets.map((b) => ({
      label: b.label,
      count: b.count,
      balanceCents: b.balanceCents,
    })),
    collabPerformance: periodStats.collabPerformance,
    titles: periodStats.filteredActive,
    getClientName: (cId: number, fallback?: string) =>
      clientMap.get(cId)?.fullName || fallback || `Cliente #${cId}`,
    getCollaboratorName: (colId?: number | null) =>
      colId ? collabMap.get(colId)?.name || `#${colId}` : 'Sem atribuição',
    filterLabel: filterDescription,
    monthlyAccumulated: periodStats.monthlyAccumulated,
    stateMetrics: periodStats.stateMetrics,
  });

  return (
    <div className="space-y-5">
      {/* Barra de Filtros & Exportação */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">
              Vencimento De
            </label>
            <input
              type="date"
              value={dueFrom}
              onChange={(e) => setDueFrom(e.target.value)}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-mono tabular-nums text-slate-900"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">
              Vencimento Até
            </label>
            <input
              type="date"
              value={dueTo}
              onChange={(e) => setDueTo(e.target.value)}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-mono tabular-nums text-slate-900"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">
              Mês Referência
            </label>
            <input
              type="month"
              value={refMonth}
              onChange={(e) => setRefMonth(e.target.value)}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-mono tabular-nums text-slate-900"
            />
          </div>
          {isAdmin && (
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                Responsável
              </label>
              <select
                value={collaboratorFilter}
                onChange={(e) => setCollaboratorFilter(e.target.value)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900"
              >
                <option value="">Todos os Operadores</option>
                <option value="__unassigned__">Sem Atribuição</option>
                {collaborators.map((c) => (
                  <option key={c.id} value={String(c.id)}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {(dueFrom || dueTo || collaboratorFilter) && (
            <button
              type="button"
              onClick={() => {
                setDueFrom('');
                setDueTo('');
                setCollaboratorFilter('');
              }}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 whitespace-nowrap"
            >
              Limpar Filtros
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => exportDashboardSnapshotToExcel(buildExportInput())}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-700" />
            Exportar Excel
          </button>
          <button
            type="button"
            onClick={() => exportDashboardSnapshotToPdf(buildExportInput())}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 whitespace-nowrap"
          >
            <FileText className="w-3.5 h-3.5" />
            Exportar PDF
          </button>
        </div>
      </div>

      {/* Linha 1: 3 Cards de Hoje */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-medium text-slate-500">Vencendo Hoje ({formatDueDateLocalBR(todayIso)})</p>
          <p className="mt-1.5 font-mono text-xl font-bold text-slate-900 tabular-nums">
            {formatBRL(todayStats.dueTodayCents)}
          </p>
          <p className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
            {todayStats.dueTodayCount} título(s) com vencimento hoje
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-medium text-slate-500">Vencidos Acumulados</p>
          <p className="mt-1.5 font-mono text-xl font-bold text-red-600 tabular-nums">
            {formatBRL(todayStats.overdueAccumCents)}
          </p>
          <p className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
            {todayStats.overdueAccumCount} título(s) em atraso na carteira
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-medium text-slate-500">Baixas Registradas Hoje</p>
          <p className="mt-1.5 font-mono text-xl font-bold text-emerald-700 tabular-nums">
            {formatBRL(todayStats.settledTodayCents)}
          </p>
          <p className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
            {todayStats.settledTodayCount} liquidação(ões) confirmada(s) hoje
          </p>
        </div>
      </div>

      {/* Linha 2: 4 Cards Acumulados do Período */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-medium text-slate-500">Carteira Total em Aberto</p>
          <p className="mt-1.5 font-mono text-lg font-bold text-slate-900 tabular-nums">
            {formatBRL(periodStats.totalBalanceCents)}
          </p>
          <p className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
            {periodStats.totalCount} título(s) ativos no período
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-medium text-slate-500">Taxa de Recuperação</p>
          <p className="mt-1.5 font-mono text-lg font-bold text-emerald-700 tabular-nums">
            {periodStats.recoveryRate.toFixed(1)}%
          </p>
          <p className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
            Recuperado: {formatBRL(periodStats.recoveredCents)}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-medium text-slate-500">Taxa de Inadimplência</p>
          <p className="mt-1.5 font-mono text-lg font-bold text-red-600 tabular-nums">
            {periodStats.defaultRate.toFixed(1)}%
          </p>
          <p className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
            {periodStats.overdueCount} de {periodStats.totalCount} vencidos ({formatBRL(periodStats.overdueBalanceCents)})
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-medium text-slate-500">DSO (Prazo Médio de Recebimento)</p>
          <p className="mt-1.5 font-mono text-lg font-bold text-slate-900 tabular-nums">
            {periodStats.dsoDays} dias
          </p>
          <p className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
            Mês {refMonth}: {periodStats.monthlyAccumulated.monthRecoveryRatePct.toFixed(1)}% recup.
          </p>
        </div>
      </div>

      {/* Linha 3: Recálculo Financeiro da Carteira — Período Selecionado */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
          <h3 className="text-xs font-bold text-slate-900">
            Recálculo Financeiro da Carteira — Período Selecionado
          </h3>
          <span className="text-[11px] text-slate-500 font-mono tabular-nums">
            Certificado por financial_titles + title_settlements
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 text-xs">
          <div>
            <span className="text-slate-500 block">Valor Original</span>
            <span className="font-mono font-semibold text-slate-900 tabular-nums mt-0.5 block">
              {formatBRL(periodStats.recalc.originalCents)}
            </span>
          </div>
          <div>
            <span className="text-slate-500 block">(+) Juros</span>
            <span className="font-mono font-semibold text-slate-800 tabular-nums mt-0.5 block">
              {formatBRL(periodStats.recalc.interestCents)}
            </span>
          </div>
          <div>
            <span className="text-slate-500 block">(+) Multa</span>
            <span className="font-mono font-semibold text-slate-800 tabular-nums mt-0.5 block">
              {formatBRL(periodStats.recalc.fineCents)}
            </span>
          </div>
          <div>
            <span className="text-slate-500 block">(-) Descontos</span>
            <span className="font-mono font-semibold text-amber-700 tabular-nums mt-0.5 block">
              {formatBRL(periodStats.recalc.discountCents)}
            </span>
          </div>
          <div>
            <span className="text-slate-500 block">(=) Atualizado</span>
            <span className="font-mono font-semibold text-slate-900 tabular-nums mt-0.5 block">
              {formatBRL(periodStats.recalc.updatedCents)}
            </span>
          </div>
          <div>
            <span className="text-slate-500 block">(-) Recebido</span>
            <span className="font-mono font-semibold text-emerald-700 tabular-nums mt-0.5 block">
              {formatBRL(periodStats.recalc.receivedCents)}
            </span>
          </div>
          <div>
            <span className="text-slate-700 font-semibold block">(=) Saldo Devedor</span>
            <span className="font-mono font-bold text-red-600 tabular-nums mt-0.5 block">
              {formatBRL(periodStats.recalc.balanceCents)}
            </span>
          </div>
        </div>
      </div>

      {/* Linha 4: Faixa de Atraso (Clicável) + Evolução Diária */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-5 rounded-xl border border-slate-200 bg-white p-4 space-y-3">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
            <h3 className="text-xs font-bold text-slate-900">Carteira por Faixa de Atraso</h3>
            <span className="text-[11px] text-slate-500">Clique para filtrar na grade</span>
          </div>
          <div className="space-y-2.5">
            {periodStats.agingBuckets.map((b) => {
              const pct =
                periodStats.totalBalanceCents > 0
                  ? Math.min(100, (100 * b.balanceCents) / periodStats.totalBalanceCents)
                  : 0;
              return (
                <button
                  key={b.key}
                  type="button"
                  onClick={() => onSelectAgingBucket(b.key)}
                  className="w-full text-left rounded-lg border border-slate-100 p-2.5 hover:border-slate-300 hover:bg-slate-50/70 transition-colors"
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-800">{b.label}</span>
                    <span className="font-mono text-slate-900 font-semibold tabular-nums">
                      {formatBRL(b.balanceCents)}{' '}
                      <span className="text-slate-500 font-normal">({b.count})</span>
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className={`h-full ${b.barClass}`}
                      style={{ width: `${Math.max(pct, b.count > 0 ? 3 : 0)}%` }}
                    />
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="lg:col-span-7 rounded-xl border border-slate-200 bg-white p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2.5 mb-3">
            <h3 className="text-xs font-bold text-slate-900">
              Evolução Diária — Saldo Acumulado vs. Recuperado
            </h3>
            <span className="text-[11px] text-slate-500 font-mono tabular-nums">
              {periodStats.dailyEvolution.length} datas com movimentação
            </span>
          </div>

          {periodStats.dailyEvolution.length === 0 ? (
            <div className="h-64 flex items-center justify-center text-xs text-slate-500">
              Sem títulos no período selecionado para exibir a evolução diária.
            </div>
          ) : (
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={periodStats.dailyEvolution}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="dateLabel" tick={{ fontSize: 11, fill: '#64748b' }} />
                  <YAxis
                    tick={{ fontSize: 11, fill: '#64748b' }}
                    tickFormatter={(v: number) =>
                      `R$ ${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`
                    }
                  />
                  <Tooltip
                    formatter={(value, name) => [
                      formatBRL(Math.round(Number(value ?? 0) * 100)),
                      String(name) === 'saldoAcumuladoReais'
                        ? 'Saldo em Aberto Acum.'
                        : 'Recuperado Acum.',
                    ]}
                    labelFormatter={(_, payload) =>
                      payload?.[0]?.payload?.fullDate || 'Data'
                    }
                  />
                  <Area
                    type="monotone"
                    dataKey="saldoAcumuladoReais"
                    name="saldoAcumuladoReais"
                    stroke="#dc2626"
                    fill="#fee2e2"
                    strokeWidth={2}
                  />
                  <Area
                    type="monotone"
                    dataKey="recuperadoAcumuladoReais"
                    name="recuperadoAcumuladoReais"
                    stroke="#059669"
                    fill="#d1fae5"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
