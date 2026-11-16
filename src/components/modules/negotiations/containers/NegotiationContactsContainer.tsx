import React, { useState } from 'react';
import { Edit3, Plus, Trash2 } from 'lucide-react';
import { apiFetch, formatDateBR } from '../../../../lib/api.ts';
import type { BankContactItem, Negotiation } from '../../../../types.ts';
import { CONTACT_RESULT_LABELS, CONTACT_TYPE_LABELS } from '../types.ts';

interface NegotiationContactsContainerProps {
  negotiation: Negotiation;
  bankContactsList: BankContactItem[];
  onUpdated: (updated?: Negotiation) => Promise<void>;
  showToast: (msg: string) => void;
}

export const NegotiationContactsContainer: React.FC<NegotiationContactsContainerProps> = ({
  negotiation,
  bankContactsList,
  onUpdated,
  showToast,
}) => {
  const [editingContactId, setEditingContactId] = useState<number | null>(null);
  const [cDate, setCDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [cTarget, setCTarget] = useState<'CLIENTE' | 'BANCO'>('BANCO');
  const [cBankContactId, setCBankContactId] = useState<string>(
    negotiation.selectedBankContactId ? String(negotiation.selectedBankContactId) : ''
  );
  const [cType, setCType] = useState<string>('WHATSAPP');
  const [cResult, setCResult] = useState<string>('PROPOSTA_APRESENTADA');
  const [cDescription, setCDescription] = useState<string>('');
  const [cResponsible, setCResponsible] = useState<string>(negotiation.collaboratorName || 'Carla Dias');
  const [savingContact, setSavingContact] = useState(false);

  const handleSaveContact = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cDescription.trim()) return;
    setSavingContact(true);
    try {
      const chosenBc = bankContactsList.find((b) => String(b.id) === cBankContactId);
      const payload = {
        date: cDate,
        target: cTarget,
        bankContactId: cTarget === 'BANCO' && cBankContactId ? Number(cBankContactId) : null,
        bankContactName:
          cTarget === 'BANCO' && chosenBc
            ? `${chosenBc.name} (${chosenBc.sector})`
            : cTarget === 'BANCO'
            ? negotiation.bankName
            : '',
        type: cType,
        result: cResult,
        description: cDescription,
        responsible: cResponsible,
      };
      const updated = editingContactId
        ? await apiFetch<Negotiation>(`/api/negotiations/${negotiation.id}/contacts/${editingContactId}`, {
            method: 'PUT',
            body: JSON.stringify(payload),
          })
        : await apiFetch<Negotiation>(`/api/negotiations/${negotiation.id}/contacts`, {
            method: 'POST',
            body: JSON.stringify(payload),
          });
      setEditingContactId(null);
      setCDescription('');
      await onUpdated(updated);
      showToast(editingContactId ? 'Contato atualizado!' : 'Contato registrado na linha do tempo.');
    } catch {
      showToast('Erro ao salvar contato.');
    } finally {
      setSavingContact(false);
    }
  };

  const handleDeleteContact = async (cid: number) => {
    try {
      const updated = await apiFetch<Negotiation>(`/api/negotiations/${negotiation.id}/contacts/${cid}`, {
        method: 'DELETE',
      });
      await onUpdated(updated);
      showToast('Contato removido.');
    } catch {
      showToast('Erro ao remover contato.');
    }
  };

  const contacts = negotiation.contacts || [];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
      <div className="lg:col-span-5">
        <form onSubmit={handleSaveContact} className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
            <h3 className="font-display text-xs font-bold uppercase tracking-wider text-slate-800">
              {editingContactId ? 'Editar Acionamento' : 'Registrar Novo Acionamento'}
            </h3>
            {editingContactId && (
              <button
                type="button"
                onClick={() => {
                  setEditingContactId(null);
                  setCDescription('');
                }}
                className="text-[11px] font-semibold text-slate-500 hover:text-slate-800"
              >
                Cancelar
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">Data</label>
              <input
                type="date"
                required
                value={cDate}
                onChange={(e) => setCDate(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-mono"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">Interlocutor</label>
              <select
                value={cTarget}
                onChange={(e) => setCTarget(e.target.value as 'CLIENTE' | 'BANCO')}
                className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-semibold bg-white"
              >
                <option value="BANCO">Banco ({negotiation.bankName})</option>
                <option value="CLIENTE">Cliente ({negotiation.clientName})</option>
              </select>
            </div>
          </div>

          {cTarget === 'BANCO' && (
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                Contato do Banco Acionado
              </label>
              <select
                value={cBankContactId}
                onChange={(e) => setCBankContactId(e.target.value)}
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
          )}

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">Canal</label>
              <select
                value={cType}
                onChange={(e) => setCType(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs bg-white"
              >
                {Object.entries(CONTACT_TYPE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">Resultado</label>
              <select
                value={cResult}
                onChange={(e) => setCResult(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs bg-white"
              >
                {Object.entries(CONTACT_RESULT_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">Responsável</label>
            <input
              type="text"
              value={cResponsible}
              onChange={(e) => setCResponsible(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">Resumo da Tratativa *</label>
            <textarea
              rows={3}
              required
              value={cDescription}
              onChange={(e) => setCDescription(e.target.value)}
              placeholder="Descreva o que foi tratado com o banco ou cliente..."
              className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs"
            />
          </div>

          <button
            type="submit"
            disabled={savingContact}
            className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            <Plus className="w-3.5 h-3.5" />
            {editingContactId ? 'Salvar Alterações' : 'Registrar Contato'}
          </button>
        </form>
      </div>

      <div className="lg:col-span-7">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h3 className="font-display text-xs font-bold uppercase tracking-wider text-slate-800 mb-3">
            Linha do Tempo de Acionamentos ({contacts.length})
          </h3>
          {contacts.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-200 py-8 text-center text-xs text-slate-500">
              Nenhum contato registrado ainda nesta negociação.
            </div>
          ) : (
            <div className="divide-y divide-slate-200 rounded-lg border border-slate-200">
              {[...contacts].reverse().map((c) => (
                <div key={c.id} className="p-3 flex items-start justify-between gap-3">
                  <div className="space-y-1 min-w-0">
                    <div className="text-[11px] font-semibold text-slate-600">
                      <span className="font-mono tabular-nums text-slate-900">{formatDateBR(c.date)}</span>
                      {' · '}
                      <span className={c.target === 'CLIENTE' ? 'text-purple-700' : 'text-blue-700'}>
                        {c.target === 'CLIENTE' ? 'Cliente' : 'Banco'}
                      </span>
                      {' · '}
                      {CONTACT_TYPE_LABELS[c.type] || c.type}
                      {' · '}
                      <span className="text-emerald-700">{CONTACT_RESULT_LABELS[c.result] || c.result}</span>
                      {c.bankContactName ? ` · ${c.bankContactName}` : ''}
                    </div>
                    <p className="text-xs text-slate-800 leading-relaxed">{c.description}</p>
                    <div className="text-[10px] text-slate-500">Por {c.responsible}</div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingContactId(c.id);
                        setCDate(c.date);
                        setCTarget(c.target || 'BANCO');
                        setCBankContactId(c.bankContactId ? String(c.bankContactId) : '');
                        setCType(c.type);
                        setCResult(c.result);
                        setCResponsible(c.responsible);
                        setCDescription(c.description);
                      }}
                      className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                      title="Editar"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDeleteContact(c.id)}
                      className="rounded p-1.5 text-red-500 hover:bg-red-50 hover:text-red-700"
                      title="Excluir"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
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
