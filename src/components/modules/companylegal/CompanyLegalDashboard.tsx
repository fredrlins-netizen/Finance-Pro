import React, { useMemo } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  DollarSign,
  Gavel,
  Scale,
  ShieldAlert,
} from 'lucide-react';
import type {
  CollaboratorItem,
  CompanyLegalProcess,
  Unit,
} from '../../../types.ts';
import {
  formatDateBR,
  formatMoneyBRL,
  getUnitDisplayName,
  parseCurrencyToNumber,
  PROCESS_TYPES,
  RISK_BADGE_MAP,
  STATUS_BADGE_MAP,
} from './shared.ts';

interface CompanyLegalDashboardProps {
  processes: CompanyLegalProcess[];
  units: Unit[];
  collaborators: CollaboratorItem[];
  loading: boolean;
}

function getUrgencyBadge(dateStr: string): { label: string; cls: string } {
  const target = new Date(dateStr);
  if (Number.isNaN(target.getTime())) {
    return { label: '-', cls: 'bg-slate-100 text-slate-600 border-slate-200' };
  }
  const now = new Date();
  const diffDays = Math.ceil((target.getTime() - now.getTime()) / 86_400_000);
  if (diffDays < 0) {
    return { label: `Vencido (${Math.abs(diffDays)}d)`, cls: 'bg-red-50 text-red-700 border-red-200 font-bold dark:bg-red-950/60 dark:text-red-300 dark:border-red-800/70' };
  }
  if (diffDays < 3) {
    return { label: `${diffDays}d`, cls: 'bg-red-50 text-red-700 border-red-200 font-bold dark:bg-red-950/60 dark:text-red-300 dark:border-red-800/70' };
  }
  if (diffDays <= 7) {
    return { label: `${diffDays}d`, cls: 'bg-amber-50 text-amber-800 border-amber-200 font-semibold dark:bg-amber-950/60 dark:text-amber-200 dark:border-amber-800/70' };
  }
  return { label: `${diffDays}d`, cls: 'bg-emerald-50 text-emerald-700 border-emerald-200 font-medium dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800/70' };
}

export const CompanyLegalDashboard: React.FC<CompanyLegalDashboardProps> = ({
  processes,
  units,
  collaborators,
  loading,
}) => {
  const stats = useMemo(() => {
    const now = new Date();
    const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const activeProcesses = processes.filter((p) => p.status === 'ATIVO');

    let deadlinesNext7Days = 0;
    let hearingsNext7Days = 0;
    let totalProvisionValue = 0;

    const riskCounts: Record<'BAIXO' | 'MEDIO' | 'ALTO' | 'CRITICO', number> = {
      BAIXO: 0,
      MEDIO: 0,
      ALTO: 0,
      CRITICO: 0,
    };

    const upcomingDeadlines: Array<{
      id: string | number;
      processNumber: string;
      description: string;
      dueDate: string;
      responsibleId?: number | null;
    }> = [];

    const upcomingHearings: Array<{
      id: string | number;
      processNumber: string;
      date: string;
      time: string;
      type: string;
      location?: string;
    }> = [];

    for (const p of processes) {
      totalProvisionValue += parseCurrencyToNumber(p.provisionValue);

      if (p.status === 'ATIVO' && p.riskLevel in riskCounts) {
        riskCounts[p.riskLevel as keyof typeof riskCounts] += 1;
      }

      for (const dl of p.deadlines || []) {
        if (dl.status === 'PENDENTE') {
          upcomingDeadlines.push({
            id: dl.id,
            processNumber: p.processNumber,
            description: dl.description,
            dueDate: dl.dueDate,
            responsibleId:
              dl.responsibleId !== null && dl.responsibleId !== undefined
                ? Number(dl.responsibleId)
                : null,
          });
          const d = new Date(dl.dueDate);
          if (!Number.isNaN(d.getTime()) && d >= now && d <= in7Days) {
            deadlinesNext7Days += 1;
          }
        }
      }

      for (const hr of p.hearings || []) {
        if (hr.status === 'AGENDADA') {
          const d = new Date(hr.date);
          if (!Number.isNaN(d.getTime()) && d >= now) {
            upcomingHearings.push({
              id: hr.id,
              processNumber: p.processNumber,
              date: hr.date,
              time: hr.time,
              type: hr.type,
              location: hr.location,
            });
            if (d <= in7Days) {
              hearingsNext7Days += 1;
            }
          }
        }
      }
    }

    upcomingDeadlines.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    upcomingHearings.sort((a, b) => a.date.localeCompare(b.date));

    // Distributions
    const typeCountsMap = new Map<string, number>();
    const statusCountsMap = new Map<string, number>();
    const unitCountsMap = new Map<string, number>();

    for (const p of processes) {
      const tKey = p.type || 'OUTRO';
      typeCountsMap.set(tKey, (typeCountsMap.get(tKey) || 0) + 1);

      const sKey = p.status || 'ATIVO';
      statusCountsMap.set(sKey, (statusCountsMap.get(sKey) || 0) + 1);

      const unitObj = p.unitId ? units.find((u) => u.id === p.unitId) : undefined;
      const uName = getUnitDisplayName(unitObj);
      unitCountsMap.set(uName, (unitCountsMap.get(uName) || 0) + 1);
    }

    const typeDist = Array.from(typeCountsMap.entries())
      .map(([type, count]) => ({
        type,
        label: PROCESS_TYPES.find((pt) => pt.value === type)?.label || type,
        count,
      }))
      .sort((a, b) => b.count - a.count);

    const statusDist = Array.from(statusCountsMap.entries())
      .map(([status, count]) => ({
        status,
        label: STATUS_BADGE_MAP[status]?.label || status,
        colorHex: STATUS_BADGE_MAP[status]?.colorHex || '#94a3b8',
        count,
      }))
      .sort((a, b) => b.count - a.count);

    const unitDist = Array.from(unitCountsMap.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    return {
      activeCount: activeProcesses.length,
      deadlinesNext7Days,
      hearingsNext7Days,
      totalProvisionValue,
      riskCounts,
      upcomingDeadlines: upcomingDeadlines.slice(0, 10),
      upcomingHearings: upcomingHearings.slice(0, 10),
      typeDist,
      statusDist,
      unitDist,
      totalProcesses: processes.length,
    };
  }, [processes, units]);

  const maxTypeCount = Math.max(1, ...stats.typeDist.map((d) => d.count));
  const maxUnitCount = Math.max(1, ...stats.unitDist.map((d) => d.count));

  // SVG Donut calculation
  const donutSegments = useMemo(() => {
    const total = stats.totalProcesses;
    if (total === 0) return [];
    const radius = 52;
    const circumference = 2 * Math.PI * radius;
    let accumulated = 0;
    return stats.statusDist.map((item) => {
      const fraction = item.count / total;
      const strokeLength = fraction * circumference;
      const offset = -accumulated;
      accumulated += strokeLength;
      return {
        ...item,
        dashArray: `${strokeLength} ${circumference - strokeLength}`,
        dashOffset: offset,
      };
    });
  }, [stats]);

  if (loading && processes.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
        Carregando indicadores do Dashboard Jurídico...
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <h2 className="font-display text-lg font-bold text-slate-900 flex items-center gap-2 dark:text-slate-100">
            <Scale className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            Dashboard Jurídico
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">Visão geral do acompanhamento de processos da empresa</p>
        </div>
        <div className="text-xs text-slate-500 font-medium tabular-nums dark:text-slate-400">
          Total cadastrado: <strong className="text-slate-900 dark:text-slate-100">{stats.totalProcesses}</strong> processo(s)
        </div>
      </div>

      {/* 5 KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4 flex flex-col justify-between dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>Processos Ativos</span>
            <Scale className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          </div>
          <div className="mt-2 font-mono text-2xl font-bold text-slate-900 tabular-nums dark:text-slate-100">
            {stats.activeCount}
          </div>
          <div className="mt-1 text-[11px] text-slate-400 dark:text-slate-400">Status ATIVO</div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 flex flex-col justify-between dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>Prazos Vencendo (7d)</span>
            <CalendarClock className="w-4 h-4 text-amber-600 dark:text-amber-400" />
          </div>
          <div className="mt-2 font-mono text-2xl font-bold text-amber-700 tabular-nums dark:text-amber-300">
            {stats.deadlinesNext7Days}
          </div>
          <div className="mt-1 text-[11px] text-slate-400 dark:text-slate-400">Pendentes nos próximos 7 dias</div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 flex flex-col justify-between dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>Audiências Próximas (7d)</span>
            <Gavel className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div className="mt-2 font-mono text-2xl font-bold text-emerald-700 tabular-nums dark:text-emerald-300">
            {stats.hearingsNext7Days}
          </div>
          <div className="mt-1 text-[11px] text-slate-400 dark:text-slate-400">Agendadas em 7 dias</div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 flex flex-col justify-between dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>Valor Provisionado</span>
            <DollarSign className="w-4 h-4 text-slate-600 dark:text-slate-300" />
          </div>
          <div className="mt-2 font-mono text-xl font-bold text-slate-900 tabular-nums truncate dark:text-slate-100" title={formatMoneyBRL(stats.totalProvisionValue)}>
            {formatMoneyBRL(stats.totalProvisionValue)}
          </div>
          <div className="mt-1 text-[11px] text-slate-400 dark:text-slate-400">Soma global provisionada</div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 flex flex-col justify-between dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>Risco (Ativos)</span>
            <ShieldAlert className="w-4 h-4 text-red-600 dark:text-red-400" />
          </div>
          {stats.activeCount === 0 ? (
            <div className="mt-2 text-xs text-slate-400 dark:text-slate-400">Nenhum processo ativo</div>
          ) : (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {(['CRITICO', 'ALTO', 'MEDIO', 'BAIXO'] as const).map((lvl) => {
                const count = stats.riskCounts[lvl];
                if (count <= 0) return null;
                const meta = RISK_BADGE_MAP[lvl];
                return (
                  <span
                    key={lvl}
                    className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${meta.badgeClass}`}
                  >
                    {meta.label}: {count}
                  </span>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* 3 Distribution Panels */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Processos por Tipo */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3 dark:border-slate-700 dark:bg-slate-900">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
            Processos por Tipo
          </h3>
          {stats.typeDist.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-400 dark:text-slate-400">Nenhum dado disponível</div>
          ) : (
            <div className="space-y-2.5">
              {stats.typeDist.map((row) => (
                <div key={row.type} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-slate-700 dark:text-slate-200">{row.label}</span>
                    <span className="font-mono font-bold text-slate-900 tabular-nums dark:text-slate-100">{row.count}</span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden dark:bg-slate-800">
                    <div
                      className="h-full rounded-full bg-slate-800 transition-all"
                      style={{ width: `${Math.max(8, (row.count / maxTypeCount) * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Processos por Status (Donut SVG) */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3 dark:border-slate-700 dark:bg-slate-900">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
            Processos por Status
          </h3>
          {stats.totalProcesses === 0 ? (
            <div className="py-8 text-center text-xs text-slate-400 dark:text-slate-400">Nenhum dado disponível</div>
          ) : (
            <div className="flex items-center gap-4">
              <div className="relative w-32 h-32 shrink-0 flex items-center justify-center">
                <svg viewBox="0 0 130 130" className="w-32 h-32 -rotate-90">
                  <circle cx="65" cy="65" r="52" fill="none" stroke="#f1f5f9" strokeWidth="14" />
                  {donutSegments.map((seg) => (
                    <circle
                      key={seg.status}
                      cx="65"
                      cy="65"
                      r="52"
                      fill="none"
                      stroke={seg.colorHex}
                      strokeWidth="14"
                      strokeDasharray={seg.dashArray}
                      strokeDashoffset={seg.dashOffset}
                    />
                  ))}
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <span className="font-mono text-xl font-bold text-slate-900 tabular-nums dark:text-slate-100">
                    {stats.totalProcesses}
                  </span>
                  <span className="text-[10px] font-semibold uppercase text-slate-400 dark:text-slate-400">Total</span>
                </div>
              </div>
              <div className="flex-1 space-y-1.5 min-w-0">
                {stats.statusDist.map((item) => (
                  <div key={item.status} className="flex items-center justify-between gap-2 text-xs">
                    <span className="flex items-center gap-2 min-w-0">
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: item.colorHex }}
                      />
                      <span className="truncate text-slate-700 dark:text-slate-200">{item.label}</span>
                    </span>
                    <span className="font-mono font-bold text-slate-900 tabular-nums dark:text-slate-100">{item.count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Processos por Unidade */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3 dark:border-slate-700 dark:bg-slate-900">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
            Processos por Unidade
          </h3>
          {stats.unitDist.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-400 dark:text-slate-400">Nenhum dado disponível</div>
          ) : (
            <div className="space-y-2.5">
              {stats.unitDist.map((row) => (
                <div key={row.name} className="space-y-1">
                  <div className="flex items-center justify-between text-xs gap-2">
                    <span className="font-medium text-slate-700 truncate dark:text-slate-200">{row.name}</span>
                    <span className="font-mono font-bold text-slate-900 tabular-nums shrink-0 dark:text-slate-100">{row.count}</span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden dark:bg-slate-800">
                    <div
                      className="h-full rounded-full bg-emerald-600 transition-all"
                      style={{ width: `${Math.max(8, (row.count / maxUnitCount) * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 2 Lower Tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Próximos Prazos */}
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden dark:border-slate-700 dark:bg-slate-900">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between bg-slate-50/70 dark:border-slate-800 dark:bg-slate-800/60">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5 dark:text-slate-200">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
              Próximos Prazos (Top 10 Pendentes)
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] font-semibold text-slate-500 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-400">
                  <th className="px-3 py-2">Processo</th>
                  <th className="px-3 py-2">Descrição</th>
                  <th className="px-3 py-2">Data</th>
                  <th className="px-3 py-2">Responsável</th>
                  <th className="px-3 py-2 text-right">Prazo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {stats.upcomingDeadlines.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-slate-400 dark:text-slate-400">
                      Nenhum prazo pendente
                    </td>
                  </tr>
                ) : (
                  stats.upcomingDeadlines.map((dl) => {
                    const resp = dl.responsibleId
                      ? collaborators.find((c) => c.id === dl.responsibleId)?.name || '—'
                      : '—';
                    const urg = getUrgencyBadge(dl.dueDate);
                    return (
                      <tr key={String(dl.id)} className="hover:bg-slate-50/70 dark:hover:bg-slate-800">
                        <td className="px-3 py-2 font-mono text-[11px] text-slate-800 whitespace-nowrap dark:text-slate-100">
                          {dl.processNumber}
                        </td>
                        <td className="px-3 py-2 max-w-[180px] truncate text-slate-700 dark:text-slate-200" title={dl.description}>
                          {dl.description}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap tabular-nums text-slate-600 dark:text-slate-300">
                          {formatDateBR(dl.dueDate)}
                        </td>
                        <td className="px-3 py-2 truncate max-w-[110px] text-slate-600 dark:text-slate-300">{resp}</td>
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          <span className={`inline-block rounded border px-1.5 py-0.5 text-[10px] tabular-nums ${urg.cls}`}>
                            {urg.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Próximas Audiências */}
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden dark:border-slate-700 dark:bg-slate-900">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between bg-slate-50/70 dark:border-slate-800 dark:bg-slate-800/60">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5 dark:text-slate-200">
              <Gavel className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
              Próximas Audiências (Top 10 Agendadas)
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] font-semibold text-slate-500 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-400">
                  <th className="px-3 py-2">Processo</th>
                  <th className="px-3 py-2">Data/Hora</th>
                  <th className="px-3 py-2">Tipo</th>
                  <th className="px-3 py-2">Local</th>
                  <th className="px-3 py-2 text-right">Prazo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {stats.upcomingHearings.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-slate-400 dark:text-slate-400">
                      Nenhuma audiência agendada
                    </td>
                  </tr>
                ) : (
                  stats.upcomingHearings.map((hr) => {
                    const urg = getUrgencyBadge(hr.date);
                    return (
                      <tr key={String(hr.id)} className="hover:bg-slate-50/70 dark:hover:bg-slate-800">
                        <td className="px-3 py-2 font-mono text-[11px] text-slate-800 whitespace-nowrap dark:text-slate-100">
                          {hr.processNumber}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap tabular-nums text-slate-700 dark:text-slate-200">
                          {formatDateBR(hr.date)} {hr.time ? `às ${hr.time}` : ''}
                        </td>
                        <td className="px-3 py-2 text-slate-700 dark:text-slate-200">{hr.type}</td>
                        <td className="px-3 py-2 max-w-[140px] truncate text-slate-600 dark:text-slate-300" title={hr.location || '—'}>
                          {hr.location || '—'}
                        </td>
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          <span className={`inline-block rounded border px-1.5 py-0.5 text-[10px] tabular-nums ${urg.cls}`}>
                            {urg.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};
