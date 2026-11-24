import React, { useMemo } from 'react';
import { Target } from 'lucide-react';
import { formatBRL } from '../../../lib/api.ts';
import type { CollaboratorItem, Negotiation, NegotiationGoal } from '../../../types.ts';

interface PerformanceMetricsContainerProps {
  negotiations: Negotiation[];
  collaborators: CollaboratorItem[];
  goals: NegotiationGoal[];
  perfCollaboratorFilter: string;
  onPerfCollaboratorFilterChange: (val: string) => void;
  onSelectNegotiation: (id: number) => void;
}

export const PerformanceMetricsContainer: React.FC<PerformanceMetricsContainerProps> = ({
  negotiations,
  collaborators,
  goals,
  perfCollaboratorFilter,
  onPerfCollaboratorFilterChange,
  onSelectNegotiation,
}) => {
  const perfNegs = useMemo(
    () =>
      negotiations.filter((n) =>
        perfCollaboratorFilter === 'TODOS'
          ? true
          : String(n.collaboratorId) === perfCollaboratorFilter || n.collaboratorName === perfCollaboratorFilter
      ),
    [negotiations, perfCollaboratorFilter]
  );

  const byCollab = useMemo(() => {
    return collaborators.map((col) => {
      const colNegs = negotiations.filter((n) => n.collaboratorId === col.id || n.collaboratorName === col.name);
      const colClosed = colNegs.filter((n) => n.negotiationStatus === 'ACORDO_FECHADO');
      const colSavings = colClosed.reduce((s, n) => s + (n.estimatedSavingsCents || 0), 0);
      const goal = goals.find((g) => g.collaboratorId === col.id);
      const pctCount =
        goal && goal.targetCount > 0 ? Math.min(100, Math.round((colClosed.length / goal.targetCount) * 100)) : 0;
      const pctVal =
        goal && goal.targetSavingsCents > 0
          ? Math.min(100, Math.round((colSavings / goal.targetSavingsCents) * 100))
          : 0;
      return { col, total: colNegs.length, closedCount: colClosed.length, colSavings, goal, pctCount, pctVal };
    });
  }, [collaborators, negotiations, goals]);

  const byBank = useMemo(() => {
    const map = new Map<
      string,
      { bankName: string; count: number; closed: number; debtCents: number; savingsCents: number; avgPct: number }
    >();
    for (const n of perfNegs) {
      const key = n.bankName || 'Outros';
      const entry = map.get(key) || {
        bankName: key,
        count: 0,
        closed: 0,
        debtCents: 0,
        savingsCents: 0,
        avgPct: 0,
      };
      entry.count += 1;
      if (n.negotiationStatus === 'ACORDO_FECHADO') entry.closed += 1;
      entry.debtCents += n.originalDebtCents || 0;
      entry.savingsCents += n.estimatedSavingsCents || 0;
      entry.avgPct += n.currentReductionPct || 0;
      map.set(key, entry);
    }
    return Array.from(map.values()).map((e) => ({
      ...e,
      avgPct: e.count > 0 ? Math.round(e.avgPct / e.count) : 0,
    }));
  }, [perfNegs]);

  const closedList = useMemo(
    () => perfNegs.filter((n) => n.negotiationStatus === 'ACORDO_FECHADO'),
    [perfNegs]
  );

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4 flex flex-wrap items-center justify-between gap-3 dark:border-slate-700 dark:bg-slate-900">
        <div>
          <h2 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
            Performance, Metas Mensais & Economia por Negociador
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Acompanhamento em tempo real de conversão de acordos, deságios obtidos e cumprimento de metas
          </p>
        </div>

        <select
          value={perfCollaboratorFilter}
          onChange={(e) => onPerfCollaboratorFilterChange(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-800 bg-white dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
        >
          <option value="TODOS">Todos os Negociadores</option>
          {collaborators.map((c) => (
            <option key={c.id} value={String(c.id)}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {/* Ranking & Goals Table / Responsive Cards */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden dark:border-slate-700 dark:bg-slate-900">
        <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-center gap-2 dark:border-slate-700 dark:bg-slate-800/70">
          <Target className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          <h3 className="font-display text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-100">
            Cumprimento de Metas por Colaborador
          </h3>
        </div>

        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-400">
                <th className="px-4 py-2.5">Colaborador</th>
                <th className="px-4 py-2.5 text-right">Em Carteira</th>
                <th className="px-4 py-2.5 text-right">Acordos / Meta</th>
                <th className="px-4 py-2.5 text-right">Economia / Meta (R$)</th>
                <th className="px-4 py-2.5 w-48">Progresso Financeiro</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
              {byCollab.map(({ col, total, closedCount, colSavings, goal, pctVal }) => (
                <tr key={col.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/70 transition-colors">
                  <td className="px-4 py-3 font-semibold text-slate-900 dark:text-slate-100">
                    {col.name}{' '}
                    <span className="font-normal text-slate-500 dark:text-slate-400">· {col.jobTitle || 'Negociador'}</span>
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">{total}</td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                    {closedCount} / {goal?.targetCount ?? 10}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-emerald-700 font-semibold dark:text-emerald-400">
                    {formatBRL(colSavings)} / {formatBRL(goal?.targetSavingsCents ?? 6500000)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden dark:bg-slate-800">
                        <div className="h-full bg-emerald-600" style={{ width: `${pctVal}%` }} />
                      </div>
                      <span className="font-mono tabular-nums text-[11px] font-semibold text-slate-700 w-9 text-right dark:text-slate-200">
                        {pctVal}%
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="md:hidden divide-y divide-slate-200 dark:divide-slate-700">
          {byCollab.map(({ col, total, closedCount, colSavings, goal, pctVal }) => (
            <div key={col.id} className="p-3.5 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-900 dark:text-slate-100">{col.name}</span>
                <span className="font-mono tabular-nums font-semibold text-emerald-700 dark:text-emerald-400">{pctVal}%</span>
              </div>
              <div className="text-[11px] text-slate-500 font-mono tabular-nums dark:text-slate-400">
                Carteira: {total} · Acordos: {closedCount}/{goal?.targetCount ?? 10} · {formatBRL(colSavings)}
              </div>
              <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden dark:bg-slate-800">
                <div className="h-full bg-emerald-600" style={{ width: `${pctVal}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Recovery by Bank & Closed Agreements */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden dark:border-slate-700 dark:bg-slate-900">
          <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/70">
            <h3 className="font-display text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-100">
              Desempenho por Banco Credor
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-[11px] font-semibold uppercase text-slate-500 dark:border-slate-700 dark:text-slate-400">
                  <th className="px-4 py-2.5">Banco</th>
                  <th className="px-4 py-2.5 text-right">Qtd</th>
                  <th className="px-4 py-2.5 text-right">Deságio Médio</th>
                  <th className="px-4 py-2.5 text-right">Economia</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {byBank.map((b) => (
                  <tr key={b.bankName} className="hover:bg-slate-50 dark:hover:bg-slate-800/70 transition-colors">
                    <td className="px-4 py-2.5 font-semibold text-slate-900 dark:text-slate-100">{b.bankName}</td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                      {b.count} ({b.closed} fech.)
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums text-blue-700 font-semibold dark:text-blue-400">
                      {b.avgPct}%
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums text-emerald-700 font-semibold dark:text-emerald-400">
                      {formatBRL(b.savingsCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden dark:border-slate-700 dark:bg-slate-900">
          <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/70">
            <h3 className="font-display text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-100">
              Acordos Fechados ({closedList.length})
            </h3>
          </div>
          {closedList.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">
              Nenhum acordo fechado registrado para o filtro selecionado.
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {closedList.map((n) => (
                <div
                  key={n.id}
                  onClick={() => onSelectNegotiation(n.id)}
                  className="flex items-center justify-between px-4 py-2.5 text-xs hover:bg-slate-50 dark:hover:bg-slate-800/70 cursor-pointer transition-colors"
                >
                  <div>
                    <div className="font-semibold text-slate-900 dark:text-slate-100">{n.clientName}</div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      {n.bankName} · {n.collaboratorName}
                    </div>
                  </div>
                  <div className="text-right font-mono tabular-nums">
                    <div className="font-bold text-emerald-700 dark:text-emerald-400">
                      {formatBRL(n.estimatedSavingsCents)} economizados
                    </div>
                    <div className="text-[10px] text-slate-500 dark:text-slate-400">
                      Fechado em {n.closedInstallments || 1}x ({n.currentReductionPct}%)
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
