import React, { useEffect, useState } from 'react';
import {
  Check,
  CheckCheck,
  Copy,
  FileText,
  Headphones,
  MessageSquare,
  Mic,
  PanelRightClose,
  Paperclip,
  Send,
  Sparkles,
  Volume2,
  X,
} from 'lucide-react';
import { apiFetch, formatDateTimeBR, getAuthToken } from '../lib/api.ts';
import { GotalkHsmTemplate, WhatsappMessage, WhatsappThread } from '../types.ts';

const DockBucketAudio: React.FC<{ sha256: string }> = ({ sha256 }) => {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [url]);

  const loadAudio = async () => {
    if (url || loading) return;
    setLoading(true);
    try {
      const resp = await fetch(`/api/bucket/objects/${sha256}?preview=1`, {
        headers: { Authorization: `Bearer ${getAuthToken()}` },
      });
      if (resp.ok) {
        const blob = await resp.blob();
        setUrl(URL.createObjectURL(blob));
      }
    } finally {
      setLoading(false);
    }
  };

  if (url) {
    return <audio controls autoPlay className="w-full h-8 mt-1.5" src={url} />;
  }

  return (
    <button
      type="button"
      onClick={loadAudio}
      disabled={loading}
      className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 hover:text-emerald-800"
    >
      <Volume2 className="w-3.5 h-3.5" />
      {loading ? 'Carregando áudio do Bucket...' : 'Ouvir áudio arquivado (BucketDaInvicta)'}
    </button>
  );
};

interface FixedWhatsAppDockProps {
  isMobileOpen: boolean;
  onCloseMobile: () => void;
  isDesktopOpen: boolean;
  onCloseDesktop: () => void;
  onCopyToClipboard?: (text: string) => void;
  onUnreadCountChange?: (count: number) => void;
  wsTick: number;
}

export const FixedWhatsAppDock: React.FC<FixedWhatsAppDockProps> = ({
  isMobileOpen,
  onCloseMobile,
  isDesktopOpen,
  onCloseDesktop,
  onCopyToClipboard,
  onUnreadCountChange,
  wsTick,
}) => {
  const [threads, setThreads] = useState<WhatsappThread[]>([]);
  const [messages, setMessages] = useState<WhatsappMessage[]>([]);
  const [templates, setTemplates] = useState<GotalkHsmTemplate[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [selectedTplName, setSelectedTplName] = useState('');
  const [tplVars, setTplVars] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');

  const loadThreads = async () => {
    try {
      const [data, resData] = await Promise.all([
        apiFetch<{ threads: WhatsappThread[]; messages: WhatsappMessage[] }>('/api/whatsapp/threads'),
        apiFetch<{ templates: GotalkHsmTemplate[] }>('/api/integrations/gotalk/resources').catch(() => ({
          templates: [],
        })),
      ]);
      setThreads(data.threads);
      setMessages(data.messages);
      setTemplates(resData.templates || []);
      if (onUnreadCountChange) {
        const totalUnread = data.threads.reduce((acc, t) => acc + (t.unreadCount || 0), 0);
        onUnreadCountChange(totalUnread);
      }
      if (!activeThreadId && data.threads[0]) {
        setActiveThreadId(data.threads[0].id);
      }
    } catch {
      // ignore initial auth transition
    }
  };

  useEffect(() => {
    loadThreads();
  }, [wsTick]);

  const activeThread = threads.find((t) => t.id === activeThreadId) || threads[0];
  const threadMessages = messages.filter((m) => m.threadId === activeThread?.id);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.trim() || !activeThread) return;
    setBusy(true);
    try {
      const res = await apiFetch<{
        message: WhatsappMessage;
        gotalkDelivery?: { dispatched: boolean; provider: string; detail?: string } | null;
        uazapiDelivery?: { dispatched: boolean; provider: string; detail?: string } | null;
        delivery?: { dispatched: boolean; provider: string; detail?: string } | null;
      }>(`/api/whatsapp/threads/${activeThread.id}/messages`, {
        method: 'POST',
        body: JSON.stringify({ body: draft, contentType: 'text', direction: 'outbound' }),
      });
      setDraft('');
      const detail = res.delivery?.detail || res.gotalkDelivery?.detail || res.uazapiDelivery?.detail;
      if (detail) {
        setToast(detail);
        setTimeout(() => setToast(''), 3000);
      }
      await loadThreads();
    } finally {
      setBusy(false);
    }
  };

  const handleUploadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !activeThread) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', file);
      if (draft.trim()) form.append('caption', draft.trim());
      const resp = await fetch(`/api/whatsapp/threads/${activeThread.id}/send-file`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getAuthToken()}` },
        body: form,
      });
      const data = (await resp.json().catch(() => ({}))) as {
        delivery?: { detail?: string };
        error?: string;
      };
      if (resp.ok) {
        setDraft('');
        setToast(data.delivery?.detail || `Anexo "${file.name}" enviado.`);
        setTimeout(() => setToast(''), 3000);
        await loadThreads();
      } else {
        setToast(data.error || 'Falha ao enviar anexo.');
        setTimeout(() => setToast(''), 3000);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleSimulateInboundAudio = async () => {
    if (!activeThread) return;
    setBusy(true);
    try {
      await apiFetch(`/api/whatsapp/threads/${activeThread.id}/messages`, {
        method: 'POST',
        body: JSON.stringify({
          body: '[Áudio Recebido 0:19] Olá, recebi o aviso da Ivi e vou transferir a parcela em aberto hoje às 16h via Pix.',
          contentType: 'audio',
          direction: 'inbound',
        }),
      });
      await loadThreads();
    } finally {
      setBusy(false);
    }
  };

  const handleTranscribe = async (msgId: number) => {
    setBusy(true);
    try {
      await apiFetch(`/api/whatsapp/messages/${msgId}/transcribe`, { method: 'POST' });
      await loadThreads();
    } finally {
      setBusy(false);
    }
  };

  const handleCopyText = (text: string) => {
    navigator.clipboard?.writeText(text).catch(() => {});
    if (onCopyToClipboard) onCopyToClipboard(text);
    setToast('Texto copiado para a área de Cobrança');
    setTimeout(() => setToast(''), 2200);
  };

  const content = (
    <div className="flex flex-col h-full bg-white border-l border-slate-200">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-2 bg-slate-50/70">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-emerald-600 shrink-0" />
            <h3 className="font-display text-sm font-bold text-slate-900 truncate">
              WhatsApp · GoTalk & UaZapi
            </h3>
          </div>
          <p className="text-[11px] text-slate-500 truncate">
            {threads.length} conversas ativas · Transcrição Ivi
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleSimulateInboundAudio}
            disabled={busy || !activeThread}
            title="Simular recebimento de áudio para Ivi transcrever"
            className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 min-h-[34px]"
          >
            <Mic className="w-3.5 h-3.5 text-blue-600" />
            Áudio
          </button>
          <button
            type="button"
            onClick={onCloseDesktop}
            title="Recolher painel WhatsApp"
            className="hidden xl:inline-flex items-center justify-center p-1.5 rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800"
          >
            <PanelRightClose className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onCloseMobile}
            aria-label="Fechar WhatsApp"
            className="xl:hidden p-2 rounded-md text-slate-500 hover:bg-slate-100 min-h-[40px] min-w-[40px] flex items-center justify-center"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Thread Selector */}
      <div className="flex gap-1.5 overflow-x-auto px-3 py-2 border-b border-slate-100 bg-white">
        {threads.map((t) => {
          const isActive = t.id === activeThread?.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveThreadId(t.id)}
              className={`px-2.5 py-1.5 rounded-lg text-left shrink-0 transition-colors border ${
                isActive
                  ? 'border-emerald-600 bg-emerald-50 text-emerald-950'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              <div className="text-xs font-semibold whitespace-nowrap flex items-center gap-1.5">
                <span>{t.contactName.split(' ')[0]}</span>
                {t.unreadCount > 0 && (
                  <span className="font-mono text-[10px] font-bold text-emerald-700 tabular-nums">
                    ({t.unreadCount})
                  </span>
                )}
              </div>
              <div className="text-[10px] text-slate-500 font-mono">
                {t.provider.toUpperCase()}
              </div>
            </button>
          );
        })}
      </div>

      {toast && (
        <div className="bg-emerald-600 text-white text-[11px] font-medium px-3 py-1.5 text-center">
          {toast}
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3 bg-slate-50/50">
        {threadMessages.map((msg) => {
          const isOutbound = msg.direction === 'outbound';
          return (
            <div
              key={msg.id}
              className={`rounded-xl border p-2.5 text-xs ${
                isOutbound
                  ? 'ml-5 border-emerald-200 bg-emerald-50/70 text-slate-900'
                  : 'mr-5 border-slate-200 bg-white text-slate-800'
              }`}
            >
              <div className="flex items-center justify-between gap-2 text-[10px] text-slate-500 mb-1">
                <span className="font-semibold text-slate-700">{msg.senderName}</span>
                <span className="font-mono flex items-center gap-1">
                  {formatDateTimeBR(msg.createdAt)}
                  {isOutbound && msg.ackStatus === 1 && <Check className="w-3 h-3 text-slate-400" />}
                  {isOutbound && msg.ackStatus === 2 && <CheckCheck className="w-3 h-3 text-slate-500" />}
                  {isOutbound && msg.ackStatus === 3 && <CheckCheck className="w-3 h-3 text-blue-600" />}
                </span>
              </div>
              {msg.deletedInOrigin && (
                <div className="mb-1 text-[10px] font-medium text-amber-700">
                  Apagada na origem (preservada no CRM)
                </div>
              )}
              <p className="leading-relaxed whitespace-pre-wrap">{msg.body}</p>
              {msg.attachmentName && (
                <div className="mt-1.5 flex items-center gap-1 text-[11px] font-medium text-slate-600">
                  <FileText className="w-3 h-3 shrink-0" />
                  <span className="truncate">{msg.attachmentName}</span>
                </div>
              )}

              {msg.contentType === 'audio' && (
                <div className="mt-2 pt-2 border-t border-slate-100 space-y-1.5">
                  {msg.mediaSha256 && <DockBucketAudio sha256={msg.mediaSha256} />}
                  {msg.iviAudioTranscript ? (
                    <div className="rounded-lg bg-blue-50/80 border border-blue-100 p-2 text-[11px] text-blue-950">
                      <div className="flex items-center gap-1 font-semibold text-blue-800 mb-0.5">
                        <Sparkles className="w-3 h-3" />
                        Transcrição Ivi
                      </div>
                      {msg.iviAudioTranscript}
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleTranscribe(msg.id)}
                      disabled={busy}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-700 hover:text-blue-800"
                    >
                      <Headphones className="w-3 h-3" />
                      Transcrever áudio com Ivi
                    </button>
                  )}
                </div>
              )}

              <div className="mt-1.5 flex justify-end">
                <button
                  type="button"
                  onClick={() => handleCopyText(msg.iviAudioTranscript || msg.body)}
                  className="inline-flex items-center gap-1 text-[10px] font-medium text-slate-500 hover:text-slate-900"
                >
                  <Copy className="w-3 h-3" />
                  Copiar p/ Cobrança
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* HSM Template Picker Drawer */}
      {showTemplatePicker && activeThread && (
        <div className="border-t border-slate-200 bg-slate-50 p-3 space-y-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="font-bold text-slate-800">Disparar Template HSM (GoTalk)</span>
            <button
              type="button"
              onClick={() => setShowTemplatePicker(false)}
              className="text-slate-500 hover:text-slate-800"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          {templates.length === 0 ? (
            <div className="text-[11px] text-slate-500">
              Sincronize os templates em Configurações → IA Ivi & Conectores API primeiro.
            </div>
          ) : (
            <>
              <select
                value={selectedTplName}
                onChange={(e) => {
                  setSelectedTplName(e.target.value);
                  setTplVars({});
                }}
                className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
              >
                <option value="">Selecione um template HSM...</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.templateName}>
                    {t.templateName} ({t.status || 'ATIVO'})
                  </option>
                ))}
              </select>
              {(() => {
                const tpl = templates.find((t) => t.templateName === selectedTplName);
                if (!tpl) return null;
                const vars = Array.from(
                  new Set((tpl.bodyText || '').match(/\{\{(\d+)\}\}/g)?.map((m) => m.replace(/\{\{|\}\}/g, '')) || [])
                );
                return (
                  <div className="space-y-2">
                    {vars.map((v) => (
                      <input
                        key={v}
                        type="text"
                        placeholder={`Variável {{${v}}}`}
                        value={tplVars[v] || ''}
                        onChange={(e) => setTplVars((prev) => ({ ...prev, [v]: e.target.value }))}
                        className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
                      />
                    ))}
                    <div className="rounded-lg bg-white border border-slate-200 p-2 text-[11px] text-slate-700 whitespace-pre-wrap">
                      {(tpl.bodyText || tpl.templateName).replace(/\{\{(\d+)\}\}/g, (_, n) => tplVars[n] || `{{${n}}}`)}
                    </div>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          const res = await apiFetch<{ gotalkDelivery?: { detail?: string } }>(
                            '/api/integrations/gotalk/send-template',
                            {
                              method: 'POST',
                              body: JSON.stringify({
                                threadId: activeThread.id,
                                templateName: tpl.templateName,
                                variables: tplVars,
                              }),
                            }
                          );
                          setShowTemplatePicker(false);
                          if (res.gotalkDelivery?.detail) {
                            setToast(res.gotalkDelivery.detail);
                            setTimeout(() => setToast(''), 3000);
                          }
                          await loadThreads();
                        } finally {
                          setBusy(false);
                        }
                      }}
                      className="w-full rounded-lg bg-emerald-600 px-3 py-1.5 font-semibold text-white hover:bg-emerald-700"
                    >
                      Enviar Template HSM
                    </button>
                  </div>
                );
              })()}
            </>
          )}
        </div>
      )}

      {/* Composer */}
      <form onSubmit={handleSend} className="p-3 border-t border-slate-200 bg-white flex gap-1.5">
        <label
          title="Enviar PDF, imagem ou áudio (GoTalk / UaZapi)"
          className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-slate-700 hover:bg-slate-100 min-h-[40px] cursor-pointer"
        >
          <Paperclip className="w-4 h-4" />
          <input type="file" className="hidden" disabled={busy || !activeThread} onChange={handleUploadFile} />
        </label>
        {templates.length > 0 && activeThread?.provider === 'gotalk' && (
          <button
            type="button"
            onClick={() => setShowTemplatePicker((s) => !s)}
            title="Enviar Template HSM GoTalk"
            className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-slate-700 hover:bg-slate-100 min-h-[40px]"
          >
            <FileText className="w-4 h-4" />
          </button>
        )}
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Responder via GoTalk / UaZapi..."
          className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 focus:bg-white focus:border-emerald-600 focus:outline-none min-h-[40px]"
        />
        <button
          type="submit"
          disabled={busy || !draft.trim()}
          aria-label="Enviar mensagem"
          className="inline-flex items-center justify-center rounded-lg bg-emerald-600 px-3.5 text-white hover:bg-emerald-700 disabled:opacity-50 min-h-[40px]"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>
    </div>
  );

  return (
    <>
      {/* Collapsible Desktop Dock (>= 1280px) */}
      {isDesktopOpen && (
        <aside className="hidden xl:block w-[330px] shrink-0 h-[calc(100vh-56px)] sticky top-[56px]">
          {content}
        </aside>
      )}

      {/* Slide-over Drawer for 5", 7", 10" (and desktop when reopened on narrow viewports) */}
      {isMobileOpen && (
        <div className="xl:hidden fixed inset-0 z-50 flex justify-end bg-slate-900/40 backdrop-blur-xs">
          <div className="flex-1" onClick={onCloseMobile} />
          <div className="w-full max-w-sm h-full shadow-2xl">{content}</div>
        </div>
      )}
    </>
  );
};
