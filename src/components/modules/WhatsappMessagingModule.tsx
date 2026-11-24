import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCheck,
  Copy,
  Download,
  FileText,
  Headphones,
  MessageSquare,
  Mic,
  Paperclip,
  Phone,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings,
  Sparkles,
  Volume2,
  X,
} from 'lucide-react';
import { apiFetch, formatDateTimeBR, getActiveUnitHeader, getAuthToken, parseJsonResponse } from '../../lib/api.ts';
import {
  AuthUser,
  Client,
  GotalkChannelPublic,
  GotalkHsmTemplate,
  ModuleId,
  NavigationIntent,
  UazapiInstancePublic,
  Unit,
  WhatsappMessage,
  WhatsappThread,
} from '../../types.ts';

interface GotalkStatusBrief {
  configured: boolean;
  source?: string;
  authenticated: boolean;
  baseUrl: string;
  lastError?: string | null;
}

interface UazapiRuntimeBrief {
  adminTokenConfigured?: boolean;
  defaultServerUrl?: string;
  webhookSecretConfigured?: boolean;
  lastWebhookAt?: string | null;
}

interface WhatsappThreadsPayload {
  threads: WhatsappThread[];
  messages: WhatsappMessage[];
  instances?: UazapiInstancePublic[];
  channels?: GotalkChannelPublic[];
  gotalkStatus?: GotalkStatusBrief;
  uazapiRuntime?: UazapiRuntimeBrief;
}

const WorkspaceBucketAudio: React.FC<{ sha256: string }> = ({ sha256 }) => {
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
      className="mt-1 inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 hover:text-emerald-800 dark:text-emerald-300 dark:hover:text-emerald-200"
    >
      <Volume2 className="w-3.5 h-3.5" />
      {loading ? 'Carregando áudio...' : 'Ouvir áudio arquivado'}
    </button>
  );
};

interface WhatsappMessagingModuleProps {
  currentUser: AuthUser;
  units: Unit[];
  activeUnitId: number;
  wsTick: number;
  navIntent: NavigationIntent | null;
  onClearIntent: () => void;
  onNavigate: (mod: ModuleId, intent?: NavigationIntent) => void;
  onUnreadCountChange?: (count: number) => void;
  onCopyToClipboard?: (text: string) => void;
}

export const WhatsappMessagingModule: React.FC<WhatsappMessagingModuleProps> = ({
  currentUser,
  units,
  activeUnitId,
  wsTick,
  navIntent,
  onClearIntent,
  onNavigate,
  onUnreadCountChange,
  onCopyToClipboard,
}) => {
  const isAdmin = currentUser.role === 'admin';
  const [threads, setThreads] = useState<WhatsappThread[]>([]);
  const [messages, setMessages] = useState<WhatsappMessage[]>([]);
  const [instances, setInstances] = useState<UazapiInstancePublic[]>([]);
  const [channels, setChannels] = useState<GotalkChannelPublic[]>([]);
  const [templates, setTemplates] = useState<GotalkHsmTemplate[]>([]);
  const [gotalkStatus, setGotalkStatus] = useState<GotalkStatusBrief | null>(null);
  const [uazapiRuntime, setUazapiRuntime] = useState<UazapiRuntimeBrief | null>(null);
  const [loading, setLoading] = useState(true);

  const [activeThreadId, setActiveThreadId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'unread' | 'gotalk' | 'uazapi'>('all');

  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [banner, setBanner] = useState<{ kind: 'info' | 'warn' | 'error'; text: string } | null>(null);

  // HSM Template Modal/Drawer
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [selectedTplName, setSelectedTplName] = useState('');
  const [tplVars, setTplVars] = useState<Record<string, string>>({});

  // New Conversation Modal
  const [newModalOpen, setNewModalOpen] = useState(false);
  const [newUnitId, setNewUnitId] = useState<number>(activeUnitId || units[0]?.id || 1);
  const [newProvider, setNewProvider] = useState<'uazapi' | 'gotalk'>('uazapi');
  const [newInstanceId, setNewInstanceId] = useState('');
  const [newChannelDbId, setNewChannelDbId] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newName, setNewName] = useState('');
  const [newClientId, setNewClientId] = useState<number | null>(null);
  const [clientLookup, setClientLookup] = useState('');
  const [clientOptions, setClientOptions] = useState<Client[]>([]);
  const [creatingThread, setCreatingThread] = useState(false);

  const showToast = useCallback((kind: 'info' | 'warn' | 'error', text: string) => {
    setBanner({ kind, text });
    window.setTimeout(() => {
      setBanner((prev) => (prev?.text === text ? null : prev));
    }, 5500);
  }, []);

  const loadData = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const [data, resData] = await Promise.all([
          apiFetch<WhatsappThreadsPayload>('/api/whatsapp/threads', { passive: silent }),
          apiFetch<{ templates: GotalkHsmTemplate[] }>('/api/integrations/gotalk/resources', { passive: true }).catch(() => ({
            templates: [],
          })),
        ]);
        const nextThreads = data.threads || [];
        setThreads(nextThreads);
        setMessages(data.messages || []);
        setInstances(data.instances || []);
        setChannels(data.channels || []);
        setGotalkStatus(data.gotalkStatus || null);
        setUazapiRuntime(data.uazapiRuntime || null);
        setTemplates(resData.templates || []);

        if (onUnreadCountChange) {
          const totalUnread = nextThreads.reduce((acc, t) => acc + (t.unreadCount || 0), 0);
          onUnreadCountChange(totalUnread);
        }

        setActiveThreadId((prev) => {
          if (prev && nextThreads.some((t) => t.id === prev)) return prev;
          return nextThreads[0]?.id ?? null;
        });
      } catch (err) {
        showToast('error', err instanceof Error ? err.message : 'Erro ao carregar conversas WhatsApp.');
      } finally {
        setLoading(false);
      }
    },
    [onUnreadCountChange, showToast]
  );

  useEffect(() => {
    loadData(false);
  }, [wsTick, loadData]);

  // Apply NavigationIntent (e.g. open specific client phone/unit)
  useEffect(() => {
    if (!navIntent) return;
    if (navIntent.clientPhone) {
      setNewPhone(navIntent.clientPhone);
      setNewName(navIntent.clientName || '');
      setNewClientId(navIntent.clientId || null);
      setNewUnitId(navIntent.unitId || activeUnitId || units[0]?.id || 1);
      setNewModalOpen(true);
    }
    onClearIntent();
  }, [navIntent, activeUnitId, units, onClearIntent]);

  // Client lookup inside New Conversation Modal
  useEffect(() => {
    if (!newModalOpen) return;
    const q = clientLookup.trim();
    const timer = window.setTimeout(async () => {
      try {
        const res = await apiFetch<{ clients: Client[] }>(
          `/api/clients?search=${encodeURIComponent(q)}&limit=12`,
          { passive: true }
        );
        setClientOptions(res.clients || []);
      } catch {
        setClientOptions([]);
      }
    }, 220);
    return () => window.clearTimeout(timer);
  }, [newModalOpen, clientLookup]);

  const markThreadRead = useCallback(
    async (thread: WhatsappThread) => {
      if (!thread.unreadCount) return;
      setThreads((prev) => prev.map((t) => (t.id === thread.id ? { ...t, unreadCount: 0 } : t)));
      try {
        await apiFetch(`/api/whatsapp/threads/${thread.id}/read`, { method: 'POST', passive: true });
      } catch {
        // non-fatal
      }
    },
    []
  );

  const handleSelectThread = (t: WhatsappThread) => {
    setActiveThreadId(t.id);
    setShowTemplatePicker(false);
    void markThreadRead(t);
  };

  const filteredThreads = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return threads.filter((t) => {
      if (filterMode === 'unread' && (t.unreadCount || 0) <= 0) return false;
      if (filterMode === 'gotalk' && t.provider !== 'gotalk') return false;
      if (filterMode === 'uazapi' && t.provider !== 'uazapi') return false;
      if (!q) return true;
      return (
        t.contactName.toLowerCase().includes(q) ||
        t.contactPhone.toLowerCase().includes(q) ||
        (t.lastMessagePreview || '').toLowerCase().includes(q) ||
        (t.uazapiInstanceId || '').toLowerCase().includes(q)
      );
    });
  }, [threads, searchQuery, filterMode]);

  const activeThread = useMemo(
    () => threads.find((t) => t.id === activeThreadId) || filteredThreads[0] || null,
    [threads, activeThreadId, filteredThreads]
  );

  const threadMessages = useMemo(
    () => (activeThread ? messages.filter((m) => m.threadId === activeThread.id) : []),
    [messages, activeThread]
  );

  const connectedInstancesCount = useMemo(
    () => instances.filter((i) => i.isConnected).length,
    [instances]
  );

  const unitLabelMap = useMemo(() => new Map(units.map((u) => [u.id, `${u.code} · ${u.name}`])), [units]);
  const instanceMap = useMemo(
    () => new Map(instances.map((i) => [i.uazapiInstanceId, i])),
    [instances]
  );
  const channelMap = useMemo(() => new Map(channels.map((c) => [c.id, c])), [channels]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await apiFetch<{
        ok: boolean;
        uazapi?: { instancesChecked: number; connectedCount: number; threadsSynced: number; messagesSynced: number };
        gotalk?: { configured: boolean; synced: { channelsSynced: number; templatesSynced: number } | null; error: string | null };
      }>('/api/whatsapp/sync', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      const uazMsg = res.uazapi
        ? `UaZapi: ${res.uazapi.connectedCount}/${res.uazapi.instancesChecked} online, ${res.uazapi.threadsSynced} chat(s), ${res.uazapi.messagesSynced} nova(s) mensagem(ns).`
        : '';
      const gtMsg = res.gotalk?.configured
        ? res.gotalk.error
          ? `GoTalk: ${res.gotalk.error}`
          : `GoTalk sincronizado (${res.gotalk.synced?.channelsSynced || 0} canais).`
        : 'GoTalk não autenticado (configure credenciais se desejar usar).';
      showToast(res.gotalk?.error ? 'warn' : 'info', `${uazMsg} ${gtMsg}`.trim());
      await loadData(true);
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Falha na sincronização WhatsApp.');
    } finally {
      setSyncing(false);
    }
  };

  const handleUpdateThreadRouting = async (patch: {
    provider?: 'gotalk' | 'uazapi';
    uazapiInstanceId?: string | null;
    channelDbId?: number | null;
  }) => {
    if (!activeThread) return;
    setBusy(true);
    try {
      const res = await apiFetch<{ ok: boolean; thread: WhatsappThread }>(`/api/whatsapp/threads/${activeThread.id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      setThreads((prev) => prev.map((t) => (t.id === res.thread.id ? res.thread : t)));
      showToast(
        'info',
        `Canal da conversa salvo para ${res.thread.provider.toUpperCase()}${
          res.thread.provider === 'uazapi' && res.thread.uazapiInstanceId
            ? ` (${instanceMap.get(res.thread.uazapiInstanceId)?.label || res.thread.uazapiInstanceId})`
            : ''
        }.`
      );
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Erro ao alterar provedor/instância da conversa.');
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
        delivery?: { dispatched: boolean; provider: string; detail?: string } | null;
      }>(`/api/whatsapp/threads/${activeThread.id}/messages`, {
        method: 'POST',
        body: JSON.stringify({ body: draft, contentType: 'text', direction: 'outbound' }),
      });
      setDraft('');
      if (res.delivery) {
        showToast(res.delivery.dispatched ? 'info' : 'warn', res.delivery.detail || 'Mensagem registrada.');
      }
      await loadData(true);
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Erro ao enviar mensagem WhatsApp.');
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
      const data = await parseJsonResponse<{ delivery?: { dispatched?: boolean; detail?: string } }>(
        resp,
        'Falha ao enviar anexo.'
      );
      setDraft('');
      showToast(
        data.delivery?.dispatched === false ? 'warn' : 'info',
        data.delivery?.detail || `Anexo "${file.name}" enviado.`
      );
      await loadData(true);
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Falha ao enviar anexo.');
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
      await loadData(true);
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Erro ao registrar áudio.');
    } finally {
      setBusy(false);
    }
  };

  const handleTranscribe = async (msgId: number) => {
    setBusy(true);
    try {
      await apiFetch(`/api/whatsapp/messages/${msgId}/transcribe`, { method: 'POST' });
      await loadData(true);
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Erro ao transcrever áudio.');
    } finally {
      setBusy(false);
    }
  };

  const handleCreateConversation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPhone.trim()) {
      showToast('error', 'Informe o telefone WhatsApp com DDD.');
      return;
    }
    setCreatingThread(true);
    try {
      const res = await apiFetch<{ thread: WhatsappThread; created: boolean }>('/api/whatsapp/threads', {
        method: 'POST',
        body: JSON.stringify({
          unitId: newUnitId,
          provider: newProvider,
          contactPhone: newPhone.trim(),
          contactName: newName.trim() || newPhone.trim(),
          clientId: newClientId,
          uazapiInstanceId: newProvider === 'uazapi' && newInstanceId ? newInstanceId : undefined,
          channelDbId: newProvider === 'gotalk' && newChannelDbId ? Number(newChannelDbId) : undefined,
        }),
      });
      setNewModalOpen(false);
      setNewPhone('');
      setNewName('');
      setNewClientId(null);
      setActiveThreadId(res.thread.id);
      await loadData(true);
      showToast('info', res.created ? 'Conversa WhatsApp iniciada.' : 'Conversa existente selecionada.');
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Erro ao iniciar conversa.');
    } finally {
      setCreatingThread(false);
    }
  };

  const handleDownloadAttachment = async (msg: WhatsappMessage) => {
    if (!msg.attachmentUrl) return;
    try {
      const resp = await fetch(msg.attachmentUrl, {
        headers: { Authorization: `Bearer ${getAuthToken()}` },
      });
      if (!resp.ok) throw new Error('Falha ao baixar arquivo do Bucket.');
      const blob = await resp.blob();
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objUrl;
      a.download = msg.attachmentName || `anexo-${msg.id}`;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(objUrl), 5000);
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Erro ao baixar arquivo.');
    }
  };

  const totalUnread = useMemo(
    () => threads.reduce((acc, t) => acc + (t.unreadCount || 0), 0),
    [threads]
  );

  return (
    <div className="space-y-4">
      {/* Header Bar */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-3.5 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <h1 className="font-display text-lg font-bold text-slate-900 dark:text-slate-100 truncate">
              Mensageria · WhatsApp Corporativo
            </h1>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 tabular-nums">
            <span>
              UaZapi:{' '}
              <strong className={connectedInstancesCount > 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}>
                {connectedInstancesCount}/{instances.length} conectada(s)
              </strong>
            </span>
            {' · '}
            <span>
              GoTalk:{' '}
              <strong className={gotalkStatus?.configured ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}>
                {gotalkStatus?.authenticated
                  ? 'Autenticado'
                  : gotalkStatus?.configured
                  ? 'Credenciais salvas'
                  : 'Não configurado'}
              </strong>
            </span>
            {' · '}
            <span>{threads.length} conversa(s)</span>
            {totalUnread > 0 && (
              <>
                {' · '}
                <span className="font-semibold text-rose-600 dark:text-rose-400">{totalUnread} não lida(s)</span>
              </>
            )}
            {uazapiRuntime?.lastWebhookAt && (
              <>
                {' · '}
                <span>Último webhook: {formatDateTimeBR(uazapiRuntime.lastWebhookAt)}</span>
              </>
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            disabled={syncing}
            onClick={handleSync}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Sincronizando...' : 'Sincronizar GoTalk & UaZapi'}
          </button>

          <button
            type="button"
            onClick={() => {
              setNewUnitId(activeUnitId || units[0]?.id || 1);
              setNewProvider(connectedInstancesCount > 0 || !gotalkStatus?.configured ? 'uazapi' : 'gotalk');
              setNewModalOpen(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-700 dark:hover:bg-emerald-500"
          >
            <Plus className="w-3.5 h-3.5" />
            Nova Conversa
          </button>

          {isAdmin && (
            <button
              type="button"
              onClick={() => onNavigate('config', { tab: gotalkStatus?.configured ? 'uazapi' : 'gotalk' })}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700"
            >
              <Settings className="w-3.5 h-3.5" />
              Configurar Canais
            </button>
          )}
        </div>
      </div>

      {/* Diagnostic Banner when neither provider has an active connection */}
      {(!gotalkStatus?.configured && connectedInstancesCount === 0) && (
        <div className="rounded-xl border border-amber-200 dark:border-amber-800/70 bg-amber-50 dark:bg-amber-950/40 px-4 py-3 text-xs text-amber-900 dark:text-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div>
              <strong>Nenhum provedor externo autenticado no momento:</strong> configure login/senha GoTalk ou conecte uma instância UaZapi via QR Code para enviar mensagens reais. Mensagens enviadas agora ficam registradas na fila local do banco de dados.
            </div>
          </div>
          {isAdmin && (
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => onNavigate('config', { tab: 'gotalk' })}
                className="rounded-lg border border-amber-300 dark:border-amber-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 font-semibold text-amber-900 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-slate-800"
              >
                Credenciais GoTalk
              </button>
              <button
                type="button"
                onClick={() => onNavigate('config', { tab: 'uazapi' })}
                className="rounded-lg border border-amber-300 dark:border-amber-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 font-semibold text-amber-900 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-slate-800"
              >
                Instâncias UaZapi
              </button>
            </div>
          )}
        </div>
      )}

      {banner && (
        <div
          className={`rounded-xl border px-4 py-2.5 text-xs font-medium flex items-center justify-between gap-2 ${
            banner.kind === 'error'
              ? 'border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/50 text-rose-800 dark:text-rose-200'
              : banner.kind === 'warn'
              ? 'border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/50 text-amber-900 dark:text-amber-200'
              : 'border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-900 dark:text-emerald-200'
          }`}
        >
          <span>{banner.text}</span>
          <button type="button" onClick={() => setBanner(null)} className="opacity-70 hover:opacity-100">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* 2-Pane Split Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 min-h-[600px]">
        {/* Left Thread List */}
        <div className="lg:col-span-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col overflow-hidden h-[660px]">
          <div className="p-3 border-b border-slate-100 dark:border-slate-800 space-y-2.5">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar contato, telefone ou prévia..."
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 pl-8 pr-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:bg-white dark:focus:bg-slate-900 focus:outline-none focus:border-emerald-600"
              />
            </div>
            <div className="grid grid-cols-4 gap-1 rounded-lg bg-slate-100 dark:bg-slate-800 p-1 text-[11px] font-semibold">
              {(
                [
                  { id: 'all', label: 'Todas' },
                  { id: 'unread', label: `Não lidas` },
                  { id: 'gotalk', label: 'GoTalk' },
                  { id: 'uazapi', label: 'UaZapi' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setFilterMode(tab.id)}
                  className={`rounded-md py-1 transition-colors ${
                    filterMode === tab.id
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
            {loading && threads.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500 dark:text-slate-400">
                Carregando conversas persistidas...
              </div>
            ) : filteredThreads.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500 dark:text-slate-400 space-y-2">
                <p>Nenhuma conversa encontrada neste filtro.</p>
                <button
                  type="button"
                  onClick={() => setNewModalOpen(true)}
                  className="inline-flex items-center gap-1 font-semibold text-emerald-700 dark:text-emerald-400 hover:underline"
                >
                  <Plus className="w-3.5 h-3.5" /> Iniciar primeira conversa
                </button>
              </div>
            ) : (
              filteredThreads.map((t) => {
                const isSelected = t.id === activeThread?.id;
                const instInfo = t.uazapiInstanceId ? instanceMap.get(t.uazapiInstanceId) : null;
                const chInfo = t.channelDbId ? channelMap.get(t.channelDbId) : null;
                const channelLabel =
                  t.provider === 'uazapi'
                    ? instInfo?.label || t.uazapiInstanceId || 'UaZapi padrão'
                    : chInfo?.name || 'Canal GoTalk';

                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => handleSelectThread(t)}
                    className={`w-full text-left px-3.5 py-3 transition-colors ${
                      isSelected
                        ? 'bg-emerald-50/80 dark:bg-emerald-950/40'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-semibold text-xs text-slate-900 dark:text-slate-100 truncate">
                        {t.contactName}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {(t.unreadCount || 0) > 0 && (
                          <span className="font-mono text-[11px] font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">
                            ({t.unreadCount})
                          </span>
                        )}
                        <span className="font-mono text-[10px] text-slate-400 dark:text-slate-500 tabular-nums">
                          {formatDateTimeBR(t.updatedAt)}
                        </span>
                      </div>
                    </div>
                    <div className="mt-0.5 text-[11px] font-mono text-slate-500 dark:text-slate-400 truncate">
                      {t.contactPhone} · {t.provider.toUpperCase()} · {channelLabel}
                    </div>
                    <div className="mt-1 text-xs text-slate-600 dark:text-slate-300 truncate">
                      {t.lastMessagePreview || 'Sem mensagens'}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Right Active Conversation */}
        <div className="lg:col-span-8 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col overflow-hidden h-[660px]">
          {!activeThread ? (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-xs text-slate-500 dark:text-slate-400 space-y-2">
              <MessageSquare className="w-8 h-8 text-slate-300 dark:text-slate-700" />
              <div className="font-semibold text-slate-700 dark:text-slate-200">Selecione ou inicie uma conversa</div>
              <p className="max-w-sm">
                Todas as mensagens e escolhas de canal (GoTalk ou UaZapi) são gravadas no banco de dados e sincronizadas em tempo real.
              </p>
            </div>
          ) : (
            <>
              {/* Active Thread Header with Persistent Provider/Instance/Channel Switcher */}
              <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
                      {activeThread.contactName}
                    </h2>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard?.writeText(activeThread.contactPhone).catch(() => {});
                        showToast('info', 'Telefone copiado.');
                      }}
                      className="inline-flex items-center gap-1 font-mono text-[11px] text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 tabular-nums"
                    >
                      <Phone className="w-3 h-3" />
                      {activeThread.contactPhone}
                    </button>
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                    Unidade: {unitLabelMap.get(activeThread.unitId) || `#${activeThread.unitId}`}
                    {activeThread.operatorName ? ` · Operador: ${activeThread.operatorName}` : ''}
                    {activeThread.department ? ` · Setor: ${activeThread.department}` : ''}
                  </div>
                </div>

                {/* Persistent Provider & Channel Selector */}
                <div className="flex flex-wrap items-center gap-2 shrink-0 text-xs">
                  <select
                    aria-label="Provedor WhatsApp da conversa"
                    disabled={busy}
                    value={activeThread.provider === 'uazapi' ? 'uazapi' : 'gotalk'}
                    onChange={(e) => {
                      const next = e.target.value === 'uazapi' ? 'uazapi' : 'gotalk';
                      void handleUpdateThreadRouting({ provider: next });
                    }}
                    className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 font-semibold text-slate-800 dark:text-slate-100"
                  >
                    <option value="uazapi">UaZapi V2</option>
                    <option value="gotalk">GoTalk Oficial</option>
                  </select>

                  {activeThread.provider === 'uazapi' ? (
                    <select
                      aria-label="Instância UaZapi da conversa"
                      disabled={busy}
                      value={activeThread.uazapiInstanceId || ''}
                      onChange={(e) =>
                        void handleUpdateThreadRouting({
                          provider: 'uazapi',
                          uazapiInstanceId: e.target.value || null,
                        })
                      }
                      className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs text-slate-700 dark:text-slate-200 max-w-[200px]"
                    >
                      <option value="">Automático da Unidade</option>
                      {instances.map((inst) => (
                        <option key={inst.id} value={inst.uazapiInstanceId}>
                          {inst.label} {inst.isConnected ? '(Online)' : '(Offline)'}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <select
                      aria-label="Canal GoTalk da conversa"
                      disabled={busy}
                      value={activeThread.channelDbId ? String(activeThread.channelDbId) : ''}
                      onChange={(e) =>
                        void handleUpdateThreadRouting({
                          provider: 'gotalk',
                          channelDbId: e.target.value ? Number(e.target.value) : null,
                        })
                      }
                      className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs text-slate-700 dark:text-slate-200 max-w-[200px]"
                    >
                      <option value="">Canal Principal GoTalk</option>
                      {channels.map((ch) => (
                        <option key={ch.id} value={String(ch.id)}>
                          {ch.name}
                          {ch.phoneNumber ? ` (${ch.phoneNumber})` : ''}
                        </option>
                      ))}
                    </select>
                  )}

                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleSimulateInboundAudio}
                    title="Simular recebimento de áudio para transcrição Ivi"
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700"
                  >
                    <Mic className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                    Teste Áudio
                  </button>
                </div>
              </div>

              {/* Message Timeline */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50/50 dark:bg-slate-950/60">
                {threadMessages.length === 0 ? (
                  <div className="py-12 text-center text-xs text-slate-500 dark:text-slate-400">
                    Nenhuma mensagem registrada nesta conversa ainda. Envie uma mensagem abaixo.
                  </div>
                ) : (
                  threadMessages.map((msg) => {
                    const isOutbound = msg.direction === 'outbound';
                    const isFailed = msg.deliveryStatus === 'failed';
                    const isQueued = msg.deliveryStatus === 'queued';
                    return (
                      <div
                        key={msg.id}
                        className={`rounded-xl border p-3 text-xs max-w-[85%] ${
                          isOutbound
                            ? 'ml-auto border-emerald-200 dark:border-emerald-800/70 bg-emerald-50/80 dark:bg-emerald-950/40 text-slate-900 dark:text-slate-100'
                            : 'mr-auto border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-4 text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                          <span className="font-semibold text-slate-700 dark:text-slate-200">{msg.senderName}</span>
                          <span className="font-mono flex items-center gap-1 tabular-nums">
                            {formatDateTimeBR(msg.createdAt)}
                            {isOutbound && msg.ackStatus === 1 && <Check className="w-3.5 h-3.5 text-slate-400" />}
                            {isOutbound && msg.ackStatus === 2 && <CheckCheck className="w-3.5 h-3.5 text-slate-500" />}
                            {isOutbound && msg.ackStatus === 3 && <CheckCheck className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />}
                          </span>
                        </div>

                        {msg.deletedInOrigin && (
                          <div className="mb-1 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                            Apagada na origem (preservada no CRM)
                          </div>
                        )}

                        <p className="leading-relaxed whitespace-pre-wrap">{msg.body}</p>

                        {msg.attachmentName && (
                          <div className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-slate-200/80 dark:border-slate-700 bg-white/70 dark:bg-slate-800/70 px-2.5 py-1.5 text-[11px]">
                            <span className="inline-flex items-center gap-1.5 font-medium text-slate-700 dark:text-slate-200 truncate">
                              <FileText className="w-3.5 h-3.5 shrink-0" />
                              <span className="truncate">{msg.attachmentName}</span>
                            </span>
                            {msg.attachmentUrl && (
                              <button
                                type="button"
                                onClick={() => handleDownloadAttachment(msg)}
                                className="inline-flex items-center gap-1 font-semibold text-emerald-700 dark:text-emerald-400 hover:underline shrink-0"
                              >
                                <Download className="w-3 h-3" /> Baixar
                              </button>
                            )}
                          </div>
                        )}

                        {msg.contentType === 'audio' && (
                          <div className="mt-2 pt-2 border-t border-slate-200/70 dark:border-slate-800 space-y-1.5">
                            {msg.mediaSha256 && <WorkspaceBucketAudio sha256={msg.mediaSha256} />}
                            {msg.iviAudioTranscript ? (
                              <div className="rounded-lg bg-blue-50/80 dark:bg-blue-950/50 border border-blue-100 dark:border-blue-800/70 p-2 text-[11px] text-blue-950 dark:text-blue-100">
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
                                className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-700 dark:text-blue-400 hover:underline"
                              >
                                <Headphones className="w-3 h-3" /> Transcrever áudio com Ivi
                              </button>
                            )}
                          </div>
                        )}

                        {(isFailed || isQueued) && (
                          <div
                            className={`mt-2 pt-1.5 border-t text-[11px] flex items-start gap-1.5 ${
                              isFailed
                                ? 'border-rose-200/70 dark:border-rose-800/60 text-rose-700 dark:text-rose-300'
                                : 'border-amber-200/70 dark:border-amber-800/60 text-amber-800 dark:text-amber-300'
                            }`}
                          >
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                            <span>
                              <strong>{isFailed ? 'Falha no disparo:' : 'Salva em fila local:'}</strong>{' '}
                              {msg.deliveryDetail || 'Provedor não conectado no momento do envio.'}
                            </span>
                          </div>
                        )}

                        <div className="mt-1.5 flex items-center justify-between gap-2 text-[10px] text-slate-400 dark:text-slate-500">
                          <span className="font-mono">{msg.deliveryProvider || activeThread.provider}</span>
                          <button
                            type="button"
                            onClick={() => {
                              const txt = msg.iviAudioTranscript || msg.body;
                              navigator.clipboard?.writeText(txt).catch(() => {});
                              onCopyToClipboard?.(txt);
                              showToast('info', 'Texto copiado.');
                            }}
                            className="inline-flex items-center gap-1 font-medium text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                          >
                            <Copy className="w-3 h-3" /> Copiar
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* GoTalk HSM Template Drawer */}
              {showTemplatePicker && activeThread.provider === 'gotalk' && (
                <div className="border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 p-3 space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-800 dark:text-slate-100">Disparar Template HSM (GoTalk)</span>
                    <button
                      type="button"
                      onClick={() => setShowTemplatePicker(false)}
                      className="text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  {templates.length === 0 ? (
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      Nenhum template HSM sincronizado ainda. Autentique e sincronize na aba GoTalk em Configurações.
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
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              {vars.map((v) => (
                                <input
                                  key={v}
                                  type="text"
                                  placeholder={`Variável {{${v}}}`}
                                  value={tplVars[v] || ''}
                                  onChange={(e) => setTplVars((prev) => ({ ...prev, [v]: e.target.value }))}
                                  className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 px-2.5 py-1.5 text-xs"
                                />
                              ))}
                            </div>
                            <div className="rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-2 text-[11px] text-slate-700 dark:text-slate-200 whitespace-pre-wrap">
                              {(tpl.bodyText || tpl.templateName).replace(/\{\{(\d+)\}\}/g, (_, n) => tplVars[n] || `{{${n}}}`)}
                            </div>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={async () => {
                                setBusy(true);
                                try {
                                  const res = await apiFetch<{
                                    gotalkDelivery?: { dispatched?: boolean; detail?: string };
                                  }>('/api/integrations/gotalk/send-template', {
                                    method: 'POST',
                                    body: JSON.stringify({
                                      threadId: activeThread.id,
                                      templateName: tpl.templateName,
                                      variables: tplVars,
                                    }),
                                  });
                                  setShowTemplatePicker(false);
                                  if (res.gotalkDelivery?.detail) {
                                    showToast(
                                      res.gotalkDelivery.dispatched ? 'info' : 'warn',
                                      res.gotalkDelivery.detail
                                    );
                                  }
                                  await loadData(true);
                                } catch (err) {
                                  showToast('error', err instanceof Error ? err.message : 'Erro ao disparar template HSM.');
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
              <form onSubmit={handleSend} className="p-3 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex gap-2">
                <label
                  title="Enviar PDF, imagem ou áudio"
                  className="inline-flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 min-h-[40px] cursor-pointer"
                >
                  <Paperclip className="w-4 h-4" />
                  <input type="file" className="hidden" disabled={busy} onChange={handleUploadFile} />
                </label>

                {activeThread.provider === 'gotalk' && (
                  <button
                    type="button"
                    onClick={() => setShowTemplatePicker((s) => !s)}
                    title="Template HSM GoTalk"
                    className="inline-flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 min-h-[40px]"
                  >
                    <FileText className="w-4 h-4" />
                  </button>
                )}

                <input
                  type="text"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={`Escrever mensagem via ${activeThread.provider === 'uazapi' ? 'UaZapi V2' : 'GoTalk'}...`}
                  className="flex-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:bg-white dark:focus:bg-slate-900 focus:border-emerald-600 focus:outline-none min-h-[40px]"
                />

                <button
                  type="submit"
                  disabled={busy || !draft.trim()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 min-h-[40px]"
                >
                  <Send className="w-3.5 h-3.5" />
                  Enviar
                </button>
              </form>
            </>
          )}
        </div>
      </div>

      {/* Nova Conversa Modal */}
      {newModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 dark:bg-slate-950/80 p-4"
          onClick={() => setNewModalOpen(false)}
        >
          <form
            onSubmit={handleCreateConversation}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 shadow-2xl space-y-4 text-xs"
          >
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                Nova Conversa WhatsApp
              </h3>
              <button
                type="button"
                onClick={() => setNewModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 dark:hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-200 mb-1">
                  Buscar Cliente Cadastrado (Opcional)
                </label>
                <input
                  type="text"
                  value={clientLookup}
                  onChange={(e) => setClientLookup(e.target.value)}
                  placeholder="Digite nome ou CPF para preencher..."
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
                />
                {clientOptions.length > 0 && clientLookup.trim() && (
                  <div className="mt-1 max-h-32 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-900">
                    {clientOptions.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => {
                          setNewClientId(c.id);
                          setNewName(c.fullName);
                          setNewPhone(c.whatsapp || c.phone || '');
                          if (c.unitId) setNewUnitId(c.unitId);
                          setClientLookup('');
                        }}
                        className="w-full text-left px-3 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center justify-between gap-2"
                      >
                        <span className="font-medium text-slate-800 dark:text-slate-100 truncate">{c.fullName}</span>
                        <span className="font-mono text-[11px] text-slate-500">{c.whatsapp || c.phone}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-200 mb-1">Telefone / WhatsApp *</label>
                  <input
                    type="text"
                    required
                    value={newPhone}
                    onChange={(e) => setNewPhone(e.target.value)}
                    placeholder="Ex: 81999990000"
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 font-mono text-slate-900 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-200 mb-1">Nome do Contato</label>
                  <input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="Nome do cliente ou lead"
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-slate-900 dark:text-slate-100"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-200 mb-1">Unidade</label>
                  <select
                    value={newUnitId}
                    onChange={(e) => setNewUnitId(Number(e.target.value))}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-2 text-slate-900 dark:text-slate-100"
                  >
                    {units.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.code} · {u.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-200 mb-1">Provedor</label>
                  <select
                    value={newProvider}
                    onChange={(e) => setNewProvider(e.target.value === 'gotalk' ? 'gotalk' : 'uazapi')}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-2 text-slate-900 dark:text-slate-100"
                  >
                    <option value="uazapi">UaZapi V2</option>
                    <option value="gotalk">GoTalk Oficial</option>
                  </select>
                </div>
              </div>

              {newProvider === 'uazapi' ? (
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-200 mb-1">Instância UaZapi</label>
                  <select
                    value={newInstanceId}
                    onChange={(e) => setNewInstanceId(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-2 text-slate-900 dark:text-slate-100"
                  >
                    <option value="">Automático da Unidade</option>
                    {instances.map((inst) => (
                      <option key={inst.id} value={inst.uazapiInstanceId}>
                        {inst.label} {inst.isConnected ? '(Online)' : '(Offline)'}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-200 mb-1">Canal GoTalk</label>
                  <select
                    value={newChannelDbId}
                    onChange={(e) => setNewChannelDbId(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-2 text-slate-900 dark:text-slate-100"
                  >
                    <option value="">Canal Principal GoTalk</option>
                    {channels.map((ch) => (
                      <option key={ch.id} value={String(ch.id)}>
                        {ch.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-100 dark:border-slate-800 pt-3">
              <button
                type="button"
                onClick={() => setNewModalOpen(false)}
                className="rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-2 font-semibold text-slate-700 dark:text-slate-200"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={creatingThread}
                className="rounded-lg bg-emerald-600 px-4 py-2 font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {creatingThread ? 'Abrindo...' : 'Iniciar Conversa'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
