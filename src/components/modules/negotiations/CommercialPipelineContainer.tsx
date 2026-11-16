import React, { useState } from 'react';
import { ArrowRight, Plus, RefreshCw, X } from 'lucide-react';
import { apiFetch, formatBRL } from '../../../lib/api.ts';
import type {
  BankItem,
  Client,
  CollaboratorItem,
  CommercialDeal,
  CommercialStage,
  Negotiation,
} from '../../../types.ts';
import { COMMERCIAL_STAGES } from './types.ts';

interface CommercialPipelineContainerProps {
  deals: CommercialDeal[];
  clients: Client[];
  banks: BankItem[];
  collaborators: CollaboratorItem[];
  onRefresh: () => Promise<void>;
  onConverted: (negId: number) => void;
}

export const CommercialPipelineContainer: React.FC<CommercialPipelineContainerProps> = ({
  deals,
  clients,
  banks,
  collaborators,
  onRefresh,
  onConverted,
}) => {
  const [showNewDealModal, setShowNewDealModal] = useState(false);
  const [dealClientId, setDealClientId] = useState<string>(clients[0] ? String(clients[0].id) : '');
  const [dealBankId, setDealBankId] = useState<string>(banks[0] ? String(banks[0].id) : '');
  const [dealCollabId, setDealCollabId] = useState<string>(
    collaborators[0] ? String(collaborators[0].id) : ''
  );
  const [dealDebtValue, setDealDebtValue] = useState<string>('35000.00');
  const [dealProposedValue, setDealProposedValue] = useState<string>('15750.00');
  const [dealDiscountPct, setDealDiscountPct] = useState<string>('55');
  const [dealNotes, setDealNotes] = useState<string>('');
  const [savingDeal, setSavingDeal] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);

  const handleOpenNewModal = () => {
    setDealClientId((prev) => prev || (clients[0] ? String(clients[0].id) : ''));
    setDealBankId((prev) => prev || (banks[0] ? String(banks[0].id) : ''));
    setDealCollabId((prev) => prev || (collaborators[0] ? String(collaborators[0].id) : ''));
    setShowNewDealModal(true);
  };

  const handleCreateCommercialDeal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dealClientId) return;
    setSavingDeal(true);
    try {
      const cl = clients.find((c) => String(c.id) === dealClientId);
      const bnk = banks.find((b) => String(b.id) === dealBankId);
      const col = collaborators.find((c) => String(c.id) === dealCollabId);
      await apiFetch('/api/commercial-deals', {
        method: 'POST',
        body: JSON.stringify({
          clientId: Number(dealClientId),
          clientName: cl?.fullName || '',
          bankId: bnk?.id || null,
          bankName: bnk?.name || 'Banco BV',
          collaboratorId: col?.id || null,
          collaboratorName: col?.name || 'Carla Dias',
          stage: 'TRIAGEM',
          debtValue: dealDebtValue,
          proposedValue: dealProposedValue,
          discountPercentage: dealDiscountPct,
          notes: dealNotes,
        }),
      });
      setShowNewDealModal(false);
      setDealNotes('');
      await onRefresh();
    } finally {
      setSavingDeal(false);
    }
  };

  const handleMoveDealStage = async (dealId: number, nextStage: CommercialStage) => {
    setBusyId(dealId);
    try {
      await apiFetch(`/api/commercial-deals/${dealId}/stage`, {
        method: 'PATCH',
        body: JSON.stringify({ stage: nextStage }),
      });
      await onRefresh();
    } finally {
      setBusyId(null);
    }
  };

  const handleConvertDealToNegotiation = async (dealId: number) => {
    setBusyId(dealId);
    try {
      const res = await apiFetch<{ negotiation: Negotiation }>(`/api/commercial-deals/${dealId}/convert`, {
        method: 'POST',
      });
      await onRefresh();
      if (res.negotiation?.id) {
        onConverted(res.negotiation.id);
      }
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-sm font-bold text-slate-900">
            Pipeline Comercial de Oportunidades & Conversão Bancária
          </h2>
          <p className="text-xs text-slate-500">
            Acompanhe propostas da triagem até o fechamento com conversão direta para Negociação Financeira
          </p>
        </div>

        <button
          type="button"
          onClick={handleOpenNewModal}
          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-700 whitespace-nowrap"
        >
          <Plus className="w-4 h-4" />
          Nova Oportunidade
        </button>
      </div>

      {/* Horizontal-scroll safe responsive Kanban grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
        {COMMERCIAL_STAGES.map((st) => {
          const stageDeals = deals.filter((d) => String(d.stage).toUpperCase() === st.key);
          const stageVolumeCents = stageDeals.reduce((s, d) => s + (d.debtValueCents || 0), 0);

          return (
            <div key={st.key} className="rounded-xl border border-slate-200 bg-white flex flex-col min-h-[380px]">
              <div className={`rounded-t-xl border-b px-3.5 py-2.5 flex items-center justify-between ${st.headerClass}`}>
                <div>
                  <div className="text-xs font-bold">{st.label}</div>
                  <div className="text-[10px] font-mono tabular-nums opacity-80">
                    {formatBRL(stageVolumeCents)}
                  </div>
                </div>
                <span className="font-mono tabular-nums text-xs font-bold">{stageDeals.length}</span>
              </div>

              <div className="p-2.5 space-y-2.5 flex-1 bg-slate-50/40">
                {stageDeals.length === 0 ? (
                  <div className="py-10 text-center text-[11px] text-slate-400">
                    Nenhuma oportunidade nesta etapa
                  </div>
                ) : (
                  stageDeals.map((deal) => (
                    <div
                      key={deal.id}
                      className="rounded-lg border border-slate-200 bg-white p-3 space-y-2"
                    >
                      <div className="text-xs font-bold text-slate-900">{deal.clientName}</div>
                      <div className="text-[11px] text-slate-500">
                        {deal.bankName} · {deal.collaboratorName}
                      </div>

                      <div className="flex items-center justify-between text-[11px] font-mono tabular-nums pt-1 border-t border-slate-100">
                        <span className="text-slate-600">{formatBRL(deal.debtValueCents)}</span>
                        {deal.proposedValueCents ? (
                          <span className="font-bold text-emerald-700">
                            Prop: {formatBRL(deal.proposedValueCents)}
                          </span>
                        ) : null}
                      </div>

                      <div className="pt-1 flex items-center justify-between gap-1.5">
                        <select
                          disabled={busyId === deal.id}
                          value={String(deal.stage).toUpperCase()}
                          onChange={(e) => void handleMoveDealStage(deal.id, e.target.value as CommercialStage)}
                          className="rounded border border-slate-300 bg-slate-50 px-1.5 py-1 text-[10px] font-semibold text-slate-700 max-w-[120px]"
                        >
                          {COMMERCIAL_STAGES.map((opt) => (
                            <option key={opt.key} value={opt.key}>
                              {opt.label}
                            </option>
                          ))}
                        </select>

                        {!deal.convertedNegotiationId ? (
                          <button
                            type="button"
                            disabled={busyId === deal.id}
                            onClick={() => void handleConvertDealToNegotiation(deal.id)}
                            className="inline-flex items-center gap-1 rounded bg-slate-900 px-2 py-1 text-[10px] font-semibold text-white hover:bg-slate-800 whitespace-nowrap disabled:opacity-50"
                          >
                            {busyId === deal.id ? (
                              <RefreshCw className="w-2.5 h-2.5 animate-spin" />
                            ) : (
                              <>
                                Negociar <ArrowRight className="w-2.5 h-2.5" />
                              </>
                            )}
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => onConverted(deal.convertedNegotiationId!)}
                            className="text-[10px] font-semibold text-emerald-700 hover:underline font-mono tabular-nums"
                          >
                            Neg. #{deal.convertedNegotiationId}
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>

      {showNewDealModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4"
          onClick={() => setShowNewDealModal(false)}
        >
          <div
            className="w-full max-w-lg rounded-xl border border-slate-200 bg-white shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-900 px-5 py-3.5 text-white">
              <h3 className="font-display text-sm font-bold">Nova Oportunidade Comercial</h3>
              <button
                type="button"
                onClick={() => setShowNewDealModal(false)}
                className="rounded-lg p-1 text-slate-300 hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleCreateCommercialDeal} className="p-5 space-y-3 text-xs">
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">Cliente *</label>
                <select
                  required
                  value={dealClientId}
                  onChange={(e) => setDealClientId(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs bg-white"
                >
                  {clients.map((c) => (
                    <option key={c.id} value={String(c.id)}>
                      {c.fullName} ({c.cpfCnpj})
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">Banco</label>
                  <select
                    value={dealBankId}
                    onChange={(e) => setDealBankId(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs bg-white"
                  >
                    {banks.map((b) => (
                      <option key={b.id} value={String(b.id)}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">Responsável</label>
                  <select
                    value={dealCollabId}
                    onChange={(e) => setDealCollabId(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs bg-white"
                  >
                    {collaborators.map((col) => (
                      <option key={col.id} value={String(col.id)}>
                        {col.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2.5">
                <div>
                  <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">Dívida (R$)</label>
                  <input
                    type="text"
                    value={dealDebtValue}
                    onChange={(e) => setDealDebtValue(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-2.5 py-2 font-mono text-xs"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">Proposta (R$)</label>
                  <input
                    type="text"
                    value={dealProposedValue}
                    onChange={(e) => setDealProposedValue(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-2.5 py-2 font-mono text-xs"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">Desc. (%)</label>
                  <input
                    type="text"
                    value={dealDiscountPct}
                    onChange={(e) => setDealDiscountPct(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-2.5 py-2 font-mono text-xs"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">Observações</label>
                <textarea
                  rows={2}
                  value={dealNotes}
                  onChange={(e) => setDealNotes(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowNewDealModal(false)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={savingDeal}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {savingDeal ? 'Salvando...' : 'Criar Oportunidade'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
