import React, { useEffect, useMemo, useState } from 'react';
import { Plus, RefreshCw, X } from 'lucide-react';
import { apiFetch, formatBRL, formatDateBR } from '../../../lib/api.ts';
import type {
  Admission,
  BankItem,
  Client,
  CollaboratorItem,
  FinancialTitle,
  Negotiation,
} from '../../../types.ts';

interface NewNegotiationModalContainerProps {
  open: boolean;
  preselectedTitle?: (FinancialTitle & { currentBalance?: string; bankName?: string; collaboratorName?: string }) | null;
  clients: Client[];
  admissions: Admission[];
  banks: BankItem[];
  collaborators: CollaboratorItem[];
  availableTitles: Array<FinancialTitle & { currentBalance?: string; bankName?: string; collaboratorName?: string }>;
  onClose: () => void;
  onCreated: (created: Negotiation) => void;
}

export const NewNegotiationModalContainer: React.FC<NewNegotiationModalContainerProps> = ({
  open,
  preselectedTitle,
  clients,
  admissions,
  banks,
  collaborators,
  availableTitles,
  onClose,
  onCreated,
}) => {
  const [selectedTitleId, setSelectedTitleId] = useState<string>('');
  const [clientId, setClientId] = useState<string>('');
  const [admissionId, setAdmissionId] = useState<string>('');
  const [bankId, setBankId] = useState<string>('');
  const [selectedBankContactId, setSelectedBankContactId] = useState<string>('');
  const [collaboratorId, setCollaboratorId] = useState<string>('');
  const [contractNumber, setContractNumber] = useState<string>('');
  const [debtValue, setDebtValue] = useState<string>('');
  const [targetReductionPct, setTargetReductionPct] = useState<string>('55');
  const [openDate, setOpenDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [nextContactDate, setNextContactDate] = useState<string>('');
  const [nextContactDescription, setNextContactDescription] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (!open) return;
    setErrorMsg('');
    if (preselectedTitle) {
      setSelectedTitleId(String(preselectedTitle.id));
      setClientId(String(preselectedTitle.clientId));
      const adm = preselectedTitle.admissionId
        ? admissions.find((a) => a.id === preselectedTitle.admissionId)
        : admissions.find((a) => a.clientId === preselectedTitle.clientId);
      setAdmissionId(adm ? String(adm.id) : '');
      const bnk =
        banks.find((b) =>
          b.name
            .toLowerCase()
            .includes((adm?.bankName || preselectedTitle.bankName || '').toLowerCase().replace('banco ', '').trim())
        ) || banks[0];
      setBankId(bnk ? String(bnk.id) : '');
      setSelectedBankContactId(bnk?.contacts?.[0] ? String(bnk.contacts[0].id) : '');
      setCollaboratorId(
        preselectedTitle.assignedCollaboratorId
          ? String(preselectedTitle.assignedCollaboratorId)
          : collaborators[0]
          ? String(collaborators[0].id)
          : ''
      );
      setContractNumber(
        preselectedTitle.contractNumber || adm?.contractNumber || preselectedTitle.documentNumber || preselectedTitle.titleCode
      );
      const balCents = preselectedTitle.currentBalanceCents || preselectedTitle.amountCents || 0;
      setDebtValue((balCents / 100).toFixed(2));
      const ceilingPct = bnk?.services?.[0]?.negotiationPercent;
      setTargetReductionPct(ceilingPct ? String(Math.round(parseFloat(ceilingPct))) : '55');
      setOpenDate(new Date().toISOString().slice(0, 10));
      setNextContactDate(new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10));
      setNextContactDescription(`Acionar mesa de acordos (${bnk?.name || 'Banco'}) para proposta inicial`);
      setNotes(`Negociação iniciada a partir do título ${preselectedTitle.documentNumber || preselectedTitle.titleCode}.`);
    } else {
      setSelectedTitleId('');
      setClientId(clients[0] ? String(clients[0].id) : '');
      setAdmissionId('');
      const bnk = banks[0];
      setBankId(bnk ? String(bnk.id) : '');
      setSelectedBankContactId(bnk?.contacts?.[0] ? String(bnk.contacts[0].id) : '');
      setCollaboratorId(collaborators[0] ? String(collaborators[0].id) : '');
      setContractNumber('');
      setDebtValue('25000.00');
      setTargetReductionPct('55');
      setOpenDate(new Date().toISOString().slice(0, 10));
      setNextContactDate(new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10));
      setNextContactDescription('');
      setNotes('');
    }
  }, [open, preselectedTitle, clients, admissions, banks, collaborators]);

  const activeBank = useMemo(() => banks.find((b) => String(b.id) === bankId) || null, [banks, bankId]);
  const clientAdmissions = useMemo(
    () => admissions.filter((a) => String(a.clientId) === clientId),
    [admissions, clientId]
  );

  if (!open) return null;

  const handleSelectTitle = (tid: string) => {
    setSelectedTitleId(tid);
    const t = availableTitles.find((item) => String(item.id) === tid);
    if (!t) return;
    setClientId(String(t.clientId));
    const adm = t.admissionId
      ? admissions.find((a) => a.id === t.admissionId)
      : admissions.find((a) => a.clientId === t.clientId);
    if (adm) setAdmissionId(String(adm.id));
    const bnk = banks.find((b) =>
      b.name.toLowerCase().includes((adm?.bankName || t.bankName || '').toLowerCase().replace('banco ', '').trim())
    );
    if (bnk) {
      setBankId(String(bnk.id));
      setSelectedBankContactId(bnk.contacts?.[0] ? String(bnk.contacts[0].id) : '');
    }
    setContractNumber(t.contractNumber || adm?.contractNumber || t.documentNumber || t.titleCode);
    const balCents = t.currentBalanceCents || t.amountCents || 0;
    setDebtValue((balCents / 100).toFixed(2));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientId) {
      setErrorMsg('Selecione um cliente.');
      return;
    }
    setSaving(true);
    setErrorMsg('');
    try {
      const selectedClient = clients.find((c) => String(c.id) === clientId);
      const selectedCollab = collaborators.find((c) => String(c.id) === collaboratorId);
      const created = await apiFetch<Negotiation>('/api/negotiations', {
        method: 'POST',
        body: JSON.stringify({
          titleId: selectedTitleId ? Number(selectedTitleId) : null,
          clientId: Number(clientId),
          clientName: selectedClient?.fullName || '',
          admissionId: admissionId ? Number(admissionId) : null,
          bankId: bankId ? Number(bankId) : null,
          bankName: activeBank?.name || 'Banco BV',
          selectedBankContactId: selectedBankContactId ? Number(selectedBankContactId) : null,
          collaboratorId: collaboratorId ? Number(collaboratorId) : null,
          collaboratorName: selectedCollab?.name || 'Carla Dias',
          contractNumber: contractNumber || `CTR-${Date.now().toString().slice(-5)}`,
          debtValue,
          targetReductionPct: Number(targetReductionPct || 55),
          openDate,
          nextContactDate: nextContactDate || null,
          nextContactDescription: nextContactDescription || null,
          notes,
          negotiationStatus: 'ABERTA',
        }),
      });
      onCreated(created);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao criar negociação.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 dark:bg-slate-950/80" onClick={onClose}>
      <div
        className="w-full max-w-2xl rounded-xl border border-slate-200 bg-white shadow-2xl overflow-hidden dark:border-slate-700 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-900 px-5 py-3.5 text-white dark:border-slate-700 dark:bg-emerald-600">
          <div className="flex items-center gap-2">
            <Plus className="w-4 h-4 text-emerald-400" />
            <h3 className="font-display text-sm font-bold">Nova Negociação Bancária</h3>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-slate-300 hover:bg-slate-800">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4 max-h-[82vh] overflow-y-auto">
          {errorMsg && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300">{errorMsg}</div>
          )}

          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1 dark:text-slate-300">
              Vincular Título a Receber Disponível (Opcional)
            </label>
            <select
              value={selectedTitleId}
              onChange={(e) => handleSelectTitle(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-800 focus:border-blue-600 focus:bg-white focus:outline-none dark:border-slate-600 dark:bg-slate-800/70 dark:text-slate-100 dark:focus:bg-slate-900"
            >
              <option value="">— Selecionar manualmente Cliente / Contrato —</option>
              {availableTitles.map((t) => (
                <option key={t.id} value={String(t.id)}>
                  {t.documentNumber || t.titleCode} · {t.clientName} · Venc: {formatDateBR(t.dueDate)} · Saldo:{' '}
                  {formatBRL(t.currentBalanceCents || t.amountCents)}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1 dark:text-slate-300">
                Cliente *
              </label>
              <select
                required
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-800 bg-white dark:border-slate-600 dark:text-slate-100 dark:bg-slate-900"
              >
                <option value="">Selecione...</option>
                {clients.map((c) => (
                  <option key={c.id} value={String(c.id)}>
                    {c.fullName} ({c.cpfCnpj})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1 dark:text-slate-300">
                Dossiê de Admissão / Contrato
              </label>
              <select
                value={admissionId}
                onChange={(e) => {
                  setAdmissionId(e.target.value);
                  const adm = admissions.find((a) => String(a.id) === e.target.value);
                  if (adm) {
                    setContractNumber(adm.contractNumber);
                    setDebtValue((adm.debtAmountCents / 100).toFixed(2));
                  }
                }}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-800 bg-white dark:border-slate-600 dark:text-slate-100 dark:bg-slate-900"
              >
                <option value="">— Sem admissão específica —</option>
                {clientAdmissions.map((a) => (
                  <option key={a.id} value={String(a.id)}>
                    {a.protocolCode} · {a.contractNumber} ({a.bankName})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1 dark:text-slate-300">
                Banco Credor *
              </label>
              <select
                value={bankId}
                onChange={(e) => {
                  setBankId(e.target.value);
                  const b = banks.find((item) => String(item.id) === e.target.value);
                  setSelectedBankContactId(b?.contacts?.[0] ? String(b.contacts[0].id) : '');
                  if (b?.services?.[0]?.negotiationPercent) {
                    setTargetReductionPct(String(Math.round(parseFloat(b.services[0].negotiationPercent))));
                  }
                }}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-800 bg-white dark:border-slate-600 dark:text-slate-100 dark:bg-slate-900"
              >
                {banks.map((b) => (
                  <option key={b.id} value={String(b.id)}>
                    {b.name} ({b.febrabanCode || b.code})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1 dark:text-slate-300">
                Contato do Banco (Tabela de Bancos)
              </label>
              <select
                value={selectedBankContactId}
                onChange={(e) => setSelectedBankContactId(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-800 bg-white dark:border-slate-600 dark:text-slate-100 dark:bg-slate-900"
              >
                <option value="">— Selecionar contato do banco —</option>
                {(activeBank?.contacts || []).map((bc) => (
                  <option key={bc.id} value={String(bc.id)}>
                    {bc.name} · {bc.sector} ({bc.mobile || bc.phone})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1 dark:text-slate-300">
                Nº do Contrato
              </label>
              <input
                type="text"
                value={contractNumber}
                onChange={(e) => setContractNumber(e.target.value)}
                placeholder="Ex: CTR-2025-8821"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono text-slate-800 dark:border-slate-600 dark:text-slate-100 dark:bg-slate-950"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1 dark:text-slate-300">
                Negociador Responsável *
              </label>
              <select
                value={collaboratorId}
                onChange={(e) => setCollaboratorId(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-800 bg-white dark:border-slate-600 dark:text-slate-100 dark:bg-slate-900"
              >
                {collaborators.map((col) => (
                  <option key={col.id} value={String(col.id)}>
                    {col.name} ({col.jobTitle || 'Negociador'})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1 dark:text-slate-300">
                Valor da Dívida (R$) *
              </label>
              <input
                type="text"
                required
                value={debtValue}
                onChange={(e) => setDebtValue(e.target.value)}
                placeholder="25000.00"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono text-slate-800 dark:border-slate-600 dark:text-slate-100 dark:bg-slate-950"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1 dark:text-slate-300">
                Meta de Redução / Deságio (%)
              </label>
              <input
                type="number"
                min={5}
                max={95}
                value={targetReductionPct}
                onChange={(e) => setTargetReductionPct(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono text-slate-800 dark:border-slate-600 dark:text-slate-100 dark:bg-slate-950"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1 dark:text-slate-300">
                Data de Abertura
              </label>
              <input
                type="date"
                value={openDate}
                onChange={(e) => setOpenDate(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono text-slate-800 dark:border-slate-600 dark:text-slate-100 dark:bg-slate-950"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1 dark:text-slate-300">
                Data Próximo Contato
              </label>
              <input
                type="date"
                value={nextContactDate}
                onChange={(e) => setNextContactDate(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono text-slate-800 dark:border-slate-600 dark:text-slate-100 dark:bg-slate-950"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1 dark:text-slate-300">
              Pauta Próximo Contato
            </label>
            <input
              type="text"
              value={nextContactDescription}
              onChange={(e) => setNextContactDescription(e.target.value)}
              placeholder="Ex: Retornar contato com o contato da mesa bancária..."
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-800 dark:border-slate-600 dark:text-slate-100"
            />
          </div>

          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1 dark:text-slate-300">
              Observações Iniciais
            </label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-800 dark:border-slate-600 dark:text-slate-100 dark:bg-slate-950"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-700">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {saving && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
              {saving ? 'Criando...' : 'Criar Negociação'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
