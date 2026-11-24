import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  MessageSquare,
  Paperclip,
  Phone,
  Send,
  X,
} from 'lucide-react';
import {
  apiFetch,
  formatBRL,
  formatDateBR,
  getActiveUnitHeader,
  getAuthToken,
  parseJsonResponse,
} from '../../../lib/api.ts';
import { buildSantanderBoletoPdfFile } from '../../../lib/santanderBoletoPdf.ts';
import {
  BankAccount,
  Client,
  FinancialTitle,
  GotalkChannelPublic,
  UazapiInstancePublic,
  Unit,
  WhatsappThread,
} from '../../../types.ts';

interface PaymentDataResponse {
  title: FinancialTitle;
  client: Client | null;
  unit: Unit | null;
  account: BankAccount | null;
  qrCodeDataUrl: string;
}

interface WhatsappThreadsPayload {
  instances: UazapiInstancePublic[];
  channels: GotalkChannelPublic[];
}

export interface SendBoletoWhatsappModalProps {
  titleId: number | null;
  onClose: () => void;
  onSent?: (msg: string) => Promise<void> | void;
}

export const SendBoletoWhatsappModal: React.FC<SendBoletoWhatsappModalProps> = ({
  titleId,
  onClose,
  onSent,
}) => {
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const [paymentData, setPaymentData] = useState<PaymentDataResponse | null>(null);
  const [channels, setChannels] = useState<GotalkChannelPublic[]>([]);
  const [instances, setInstances] = useState<UazapiInstancePublic[]>([]);

  const [provider, setProvider] = useState<'gotalk' | 'uazapi'>('gotalk');
  const [selectedChannelId, setSelectedChannelId] = useState<string>('');
  const [selectedInstanceId, setSelectedInstanceId] = useState<string>('');
  const [phone, setPhone] = useState('');
  const [attachPdf, setAttachPdf] = useState(true);
  const [messageText, setMessageText] = useState('');

  useEffect(() => {
    if (!titleId) {
      setPaymentData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setErr('');
    setSuccessMsg('');

    Promise.all([
      apiFetch<PaymentDataResponse>(`/api/santander/titles/${titleId}/payment-data`),
      apiFetch<WhatsappThreadsPayload>('/api/whatsapp/threads', { passive: true }).catch(
        () => ({ instances: [], channels: [] }) as WhatsappThreadsPayload
      ),
    ])
      .then(([pData, waData]) => {
        if (cancelled) return;
        setPaymentData(pData);
        const activeChs = (waData.channels || []).filter((c) => c.isActive !== false);
        const activeInsts = (waData.instances || []).filter((i) => i.active !== false);
        setChannels(activeChs);
        setInstances(activeInsts);

        const defaultCh = activeChs.find((c) => c.isPrimary) || activeChs[0];
        const defaultInst = activeInsts.find((i) => i.isConnected) || activeInsts[0];
        setSelectedChannelId(defaultCh ? String(defaultCh.id) : '');
        setSelectedInstanceId(defaultInst ? defaultInst.uazapiInstanceId : '');

        if (activeChs.length === 0 && activeInsts.length > 0) {
          setProvider('uazapi');
        } else {
          setProvider('gotalk');
        }

        const t = pData.title;
        const cl = pData.client;
        const contactPhone = cl?.whatsapp || cl?.phone || '';
        setPhone(contactPhone);

        const bal = (t.currentBalanceCents ?? 0) > 0 ? (t.currentBalanceCents ?? 0) : t.amountCents;
        const lines: string[] = [
          `Olá, *${cl?.fullName || t.clientName || 'Cliente'}*!`,
          '',
          `Segue o boleto bancário referente ao documento *${t.documentNumber || t.titleCode}*:`,
          `• Vencimento: *${formatDateBR(t.dueDate)}*`,
          `• Valor: *${formatBRL(bal)}*`,
        ];
        if (t.digitableLine || t.barcode) {
          lines.push('', `*Linha Digitável:*`, `${t.digitableLine || t.barcode}`);
        }
        if (t.pixCopiaECola) {
          lines.push('', `*PIX Copia e Cola:*`, `${t.pixCopiaECola}`);
        }
        lines.push('', 'Em caso de dúvidas, estamos à disposição.');
        setMessageText(lines.join('\n'));
      })
      .catch((e) => {
        if (cancelled) return;
        setErr(e instanceof Error ? e.message : 'Erro ao carregar dados para envio do boleto.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [titleId]);

  if (!titleId) return null;

  const title = paymentData?.title || null;
  const client = paymentData?.client || null;
  const hasBoletoPdf = Boolean(
    title && (title.digitableLine || title.barcode || title.pixCopiaECola)
  );

  const handleSend = async () => {
    setErr('');
    setSuccessMsg('');
    const cleanDigits = phone.replace(/\D/g, '');
    if (cleanDigits.length < 8) {
      setErr('Informe um telefone/WhatsApp válido com DDD (mínimo 8 dígitos).');
      return;
    }
    if (!messageText.trim()) {
      setErr('Informe o texto da mensagem para envio.');
      return;
    }
    if (!title) return;

    setSending(true);
    try {
      const threadRes = await apiFetch<{ thread: WhatsappThread }>('/api/whatsapp/threads', {
        method: 'POST',
        body: JSON.stringify({
          contactPhone: cleanDigits,
          contactName: client?.fullName || title.clientName || cleanDigits,
          provider,
          unitId: title.unitId,
          clientId: title.clientId,
          channelDbId: provider === 'gotalk' && selectedChannelId ? Number(selectedChannelId) : null,
          uazapiInstanceId: provider === 'uazapi' && selectedInstanceId ? selectedInstanceId : null,
        }),
      });
      const thread = threadRes.thread;

      const msgRes = await apiFetch<{
        delivery?: { dispatched?: boolean; detail?: string };
      }>(`/api/whatsapp/threads/${thread.id}/messages`, {
        method: 'POST',
        body: JSON.stringify({
          body: messageText.trim(),
          contentType: 'text',
          direction: 'outbound',
        }),
      });

      let fileNotice = '';
      if (attachPdf && hasBoletoPdf) {
        const pdfFile = buildSantanderBoletoPdfFile({
          title,
          client,
          unit: paymentData?.unit,
          account: paymentData?.account,
          qrCodeDataUrl: paymentData?.qrCodeDataUrl,
        });
        const form = new FormData();
        form.append('file', pdfFile);
        form.append(
          'caption',
          `Boleto ${title.documentNumber || title.titleCode} · Venc. ${formatDateBR(title.dueDate)}`
        );
        const token = getAuthToken();
        const fileResp = await fetch(`/api/whatsapp/threads/${thread.id}/send-file`, {
          method: 'POST',
          headers: {
            'x-unit-id': String(getActiveUnitHeader()),
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: form,
        });
        const fileJson = await parseJsonResponse<{
          delivery?: { dispatched?: boolean; detail?: string };
        }>(fileResp, 'Falha ao enviar anexo PDF do boleto.');
        fileNotice = fileJson.delivery?.dispatched
          ? ' com PDF anexado'
          : ' (PDF registrado na fila)';
      }

      const channelLabel = provider === 'gotalk' ? 'GoTalk' : 'UaZapi';
      const feedback =
        msgRes.delivery?.dispatched === false
          ? `Boleto registrado para envio via ${channelLabel}${fileNotice}: ${
              msgRes.delivery?.detail || 'Verifique a conexão do canal nas configurações.'
            }`
          : `Boleto ${title.documentNumber || title.titleCode} enviado via ${channelLabel}${fileNotice} para ${phone}.`;

      setSuccessMsg(feedback);
      await onSent?.(feedback);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erro ao enviar boleto pelo canal selecionado.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/60 p-4 dark:bg-slate-950/85"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden text-xs dark:border-slate-700 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between bg-slate-50 dark:border-slate-700 dark:bg-slate-800/70">
          <div className="flex items-center gap-2.5">
            <MessageSquare className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            <div>
              <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                Enviar Boleto via GoTalk ou UaZapi
              </h3>
              {title && (
                <p className="text-[11px] text-slate-500 font-mono dark:text-slate-400">
                  {title.documentNumber || title.titleCode} · {client?.fullName || title.clientName}
                </p>
              )}
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
          {loading ? (
            <div className="py-10 flex items-center justify-center gap-2 text-slate-500 dark:text-slate-400">
              <Loader2 className="w-4 h-4 animate-spin" />
              Carregando canais GoTalk / UaZapi e dados do boleto...
            </div>
          ) : (
            <>
              {err && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-800 flex items-start gap-2 dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{err}</span>
                </div>
              )}

              {successMsg && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-800 flex items-start gap-2 dark:border-emerald-800/70 dark:bg-emerald-950/50 dark:text-emerald-300">
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{successMsg}</span>
                </div>
              )}

              {/* Seletor de Canal: GoTalk vs UaZapi */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1 dark:text-slate-300">
                    Canal de Disparo
                  </label>
                  <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-800">
                    <button
                      type="button"
                      onClick={() => setProvider('gotalk')}
                      className={`py-1.5 rounded-md font-semibold transition-colors ${
                        provider === 'gotalk'
                          ? 'bg-white text-emerald-700 shadow-xs dark:bg-slate-900 dark:text-emerald-300'
                          : 'text-slate-600 hover:text-slate-900 dark:text-slate-300'
                      }`}
                    >
                      GoTalk
                    </button>
                    <button
                      type="button"
                      onClick={() => setProvider('uazapi')}
                      className={`py-1.5 rounded-md font-semibold transition-colors ${
                        provider === 'uazapi'
                          ? 'bg-white text-blue-700 shadow-xs dark:bg-slate-900 dark:text-blue-300'
                          : 'text-slate-600 hover:text-slate-900 dark:text-slate-300'
                      }`}
                    >
                      UaZapi
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1 dark:text-slate-300">
                    {provider === 'gotalk' ? 'Canal GoTalk' : 'Instância UaZapi'}
                  </label>
                  {provider === 'gotalk' ? (
                    <select
                      value={selectedChannelId}
                      onChange={(e) => setSelectedChannelId(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
                    >
                      <option value="">Canal Padrão / Principal</option>
                      {channels.map((ch) => (
                        <option key={ch.id} value={String(ch.id)}>
                          {ch.name} {ch.phoneNumber ? `(${ch.phoneNumber})` : ''}
                          {ch.isPrimary ? ' · Principal' : ''}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <select
                      value={selectedInstanceId}
                      onChange={(e) => setSelectedInstanceId(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
                    >
                      <option value="">Instância Padrão da Unidade</option>
                      {instances.map((inst) => (
                        <option key={inst.id} value={inst.uazapiInstanceId}>
                          {inst.label || inst.profileName || inst.uazapiInstanceId}
                          {inst.connectedPhone ? ` (${inst.connectedPhone})` : ''}
                          {inst.isConnected ? ' · Online' : ' · Offline'}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </div>

              {/* Telefone do Destinatário */}
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1 dark:text-slate-300">
                  Telefone / WhatsApp do Destinatário *
                </label>
                <div className="relative">
                  <Phone className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="(81) 99999-9999"
                    className="w-full rounded-lg border border-slate-300 bg-white pl-8 pr-3 py-2 font-mono text-xs dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
              </div>

              {/* Anexar PDF */}
              <label className="inline-flex items-center gap-2 cursor-pointer text-slate-700 dark:text-slate-200">
                <input
                  type="checkbox"
                  checked={attachPdf && hasBoletoPdf}
                  disabled={!hasBoletoPdf}
                  onChange={(e) => setAttachPdf(e.target.checked)}
                />
                <Paperclip className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
                <span>
                  Anexar arquivo PDF do Boleto Santander (com código de barras e QR Code PIX)
                </span>
              </label>

              {/* Mensagem editável */}
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1 dark:text-slate-300">
                  Mensagem com Dados do Boleto / PIX
                </label>
                <textarea
                  rows={8}
                  value={messageText}
                  onChange={(e) => setMessageText(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-slate-50 p-3 font-mono text-[11px] text-slate-900 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2 dark:border-slate-700 dark:bg-slate-800/70">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Fechar
          </button>
          <button
            type="button"
            disabled={loading || sending}
            onClick={handleSend}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            {sending
              ? 'Enviando...'
              : `Enviar via ${provider === 'gotalk' ? 'GoTalk' : 'UaZapi'}`}
          </button>
        </div>
      </div>
    </div>
  );
};
