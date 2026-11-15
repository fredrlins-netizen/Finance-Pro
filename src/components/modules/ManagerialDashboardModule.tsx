import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  AlertTriangle,
  ArrowUpRight,
  Bot,
  Briefcase,
  Building2,
  CalendarClock,
  FileSpreadsheet,
  FileText,
  Radio,
  RefreshCw,
  Scale,
  TrendingUp,
} from 'lucide-react';
import { apiFetch, formatBRL, formatDateTimeBR } from '../../lib/api.ts';
import {
  exportManagerialDashboardToExcel,
  exportManagerialDashboardToPdf,
} from '../../lib/managerialExport.ts';
import type {
  ManagerialDashboardPayload,
  ModuleId,
  NavigationIntent,
  Unit,
} from '../../types.ts';

interface ManagerialDashboardModuleProps {
  units: Unit[];
  activeUnitId: number;
  wsTick: number;
  onNavigate: (mod: ModuleId, intent?: NavigationIntent) => void;
}

const PERIOD_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 30, label: '30 dias' },
  { value: 90, label: '90 dias' },
  { value: 180, label: '180 dias' },
  { value: 365, label: '12 meses' },
];

const LEGAL_PIE_COLORS = ['#0f172a', '#d97706', '#dc2626', '#16a34a', '#64748b', '#94a3b8'];

function centsToReais(cents: number): number {
  return Number((Number(cents || 0) / 100).toFixed(2));
}

function formatCompactAxisBRL(value: number): string {
  const num = Number(value || 0);
  if (Math.abs(num) >= 1_000_000) return `R$${(num / 1_000_000).toFixed(1)}M`;
  if (Math.abs(num) >= 1_000) return `R$${(num / 1_000).toFixed(0)}k`;
  return `R$${num.toFixed(0)}`;
}

function formatTooltipBRL(val: unknown): string {
  const num = Number(val ?? 0);
  if (!Number.isFinite(num)) return String(val ?? '0');
  return num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatTooltipCount(val: unknown): string {
  const num = Number(val ?? 0);
  return Number.isFinite(num) ? num.toLocaleString('pt-BR') : String(val ?? '0');
}

function legalStatusClass(status: string): string {
  const s = String(status || '').toLowerCase();
  if (s === 'apreendido') return 'text-red-700 font-semibold';
  if (s === 'alerta_movimentacao') return 'text-amber-700 font-semibold';
  if (s === 'revertido') return 'text-emerald-700 font-semibold';
  if (s === 'suspenso' || s === 'cancelado') return 'text-slate-500';
  return 'text-slate-800';
}

export const ManagerialDashboardModule: React.FC<ManagerialDashboardModuleProps> = ({
  units,
  activeUnitId,
  wsTick,
  onNavigate,
}) => {
  const [unitScope, setUnitScope] = useState<'active' | 'all'>('all');
  const [periodDays, setPeriodDays] = useState<number>(90);
  const [data, setData] = useState<ManagerialDashboardPayload | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [exportingType, setExportingType] = useState<'pdf' | 'excel' | null>(null);
  const hasLoadedRef = useRef(false);

  const loadDashboard = useCallback(
    async (silent = false) => {
      if (!silent) {
        if (!hasLoadedRef.current) setLoading(true);
        else setRefreshing(true);
      } else {
        setRefreshing(true);
      }
      setError('');
      try {
        const res = await apiFetch<ManagerialDashboardPayload>(
          `/api/managerial-dashboard?unitScope=${unitScope}&days=${periodDays}`
        );
        setData(res);
        hasLoadedRef.current = true;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Falha ao carregar indicadores gerenciais.');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [unitScope, periodDays, activeUnitId]
  );

  useEffect(() => {
    loadDashboard(false);
  }, [loadDashboard]);

  // Real-time refresh when WebSocket events fire (wsTick)
  useEffect(() => {
    if (wsTick === 0 || !hasLoadedRef.current) return;
    const timer = window.setTimeout(() => {
      loadDashboard(true);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [wsTick, loadDashboard]);

  // Periodic live legal polling every 30s so "em tempo real" stays fresh even without WS push
  useEffect(() => {
    const interval = window.setInterval(() => {
      loadDashboard(true);
    }, 30000);
    return () => window.clearInterval(interval);
  }, [loadDashboard]);

  const handleExportPdf = () => {
    if (!data) return;
    setExportingType('pdf');
    try {
      exportManagerialDashboardToPdf(data);
    } finally {
      window.setTimeout(() => setExportingType(null), 350);
    }
  };

  const handleExportExcel = () => {
    if (!data) return;
    setExportingType('excel');
    try {
      exportManagerialDashboardToExcel(data);
    } finally {
      window.setTimeout(() => setExportingType(null), 350);
    }
  };

  const monthlyChartData = useMemo(() => {
    if (!data) return [];
    return data.collection.monthlyTrend.map((m) => ({
      name: m.monthLabel,
      Recebido: centsToReais(m.receivedCents),
      Vencido: centsToReais(m.overdueCents),
      'Em Aberto': centsToReais(m.openedCents),
      Baixas: m.recoveredCount,
    }));
  }, [data]);

  const agingChartData = useMemo(() => {
    if (!data) return [];
    return data.collection.agingBuckets.map((b) => ({
      name: b.label,
      Saldo: centsToReais(b.balanceCents),
      Titulos: b.count,
    }));
  }, [data]);

  const legalTimelineData = useMemo(() => {
    if (!data) return [];
    return data.legal.movementsTimeline.map((pt) => ({
      name: pt.dateLabel,
      'Webhook Escavador': pt.escavadorWebhook,
      'Fallback Escavador': pt.escavadorFallback,
      'Varredura Detran': pt.detranScan,
      Total: pt.total,
    }));
  }, [data]);

  const legalStatusPieData = useMemo(() => {
    if (!data) return [];
    return data.legal.byStatus.filter((s) => s.count > 0);
  }, [data]);

  const iviCapabilityChartData = useMemo(() => {
    if (!data) return [];
    return data.ivi.byCapability.map((cap) => ({
      name: cap.label,
      'Autônomo / Cache DB': cap.cacheOrSelfResolved,
      'Escalado / Manual': cap.escalatedOrManual,
      efficiencyPct: cap.efficiencyPct,
    }));
  }, [data]);

  const iviTimelineChartData = useMemo(() => {
    if (!data) return [];
    return data.ivi.efficiencyTimeline.map((pt) => ({
      name: pt.monthLabel,
      'Execuções IA': pt.aiExecutions,
      'Cache BD Economizado': pt.dbCacheHits,
      'Traduções Jurídicas': pt.legalTranslations,
      'Áudios Transcritos': pt.audioTranscripts,
    }));
  }, [data]);

  const activeUnitName = useMemo(() => {
    const u = units.find((item) => item.id === activeUnitId);
    return u ? `${u.code} · ${u.name}` : `Unidade #${activeUnitId}`;
  }, [units, activeUnitId]);

  if (loading && !data) {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="h-6 w-64 rounded bg-slate-100" />
          <div className="mt-2 h-4 w-96 rounded bg-slate-100" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((idx) => (
            <div key={idx} className="rounded-xl border border-slate-200 bg-white p-4 h-28">
              <div className="h-3 w-28 rounded bg-slate-100" />
              <div className="mt-4 h-6 w-36 rounded bg-slate-100" />
              <div className="mt-2 h-3 w-44 rounded bg-slate-100" />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          <div className="lg:col-span-7 rounded-xl border border-slate-200 bg-white p-5 h-80" />
          <div className="lg:col-span-5 rounded-xl border border-slate-200 bg-white p-5 h-80" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Executive Control Header */}
      <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold text-slate-500">
              <span className="text-slate-900">Governança Executiva</span>
              <span>·</span>
              <span>{data?.meta.unitLabel || activeUnitName}</span>
              <span>·</span>
              <span className="inline-flex items-center gap-1 text-emerald-700 font-mono tabular-nums">
                <Radio className="w-3 h-3" />
                Tempo real · {data ? formatDateTimeBR(data.meta.generatedAt) : '—'}
              </span>
            </div>
            <h1 className="font-display text-lg sm:text-xl font-bold text-slate-900 tracking-tight">
              Dashboard Gerencial · Cobrança, Jurídico & Eficiência Ivi
            </h1>
            <p className="text-xs text-slate-500 max-w-3xl">
              Consolidado analítico em tempo real baseado nos lançamentos financeiros, carteiras Escavador e telemetria automatizada da Ivi.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {/* Unit Scope Toggle */}
            <div className="inline-flex items-center rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setUnitScope('all')}
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 font-semibold whitespace-nowrap transition-colors ${
                  unitScope === 'all'
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Building2 className="w-3.5 h-3.5" />
                <span>Todas Unidades</span>
              </button>
              <button
                type="button"
                onClick={() => setUnitScope('active')}
                className={`rounded-md px-2.5 py-1.5 font-semibold whitespace-nowrap transition-colors ${
                  unitScope === 'active'
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Unidade Ativa
              </button>
            </div>

            {/* Period Selector */}
            <div className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs min-h-[36px]">
              <CalendarClock className="w-3.5 h-3.5 text-slate-500 shrink-0" />
              <select
                value={periodDays}
                onChange={(e) => setPeriodDays(Number(e.target.value))}
                aria-label="Período de análise"
                className="bg-transparent font-semibold text-slate-800 focus:outline-none"
              >
                {PERIOD_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    Últimos {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={() => loadDashboard(false)}
              disabled={refreshing}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60 whitespace-nowrap shrink-0 min-h-[36px]"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              <span>Atualizar</span>
            </button>

            <button
              type="button"
              onClick={handleExportExcel}
              disabled={!data || exportingType === 'excel'}
              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-50 whitespace-nowrap shrink-0 min-h-[36px]"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>{exportingType === 'excel' ? 'Gerando...' : 'Exportar Excel'}</span>
            </button>

            <button
              type="button"
              onClick={handleExportPdf}
              disabled={!data || exportingType === 'pdf'}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0 min-h-[36px]"
            >
              <FileText className="w-3.5 h-3.5" />
              <span>{exportingType === 'pdf' ? 'Gerando...' : 'Exportar PDF'}</span>
            </button>
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 flex items-center justify-between gap-3 text-xs text-red-800">
            <span className="flex items-center gap-2 font-medium">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              {error}
            </span>
            <button
              type="button"
              onClick={() => loadDashboard(false)}
              className="font-semibold underline whitespace-nowrap"
            >
              Tentar novamente
            </button>
          </div>
        )}
      </section>

      {data && (
        <>
          {/* Headline Executive KPI Grid */}
          <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-1.5">
              <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                <span>Recuperado ({data.meta.periodDays}d)</span>
                <TrendingUp className="w-4 h-4 text-emerald-600" />
              </div>
              <div className="font-mono text-2xl font-bold text-slate-900 tabular-nums">
                {formatBRL(data.kpis.recoveredPeriodCents)}
              </div>
              <div className="text-[11px] text-slate-500 font-mono tabular-nums">
                Taxa de recuperação: <strong className="text-emerald-700">{data.kpis.recoveryRatePct.toFixed(1)}%</strong>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-1.5">
              <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                <span>Carteira Ativa / Vencida</span>
                <Briefcase className="w-4 h-4 text-red-600" />
              </div>
              <div className="font-mono text-2xl font-bold text-slate-900 tabular-nums">
                {formatBRL(data.kpis.overdueBalanceCents)}
              </div>
              <div className="text-[11px] text-slate-500 font-mono tabular-nums">
                Inadimplência: <strong className="text-red-700">{data.kpis.defaultRatePct.toFixed(1)}%</strong> · Total {formatBRL(data.kpis.totalReceivableBalanceCents)}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-1.5">
              <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                <span>Jurídico em Tempo Real</span>
                <Scale className="w-4 h-4 text-amber-600" />
              </div>
              <div className="font-mono text-2xl font-bold text-slate-900 tabular-nums">
                {data.kpis.activeLegalProcesses} <span className="text-xs font-sans font-medium text-slate-500">ativos</span>
              </div>
              <div className="text-[11px] text-slate-500 font-mono tabular-nums">
                <strong className="text-amber-700">{data.kpis.unreadLegalMovements}</strong> mov. não lidas · <strong className="text-red-700">{data.kpis.seizureRiskProcesses}</strong> B&A
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-1.5">
              <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                <span>Eficiência da Ivi</span>
                <Bot className="w-4 h-4 text-blue-700" />
              </div>
              <div className="font-mono text-2xl font-bold text-slate-900 tabular-nums">
                {data.kpis.iviTotalInteractions.toLocaleString('pt-BR')} <span className="text-xs font-sans font-medium text-slate-500">ações</span>
              </div>
              <div className="text-[11px] text-slate-500 font-mono tabular-nums">
                <strong className="text-blue-700">{data.kpis.iviAiCallsSaved}</strong> chamadas IA economizadas ({data.ivi.summary.cacheHitRatioPct.toFixed(1)}% cache)
              </div>
            </div>
          </section>

          {/* SECTION 1: DESEMPENHO DE COBRANÇA */}
          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="font-display text-base font-bold text-slate-900">
                  1. Desempenho de Cobrança & Recuperação
                </h2>
                <p className="text-xs text-slate-500">
                  Evolução mensal de recebimentos e saldo vencido, distribuição por faixa de atraso e ranking de operadores.
                </p>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('collection_coordenacao')}
                className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:underline whitespace-nowrap"
              >
                <span>Abrir Cobrança Coordenação</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              {/* Monthly Trend Chart */}
              <div className="lg:col-span-7 rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex items-center justify-between gap-2 mb-3">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">Evolução Mensal: Recebido vs. Vencido</h3>
                    <p className="text-[11px] text-slate-500">Valores consolidados em R$ na carteira de recebíveis</p>
                  </div>
                  <div className="font-mono text-[11px] text-slate-500 tabular-nums">
                    {data.kpis.totalActiveTitles} títulos ativos
                  </div>
                </div>
                <div className="h-72 w-full min-w-0">
                  {monthlyChartData.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-xs text-slate-400">
                      Sem títulos ou baixas registradas para o período selecionado.
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={monthlyChartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                        <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={{ stroke: '#cbd5e1' }} tickLine={false} />
                        <YAxis tickFormatter={formatCompactAxisBRL} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} width={62} />
                        <Tooltip
                          formatter={(val, name) => [formatTooltipBRL(val), String(name || '')]}
                          contentStyle={{ borderRadius: 10, borderColor: '#e2e8f0', fontSize: 12 }}
                        />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <Bar dataKey="Recebido" fill="#16a34a" radius={[4, 4, 0, 0]} maxBarSize={28} />
                        <Bar dataKey="Vencido" fill="#dc2626" radius={[4, 4, 0, 0]} maxBarSize={28} />
                        <Line type="monotone" dataKey="Em Aberto" stroke="#2563eb" strokeWidth={2} dot={{ r: 3 }} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>

              {/* Aging Buckets Chart + Status Split */}
              <div className="lg:col-span-5 rounded-xl border border-slate-200 bg-white p-4 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <div>
                      <h3 className="text-sm font-bold text-slate-900">Aging de Inadimplência</h3>
                      <p className="text-[11px] text-slate-500">Distribuição do saldo em aberto por faixa de dias</p>
                    </div>
                  </div>
                  <div className="h-56 w-full min-w-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={agingChartData} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                        <XAxis type="number" tickFormatter={formatCompactAxisBRL} tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} />
                        <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: '#334155' }} width={76} axisLine={false} tickLine={false} />
                        <Tooltip
                          formatter={(val, name) =>
                            name === 'Saldo' ? [formatTooltipBRL(val), 'Saldo'] : [formatTooltipCount(val), 'Títulos']
                          }
                          contentStyle={{ borderRadius: 10, borderColor: '#e2e8f0', fontSize: 12 }}
                        />
                        <Bar dataKey="Saldo" fill="#0f172a" radius={[0, 4, 4, 0]} barSize={18} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Status breakdown inline table */}
                <div className="mt-3 pt-3 border-t border-slate-100 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                  {data.collection.statusBreakdown.map((st) => (
                    <div key={st.status} className="flex items-center justify-between gap-2">
                      <span className="text-slate-600 truncate">
                        {st.label} <span className="font-mono text-[10px] text-slate-400">({st.count})</span>
                      </span>
                      <span className="font-mono font-semibold text-slate-900 tabular-nums shrink-0">
                        {formatBRL(st.balanceCents)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Operator Ranking Table */}
            <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-2">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600">
                  Desempenho por Operador de Cobrança
                </h3>
                <span className="text-[11px] font-mono text-slate-400 tabular-nums">
                  Top {data.collection.operatorRanking.length} responsáveis
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                    <tr>
                      <th className="text-left font-semibold px-4 py-2.5">Operador</th>
                      <th className="text-right font-semibold px-3 py-2.5">Títulos</th>
                      <th className="text-right font-semibold px-3 py-2.5">Baixas</th>
                      <th className="text-right font-semibold px-3 py-2.5">Recuperado</th>
                      <th className="text-right font-semibold px-3 py-2.5">Saldo Aberto</th>
                      <th className="text-right font-semibold px-3 py-2.5">Saldo Vencido</th>
                      <th className="text-right font-semibold px-3 py-2.5">Notas</th>
                      <th className="text-right font-semibold px-4 py-2.5">Ranking Pts</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.collection.operatorRanking.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="px-4 py-6 text-center text-slate-400">
                          Nenhum operador atribuído aos títulos desta carteira até o momento.
                        </td>
                      </tr>
                    ) : (
                      data.collection.operatorRanking.map((op) => (
                        <tr key={op.name} className="hover:bg-slate-50/70">
                          <td className="px-4 py-2.5 font-semibold text-slate-900">{op.name}</td>
                          <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-700">{op.titlesCount}</td>
                          <td className="px-3 py-2.5 text-right font-mono tabular-nums text-emerald-700 font-semibold">{op.paidCount}</td>
                          <td className="px-3 py-2.5 text-right font-mono tabular-nums text-emerald-700 font-semibold">
                            {formatBRL(op.recoveredCents)}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-700">
                            {formatBRL(op.openBalanceCents)}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono tabular-nums text-red-700">
                            {formatBRL(op.overdueBalanceCents)}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-600">{op.notesCount}</td>
                          <td className="px-4 py-2.5 text-right font-mono tabular-nums font-bold text-slate-900">
                            {op.points}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          {/* SECTION 2: VOLUME DE PROCESSOS JURÍDICOS EM TEMPO REAL */}
          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="font-display text-base font-bold text-slate-900">
                  2. Volume de Processos Jurídicos em Tempo Real
                </h2>
                <p className="text-xs text-slate-500 font-mono tabular-nums">
                  {data.legal.summary.totalProcesses} processos · {data.legal.summary.escavadorMonitored} monitorados no Escavador · {data.legal.summary.vehicleSeizedCount} veículos apreendidos · Tempo médio leitura {data.legal.summary.avgResponseHours}h
                </p>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('legal')}
                className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:underline whitespace-nowrap"
              >
                <span>Abrir Jurídico & Escavador</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              {/* Real-time Movements Volume AreaChart */}
              <div className="lg:col-span-7 rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex items-center justify-between gap-2 mb-3">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">Fluxo Diário de Movimentações (Escavador & Detran)</h3>
                    <p className="text-[11px] text-slate-500">Atualização automática via eventos WebSocket em tempo real</p>
                  </div>
                  <span className="font-mono text-[11px] text-emerald-700 font-semibold tabular-nums">
                    Ao vivo
                  </span>
                </div>
                <div className="h-72 w-full min-w-0">
                  {legalTimelineData.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-xs text-slate-400">
                      Nenhuma movimentação capturada na janela recente.
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={legalTimelineData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                        <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={{ stroke: '#cbd5e1' }} tickLine={false} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} width={36} />
                        <Tooltip
                          formatter={(val, name) => [formatTooltipCount(val), String(name || '')]}
                          contentStyle={{ borderRadius: 10, borderColor: '#e2e8f0', fontSize: 12 }}
                        />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <Area type="monotone" dataKey="Webhook Escavador" stackId="1" stroke="#0f172a" fill="#0f172a" fillOpacity={0.22} />
                        <Area type="monotone" dataKey="Fallback Escavador" stackId="1" stroke="#2563eb" fill="#2563eb" fillOpacity={0.2} />
                        <Area type="monotone" dataKey="Varredura Detran" stackId="1" stroke="#d97706" fill="#d97706" fillOpacity={0.2} />
                      </AreaChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>

              {/* Legal Status Pie + Courts Distribution */}
              <div className="lg:col-span-5 rounded-xl border border-slate-200 bg-white p-4 flex flex-col justify-between">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Carteira Processual por Status</h3>
                  <p className="text-[11px] text-slate-500 mb-2">Situação atual e incidência por tribunal</p>
                  <div className="h-48 w-full min-w-0">
                    {legalStatusPieData.length === 0 ? (
                      <div className="h-full flex items-center justify-center text-xs text-slate-400">
                        Nenhum processo cadastrado neste escopo.
                      </div>
                    ) : (
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={legalStatusPieData}
                            dataKey="count"
                            nameKey="label"
                            cx="50%"
                            cy="50%"
                            innerRadius={42}
                            outerRadius={70}
                            paddingAngle={2}
                          >
                            {legalStatusPieData.map((entry, idx) => (
                              <Cell key={entry.status} fill={LEGAL_PIE_COLORS[idx % LEGAL_PIE_COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip
                            formatter={(val, name) => [formatTooltipCount(val), String(name || '')]}
                            contentStyle={{ borderRadius: 10, borderColor: '#e2e8f0', fontSize: 12 }}
                          />
                          <Legend wrapperStyle={{ fontSize: 11 }} />
                        </PieChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </div>

                {/* Top Courts */}
                <div className="mt-2 pt-3 border-t border-slate-100 space-y-1.5">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    Principais Tribunais / Comarcas
                  </div>
                  {data.legal.byCourt.slice(0, 4).map((c) => (
                    <div key={c.courtName} className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-slate-700 truncate">{c.courtName}</span>
                      <span className="font-mono text-[11px] text-slate-900 tabular-nums shrink-0">
                        {c.count} proc. · {c.searchSeizureCount} B&A
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Real-time Legal Feed */}
            <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-2">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600">
                  Últimas Movimentações Escavador & Alertas Jurídicos
                </h3>
                <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                  {data.legal.recentLiveFeed.length} eventos recentes
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                    <tr>
                      <th className="text-left font-semibold px-4 py-2.5">Processo / Cliente</th>
                      <th className="text-left font-semibold px-3 py-2.5">Tribunal</th>
                      <th className="text-left font-semibold px-3 py-2.5">Status</th>
                      <th className="text-left font-semibold px-3 py-2.5">Resumo Traduzido (Ivi)</th>
                      <th className="text-right font-semibold px-3 py-2.5">Data</th>
                      <th className="text-right font-semibold px-4 py-2.5">Ação</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.legal.recentLiveFeed.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
                          Sem movimentações jurídicas registradas até o momento.
                        </td>
                      </tr>
                    ) : (
                      data.legal.recentLiveFeed.slice(0, 8).map((item) => (
                        <tr key={item.id} className="hover:bg-slate-50/70">
                          <td className="px-4 py-2.5">
                            <div className="font-mono font-semibold text-slate-900">{item.processNumber}</div>
                            <div className="text-[11px] text-slate-500 truncate max-w-[220px]">{item.clientName}</div>
                          </td>
                          <td className="px-3 py-2.5 text-slate-700">{item.courtName}</td>
                          <td className={`px-3 py-2.5 ${legalStatusClass(item.status)}`}>
                            {item.status.replace(/_/g, ' ')}
                            {item.hasSearchSeizure && (
                              <span className="block text-[10px] text-red-600 font-semibold">Busca & Apreensão</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-slate-600 max-w-md">
                            <div className="line-clamp-2">{item.iviTranslationPtBr || item.originalDispatch}</div>
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono text-[11px] text-slate-500 tabular-nums whitespace-nowrap">
                            {formatDateTimeBR(item.createdAt)}
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <button
                              type="button"
                              onClick={() => onNavigate('legal', { processId: item.processId })}
                              className="text-xs font-semibold text-blue-700 hover:underline whitespace-nowrap"
                            >
                              Ver Processo
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          {/* SECTION 3: EFICIÊNCIA DA IVI */}
          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="font-display text-base font-bold text-slate-900">
                  3. Eficiência Operacional da Ivi IA
                </h2>
                <p className="text-xs text-slate-500 font-mono tabular-nums">
                  {data.ivi.summary.auditSweepsCount} auditorias · {data.ivi.summary.legalTranslationsCount} traduções Escavador · {data.ivi.summary.prospectionLeadsHandled} leads triados (escalonamento humano {data.ivi.summary.humanEscalationRatePct.toFixed(1)}%) · {data.ivi.summary.audioTranscriptionsCount} áudios · {data.ivi.summary.savedReportsCount} relatórios salvos
                </p>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('audit')}
                className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:underline whitespace-nowrap"
              >
                <span>Ver Auditoria Ivi</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              {/* Capability Comparison BarChart */}
              <div className="lg:col-span-7 rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex items-center justify-between gap-2 mb-3">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">Autonomia & Reuso por Frente Operacional</h3>
                    <p className="text-[11px] text-slate-500">
                      Comparativo entre resoluções autônomas/cache em banco vs. intervenção manual/escalada
                    </p>
                  </div>
                </div>
                <div className="h-72 w-full min-w-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={iviCapabilityChartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                      <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#475569' }} axisLine={{ stroke: '#cbd5e1' }} tickLine={false} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} width={36} />
                      <Tooltip
                        formatter={(val, name) => [formatTooltipCount(val), String(name || '')]}
                        contentStyle={{ borderRadius: 10, borderColor: '#e2e8f0', fontSize: 12 }}
                      />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar dataKey="Autônomo / Cache DB" stackId="a" fill="#2563eb" radius={[0, 0, 0, 0]} maxBarSize={36} />
                      <Bar dataKey="Escalado / Manual" stackId="a" fill="#cbd5e1" radius={[4, 4, 0, 0]} maxBarSize={36} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Ivi Cache & AI Timeline */}
              <div className="lg:col-span-5 rounded-xl border border-slate-200 bg-white p-4 flex flex-col justify-between">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Produtividade Mensal & Economia Cache BD</h3>
                  <p className="text-[11px] text-slate-500 mb-3">
                    Execuções de IA, reuso em base local (zero custo IA) e traduções jurídicas
                  </p>
                  <div className="h-56 w-full min-w-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={iviTimelineChartData} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                        <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={{ stroke: '#cbd5e1' }} tickLine={false} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} width={32} />
                        <Tooltip
                          formatter={(val, name) => [formatTooltipCount(val), String(name || '')]}
                          contentStyle={{ borderRadius: 10, borderColor: '#e2e8f0', fontSize: 12 }}
                        />
                        <Legend wrapperStyle={{ fontSize: 10 }} />
                        <Area type="monotone" dataKey="Execuções IA" stroke="#2563eb" fill="#2563eb" fillOpacity={0.18} />
                        <Area type="monotone" dataKey="Cache BD Economizado" stroke="#16a34a" fill="#16a34a" fillOpacity={0.22} />
                        <Area type="monotone" dataKey="Traduções Jurídicas" stroke="#0f172a" fill="#0f172a" fillOpacity={0.12} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Audit Verdicts & Providers */}
                <div className="mt-3 pt-3 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                      Vereditos Auditoria Ivi
                    </div>
                    {data.ivi.auditVerdicts.length === 0 ? (
                      <div className="text-slate-400 text-[11px]">Sem varreduras registradas</div>
                    ) : (
                      data.ivi.auditVerdicts.map((v) => (
                        <div key={v.verdict} className="flex items-center justify-between py-0.5">
                          <span className="text-slate-600 truncate">{v.label}</span>
                          <span className="font-mono font-semibold text-slate-900 tabular-nums">{v.count}</span>
                        </div>
                      ))
                    )}
                  </div>
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                      Motores Orquestração
                    </div>
                    {data.ivi.providerUsage.length === 0 ? (
                      <div className="text-slate-400 text-[11px]">Aguardando uso IA</div>
                    ) : (
                      data.ivi.providerUsage.slice(0, 4).map((p) => (
                        <div key={p.provider} className="flex items-center justify-between py-0.5">
                          <span className="text-slate-600 truncate">{p.provider}</span>
                          <span className="font-mono font-semibold text-slate-900 tabular-nums">{p.count}</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
};
