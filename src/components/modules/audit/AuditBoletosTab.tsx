import React, { useState } from 'react';
import {
  AlertCircle,
  Banknote,
  CheckCircle2,
  Edit3,
  History,
  Loader2,
  Plus,
  RotateCcw,
} from 'lucide-react';
import { apiFetch, formatBRL, formatDateBR, formatDateTimeBR } from '../../../lib/api.ts';
import { Admission, AuditLogEntry, FinancialTitle, ModuleId, NavigationIntent } from '../../../types.ts';

interface AuditBoletosTabProps {
  admission: Admission;
  clientName: string;
  titles: FinancialTitle[];
  auditLogs: AuditLogEntry[];
  onRefreshContext: () => Promise<void>;
  onNavigate?: (mod: ModuleId, intent?: NavigationIntent) => void;
}

function toInputDate(raw: string | undefined | null): string {
  if (!raw) return new Date().toISOString().slice(0, 10);
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
  return d.toISOString().slice(0, 10);
}

export const AuditBoletosTab: React.FC<AuditBoletosTabProps> = ({
  admission,
  clientName,
  titles,
  auditLogs,
  onRefreshContext,
  onNavigate,
}) => {
  const [provider, setProvider] = useState('santander');
  const [genMode, setGenMode] = useState<'par_inicial' | 'taxa_adm' | 'primeira_parcela'>('par_inicial');
  const [customAmountReais, setCustomAmountReais] = useState(
    ((admission.initialInstallmentCents || 50000) / 100).toFixed(2)
  );
  const [customDueDate, setCustomDueDate] = useState(
    new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10)
  );
  const [allowDuplicate, setAllowDuplicate] = useState(false);
  const [busyGen, setBusyGen] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const [editingTitleId, setEditingTitleId] = useState<number | null>(null);
  const [editAmountReais, setEditAmountReais] = useState('');
  const [editDueDate, setEditDueDate] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  const activeTitles = titles.filter((t) => String(t.status || '').toUpperCase() !== 'CANCELADO');
  const totalBilledCents = activeTitles.reduce((acc, t) => acc + (t.originalValueCents || t.amountCents), 0);
  const openBalanceCents = activeTitles.reduce(
    (acc, t) => acc + (['PAGO', 'CANCELADO'].includes(String(t.status).toUpperCase()) ? 0 : t.currentBalanceCents || t.amountCents),
    0
  );

  const critiques = Array.isArray(admission.auditCritiquesJson) ? admission.auditCritiquesJson : [];

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusyGen(true);
    setFeedback('');
    setErrorMsg('');
    try {
      const amountCents = Math.round(Number(customAmountReais.replace(',', '.')) * 100);
      const res = await apiFetch<{ titles: FinancialTitle[] }>(
        `/api/audit/${admission.id}/generate-boletos`,
        {
          method: 'POST',
          body: JSON.stringify({
            mode: genMode,
            boletoProvider: provider,
            amountCents: genMode === 'par_inicial' ? undefined : amountCents,
            dueDate: genMode === 'par_inicial' ? undefined : customDueDate,
            allowDuplicate,
          }),
        }
      );
      setFeedback(
        `${res.titles.length} lançamento(s) criado(s) em Contas a Receber (${provider.toUpperCase()}) vinculado(s) à ficha ${admission.protocolCode}.`
      );
      setAllowDuplicate(false);
      await onRefreshContext();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao gerar boleto(s).');
    } finally {
      setBusyGen(false);
    }
  };

  const startEdit = (t: FinancialTitle) => {
    setEditingTitleId(t.id);
    setEditAmountReais(((t.amountCents || 0) / 100).toFixed(2));
    setEditDueDate(toInputDate(t.dueDate));
  };

  const handleSaveEdit = async (title: FinancialTitle) => {
    const newCents = Math.round(Number(editAmountReais.replace(',', '.')) * 100);
    if (!newCents || newCents <= 0) {
      setErrorMsg('Informe um valor maior que zero.');
      return;
    }
    setSavingEdit(true);
    setErrorMsg('');
    setFeedback('');
    try {
      await apiFetch(`/api/financial-titles/${title.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          amountCents: newCents,
          dueDate: editDueDate,
          scope: 'RECEBER',
          status: title.status, // preserves real status cleanly without forcing ABERTO
        }),
      });
      setEditingTitleId(null);
      setFeedback(`Título ${title.titleCode} atualizado com sucesso.`);
      await onRefreshContext();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao atualizar título.');
    } finally {
      setSavingEdit(false);
    }
  };

  return (
    <div className="space-y-5">
      {feedback && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs font-medium text-emerald-900">
          {feedback}
        </div>
      )}
      {errorMsg && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-900">
          {errorMsg}
        </div>
      )}

      {/* Linked Receivables & Generation */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div>
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Banknote className="w-4 h-4 text-emerald-600" />
              Boletos & Títulos Gerados em Contas a Receber ({titles.length})
            </h3>
            <p className="text-xs text-slate-500">
              Total ativo faturado: <span className="font-mono font-semibold text-slate-800 tabular-nums">{formatBRL(totalBilledCents)}</span> · Saldo em aberto:{' '}
              <span className="font-mono font-semibold text-amber-700 tabular-nums">{formatBRL(openBalanceCents)}</span>
            </p>
          </div>

          {onNavigate && (
            <button
              type="button"
              onClick={() => onNavigate('finance_receber', { clientId: admission.clientId })}
              className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-slate-100 whitespace-nowrap"
            >
              Abrir em Contas a Receber →
            </button>
          )}
        </div>

        {/* Titles List */}
        {titles.length === 0 ? (
          <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-4 text-xs text-slate-600">
            Nenhum boleto vinculado ainda. Ao finalizar e aprovar a auditoria, 2 boletos iniciais são gerados automaticamente — ou você pode lançá-los antecipadamente abaixo para revisar vencimentos.
          </div>
        ) : (
          <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {titles.map((t) => {
              const stUpper = String(t.status || '').toUpperCase();
              const isEditable = !['PAGO', 'CANCELADO', 'AGRUPADO'].includes(stUpper);
              const isEditing = editingTitleId === t.id;
              return (
                <div key={t.id} className="p-3.5 text-xs space-y-2">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="space-y-0.5 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono font-bold text-slate-900">{t.titleCode}</span>
                        <span className="text-slate-300">·</span>
                        <span className="font-mono text-slate-600">Doc: {t.documentNumber || '—'}</span>
                        <span className="text-slate-300">·</span>
                        <span
                          className={`font-semibold ${
                            stUpper === 'PAGO'
                              ? 'text-emerald-700'
                              : stUpper === 'CANCELADO'
                              ? 'text-slate-400'
                              : stUpper === 'VENCIDO'
                              ? 'text-red-700'
                              : 'text-amber-700'
                          }`}
                        >
                          {stUpper}
                        </span>
                        <span className="text-slate-300">·</span>
                        <span className="uppercase text-slate-500">{t.boletoProvider}</span>
                      </div>
                      <div className="text-slate-600 truncate">
                        {t.description || `Parcela ${t.installmentNumber}/${t.totalInstallments}`}
                      </div>
                      {t.barcode && (
                        <div className="font-mono text-[11px] text-slate-400 truncate">
                          Linha digitável: {t.barcode}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      <div className="text-right font-mono">
                        <div className="font-bold text-slate-900 tabular-nums">{formatBRL(t.amountCents)}</div>
                        <div className="text-[11px] text-slate-500 tabular-nums">
                          Venc. {formatDateBR(t.dueDate)}
                        </div>
                      </div>

                      {isEditable && !isEditing && (
                        <button
                          type="button"
                          onClick={() => startEdit(t)}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                          Editar
                        </button>
                      )}
                    </div>
                  </div>

                  {isEditing && (
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 flex flex-wrap items-end gap-3">
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                          Valor (R$)
                        </label>
                        <input
                          type="text"
                          value={editAmountReais}
                          onChange={(e) => setEditAmountReais(e.target.value)}
                          className="w-32 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                          Vencimento
                        </label>
                        <input
                          type="date"
                          value={editDueDate}
                          onChange={(e) => setEditDueDate(e.target.value)}
                          className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
                        />
                      </div>
                      <div className="flex items-center gap-2 ml-auto">
                        <button
                          type="button"
                          onClick={() => setEditingTitleId(null)}
                          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700"
                        >
                          Cancelar
                        </button>
                        <button
                          type="button"
                          disabled={savingEdit}
                          onClick={() => handleSaveEdit(t)}
                          className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                        >
                          {savingEdit ? 'Salvando...' : 'Salvar Alterações'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Unified Issuance Box (replaces legacy Boleto + Gerar Lançamentos conflict) */}
        <form onSubmit={handleGenerate} className="rounded-lg border border-slate-200 bg-slate-50/70 p-3.5 space-y-3 text-xs">
          <div className="font-bold text-slate-900">
            Emitir Lançamentos Antecipados / Avulsos ({clientName})
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Modalidade de Lançamento</label>
              <select
                value={genMode}
                onChange={(e) => setGenMode(e.target.value as typeof genMode)}
                className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs"
              >
                <option value="par_inicial">2 Boletos Iniciais (Entrada + 1ª Parcela)</option>
                <option value="taxa_adm">Taxa Administrativa (1 lançamento)</option>
                <option value="primeira_parcela">1ª Parcela (1 lançamento)</option>
              </select>
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Banco / API Emissora</label>
              <select
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs"
              >
                <option value="santander">API Santander (Padrão)</option>
                <option value="terceiros">API Terceiros (Cora / Inter)</option>
              </select>
            </div>
            {genMode !== 'par_inicial' && (
              <>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Valor (R$)</label>
                  <input
                    type="text"
                    value={customAmountReais}
                    onChange={(e) => setCustomAmountReais(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 font-mono text-xs"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Vencimento</label>
                  <input
                    type="date"
                    value={customDueDate}
                    onChange={(e) => setCustomDueDate(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs"
                  />
                </div>
              </>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            {activeTitles.length > 0 ? (
              <label className="inline-flex items-center gap-2 text-amber-800 font-medium cursor-pointer">
                <input
                  type="checkbox"
                  checked={allowDuplicate}
                  onChange={(e) => setAllowDuplicate(e.target.checked)}
                />
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>Permitir geração adicional além dos {activeTitles.length} título(s) existente(s)</span>
              </label>
            ) : (
              <span className="text-slate-500">Sem risco de duplicidade: nenhum título ativo na ficha.</span>
            )}

            <button
              type="submit"
              disabled={busyGen}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50 min-h-[38px]"
            >
              {busyGen ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              Gerar Lançamento(s)
            </button>
          </div>
        </form>
      </div>

      {/* Critique Rounds Auditoria <-> Comercial */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
        <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
          <RotateCcw className="w-4 h-4 text-amber-600" />
          Histórico de Devoluções · Auditoria ↔ Comercial ({critiques.length})
        </h3>
        {critiques.length === 0 && !admission.auditRejectionReason ? (
          <p className="text-xs text-slate-500">Nenhuma devolução registrada até o momento.</p>
        ) : (
          <div className="space-y-2.5 text-xs">
            {critiques.map((c) => (
              <div key={c.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-1.5">
                <div className="flex items-center justify-between text-[11px] text-slate-500 font-mono">
                  <span className="font-bold text-red-700">
                    Round #{c.round} · {c.author}
                  </span>
                  <span>{formatDateTimeBR(c.createdAt)}</span>
                </div>
                <p className="text-slate-800 whitespace-pre-line">{c.reason}</p>
                {c.commercialResponse ? (
                  <div className="pt-1.5 border-t border-slate-200 text-emerald-900">
                    <span className="font-semibold">Resposta do Comercial ({c.respondedBy || 'Comercial'}):</span>{' '}
                    {c.commercialResponse}
                  </div>
                ) : (
                  <div className="text-[11px] font-medium text-amber-700">
                    Aguardando resposta/correção da Admissão & Comercial.
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Technical Audit Logs */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
        <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
          <History className="w-4 h-4 text-slate-600" />
          Trilha Técnica de Auditoria ({auditLogs.length})
        </h3>
        {auditLogs.length === 0 ? (
          <p className="text-xs text-slate-500">Nenhum evento técnico registrado ainda para este protocolo.</p>
        ) : (
          <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 max-h-60 overflow-y-auto text-xs">
            {auditLogs.map((log) => (
              <div key={log.id} className="px-3 py-2 flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                <div className="min-w-0">
                  <span className="font-mono font-bold text-slate-900">{log.action}</span>
                  <span className="text-slate-400 mx-1.5">·</span>
                  <span className="text-slate-700">{log.userName}</span>
                </div>
                <span className="font-mono text-[11px] text-slate-500 tabular-nums shrink-0">
                  {formatDateTimeBR(log.createdAt)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
