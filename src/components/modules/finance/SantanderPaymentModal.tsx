import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Barcode,
  Check,
  CheckCircle2,
  Copy,
  Download,
  Landmark,
  Loader2,
  MessageSquare,
  QrCode,
  RefreshCw,
  Send,
  X,
} from 'lucide-react';
import { apiFetch, formatBRL, formatDateBR, formatDateTimeBR } from '../../../lib/api.ts';
import { downloadSantanderBoletoPdf } from '../../../lib/santanderBoletoPdf.ts';
import { BankAccount, Client, FinancialTitle, SantanderEmissionLog, Unit } from '../../../types.ts';
import { SendBoletoWhatsappModal } from './SendBoletoWhatsappModal.tsx';

interface SantanderPaymentModalProps {
  titleId: number | null;
  onClose: () => void;
  onUpdated?: () => Promise<void> | void;
}

interface PaymentDataResponse {
  title: FinancialTitle;
  client: Client | null;
  unit: Unit | null;
  account: BankAccount | null;
  availableAccounts: BankAccount[];
  qrCodeDataUrl: string;
  logs: SantanderEmissionLog[];
}

export const SantanderPaymentModal: React.FC<SantanderPaymentModalProps> = ({
  titleId,
  onClose,
  onUpdated,
}) => {
  const [loading, setLoading] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const [data, setData] = useState<PaymentDataResponse | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState<number | ''>('');
  const [includePixInBoleto, setIncludePixInBoleto] = useState(true);
  const [pixChargeType, setPixChargeType] = useState<'cobv' | 'cob'>('cobv');
  const [instructionOp, setInstructionOp] = useState<
    'BAIXAR' | 'ALTERAR_VENCIMENTO' | 'PROTESTAR' | 'SUSTAR_PROTESTO'
  >('ALTERAR_VENCIMENTO');
  const [newDueDate, setNewDueDate] = useState('');
  const [copiedField, setCopiedField] = useState<'linha' | 'pix' | 'barcode' | null>(null);
  const [sendWhatsappOpen, setSendWhatsappOpen] = useState(false);

  const loadPaymentData = useCallback(async () => {
    if (!titleId) return;
    setLoading(true);
    setErrorMsg('');
    try {
      const res = await apiFetch<PaymentDataResponse>(`/api/santander/titles/${titleId}/payment-data`);
      setData(res);
      const preferredId = res.title.bankAccountId || res.account?.id || res.availableAccounts[0]?.id || '';
      setSelectedAccountId(preferredId);
      if (res.title.dueDate) {
        setNewDueDate(new Date(res.title.dueDate).toISOString().slice(0, 10));
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao carregar dados do título.');
    } finally {
      setLoading(false);
    }
  }, [titleId]);

  useEffect(() => {
    if (titleId) {
      setSuccessMsg('');
      setErrorMsg('');
      void loadPaymentData();
    } else {
      setData(null);
    }
  }, [titleId, loadPaymentData]);

  if (!titleId) return null;

  const title = data?.title || null;
  const client = data?.client || null;
  const unit = data?.unit || null;
  const accounts = data?.availableAccounts || [];
  const activeAccount =
    accounts.find((a) => a.id === Number(selectedAccountId)) || data?.account || null;

  const handleCopy = async (text: string, field: 'linha' | 'pix' | 'barcode') => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    } catch {
      setErrorMsg('Não foi possível copiar automaticamente.');
    }
  };

  const handleEmitBoleto = async () => {
    if (!title) return;
    setBusyAction('boleto');
    setErrorMsg('');
    setSuccessMsg('');
    try {
      const res = await apiFetch<{
        digitableLine: string;
        ourNumber: string;
        executionMode: string;
        qrCodePix?: string;
      }>(`/api/santander/titles/${title.id}/emit-boleto`, {
        method: 'POST',
        body: JSON.stringify({
          bankAccountId: selectedAccountId ? Number(selectedAccountId) : undefined,
          includePixQr: includePixInBoleto,
        }),
      });
      setSuccessMsg(
        `Boleto Santander registrado (${res.executionMode === 'live_mtls' ? 'API mTLS' : 'Homologação FEBRABAN 033'}) · Nosso Nº ${res.ourNumber}.`
      );
      await loadPaymentData();
      await onUpdated?.();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao emitir boleto Santander.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleEmitPix = async () => {
    if (!title) return;
    setBusyAction('pix');
    setErrorMsg('');
    setSuccessMsg('');
    try {
      const res = await apiFetch<{
        txid: string;
        chargeType: string;
        executionMode: string;
      }>(`/api/santander/titles/${title.id}/emit-pix`, {
        method: 'POST',
        body: JSON.stringify({
          bankAccountId: selectedAccountId ? Number(selectedAccountId) : undefined,
          chargeType: pixChargeType,
        }),
      });
      setSuccessMsg(
        `Cobrança PIX (${res.chargeType.toUpperCase()}) emitida (${res.executionMode === 'live_mtls' ? 'API mTLS' : 'Homologação BR Code EMV'}) · txid ${res.txid}.`
      );
      await loadPaymentData();
      await onUpdated?.();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao gerar cobrança PIX.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleConsult = async () => {
    if (!title) return;
    setBusyAction('consult');
    setErrorMsg('');
    setSuccessMsg('');
    try {
      await apiFetch(`/api/santander/titles/${title.id}/consult`, {
        method: 'POST',
      });
      setSuccessMsg('Situação consultada e sincronizada com a configuração Santander.');
      await loadPaymentData();
      await onUpdated?.();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao consultar situação no Santander.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleSendInstruction = async () => {
    if (!title) return;
    setBusyAction('instruction');
    setErrorMsg('');
    setSuccessMsg('');
    try {
      await apiFetch(`/api/santander/titles/${title.id}/instruction`, {
        method: 'POST',
        body: JSON.stringify({
          operation: instructionOp,
          ...(instructionOp === 'ALTERAR_VENCIMENTO' ? { newDueDate } : {}),
        }),
      });
      setSuccessMsg(`Instrução "${instructionOp}" enviada ao Santander com sucesso.`);
      await loadPaymentData();
      await onUpdated?.();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao enviar instrução ao Santander.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleDownloadPdf = () => {
    if (!title) return;
    downloadSantanderBoletoPdf({
      title,
      client,
      unit,
      account: activeAccount,
      qrCodeDataUrl: data?.qrCodeDataUrl,
    });
  };

  return (
    <>
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/55 backdrop-blur-xs p-4 dark:bg-slate-950/80">
        <div className="w-full max-w-3xl max-h-[92vh] flex flex-col rounded-xl border border-slate-200 bg-white shadow-2xl overflow-hidden dark:border-slate-700 dark:bg-slate-900">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 bg-slate-50/80 flex items-start justify-between gap-4 dark:border-slate-800 dark:bg-slate-800/60">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg bg-red-600/10 text-red-700 dark:bg-red-500/15 dark:text-red-400">
              <Landmark className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                Cobrança Bancária Santander · Boleto v2 &amp; PIX QR Code
              </h2>
              {title && (
                <p className="text-xs text-slate-500 mt-0.5 font-mono tabular-nums dark:text-slate-400">
                  {title.documentNumber || title.titleCode} · {client?.fullName || title.clientName} ·{' '}
                  {formatBRL((title.currentBalanceCents ?? 0) > 0 ? (title.currentBalanceCents ?? 0) : title.amountCents)} · Venc.{' '}
                  {formatDateBR(title.dueDate)}
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-200/70 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
          {loading && !data ? (
            <div className="py-12 flex items-center justify-center gap-2 text-slate-500 dark:text-slate-400">
              <Loader2 className="w-4 h-4 animate-spin" />
              Carregando dados de emissão Santander...
            </div>
          ) : (
            <>
              {errorMsg && (
                <div
                  role="alert"
                  className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-red-900 flex items-start gap-2 dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-200"
                >
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-red-600 dark:text-red-400" />
                  <span>{errorMsg}</span>
                </div>
              )}

              {successMsg && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-emerald-900 flex items-start gap-2 dark:border-emerald-800/70 dark:bg-emerald-950/50 dark:text-emerald-200">
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600 dark:text-emerald-400" />
                  <span>{successMsg}</span>
                </div>
              )}

              {/* Account Selector & Emit Actions */}
              <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3.5 space-y-3 dark:border-slate-700 dark:bg-slate-800/50">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">
                      Conta Corrente Santander Associada
                    </label>
                    <select
                      value={selectedAccountId}
                      onChange={(e) => setSelectedAccountId(e.target.value ? Number(e.target.value) : '')}
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    >
                      {accounts.length === 0 ? (
                        <option value="">Nenhuma conta Santander associada</option>
                      ) : (
                        accounts.map((acc) => (
                          <option key={acc.id} value={acc.id}>
                            {acc.bankName} · Ag {acc.agency || '—'} / CC {acc.accountNumber || '—'} ·{' '}
                            {acc.santanderSummary?.executionMode === 'live_mtls' ? 'mTLS Real' : 'Homologação'}
                          </option>
                        ))
                      )}
                    </select>
                  </div>
                  <div className="flex flex-col justify-end gap-1.5">
                    <label className="inline-flex items-center gap-2 cursor-pointer text-slate-700 font-medium dark:text-slate-200">
                      <input
                        type="checkbox"
                        checked={includePixInBoleto}
                        onChange={(e) => setIncludePixInBoleto(e.target.checked)}
                        className="accent-emerald-600"
                      />
                      <span>Boleto SX Híbrido (incluir QR Code PIX ao emitir boleto)</span>
                    </label>
                    <div className="flex items-center gap-2">
                      <span className="text-slate-500 dark:text-slate-400">Modalidade PIX avulso:</span>
                      <select
                        value={pixChargeType}
                        onChange={(e) => setPixChargeType(e.target.value as 'cobv' | 'cob')}
                        className="rounded border border-slate-200 bg-white px-2 py-1 text-[11px] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                      >
                        <option value="cobv">cobv (Com Vencimento)</option>
                        <option value="cob">cob (Imediato)</option>
                      </select>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button
                    type="button"
                    disabled={Boolean(busyAction) || accounts.length === 0}
                    onClick={handleEmitBoleto}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 font-semibold text-white hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0 dark:bg-red-600 dark:hover:bg-red-500"
                  >
                    {busyAction === 'boleto' ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Barcode className="w-3.5 h-3.5" />
                    )}
                    {title?.santanderNsuCode ? 'Reemitir Boleto Santander' : 'Emitir Boleto Santander'}
                  </button>

                  <button
                    type="button"
                    disabled={Boolean(busyAction) || accounts.length === 0}
                    onClick={handleEmitPix}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 whitespace-nowrap shrink-0"
                  >
                    {busyAction === 'pix' ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <QrCode className="w-3.5 h-3.5" />
                    )}
                    Gerar PIX QR Code ({pixChargeType})
                  </button>

                  <button
                    type="button"
                    disabled={Boolean(busyAction) || (!title?.santanderBankSlipId && !title?.pixTxid)}
                    onClick={handleConsult}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-40 whitespace-nowrap shrink-0 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    {busyAction === 'consult' ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="w-3.5 h-3.5" />
                    )}
                    Consultar Status
                  </button>

                  {(title?.digitableLine || title?.barcode || title?.pixCopiaECola) && (
                    <div className="flex items-center gap-2 ml-auto">
                      <button
                        type="button"
                        onClick={() => setSendWhatsappOpen(true)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 font-semibold text-emerald-800 hover:bg-emerald-100 whitespace-nowrap shrink-0 dark:border-emerald-800/70 dark:bg-emerald-950/50 dark:text-emerald-300 dark:hover:bg-emerald-900/60"
                      >
                        <MessageSquare className="w-3.5 h-3.5" />
                        Enviar (GoTalk / UaZapi)
                      </button>
                      <button
                        type="button"
                        onClick={handleDownloadPdf}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 font-semibold text-slate-800 hover:bg-slate-100 whitespace-nowrap shrink-0 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Baixar Boleto PDF
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Boleto & PIX Data Display */}
              {title && (
                <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
                  {/* Left: Boleto Details */}
                  <div className="md:col-span-7 rounded-lg border border-slate-200 p-4 space-y-3 dark:border-slate-700">
                    <div className="flex items-center justify-between border-b border-slate-100 pb-2 dark:border-slate-800">
                      <span className="font-bold text-slate-900 dark:text-slate-100">
                        Dados do Boleto Bancário
                      </span>
                      <span className="font-mono text-[11px] font-bold text-slate-600 dark:text-slate-300">
                        {title.santanderStatus || 'NÃO REGISTRADO'}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2.5 text-[11px]">
                      <div>
                        <div className="text-slate-500 dark:text-slate-400">Nosso Número</div>
                        <div className="font-mono font-bold text-slate-900 tabular-nums dark:text-slate-100">
                          {title.ourNumber || '—'}
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-500 dark:text-slate-400">NSU / Data Santander</div>
                        <div className="font-mono font-semibold text-slate-800 tabular-nums dark:text-slate-200">
                          {title.santanderNsuCode
                            ? `${title.santanderNsuCode} (${title.santanderNsuDate})`
                            : '—'}
                        </div>
                      </div>
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                          Linha Digitável
                        </span>
                        {(title.digitableLine || title.barcode) && (
                          <button
                            type="button"
                            onClick={() => void handleCopy(title.digitableLine || title.barcode, 'linha')}
                            className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-700 hover:underline dark:text-blue-300"
                          >
                            {copiedField === 'linha' ? (
                              <>
                                <Check className="w-3 h-3" /> Copiado
                              </>
                            ) : (
                              <>
                                <Copy className="w-3 h-3" /> Copiar
                              </>
                            )}
                          </button>
                        )}
                      </div>
                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 font-mono text-[11px] break-all select-all text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100">
                        {title.digitableLine || title.barcode || 'Ainda não emitida.'}
                      </div>
                    </div>

                    {title.barcode && title.barcode !== title.digitableLine && (
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                            Código de Barras (44 dígitos)
                          </span>
                          <button
                            type="button"
                            onClick={() => void handleCopy(title.barcode, 'barcode')}
                            className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-700 hover:underline dark:text-blue-300"
                          >
                            {copiedField === 'barcode' ? 'Copiado' : 'Copiar'}
                          </button>
                        </div>
                        <div className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 font-mono text-[11px] break-all select-all text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300">
                          {title.barcode}
                        </div>
                      </div>
                    )}

                    {/* Instructions (PATCH) */}
                    {title.santanderNsuCode && (
                      <div className="pt-2 border-t border-slate-100 space-y-2 dark:border-slate-800">
                        <div className="font-semibold text-slate-700 dark:text-slate-200">
                          Instruções no Boleto (PATCH)
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <select
                            value={instructionOp}
                            onChange={(e) => setInstructionOp(e.target.value as typeof instructionOp)}
                            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                          >
                            <option value="ALTERAR_VENCIMENTO">Alterar Vencimento</option>
                            <option value="BAIXAR">Solicitar Baixa</option>
                            <option value="PROTESTAR">Enviar p/ Protesto</option>
                            <option value="SUSTAR_PROTESTO">Sustar Protesto</option>
                          </select>
                          {instructionOp === 'ALTERAR_VENCIMENTO' && (
                            <input
                              type="date"
                              value={newDueDate}
                              onChange={(e) => setNewDueDate(e.target.value)}
                              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-[11px] dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                            />
                          )}
                          <button
                            type="button"
                            disabled={Boolean(busyAction)}
                            onClick={handleSendInstruction}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-slate-900 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-slate-800 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-700"
                          >
                            <Send className="w-3 h-3" />
                            Enviar
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Right: PIX QR Code */}
                  <div className="md:col-span-5 rounded-lg border border-slate-200 p-4 space-y-3 flex flex-col dark:border-slate-700">
                    <div className="flex items-center justify-between border-b border-slate-100 pb-2 dark:border-slate-800">
                      <span className="font-bold text-slate-900 dark:text-slate-100">PIX QR Code</span>
                      <span className="font-mono text-[11px] font-bold text-emerald-700 dark:text-emerald-300">
                        {title.pixStatus || 'AGUARDANDO'}
                      </span>
                    </div>

                    {data?.qrCodeDataUrl ? (
                      <div className="flex flex-col items-center justify-center bg-white rounded-lg border border-slate-200 p-3">
                        <img
                          src={data.qrCodeDataUrl}
                          alt="QR Code PIX Santander"
                          className="w-40 h-40 object-contain"
                        />
                        {title.pixTxid && (
                          <div className="mt-1 font-mono text-[10px] text-slate-500 truncate max-w-full">
                            txid: {title.pixTxid}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="flex-1 min-h-[140px] rounded-lg border border-dashed border-slate-200 bg-slate-50/70 flex flex-col items-center justify-center text-center p-4 text-slate-500 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-400">
                        <QrCode className="w-7 h-7 mb-1.5 opacity-50" />
                        <span>Clique em "Gerar PIX QR Code" ou emita o Boleto SX Híbrido acima.</span>
                      </div>
                    )}

                    {title.pixCopiaECola && (
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                            PIX Copia e Cola (EMV)
                          </span>
                          <button
                            type="button"
                            onClick={() => void handleCopy(title.pixCopiaECola || '', 'pix')}
                            className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 hover:underline dark:text-emerald-300"
                          >
                            {copiedField === 'pix' ? (
                              <>
                                <Check className="w-3 h-3" /> Copiado
                              </>
                            ) : (
                              <>
                                <Copy className="w-3 h-3" /> Copiar
                              </>
                            )}
                          </button>
                        </div>
                        <textarea
                          readOnly
                          rows={3}
                          value={title.pixCopiaECola}
                          className="w-full rounded-lg border border-slate-200 bg-slate-50 p-2 font-mono text-[10px] text-slate-800 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                        />
                        {title.pixExpiresAt && (
                          <div className="mt-1 text-[10px] font-mono text-slate-500 dark:text-slate-400">
                            Validade PIX: {formatDateTimeBR(title.pixExpiresAt)}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Recent Title Logs */}
              {data && data.logs.length > 0 && (
                <div className="rounded-lg border border-slate-200 p-3 space-y-2 dark:border-slate-700">
                  <div className="font-semibold text-slate-700 dark:text-slate-200">
                    Histórico de Transmissões Santander deste Título ({data.logs.length})
                  </div>
                  <div className="space-y-1 max-h-28 overflow-y-auto text-[11px] font-mono">
                    {data.logs.map((lg) => (
                      <div key={lg.id} className="flex items-center justify-between gap-2 text-slate-600 dark:text-slate-300">
                        <span className="truncate">
                          {formatDateTimeBR(lg.createdAt)} · {lg.operation} ({lg.externalRef || '—'})
                        </span>
                        <span className={lg.ok ? 'text-emerald-700 font-bold dark:text-emerald-300' : 'text-red-700 font-bold dark:text-red-300'}>
                          HTTP {lg.httpStatus ?? (lg.ok ? 200 : 500)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50/70 flex items-center justify-end dark:border-slate-800 dark:bg-slate-800/60">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>

    <SendBoletoWhatsappModal
      titleId={sendWhatsappOpen && title ? title.id : null}
      onClose={() => setSendWhatsappOpen(false)}
      onSent={(msg) => setSuccessMsg(msg)}
    />
    </>
  );
};
