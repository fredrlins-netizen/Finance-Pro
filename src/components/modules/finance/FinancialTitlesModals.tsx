import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  FileText,
  History,
  Layers,
  Link2,
  Repeat,
  Scale,
  ShieldAlert,
  Trash2,
  Unlock,
  X,
} from 'lucide-react';
import { apiFetch, formatBRL } from '../../../lib/api.ts';
import {
  Admission,
  BankAccount,
  Client,
  DocumentObject,
  FinancialTitle,
  LegalMovement,
  LegalProcess,
  RecalcScenario,
  TitleSettlement,
} from '../../../types.ts';
import {
  centsToMaskInput,
  formatCurrencyTyping,
  formatIsoDateToBR,
  parseMaskInputToCents,
  toIsoDateOnly,
} from './currencyAndParsers.ts';

const PAYMENT_METHODS = [
  'Depósito / Transferência',
  'PIX',
  'Boleto Bancário',
  'Cartão de Crédito',
  'Cartão de Débito',
  'Dinheiro',
  'Cheque',
  'Débito Automático',
];

function getBal(t: FinancialTitle): number {
  const st = String(t.status || 'ABERTO').toUpperCase();
  if (st === 'PAGO' || st === 'CANCELADO' || st === 'AGRUPADO') return 0;
  const bal = t.currentBalanceCents ?? 0;
  return bal > 0 ? bal : t.amountCents;
}

/* ============================================================================
 * 1. SETTLEMENT MODAL (Baixa Total em Lote / Baixa Parcial)
 * ========================================================================== */
interface SettlementModalProps {
  open: boolean;
  mode: 'total' | 'parcial';
  scope: 'RECEBER' | 'PAGAR';
  titles: FinancialTitle[];
  bankAccounts: BankAccount[];
  onClose: () => void;
  onSettled: (msg: string) => Promise<void>;
}

export const SettlementModal: React.FC<SettlementModalProps> = ({
  open,
  mode,
  scope,
  titles,
  bankAccounts,
  onClose,
  onSettled,
}) => {
  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [tab, setTab] = useState<'valores' | 'conta'>('valores');
  const [paymentDate, setPaymentDate] = useState(todayIso);
  const [amountMask, setAmountMask] = useState('0,00');
  const [interestMask, setInterestMask] = useState('0,00');
  const [fineMask, setFineMask] = useState('0,00');
  const [discountMask, setDiscountMask] = useState('0,00');
  const [bankAccountId, setBankAccountId] = useState<string>('');
  const [paymentMethod, setPaymentMethod] = useState('Depósito / Transferência');
  const [history, setHistory] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const totalOpenCents = useMemo(() => titles.reduce((a, t) => a + getBal(t), 0), [titles]);

  useEffect(() => {
    if (!open || titles.length === 0) return;
    setTab('valores');
    setErr('');
    setPaymentDate(todayIso);
    const sumBal = titles.reduce((a, t) => a + getBal(t), 0);
    setAmountMask(centsToMaskInput(sumBal));
    const sumInt = titles.reduce((a, t) => a + (t.interestCents || 0), 0);
    const sumFine = titles.reduce((a, t) => a + (t.fineCents || 0), 0);
    const sumDisc = titles.reduce((a, t) => a + (t.discountCents || 0), 0);
    setInterestMask(centsToMaskInput(sumInt));
    setFineMask(centsToMaskInput(sumFine));
    setDiscountMask(centsToMaskInput(sumDisc));
    const preferredAcc =
      titles.find((t) => t.bankAccountId)?.bankAccountId ||
      bankAccounts.find((b) => b.active !== false)?.id ||
      bankAccounts[0]?.id ||
      '';
    setBankAccountId(preferredAcc ? String(preferredAcc) : '');
    setPaymentMethod('Depósito / Transferência');
    const person = titles[0]?.clientName || '';
    setHistory(
      titles.length > 1
        ? `Baixa em lote (${titles.length} títulos) - ${person}`
        : `Baixa ${scope === 'PAGAR' ? 'pagamento' : 'recebimento'} - ${titles[0].documentNumber || titles[0].titleCode}`
    );
  }, [open, titles, bankAccounts, todayIso, scope]);

  const principalCents =
    mode === 'total' ? totalOpenCents : Math.min(totalOpenCents, parseMaskInputToCents(amountMask));
  const interestCents = parseMaskInputToCents(interestMask);
  const fineCents = parseMaskInputToCents(fineMask);
  const discountCents = parseMaskInputToCents(discountMask);
  const netCents = Math.max(0, principalCents + interestCents + fineCents - discountCents);

  const handleConfirm = async () => {
    setErr('');
    if (!bankAccountId) return setErr('Selecione a conta bancária onde o valor será movimentado.');
    if (principalCents <= 0) return setErr('O valor principal da baixa deve ser maior que zero.');
    if (netCents <= 0) return setErr('O valor líquido resultante deve ser maior que zero.');

    setBusy(true);
    try {
      const res = await apiFetch<{ settledCount: number; movementId: number; totalMovedCents: number }>(
        '/api/financial-titles/settle-batch',
        {
          method: 'POST',
          body: JSON.stringify({
            titleIds: titles.map((t) => t.id),
            scope,
            mode,
            paymentDate,
            amountPaidCents: principalCents,
            interestCents,
            fineCents,
            discountCents,
            bankAccountId: Number(bankAccountId),
            paymentMethod,
            history: history.trim(),
          }),
        }
      );
      await onSettled(
        `Baixa concluída (${res.settledCount} título(s) · ${formatBRL(res.totalMovedCents)}) e movimentação bancária #${res.movementId} conciliada.`
      );
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erro ao efetuar baixa.');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        handleConfirm();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 dark:bg-slate-950/80" onClick={onClose}>
      <div
        className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden text-xs dark:border-slate-700 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between bg-slate-50 dark:border-slate-700 dark:bg-slate-800/70">
          <div>
            <h3 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
              {mode === 'total' ? 'Baixa Total' : 'Baixa Parcial'} · Contas a {scope === 'RECEBER' ? 'Receber' : 'Pagar'}
            </h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              {titles.length} título(s) selecionado(s) · Atualiza título(s) e gera movimentação bancária conciliada
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-1 text-slate-400 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 pt-3 border-b border-slate-200 flex items-center gap-2 dark:border-slate-700">
          <button
            type="button"
            onClick={() => setTab('valores')}
            className={`px-3 py-2 font-semibold border-b-2 ${
              tab === 'valores' ? 'border-slate-900 text-slate-900 dark:border-emerald-500 dark:text-slate-100' : 'border-transparent text-slate-500 dark:text-slate-400'
            }`}
          >
            1. Valores & Datas
          </button>
          <button
            type="button"
            onClick={() => setTab('conta')}
            className={`px-3 py-2 font-semibold border-b-2 ${
              tab === 'conta' ? 'border-slate-900 text-slate-900 dark:border-emerald-500 dark:text-slate-100' : 'border-transparent text-slate-500 dark:text-slate-400'
            }`}
          >
            2. Conta & Histórico
          </button>
        </div>

        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
          {err && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-800 dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300">{err}</div>
          )}

          {tab === 'valores' ? (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Data da Baixa *</label>
                  <input
                    type="date"
                    value={paymentDate}
                    onChange={(e) => setPaymentDate(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 px-2.5 py-2 font-mono dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">
                    {mode === 'total' ? 'Saldo Total (R$)' : 'Valor a Baixar (R$) *'}
                  </label>
                  <input
                    type="text"
                    disabled={mode === 'total'}
                    value={mode === 'total' ? centsToMaskInput(totalOpenCents) : amountMask}
                    onChange={(e) => setAmountMask(formatCurrencyTyping(e.target.value))}
                    className="w-full rounded-lg border border-slate-200 px-2.5 py-2 font-mono font-bold text-right disabled:bg-slate-50 tabular-nums dark:border-slate-700"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Juros (+)</label>
                  <input
                    type="text"
                    value={interestMask}
                    onChange={(e) => setInterestMask(formatCurrencyTyping(e.target.value))}
                    className="w-full rounded-lg border border-slate-200 px-2.5 py-2 font-mono text-right tabular-nums dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Multa (+)</label>
                  <input
                    type="text"
                    value={fineMask}
                    onChange={(e) => setFineMask(formatCurrencyTyping(e.target.value))}
                    className="w-full rounded-lg border border-slate-200 px-2.5 py-2 font-mono text-right tabular-nums dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Desconto (-)</label>
                  <input
                    type="text"
                    value={discountMask}
                    onChange={(e) => setDiscountMask(formatCurrencyTyping(e.target.value))}
                    className="w-full rounded-lg border border-slate-200 px-2.5 py-2 font-mono text-right tabular-nums dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 overflow-hidden dark:border-slate-700">
                <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 font-semibold text-slate-700 dark:bg-slate-800/70 dark:border-slate-700 dark:text-slate-200">
                  Títulos incluídos nesta baixa
                </div>
                <table className="w-full text-left text-[11px]">
                  <thead className="text-slate-500 border-b border-slate-100 dark:text-slate-400 dark:border-slate-800">
                    <tr>
                      <th className="px-3 py-1.5">Documento</th>
                      <th className="px-3 py-1.5">Vencimento</th>
                      <th className="px-3 py-1.5 text-right">Saldo Aberto</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {titles.map((t) => (
                      <tr key={t.id}>
                        <td className="px-3 py-1.5 font-mono font-semibold text-slate-900 dark:text-slate-100">
                          {t.documentNumber || t.titleCode} · {t.clientName || '—'}
                        </td>
                        <td className="px-3 py-1.5 font-mono tabular-nums">{formatIsoDateToBR(t.dueDate)}</td>
                        <td className="px-3 py-1.5 text-right font-mono font-semibold tabular-nums">
                          {formatBRL(getBal(t))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="space-y-3.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Conta Bancária *</label>
                  <select
                    value={bankAccountId}
                    onChange={(e) => setBankAccountId(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 bg-white dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  >
                    <option value="">Selecione...</option>
                    {bankAccounts.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.bankName} {b.agency ? `· Ag ${b.agency}` : ''} {b.accountNumber ? `/ CC ${b.accountNumber}` : ''} (
                        {formatBRL(b.currentBalanceCents)})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Forma de Pagamento</label>
                  <select
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 bg-white dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  >
                    {PAYMENT_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Histórico do Movimento Bancário</label>
                <textarea
                  rows={2}
                  value={history}
                  onChange={(e) => setHistory(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
            </div>
          )}

          <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3 flex flex-wrap items-center justify-between gap-2 dark:border-emerald-800/70 dark:bg-emerald-950/50">
            <span className="text-emerald-900 font-semibold dark:text-emerald-300">
              Valor líquido a {scope === 'RECEBER' ? 'entrar' : 'sair'} na conta selecionada:
            </span>
            <span className="font-mono text-base font-bold text-emerald-700 tabular-nums dark:text-emerald-300">
              {formatBRL(netCents)}
            </span>
          </div>
        </div>

        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between dark:border-slate-700 dark:bg-slate-800/70">
          <span className="text-[11px] text-slate-500 dark:text-slate-400">Atalho: Ctrl+Enter para confirmar</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={handleConfirm}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              {busy ? 'Registrando...' : 'Confirmar Baixa'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

/* ============================================================================
 * 2. DEDUCTION & LINK ADVANCE/RETURN MODAL
 * ========================================================================== */
interface DeductionModalProps {
  open: boolean;
  title: string;
  subtitle: string;
  targetTitles: FinancialTitle[];
  availableCredits: FinancialTitle[];
  skipLabel: string;
  onClose: () => void;
  onSkip?: () => void;
  onApplied: (coveredFull: boolean, totalAppliedCents: number) => Promise<void>;
}

export const DeductionModal: React.FC<DeductionModalProps> = ({
  open,
  title,
  subtitle,
  targetTitles,
  availableCredits,
  skipLabel,
  onClose,
  onSkip,
  onApplied,
}) => {
  const [selectedMap, setSelectedMap] = useState<Record<number, boolean>>({});
  const [amountMap, setAmountMap] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const targetSum = useMemo(() => targetTitles.reduce((a, t) => a + getBal(t), 0), [targetTitles]);

  useEffect(() => {
    if (!open) return;
    setErr('');
    const initSel: Record<number, boolean> = {};
    const initAmt: Record<number, string> = {};
    let rem = targetSum;
    for (const c of availableCredits) {
      const cBal = getBal(c);
      const suggest = Math.min(cBal, rem);
      initSel[c.id] = suggest > 0;
      initAmt[c.id] = centsToMaskInput(suggest > 0 ? suggest : cBal);
      rem = Math.max(0, rem - suggest);
    }
    setSelectedMap(initSel);
    setAmountMap(initAmt);
  }, [open, availableCredits, targetSum]);

  const totalToApply = useMemo(() => {
    return availableCredits.reduce((acc, c) => {
      if (!selectedMap[c.id]) return acc;
      return acc + Math.min(getBal(c), parseMaskInputToCents(amountMap[c.id] || '0,00'));
    }, 0);
  }, [availableCredits, selectedMap, amountMap]);

  const handleApply = async () => {
    setErr('');
    if (totalToApply <= 0) return setErr('Selecione ao menos um crédito com valor maior que zero.');
    if (totalToApply > targetSum) return setErr('A dedução não pode ultrapassar o saldo do(s) título(s).');

    const links = availableCredits
      .filter((c) => selectedMap[c.id])
      .map((c) => ({
        sourceTitleId: c.id,
        amountCents: Math.min(getBal(c), parseMaskInputToCents(amountMap[c.id] || '0,00')),
      }))
      .filter((l) => l.amountCents > 0);

    setBusy(true);
    try {
      const res = await apiFetch<{ totalDeduct: number; coveredFull: boolean }>(
        '/api/financial-titles/link-deductions',
        {
          method: 'POST',
          body: JSON.stringify({ targetTitleIds: targetTitles.map((t) => t.id), links }),
        }
      );
      await onApplied(res.coveredFull, res.totalDeduct);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erro ao vincular créditos.');
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 dark:bg-slate-950/80" onClick={onClose}>
      <div
        className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden text-xs dark:border-slate-700 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between bg-amber-50/70 dark:border-slate-700 dark:bg-amber-950/50">
          <div className="flex items-center gap-2">
            <Link2 className="w-4 h-4 text-amber-700 dark:text-amber-300" />
            <div>
              <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">{title}</h3>
              <p className="text-[11px] text-slate-600 dark:text-slate-300">{subtitle}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-1 text-slate-400 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 max-h-[65vh] overflow-y-auto">
          {err && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-800 dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300">{err}</div>}
          <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800/70">
            <span className="text-slate-600 dark:text-slate-300">Saldo total a compensar nos títulos destino:</span>
            <span className="font-mono font-bold text-slate-900 tabular-nums dark:text-slate-100">{formatBRL(targetSum)}</span>
          </div>

          <div className="border border-slate-200 rounded-xl overflow-hidden dark:border-slate-700">
            <table className="w-full text-left text-[11px]">
              <thead className="bg-slate-50 text-slate-500 border-b border-slate-200 dark:bg-slate-800/70 dark:text-slate-400 dark:border-slate-700">
                <tr>
                  <th className="px-3 py-2 w-8">Usar</th>
                  <th className="px-3 py-2">Tipo / Documento</th>
                  <th className="px-3 py-2 text-right">Saldo Disponível</th>
                  <th className="px-3 py-2 text-right w-32">Valor a Deduzir</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {availableCredits.map((c) => {
                  const bal = getBal(c);
                  return (
                    <tr key={c.id}>
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={Boolean(selectedMap[c.id])}
                          onChange={(e) => setSelectedMap((p) => ({ ...p, [c.id]: e.target.checked }))}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                          {c.documentNumber || c.titleCode}
                        </div>
                        <div className="text-[10px] text-amber-800 font-semibold dark:text-amber-300">
                          {String(c.titleType).toUpperCase()} · {c.description}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right font-mono font-bold tabular-nums text-slate-700 dark:text-slate-200">
                        {formatBRL(bal)}
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="text"
                          disabled={!selectedMap[c.id]}
                          value={amountMap[c.id] || '0,00'}
                          onChange={(e) =>
                            setAmountMap((p) => ({ ...p, [c.id]: formatCurrencyTyping(e.target.value) }))
                          }
                          className="w-full rounded border border-slate-200 px-2 py-1 text-right font-mono disabled:bg-slate-50 tabular-nums dark:border-slate-700"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between text-xs font-semibold">
            <span className="text-slate-600 dark:text-slate-300">Total da dedução selecionada:</span>
            <span className="font-mono text-amber-800 font-bold tabular-nums dark:text-amber-300">{formatBRL(totalToApply)}</span>
          </div>
        </div>

        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2 dark:border-slate-700 dark:bg-slate-800/70">
          <button
            type="button"
            onClick={() => (onSkip ? onSkip() : onClose())}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          >
            {skipLabel}
          </button>
          <button
            type="button"
            disabled={busy || totalToApply <= 0}
            onClick={handleApply}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-emerald-600 dark:hover:bg-emerald-500"
          >
            <Link2 className="w-3.5 h-3.5" />
            {busy ? 'Aplicando...' : 'Aplicar Dedução'}
          </button>
        </div>
      </div>
    </div>
  );
};

/* ============================================================================
 * 3. RELEASE PROTEST / PROVISION MODAL
 * ========================================================================== */
interface ReleaseModalProps {
  title: FinancialTitle | null;
  onClose: () => void;
  onReleased: (msg: string) => Promise<void>;
}

export const ReleaseProtestProvisionModal: React.FC<ReleaseModalProps> = ({ title, onClose, onReleased }) => {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    setReason('');
    setErr('');
  }, [title?.id]);

  if (!title) return null;
  const releaseType: 'PROTEST' | 'PROVISION' = title.isProtested ? 'PROTEST' : 'PROVISION';

  const handleConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) return setErr('Informe o motivo da liberação para auditoria.');
    setBusy(true);
    setErr('');
    try {
      await apiFetch(`/api/financial-titles/${title.id}/release`, {
        method: 'POST',
        body: JSON.stringify({ releaseType, reason: reason.trim() }),
      });
      await onReleased(
        `Liberação de ${releaseType === 'PROTEST' ? 'Protesto' : 'Provisão'} registrada no título ${title.documentNumber || title.titleCode}.`
      );
      onClose();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Erro ao liberar título.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 dark:bg-slate-950/80" onClick={onClose}>
      <form
        onSubmit={handleConfirm}
        className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden text-xs dark:border-slate-700 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between bg-slate-50 dark:border-slate-700 dark:bg-slate-800/70">
          <div className="flex items-center gap-2">
            <Unlock className="w-4 h-4 text-emerald-700 dark:text-emerald-300" />
            <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
              Liberar {releaseType === 'PROTEST' ? 'Protesto' : 'Provisão'}
            </h3>
          </div>
          <button type="button" onClick={onClose}>
            <X className="w-4 h-4 text-slate-400 dark:text-slate-400" />
          </button>
        </div>

        <div className="p-5 space-y-3">
          {err && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-800 dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300">{err}</div>}
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-1 dark:border-slate-700 dark:bg-slate-800/70">
            <div className="font-mono font-bold text-slate-900 dark:text-slate-100">
              {title.documentNumber || title.titleCode} · {formatBRL(getBal(title))}
            </div>
            <div className="text-slate-600 dark:text-slate-300">{title.clientName || '—'} · {title.description}</div>
          </div>
          <div>
            <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Motivo da Liberação *</label>
            <textarea
              rows={3}
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Descreva a autorização ou justificativa para retornar o título ao status ABERTO..."
              className="w-full rounded-lg border border-slate-200 p-2.5 dark:border-slate-700"
            />
          </div>
        </div>

        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex justify-end gap-2 dark:border-slate-700 dark:bg-slate-800/70">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 bg-white px-4 py-2 font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
            Cancelar
          </button>
          <button type="submit" disabled={busy} className="rounded-lg bg-emerald-600 px-4 py-2 font-semibold text-white hover:bg-emerald-700">
            {busy ? 'Liberando...' : 'Confirmar Liberação'}
          </button>
        </div>
      </form>
    </div>
  );
};

/* ============================================================================
 * 4. CANCEL SETTLEMENT MODAL
 * ========================================================================== */
interface CancelSettlementModalProps {
  open: boolean;
  titles: FinancialTitle[];
  settlementsByTitle: Record<number, TitleSettlement[]>;
  onClose: () => void;
  onCancelled: (msg: string) => Promise<void>;
}

export const CancelSettlementModal: React.FC<CancelSettlementModalProps> = ({
  open,
  titles,
  settlementsByTitle,
  onClose,
  onCancelled,
}) => {
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [fetchedRows, setFetchedRows] = useState<Array<TitleSettlement & { titleDoc: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!open) return;
    setErr('');
    const list: Array<TitleSettlement & { titleDoc: string }> = [];
    for (const t of titles) {
      const rows = settlementsByTitle[t.id] || [];
      for (const r of rows) {
        if (r.origin !== 'FATURA GERADA') {
          list.push({ ...r, titleDoc: t.documentNumber || t.titleCode });
        }
      }
    }
    if (list.length > 0) {
      setFetchedRows(list);
      setSelectedIds(list.map((r) => r.id));
    } else {
      // Fallback fetch directly
      Promise.all(
        titles.map((t) =>
          apiFetch<{ settlements: TitleSettlement[] }>(`/api/financial-titles/${t.id}/settlements`).then((res) =>
            (res.settlements || []).map((r) => ({ ...r, titleDoc: t.documentNumber || t.titleCode }))
          )
        )
      )
        .then((all) => {
          const flat = all.flat().filter((r) => r.origin !== 'FATURA GERADA');
          setFetchedRows(flat);
          setSelectedIds(flat.map((r) => r.id));
        })
        .catch(() => setFetchedRows([]));
    }
  }, [open, titles, settlementsByTitle]);

  const handleConfirm = async () => {
    if (selectedIds.length === 0) return setErr('Selecione ao menos uma baixa para estornar.');
    setBusy(true);
    setErr('');
    try {
      const res = await apiFetch<{ cancelledCount: number }>('/api/financial-titles/cancel-settlements', {
        method: 'POST',
        body: JSON.stringify({ settlementIds: selectedIds }),
      });
      await onCancelled(`${res.cancelledCount} baixa(s) estornada(s) e movimentações bancárias ajustadas.`);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erro ao cancelar baixas.');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        handleConfirm();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 dark:bg-slate-950/80" onClick={onClose}>
      <div
        className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden text-xs dark:border-slate-700 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between bg-red-50/60 dark:border-slate-700 dark:bg-red-950/50">
          <div>
            <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">Cancelar Baixa(s) & Estornar Saldo Bancário</h3>
            <p className="text-[11px] text-slate-600 dark:text-slate-300">
              Ao cancelar uma baixa, o título reabre o saldo correspondente e o lançamento no movimento bancário é estornado.
            </p>
          </div>
          <button type="button" onClick={onClose}>
            <X className="w-4 h-4 text-slate-400 dark:text-slate-400" />
          </button>
        </div>

        <div className="p-5 space-y-3 max-h-[60vh] overflow-y-auto">
          {err && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-800 dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300">{err}</div>}
          {fetchedRows.length === 0 ? (
            <div className="py-8 text-center text-slate-500 dark:text-slate-400">Nenhuma baixa elegível encontrada nos títulos selecionados.</div>
          ) : (
            <div className="rounded-xl border border-slate-200 overflow-hidden dark:border-slate-700">
              <table className="w-full text-left text-[11px]">
                <thead className="bg-slate-50 text-slate-500 border-b border-slate-200 dark:bg-slate-800/70 dark:text-slate-400 dark:border-slate-700">
                  <tr>
                    <th className="px-3 py-2 w-8">Est.</th>
                    <th className="px-3 py-2">Documento</th>
                    <th className="px-3 py-2">Data</th>
                    <th className="px-3 py-2">Origem</th>
                    <th className="px-3 py-2 text-right">Valor Baixado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {fetchedRows.map((r) => (
                    <tr key={r.id}>
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(r.id)}
                          onChange={(e) =>
                            setSelectedIds((prev) =>
                              e.target.checked ? [...prev, r.id] : prev.filter((x) => x !== r.id)
                            )
                          }
                        />
                      </td>
                      <td className="px-3 py-2 font-mono font-semibold">{r.titleDoc}</td>
                      <td className="px-3 py-2 font-mono">{formatIsoDateToBR(r.settlementDate)}</td>
                      <td className="px-3 py-2">{r.origin} · {r.paymentMethod}</td>
                      <td className="px-3 py-2 text-right font-mono font-bold tabular-nums text-emerald-700 dark:text-emerald-300">
                        {formatBRL(r.amountCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between dark:border-slate-700 dark:bg-slate-800/70">
          <span className="text-[11px] text-slate-500 dark:text-slate-400">Atalho: Ctrl+Enter para confirmar</span>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 bg-white px-4 py-2 font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
              Fechar
            </button>
            <button
              type="button"
              disabled={busy || selectedIds.length === 0}
              onClick={handleConfirm}
              className="rounded-lg bg-red-600 px-4 py-2 font-semibold text-white hover:bg-red-700 disabled:opacity-50"
            >
              {busy ? 'Estornando...' : `Estornar Baixas (${selectedIds.length})`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

/* ============================================================================
 * 5. RECURRING INSTALLMENTS MODAL
 * ========================================================================== */
interface RecurringModalProps {
  modelTitle: FinancialTitle | null;
  onClose: () => void;
  onCreated: (msg: string) => Promise<void>;
}

export const RecurringInstallmentsModal: React.FC<RecurringModalProps> = ({
  modelTitle,
  onClose,
  onCreated,
}) => {
  const [qty, setQty] = useState(12);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    setQty(12);
    setErr('');
  }, [modelTitle?.id]);

  const preview = useMemo(() => {
    if (!modelTitle) return [];
    const safeQty = Math.min(120, Math.max(1, qty || 1));
    const baseDoc = modelTitle.documentNumber || modelTitle.titleCode;
    const origRaw = modelTitle.originalValueCents ?? 0;
    const val = origRaw > 0 ? origRaw : modelTitle.amountCents;
    return Array.from({ length: Math.min(safeQty, 24) }, (_, idx) => {
      const i = idx + 1;
      const d = new Date(modelTitle.dueDate);
      d.setMonth(d.getMonth() + i);
      return {
        num: i,
        doc: `${baseDoc}-${String(i).padStart(2, '0')}/${String(safeQty).padStart(2, '0')}`,
        dueIso: d.toISOString().slice(0, 10),
        val,
      };
    });
  }, [modelTitle, qty]);

  const handleConfirm = async () => {
    if (!modelTitle) return;
    setBusy(true);
    setErr('');
    try {
      const res = await apiFetch<{ createdCount: number }>('/api/financial-titles/create-installments', {
        method: 'POST',
        body: JSON.stringify({ parentTitleId: modelTitle.id, count: Math.min(120, Math.max(1, qty)) }),
      });
      await onCreated(`${res.createdCount} parcela(s) recorrente(s) criada(s) a partir de ${modelTitle.documentNumber || modelTitle.titleCode}.`);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erro ao gerar recorrência.');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!modelTitle) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        handleConfirm();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!modelTitle) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 dark:bg-slate-950/80" onClick={onClose}>
      <div
        className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden text-xs dark:border-slate-700 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between bg-slate-50 dark:border-slate-700 dark:bg-slate-800/70">
          <div className="flex items-center gap-2">
            <Repeat className="w-4 h-4 text-blue-700 dark:text-blue-300" />
            <div>
              <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">Lançamento Recorrente Mensal</h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Modelo: {modelTitle.documentNumber || modelTitle.titleCode} · {modelTitle.clientName}
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose}>
            <X className="w-4 h-4 text-slate-400 dark:text-slate-400" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {err && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-800 dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300">{err}</div>}
          <div className="grid grid-cols-2 gap-4 items-end">
            <div>
              <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Qtd. Parcelas Futuras (1 a 120) *</label>
              <input
                type="number"
                min={1}
                max={120}
                value={qty}
                onChange={(e) => setQty(Math.min(120, Math.max(1, Number(e.target.value || 1))))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono font-bold dark:border-slate-700"
              />
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 dark:border-slate-700 dark:bg-slate-800/70">
              <div className="text-[10px] text-slate-500 dark:text-slate-400">Valor unitário replicado</div>
              <div className="font-mono font-bold text-slate-900 tabular-nums dark:text-slate-100">
                {formatBRL((modelTitle.originalValueCents ?? 0) > 0 ? (modelTitle.originalValueCents ?? 0) : modelTitle.amountCents)}
              </div>
            </div>
          </div>

          <div className="border border-slate-200 rounded-xl max-h-56 overflow-y-auto dark:border-slate-700">
            <table className="w-full text-left text-[11px]">
              <thead className="bg-slate-50 text-slate-500 border-b border-slate-200 sticky top-0 dark:bg-slate-800/70 dark:text-slate-400 dark:border-slate-700">
                <tr>
                  <th className="px-3 py-1.5">Parcela</th>
                  <th className="px-3 py-1.5">Documento</th>
                  <th className="px-3 py-1.5">Vencimento</th>
                  <th className="px-3 py-1.5 text-right">Valor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {preview.map((p) => (
                  <tr key={p.num}>
                    <td className="px-3 py-1.5 font-mono">{p.num}</td>
                    <td className="px-3 py-1.5 font-mono font-semibold">{p.doc}</td>
                    <td className="px-3 py-1.5 font-mono">{formatIsoDateToBR(p.dueIso)}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums">{formatBRL(p.val)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {qty > 24 && (
              <div className="px-3 py-1.5 bg-slate-50 text-slate-500 text-center text-[10px] dark:bg-slate-800/70 dark:text-slate-400">
                ... e mais {qty - 24} parcelas mensais subsequentes.
              </div>
            )}
          </div>
        </div>

        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between dark:border-slate-700 dark:bg-slate-800/70">
          <span className="text-[11px] text-slate-500 dark:text-slate-400">Atalho: Ctrl+Enter para gerar</span>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 bg-white px-4 py-2 font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
              Cancelar
            </button>
            <button type="button" disabled={busy} onClick={handleConfirm} className="rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white hover:bg-slate-800 dark:bg-emerald-600 dark:hover:bg-emerald-500">
              {busy ? 'Gerando...' : `Gerar ${qty} Parcelas`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

/* ============================================================================
 * 6. VIEW CHILDREN MODAL (Parcelas Recorrentes)
 * ========================================================================== */
interface ViewChildrenModalProps {
  parentTitle: FinancialTitle | null;
  onClose: () => void;
  onOpenTitle: (t: FinancialTitle) => void;
}

export const ViewChildrenModal: React.FC<ViewChildrenModalProps> = ({ parentTitle, onClose, onOpenTitle }) => {
  const [children, setChildren] = useState<FinancialTitle[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!parentTitle) return;
    setLoading(true);
    apiFetch<{ children: FinancialTitle[] }>(`/api/financial-titles/${parentTitle.id}/children`)
      .then((res) => setChildren(res.children || []))
      .catch(() => setChildren([]))
      .finally(() => setLoading(false));
  }, [parentTitle?.id]);

  if (!parentTitle) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 dark:bg-slate-950/80" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden text-xs dark:border-slate-700 dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between bg-slate-50 dark:border-slate-700 dark:bg-slate-800/70">
          <div>
            <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
              Parcelas Recorrentes de {parentTitle.documentNumber || parentTitle.titleCode}
            </h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">Clique em qualquer parcela para abrir e editar</p>
          </div>
          <button type="button" onClick={onClose}>
            <X className="w-4 h-4 text-slate-400 dark:text-slate-400" />
          </button>
        </div>

        <div className="p-5 max-h-[65vh] overflow-y-auto">
          {loading ? (
            <div className="py-8 text-center text-slate-500 dark:text-slate-400">Carregando parcelas...</div>
          ) : children.length === 0 ? (
            <div className="py-8 text-center text-slate-500 dark:text-slate-400">Nenhuma parcela filha encontrada para este título modelo.</div>
          ) : (
            <div className="border border-slate-200 rounded-xl overflow-hidden dark:border-slate-700">
              <table className="w-full text-left text-[11px]">
                <thead className="bg-slate-50 text-slate-500 border-b border-slate-200 dark:bg-slate-800/70 dark:text-slate-400 dark:border-slate-700">
                  <tr>
                    <th className="px-3 py-2">Documento</th>
                    <th className="px-3 py-2">Parcela</th>
                    <th className="px-3 py-2">Vencimento</th>
                    <th className="px-3 py-2 text-right">Valor</th>
                    <th className="px-3 py-2 text-right">Saldo</th>
                    <th className="px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {children.map((ch) => (
                    <tr
                      key={ch.id}
                      onClick={() => {
                        onClose();
                        onOpenTitle(ch);
                      }}
                      className="hover:bg-blue-50/40 cursor-pointer"
                    >
                      <td className="px-3 py-2 font-mono font-semibold text-blue-700 dark:text-blue-300">
                        {ch.documentNumber || ch.titleCode}
                      </td>
                      <td className="px-3 py-2 font-mono">{ch.installmentNumber}/{ch.totalInstallments}</td>
                      <td className="px-3 py-2 font-mono">{formatIsoDateToBR(ch.dueDate)}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">{formatBRL(ch.amountCents)}</td>
                      <td className="px-3 py-2 text-right font-mono font-bold tabular-nums">{formatBRL(getBal(ch))}</td>
                      <td className="px-3 py-2 font-semibold">{String(ch.status).toUpperCase()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

/* ============================================================================
 * 7. GROUP INVOICE MODAL (Gerar Faturas) & TRACE MODAL (Rastreio)
 * ========================================================================== */
interface GroupInvoiceModalProps {
  open: boolean;
  titles: FinancialTitle[];
  onClose: () => void;
  onGrouped: (msg: string) => Promise<void>;
}

export const GroupInvoiceModal: React.FC<GroupInvoiceModalProps> = ({ open, titles, onClose, onGrouped }) => {
  const defaultDue = useMemo(() => new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10), []);
  const [baseDoc, setBaseDoc] = useState('');
  const [installments, setInstallments] = useState(1);
  const [firstDueDate, setFirstDueDate] = useState(defaultDue);
  const [intervalDays, setIntervalDays] = useState(30);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!open) return;
    setBaseDoc(`FAT-${Date.now().toString().slice(-4)}`);
    setInstallments(1);
    setFirstDueDate(defaultDue);
    setIntervalDays(30);
    setErr('');
  }, [open, defaultDue]);

  const totalBal = useMemo(() => titles.reduce((a, t) => a + getBal(t), 0), [titles]);

  const schedulePreview = useMemo(() => {
    const qty = Math.min(60, Math.max(1, installments || 1));
    const base = Math.floor(totalBal / qty);
    const rem = totalBal - base * qty;
    const startMs = firstDueDate ? new Date(`${firstDueDate}T12:00:00`).getTime() : Date.now();
    return Array.from({ length: qty }, (_, idx) => {
      const due = new Date(startMs + idx * intervalDays * 86400000).toISOString().slice(0, 10);
      const cleanBase = baseDoc.trim().startsWith('FAT-') ? baseDoc.trim() : `FAT-${baseDoc.trim()}`;
      return {
        num: idx + 1,
        doc: `${cleanBase}-${String(idx + 1).padStart(2, '0')}`,
        due,
        val: idx === qty - 1 ? base + rem : base,
      };
    });
  }, [totalBal, installments, firstDueDate, intervalDays, baseDoc]);

  const handleConfirm = async () => {
    setErr('');
    if (!baseDoc.trim()) return setErr('Informe o Nº Documento base da fatura.');
    setBusy(true);
    try {
      const res = await apiFetch<{ invoiceGroupId: string; invoices: FinancialTitle[] }>(
        '/api/financial-titles/group-invoice',
        {
          method: 'POST',
          body: JSON.stringify({
            titleIds: titles.map((t) => t.id),
            baseDocument: baseDoc.trim(),
            installments,
            firstDueDate,
            intervalDays,
          }),
        }
      );
      await onGrouped(`${res.invoices.length} fatura(s) gerada(s) com sucesso (Grupo ${res.invoiceGroupId.slice(0, 8)}).`);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erro ao agrupar faturas.');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        handleConfirm();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 dark:bg-slate-950/80" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden text-xs dark:border-slate-700 dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between bg-blue-50/70 dark:border-slate-700 dark:bg-blue-950/50">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-blue-700 dark:text-blue-300" />
            <div>
              <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">Gerar Faturas (Agrupamento de Títulos)</h3>
              <p className="text-[11px] text-slate-600 dark:text-slate-300">
                Agrupando {titles.length} título(s) · Valor consolidado: {formatBRL(totalBal)}
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose}>
            <X className="w-4 h-4 text-slate-400 dark:text-slate-400" />
          </button>
        </div>

        <div className="p-5 space-y-4 max-h-[65vh] overflow-y-auto">
          {err && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-800 dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300">{err}</div>}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Doc. Base *</label>
              <input
                type="text"
                value={baseDoc}
                onChange={(e) => setBaseDoc(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-2.5 py-2 font-mono font-bold dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Parcelas (1-60)</label>
              <input
                type="number"
                min={1}
                max={60}
                value={installments}
                onChange={(e) => setInstallments(Math.min(60, Math.max(1, Number(e.target.value || 1))))}
                className="w-full rounded-lg border border-slate-200 px-2.5 py-2 font-mono dark:border-slate-700"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">1º Vencimento</label>
              <input
                type="date"
                value={firstDueDate}
                onChange={(e) => setFirstDueDate(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-2.5 py-2 font-mono dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Intervalo</label>
              <select
                value={intervalDays}
                onChange={(e) => setIntervalDays(Number(e.target.value))}
                className="w-full rounded-lg border border-slate-200 px-2.5 py-2 bg-white dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              >
                {[7, 10, 15, 20, 30, 45, 60, 90].map((d) => (
                  <option key={d} value={d}>
                    A cada {d} dias
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="border border-slate-200 rounded-xl overflow-hidden dark:border-slate-700">
            <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 font-semibold text-slate-700 dark:bg-slate-800/70 dark:border-slate-700 dark:text-slate-200">
              Pré-visualização das Faturas a Emitir
            </div>
            <table className="w-full text-left text-[11px]">
              <thead className="text-slate-500 border-b border-slate-100 dark:text-slate-400 dark:border-slate-800">
                <tr>
                  <th className="px-3 py-1.5">Parcela</th>
                  <th className="px-3 py-1.5">Nº Documento</th>
                  <th className="px-3 py-1.5">Vencimento</th>
                  <th className="px-3 py-1.5 text-right">Valor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {schedulePreview.map((s) => (
                  <tr key={s.num}>
                    <td className="px-3 py-1.5 font-mono">{s.num}/{installments}</td>
                    <td className="px-3 py-1.5 font-mono font-semibold text-blue-700 dark:text-blue-300">{s.doc}</td>
                    <td className="px-3 py-1.5 font-mono">{formatIsoDateToBR(s.due)}</td>
                    <td className="px-3 py-1.5 text-right font-mono font-bold tabular-nums">{formatBRL(s.val)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between dark:border-slate-700 dark:bg-slate-800/70">
          <span className="text-[11px] text-slate-500 dark:text-slate-400">Atalho: Ctrl+Enter para gerar</span>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 bg-white px-4 py-2 font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
              Cancelar
            </button>
            <button type="button" disabled={busy} onClick={handleConfirm} className="rounded-lg bg-blue-700 px-4 py-2 font-semibold text-white hover:bg-blue-800">
              {busy ? 'Gerando...' : 'Gerar Faturas'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

interface InvoiceTraceModalProps {
  targetTitle: FinancialTitle | null;
  allTitles: FinancialTitle[];
  onClose: () => void;
  onOpenTitle: (t: FinancialTitle) => void;
}

export const InvoiceTraceModal: React.FC<InvoiceTraceModalProps> = ({
  targetTitle,
  allTitles,
  onClose,
  onOpenTitle,
}) => {
  if (!targetTitle) return null;
  const groupRows = allTitles.filter((t) => t.invoiceGroupId && t.invoiceGroupId === targetTitle.invoiceGroupId);
  const origins = groupRows.filter((r) => String(r.titleType).toUpperCase() !== 'FATURA');
  const invoices = groupRows.filter((r) => String(r.titleType).toUpperCase() === 'FATURA');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 dark:bg-slate-950/80" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden text-xs dark:border-slate-700 dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between bg-slate-50 dark:border-slate-700 dark:bg-slate-800/70">
          <div>
            <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
              Rastreio de Faturamento · Grupo {targetTitle.invoiceGroupId?.slice(0, 8)}
            </h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">Origem dos títulos agrupados e faturas geradas</p>
          </div>
          <button type="button" onClick={onClose}>
            <X className="w-4 h-4 text-slate-400 dark:text-slate-400" />
          </button>
        </div>

        <div className="p-5 space-y-4 max-h-[65vh] overflow-y-auto">
          <div className="border border-slate-200 rounded-xl overflow-hidden dark:border-slate-700">
            <div className="px-3 py-2 bg-slate-50 font-semibold text-slate-700 border-b border-slate-200 dark:bg-slate-800/70 dark:text-slate-200 dark:border-slate-700">
              Títulos Originais Agrupados ({origins.length})
            </div>
            <table className="w-full text-left text-[11px]">
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {origins.map((o) => (
                  <tr key={o.id} onClick={() => { onClose(); onOpenTitle(o); }} className="hover:bg-blue-50/40 cursor-pointer">
                    <td className="px-3 py-2 font-mono font-semibold text-blue-700 dark:text-blue-300">{o.documentNumber || o.titleCode}</td>
                    <td className="px-3 py-2">{o.description}</td>
                    <td className="px-3 py-2 font-mono">{formatIsoDateToBR(o.dueDate)}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{formatBRL(o.originalValueCents || o.amountCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="border border-blue-200 rounded-xl overflow-hidden dark:border-blue-800/70">
            <div className="px-3 py-2 bg-blue-50 font-semibold text-blue-900 border-b border-blue-200 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-800/70">
              Faturas Emitidas ({invoices.length})
            </div>
            <table className="w-full text-left text-[11px]">
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {invoices.map((inv) => (
                  <tr key={inv.id} onClick={() => { onClose(); onOpenTitle(inv); }} className="hover:bg-blue-50/40 cursor-pointer">
                    <td className="px-3 py-2 font-mono font-semibold text-blue-700 dark:text-blue-300">{inv.documentNumber || inv.titleCode}</td>
                    <td className="px-3 py-2 font-mono">{inv.installmentNumber}/{inv.totalInstallments}</td>
                    <td className="px-3 py-2 font-mono">{formatIsoDateToBR(inv.dueDate)}</td>
                    <td className="px-3 py-2 text-right font-mono font-bold tabular-nums">{formatBRL(inv.amountCents)}</td>
                    <td className="px-3 py-2 font-semibold">{String(inv.status).toUpperCase()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

/* ============================================================================
 * 8. EDIT PARTNER / SUPPLIER MODAL (PUT /api/clients/:id)
 * ========================================================================== */
interface EditPartnerModalProps {
  person: Client | null;
  label: string;
  onClose: () => void;
  onUpdated: (updated: Client) => Promise<void>;
}

export const EditPartnerModal: React.FC<EditPartnerModalProps> = ({ person, label, onClose, onUpdated }) => {
  const [fullName, setFullName] = useState('');
  const [personNature, setPersonNature] = useState('PF');
  const [cpfCnpj, setCpfCnpj] = useState('');
  const [phone, setPhone] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [email, setEmail] = useState('');
  const [zipCode, setZipCode] = useState('');
  const [address, setAddress] = useState('');
  const [addressNumber, setAddressNumber] = useState('');
  const [neighborhood, setNeighborhood] = useState('');
  const [city, setCity] = useState('');
  const [stateUf, setStateUf] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!person) return;
    setErr('');
    setFullName(person.fullName || '');
    setPersonNature(person.personNature || 'PF');
    setCpfCnpj(person.cpfCnpj || '');
    setPhone(person.phone || '');
    setWhatsapp(person.whatsapp || person.phone || '');
    setEmail(person.email || '');
    setZipCode(person.zipCode || '');
    setAddress(person.address || '');
    setAddressNumber(person.addressNumber || '');
    setNeighborhood(person.neighborhood || '');
    setCity(person.city || '');
    setStateUf(person.state || '');
    setNotes(person.notes || '');
  }, [person]);

  if (!person) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim()) return setErr('Nome / Razão Social é obrigatório.');
    setBusy(true);
    setErr('');
    try {
      const res = await apiFetch<{ client: Client }>(`/api/clients/${person.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          fullName: fullName.trim(),
          personNature,
          cpfCnpj,
          phone,
          whatsapp,
          email,
          zipCode,
          address,
          addressNumber,
          neighborhood,
          city,
          state: stateUf.toUpperCase().slice(0, 2),
          notes,
        }),
      });
      await onUpdated(res.client);
      onClose();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Erro ao atualizar cadastro.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 dark:bg-slate-950/80" onClick={onClose}>
      <form
        onSubmit={handleSave}
        className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden text-xs dark:border-slate-700 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between bg-slate-50 dark:border-slate-700 dark:bg-slate-800/70">
          <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">Editar Cadastro de {label}</h3>
          <button type="button" onClick={onClose}>
            <X className="w-4 h-4 text-slate-400 dark:text-slate-400" />
          </button>
        </div>

        <div className="p-5 space-y-3 max-h-[70vh] overflow-y-auto">
          {err && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-800 dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300">{err}</div>}
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
            <div className="sm:col-span-6">
              <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Nome / Razão Social *</label>
              <input
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Tipo</label>
              <select
                value={personNature}
                onChange={(e) => setPersonNature(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-2.5 py-2 bg-white dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              >
                <option value="PF">PF</option>
                <option value="PJ">PJ</option>
              </select>
            </div>
            <div className="sm:col-span-4">
              <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">CPF / CNPJ</label>
              <input
                type="text"
                value={cpfCnpj}
                onChange={(e) => setCpfCnpj(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
            <div className="sm:col-span-4">
              <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Telefone</label>
              <input type="text" value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100" />
            </div>
            <div className="sm:col-span-4">
              <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">WhatsApp</label>
              <input type="text" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100" />
            </div>
            <div className="sm:col-span-4">
              <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">E-mail</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100" />
            </div>
            <div className="sm:col-span-3">
              <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">CEP</label>
              <input type="text" value={zipCode} onChange={(e) => setZipCode(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100" />
            </div>
            <div className="sm:col-span-7">
              <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Endereço</label>
              <input type="text" value={address} onChange={(e) => setAddress(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100" />
            </div>
            <div className="sm:col-span-2">
              <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Número</label>
              <input type="text" value={addressNumber} onChange={(e) => setAddressNumber(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100" />
            </div>
            <div className="sm:col-span-4">
              <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Bairro</label>
              <input type="text" value={neighborhood} onChange={(e) => setNeighborhood(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100" />
            </div>
            <div className="sm:col-span-6">
              <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Cidade</label>
              <input type="text" value={city} onChange={(e) => setCity(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100" />
            </div>
            <div className="sm:col-span-2">
              <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">UF</label>
              <input type="text" maxLength={2} value={stateUf} onChange={(e) => setStateUf(e.target.value.toUpperCase())} className="w-full rounded-lg border border-slate-200 px-3 py-2 uppercase font-mono dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100" />
            </div>
            <div className="sm:col-span-12">
              <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Observações</label>
              <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100" />
            </div>
          </div>
        </div>

        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex justify-end gap-2 dark:border-slate-700 dark:bg-slate-800/70">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 bg-white px-4 py-2 font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
            Cancelar
          </button>
          <button type="submit" disabled={busy} className="rounded-lg bg-emerald-600 px-4 py-2 font-semibold text-white hover:bg-emerald-700">
            {busy ? 'Salvando...' : 'Salvar Cadastro'}
          </button>
        </div>
      </form>
    </div>
  );
};

/* ============================================================================
 * 9. CANCEL IMPACT / INVOICE CANCEL / DELETE MODALS
 * ========================================================================== */
interface CancelTitlesModalProps {
  open: boolean;
  titles: FinancialTitle[];
  isInvoiceGroup: boolean;
  onClose: () => void;
  onCancelled: (msg: string) => Promise<void>;
}

export const CancelTitlesModal: React.FC<CancelTitlesModalProps> = ({
  open,
  titles,
  isInvoiceGroup,
  onClose,
  onCancelled,
}) => {
  const [impact, setImpact] = useState<{
    collectionNotesCount: number;
    negotiationsCount: number;
    legalProcessesCount: number;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!open || titles.length === 0) return;
    setErr('');
    if (!isInvoiceGroup) {
      apiFetch<{ collectionNotesCount: number; negotiationsCount: number; legalProcessesCount: number }>(
        `/api/financial-titles/cancel-impact?ids=${titles.map((t) => t.id).join(',')}`
      )
        .then(setImpact)
        .catch(() => setImpact(null));
    }
  }, [open, titles, isInvoiceGroup]);

  const handleConfirm = async () => {
    setBusy(true);
    setErr('');
    try {
      if (isInvoiceGroup && titles[0]) {
        const res = await apiFetch<{ cancelledInvoices: number; reopenedOrigins: number }>(
          `/api/financial-titles/${titles[0].id}/cancel`,
          { method: 'PATCH' }
        );
        await onCancelled(
          `Grupo de fatura cancelado (${res.cancelledInvoices} faturas canceladas e ${res.reopenedOrigins} títulos de origem reabertos).`
        );
      } else {
        const res = await apiFetch<{
          cancelledCount: number;
          blocked: Array<{ documentNumber: string; reason: string }>;
        }>('/api/financial-titles/batch-cancel', {
          method: 'POST',
          body: JSON.stringify({ titleIds: titles.map((t) => t.id) }),
        });
        if (res.blocked && res.blocked.length > 0 && res.cancelledCount === 0) {
          setErr(`${res.blocked[0].documentNumber}: ${res.blocked[0].reason}`);
          setBusy(false);
          return;
        }
        await onCancelled(`${res.cancelledCount} título(s) cancelado(s).`);
      }
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erro ao cancelar título(s).');
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 dark:bg-slate-950/80" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden text-xs dark:border-slate-700 dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between bg-red-50/70 dark:border-slate-700 dark:bg-red-950/50">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-red-700 dark:text-red-300" />
            <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
              {isInvoiceGroup ? 'Cancelar Grupo de Faturas' : `Confirmar Cancelamento (${titles.length})`}
            </h3>
          </div>
          <button type="button" onClick={onClose}>
            <X className="w-4 h-4 text-slate-400 dark:text-slate-400" />
          </button>
        </div>

        <div className="p-5 space-y-3">
          {err && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-800 dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300">{err}</div>}
          {isInvoiceGroup ? (
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-blue-950 leading-relaxed dark:border-blue-800/70 dark:bg-blue-950/50 dark:text-blue-300">
              Esta operação cancelará as faturas deste grupo e <strong>reabrirá automaticamente os títulos de origem</strong> para o status ABERTO com saldo restaurado.
            </div>
          ) : (
            <p className="text-slate-600 leading-relaxed dark:text-slate-300">
              Os títulos abaixo terão o status alterado para <strong>CANCELADO</strong> e saldo zerado. Caso necessite voltar atrás depois, utilize a opção <em>Reabrir Título</em>.
            </p>
          )}

          {impact && (impact.collectionNotesCount > 0 || impact.negotiationsCount > 0 || impact.legalProcessesCount > 0) && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900 space-y-1 dark:border-amber-800/70 dark:bg-amber-950/50 dark:text-amber-300">
              <div className="font-bold">Impacto detectado na operação:</div>
              <div>
                Cobrança: {impact.collectionNotesCount} · Negociações ativas: {impact.negotiationsCount} · Processos Jurídicos: {impact.legalProcessesCount}
              </div>
            </div>
          )}

          <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-44 overflow-y-auto dark:border-slate-700 dark:divide-slate-800">
            {titles.map((t) => (
              <div key={t.id} className="px-3 py-2 flex items-center justify-between">
                <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                  {t.documentNumber || t.titleCode} · {t.clientName || '—'}
                </span>
                <span className="font-mono font-bold tabular-nums">{formatBRL(t.amountCents)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex justify-end gap-2 dark:border-slate-700 dark:bg-slate-800/70">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 bg-white px-4 py-2 font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
            Voltar
          </button>
          <button type="button" disabled={busy} onClick={handleConfirm} className="rounded-lg bg-red-600 px-4 py-2 font-semibold text-white hover:bg-red-700">
            {busy ? 'Cancelando...' : 'Confirmar Cancelamento'}
          </button>
        </div>
      </div>
    </div>
  );
};

interface DeleteTitleConfirmModalProps {
  target: FinancialTitle | null;
  onClose: () => void;
  onDeleted: (msg: string) => Promise<void>;
}

export const DeleteTitleConfirmModal: React.FC<DeleteTitleConfirmModalProps> = ({ target, onClose, onDeleted }) => {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    setErr('');
  }, [target?.id]);

  if (!target) return null;

  const handleDelete = async () => {
    setBusy(true);
    setErr('');
    try {
      await apiFetch(`/api/financial-titles/${target.id}`, { method: 'DELETE' });
      await onDeleted(`Título ${target.documentNumber || target.titleCode} excluído definitivamente.`);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erro ao excluir título.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 dark:bg-slate-950/80" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden text-xs dark:border-slate-700 dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between bg-red-50 dark:border-slate-700 dark:bg-red-950/50">
          <div className="flex items-center gap-2 text-red-900 dark:text-red-300">
            <Trash2 className="w-4 h-4" />
            <h3 className="font-display text-sm font-bold">Excluir Título Definitivamente</h3>
          </div>
          <button type="button" onClick={onClose}>
            <X className="w-4 h-4 text-slate-400 dark:text-slate-400" />
          </button>
        </div>
        <div className="p-5 space-y-3">
          {err && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-800 dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300">{err}</div>}
          <p className="text-slate-600 dark:text-slate-300">
            Deseja excluir permanentemente o título cancelado <strong>{target.documentNumber || target.titleCode}</strong> ({formatBRL(target.amountCents)})? Esta ação não pode ser desfeita.
          </p>
        </div>
        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex justify-end gap-2 dark:border-slate-700 dark:bg-slate-800/70">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 bg-white px-4 py-2 font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
            Cancelar
          </button>
          <button type="button" disabled={busy} onClick={handleDelete} className="rounded-lg bg-red-600 px-4 py-2 font-semibold text-white hover:bg-red-700">
            {busy ? 'Excluindo...' : 'Excluir Definitivamente'}
          </button>
        </div>
      </div>
    </div>
  );
};

/* ============================================================================
 * 10. ADMISSION VIEWER MODAL (Ficha de Admissão - Contas a Receber)
 * ========================================================================== */
interface AdmissionViewerModalProps {
  admissionId: number | null;
  contractRef: string;
  onClose: () => void;
}

export const AdmissionViewerModal: React.FC<AdmissionViewerModalProps> = ({
  admissionId,
  contractRef,
  onClose,
}) => {
  const [tab, setTab] = useState<'geral' | 'financeiro' | 'docs' | 'juridico'>('geral');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<{
    admission: Admission;
    client: Client | null;
    documents: DocumentObject[];
    recalcScenarios: RecalcScenario[];
    legalProcesses: LegalProcess[];
    legalMovements: LegalMovement[];
  } | null>(null);

  useEffect(() => {
    if (!admissionId) return;
    setTab('geral');
    setLoading(true);
    apiFetch<{
      admission: Admission;
      client: Client | null;
      documents: DocumentObject[];
      recalcScenarios: RecalcScenario[];
      legalProcesses: LegalProcess[];
      legalMovements: LegalMovement[];
    }>(`/api/admissions/${admissionId}`)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [admissionId]);

  if (!admissionId) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 dark:bg-slate-950/80" onClick={onClose}>
      <div
        className="w-full max-w-4xl rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden text-xs max-h-[85vh] flex flex-col dark:border-slate-700 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between bg-slate-50 dark:border-slate-700 dark:bg-slate-800/70">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-blue-700 dark:text-blue-300" />
            <div>
              <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                Ficha de Admissão & Contrato · Ref. {contractRef}
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">Consulta de origem operacional e dossiê documental</p>
            </div>
          </div>
          <button type="button" onClick={onClose}>
            <X className="w-4 h-4 text-slate-400 dark:text-slate-400" />
          </button>
        </div>

        <div className="px-5 pt-2 border-b border-slate-200 flex items-center gap-2 overflow-x-auto dark:border-slate-700">
          {[
            { id: 'geral' as const, label: 'Dados Gerais & Veículo' },
            { id: 'financeiro' as const, label: 'Financeiro & Cenários' },
            { id: 'docs' as const, label: `Documentos & Anexos (${data?.documents.length || 0})` },
            { id: 'juridico' as const, label: `Auditoria Jurídica (${data?.legalProcesses.length || 0})` },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`px-3 py-2 font-semibold border-b-2 whitespace-nowrap ${
                tab === t.id ? 'border-slate-900 text-slate-900 dark:border-emerald-500 dark:text-slate-100' : 'border-transparent text-slate-500 dark:text-slate-400'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="p-5 overflow-y-auto flex-1">
          {loading ? (
            <div className="py-12 text-center text-slate-500 dark:text-slate-400">Carregando ficha completa...</div>
          ) : !data ? (
            <div className="py-12 text-center text-slate-500 dark:text-slate-400">Ficha de admissão não localizada.</div>
          ) : tab === 'geral' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                <div className="text-[10px] text-slate-500 dark:text-slate-400">Protocolo</div>
                <div className="font-mono font-bold text-slate-900 dark:text-slate-100">{data.admission.protocolCode}</div>
              </div>
              <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                <div className="text-[10px] text-slate-500 dark:text-slate-400">Cliente</div>
                <div className="font-bold text-slate-900 dark:text-slate-100">{data.client?.fullName || '—'}</div>
                <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400">{data.client?.cpfCnpj || ''}</div>
              </div>
              <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                <div className="text-[10px] text-slate-500 dark:text-slate-400">Banco / Modalidade</div>
                <div className="font-bold text-slate-900 dark:text-slate-100">{data.admission.bankName}</div>
                <div className="text-slate-600 dark:text-slate-300">{data.admission.modality || data.admission.debtType}</div>
              </div>
              <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                <div className="text-[10px] text-slate-500 dark:text-slate-400">Veículo</div>
                <div className="font-semibold text-slate-900 dark:text-slate-100">{data.admission.vehicleModel || 'Não informado'}</div>
                <div className="font-mono text-slate-500 dark:text-slate-400">Placa: {data.admission.vehiclePlate || '—'}</div>
              </div>
              <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                <div className="text-[10px] text-slate-500 dark:text-slate-400">Status Auditoria</div>
                <div className="font-bold text-blue-700 uppercase dark:text-blue-300">{data.admission.status}</div>
              </div>
              <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                <div className="text-[10px] text-slate-500 dark:text-slate-400">Consultor</div>
                <div className="font-semibold text-slate-900 dark:text-slate-100">{data.admission.consultantName || '—'}</div>
              </div>
            </div>
          ) : tab === 'financeiro' ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                  <div className="text-[10px] text-slate-500 dark:text-slate-400">Dívida Declarada</div>
                  <div className="font-mono font-bold text-slate-900 tabular-nums dark:text-slate-100">{formatBRL(data.admission.debtAmountCents)}</div>
                </div>
                <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                  <div className="text-[10px] text-slate-500 dark:text-slate-400">Taxa de Serviço</div>
                  <div className="font-mono font-bold text-emerald-700 tabular-nums dark:text-emerald-300">{formatBRL(data.admission.serviceFeeCents)}</div>
                </div>
                <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                  <div className="text-[10px] text-slate-500 dark:text-slate-400">Parcelas</div>
                  <div className="font-mono font-bold text-slate-900 dark:text-slate-100">{data.admission.installmentsCount}x</div>
                </div>
                <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                  <div className="text-[10px] text-slate-500 dark:text-slate-400">Taxa Inicial</div>
                  <div className="font-mono font-bold text-slate-900 tabular-nums dark:text-slate-100">{formatBRL(data.admission.initialInstallmentCents)}</div>
                </div>
              </div>

              {data.recalcScenarios.length > 0 && (
                <div className="border border-slate-200 rounded-xl overflow-hidden dark:border-slate-700">
                  <div className="px-3 py-2 bg-slate-50 font-semibold border-b border-slate-200 dark:bg-slate-800/70 dark:border-slate-700">Cenários de Recálculo</div>
                  <table className="w-full text-left text-[11px]">
                    <thead className="text-slate-500 border-b border-slate-100 dark:text-slate-400 dark:border-slate-800">
                      <tr>
                        <th className="px-3 py-1.5">Taxa Contrato</th>
                        <th className="px-3 py-1.5">Média BACEN</th>
                        <th className="px-3 py-1.5 text-right">Parcela Original</th>
                        <th className="px-3 py-1.5 text-right">Parcela Justa</th>
                        <th className="px-3 py-1.5 text-right">Economia Projetada</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {data.recalcScenarios.map((sc) => (
                        <tr key={sc.id}>
                          <td className="px-3 py-2 font-mono">{sc.contractRateMonthlyPct}% a.m.</td>
                          <td className="px-3 py-2 font-mono">{sc.bacenAvgRateMonthlyPct}% a.m.</td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums">{formatBRL(sc.originalInstallmentCents)}</td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums">{formatBRL(sc.fairInstallmentCents)}</td>
                          <td className="px-3 py-2 text-right font-mono font-bold text-emerald-700 tabular-nums dark:text-emerald-300">{formatBRL(sc.projectedSavingsCents)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : tab === 'docs' ? (
            <div className="border border-slate-200 rounded-xl overflow-hidden dark:border-slate-700">
              {data.documents.length === 0 ? (
                <div className="py-8 text-center text-slate-500 dark:text-slate-400">Nenhum anexo localizado no dossiê.</div>
              ) : (
                <table className="w-full text-left text-[11px]">
                  <thead className="bg-slate-50 text-slate-500 border-b border-slate-200 dark:bg-slate-800/70 dark:text-slate-400 dark:border-slate-700">
                    <tr>
                      <th className="px-3 py-2">Arquivo</th>
                      <th className="px-3 py-2">Categoria</th>
                      <th className="px-3 py-2">Pasta</th>
                      <th className="px-3 py-2 text-right">Acesso</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {data.documents.map((doc) => (
                      <tr key={doc.id}>
                        <td className="px-3 py-2 font-semibold">{doc.fileName}</td>
                        <td className="px-3 py-2">{doc.docCategory}</td>
                        <td className="px-3 py-2 font-mono text-slate-500 dark:text-slate-400">{doc.folderPath}</td>
                        <td className="px-3 py-2 text-right">
                          {doc.storageUri ? (
                            <a
                              href={doc.storageUri}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-blue-700 font-semibold hover:underline dark:text-blue-300"
                            >
                              <ExternalLink className="w-3 h-3" />
                              Abrir
                            </a>
                          ) : (
                            '—'
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {data.legalProcesses.length === 0 ? (
                <div className="py-8 text-center text-slate-500 dark:text-slate-400">Nenhum processo judicial vinculado a esta admissão.</div>
              ) : (
                data.legalProcesses.map((proc) => (
                  <div key={proc.id} className="rounded-xl border border-slate-200 p-3 space-y-2 dark:border-slate-700">
                    <div className="flex items-center justify-between font-bold text-slate-900 dark:text-slate-100">
                      <span className="flex items-center gap-1.5 font-mono">
                        <Scale className="w-3.5 h-3.5 text-blue-700 dark:text-blue-300" />
                        {proc.processNumber} · {proc.courtName}
                      </span>
                      <span className="text-[11px] uppercase text-blue-700 dark:text-blue-300">{proc.status}</span>
                    </div>
                    <div className="text-slate-600 dark:text-slate-300">
                      {proc.actionType}
                      {proc.lastMovementAt ? ` · Última movimentação em ${formatIsoDateToBR(proc.lastMovementAt)}` : ''}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

/* ============================================================================
 * 11. TITLE AUDIT MODAL (500 eventos, 15 por página)
 * ========================================================================== */
interface TitleAuditModalProps {
  target: FinancialTitle | null;
  scope: 'RECEBER' | 'PAGAR';
  onClose: () => void;
}

interface AuditLogRow {
  id: number;
  userName: string;
  action: string;
  createdAt: string;
  changes?: Array<{
    field?: string;
    label?: string;
    previousLabel?: string;
    newLabel?: string;
    from?: string;
    to?: string;
    previousValue?: string;
    newValue?: string;
  }>;
  details?: {
    changes?: Array<{
      field?: string;
      label?: string;
      previousLabel?: string;
      newLabel?: string;
      from?: string;
      to?: string;
      previousValue?: string;
      newValue?: string;
    }>;
  };
}

export const TitleAuditModal: React.FC<TitleAuditModalProps> = ({ target, scope, onClose }) => {
  const [logs, setLogs] = useState<AuditLogRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);

  useEffect(() => {
    if (!target) return;
    setPage(1);
    setLoading(true);
    const eType = scope === 'PAGAR' ? 'CONTA_PAGAR' : 'CONTA_RECEBER';
    apiFetch<{ logs: AuditLogRow[] }>(`/api/audit-logs?entityType=${eType}&entityId=${target.id}`)
      .then((res) => setLogs(res.logs || []))
      .catch(() => setLogs([]))
      .finally(() => setLoading(false));
  }, [target?.id, scope]);

  if (!target) return null;

  const flatRows = logs.flatMap((l) => {
    const list = l.changes && l.changes.length > 0 ? l.changes : l.details?.changes || [];
    const isInsert = String(l.action || '').toUpperCase().includes('INSERT') || String(l.action || '').toUpperCase().includes('CREATE');
    const isDelete = String(l.action || '').toUpperCase().includes('DELETE');
    if (list.length === 0) {
      return [
        {
          key: `${l.id}-0`,
          userName: l.userName || 'Sistema',
          createdAt: l.createdAt,
          action: l.action,
          newLabel: 'Evento Operacional',
          newValue: l.action,
          previousLabel: isInsert ? '— (Novo registro)' : 'Evento Operacional',
          previousValue: '—',
        },
      ];
    }
    return list.map((c, idx) => {
      const lbl = c.label || c.field || 'Campo';
      const prevV = String(c.previousValue ?? c.from ?? '—');
      const nextV = String(c.newValue ?? c.to ?? '—');
      return {
        key: `${l.id}-${idx}`,
        userName: l.userName || 'Sistema',
        createdAt: l.createdAt,
        action: l.action,
        newLabel: c.newLabel || (isDelete ? '— (Removido)' : lbl),
        newValue: nextV,
        previousLabel: c.previousLabel || (isInsert ? '— (Novo registro)' : lbl),
        previousValue: prevV,
      };
    });
  });

  const pageSize = 20;
  const totalPages = Math.max(1, Math.ceil(flatRows.length / pageSize));
  const slice = flatRows.slice((page - 1) * pageSize, page * pageSize);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 dark:bg-slate-950/80" onClick={onClose}>
      <div
        className="w-full max-w-6xl rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden text-xs max-h-[88vh] flex flex-col dark:border-slate-700 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between bg-slate-50 dark:border-slate-700 dark:bg-slate-800/70">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-slate-700 dark:text-slate-200" />
            <div>
              <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                Auditoria Acumulativa do Título · {target.documentNumber || target.titleCode}
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Trilha acumulativa de Usuário, Data/Horário, Campo Alterado (Label), Conteúdo da Alteração, Campo Anterior (Label) e Valor Campo Anterior ({logs.length} eventos · {flatRows.length} registros)
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose}>
            <X className="w-4 h-4 text-slate-400 dark:text-slate-400" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto flex-1">
          {loading ? (
            <div className="py-10 text-center text-slate-500 dark:text-slate-400">Carregando trilha de auditoria...</div>
          ) : flatRows.length === 0 ? (
            <div className="py-10 text-center text-slate-500 dark:text-slate-400">Nenhum evento de auditoria registrado para este título.</div>
          ) : (
            <div className="border border-slate-200 rounded-xl overflow-x-auto dark:border-slate-700">
              <table className="w-full text-left text-[11px]">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 dark:bg-slate-800/70 dark:text-slate-300 dark:border-slate-700">
                  <tr>
                    <th className="px-3 py-2 whitespace-nowrap">Usuário</th>
                    <th className="px-3 py-2 whitespace-nowrap">Data e Horário</th>
                    <th className="px-3 py-2 whitespace-nowrap">Campo Alterado (Label)</th>
                    <th className="px-3 py-2">Conteúdo da Alteração</th>
                    <th className="px-3 py-2 whitespace-nowrap">Campo Anterior (Label)</th>
                    <th className="px-3 py-2">Valor Campo Anterior</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {slice.map((row) => (
                    <tr key={row.key} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/60">
                      <td className="px-3 py-2 align-top">
                        <div className="font-semibold text-slate-800 dark:text-slate-100">{row.userName}</div>
                        <div className="font-mono text-[10px] text-slate-500 dark:text-slate-400">{row.action}</div>
                      </td>
                      <td className="px-3 py-2 font-mono tabular-nums whitespace-nowrap text-slate-600 align-top dark:text-slate-300">
                        {new Date(row.createdAt).toLocaleString('pt-BR')}
                      </td>
                      <td className="px-3 py-2 font-semibold text-slate-900 align-top dark:text-slate-100">{row.newLabel}</td>
                      <td className="px-3 py-2 font-mono font-semibold text-emerald-800 bg-emerald-50/40 max-w-[220px] break-words align-top dark:bg-emerald-950/20 dark:text-emerald-300">
                        {row.newValue}
                      </td>
                      <td className="px-3 py-2 font-medium text-slate-700 align-top dark:text-slate-300">{row.previousLabel}</td>
                      <td className="px-3 py-2 font-mono text-red-700 bg-red-50/40 max-w-[220px] break-words align-top dark:bg-red-950/20 dark:text-red-300">
                        {row.previousValue}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {totalPages > 1 && (
          <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between dark:border-slate-700 dark:bg-slate-800/70">
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              Página {page} de {totalPages}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="rounded border border-slate-200 bg-white px-3 py-1 font-semibold disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900"
              >
                Anterior
              </button>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="rounded border border-slate-200 bg-white px-3 py-1 font-semibold disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900"
              >
                Próxima
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
