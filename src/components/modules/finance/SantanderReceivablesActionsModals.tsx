import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Barcode,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock,
  ExternalLink,
  Eye,
  Landmark,
  Loader2,
  MessageSquare,
  QrCode,
  RefreshCw,
  X,
} from 'lucide-react';
import { apiFetch, formatBRL } from '../../../lib/api.ts';
import { BankAccount, FinancialTitle } from '../../../types.ts';
import { formatIsoDateToBR } from './currencyAndParsers.ts';
import { SendBoletoWhatsappModal } from './SendBoletoWhatsappModal.tsx';

function isSantanderAccount(acc: BankAccount): boolean {
  if (acc.apiProvider === 'santander') return true;
  if (acc.febrabanCode === '033') return true;
  return acc.bankName.toLowerCase().includes('santander');
}

function titleHasBoleto(t: FinancialTitle): boolean {
  return Boolean(
    (t.barcode || '').trim() ||
      (t.digitableLine || '').trim() ||
      (t.santanderBankSlipId || '').trim()
  );
}

function getDefaultSantanderAccount(accounts: BankAccount[], preferredId?: number | null): BankAccount | null {
  const active = accounts.filter((a) => a.active !== false);
  return (
    active.find((a) => a.apiProvider === 'santander' && a.isDefaultBoletoAccount && a.apiIntegrationEnabled) ||
    active.find((a) => a.apiProvider === 'santander' && a.apiIntegrationEnabled) ||
    active.find((a) => isSantanderAccount(a)) ||
    (preferredId ? active.find((a) => a.id === preferredId) : undefined) ||
    active[0] ||
    null
  );
}

/* ============================================================================
 * 1. EMITIR / REEMITIR BOLETO MODAL (COM OU SEM ALTERAÇÃO DE VENCIMENTO)
 * ========================================================================== */

interface EmitReissueResultRow {
  titleId: number;
  documentNumber: string;
  mode: 'EMISSAO' | 'REEMISSAO';
  ok: boolean;
  dueDate?: string;
  ourNumber?: string;
  digitableLine?: string;
  error?: string;
}

interface EmitReissueBoletoModalProps {
  open: boolean;
  titles: FinancialTitle[];
  bankAccounts: BankAccount[];
  onClose: () => void;
  onCompleted: (msg: string) => Promise<void>;
  onViewBoleto?: (titleId: number) => void;
}

export const EmitReissueBoletoModal: React.FC<EmitReissueBoletoModalProps> = ({
  open,
  titles,
  bankAccounts,
  onClose,
  onCompleted,
  onViewBoleto,
}) => {
  const [selectedBankAccountId, setSelectedBankAccountId] = useState<number | null>(null);
  const [bankDropdownOpen, setBankDropdownOpen] = useState(false);
  const [alterDueDate, setAlterDueDate] = useState(false);
  const [newDueDate, setNewDueDate] = useState('');
  const [includePixQr, setIncludePixQr] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [sendNotice, setSendNotice] = useState('');
  const [sendTargetTitleId, setSendTargetTitleId] = useState<number | null>(null);
  const [results, setResults] = useState<EmitReissueResultRow[] | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  const sortedAccounts = useMemo(() => {
    const active = bankAccounts.filter((a) => a.active !== false);
    return active.slice().sort((a, b) => {
      const aDefault = a.apiProvider === 'santander' && a.isDefaultBoletoAccount && a.apiIntegrationEnabled ? 0 : 1;
      const bDefault = b.apiProvider === 'santander' && b.isDefaultBoletoAccount && b.apiIntegrationEnabled ? 0 : 1;
      if (aDefault !== bDefault) return aDefault - bDefault;
      const aSant = isSantanderAccount(a) ? 0 : 1;
      const bSant = isSantanderAccount(b) ? 0 : 1;
      if (aSant !== bSant) return aSant - bSant;
      return a.bankName.localeCompare(b.bankName);
    });
  }, [bankAccounts]);

  const defaultAccount = useMemo(
    () => getDefaultSantanderAccount(sortedAccounts, titles[0]?.bankAccountId),
    [sortedAccounts, titles]
  );

  useEffect(() => {
    if (!open) return;
    setErr('');
    setSendNotice('');
    setSendTargetTitleId(null);
    setResults(null);
    setBankDropdownOpen(false);
    setSelectedBankAccountId(defaultAccount?.id ?? null);
    setIncludePixQr(Boolean(defaultAccount?.santanderSummary?.hybridBoletoPixEnabled ?? true));
    const hasAnyBoleto = titles.some(titleHasBoleto);
    setAlterDueDate(false);
    const firstDue = titles[0]?.dueDate ? new Date(titles[0].dueDate).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
    setNewDueDate(hasAnyBoleto ? firstDue : new Date().toISOString().slice(0, 10));
  }, [open, defaultAccount, titles]);

  useEffect(() => {
    const onOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setBankDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, []);

  const selectedAccount = useMemo(
    () => sortedAccounts.find((a) => a.id === selectedBankAccountId) || defaultAccount,
    [sortedAccounts, selectedBankAccountId, defaultAccount]
  );

  const selectedIsSantanderApi = Boolean(selectedAccount && selectedAccount.apiProvider === 'santander');

  const classified = useMemo(() => {
    return titles.map((t) => {
      const st = String(t.status || '').toUpperCase();
      const tType = String(t.titleType || 'PADRAO').toUpperCase();
      const ineligibleReason =
        tType !== 'PADRAO'
          ? 'Tipo não padrão'
          : ['PAGO', 'CANCELADO', 'AGRUPADO', 'DEVOLUCAO_VINCULADA'].includes(st)
          ? `Status ${st}`
          : '';
      const hasBoleto = titleHasBoleto(t);
      return {
        title: t,
        eligible: !ineligibleReason,
        ineligibleReason,
        hasBoleto,
      };
    });
  }, [titles]);

  const eligibleItems = useMemo(() => classified.filter((c) => c.eligible), [classified]);
  const emissaoCount = eligibleItems.filter((c) => !c.hasBoleto).length;
  const reemissaoCount = eligibleItems.filter((c) => c.hasBoleto).length;

  const handleSubmit = async () => {
    setErr('');
    if (eligibleItems.length === 0) {
      setErr('Nenhum dos títulos marcados está elegível para emissão ou reemissão de boleto.');
      return;
    }
    if (!selectedAccount || !selectedIsSantanderApi) {
      setErr('Selecione uma Conta Corrente com API Santander configurada.');
      return;
    }
    if (alterDueDate && !/^\d{4}-\d{2}-\d{2}$/.test(newDueDate)) {
      setErr('Informe a nova data de vencimento.');
      return;
    }

    setBusy(true);
    try {
      const res = await apiFetch<{
        emittedCount: number;
        reissuedCount: number;
        errorCount: number;
        results: EmitReissueResultRow[];
      }>('/api/santander/titles/emit-reissue', {
        method: 'POST',
        body: JSON.stringify({
          titleIds: eligibleItems.map((c) => c.title.id),
          bankAccountId: selectedAccount.id,
          alterDueDate,
          newDueDate: alterDueDate ? newDueDate : undefined,
          includePixQr,
        }),
      });
      setResults(res.results || []);
      const parts: string[] = [];
      if (res.emittedCount > 0) parts.push(`${res.emittedCount} boleto(s) emitido(s)`);
      if (res.reissuedCount > 0) parts.push(`${res.reissuedCount} boleto(s) reemitido(s)`);
      if (res.errorCount > 0) parts.push(`${res.errorCount} falha(s)`);
      await onCompleted(parts.join(' · ') || 'Processamento de boletos concluído.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erro ao emitir/reemitir boletos.');
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-4 dark:bg-slate-950/80"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden text-xs dark:border-slate-700 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between bg-slate-50 dark:border-slate-700 dark:bg-slate-800/70">
          <div className="flex items-center gap-2.5">
            <Barcode className="w-4 h-4 text-red-600 dark:text-red-400" />
            <div>
              <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                Emissão e Reemissão de Boletos
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {eligibleItems.length} título(s) marcado(s) elegível(is) · {emissaoCount} nova(s) emissão(ões) · {reemissaoCount} reemissão(ões)
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
          {err && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-800 dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300">
              {err}
            </div>
          )}

          {sendNotice && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-800 flex items-center justify-between gap-2 dark:border-emerald-800/70 dark:bg-emerald-950/50 dark:text-emerald-300">
              <span>{sendNotice}</span>
              <button type="button" onClick={() => setSendNotice('')} className="p-0.5">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Conta Corrente Santander (Dropdown) + Opções */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 space-y-3 dark:border-slate-700 dark:bg-slate-800/50">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
              <div>
                <div className="font-semibold text-slate-900 dark:text-slate-100">
                  Conta Corrente Emissora
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  Padrão Santander · Lançamentos sem boleto serão emitidos e títulos com boleto serão reemitidos.
                </div>
              </div>

              <div className="relative" ref={dropdownRef}>
                <button
                  type="button"
                  onClick={() => setBankDropdownOpen((o) => !o)}
                  className="inline-flex items-center justify-between gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-100 min-w-[260px] dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                >
                  <span className="flex items-center gap-2 truncate">
                    <Landmark className="w-3.5 h-3.5 text-red-600 shrink-0 dark:text-red-400" />
                    {selectedAccount ? (
                      <span className="truncate">
                        {selectedAccount.febrabanCode ? `${selectedAccount.febrabanCode} · ` : ''}
                        {selectedAccount.bankName}
                        {selectedAccount.accountNumber ? ` (${selectedAccount.accountNumber})` : ''}
                      </span>
                    ) : (
                      <span>Selecionar Conta Corrente</span>
                    )}
                  </span>
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                </button>

                {bankDropdownOpen && (
                  <div className="absolute right-0 mt-1.5 w-80 max-h-60 overflow-y-auto rounded-xl border border-slate-200 bg-white py-1.5 shadow-xl z-40 text-xs dark:border-slate-700 dark:bg-slate-900">
                    {sortedAccounts.map((acc) => {
                      const isSel = selectedAccount?.id === acc.id;
                      const santApi = acc.apiProvider === 'santander';
                      return (
                        <button
                          key={acc.id}
                          type="button"
                          onClick={() => {
                            setSelectedBankAccountId(acc.id);
                            setIncludePixQr(Boolean(acc.santanderSummary?.hybridBoletoPixEnabled ?? true));
                            setBankDropdownOpen(false);
                          }}
                          className={`w-full px-3 py-2 text-left flex items-start justify-between gap-2 transition-colors ${
                            isSel
                              ? 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100'
                              : 'text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800/70'
                          }`}
                        >
                          <div className="min-w-0">
                            <div className="font-semibold truncate">
                              {acc.febrabanCode ? `${acc.febrabanCode} · ` : ''}
                              {acc.bankName}
                              {defaultAccount?.id === acc.id ? ' (Padrão)' : ''}
                            </div>
                            <div className="text-[10px] text-slate-500 font-mono tabular-nums dark:text-slate-400">
                              Ag {acc.agency || '—'} · Cc {acc.accountNumber || '—'}
                              {santApi
                                ? acc.santanderSummary?.executionMode === 'live_mtls'
                                  ? ' · API Santander (mTLS)'
                                  : ' · API Santander (Homologação)'
                                : ' · Sem API de boleto'}
                            </div>
                          </div>
                          {isSel && <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5 dark:text-emerald-400" />}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Opção de Vencimento: manter ou alterar */}
            <div className="pt-2.5 border-t border-slate-200 dark:border-slate-700 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-slate-200/70 dark:bg-slate-900">
                  <button
                    type="button"
                    onClick={() => setAlterDueDate(false)}
                    className={`px-3 py-1.5 rounded-md font-semibold transition-colors ${
                      !alterDueDate
                        ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-slate-100'
                        : 'text-slate-600 hover:text-slate-900 dark:text-slate-300'
                    }`}
                  >
                    Manter Vencimento Atual
                  </button>
                  <button
                    type="button"
                    onClick={() => setAlterDueDate(true)}
                    className={`px-3 py-1.5 rounded-md font-semibold transition-colors ${
                      alterDueDate
                        ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-slate-100'
                        : 'text-slate-600 hover:text-slate-900 dark:text-slate-300'
                    }`}
                  >
                    Alterar Vencimento
                  </button>
                </div>

                {alterDueDate && (
                  <div className="flex items-center gap-2">
                    <Calendar className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
                    <input
                      type="date"
                      value={newDueDate}
                      onChange={(e) => setNewDueDate(e.target.value)}
                      className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
                    />
                  </div>
                )}
              </div>

              <label className="inline-flex items-center gap-2 cursor-pointer text-slate-700 dark:text-slate-200">
                <input
                  type="checkbox"
                  checked={includePixQr}
                  onChange={(e) => setIncludePixQr(e.target.checked)}
                />
                <span>Incluir QR Code PIX (Boleto SX)</span>
              </label>
            </div>
          </div>

          {/* Lista dos títulos marcados */}
          <div className="rounded-xl border border-slate-200 overflow-hidden dark:border-slate-700">
            <div className="px-3.5 py-2 bg-slate-50 border-b border-slate-200 font-semibold text-slate-700 dark:bg-slate-800/70 dark:border-slate-700 dark:text-slate-200">
              {results ? 'Resultado da Emissão / Reemissão' : 'Títulos Marcados para Processamento'}
            </div>
            <div className="max-h-64 overflow-y-auto">
              <table className="w-full text-left text-[11px]">
                <thead className="bg-slate-50/80 text-slate-500 border-b border-slate-200 sticky top-0 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700">
                  <tr>
                    <th className="px-3 py-2">Documento</th>
                    <th className="px-3 py-2">Cliente</th>
                    <th className="px-3 py-2">Vencimento</th>
                    <th className="px-3 py-2 text-right">Valor</th>
                    <th className="px-3 py-2">Operação</th>
                    <th className="px-3 py-2">Situação</th>
                    <th className="px-3 py-2 text-right">Boleto / Canal</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {results
                    ? results.map((r) => (
                        <tr key={r.titleId} className="hover:bg-slate-100/70 dark:hover:bg-slate-800/70">
                          <td className="px-3 py-2 font-mono font-semibold text-slate-900 dark:text-slate-100">
                            {r.documentNumber}
                          </td>
                          <td className="px-3 py-2 text-slate-600 dark:text-slate-300">
                            {titles.find((t) => t.id === r.titleId)?.clientName || '—'}
                          </td>
                          <td className="px-3 py-2 font-mono tabular-nums text-slate-700 dark:text-slate-200">
                            {r.dueDate ? formatIsoDateToBR(r.dueDate) : '—'}
                          </td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums">
                            {formatBRL(
                              titles.find((t) => t.id === r.titleId)?.currentBalanceCents ||
                                titles.find((t) => t.id === r.titleId)?.amountCents ||
                                0
                            )}
                          </td>
                          <td className="px-3 py-2 font-semibold">
                            {r.mode === 'REEMISSAO' ? (
                              <span className="text-amber-700 dark:text-amber-300">Reemissão</span>
                            ) : (
                              <span className="text-blue-700 dark:text-blue-300">Emissão</span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            {r.ok ? (
                              <span className="text-emerald-700 font-semibold dark:text-emerald-300">
                                Concluído · Nosso Nº {r.ourNumber}
                              </span>
                            ) : (
                              <span className="text-red-700 font-semibold dark:text-red-300">{r.error}</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right whitespace-nowrap">
                            {r.ok ? (
                              <div className="inline-flex items-center gap-1.5">
                                {onViewBoleto && (
                                  <button
                                    type="button"
                                    onClick={() => onViewBoleto(r.titleId)}
                                    title="Visualizar boleto regerado e PDF"
                                    className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-[10px] font-semibold text-slate-800 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                                  >
                                    <Eye className="w-3 h-3" />
                                    Visualizar
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => setSendTargetTitleId(r.titleId)}
                                  title="Enviar boleto pelos canais GoTalk ou UaZapi"
                                  className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-800 hover:bg-emerald-100 dark:border-emerald-800/70 dark:bg-emerald-950/50 dark:text-emerald-300 dark:hover:bg-emerald-900/60"
                                >
                                  <MessageSquare className="w-3 h-3" />
                                  GoTalk / UaZapi
                                </button>
                              </div>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                        </tr>
                      ))
                    : classified.map(({ title, eligible, ineligibleReason, hasBoleto }) => (
                        <tr key={title.id} className="hover:bg-slate-100/70 dark:hover:bg-slate-800/70">
                          <td className="px-3 py-2 font-mono font-semibold text-slate-900 dark:text-slate-100">
                            {title.documentNumber || title.titleCode}
                          </td>
                          <td className="px-3 py-2 text-slate-700 dark:text-slate-200 truncate max-w-[180px]">
                            {title.clientName || '—'}
                          </td>
                          <td className="px-3 py-2 font-mono tabular-nums text-slate-700 dark:text-slate-200">
                            {alterDueDate && eligible && newDueDate
                              ? `${formatIsoDateToBR(title.dueDate)} → ${formatIsoDateToBR(newDueDate)}`
                              : formatIsoDateToBR(title.dueDate)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums font-semibold">
                            {formatBRL(
                              (title.currentBalanceCents ?? 0) > 0
                                ? title.currentBalanceCents ?? 0
                                : title.amountCents
                            )}
                          </td>
                          <td className="px-3 py-2 font-semibold">
                            {!eligible ? (
                              <span className="text-slate-400">Ignorado</span>
                            ) : hasBoleto ? (
                              <span className="text-amber-700 dark:text-amber-300">Reemitir Boleto</span>
                            ) : (
                              <span className="text-blue-700 dark:text-blue-300">Emitir Novo</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-slate-500 dark:text-slate-400">
                            {!eligible
                              ? ineligibleReason
                              : hasBoleto
                              ? `Possui boleto (${title.ourNumber || 'registrado'})`
                              : 'Sem boleto associado'}
                          </td>
                          <td className="px-3 py-2 text-right whitespace-nowrap">
                            {hasBoleto ? (
                              <div className="inline-flex items-center gap-1">
                                {onViewBoleto && (
                                  <button
                                    type="button"
                                    onClick={() => onViewBoleto(title.id)}
                                    title="Visualizar boleto atual"
                                    className="p-1 rounded border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                                  >
                                    <Eye className="w-3 h-3" />
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => setSendTargetTitleId(title.id)}
                                  title="Enviar boleto atual via GoTalk ou UaZapi"
                                  className="p-1 rounded border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800/70 dark:bg-emerald-950/50 dark:text-emerald-300"
                                >
                                  <MessageSquare className="w-3 h-3" />
                                </button>
                              </div>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between dark:border-slate-700 dark:bg-slate-800/70">
          <span className="text-[11px] text-slate-500 dark:text-slate-400">
            {selectedIsSantanderApi
              ? `Integração ativa: ${selectedAccount?.bankName}`
              : 'Selecione uma conta Santander para emissão'}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              {results ? 'Fechar' : 'Cancelar'}
            </button>
            {!results && (
              <button
                type="button"
                disabled={busy || eligibleItems.length === 0 || !selectedIsSantanderApi}
                onClick={handleSubmit}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-emerald-600 dark:hover:bg-emerald-500"
              >
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <QrCode className="w-3.5 h-3.5" />}
                {busy
                  ? 'Processando...'
                  : `Confirmar Emissão / Reemissão (${eligibleItems.length})`}
              </button>
            )}
          </div>
        </div>
      </div>

      <SendBoletoWhatsappModal
        titleId={sendTargetTitleId}
        onClose={() => setSendTargetTitleId(null)}
        onSent={(msg) => setSendNotice(msg)}
      />
    </div>
  );
};

/* ============================================================================
 * 2. BAIXA DE TÍTULOS EM ABERTO VIA API BANCÁRIA (PADRÃO SANTANDER)
 * ========================================================================== */

export interface SyncOpenTitleItem {
  titleId: number;
  titleCode: string;
  documentNumber: string;
  description: string;
  clientId: number;
  clientName: string;
  unitId: number;
  dueDate: string;
  paidAt: string | null;
  amountCents: number;
  balanceCents: number;
  settledCents: number;
  daysOverdue: number;
  hasBoleto: boolean;
  hasPix: boolean;
  ourNumber: string;
  digitableLine: string;
  pixTxid: string;
  santanderStatus: string;
  pixStatus: string;
  channel: 'BOLETO' | 'PIX' | 'HOMOLOGACAO' | 'PENDENTE';
  bankReason: string;
  movementId: number | null;
}

interface OpenPreviewResponse {
  account: BankAccount | null;
  executionMode: 'live_mtls' | 'homologation_offline';
  environment: 'sandbox' | 'production';
  period?: { startDate: string | null; endDate: string | null };
  openCount: number;
  withChargeCount: number;
  overdueCount: number;
  dueTodayCount: number;
  readyToSettleCount: number;
  eligibleTitles: SyncOpenTitleItem[];
}

interface SyncResponse {
  syncedAt: string;
  bankAccount: BankAccount;
  executionMode: 'live_mtls' | 'homologation_offline';
  environment: 'sandbox' | 'production';
  period?: { startDate: string | null; endDate: string | null };
  summary: {
    totalChecked: number;
    baixadosCount: number;
    baixadosTotalCents: number;
    vencidosCount: number;
    vencidosTotalCents: number;
    esperadosCount: number;
    esperadosTotalCents: number;
  };
  baixados: SyncOpenTitleItem[];
  vencidos: SyncOpenTitleItem[];
  esperados: SyncOpenTitleItem[];
}

function getDefaultPeriodRange(): { start: string; end: string } {
  const now = new Date();
  const start = new Date(now.getTime() - 60 * 86400000);
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

interface ApiBankSettlementModalProps {
  open: boolean;
  bankAccounts: BankAccount[];
  onClose: () => void;
  onSettled: (msg: string) => Promise<void>;
  onOpenTitleById: (titleId: number) => void;
  onOpenBoletoModal: (titleId: number) => void;
}

export const ApiBankSettlementModal: React.FC<ApiBankSettlementModalProps> = ({
  open,
  bankAccounts,
  onClose,
  onSettled,
  onOpenTitleById,
  onOpenBoletoModal,
}) => {
  const [selectedBankAccountId, setSelectedBankAccountId] = useState<number | null>(null);
  const [bankDropdownOpen, setBankDropdownOpen] = useState(false);
  const [startDate, setStartDate] = useState(() => getDefaultPeriodRange().start);
  const [endDate, setEndDate] = useState(() => getDefaultPeriodRange().end);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [err, setErr] = useState('');
  const [preview, setPreview] = useState<OpenPreviewResponse | null>(null);
  const [simulatedIds, setSimulatedIds] = useState<number[]>([]);
  const [syncResult, setSyncResult] = useState<SyncResponse | null>(null);
  const [activeSummaryTab, setActiveSummaryTab] = useState<'baixados' | 'vencidos' | 'esperados'>('baixados');
  const [inspectedItem, setInspectedItem] = useState<SyncOpenTitleItem | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  const sortedAccounts = useMemo(() => {
    const active = bankAccounts.filter((a) => a.active !== false);
    return active.slice().sort((a, b) => {
      const aDefault = a.apiProvider === 'santander' && a.isDefaultBoletoAccount && a.apiIntegrationEnabled ? 0 : 1;
      const bDefault = b.apiProvider === 'santander' && b.isDefaultBoletoAccount && b.apiIntegrationEnabled ? 0 : 1;
      if (aDefault !== bDefault) return aDefault - bDefault;
      const aSant = isSantanderAccount(a) ? 0 : 1;
      const bSant = isSantanderAccount(b) ? 0 : 1;
      if (aSant !== bSant) return aSant - bSant;
      return a.bankName.localeCompare(b.bankName);
    });
  }, [bankAccounts]);

  const defaultAccount = useMemo(() => getDefaultSantanderAccount(sortedAccounts), [sortedAccounts]);

  const loadPreview = useCallback(
    async (accountId: number | null, fromIso: string, toIso: string) => {
      if (fromIso && toIso && fromIso > toIso) {
        setErr('A data inicial do período não pode ser maior que a data final.');
        return;
      }
      setLoadingPreview(true);
      setErr('');
      try {
        const params = new URLSearchParams();
        if (accountId) params.set('bankAccountId', String(accountId));
        if (fromIso) params.set('startDate', fromIso);
        if (toIso) params.set('endDate', toIso);
        const qs = params.toString();
        const res = await apiFetch<OpenPreviewResponse>(
          `/api/santander/settlements/open-preview${qs ? `?${qs}` : ''}`
        );
        setPreview(res);
        setSimulatedIds([]);
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Erro ao consultar títulos em aberto.');
      } finally {
        setLoadingPreview(false);
      }
    },
    []
  );

  useEffect(() => {
    if (!open) return;
    const defId = defaultAccount?.id ?? null;
    const range = getDefaultPeriodRange();
    setSelectedBankAccountId(defId);
    setBankDropdownOpen(false);
    setStartDate(range.start);
    setEndDate(range.end);
    setSyncResult(null);
    setInspectedItem(null);
    setActiveSummaryTab('baixados');
    void loadPreview(defId, range.start, range.end);
  }, [open, defaultAccount, loadPreview]);

  useEffect(() => {
    const onOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setBankDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, []);

  const selectedAccount = useMemo(
    () => sortedAccounts.find((a) => a.id === selectedBankAccountId) || defaultAccount,
    [sortedAccounts, selectedBankAccountId, defaultAccount]
  );

  const selectedIsSantanderApi = Boolean(selectedAccount && selectedAccount.apiProvider === 'santander');

  const applyPeriodRange = (nextStart: string, nextEnd: string) => {
    setStartDate(nextStart);
    setEndDate(nextEnd);
    setSyncResult(null);
    setInspectedItem(null);
    void loadPreview(selectedAccount?.id ?? null, nextStart, nextEnd);
  };

  const handleRunSync = async () => {
    if (!selectedAccount || !selectedIsSantanderApi) {
      setErr('Selecione uma Conta Corrente com API Santander configurada.');
      return;
    }
    if (startDate && endDate && startDate > endDate) {
      setErr('A data inicial do período não pode ser maior que a data final.');
      return;
    }
    setSyncing(true);
    setErr('');
    setInspectedItem(null);
    try {
      const res = await apiFetch<SyncResponse>('/api/santander/settlements/sync-open', {
        method: 'POST',
        body: JSON.stringify({
          bankAccountId: selectedAccount.id,
          startDate: startDate || null,
          endDate: endDate || null,
          simulateLiquidatedTitleIds: simulatedIds,
        }),
      });
      setSyncResult(res);
      if (res.baixados.length > 0) {
        setActiveSummaryTab('baixados');
        setInspectedItem(res.baixados[0]);
        await onSettled(
          `Baixa via API ${res.bankAccount.bankName}: ${res.baixados.length} título(s) baixado(s) (${formatBRL(res.summary.baixadosTotalCents)}).`
        );
      } else if (res.vencidos.length > 0) {
        setActiveSummaryTab('vencidos');
        setInspectedItem(res.vencidos[0]);
      } else if (res.esperados.length > 0) {
        setActiveSummaryTab('esperados');
        setInspectedItem(res.esperados[0]);
      }
      await loadPreview(selectedAccount.id, startDate, endDate);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erro ao consultar e baixar títulos via API.');
    } finally {
      setSyncing(false);
    }
  };

  if (!open) return null;

  const activeList: SyncOpenTitleItem[] = syncResult
    ? activeSummaryTab === 'baixados'
      ? syncResult.baixados
      : activeSummaryTab === 'vencidos'
      ? syncResult.vencidos
      : syncResult.esperados
    : [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-4 dark:bg-slate-950/80"
      onClick={onClose}
    >
      <div
        className="w-full max-w-5xl rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden text-xs dark:border-slate-700 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between bg-slate-50 dark:border-slate-700 dark:bg-slate-800/70">
          <div className="flex items-center gap-2.5">
            <Landmark className="w-4 h-4 text-red-600 dark:text-red-400" />
            <div>
              <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                Baixa de Títulos em Aberto via API Bancária
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Consulta liquidações de boletos e PIX na API do banco selecionado e apresenta resumo de baixados, vencidos e esperados.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 max-h-[78vh] overflow-y-auto">
          {err && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-800 dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300">
              {err}
            </div>
          )}

          {/* Barra de Seleção do Banco (Padrão Santander) & Execução */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 flex flex-wrap items-end justify-between gap-3 dark:border-slate-700 dark:bg-slate-800/50">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1 dark:text-slate-300">
                  Banco / Conta Corrente (Padrão Santander)
                </label>
                <div className="relative" ref={dropdownRef}>
                  <button
                    type="button"
                    onClick={() => setBankDropdownOpen((o) => !o)}
                    className="inline-flex items-center justify-between gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-100 min-w-[270px] dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                  >
                    <span className="flex items-center gap-2 truncate">
                      <Landmark className="w-3.5 h-3.5 text-red-600 shrink-0 dark:text-red-400" />
                      {selectedAccount ? (
                        <span className="truncate">
                          {selectedAccount.febrabanCode ? `${selectedAccount.febrabanCode} · ` : ''}
                          {selectedAccount.bankName}
                          {selectedAccount.accountNumber ? ` (${selectedAccount.accountNumber})` : ''}
                        </span>
                      ) : (
                        <span>Selecionar Conta Corrente</span>
                      )}
                    </span>
                    <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  </button>

                  {bankDropdownOpen && (
                    <div className="absolute left-0 mt-1.5 w-80 max-h-60 overflow-y-auto rounded-xl border border-slate-200 bg-white py-1.5 shadow-xl z-40 text-xs dark:border-slate-700 dark:bg-slate-900">
                      {sortedAccounts.map((acc) => {
                        const isSel = selectedAccount?.id === acc.id;
                        const santApi = acc.apiProvider === 'santander';
                        return (
                          <button
                            key={acc.id}
                            type="button"
                            onClick={() => {
                              setSelectedBankAccountId(acc.id);
                              setBankDropdownOpen(false);
                              setSyncResult(null);
                              setInspectedItem(null);
                              void loadPreview(acc.id, startDate, endDate);
                            }}
                            className={`w-full px-3 py-2 text-left flex items-start justify-between gap-2 transition-colors ${
                              isSel
                                ? 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100'
                                : 'text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800/70'
                            }`}
                          >
                            <div className="min-w-0">
                              <div className="font-semibold truncate">
                                {acc.febrabanCode ? `${acc.febrabanCode} · ` : ''}
                                {acc.bankName}
                                {defaultAccount?.id === acc.id ? ' (Padrão)' : ''}
                              </div>
                              <div className="text-[10px] text-slate-500 font-mono tabular-nums dark:text-slate-400">
                                Ag {acc.agency || '—'} · Cc {acc.accountNumber || '—'}
                                {santApi ? ' · API Santander' : ' · Sem integração API'}
                              </div>
                            </div>
                            {isSel && <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5 dark:text-emerald-400" />}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1 dark:text-slate-300">
                  Período de Vencimento — De
                </label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => applyPeriodRange(e.target.value, endDate)}
                  className="rounded-lg border border-slate-300 bg-white px-2.5 py-2 font-mono text-xs dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1 dark:text-slate-300">
                  Até
                </label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => applyPeriodRange(startDate, e.target.value)}
                  className="rounded-lg border border-slate-300 bg-white px-2.5 py-2 font-mono text-xs dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>

              <div className="flex items-center gap-1 pb-0.5">
                <button
                  type="button"
                  onClick={() => {
                    const now = new Date();
                    const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
                      .toISOString()
                      .slice(0, 10);
                    const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0))
                      .toISOString()
                      .slice(0, 10);
                    applyPeriodRange(first, last);
                  }}
                  className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  Mês Atual
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const r = getDefaultPeriodRange();
                    applyPeriodRange(r.start, r.end);
                  }}
                  className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  60 dias
                </button>
                {(startDate || endDate) && (
                  <button
                    type="button"
                    onClick={() => applyPeriodRange('', '')}
                    className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    Todos
                  </button>
                )}
              </div>
            </div>

            <button
              type="button"
              disabled={syncing || !selectedIsSantanderApi}
              onClick={handleRunSync}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 whitespace-nowrap"
            >
              {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              {syncing ? 'Consultando API Santander...' : 'Consultar & Baixar em Aberto via API'}
            </button>
          </div>

          {/* Prévia dos Títulos em Aberto antes (ou após) a consulta */}
          {!syncResult && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600 dark:text-slate-300">
                <span>
                  {loadingPreview
                    ? 'Carregando títulos em aberto...'
                    : preview
                    ? `${preview.openCount} título(s) em aberto elegível(is) · ${preview.withChargeCount} com boleto/PIX · ${preview.overdueCount} vencido(s) · ${preview.dueTodayCount} vencendo hoje`
                    : 'Selecione uma conta Santander para consultar.'}
                </span>
                {preview?.executionMode === 'homologation_offline' && (
                  <span className="text-amber-700 font-medium dark:text-amber-300">
                    Modo Homologação: marque abaixo caso deseje simular confirmação bancária de liquidação
                  </span>
                )}
              </div>

              <div className="rounded-xl border border-slate-200 overflow-hidden dark:border-slate-700">
                <div className="max-h-64 overflow-y-auto">
                  <table className="w-full text-left text-[11px]">
                    <thead className="bg-slate-50 text-slate-500 border-b border-slate-200 sticky top-0 dark:bg-slate-800/80 dark:text-slate-400 dark:border-slate-700">
                      <tr>
                        {preview?.executionMode === 'homologation_offline' && (
                          <th className="px-3 py-2 w-10" title="Simular retorno pago no banco (homologação)">
                            Pago
                          </th>
                        )}
                        <th className="px-3 py-2">Documento</th>
                        <th className="px-3 py-2">Cliente</th>
                        <th className="px-3 py-2">Vencimento</th>
                        <th className="px-3 py-2">Cobrança</th>
                        <th className="px-3 py-2 text-right">Saldo em Aberto</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {!preview || preview.eligibleTitles.length === 0 ? (
                        <tr>
                          <td
                            colSpan={preview?.executionMode === 'homologation_offline' ? 6 : 5}
                            className="py-8 text-center text-slate-500 dark:text-slate-400"
                          >
                            {loadingPreview ? 'Carregando...' : 'Nenhum título em aberto encontrado para esta conta.'}
                          </td>
                        </tr>
                      ) : (
                        preview.eligibleTitles.map((it) => {
                          const simChecked = simulatedIds.includes(it.titleId);
                          return (
                            <tr
                              key={it.titleId}
                              className="hover:bg-slate-100/80 dark:hover:bg-slate-800/70 transition-colors"
                            >
                              {preview.executionMode === 'homologation_offline' && (
                                <td className="px-3 py-2">
                                  <input
                                    type="checkbox"
                                    checked={simChecked}
                                    onChange={(e) =>
                                      setSimulatedIds((prev) =>
                                        e.target.checked
                                          ? [...prev, it.titleId]
                                          : prev.filter((id) => id !== it.titleId)
                                      )
                                    }
                                    title="Simular pagamento confirmado pelo Santander neste título"
                                  />
                                </td>
                              )}
                              <td className="px-3 py-2 font-mono font-semibold text-slate-900 dark:text-slate-100">
                                {it.documentNumber}
                              </td>
                              <td className="px-3 py-2 text-slate-700 dark:text-slate-200 truncate max-w-[200px]">
                                {it.clientName}
                              </td>
                              <td className="px-3 py-2 font-mono tabular-nums">
                                <span
                                  className={
                                    it.daysOverdue > 0
                                      ? 'text-red-600 font-bold dark:text-red-400'
                                      : 'text-slate-700 dark:text-slate-200'
                                  }
                                >
                                  {formatIsoDateToBR(it.dueDate)}
                                </span>
                                {it.daysOverdue > 0 && (
                                  <span className="ml-1.5 text-[10px] font-bold text-red-600 dark:text-red-400">
                                    +{it.daysOverdue}d
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-2 text-slate-600 dark:text-slate-300">
                                {it.hasBoleto && it.hasPix
                                  ? 'Boleto + PIX'
                                  : it.hasBoleto
                                  ? 'Boleto'
                                  : it.hasPix
                                  ? 'PIX'
                                  : 'Sem boleto/PIX'}
                              </td>
                              <td className="px-3 py-2 text-right font-mono font-bold tabular-nums text-slate-900 dark:text-slate-100">
                                {formatBRL(it.balanceCents)}
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
          )}

          {/* Resumos Clicáveis pós-consulta (Baixados, Vencidos, Deveriam Ter Sido Pagos) */}
          {syncResult && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                <span>
                  Consulta concluída em {syncResult.bankAccount.bankName}
                  {syncResult.period?.startDate || syncResult.period?.endDate
                    ? ` · Período ${syncResult.period?.startDate ? formatIsoDateToBR(syncResult.period.startDate) : 'início'} a ${
                        syncResult.period?.endDate ? formatIsoDateToBR(syncResult.period.endDate) : 'hoje'
                      }`
                    : ' · Todos em aberto'}{' '}
                  · {syncResult.summary.totalChecked} título(s) verificado(s). Clique em um resumo abaixo para inspecionar os títulos.
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setSyncResult(null);
                    setInspectedItem(null);
                  }}
                  className="text-blue-700 font-semibold hover:underline dark:text-blue-300"
                >
                  Nova Consulta / Prévia
                </button>
              </div>

              {/* 3 Cards de Resumo Clicáveis */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setActiveSummaryTab('baixados');
                    setInspectedItem(syncResult.baixados[0] || null);
                  }}
                  className={`text-left rounded-xl border p-4 transition-colors ${
                    activeSummaryTab === 'baixados'
                      ? 'border-emerald-500 bg-emerald-50/70 dark:border-emerald-500 dark:bg-emerald-950/40'
                      : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800/70'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                      Títulos Baixados via API
                    </span>
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <div className="mt-1.5 font-mono text-xl font-bold text-slate-900 tabular-nums dark:text-slate-100">
                    {formatBRL(syncResult.summary.baixadosTotalCents)}
                  </div>
                  <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                    {syncResult.summary.baixadosCount} título(s) liquidado(s) · Clique para detalhar
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setActiveSummaryTab('vencidos');
                    setInspectedItem(syncResult.vencidos[0] || null);
                  }}
                  className={`text-left rounded-xl border p-4 transition-colors ${
                    activeSummaryTab === 'vencidos'
                      ? 'border-red-500 bg-red-50/70 dark:border-red-500 dark:bg-red-950/40'
                      : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800/70'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-red-700 dark:text-red-300">
                      Títulos Vencidos (Não Pagos)
                    </span>
                    <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400" />
                  </div>
                  <div className="mt-1.5 font-mono text-xl font-bold text-slate-900 tabular-nums dark:text-slate-100">
                    {formatBRL(syncResult.summary.vencidosTotalCents)}
                  </div>
                  <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                    {syncResult.summary.vencidosCount} título(s) vencido(s) · Clique para detalhar
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setActiveSummaryTab('esperados');
                    setInspectedItem(syncResult.esperados[0] || null);
                  }}
                  className={`text-left rounded-xl border p-4 transition-colors ${
                    activeSummaryTab === 'esperados'
                      ? 'border-amber-500 bg-amber-50/70 dark:border-amber-500 dark:bg-amber-950/40'
                      : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800/70'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                      Deveriam Ter Sido Pagos (Até Hoje)
                    </span>
                    <Clock className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                  </div>
                  <div className="mt-1.5 font-mono text-xl font-bold text-slate-900 tabular-nums dark:text-slate-100">
                    {formatBRL(syncResult.summary.esperadosTotalCents)}
                  </div>
                  <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                    {syncResult.summary.esperadosCount} título(s) vencido(s)/hoje · Clique para detalhar
                  </div>
                </button>
              </div>

              {/* Grade de Detalhes do Resumo Clicado + Painel Lateral de Inspeção */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                <div className="lg:col-span-7 rounded-xl border border-slate-200 overflow-hidden dark:border-slate-700">
                  <div className="px-3.5 py-2.5 bg-slate-50 border-b border-slate-200 font-semibold text-slate-800 flex items-center justify-between dark:bg-slate-800/70 dark:border-slate-700 dark:text-slate-100">
                    <span>
                      {activeSummaryTab === 'baixados'
                        ? `Detalhes — Títulos Baixados (${activeList.length})`
                        : activeSummaryTab === 'vencidos'
                        ? `Detalhes — Títulos Vencidos (${activeList.length})`
                        : `Detalhes — Deveriam Ter Sido Pagos (${activeList.length})`}
                    </span>
                    <span className="text-[10px] font-normal text-slate-500 dark:text-slate-400">
                      Clique em uma linha para abrir os detalhes completos
                    </span>
                  </div>
                  <div className="max-h-72 overflow-y-auto">
                    <table className="w-full text-left text-[11px]">
                      <thead className="bg-slate-50/80 text-slate-500 border-b border-slate-200 sticky top-0 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700">
                        <tr>
                          <th className="px-3 py-2">Documento</th>
                          <th className="px-3 py-2">Cliente</th>
                          <th className="px-3 py-2">Vencimento</th>
                          <th className="px-3 py-2 text-right">
                            {activeSummaryTab === 'baixados' ? 'Valor Baixado' : 'Saldo Aberto'}
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {activeList.length === 0 ? (
                          <tr>
                            <td colSpan={4} className="py-8 text-center text-slate-500 dark:text-slate-400">
                              Nenhum título registrado neste resumo.
                            </td>
                          </tr>
                        ) : (
                          activeList.map((item) => {
                            const isSelected = inspectedItem?.titleId === item.titleId;
                            return (
                              <tr
                                key={item.titleId}
                                onClick={() => setInspectedItem(item)}
                                className={`cursor-pointer transition-colors ${
                                  isSelected
                                    ? 'bg-blue-50/80 dark:bg-blue-950/45'
                                    : 'hover:bg-slate-100/80 dark:hover:bg-slate-800/75'
                                }`}
                              >
                                <td className="px-3 py-2 font-mono font-semibold text-slate-900 dark:text-slate-100">
                                  {item.documentNumber}
                                </td>
                                <td className="px-3 py-2 text-slate-700 dark:text-slate-200 truncate max-w-[160px]">
                                  {item.clientName}
                                </td>
                                <td className="px-3 py-2 font-mono tabular-nums">
                                  <span
                                    className={
                                      item.daysOverdue > 0 && activeSummaryTab !== 'baixados'
                                        ? 'text-red-600 font-bold dark:text-red-400'
                                        : 'text-slate-700 dark:text-slate-200'
                                    }
                                  >
                                    {formatIsoDateToBR(item.dueDate)}
                                  </span>
                                  {item.daysOverdue > 0 && (
                                    <span className="ml-1 text-[10px] font-bold text-red-600 dark:text-red-400">
                                      +{item.daysOverdue}d
                                    </span>
                                  )}
                                </td>
                                <td className="px-3 py-2 text-right font-mono font-bold tabular-nums text-slate-900 dark:text-slate-100">
                                  {formatBRL(
                                    activeSummaryTab === 'baixados' ? item.settledCents : item.balanceCents
                                  )}
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Painel de Detalhes do Título Selecionado */}
                <div className="lg:col-span-5 rounded-xl border border-slate-200 bg-slate-50/60 p-4 space-y-3 dark:border-slate-700 dark:bg-slate-800/40">
                  {!inspectedItem ? (
                    <div className="py-10 text-center text-slate-500 dark:text-slate-400">
                      Selecione um título na lista ao lado para visualizar todos os detalhes bancários e financeiros.
                    </div>
                  ) : (
                    <>
                      <div className="flex items-start justify-between gap-2 pb-2 border-b border-slate-200 dark:border-slate-700">
                        <div>
                          <div className="font-mono font-bold text-sm text-slate-900 dark:text-slate-100">
                            {inspectedItem.documentNumber}
                          </div>
                          <div className="text-slate-600 font-medium dark:text-slate-300">
                            {inspectedItem.clientName}
                          </div>
                        </div>
                        <span
                          className={`text-[11px] font-bold ${
                            activeSummaryTab === 'baixados'
                              ? 'text-emerald-700 dark:text-emerald-300'
                              : inspectedItem.daysOverdue > 0
                              ? 'text-red-700 dark:text-red-300'
                              : 'text-amber-700 dark:text-amber-300'
                          }`}
                        >
                          {activeSummaryTab === 'baixados'
                            ? 'LIQUIDADO'
                            : inspectedItem.daysOverdue > 0
                            ? `${inspectedItem.daysOverdue}d EM ATRASO`
                            : 'VENCIMENTO HOJE'}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-2.5 text-[11px]">
                        <div>
                          <div className="text-slate-500 dark:text-slate-400">Vencimento</div>
                          <div className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                            {formatIsoDateToBR(inspectedItem.dueDate)}
                          </div>
                        </div>
                        <div>
                          <div className="text-slate-500 dark:text-slate-400">
                            {activeSummaryTab === 'baixados' ? 'Valor Liquidado' : 'Saldo em Aberto'}
                          </div>
                          <div className="font-mono font-bold text-slate-900 tabular-nums dark:text-slate-100">
                            {formatBRL(
                              activeSummaryTab === 'baixados'
                                ? inspectedItem.settledCents
                                : inspectedItem.balanceCents
                            )}
                          </div>
                        </div>
                        <div>
                          <div className="text-slate-500 dark:text-slate-400">Nosso Número</div>
                          <div className="font-mono text-slate-800 dark:text-slate-200">
                            {inspectedItem.ourNumber || '—'}
                          </div>
                        </div>
                        <div>
                          <div className="text-slate-500 dark:text-slate-400">Status Santander / PIX</div>
                          <div className="font-mono text-slate-800 dark:text-slate-200">
                            {inspectedItem.santanderStatus || inspectedItem.pixStatus || '—'}
                          </div>
                        </div>
                      </div>

                      {inspectedItem.description && (
                        <div className="text-[11px]">
                          <div className="text-slate-500 dark:text-slate-400">Histórico</div>
                          <div className="text-slate-800 dark:text-slate-200">{inspectedItem.description}</div>
                        </div>
                      )}

                      <div className="text-[11px]">
                        <div className="text-slate-500 dark:text-slate-400">Retorno / Motivo Bancário</div>
                        <div className="font-medium text-slate-900 dark:text-slate-100">
                          {inspectedItem.bankReason}
                        </div>
                      </div>

                      {inspectedItem.digitableLine && (
                        <div className="text-[10px]">
                          <div className="text-slate-500 dark:text-slate-400">Linha Digitável</div>
                          <div className="font-mono break-all text-slate-700 dark:text-slate-300">
                            {inspectedItem.digitableLine}
                          </div>
                        </div>
                      )}

                      {inspectedItem.movementId && (
                        <div className="text-[11px] text-emerald-700 font-semibold dark:text-emerald-300">
                          Movimentação Bancária Conciliada: #{inspectedItem.movementId}
                        </div>
                      )}

                      <div className="pt-2 flex flex-wrap gap-2 border-t border-slate-200 dark:border-slate-700">
                        <button
                          type="button"
                          onClick={() => {
                            onClose();
                            onOpenTitleById(inspectedItem.titleId);
                          }}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-semibold text-slate-800 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                        >
                          <ExternalLink className="w-3 h-3" />
                          Abrir Lançamento
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            onClose();
                            onOpenBoletoModal(inspectedItem.titleId);
                          }}
                          className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 font-semibold text-red-700 hover:bg-red-100 dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300 dark:hover:bg-red-900/50"
                        >
                          <QrCode className="w-3 h-3" />
                          Ver Boleto / PIX
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between dark:border-slate-700 dark:bg-slate-800/70">
          <span className="text-[11px] text-slate-500 dark:text-slate-400">
            {selectedAccount
              ? `Conta selecionada: ${selectedAccount.bankName}${
                  preview?.executionMode === 'live_mtls' ? ' (API mTLS)' : ' (Homologação)'
                }`
              : 'Nenhuma conta Santander encontrada'}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
};
