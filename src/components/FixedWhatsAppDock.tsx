import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCheck,
  Copy,
  FileText,
  Headphones,
  Maximize2,
  MessageSquare,
  Mic,
  PanelRightClose,
  Paperclip,
  Plus,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  Volume2,
  X,
} from 'lucide-react';
import { apiFetch, formatDateTimeBR, getActiveUnitHeader, getAuthToken, parseJsonResponse } from '../lib/api.ts';
import {
  GotalkChannelPublic,
  GotalkHsmTemplate,
  UazapiInstancePublic,
  WhatsappMessage,
  WhatsappThread,
} from '../types.ts';

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
      className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 hover:text-emerald-800 dark:text-emerald-300 dark:hover:text-emerald-200"
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
  onOpenFullWhatsapp?: () => void;
  onCopyToClipboard?: (text: string) => void;
  onUnreadCountChange?: (count: number) => void;
  wsTick: number;
}

export const FixedWhatsAppDock: React.FC<FixedWhatsAppDockProps> = ({
  isMobileOpen,
  onCloseMobile,
  isDesktopOpen,
  onCloseDesktop,
  onOpenFullWhatsapp,
  onCopyToClipboard,
  onUnreadCountChange,
  wsTick,
}) => {
  const [threads, setThreads] = useState<WhatsappThread[]>([]);
  const [messages, setMessages] = useState<WhatsappMessage[]>([]);
  const [instances, setInstances] = useState<UazapiInstancePublic[]>([]);
  const [channels, setChannels] = useState<GotalkChannelPublic[]>([]);
  const [templates, setTemplates] = useState<GotalkHsmTemplate[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [draft, setDraft] = useState('');
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [selectedTplName, setSelectedTplName] = useState('');
  const [tplVars, setTplVars] = useState<Record<string, string>>({});
  const [showNewForm, setShowNewForm] = useState(false);
  const [newPhone, setNewPhone] = useState('');
  const [newName, setNewName] = useState('');
  const [newProvider, setNewProvider] = useState<'uazapi' | 'gotalk'>('uazapi');
  const [newInstanceId, setNewInstanceId] = useState('');
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [toast, setToast] = useState('');
  const [errorBanner, setErrorBanner] = useState('');

  const showNotice = useCallback((msg: string, isError = false) => {
    if (isError) {
      setErrorBanner(msg);
      window.setTimeout(() => {
        setErrorBanner((prev) => (prev === msg ? '' : prev));
      }, 5000);
    } else {
      setToast(msg);
      window.setTimeout(() => {
        setToast((prev) => (prev === msg ? '' : prev));
      }, 3500);
    }
  }, []);

  const loadThreads = useCallback(async () => {
    try {
      const [data, resData] = await Promise.all([
        apiFetch<{
          threads: WhatsappThread[];
          messages: WhatsappMessage[];
          instances?: UazapiInstancePublic[];
          channels?: GotalkChannelPublic[];
        }>('/api/whatsapp/threads', { passive: true }),
        apiFetch<{ templates: GotalkHsmTemplate[] }>('/api/integrations/gotalk/resources', { passive: true }).catch(() => ({
          templates: [],
        })),
      ]);
      const nextThreads = data.threads || [];
      setThreads(nextThreads);
      setMessages(data.messages || []);
      setInstances(data.instances || []);
      setChannels(data.channels || []);
      setTemplates(resData.templates || []);
      setErrorBanner('');
      if (onUnreadCountChange) {
        const totalUnread = nextThreads.reduce((acc, t) => acc + (t.unreadCount || 0), 0);
        onUnreadCountChange(totalUnread);
      }
      setActiveThreadId((prev) => {
        if (prev && nextThreads.some((t) => t.id === prev)) return prev;
        return nextThreads[0]?.id ?? null;
      });
    } catch (err) {
      if (isDesktopOpen || isMobileOpen) {
        showNotice(err instanceof Error ? err.message : 'Falha ao carregar conversas WhatsApp.', true);
      }
    }
  }, [isDesktopOpen, isMobileOpen, onUnreadCountChange, showNotice]);

  useEffect(() => {
    loadThreads();
  }, [wsTick, isDesktopOpen, isMobileOpen, loadThreads]);

  const filteredThreads = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return threads;
    return threads.filter(
      (t) =>
        t.contactName.toLowerCase().includes(q) ||
        t.contactPhone.toLowerCase().includes(q) ||
        (t.lastMessagePreview || '').toLowerCase().includes(q)
    );
  }, [threads, searchQuery]);

  const activeThread =
    threads.find((t) => t.id === activeThreadId) || filteredThreads[0] || threads[0] || null;
  const threadMessages = messages.filter((m) => m.threadId === activeThread?.id);

  const handleSelectThread = (t: WhatsappThread) => {
    setActiveThreadId(t.id);
    setShowTemplatePicker(false);
    if (t.unreadCount > 0) {
      setThreads((prev) => prev.map((row) => (row.id === t.id ? { ...row, unreadCount: 0 } : row)));
      apiFetch(`/api/whatsapp/threads/${t.id}/read`, { method: 'POST', passive: true }).catch(() => {});
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await apiFetch<{
        ok: boolean;
        uazapi?: { connectedCount: number; instancesChecked: number; threadsSynced: number; messagesSynced: number };
        gotalk?: { configured: boolean; synced: { channelsSynced: number } | null; error: string | null };
      }>('/api/whatsapp/sync', { method: 'POST', body: JSON.stringify({}) });
      const parts: string[] = [];
      if (res.uazapi) {
        parts.push(
          `UaZapi ${res.uazapi.connectedCount}/${res.uazapi.instancesChecked} online (${res.uazapi.messagesSynced} msg)`
        );
      }
      if (res.gotalk?.configured) {
        parts.push(res.gotalk.error ? `GoTalk: ${res.gotalk.error}` : 'GoTalk OK');
      }
      showNotice(parts.join(' · ') || 'Sincronização concluída.');
      await loadThreads();
    } catch (err) {
      showNotice(err instanceof Error ? err.message : 'Erro ao sincronizar WhatsApp.', true);
    } finally {
      setSyncing(false);
    }
  };

  const handleCreateQuickThread = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPhone.trim()) {
      showNotice('Informe o telefone com DDD.', true);
      return;
    }
    setBusy(true);
    try {
      const res = await apiFetch<{ thread: WhatsappThread }>('/api/whatsapp/threads', {
        method: 'POST',
        body: JSON.stringify({
          unitId: Number(getActiveUnitHeader()) || 1,
          provider: newProvider,
          contactPhone: newPhone.trim(),
          contactName: newName.trim() || undefined,
          uazapiInstanceId: newProvider === 'uazapi' ? newInstanceId || undefined : undefined,
        }),
      });
      setShowNewForm(false);
      setNewPhone('');
      setNewName('');
      await loadThreads();
      setActiveThreadId(res.thread.id);
      showNotice(`Conversa pronta (${res.thread.provider.toUpperCase()}).`);
    } catch (err) {
      showNotice(err instanceof Error ? err.message : 'Erro ao criar conversa.', true);
    } finally {
      setBusy(false);
    }
  };

  const handleUpdateRouting = async (patch: {
    provider?: 'gotalk' | 'uazapi';
    uazapiInstanceId?: string | null;
    channelDbId?: number | null;
  }) => {
    if (!activeThread) return;
    setBusy(true);
    try {
      const res = await apiFetch<{ thread: WhatsappThread }>(`/api/whatsapp/threads/${activeThread.id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      setThreads((prev) => prev.map((t) => (t.id === res.thread.id ? res.thread : t)));
      showNotice(`Canal atualizado para ${res.thread.provider.toUpperCase()}.`);
    } catch (err) {
      showNotice(err instanceof Error ? err.message : 'Falha ao alterar canal.', true);
    } finally {
      setBusy(false);
    }
  };

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
      const delivery = res.delivery || res.gotalkDelivery || res.uazapiDelivery;
      if (delivery?.detail) {
        showNotice(delivery.detail, delivery.dispatched === false);
      }
      await loadThreads();
    } catch (err) {
      showNotice(err instanceof Error ? err.message : 'Falha ao enviar mensagem.', true);
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
      const token = getAuthToken();
      const resp = await fetch(`/api/whatsapp/threads/${activeThread.id}/send-file`, {
        method: 'POST',
        headers: {
          'x-unit-id': String(getActiveUnitHeader()),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: form,
      });
      const data = await parseJsonResponse<{ delivery?: { dispatched?: boolean; detail?: string }; error?: string }>(
        resp,
        'Falha ao enviar anexo.'
      );
      setDraft('');
      showNotice(data.delivery?.detail || `Anexo "${file.name}" enviado.`, data.delivery?.dispatched === false);
      await loadThreads();
    } catch (err) {
      showNotice(err instanceof Error ? err.message : 'Falha ao enviar anexo.', true);
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
    } catch (err) {
      showNotice(err instanceof Error ? err.message : 'Erro ao simular áudio.', true);
    } finally {
      setBusy(false);
    }
  };

  const handleTranscribe = async (msgId: number) => {
    setBusy(true);
    try {
      await apiFetch(`/api/whatsapp/messages/${msgId}/transcribe`, { method: 'POST' });
      await loadThreads();
    } catch (err) {
      showNotice(err instanceof Error ? err.message : 'Erro ao transcrever áudio.', true);
    } finally {
      setBusy(false);
    }
  };

  const handleCopyText = (text: string) => {
    navigator.clipboard?.writeText(text).catch(() => {});
    if (onCopyToClipboard) onCopyToClipboard(text);
    showNotice('Texto copiado para a área de Cobrança');
  };

  const content = (
    <div className="flex flex-col h-full bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800">
      {/* Header */}
      <div className="px-3.5 py-2.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2 bg-slate-50/70 dark:bg-slate-900">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <MessageSquare className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
              WhatsApp · GoTalk &amp; UaZapi
            </h3>
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate tabular-nums">
            {threads.length} conversa(s) · {instances.filter((i) => i.isConnected).length} UaZapi online
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={handleSync}
            disabled={syncing}
            title="Sincronizar GoTalk e UaZapi"
            className="p-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
          </button>
          <button
            type="button"
            onClick={() => setShowNewForm((s) => !s)}
            title="Nova conversa WhatsApp"
            className="p-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-emerald-700 dark:text-emerald-300 hover:bg-slate-100 dark:hover:bg-slate-700"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
          {onOpenFullWhatsapp && (
            <button
              type="button"
              onClick={() => {
                onCloseMobile();
                onOpenFullWhatsapp();
              }}
              title="Abrir Mensageria WhatsApp em Tela Cheia"
              className="p-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={handleSimulateInboundAudio}
            disabled={busy || !activeThread}
            title="Simular recebimento de áudio para Ivi transcrever"
            className="p-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 hover:bg-slate-100 dark:hover:bg-slate-700"
          >
            <Mic className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={onCloseDesktop}
            title="Recolher painel WhatsApp"
            className="hidden xl:inline-flex items-center justify-center p-1.5 rounded-md text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-800 dark:hover:text-slate-100"
          >
            <PanelRightClose className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onCloseMobile}
            aria-label="Fechar WhatsApp"
            className="xl:hidden p-2 rounded-md text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 min-h-[40px] min-w-[40px] flex items-center justify-center"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Quick New Conversation Drawer */}
      {showNewForm && (
        <form
          onSubmit={handleCreateQuickThread}
          className="p-3 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 space-y-2 text-xs"
        >
          <div className="flex items-center justify-between font-bold text-slate-800 dark:text-slate-100">
            <span>Nova Conversa WhatsApp</span>
            <button type="button" onClick={() => setShowNewForm(false)} className="text-slate-400 hover:text-slate-700">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <input
              type="text"
              required
              value={newPhone}
              onChange={(e) => setNewPhone(e.target.value)}
              placeholder="(81) 99999-9999"
              className="rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 font-mono text-[11px]"
            />
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Nome do contato"
              className="rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-[11px]"
            />
          </div>
          <div className="flex gap-1.5">
            <select
              value={newProvider}
              onChange={(e) => setNewProvider(e.target.value as 'uazapi' | 'gotalk')}
              className="rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-[11px] font-semibold"
            >
              <option value="uazapi">UaZapi</option>
              <option value="gotalk">GoTalk</option>
            </select>
            {newProvider === 'uazapi' && instances.length > 0 && (
              <select
                value={newInstanceId}
                onChange={(e) => setNewInstanceId(e.target.value)}
                className="flex-1 min-w-0 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-[11px]"
              >
                <option value="">Padrão da unidade</option>
                {instances.map((i) => (
                  <option key={i.id} value={i.uazapiInstanceId}>
                    {i.label} {i.isConnected ? '(Online)' : '(Offline)'}
                  </option>
                ))}
              </select>
            )}
            <button
              type="submit"
              disabled={busy}
              className="rounded-md bg-emerald-600 px-3 py-1 font-semibold text-white hover:bg-emerald-700 shrink-0"
            >
              Abrir
            </button>
          </div>
        </form>
      )}

      {/* Search + Thread Selector */}
      <div className="px-3 pt-2 pb-1 bg-white dark:bg-slate-900">
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filtrar conversa ou telefone..."
            className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 pl-7 pr-2 py-1 text-[11px] text-slate-800 dark:text-slate-100 focus:outline-none focus:border-emerald-600"
          />
        </div>
      </div>

      <div className="flex gap-1.5 overflow-x-auto px-3 py-2 border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900">
        {filteredThreads.length === 0 ? (
          <div className="text-[11px] text-slate-400 py-1 px-1">Nenhuma conversa localizada.</div>
        ) : (
          filteredThreads.map((t) => {
            const isActive = t.id === activeThread?.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => handleSelectThread(t)}
                className={`px-2.5 py-1.5 rounded-lg text-left shrink-0 transition-colors border ${
                  isActive
                    ? 'border-emerald-600 dark:border-emerald-500 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-950 dark:text-emerald-200'
                    : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700'
                }`}
              >
                <div className="text-xs font-semibold whitespace-nowrap flex items-center gap-1.5">
                  <span>{t.contactName.split(' ')[0]}</span>
                  {t.unreadCount > 0 && (
                    <span className="font-mono text-[10px] font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">
                      ({t.unreadCount})
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">
                  {t.provider.toUpperCase()}
                </div>
              </button>
            );
          })
        )}
      </div>

      {/* Persistent Thread Provider/Instance Switcher */}
      {activeThread && (
        <div className="px-3 py-1.5 border-b border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/70 flex items-center justify-between gap-2 text-[11px]">
          <span className="font-mono text-slate-500 dark:text-slate-400 truncate">{activeThread.contactPhone}</span>
          <div className="flex items-center gap-1 shrink-0">
            <select
              value={activeThread.provider}
              disabled={busy}
              onChange={(e) => {
                const p = e.target.value as 'gotalk' | 'uazapi';
                void handleUpdateRouting({
                  provider: p,
                  uazapiInstanceId:
                    p === 'uazapi'
                      ? activeThread.uazapiInstanceId || instances[0]?.uazapiInstanceId || null
                      : null,
                  channelDbId: p === 'gotalk' ? activeThread.channelDbId || channels[0]?.id || null : null,
                });
              }}
              className="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-1.5 py-0.5 text-[10px] font-semibold"
            >
              <option value="uazapi">UaZapi</option>
              <option value="gotalk">GoTalk</option>
            </select>
            {activeThread.provider === 'uazapi' && instances.length > 0 && (
              <select
                value={activeThread.uazapiInstanceId || ''}
                disabled={busy}
                onChange={(e) => void handleUpdateRouting({ uazapiInstanceId: e.target.value || null })}
                className="max-w-[110px] rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-1.5 py-0.5 text-[10px]"
              >
                <option value="">Padrão</option>
                {instances.map((i) => (
                  <option key={i.id} value={i.uazapiInstanceId}>
                    {i.label}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>
      )}

      {errorBanner && (
        <div className="bg-red-600 text-white text-[11px] font-medium px-3 py-1.5 flex items-center justify-between gap-2">
          <span className="truncate">{errorBanner}</span>
          <button type="button" onClick={() => setErrorBanner('')} className="shrink-0">
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {toast && (
        <div className="bg-emerald-600 text-white text-[11px] font-medium px-3 py-1.5 text-center">
          {toast}
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3 bg-slate-50/50 dark:bg-slate-950/60">
        {threadMessages.map((msg) => {
          const isOutbound = msg.direction === 'outbound';
          const showDeliveryWarning =
            isOutbound && (msg.deliveryStatus === 'failed' || msg.deliveryStatus === 'queued');
          return (
            <div
              key={msg.id}
              className={`rounded-xl border p-2.5 text-xs ${
                isOutbound
                  ? 'ml-5 border-emerald-200 dark:border-emerald-800/70 bg-emerald-50/70 dark:bg-emerald-950/50 text-slate-900 dark:text-slate-100'
                  : 'mr-5 border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200'
              }`}
            >
              <div className="flex items-center justify-between gap-2 text-[10px] text-slate-500 dark:text-slate-400 mb-1">
                <span className="font-semibold text-slate-700 dark:text-slate-200">{msg.senderName}</span>
                <span className="font-mono flex items-center gap-1">
                  {formatDateTimeBR(msg.createdAt)}
                  {isOutbound && msg.ackStatus === 1 && <Check className="w-3 h-3 text-slate-400 dark:text-slate-400" />}
                  {isOutbound && msg.ackStatus === 2 && <CheckCheck className="w-3 h-3 text-slate-500 dark:text-slate-400" />}
                  {isOutbound && msg.ackStatus === 3 && <CheckCheck className="w-3 h-3 text-blue-600 dark:text-blue-400" />}
                </span>
              </div>
              {msg.deletedInOrigin && (
                <div className="mb-1 text-[10px] font-medium text-amber-700 dark:text-amber-300">
                  Apagada na origem (preservada no CRM)
                </div>
              )}
              <p className="leading-relaxed whitespace-pre-wrap">{msg.body}</p>
              {msg.attachmentName && (
                <div className="mt-1.5 flex items-center gap-1 text-[11px] font-medium text-slate-600 dark:text-slate-300">
                  <FileText className="w-3 h-3 shrink-0" />
                  <span className="truncate">{msg.attachmentName}</span>
                </div>
              )}

              {showDeliveryWarning && (
                <div
                  className={`mt-1.5 flex items-start gap-1 rounded px-2 py-1 text-[10px] ${
                    msg.deliveryStatus === 'failed'
                      ? 'bg-red-100/80 text-red-800 dark:bg-red-950/70 dark:text-red-300'
                      : 'bg-amber-100/80 text-amber-900 dark:bg-amber-950/70 dark:text-amber-300'
                  }`}
                >
                  <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
                  <span>
                    {msg.deliveryDetail ||
                      (msg.deliveryStatus === 'failed' ? 'Falha no envio externo.' : 'Aguardando conexão do provedor.')}
                  </span>
                </div>
              )}

              {msg.contentType === 'audio' && (
                <div className="mt-2 pt-2 border-t border-slate-100 dark:border-slate-800 space-y-1.5">
                  {msg.mediaSha256 && <DockBucketAudio sha256={msg.mediaSha256} />}
                  {msg.iviAudioTranscript ? (
                    <div className="rounded-lg bg-blue-50/80 dark:bg-blue-950/60 border border-blue-100 dark:border-blue-800/70 p-2 text-[11px] text-blue-950 dark:text-blue-100">
                      <div className="flex items-center gap-1 font-semibold text-blue-800 dark:text-blue-300 mb-0.5">
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
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-700 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300"
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
                  className="inline-flex items-center gap-1 text-[10px] font-medium text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
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
        <div className="border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 p-3 space-y-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="font-bold text-slate-800 dark:text-slate-100">Disparar Template HSM (GoTalk)</span>
            <button
              type="button"
              onClick={() => setShowTemplatePicker(false)}
              className="text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          {templates.length === 0 ? (
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              Sincronize os templates em Configurações &amp; SQL → WhatsApp GoTalk Oficial primeiro.
            </div>
          ) : (
            <>
              <select
                value={selectedTplName}
                onChange={(e) => {
                  setSelectedTplName(e.target.value);
                  setTplVars({});
                }}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 px-2.5 py-1.5 text-xs"
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
                        className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 px-2.5 py-1.5 text-xs"
                      />
                    ))}
                    <div className="rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-2 text-[11px] text-slate-700 dark:text-slate-200 whitespace-pre-wrap">
                      {(tpl.bodyText || tpl.templateName).replace(/\{\{(\d+)\}\}/g, (_, n) => tplVars[n] || `{{${n}}}`)}
                    </div>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          const res = await apiFetch<{ gotalkDelivery?: { dispatched?: boolean; detail?: string } }>(
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
                            showNotice(res.gotalkDelivery.detail, res.gotalkDelivery.dispatched === false);
                          }
                          await loadThreads();
                        } catch (err) {
                          showNotice(err instanceof Error ? err.message : 'Erro ao enviar template HSM.', true);
                        } finally {
                          setBusy(false);
                        }
                      }}
                      className="w-full rounded-lg bg-emerald-600 px-3 py-1.5 font-semibold text-white hover:bg-emerald-700 dark:hover:bg-emerald-500"
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
      <form onSubmit={handleSend} className="p-3 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex gap-1.5">
        <label
          title="Enviar PDF, imagem ou áudio (GoTalk / UaZapi)"
          className="inline-flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 min-h-[40px] cursor-pointer"
        >
          <Paperclip className="w-4 h-4" />
          <input type="file" className="hidden" disabled={busy || !activeThread} onChange={handleUploadFile} />
        </label>
        {templates.length > 0 && activeThread?.provider === 'gotalk' && (
          <button
            type="button"
            onClick={() => setShowTemplatePicker((s) => !s)}
            title="Enviar Template HSM GoTalk"
            className="inline-flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 min-h-[40px]"
          >
            <FileText className="w-4 h-4" />
          </button>
        )}
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Responder via GoTalk / UaZapi..."
          className="flex-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:bg-white dark:focus:bg-slate-900 focus:border-emerald-600 focus:outline-none min-h-[40px]"
        />
        <button
          type="submit"
          disabled={busy || !draft.trim() || !activeThread}
          aria-label="Enviar mensagem"
          className="inline-flex items-center justify-center rounded-lg bg-emerald-600 px-3.5 text-white hover:bg-emerald-700 dark:hover:bg-emerald-500 disabled:opacity-50 min-h-[40px]"
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
        <div className="xl:hidden fixed inset-0 z-50 flex justify-end bg-slate-900/40 dark:bg-slate-950/75 backdrop-blur-xs">
          <div className="flex-1" onClick={onCloseMobile} />
          <div className="w-full max-w-sm h-full shadow-2xl">{content}</div>
        </div>
      )}
    </>
  );
};
