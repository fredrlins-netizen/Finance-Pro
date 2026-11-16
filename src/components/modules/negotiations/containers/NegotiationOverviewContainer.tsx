import React, { useState } from 'react';
import { Building2, CheckCircle2, MessageSquare, Plus, RefreshCw } from 'lucide-react';
import { apiFetch, formatBRL, formatDateBR } from '../../../../lib/api.ts';
import type { BankContactItem, BankItem, BankServiceItem, Negotiation } from '../../../../types.ts';
import { NEGOTIATION_STATUS_CONFIG } from '../types.ts';

interface NegotiationOverviewContainerProps {
  negotiation: Negotiation;
  matchedBank: BankItem | null;
  bankContactsList: BankContactItem[];
  bankServicesList: BankServiceItem[];
  statusVal: string;
  selectedBankContactId: number | null;
  onSelectBankContactId: (id: number | null) => void;
  onOpenBankWhatsapp: (bcId: number) => void;
  onUpdated: (updated?: Negotiation) => Promise<void>;
  showToast: (msg: string) => void;
}

export const NegotiationOverviewContainer: React.FC<NegotiationOverviewContainerProps> = ({
  negotiation,
  matchedBank,
  bankContactsList,
  bankServicesList,
  statusVal,
  selectedBankContactId,
  onSelectBankContactId,
  onOpenBankWhatsapp,
  onUpdated,
  showToast,
}) => {
  const [targetReductionPct, setTargetReductionPct] = useState<number>(negotiation.targetReductionPct || 55);
  const [nextContactDate, setNextContactDate] = useState<string>(negotiation.nextContactDate || '');
  const [nextContactDescription, setNextContactDescription] = useState<string>(
    negotiation.nextContactDescription || ''
  );
  const [notes, setNotes] = useState<string>(negotiation.notes || '');
  const [closedDate, setClosedDate] = useState<string>(negotiation.closedDate || '');
  const [closedValue, setClosedValue] = useState<string>(
    negotiation.closedValue || negotiation.closedValueText || ''
  );
  const [closedInstallments, setClosedInstallments] = useState<string>(
    negotiation.closedInstallments ? String(negotiation.closedInstallments) : '1'
  );
  const [savingMain, setSavingMain] = useState(false);

  // Quick Bank Contact form
  const [showAddBankContact, setShowAddBankContact] = useState(false);
  const [newBcName, setNewBcName] = useState('');
  const [newBcSector, setNewBcSector] = useState('Mesa de Acordos');
  const [newBcMobile, setNewBcMobile] = useState('');
  const [newBcEmail, setNewBcEmail] = useState('');
  const [savingBc, setSavingBc] = useState(false);

  const handleSaveMainData = async () => {
    setSavingMain(true);
    try {
      const updated = await apiFetch<Negotiation>(`/api/negotiations/${negotiation.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          negotiationStatus: statusVal,
          targetReductionPct,
          nextContactDate: nextContactDate || null,
          nextContactDescription: nextContactDescription || null,
          notes,
          selectedBankContactId,
          closedDate: closedDate || null,
          closedValue: closedValue || null,
          closedInstallments: closedInstallments ? Number(closedInstallments) : null,
        }),
      });
      await onUpdated(updated);
      showToast('Dados principais da negociação atualizados.');
    } catch {
      showToast('Falha ao salvar alterações.');
    } finally {
      setSavingMain(false);
    }
  };

  const handleCreateBankContact = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetBankId = matchedBank?.id || negotiation.bankId;
    if (!targetBankId || !newBcName.trim()) return;
    setSavingBc(true);
    try {
      const createdBc = await apiFetch<BankContactItem>(`/api/negotiations/banks/${targetBankId}/contacts`, {
        method: 'POST',
        body: JSON.stringify({
          name: newBcName,
          sector: newBcSector,
          mobile: newBcMobile,
          phone: newBcMobile,
          email: newBcEmail,
          isWhatsapp: true,
        }),
      });
      setNewBcName('');
      setNewBcMobile('');
      setNewBcEmail('');
      setShowAddBankContact(false);
      if (createdBc.id) onSelectBankContactId(createdBc.id);
      await onUpdated();
      showToast(`Contato "${createdBc.name}" cadastrado no banco e vinculado ao WhatsApp.`);
    } catch {
      showToast('Erro ao cadastrar contato bancário.');
    } finally {
      setSavingBc(false);
    }
  };

  const stCfg = NEGOTIATION_STATUS_CONFIG[statusVal] || NEGOTIATION_STATUS_CONFIG.EM_ANDAMENTO;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
      {/* Left 7 cols: Operational Parameters */}
      <div className="lg:col-span-7">
        <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-4 dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2.5 dark:border-slate-800">
            <h3 className="font-display text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200">
              Parâmetros Operacionais da Negociação
            </h3>
            <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-semibold ${stCfg.badgeClass}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${stCfg.dotClass}`} />
              {stCfg.label}
            </span>
          </div>

          <div className="grid grid-cols-3 divide-x divide-slate-200 rounded-lg border border-slate-200 bg-slate-50/70 text-xs dark:divide-slate-700 dark:border-slate-700 dark:bg-slate-800/60">
            <div className="p-2.5">
              <div className="text-[10px] font-semibold uppercase text-slate-500 dark:text-slate-400">Abertura</div>
              <div className="font-mono tabular-nums font-bold text-slate-900 mt-0.5 dark:text-slate-100">
                {formatDateBR(negotiation.openDate || negotiation.createdAt || '')}
              </div>
            </div>
            <div className="p-2.5">
              <div className="text-[10px] font-semibold uppercase text-slate-500 dark:text-slate-400">Valor Dívida</div>
              <div className="font-mono tabular-nums font-bold text-slate-900 mt-0.5 dark:text-slate-100">
                {formatBRL(negotiation.originalDebtCents)}
              </div>
            </div>
            <div className="p-2.5">
              <div className="text-[10px] font-semibold uppercase text-emerald-700 dark:text-emerald-300">Economia Est.</div>
              <div className="font-mono tabular-nums font-bold text-emerald-800 mt-0.5 dark:text-emerald-300">
                {formatBRL(negotiation.estimatedSavingsCents)} ({negotiation.currentReductionPct}%)
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1 dark:text-slate-300">
                Próximo Contato Agendado
              </label>
              <input
                type="date"
                value={nextContactDate}
                onChange={(e) => setNextContactDate(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono text-slate-800 dark:border-slate-600 dark:text-slate-100 dark:bg-slate-950"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1 dark:text-slate-300">
                Meta de Desconto (%)
              </label>
              <input
                type="number"
                min={5}
                max={95}
                value={targetReductionPct}
                onChange={(e) => setTargetReductionPct(Number(e.target.value))}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono text-slate-800 dark:border-slate-600 dark:text-slate-100"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1 dark:text-slate-300">
              Assunto / Pauta do Próximo Contato
            </label>
            <input
              type="text"
              value={nextContactDescription}
              onChange={(e) => setNextContactDescription(e.target.value)}
              placeholder="Ex: Retornar ligação para mesa de acordos com contraproposta aprovada"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-800 dark:border-slate-600 dark:text-slate-100"
            />
          </div>

          {statusVal === 'ACORDO_FECHADO' && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3 grid grid-cols-1 sm:grid-cols-3 gap-3 dark:border-emerald-800/70 dark:bg-emerald-950/50">
              <div>
                <label className="block text-[10px] font-bold uppercase text-emerald-800 mb-1 dark:text-emerald-300">Data Fechamento</label>
                <input
                  type="date"
                  value={closedDate}
                  onChange={(e) => setClosedDate(e.target.value)}
                  className="w-full rounded-lg border border-emerald-300 bg-white px-2.5 py-1.5 text-xs font-mono dark:border-emerald-800/70 dark:bg-slate-900 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase text-emerald-800 mb-1 dark:text-emerald-300">Valor Fechado (R$)</label>
                <input
                  type="text"
                  value={closedValue}
                  onChange={(e) => setClosedValue(e.target.value)}
                  placeholder="12500.00"
                  className="w-full rounded-lg border border-emerald-300 bg-white px-2.5 py-1.5 text-xs font-mono dark:border-emerald-800/70 dark:bg-slate-900 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase text-emerald-800 mb-1 dark:text-emerald-300">Parcelas Acordo</label>
                <input
                  type="number"
                  min={1}
                  max={60}
                  value={closedInstallments}
                  onChange={(e) => setClosedInstallments(e.target.value)}
                  className="w-full rounded-lg border border-emerald-300 bg-white px-2.5 py-1.5 text-xs font-mono dark:border-emerald-800/70 dark:bg-slate-900"
                />
              </div>
            </div>
          )}

          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1 dark:text-slate-300">Observações Estratégicas</label>
            <textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-800 dark:border-slate-600 dark:text-slate-100 dark:bg-slate-950"
            />
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              disabled={savingMain}
              onClick={() => void handleSaveMainData()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-emerald-600 dark:hover:bg-emerald-500"
            >
              {savingMain ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
              Salvar Dados
            </button>
          </div>
        </div>
      </div>

      {/* Right 5 cols: Bank Contacts & Ceilings */}
      <div className="lg:col-span-5">
        <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3 dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2.5 dark:border-slate-800">
            <div>
              <h3 className="font-display text-xs font-bold uppercase tracking-wider text-slate-800 flex items-center gap-1.5 dark:text-slate-100">
                <Building2 className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                Contatos do {matchedBank?.name || negotiation.bankName}
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">Contatos & Alçadas do Cadastro de Bancos</p>
            </div>
            <button
              type="button"
              onClick={() => setShowAddBankContact((prev) => !prev)}
              className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-700 hover:bg-blue-100 whitespace-nowrap dark:border-blue-800/70 dark:bg-blue-950/50 dark:text-blue-300 dark:hover:bg-blue-900/60"
            >
              <Plus className="w-3 h-3" />
              Novo Contato
            </button>
          </div>

          {showAddBankContact && (
            <form
              onSubmit={handleCreateBankContact}
              className="rounded-lg border border-blue-200 bg-blue-50/40 p-3 space-y-2.5 text-xs dark:border-blue-800/70 dark:bg-blue-950/50"
            >
              <div className="font-semibold text-blue-900 dark:text-blue-300">
                Novo Contato · {matchedBank?.name || negotiation.bankName}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input
                  type="text"
                  required
                  placeholder="Nome do Contato *"
                  value={newBcName}
                  onChange={(e) => setNewBcName(e.target.value)}
                  className="rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-900"
                />
                <input
                  type="text"
                  placeholder="Setor / Alçada"
                  value={newBcSector}
                  onChange={(e) => setNewBcSector(e.target.value)}
                  className="rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                />
                <input
                  type="text"
                  placeholder="WhatsApp / Celular"
                  value={newBcMobile}
                  onChange={(e) => setNewBcMobile(e.target.value)}
                  className="rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-mono dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                />
                <input
                  type="email"
                  placeholder="E-mail"
                  value={newBcEmail}
                  onChange={(e) => setNewBcEmail(e.target.value)}
                  className="rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddBankContact(false)}
                  className="rounded border border-slate-300 bg-white px-2.5 py-1 text-[11px] dark:border-slate-600 dark:bg-slate-900"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={savingBc}
                  className="rounded bg-blue-600 px-3 py-1 text-[11px] font-semibold text-white hover:bg-blue-700"
                >
                  {savingBc ? 'Salvando...' : 'Salvar Contato'}
                </button>
              </div>
            </form>
          )}

          {bankContactsList.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-200 p-4 text-center text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
              Nenhum contato cadastrado para este banco. Clique em &ldquo;+ Novo Contato&rdquo;.
            </div>
          ) : (
            <div className="divide-y divide-slate-200 rounded-lg border border-slate-200 overflow-hidden dark:divide-slate-700 dark:border-slate-700">
              {bankContactsList.map((bc) => {
                const isSelected = selectedBankContactId === bc.id;
                return (
                  <div
                    key={bc.id}
                    className={`p-3 flex items-start justify-between gap-2 ${
                      isSelected ? 'bg-blue-50/40 dark:bg-blue-950/50' : 'bg-white dark:bg-slate-900'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-slate-900 dark:text-slate-100">
                        {bc.name}
                        {isSelected && (
                          <span className="ml-1.5 text-[10px] font-semibold text-blue-700 dark:text-blue-300">· Ativo</span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">{bc.sector}</div>
                      <div className="text-[11px] font-mono tabular-nums text-slate-700 mt-1 dark:text-slate-200">
                        {[bc.mobile, bc.phone, bc.email].filter(Boolean).join(' · ') || 'Sem telefone/e-mail'}
                      </div>
                    </div>
                    <div className="flex flex-col gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => onSelectBankContactId(bc.id ?? null)}
                        className="rounded border border-slate-300 bg-white px-2 py-1 text-[10px] font-semibold text-slate-700 hover:bg-slate-100 whitespace-nowrap dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                      >
                        {isSelected ? 'Selecionado' : 'Selecionar'}
                      </button>
                      <button
                        type="button"
                        onClick={() => onOpenBankWhatsapp(bc.id || 0)}
                        className="inline-flex items-center justify-center gap-1 rounded bg-emerald-600 px-2 py-1 text-[10px] font-semibold text-white hover:bg-emerald-700 whitespace-nowrap"
                      >
                        <MessageSquare className="w-3 h-3" />
                        WhatsApp
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-2 dark:text-slate-300">
              Tetos de Alçada do Banco
            </div>
            {bankServicesList.length === 0 ? (
              <div className="text-xs text-slate-500 dark:text-slate-400">Sem parâmetros cadastrados.</div>
            ) : (
              <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-slate-50/50 dark:divide-slate-800 dark:border-slate-700 dark:bg-slate-800/60">
                {bankServicesList.map((srv) => (
                  <div key={srv.id} className="flex items-center justify-between px-3 py-2 text-xs">
                    <div>
                      <div className="font-semibold text-slate-800 dark:text-slate-100">{srv.name}</div>
                      <div className="text-[10px] text-slate-500 dark:text-slate-400">{srv.modalityDescription}</div>
                    </div>
                    <div className="text-right font-mono tabular-nums">
                      <span className="font-bold text-emerald-700 dark:text-emerald-300">{srv.negotiationPercent}%</span>
                      <div className="text-[10px] text-slate-500 dark:text-slate-400">Até {srv.defaultInstallments}x</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
