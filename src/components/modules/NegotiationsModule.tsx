import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight,
  Award,
  CheckCircle2,
  Mail,
  MessageSquare,
  TrendingDown,
} from 'lucide-react';
import { apiFetch, formatBRL, formatDateBR, formatDateTimeBR } from '../../lib/api.ts';
import { Client, ModuleId, NavigationIntent, Negotiation, Unit } from '../../types.ts';
import { CollapsibleFilterBar } from '../CollapsibleFilterBar.tsx';

interface NegotiationsModuleProps {
  units: Unit[];
  wsTick: number;
  navIntent?: NavigationIntent | null;
  onClearIntent?: () => void;
  onNavigate?: (mod: ModuleId, intent?: NavigationIntent) => void;
}

export const NegotiationsModule: React.FC<NegotiationsModuleProps> = ({
  units,
  wsTick,
  navIntent,
  onClearIntent,
  onNavigate,
}) => {
  const [negotiations, setNegotiations] = useState<Negotiation[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [negotiators, setNegotiators] = useState<Array<{ id: number; name: string; role: string }>>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedForMassEmail, setSelectedForMassEmail] = useState<number[]>([]);
  const [tab, setTab] = useState<'carteira' | 'ranking'>('carteira');

  const [unitFilter, setUnitFilter] = useState('all');
  const [periodFilter, setPeriodFilter] = useState('30d');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const [reductionInput, setReductionInput] = useState('');
  const [chatChannel, setChatChannel] = useState('gotalk');
  const [chatNote, setChatNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');

  const load = async () => {
    const data = await apiFetch<{
      negotiations: Negotiation[];
      clients: Client[];
      negotiators: Array<{ id: number; name: string; role: string }>;
    }>('/api/negotiations');
    setNegotiations(data.negotiations);
    setClients(data.clients);
    setNegotiators(data.negotiators);
    if (!selectedId && data.negotiations[0]) {
      setSelectedId(data.negotiations[0].id);
      setReductionInput(String(data.negotiations[0].currentReductionPct));
    }
  };

  useEffect(() => {
    load();
  }, [wsTick]);

  useEffect(() => {
    if (!navIntent) return;
    if (navIntent.clientId && negotiations.length > 0) {
      const match = negotiations.find((n) => n.clientId === navIntent.clientId);
      if (match) {
        setSelectedId(match.id);
        setReductionInput(String(match.currentReductionPct));
        setTab('carteira');
      }
    }
    onClearIntent?.();
  }, [navIntent, negotiations, onClearIntent]);

  const filtered = useMemo(() => {
    return negotiations.filter((n) => {
      if (unitFilter !== 'all' && String(n.unitId) !== unitFilter) return false;
      if (statusFilter !== 'all' && n.status !== statusFilter) return false;
      if (searchQuery.trim()) {
        const c = clients.find((cl) => cl.id === n.clientId);
        const q = searchQuery.toLowerCase();
        if (!n.bankName.toLowerCase().includes(q) && !(c?.fullName || '').toLowerCase().includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [negotiations, clients, unitFilter, statusFilter, searchQuery]);

  const activeNeg =
    filtered.find((n) => n.id === selectedId) ||
    negotiations.find((n) => n.id === selectedId) ||
    filtered[0];

  const activeClient = activeNeg ? clients.find((c) => c.id === activeNeg.clientId) : undefined;

  const handleSelect = (neg: Negotiation) => {
    setSelectedId(neg.id);
    setReductionInput(String(neg.currentReductionPct));
  };

  const handleUpdateNegotiation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeNeg) return;
    if (!chatNote.trim()) {
      setFeedback('Registre a interação no chat (GoTalk / UaZapi) antes de salvar o percentual.');
      return;
    }
    setBusy(true);
    setFeedback('');
    try {
      await apiFetch(`/api/negotiations/${activeNeg.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          currentReductionPct: Number(reductionInput),
          chatNote,
          chatChannel,
        }),
      });
      setChatNote('');
      setFeedback('Percentual de redução e log de conversa atualizados com sucesso.');
      await load();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Erro ao atualizar negociação.');
    } finally {
      setBusy(false);
    }
  };

  const handleMassEmail = async () => {
    const ids = selectedForMassEmail.length > 0 ? selectedForMassEmail : filtered.map((f) => f.id);
    if (!ids.length) return;
    setBusy(true);
    setFeedback('');
    try {
      const res = await apiFetch<{ sentCount: number }>('/api/negotiations/mass-email', {
        method: 'POST',
        body: JSON.stringify({ negotiationIds: ids }),
      });
      setSelectedForMassEmail([]);
      setFeedback(`Disparo em massa enviado com sucesso para ${res.sentCount} contratos filtrados.`);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const indicators = useMemo(() => {
    const activeOnly = filtered.filter((n) => n.status !== 'suspensa');
    const closestToGoal = activeOnly.filter(
      (n) =>
        n.currentReductionPct < n.targetReductionPct &&
        n.targetReductionPct - n.currentReductionPct <= 10
    ).length;
    const lowestReduction = activeOnly.filter((n) => n.currentReductionPct < 20).length;
    const finishedEarly = activeOnly.filter(
      (n) => n.currentReductionPct >= n.targetReductionPct
    ).length;
    const nearDeadline = activeOnly.filter((n) => {
      const daysLeft = (new Date(n.targetDeadline).getTime() - Date.now()) / 86400000;
      return daysLeft >= 0 && daysLeft <= 10;
    }).length;
    const totalSavings = activeOnly.reduce((a, b) => a + Number(b.estimatedSavingsCents || 0), 0);

    const bankMap = new Map<string, { bank: string; sumPct: number; count: number; savings: number }>();
    activeOnly.forEach((n) => {
      const cur = bankMap.get(n.bankName) || { bank: n.bankName, sumPct: 0, count: 0, savings: 0 };
      cur.sumPct += n.currentReductionPct;
      cur.count += 1;
      cur.savings += Number(n.estimatedSavingsCents || 0);
      bankMap.set(n.bankName, cur);
    });
    const bankPerformance = [...bankMap.values()]
      .map((b) => ({ ...b, avgPct: Math.round(b.sumPct / b.count) }))
      .sort((a, b) => b.avgPct - a.avgPct);

    const rankingMap = new Map<
      number,
      { name: string; count: number; avgPct: number; sumPct: number }
    >();
    activeOnly.forEach((n) => {
      const nid = n.negotiatorId || 0;
      const negUser = negotiators.find((u) => u.id === nid);
      const cur = rankingMap.get(nid) || {
        name: negUser?.name || 'Equipe Comercial/Mesa',
        count: 0,
        avgPct: 0,
        sumPct: 0,
      };
      cur.count += 1;
      cur.sumPct += n.currentReductionPct;
      cur.avgPct = Math.round(cur.sumPct / cur.count);
      rankingMap.set(nid, cur);
    });
    const ranking = [...rankingMap.values()].sort((a, b) => b.avgPct - a.avgPct);

    return {
      closestToGoal,
      lowestReduction,
      finishedEarly,
      nearDeadline,
      totalSavings,
      bankPerformance,
      ranking,
    };
  }, [filtered, negotiators]);

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 border-b border-slate-200 pb-4">
        <div>
          <p className="text-xs font-medium text-slate-500">
            Redução de Passivo junto a Credores · GoTalk / UaZapi · Disparo de E-mails em Massa
          </p>
          <h1 className="mt-1 font-display text-2xl font-bold text-slate-900">
            Negociações Bancárias
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            <button
              type="button"
              onClick={() => setTab('carteira')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md whitespace-nowrap transition-colors ${
                tab === 'carteira'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Carteira ({filtered.length})
            </button>
            <button
              type="button"
              onClick={() => setTab('ranking')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md whitespace-nowrap transition-colors ${
                tab === 'ranking'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Desempenho & Ranking
            </button>
          </div>
          <button
            type="button"
            disabled={busy || filtered.length === 0}
            onClick={handleMassEmail}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-50 whitespace-nowrap min-h-[38px]"
          >
            <Mail className="w-3.5 h-3.5" />
            {selectedForMassEmail.length > 0
              ? `Disparar E-mail (${selectedForMassEmail.length})`
              : `E-mail em Massa (${filtered.length})`}
          </button>
        </div>
      </div>

      <CollapsibleFilterBar
        units={units}
        selectedUnitId={unitFilter}
        onUnitChange={setUnitFilter}
        period={periodFilter}
        onPeriodChange={setPeriodFilter}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        extraStatuses={[
          { value: 'em_negociacao', label: 'Em Negociação' },
          { value: 'proxima_meta', label: 'Próxima da Meta' },
          { value: 'meta_alcancada', label: 'Meta Alcançada' },
          { value: 'suspensa', label: 'Suspensa (Cobrança)' },
        ]}
        selectedStatus={statusFilter}
        onStatusChange={setStatusFilter}
      />

      {feedback && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-medium text-emerald-900">
          {feedback}
        </div>
      )}

      {/* 5 Negotiation Indicators */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3.5">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-[11px] font-medium text-slate-500">Economia Projetada</div>
          <div className="mt-1 font-mono text-xl font-bold text-emerald-700 tabular-nums">
            {formatBRL(indicators.totalSavings)}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-[11px] font-medium text-slate-500">Próximos da Meta (&le;10%)</div>
          <div className="mt-1 font-mono text-xl font-bold text-blue-700 tabular-nums">
            {indicators.closestToGoal}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-[11px] font-medium text-slate-500">Menor % Redução (&lt;20%)</div>
          <div className="mt-1 font-mono text-xl font-bold text-amber-700 tabular-nums">
            {indicators.lowestReduction}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-[11px] font-medium text-slate-500">Próximo Prazo Meta</div>
          <div className="mt-1 font-mono text-xl font-bold text-red-600 tabular-nums">
            {indicators.nearDeadline}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-[11px] font-medium text-slate-500">Concluídos Antecipados</div>
          <div className="mt-1 font-mono text-xl font-bold text-slate-900 tabular-nums">
            {indicators.finishedEarly}
          </div>
        </div>
      </div>

      {tab === 'carteira' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <div className="lg:col-span-6 rounded-xl border border-slate-200 bg-white overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between text-xs font-bold text-slate-800">
              <span>Carteira em Tratativa ({filtered.length})</span>
              <span className="text-[11px] font-medium text-slate-500">Marque p/ e-mail em lote</span>
            </div>
            <div className="divide-y divide-slate-100 max-h-[500px] overflow-y-auto">
              {filtered.map((n) => {
                const client = clients.find((c) => c.id === n.clientId);
                const isSelected = activeNeg?.id === n.id;
                const isChecked = selectedForMassEmail.includes(n.id);
                const progressPct = Math.min(
                  100,
                  Math.round((n.currentReductionPct / Math.max(n.targetReductionPct, 1)) * 100)
                );
                return (
                  <div
                    key={n.id}
                    className={`px-4 py-3.5 flex items-start gap-3 transition-colors ${
                      isSelected ? 'bg-blue-50/60' : 'hover:bg-slate-50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={(e) => {
                        if (e.target.checked) setSelectedForMassEmail((prev) => [...prev, n.id]);
                        else setSelectedForMassEmail((prev) => prev.filter((id) => id !== n.id));
                      }}
                      className="mt-1"
                    />
                    <button
                      type="button"
                      onClick={() => handleSelect(n)}
                      className="flex-1 text-left"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-slate-900">
                          {client?.fullName || 'Cliente'} ·{' '}
                          <span className="text-blue-700">{n.bankName}</span>
                        </span>
                        <span className="font-mono text-xs font-semibold text-emerald-700 tabular-nums">
                          {n.currentReductionPct}% / {n.targetReductionPct}%
                        </span>
                      </div>
                      <div className="mt-1 text-[11px] text-slate-500 font-mono">
                        Dívida: {formatBRL(n.originalDebtCents)} · Prazo:{' '}
                        {formatDateBR(n.targetDeadline)} · {n.status.replace(/_/g, ' ')}
                      </div>
                      <div className="mt-2 h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                        <div
                          className={`h-full rounded-full ${
                            n.currentReductionPct >= n.targetReductionPct
                              ? 'bg-emerald-600'
                              : 'bg-blue-600'
                          }`}
                          style={{ width: `${progressPct}%` }}
                        />
                      </div>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="lg:col-span-6">
            {activeNeg && (
              <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
                  <div>
                    <h2 className="font-display text-base font-bold text-slate-900">
                      {activeClient?.fullName} · {activeNeg.bankName}
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5 font-mono">
                      Passivo: {formatBRL(activeNeg.originalDebtCents)} · Economia:{' '}
                      {formatBRL(activeNeg.estimatedSavingsCents)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {onNavigate && activeClient && (
                      <button
                        type="button"
                        onClick={() =>
                          onNavigate('admission', { clientId: activeClient.id, tab: 'clientes' })
                        }
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        Dossiê
                        <ArrowUpRight className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <TrendingDown className="w-5 h-5 text-emerald-600" />
                  </div>
                </div>

                <form
                  onSubmit={handleUpdateNegotiation}
                  className="space-y-3 rounded-lg border border-slate-200 bg-slate-50/80 p-3.5"
                >
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                        Percentual Obtido (%) · Meta {activeNeg.targetReductionPct}%
                      </label>
                      <input
                        type="number"
                        min={0}
                        max={99}
                        value={reductionInput}
                        onChange={(e) => setReductionInput(e.target.value)}
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-mono text-slate-900"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                        Canal da Tratativa
                      </label>
                      <select
                        value={chatChannel}
                        onChange={(e) => setChatChannel(e.target.value)}
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900"
                      >
                        <option value="gotalk">GoTalk WhatsApp</option>
                        <option value="uazapi">UaZapi WhatsApp</option>
                        <option value="email_banco">E-mail Mesa Credora</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      Registro da Conversa / Proposta do Credor
                    </label>
                    <textarea
                      rows={2}
                      value={chatNote}
                      onChange={(e) => setChatNote(e.target.value)}
                      placeholder="Descreva a contraproposta recebida via GoTalk/UaZapi ou protocolo do banco..."
                      className="w-full rounded-lg border border-slate-200 bg-white p-2.5 text-xs text-slate-900"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={busy}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Atualizar Redução & Log de Chat
                  </button>
                </form>

                <div>
                  <h3 className="text-xs font-bold text-slate-800 mb-2 flex items-center gap-1.5">
                    <MessageSquare className="w-3.5 h-3.5 text-blue-700" />
                    Histórico de Interações
                  </h3>
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {(activeNeg.chatLogs || []).map((log, idx) => (
                      <div
                        key={idx}
                        className="rounded-lg border border-slate-100 bg-slate-50 p-2.5 text-xs"
                      >
                        <div className="flex items-center justify-between text-[11px] text-slate-500">
                          <span className="font-semibold text-slate-700">
                            {log.author} · {log.channel.toUpperCase()}
                          </span>
                          <span className="font-mono">{formatDateTimeBR(log.timestamp)}</span>
                        </div>
                        <p className="mt-1 text-slate-700">{log.note}</p>
                      </div>
                    ))}
                    {(!activeNeg.chatLogs || activeNeg.chatLogs.length === 0) && (
                      <p className="text-xs text-slate-400">Nenhuma interação registrada ainda.</p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'ranking' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <div className="lg:col-span-7 rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="font-display text-sm font-bold text-slate-900 mb-3">
              Melhores Desempenhos por Instituição Financeira (% Médio de Desconto)
            </h2>
            <div className="space-y-3">
              {indicators.bankPerformance.map((b) => (
                <div key={b.bank}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="font-semibold text-slate-800">
                      {b.bank} ({b.count} contratos)
                    </span>
                    <span className="font-mono font-bold text-emerald-700 tabular-nums">
                      {b.avgPct}% · {formatBRL(b.savings)}
                    </span>
                  </div>
                  <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-emerald-600"
                      style={{ width: `${Math.min(100, b.avgPct)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="lg:col-span-5 rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="font-display text-sm font-bold text-slate-900 mb-3 flex items-center gap-1.5">
              <Award className="w-4 h-4 text-amber-600" />
              Ranking de Negociadores
            </h2>
            <div className="divide-y divide-slate-100 text-xs">
              {indicators.ranking.map((r, i) => (
                <div key={r.name} className="py-2.5 flex items-center justify-between">
                  <div>
                    <span className="font-mono font-bold text-slate-400 mr-2">#{i + 1}</span>
                    <span className="font-semibold text-slate-800">{r.name}</span>
                    <span className="text-slate-500 ml-1">({r.count} carteiras)</span>
                  </div>
                  <span className="font-mono font-bold text-blue-700 tabular-nums">
                    {r.avgPct}% média
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
