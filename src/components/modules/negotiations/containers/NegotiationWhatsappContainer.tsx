import React, { useMemo, useRef, useState } from 'react';
import {
  Check,
  CheckCheck,
  Download,
  FileText,
  Paperclip,
  RefreshCw,
  Send,
  Sparkles,
  Zap,
} from 'lucide-react';
import { apiFetch, getAuthToken } from '../../../../lib/api.ts';
import type { BankContactItem, Negotiation, NegotiationIviAdvisorPayload } from '../../../../types.ts';
import type { WhatsappDualPayload, WhatsappMessageItem } from '../types.ts';

interface NegotiationWhatsappContainerProps {
  negotiation: Negotiation;
  waData: WhatsappDualPayload | null;
  waLoading: boolean;
  waChannelTarget: 'CLIENTE' | 'BANCO';
  onChannelTargetChange: (target: 'CLIENTE' | 'BANCO') => void;
  waBankContactFilterId: string;
  onBankContactFilterIdChange: (val: string) => void;
  bankContactsList: BankContactItem[];
  iviAdvisor: NegotiationIviAdvisorPayload | null;
  onRunIviAdvisor: () => Promise<void>;
  onRefreshWhatsapp: () => Promise<void>;
  onUpdated: (updated?: Negotiation) => Promise<void>;
  showToast: (msg: string) => void;
}

export const NegotiationWhatsappContainer: React.FC<NegotiationWhatsappContainerProps> = ({
  negotiation,
  waData,
  waLoading,
  waChannelTarget,
  onChannelTargetChange,
  waBankContactFilterId,
  onBankContactFilterIdChange,
  bankContactsList,
  iviAdvisor,
  onRunIviAdvisor,
  onRefreshWhatsapp,
  onUpdated,
  showToast,
}) => {
  const [provider, setProvider] = useState<'gotalk' | 'uazapi'>('gotalk');
  const [uazapiInstanceId, setUazapiInstanceId] = useState<string>('');
  const [gotalkChannelDbId, setGotalkChannelDbId] = useState<string>('');
  const [waDateFilter, setWaDateFilter] = useState<string>('');
  const [waOperatorFilter, setWaOperatorFilter] = useState<string>('');
  const [waMessageInput, setWaMessageInput] = useState<string>('');
  const [waSending, setWaSending] = useState(false);
  const [lastDeliveryInfo, setLastDeliveryInfo] = useState<{
    dispatched: boolean;
    provider: string;
    detail?: string;
  } | null>(null);
  const [showHsmDrawer, setShowHsmDrawer] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const filteredWaMessages = useMemo(() => {
    if (!waData) return [];
    const baseMsgs: WhatsappMessageItem[] =
      waChannelTarget === 'BANCO' ? waData.bankMessages || [] : waData.clientMessages || [];
    return baseMsgs.filter((m) => {
      if (waChannelTarget === 'BANCO' && waBankContactFilterId) {
        if (String(m.bankContactId || '') !== waBankContactFilterId) return false;
      }
      if (waDateFilter) {
        const d = m.createdAt ? new Date(m.createdAt).toISOString().slice(0, 10) : '';
        if (d !== waDateFilter) return false;
      }
      if (waOperatorFilter.trim()) {
        const op = `${m.operatorName || ''} ${m.senderName || ''}`.toLowerCase();
        if (!op.includes(waOperatorFilter.trim().toLowerCase())) return false;
      }
      return true;
    });
  }, [waData, waChannelTarget, waBankContactFilterId, waDateFilter, waOperatorFilter]);

  const activeBankContact = useMemo(() => {
    const list = waData?.bankContacts || bankContactsList;
    if (waBankContactFilterId) {
      return list.find((c) => String(c.id) === waBankContactFilterId) || null;
    }
    if (negotiation.selectedBankContactId) {
      return list.find((c) => c.id === negotiation.selectedBankContactId) || list[0] || null;
    }
    return list[0] || null;
  }, [waData?.bankContacts, bankContactsList, waBankContactFilterId, negotiation.selectedBankContactId]);

  const activeRecipientPhone =
    waChannelTarget === 'BANCO'
      ? activeBankContact?.mobile || activeBankContact?.phone || 'Sem número'
      : waData?.client?.mobile || waData?.client?.phone || 'Sem número';

  const handleSendText = async () => {
    const text = waMessageInput.trim();
    if (!text) return;
    setWaSending(true);
    try {
      const res = await apiFetch<{
        ok: boolean;
        delivery?: { dispatched: boolean; provider: string; detail?: string };
        negotiation?: Negotiation;
      }>(`/api/negotiations/${negotiation.id}/whatsapp/send`, {
        method: 'POST',
        body: JSON.stringify({
          target: waChannelTarget,
          provider,
          uazapiInstanceId: provider === 'uazapi' ? uazapiInstanceId || null : null,
          gotalkChannelDbId: provider === 'gotalk' && gotalkChannelDbId ? Number(gotalkChannelDbId) : null,
          bankContactId: waChannelTarget === 'BANCO' ? activeBankContact?.id || null : null,
          message: text,
          registerContactLog: true,
        }),
      });
      setWaMessageInput('');
      if (res.delivery) setLastDeliveryInfo(res.delivery);
      await onRefreshWhatsapp();
      await onUpdated(res.negotiation);
      showToast(
        res.delivery?.dispatched
          ? `Mensagem entregue via ${provider === 'uazapi' ? 'UaZapi' : 'GoTalk'} e registrada em Contatos.`
          : res.delivery?.detail || 'Mensagem registrada na fila local e vinculada em Contatos.'
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Falha ao enviar mensagem WhatsApp.');
    } finally {
      setWaSending(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setWaSending(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('target', waChannelTarget);
      formData.append('provider', provider);
      if (waChannelTarget === 'BANCO' && activeBankContact?.id) {
        formData.append('bankContactId', String(activeBankContact.id));
      }
      if (waMessageInput.trim()) {
        formData.append('caption', waMessageInput.trim());
      }
      if (provider === 'uazapi' && uazapiInstanceId) {
        formData.append('uazapiInstanceId', uazapiInstanceId);
      }

      const res = await apiFetch<{
        ok: boolean;
        delivery?: { dispatched: boolean; provider: string; detail?: string };
        negotiation?: Negotiation;
      }>(`/api/negotiations/${negotiation.id}/whatsapp/send-file`, {
        method: 'POST',
        body: formData,
      });

      setWaMessageInput('');
      if (res.delivery) setLastDeliveryInfo(res.delivery);
      await onRefreshWhatsapp();
      await onUpdated(res.negotiation);
      showToast(`Arquivo "${file.name}" enviado e arquivado com segurança.`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Falha ao enviar arquivo no WhatsApp.');
    } finally {
      setWaSending(false);
    }
  };

  const handleSendHsm = async (templateId: number, renderedText: string) => {
    setWaSending(true);
    try {
      const res = await apiFetch<{
        ok: boolean;
        delivery?: { dispatched: boolean; provider: string; detail?: string };
        negotiation?: Negotiation;
      }>(`/api/negotiations/${negotiation.id}/whatsapp/send-hsm`, {
        method: 'POST',
        body: JSON.stringify({
          target: waChannelTarget,
          templateId,
          renderedText,
          bankContactId: waChannelTarget === 'BANCO' ? activeBankContact?.id || null : null,
          gotalkChannelDbId: gotalkChannelDbId ? Number(gotalkChannelDbId) : null,
        }),
      });
      setShowHsmDrawer(false);
      if (res.delivery) setLastDeliveryInfo(res.delivery);
      await onRefreshWhatsapp();
      await onUpdated(res.negotiation);
      showToast(res.delivery?.detail || 'Template HSM disparado.');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Falha ao enviar template HSM.');
    } finally {
      setWaSending(false);
    }
  };

  const providersMeta = waData?.providers;
  const isProviderReady =
    provider === 'gotalk' ? Boolean(providersMeta?.gotalkConfigured) : Boolean(providersMeta?.uazapiConfigured);

  const handleOpenAttachment = (url: string) => {
    const token = getAuthToken();
    const targetUrl = token ? `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}` : url;
    const link = document.createElement('a');
    link.href = targetUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.click();
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
      {/* Left 4 cols: Interlocutor, Bank Contact & Integration Engine */}
      <div className="lg:col-span-4 space-y-3">
        <div className="rounded-xl border border-slate-200 bg-white p-3.5 space-y-3">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-600">
            Canais da Negociação
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => onChannelTargetChange('BANCO')}
              className={`rounded-lg border p-2.5 text-left transition-colors ${
                waChannelTarget === 'BANCO'
                  ? 'border-blue-600 bg-blue-50/70'
                  : 'border-slate-200 bg-slate-50 hover:bg-slate-100'
              }`}
            >
              <div className="text-[10px] font-bold uppercase text-blue-700">Contato do Banco</div>
              <div className="text-xs font-semibold text-slate-900 mt-0.5 truncate">{negotiation.bankName}</div>
              <div className="text-[10px] text-slate-500 font-mono tabular-nums mt-0.5">
                {waData?.bankMessages?.length || 0} msg(s)
              </div>
            </button>

            <button
              type="button"
              onClick={() => onChannelTargetChange('CLIENTE')}
              className={`rounded-lg border p-2.5 text-left transition-colors ${
                waChannelTarget === 'CLIENTE'
                  ? 'border-emerald-600 bg-emerald-50/70'
                  : 'border-slate-200 bg-slate-50 hover:bg-slate-100'
              }`}
            >
              <div className="text-[10px] font-bold uppercase text-emerald-700">Cliente Titular</div>
              <div className="text-xs font-semibold text-slate-900 mt-0.5 truncate">{negotiation.clientName}</div>
              <div className="text-[10px] text-slate-500 font-mono tabular-nums mt-0.5">
                {waData?.clientMessages?.length || 0} msg(s)
              </div>
            </button>
          </div>

          {waChannelTarget === 'BANCO' && (
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                Contato do {negotiation.bankName}
              </label>
              <select
                value={waBankContactFilterId}
                onChange={(e) => onBankContactFilterIdChange(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs bg-white"
              >
                <option value="">Todos ({(waData?.bankContacts || bankContactsList).length})</option>
                {(waData?.bankContacts || bankContactsList).map((bc) => (
                  <option key={bc.id} value={String(bc.id)}>
                    {bc.name} · {bc.sector} ({bc.mobile || bc.phone})
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Real Provider & Instance Selector */}
          <div className="pt-2 border-t border-slate-100 space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-semibold text-slate-600">Motor de Disparo</label>
              <span
                className={`text-[10px] font-semibold ${
                  isProviderReady ? 'text-emerald-700' : 'text-amber-700'
                }`}
              >
                ● {isProviderReady ? 'API Conectada' : 'Modo Fila Local'}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => setProvider('gotalk')}
                className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                  provider === 'gotalk'
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-300 bg-white text-slate-700'
                }`}
              >
                GoTalk Oficial
              </button>
              <button
                type="button"
                onClick={() => setProvider('uazapi')}
                className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                  provider === 'uazapi'
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-300 bg-white text-slate-700'
                }`}
              >
                UaZapi V2
              </button>
            </div>

            {provider === 'gotalk' && (providersMeta?.gotalkChannels?.length || 0) > 0 && (
              <select
                value={gotalkChannelDbId}
                onChange={(e) => setGotalkChannelDbId(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-[11px] bg-white"
              >
                <option value="">Canal GoTalk Padrão</option>
                {providersMeta?.gotalkChannels.map((ch) => (
                  <option key={ch.id} value={String(ch.id)}>
                    {ch.name} {ch.phoneNumber ? `(${ch.phoneNumber})` : ''}
                  </option>
                ))}
              </select>
            )}

            {provider === 'uazapi' && (providersMeta?.uazapiInstances?.length || 0) > 0 && (
              <select
                value={uazapiInstanceId}
                onChange={(e) => setUazapiInstanceId(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-[11px] bg-white"
              >
                <option value="">Instância Automática da Unidade</option>
                {providersMeta?.uazapiInstances.map((inst) => (
                  <option key={inst.id} value={inst.uazapiInstanceId}>
                    {inst.label} ({inst.isConnected ? 'Online' : 'Offline'})
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-100">
            <div>
              <label className="block text-[10px] font-semibold uppercase text-slate-500 mb-1">Data</label>
              <input
                type="date"
                value={waDateFilter}
                onChange={(e) => setWaDateFilter(e.target.value)}
                className="w-full rounded border border-slate-300 px-2 py-1 text-xs font-mono"
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase text-slate-500 mb-1">Operador</label>
              <input
                type="text"
                value={waOperatorFilter}
                onChange={(e) => setWaOperatorFilter(e.target.value)}
                placeholder="Ex: Carla"
                className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
              />
            </div>
          </div>

          {/* Assessora Ivi IA Draft Helper */}
          <div className="rounded-lg border border-purple-200 bg-purple-50/50 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-purple-900 flex items-center gap-1">
                <Sparkles className="w-3.5 h-3.5 text-purple-600" />
                Sugestão da Ivi IA
              </span>
              <button
                type="button"
                onClick={() => void onRunIviAdvisor()}
                className="text-[10px] font-semibold text-purple-700 underline"
              >
                Atualizar IA
              </button>
            </div>
            <p className="text-[11px] text-purple-950 leading-relaxed line-clamp-3">
              {waChannelTarget === 'BANCO'
                ? iviAdvisor?.suggestedBankWhatsappDraft ||
                  `Olá! Referente ao contrato ${negotiation.contractNumber} (${negotiation.clientName}), temos proposta de quitação com ${negotiation.targetReductionPct}% de deságio. Conseguimos validar hoje?`
                : iviAdvisor?.suggestedClientWhatsappDraft ||
                  `Olá ${negotiation.clientName}! Estamos tratando diretamente com o ${negotiation.bankName} para aprovar a meta de ${negotiation.targetReductionPct}% de desconto.`}
            </p>
            <button
              type="button"
              onClick={() =>
                setWaMessageInput(
                  waChannelTarget === 'BANCO'
                    ? iviAdvisor?.suggestedBankWhatsappDraft ||
                        `Olá! Referente ao contrato ${negotiation.contractNumber} (${negotiation.clientName}), temos proposta de quitação com ${negotiation.targetReductionPct}% de deságio. Conseguimos validar hoje?`
                    : iviAdvisor?.suggestedClientWhatsappDraft ||
                        `Olá ${negotiation.clientName}! Estamos tratando diretamente com o ${negotiation.bankName} para aprovar a meta de ${negotiation.targetReductionPct}% de desconto.`
                )
              }
              className="w-full rounded-lg bg-purple-600 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-purple-700"
            >
              Inserir Minuta na Mensagem
            </button>
          </div>
        </div>
      </div>

      {/* Right 8 cols: Real Chat Stream, File Attachment & HSM Templates */}
      <div className="lg:col-span-8 flex flex-col rounded-xl border border-slate-200 bg-white overflow-hidden h-[540px]">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2.5">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-900">
              <span
                className={`h-2 w-2 rounded-full ${waChannelTarget === 'BANCO' ? 'bg-blue-600' : 'bg-emerald-600'}`}
              />
              <span className="truncate">
                {waChannelTarget === 'BANCO'
                  ? `${activeBankContact ? activeBankContact.name : 'Mesa'} · ${negotiation.bankName}`
                  : negotiation.clientName}
              </span>
              <span className="font-mono tabular-nums font-normal text-[11px] text-slate-500">
                ({activeRecipientPhone})
              </span>
            </div>
            {lastDeliveryInfo && (
              <div className="text-[10px] text-slate-500 mt-0.5 truncate">
                Último envio ({lastDeliveryInfo.provider}): {lastDeliveryInfo.detail}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            {(providersMeta?.gotalkHsmTemplates?.length || 0) > 0 && provider === 'gotalk' && (
              <button
                type="button"
                onClick={() => setShowHsmDrawer((v) => !v)}
                className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-700 hover:bg-blue-100 whitespace-nowrap"
              >
                <Zap className="w-3 h-3" />
                Templates HSM
              </button>
            )}
            <button
              type="button"
              onClick={() => void onRefreshWhatsapp()}
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-600 hover:text-slate-900 whitespace-nowrap"
            >
              <RefreshCw className={`w-3 h-3 ${waLoading ? 'animate-spin' : ''}`} />
              Sincronizar
            </button>
          </div>
        </div>

        {/* HSM Template Selector Strip */}
        {showHsmDrawer && (providersMeta?.gotalkHsmTemplates?.length || 0) > 0 && (
          <div className="border-b border-blue-200 bg-blue-50/40 px-4 py-2.5 space-y-1.5 max-h-40 overflow-y-auto">
            <div className="text-[10px] font-bold uppercase text-blue-900">
              Disparar Template HSM Aprovado (GoTalk)
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {providersMeta?.gotalkHsmTemplates.map((tpl) => (
                <button
                  key={tpl.id}
                  type="button"
                  disabled={waSending}
                  onClick={() =>
                    void handleSendHsm(
                      tpl.id,
                      tpl.bodyText || `Template ${tpl.templateName} (${negotiation.contractNumber})`
                    )
                  }
                  className="text-left rounded-lg border border-blue-200 bg-white px-2.5 py-1.5 text-[11px] hover:bg-blue-50"
                >
                  <div className="font-semibold text-slate-900 truncate">{tpl.templateName}</div>
                  {tpl.bodyText && <div className="text-[10px] text-slate-500 truncate">{tpl.bodyText}</div>}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50">
          {waLoading ? (
            <div className="py-12 text-center text-xs text-slate-500">Carregando histórico de mensagens...</div>
          ) : filteredWaMessages.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-500">
              Nenhuma mensagem registrada. Digite abaixo ou anexe uma proposta para enviar.
            </div>
          ) : (
            filteredWaMessages.map((m) => {
              const isOutbound = m.direction === 'outbound';
              return (
                <div
                  key={m.id}
                  className={`flex flex-col max-w-[82%] rounded-xl p-3 text-xs ${
                    isOutbound
                      ? 'ml-auto bg-emerald-700 text-white'
                      : 'mr-auto bg-white border border-slate-200 text-slate-800'
                  }`}
                >
                  <div className="flex items-center justify-between gap-4 text-[10px] opacity-80 mb-1">
                    <strong>{m.senderName}</strong>
                    <span className="inline-flex items-center gap-1 font-mono tabular-nums">
                      {m.createdAt ? new Date(m.createdAt).toLocaleString('pt-BR') : ''}
                      {isOutbound &&
                        (m.ackStatus && m.ackStatus >= 2 ? (
                          <CheckCheck className="w-3 h-3" />
                        ) : (
                          <Check className="w-3 h-3" />
                        ))}
                    </span>
                  </div>

                  <p className="whitespace-pre-wrap leading-relaxed">{m.body}</p>

                  {m.attachmentUrl && (
                    <button
                      type="button"
                      onClick={() => handleOpenAttachment(m.attachmentUrl!)}
                      className={`mt-2 inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold w-fit ${
                        isOutbound
                          ? 'bg-emerald-800 text-emerald-50 hover:bg-emerald-900'
                          : 'bg-slate-100 text-slate-800 hover:bg-slate-200'
                      }`}
                    >
                      <FileText className="w-3.5 h-3.5" />
                      <span className="truncate max-w-[200px]">{m.attachmentName || 'Baixar Anexo'}</span>
                      <Download className="w-3 h-3" />
                    </button>
                  )}

                  {m.iviAudioTranscript && (
                    <div
                      className={`mt-2 rounded p-2 text-[11px] ${
                        isOutbound ? 'bg-emerald-800/80 text-emerald-100' : 'bg-purple-50 text-purple-900'
                      }`}
                    >
                      <strong>Transcrição de Áudio (Ivi IA):</strong> {m.iviAudioTranscript}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Composer */}
        <div className="border-t border-slate-200 bg-white p-3 flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.mp3,.ogg,.webm,.wav"
            onChange={(e) => void handleFileUpload(e)}
            className="hidden"
          />
          <button
            type="button"
            disabled={waSending}
            onClick={() => fileInputRef.current?.click()}
            className="rounded-lg border border-slate-300 p-2 text-slate-600 hover:bg-slate-100 disabled:opacity-50"
            title="Enviar PDF, Imagem, Proposta ou Áudio pelo WhatsApp"
          >
            <Paperclip className="w-4 h-4" />
          </button>

          <input
            type="text"
            value={waMessageInput}
            onChange={(e) => setWaMessageInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void handleSendText();
              }
            }}
            placeholder={
              waChannelTarget === 'BANCO'
                ? `Escrever para ${activeBankContact?.name || negotiation.bankName} via ${provider === 'uazapi' ? 'UaZapi' : 'GoTalk'}...`
                : `Escrever para ${negotiation.clientName} via ${provider === 'uazapi' ? 'UaZapi' : 'GoTalk'}...`
            }
            className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-emerald-600 focus:outline-none"
          />
          <button
            type="button"
            disabled={waSending || !waMessageInput.trim()}
            onClick={() => void handleSendText()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 whitespace-nowrap"
          >
            <Send className="w-3.5 h-3.5" />
            {waSending ? 'Enviando...' : 'Enviar'}
          </button>
        </div>
      </div>
    </div>
  );
};
