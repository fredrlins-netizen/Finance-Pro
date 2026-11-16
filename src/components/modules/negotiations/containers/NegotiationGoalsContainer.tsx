import React, { useMemo, useState } from 'react';
import { RefreshCw, Target } from 'lucide-react';
import { apiFetch, formatBRL } from '../../../../lib/api.ts';
import type { Negotiation, NegotiationGoal } from '../../../../types.ts';

interface NegotiationGoalsContainerProps {
  negotiation: Negotiation;
  goals: NegotiationGoal[];
  allNegotiations: Negotiation[];
  onUpdated: () => Promise<void>;
  showToast: (msg: string) => void;
}

export const NegotiationGoalsContainer: React.FC<NegotiationGoalsContainerProps> = ({
  negotiation,
  goals,
  allNegotiations,
  onUpdated,
  showToast,
}) => {
  const activeCollaboratorGoal = useMemo(() => {
    const now = new Date();
    return (
      goals.find(
        (g) =>
          g.collaboratorId === negotiation.collaboratorId &&
          g.month === now.getMonth() + 1 &&
          g.year === now.getFullYear()
      ) ||
      goals.find((g) => g.collaboratorId === negotiation.collaboratorId) ||
      null
    );
  }, [goals, negotiation.collaboratorId]);

  const [goalTargetCount, setGoalTargetCount] = useState<string>(
    activeCollaboratorGoal ? String(activeCollaboratorGoal.targetCount) : '10'
  );
  const [goalTargetValue, setGoalTargetValue] = useState<string>(
    activeCollaboratorGoal ? activeCollaboratorGoal.targetValue : '65000.00'
  );
  const [savingGoal, setSavingGoal] = useState(false);

  const collabClosed = useMemo(
    () =>
      allNegotiations.filter(
        (n) => n.collaboratorId === negotiation.collaboratorId && n.negotiationStatus === 'ACORDO_FECHADO'
      ),
    [allNegotiations, negotiation.collaboratorId]
  );

  const collabSavingsCents = collabClosed.reduce((s, n) => s + (n.estimatedSavingsCents || 0), 0);
  const goalSavingsTarget = activeCollaboratorGoal?.targetSavingsCents || 6500000;
  const pctAchieved = Math.min(100, Math.round((collabSavingsCents / Math.max(1, goalSavingsTarget)) * 100));

  const handleSaveGoal = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingGoal(true);
    try {
      if (activeCollaboratorGoal) {
        await apiFetch(`/api/negotiation-goals/${activeCollaboratorGoal.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            collaboratorId: negotiation.collaboratorId,
            collaboratorName: negotiation.collaboratorName || 'Geral',
            month: activeCollaboratorGoal.month,
            year: activeCollaboratorGoal.year,
            targetCount: Number(goalTargetCount || 10),
            targetValue: goalTargetValue,
          }),
        });
      } else {
        await apiFetch('/api/negotiation-goals', {
          method: 'POST',
          body: JSON.stringify({
            collaboratorId: negotiation.collaboratorId,
            collaboratorName: negotiation.collaboratorName || 'Geral',
            month: new Date().getMonth() + 1,
            year: new Date().getFullYear(),
            targetCount: Number(goalTargetCount || 10),
            targetValue: goalTargetValue,
          }),
        });
      }
      await onUpdated();
      showToast('Meta mensal do negociador atualizada.');
    } catch {
      showToast('Falha ao atualizar meta.');
    } finally {
      setSavingGoal(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
      <div className="lg:col-span-5">
        <form onSubmit={handleSaveGoal} className="rounded-xl border border-slate-200 bg-white p-4 space-y-3 dark:border-slate-700 dark:bg-slate-900">
          <h3 className="font-display text-xs font-bold uppercase tracking-wider text-slate-800 border-b border-slate-100 pb-2 dark:text-slate-100 dark:border-slate-800">
            Configurar Meta · {negotiation.collaboratorName}
          </h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1 dark:text-slate-300">Meta de Acordos (Qtd)</label>
              <input
                type="number"
                min={1}
                value={goalTargetCount}
                onChange={(e) => setGoalTargetCount(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-mono dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1 dark:text-slate-300">Meta de Economia (R$)</label>
              <input
                type="text"
                value={goalTargetValue}
                onChange={(e) => setGoalTargetValue(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-mono dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={savingGoal}
            className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-emerald-600 dark:hover:bg-emerald-500"
          >
            {savingGoal ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Target className="w-3.5 h-3.5" />}
            Salvar Meta do Negociador
          </button>
        </form>
      </div>

      <div className="lg:col-span-7">
        <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-4 dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-100">
              Progresso no Mês Atual ({negotiation.collaboratorName})
            </h3>
            <span className="font-mono tabular-nums text-xs font-bold text-emerald-700 dark:text-emerald-300">{pctAchieved}%</span>
          </div>

          <div className="h-2.5 w-full rounded-full bg-slate-100 overflow-hidden dark:bg-slate-800">
            <div className="h-full bg-emerald-600 transition-all" style={{ width: `${pctAchieved}%` }} />
          </div>

          <div className="grid grid-cols-2 divide-x divide-slate-200 rounded-lg border border-slate-200 bg-slate-50 text-xs font-mono tabular-nums dark:divide-slate-700 dark:border-slate-700 dark:bg-slate-800/70">
            <div className="p-3">
              <div className="font-sans text-[11px] font-semibold text-slate-500 dark:text-slate-400">Acordos Fechados</div>
              <div className="text-lg font-bold text-slate-900 mt-1 dark:text-slate-100">
                {collabClosed.length} / {activeCollaboratorGoal?.targetCount || 10}
              </div>
            </div>
            <div className="p-3">
              <div className="font-sans text-[11px] font-semibold text-slate-500 dark:text-slate-400">Economia Realizada</div>
              <div className="text-lg font-bold text-emerald-700 mt-1 dark:text-emerald-300">{formatBRL(collabSavingsCents)}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
