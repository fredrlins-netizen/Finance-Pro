import React, { useMemo, useState } from 'react';
import { ArrowRightLeft, Calculator, CheckCircle2, Edit3, Plus, Trash2, XCircle } from 'lucide-react';
import { apiFetch, formatBRL, formatDateBR } from '../../../../lib/api.ts';
import type { BankContactItem, Negotiation, NegotiationProposalItem } from '../../../../types.ts';
import { PROPOSAL_ORIGIN_LABELS, PROPOSAL_STATUS_CONFIG } from '../types.ts';

interface NegotiationProposalsContainerProps {
  negotiation: Negotiation;
  bankContactsList: BankContactItem[];
  onUpdated: (updated?: Negotiation) => Promise<void>;
  showToast: (msg: string) => void;
}

export const NegotiationProposalsContainer: React.FC<NegotiationProposalsContainerProps> = ({
  negotiation,
  bankContactsList,
  onUpdated,
  showToast,
}) => {
  const debtReais = (negotiation.originalDebtCents || 0) / 100 || 1;
  const [editingProposalId, setEditingProposalId] = useState<number | null>(null);
  const [pDate, setPDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [pOrigin, setPOrigin] = useState<string>('NOSSA_PROPOSTA');
  const [pProposedValue, setPProposedValue] = useState<string>(() =>
    ((negotiation.originalDebtCents * (1 - (negotiation.targetReductionPct || 55) / 100)) / 100).toFixed(2)
  );
  const [pDiscountPct, setPDiscountPct] = useState<string>(String(negotiation.targetReductionPct || 55));
  const [pInstallments, setPInstallments] = useState<string>('1');
  const [pEntryValue, setPEntryValue] = useState<string>('0.00');
  const [pStatus, setPStatus] = useState<string>('AGUARDANDO');
  const [pBankContactId, setPBankContactId] = useState<string>(
    negotiation.selectedBankContactId ? String(negotiation.selectedBankContactId) : ''
  );
  const [pNotes, setPNotes] = useState<string>('');
  const [savingProposal, setSavingProposal] = useState(false);

  const calculatedInstallmentValue = useMemo(() => {
    const val = parseFloat(pProposedValue.replace(',', '.')) || 0;
    const entry = parseFloat(pEntryValue.replace(',', '.')) || 0;
    const parc = Math.max(1, parseInt(pInstallments || '1', 10));
    return Math.max(0, (val - entry) / parc).toFixed(2);
  }, [pProposedValue, pEntryValue, pInstallments]);

  const handleProposedValueChange = (rawVal: string) => {
    setPProposedValue(rawVal);
    const num = parseFloat(rawVal.replace(',', '.'));
    if (Number.isFinite(num) && debtReais > 0) {
      const disc = Math.max(0, Math.min(99, (1 - num / debtReais) * 100));
      setPDiscountPct(disc.toFixed(1));
    }
  };

  const handleDiscountPctChange = (rawPct: string) => {
    setPDiscountPct(rawPct);
    const pct = parseFloat(rawPct.replace(',', '.'));
    if (Number.isFinite(pct) && pct >= 0 && pct <= 99) {
      const val = debtReais * (1 - pct / 100);
      setPProposedValue(val.toFixed(2));
    }
  };

  const handleSaveProposal = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProposal(true);
    try {
      const chosenBc = bankContactsList.find((b) => String(b.id) === pBankContactId);
      const payload = {
        date: pDate,
        origin: pOrigin,
        proposedValue: pProposedValue,
        discountPercentage: pDiscountPct,
        installments: Number(pInstallments || 1),
        installmentValue: calculatedInstallmentValue,
        entryValue: pEntryValue,
        status: pStatus,
        bankContactId: pBankContactId ? Number(pBankContactId) : null,
        bankContactName: chosenBc?.name || negotiation.bankName,
        notes: pNotes,
      };
      const updated = editingProposalId
        ? await apiFetch<Negotiation>(`/api/negotiations/${negotiation.id}/proposals/${editingProposalId}`, {
            method: 'PUT',
            body: JSON.stringify(payload),
          })
        : await apiFetch<Negotiation>(`/api/negotiations/${negotiation.id}/proposals`, {
            method: 'POST',
            body: JSON.stringify(payload),
          });
      setEditingProposalId(null);
      setPNotes('');
      await onUpdated(updated);
      showToast(editingProposalId ? 'Proposta atualizada.' : 'Proposta registrada.');
    } catch {
      showToast('Erro ao salvar proposta.');
    } finally {
      setSavingProposal(false);
    }
  };

  const handleProposalQuickAction = async (
    prop: NegotiationProposalItem,
    action: 'ACEITA' | 'RECUSADA' | 'CONTRA_PROPOSTA'
  ) => {
    if (action === 'CONTRA_PROPOSTA') {
      setEditingProposalId(null);
      setPOrigin(prop.origin.includes('BANCO') ? 'CONTRA_PROPOSTA_NOSSA' : 'CONTRA_PROPOSTA_BANCO');
      setPProposedValue(prop.proposedValue);
      setPDiscountPct(prop.discountPercentage || '50');
      setPInstallments(String(prop.installments || 1));
      setPStatus('AGUARDANDO');
      setPNotes(`Contra-proposta referente à proposta de R$ ${prop.proposedValue} (${prop.date}).`);
      showToast('Formulário preenchido para Contra-Proposta.');
      return;
    }

    try {
      const updated = await apiFetch<Negotiation>(`/api/negotiations/${negotiation.id}/proposals/${prop.id}`, {
        method: 'PUT',
        body: JSON.stringify({ status: action }),
      });
      await onUpdated(updated);
      showToast(
        action === 'ACEITA'
          ? 'Proposta ACEITA. Status atualizado para Acordo Fechado.'
          : 'Proposta marcada como Recusada.'
      );
    } catch {
      showToast('Erro ao atualizar status da proposta.');
    }
  };

  const handleDeleteProposal = async (pid: number) => {
    try {
      const updated = await apiFetch<Negotiation>(`/api/negotiations/${negotiation.id}/proposals/${pid}`, {
        method: 'DELETE',
      });
      await onUpdated(updated);
      showToast('Proposta excluída.');
    } catch {
      showToast('Erro ao excluir proposta.');
    }
  };

  const proposals = negotiation.proposals || [];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
      <div className="lg:col-span-5">
        <form onSubmit={handleSaveProposal} className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
            <h3 className="font-display text-xs font-bold uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
              <Calculator className="w-3.5 h-3.5 text-emerald-600" />
              {editingProposalId ? 'Editar Proposta' : 'Simulador & Registro de Proposta'}
            </h3>
            {editingProposalId && (
              <button
                type="button"
                onClick={() => setEditingProposalId(null)}
                className="text-[11px] font-semibold text-slate-500 hover:text-slate-800"
              >
                Cancelar
              </button>
            )}
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 flex items-center justify-between text-xs">
            <span className="text-slate-600">Dívida Base:</span>
            <strong className="font-mono tabular-nums text-slate-900">{formatBRL(negotiation.originalDebtCents)}</strong>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">Data</label>
              <input
                type="date"
                value={pDate}
                onChange={(e) => setPDate(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-mono"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">Origem</label>
              <select
                value={pOrigin}
                onChange={(e) => setPOrigin(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs bg-white"
              >
                {Object.entries(PROPOSAL_ORIGIN_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">Contato do Banco</label>
            <select
              value={pBankContactId}
              onChange={(e) => setPBankContactId(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs bg-white"
            >
              <option value="">— Mesa Geral ({negotiation.bankName}) —</option>
              {bankContactsList.map((bc) => (
                <option key={bc.id} value={String(bc.id)}>
                  {bc.name} · {bc.sector}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">Valor Proposto (R$) *</label>
              <input
                type="text"
                required
                value={pProposedValue}
                onChange={(e) => handleProposedValueChange(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-mono"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">Desconto (%)</label>
              <input
                type="text"
                value={pDiscountPct}
                onChange={(e) => handleDiscountPctChange(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-mono text-emerald-700 font-bold"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">Entrada (R$)</label>
              <input
                type="text"
                value={pEntryValue}
                onChange={(e) => setPEntryValue(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs font-mono"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">Parcelas</label>
              <input
                type="number"
                min={1}
                max={60}
                value={pInstallments}
                onChange={(e) => setPInstallments(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs font-mono"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">Parcela</label>
              <input
                type="text"
                readOnly
                value={`R$ ${calculatedInstallmentValue}`}
                className="w-full rounded-lg border border-slate-200 bg-slate-100 px-2 py-1.5 text-xs font-mono text-slate-700"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">Status</label>
            <select
              value={pStatus}
              onChange={(e) => setPStatus(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs bg-white"
            >
              {Object.entries(PROPOSAL_STATUS_CONFIG).map(([k, cfg]) => (
                <option key={k} value={k}>
                  {cfg.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">Observações</label>
            <textarea
              rows={2}
              value={pNotes}
              onChange={(e) => setPNotes(e.target.value)}
              placeholder="Condições de pagamento, validade do boleto, alçada..."
              className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs"
            />
          </div>

          <button
            type="submit"
            disabled={savingProposal}
            className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            <Plus className="w-3.5 h-3.5" />
            {editingProposalId ? 'Atualizar Proposta' : 'Registrar Proposta'}
          </button>
        </form>
      </div>

      <div className="lg:col-span-7">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h3 className="font-display text-xs font-bold uppercase tracking-wider text-slate-800 mb-3">
            Histórico de Propostas & Contrapropostas ({proposals.length})
          </h3>

          {proposals.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-200 py-8 text-center text-xs text-slate-500">
              Nenhuma proposta formal registrada ainda.
            </div>
          ) : (
            <div className="divide-y divide-slate-200 rounded-lg border border-slate-200">
              {[...proposals].reverse().map((p) => {
                const stCfg = PROPOSAL_STATUS_CONFIG[p.status] || PROPOSAL_STATUS_CONFIG.AGUARDANDO;
                return (
                  <div key={p.id} className="p-3.5 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-mono tabular-nums font-bold text-slate-800">{formatDateBR(p.date)}</span>
                        <span className="font-semibold text-slate-700">
                          · {PROPOSAL_ORIGIN_LABELS[p.origin] || p.origin}
                        </span>
                        <span className={`rounded-md border px-2 py-0.5 text-[10px] font-semibold ${stCfg.badgeClass}`}>
                          {stCfg.label}
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        {p.status !== 'ACEITA' && (
                          <button
                            type="button"
                            onClick={() => void handleProposalQuickAction(p, 'ACEITA')}
                            className="inline-flex items-center gap-1 rounded bg-emerald-600 px-2 py-1 text-[10px] font-semibold text-white hover:bg-emerald-700"
                          >
                            <CheckCircle2 className="w-3 h-3" />
                            Aceitar
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => void handleProposalQuickAction(p, 'CONTRA_PROPOSTA')}
                          className="inline-flex items-center gap-1 rounded border border-blue-200 bg-blue-50 px-2 py-1 text-[10px] font-semibold text-blue-700 hover:bg-blue-100"
                        >
                          <ArrowRightLeft className="w-3 h-3" />
                          Contra-Proposta
                        </button>
                        {p.status !== 'RECUSADA' && (
                          <button
                            type="button"
                            onClick={() => void handleProposalQuickAction(p, 'RECUSADA')}
                            className="inline-flex items-center gap-1 rounded border border-red-200 bg-red-50 px-2 py-1 text-[10px] font-semibold text-red-700 hover:bg-red-100"
                          >
                            <XCircle className="w-3 h-3" />
                            Recusar
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setEditingProposalId(p.id);
                            setPDate(p.date);
                            setPOrigin(p.origin);
                            setPBankContactId(p.bankContactId ? String(p.bankContactId) : '');
                            setPProposedValue(p.proposedValue);
                            setPDiscountPct(p.discountPercentage || '');
                            setPEntryValue(p.entryValue || '0.00');
                            setPInstallments(String(p.installments || 1));
                            setPStatus(p.status);
                            setPNotes(p.notes || '');
                          }}
                          className="rounded p-1 text-slate-500 hover:bg-slate-100"
                          title="Editar"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDeleteProposal(p.id)}
                          className="rounded p-1 text-red-500 hover:bg-red-50"
                          title="Excluir"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-xs font-mono tabular-nums pt-1">
                      <div>
                        <span className="font-sans text-[10px] text-slate-500 block">Valor Proposto</span>
                        <strong className="text-slate-900">
                          R$ {Number(p.proposedValue || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                        </strong>
                      </div>
                      <div>
                        <span className="font-sans text-[10px] text-slate-500 block">Desconto</span>
                        <strong className="text-emerald-700">{p.discountPercentage || 0}%</strong>
                      </div>
                      <div>
                        <span className="font-sans text-[10px] text-slate-500 block">Condição</span>
                        <strong className="text-slate-800">
                          {p.installments || 1}x de R$ {p.installmentValue || p.proposedValue}
                        </strong>
                      </div>
                    </div>

                    {p.notes && <p className="text-xs text-slate-600">{p.notes}</p>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
