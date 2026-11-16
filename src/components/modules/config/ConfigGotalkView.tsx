import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  Edit3,
  Eye,
  FileText,
  Filter,
  MessageSquare,
  Phone,
  Play,
  Plus,
  RefreshCw,
  Send,
  Trash2,
  X,
} from 'lucide-react';
import { apiFetch, formatDateTimeBR, getActiveUnitHeader, getAuthToken, parseJsonResponse } from '../../../lib/api.ts';
import {
  AuthUser,
  GotalkChannelPublic,
  GotalkHsmTemplate,
  GotalkOperatorPublic,
  Unit,
} from '../../../types.ts';
import { ConfirmDeleteModal, formatPhoneMask } from '../cadastros/CadastrosShared.tsx';

export interface GotalkStatusSummary {
  configured: boolean;
  webhookSecretConfigured?: boolean;
  baseUrl: string;
  authenticated: boolean;
  hasPrimaryChannel?: boolean;
  channelsCount?: number;
  operatorsCount?: number;
  templatesCount?: number;
  tokenExpiresAt: string | null;
  lastAuthAt: string | null;
  lastWebhookAt?: string | null;
  lastError: string | null;
}

interface GotalkGridMessage {
  id: number;
  threadId: number;
  channelDbId?: number | null;
  channelName: string;
  createdAt: string;
  direction: string;
  phone: string;
  contactName: string;
  clientName: string | null;
  operatorName: string | null;
  department: string;
  contentType: string;
  body: string;
  mediaUrl?: string | null;
  attachmentName?: string | null;
  attachmentMimeType?: string | null;
  iviAudioTranscript?: string | null;
  ackStatus?: number | null;
  deletedInOrigin?: boolean;
}

interface ChatbotOptionNode {
  id: string;
  key: string;
  title: string;
  description: string;
  action: string;
  children?: ChatbotOptionNode[];
}

interface ChatbotMenu {
  id: string;
  title: string;
  description: string;
  options: ChatbotOptionNode[];
}

interface GotalkAttendanceRow {
  id: number;
  unitId: number;
  contactName: string;
  linkedEntityLabel: string;
  contactPhone: string;
  operatorName: string;
  department: string;
  status: string;
  type: 'client' | 'bank';
  startedAt: string;
  lastMessageAt: string;
  messagesCount: number;
}

interface ChannelSuggestion {
  suggestionKey: string;
  name: string;
  phoneNumber: string;
  isPrimary: boolean;
}

export const ConfigGotalkView: React.FC<{
  currentUser: AuthUser;
  units: Unit[];
  gotalkConfig: GotalkStatusSummary | null;
  channels: GotalkChannelPublic[];
  operators: GotalkOperatorPublic[];
  templates: GotalkHsmTemplate[];
  onRefreshConfig: () => Promise<void>;
  onToast: (msg: string) => void;
}> = ({
  currentUser,
  units,
  gotalkConfig,
  channels,
  operators,
  templates,
  onRefreshConfig,
  onToast,
}) => {
  const isAdmin = currentUser.role === 'admin';
  const [subTab, setSubTab] = useState<'messages' | 'channels' | 'menus' | 'attendances'>('messages');
  const [testingConn, setTestingConn] = useState(false);

  // ---------------------------------------------------------------------------
  // 1. GRADE DE MENSAGENS GOTALK (50/página + ordenação + filtros)
  // ---------------------------------------------------------------------------
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [msgChannelId, setMsgChannelId] = useState('');
  const [msgOperator, setMsgOperator] = useState('');
  const [msgContact, setMsgContact] = useState('');
  const [msgPhone, setMsgPhone] = useState('');
  const [msgDir, setMsgDir] = useState('all');
  const [msgSortBy, setMsgSortBy] = useState('createdAt');
  const [msgSortDir, setMsgSortDir] = useState<'asc' | 'desc'>('desc');
  const [msgPage, setMsgPage] = useState(1);
  const [msgTotal, setMsgTotal] = useState(0);
  const [msgTotalPages, setMsgTotalPages] = useState(1);
  const [msgRows, setMsgRows] = useState<GotalkGridMessage[]>([]);
  const [msgLoading, setMsgLoading] = useState(false);

  // Modals: Message Detail + Phone History
  const [detailMsg, setDetailMsg] = useState<GotalkGridMessage | null>(null);
  const [phoneHistTarget, setPhoneHistTarget] = useState<string | null>(null);
  const [phoneHistPage, setPhoneHistPage] = useState(1);
  const [phoneHistTotal, setPhoneHistTotal] = useState(0);
  const [phoneHistPages, setPhoneHistPages] = useState(1);
  const [phoneHistContact, setPhoneHistContact] = useState('');
  const [phoneHistRows, setPhoneHistRows] = useState<GotalkGridMessage[]>([]);
  const [phoneHistLoading, setPhoneHistLoading] = useState(false);

  const loadMessages = useCallback(
    async (targetPage = msgPage) => {
      setMsgLoading(true);
      try {
        const qs = new URLSearchParams({
          page: String(targetPage),
          direction: msgDir,
          sortBy: msgSortBy,
          sortDir: msgSortDir,
        });
        if (msgChannelId) qs.set('channelId', msgChannelId);
        if (msgOperator.trim()) qs.set('operator', msgOperator.trim());
        if (msgContact.trim()) qs.set('contact', msgContact.trim());
        if (msgPhone.trim()) qs.set('phone', msgPhone.trim());

        const res = await apiFetch<{
          total: number;
          page: number;
          totalPages: number;
          rows: GotalkGridMessage[];
        }>(`/api/config/gotalk/messages?${qs.toString()}`);
        setMsgRows(res.rows || []);
        setMsgTotal(res.total || 0);
        setMsgTotalPages(res.totalPages || 1);
      } finally {
        setMsgLoading(false);
      }
    },
    [msgPage, msgDir, msgSortBy, msgSortDir, msgChannelId, msgOperator, msgContact, msgPhone]
  );

  useEffect(() => {
    if (subTab === 'messages') {
      loadMessages(msgPage);
    }
  }, [subTab, msgPage, msgSortBy, msgSortDir, loadMessages]);

  // Close Message Detail Modal on Escape (Manual Section 7.2)
  useEffect(() => {
    if (!detailMsg) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDetailMsg(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [detailMsg]);

  const loadPhoneHistory = useCallback(async (phone: string, pageNum: number) => {
    setPhoneHistLoading(true);
    try {
      const res = await apiFetch<{
        contactName: string;
        total: number;
        totalPages: number;
        rows: GotalkGridMessage[];
      }>(`/api/config/gotalk/phone-history/${encodeURIComponent(phone)}?page=${pageNum}`);
      setPhoneHistContact(res.contactName || phone);
      setPhoneHistTotal(res.total || 0);
      setPhoneHistPages(res.totalPages || 1);
      setPhoneHistRows(res.rows || []);
    } finally {
      setPhoneHistLoading(false);
    }
  }, []);

  useEffect(() => {
    if (phoneHistTarget) {
      loadPhoneHistory(phoneHistTarget, phoneHistPage);
    }
  }, [phoneHistTarget, phoneHistPage, loadPhoneHistory]);

  const toggleSort = (col: string) => {
    if (msgSortBy === col) {
      setMsgSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setMsgSortBy(col);
      setMsgSortDir('desc');
    }
    setMsgPage(1);
  };

  // ---------------------------------------------------------------------------
  // 2. CANAIS CONFIGURADOS GOTALK CRUD + SUGESTÕES
  // ---------------------------------------------------------------------------
  const [chModalOpen, setChModalOpen] = useState(false);
  const [editChId, setEditChId] = useState<number | null>(null);
  const [chName, setChName] = useState('');
  const [chPhone, setChPhone] = useState('');
  const [chUnitId, setChUnitId] = useState<string>('');
  const [chNotes, setChNotes] = useState('');
  const [chPrimary, setChPrimary] = useState(false);
  const [chActive, setChActive] = useState(true);
  const [chSaving, setChSaving] = useState(false);
  const [chErr, setChErr] = useState('');
  const [deleteChTarget, setDeleteChTarget] = useState<GotalkChannelPublic | null>(null);
  const [deleteChBusy, setDeleteChBusy] = useState(false);
  const [suggestions, setSuggestions] = useState<ChannelSuggestion[]>([]);
  const [discovering, setDiscovering] = useState(false);

  const openNewChannel = () => {
    setEditChId(null);
    setChName('');
    setChPhone('');
    setChUnitId('');
    setChNotes('');
    setChPrimary(channels.length === 0);
    setChActive(true);
    setChErr('');
    setChModalOpen(true);
  };

  const openEditChannel = (ch: GotalkChannelPublic) => {
    setEditChId(ch.id);
    setChName(ch.name);
    setChPhone(ch.phoneNumber || '');
    setChUnitId(ch.unitId ? String(ch.unitId) : '');
    setChNotes(ch.notes || '');
    setChPrimary(ch.isPrimary);
    setChActive(ch.isActive);
    setChErr('');
    setChModalOpen(true);
  };

  const handleSaveChannel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chName.trim()) {
      setChErr('O nome do canal é obrigatório.');
      return;
    }
    setChSaving(true);
    setChErr('');
    try {
      const payload = {
        name: chName.trim(),
        phoneNumber: chPhone.trim(),
        unitId: chUnitId ? Number(chUnitId) : null,
        notes: chNotes.trim(),
        isPrimary: chPrimary,
        isActive: chActive,
      };
      if (editChId) {
        await apiFetch(`/api/config/gotalk/channels/${editChId}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        onToast(`Canal GoTalk "${chName}" atualizado.`);
      } else {
        await apiFetch('/api/config/gotalk/channels', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        onToast(`Canal GoTalk "${chName}" criado.`);
      }
      setChModalOpen(false);
      await onRefreshConfig();
    } catch (err) {
      setChErr(err instanceof Error ? err.message : 'Erro ao salvar canal.');
    } finally {
      setChSaving(false);
    }
  };

  const handleDiscoverSuggestions = async () => {
    setDiscovering(true);
    try {
      const res = await apiFetch<{ suggestions: ChannelSuggestion[] }>(
        '/api/config/gotalk/channels/discover-suggestions',
        { method: 'POST' }
      );
      setSuggestions(res.suggestions || []);
      onToast(
        res.suggestions.length > 0
          ? `${res.suggestions.length} sugestão(ões) de canal detectada(s) na GoTalk.`
          : 'Todos os canais remotos já estão sincronizados na grade.'
      );
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Não foi possível consultar canais remotos GoTalk.');
    } finally {
      setDiscovering(false);
    }
  };

  // ---------------------------------------------------------------------------
  // 3. MENUS DO CHATBOT (ÁRVORE SOMENTE LEITURA)
  // ---------------------------------------------------------------------------
  const [chatbotMenus, setChatbotMenus] = useState<ChatbotMenu[]>([]);
  const [expandedNodes, setExpandedNodes] = useState<Record<string, boolean>>({});
  const [menusLoading, setMenusLoading] = useState(false);

  const loadChatbotMenus = useCallback(async () => {
    setMenusLoading(true);
    try {
      const res = await apiFetch<{ menus: ChatbotMenu[] }>('/api/config/gotalk/chatbot-menus');
      setChatbotMenus(res.menus || []);
      const initialExpanded: Record<string, boolean> = {};
      (res.menus || []).forEach((m) => {
        initialExpanded[m.id] = true;
      });
      setExpandedNodes((prev) => ({ ...initialExpanded, ...prev }));
    } finally {
      setMenusLoading(false);
    }
  }, []);

  useEffect(() => {
    if (subTab === 'menus') {
      loadChatbotMenus();
    }
  }, [subTab, loadChatbotMenus]);

  // ---------------------------------------------------------------------------
  // 4. HISTÓRICO DE ATENDIMENTOS GOTALK (20/pág + Conversa + HSM {{n}})
  // ---------------------------------------------------------------------------
  const [attType, setAttType] = useState<'all' | 'client' | 'bank'>('all');
  const [attUnitId, setAttUnitId] = useState('');
  const [attPage, setAttPage] = useState(1);
  const [attTotal, setAttTotal] = useState(0);
  const [attTotalPages, setAttTotalPages] = useState(1);
  const [attRows, setAttRows] = useState<GotalkAttendanceRow[]>([]);
  const [attLoading, setAttLoading] = useState(false);
  const [selectedAtt, setSelectedAtt] = useState<GotalkAttendanceRow | null>(null);
  const [convMessages, setConvMessages] = useState<
    Array<{ id: number; direction: string; body: string; senderName: string; createdAt: string; contentType: string }>
  >([]);
  const [convTotal, setConvTotal] = useState(0);
  const [convOffset, setConvOffset] = useState(0);
  const [replyText, setReplyText] = useState('');
  const [sendingReply, setSendingReply] = useState(false);

  // HSM Modal
  const [hsmModalOpen, setHsmModalOpen] = useState(false);
  const [selectedTemplateName, setSelectedTemplateName] = useState('');
  const [hsmVars, setHsmVars] = useState<Record<string, string>>({});
  const [hsmSending, setHsmSending] = useState(false);
  const [hsmErr, setHsmErr] = useState('');

  const loadAttendances = useCallback(
    async (targetPage = attPage) => {
      setAttLoading(true);
      try {
        const qs = new URLSearchParams({
          page: String(targetPage),
          type: attType,
        });
        if (attUnitId) qs.set('unitId', attUnitId);
        const res = await apiFetch<{
          total: number;
          totalPages: number;
          rows: GotalkAttendanceRow[];
        }>(`/api/config/gotalk/attendances?${qs.toString()}`);
        setAttRows(res.rows || []);
        setAttTotal(res.total || 0);
        setAttTotalPages(res.totalPages || 1);
        if (!selectedAtt && res.rows?.[0]) {
          setSelectedAtt(res.rows[0]);
        }
      } finally {
        setAttLoading(false);
      }
    },
    [attPage, attType, attUnitId, selectedAtt]
  );

  const loadConversation = useCallback(async (threadId: number, offset = 0) => {
    const res = await apiFetch<{
      total: number;
      offset: number;
      messages: Array<{ id: number; direction: string; body: string; senderName: string; createdAt: string; contentType: string }>;
    }>(`/api/config/gotalk/attendances/${threadId}/messages?offset=${offset}&limit=100`);
    setConvTotal(res.total || 0);
    setConvOffset(offset);
    setConvMessages(res.messages || []);
  }, []);

  useEffect(() => {
    if (subTab === 'attendances') {
      loadAttendances(attPage);
    }
  }, [subTab, attPage, attType, attUnitId, loadAttendances]);

  useEffect(() => {
    if (subTab === 'attendances' && selectedAtt) {
      loadConversation(selectedAtt.id, 0);
    }
  }, [subTab, selectedAtt, loadConversation]);

  const handleSendReply = async () => {
    if (!selectedAtt || !replyText.trim()) return;
    setSendingReply(true);
    try {
      await apiFetch(`/api/whatsapp/threads/${selectedAtt.id}/messages`, {
        method: 'POST',
        body: JSON.stringify({ body: replyText.trim(), contentType: 'text', direction: 'outbound' }),
      });
      setReplyText('');
      await loadConversation(selectedAtt.id, convOffset);
      onToast('Resposta enviada no atendimento.');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Erro ao responder atendimento.');
    } finally {
      setSendingReply(false);
    }
  };

  const activeTemplate = useMemo(
    () => templates.find((t) => t.templateName === selectedTemplateName) || templates[0] || null,
    [templates, selectedTemplateName]
  );

  const detectedVarKeys = useMemo(() => {
    if (!activeTemplate?.bodyText) return [];
    const matches = Array.from(activeTemplate.bodyText.matchAll(/\{\{(\d+)\}\}/g)).map((m) => m[1]);
    return Array.from(new Set(matches)).sort((a, b) => Number(a) - Number(b));
  }, [activeTemplate]);

  const renderedHsmPreview = useMemo(() => {
    if (!activeTemplate) return '';
    return (activeTemplate.bodyText || activeTemplate.templateName).replace(/\{\{(\d+)\}\}/g, (_, k) =>
      hsmVars[k]?.trim() ? hsmVars[k].trim() : `{{${k}}}`
    );
  }, [activeTemplate, hsmVars]);

  const allHsmVarsFilled = useMemo(
    () => detectedVarKeys.every((k) => Boolean(hsmVars[k]?.trim())),
    [detectedVarKeys, hsmVars]
  );

  const handleSendHsm = useCallback(async () => {
    if (!selectedAtt || !activeTemplate) return;
    if (!allHsmVarsFilled) {
      setHsmErr('Preencha todas as variáveis obrigatórias do template antes de disparar.');
      return;
    }
    setHsmSending(true);
    setHsmErr('');
    try {
      await apiFetch('/api/integrations/gotalk/send-template', {
        method: 'POST',
        body: JSON.stringify({
          threadId: selectedAtt.id,
          templateName: activeTemplate.templateName,
          variables: hsmVars,
        }),
      });
      setHsmModalOpen(false);
      onToast(`Template HSM "${activeTemplate.templateName}" disparado.`);
      await loadConversation(selectedAtt.id, 0);
    } catch (err) {
      setHsmErr(err instanceof Error ? err.message : 'Erro ao disparar template HSM.');
    } finally {
      setHsmSending(false);
    }
  }, [selectedAtt, activeTemplate, allHsmVarsFilled, hsmVars, loadConversation, onToast]);

  const renderTreeOption = (opt: ChatbotOptionNode, depth = 0): React.ReactNode => {
    const hasChildren = Boolean(opt.children && opt.children.length > 0);
    const expanded = expandedNodes[opt.id] !== false;
    return (
      <div key={opt.id} className={depth > 0 ? 'ml-5 border-l border-slate-200 pl-3 mt-2 dark:border-slate-700' : 'mt-2'}>
        <div className="flex items-start justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50/70 px-3 py-2 dark:border-slate-800 dark:bg-slate-800/60">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              {hasChildren && (
                <button
                  type="button"
                  onClick={() => setExpandedNodes((p) => ({ ...p, [opt.id]: !expanded }))}
                  className="text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
                >
                  {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                </button>
              )}
              <span className="font-mono font-bold text-slate-900 dark:text-slate-100">[{opt.key}]</span>
              <span className="font-semibold text-slate-900 dark:text-slate-100">{opt.title}</span>
            </div>
            <p className="text-[11px] text-slate-600 dark:text-slate-300">{opt.description}</p>
          </div>
          <span className="font-mono text-[10px] text-slate-500 whitespace-nowrap shrink-0 dark:text-slate-400">{opt.action}</span>
        </div>
        {hasChildren && expanded && opt.children!.map((child) => renderTreeOption(child, depth + 1))}
      </div>
    );
  };

  return (
    <div className="space-y-4 text-xs">
      {/* Header Status & Sync */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3 dark:border-slate-700 dark:bg-slate-900">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div>
            <div className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
              Mensagens, Canais, Menus URA &amp; Atendimentos GoTalk Oficial
            </div>
            <div className="text-slate-500 mt-0.5 dark:text-slate-400">
              Base: <span className="font-mono text-slate-700 dark:text-slate-200">{gotalkConfig?.baseUrl || 'https://app.gotalk.digital'}</span>
              {' · '}
              <span className="font-mono tabular-nums">{channels.length} canal(is)</span>
              {' · '}
              <span className="font-mono tabular-nums">{operators.length} operador(es)</span>
              {' · '}
              <span className="font-mono tabular-nums">{templates.length} template(s) HSM</span>
            </div>
          </div>

          {isAdmin && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={testingConn}
                onClick={async () => {
                  setTestingConn(true);
                  try {
                    const token = getAuthToken();
                    const resp = await fetch('/api/integrations/gotalk/test', {
                      method: 'POST',
                      headers: {
                        'Content-Type': 'application/json',
                        'x-unit-id': String(getActiveUnitHeader()),
                        ...(token ? { Authorization: `Bearer ${token}` } : {}),
                      },
                    });
                    const data = await parseJsonResponse<{ ok?: boolean; error?: string }>(
                      resp,
                      'Aviso ao autenticar GoTalk (verifique secrets).'
                    );
                    onToast(
                      data.ok
                        ? 'GoTalk autenticado e recursos sincronizados.'
                        : data.error || 'Aviso ao autenticar GoTalk (verifique secrets).'
                    );
                    await onRefreshConfig();
                  } catch (err) {
                    onToast(err instanceof Error ? err.message : 'Aviso ao autenticar GoTalk.');
                  } finally {
                    setTestingConn(false);
                  }
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-1.5 font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${testingConn ? 'animate-spin' : ''}`} />
                Autenticar &amp; Sincronizar
              </button>
              <button
                type="button"
                disabled={testingConn}
                onClick={async () => {
                  setTestingConn(true);
                  try {
                    const token = getAuthToken();
                    const resp = await fetch('/api/integrations/gotalk/test-webhook', {
                      method: 'POST',
                      headers: {
                        'Content-Type': 'application/json',
                        'x-unit-id': String(getActiveUnitHeader()),
                        ...(token ? { Authorization: `Bearer ${token}` } : {}),
                      },
                    });
                    const data = await parseJsonResponse<{ ok?: boolean; error?: string }>(
                      resp,
                      'Falha no autoteste do webhook.'
                    );
                    onToast(
                      data.ok
                        ? 'Autoteste do Webhook GoTalk concluído com sucesso.'
                        : data.error || 'Falha no autoteste do webhook.'
                    );
                  } catch (err) {
                    onToast(err instanceof Error ? err.message : 'Falha no autoteste do webhook.');
                  } finally {
                    setTestingConn(false);
                  }
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-semibold text-slate-800 hover:bg-slate-50 whitespace-nowrap shrink-0 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
              >
                <Play className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                Testar Webhook
              </button>
              <button
                type="button"
                onClick={() => {
                  const url =
                    typeof window !== 'undefined'
                      ? `${window.location.origin}/api/integrations/gotalk/webhook`
                      : '/api/integrations/gotalk/webhook';
                  navigator.clipboard?.writeText(url).catch(() => {});
                  onToast('URL do Webhook GoTalk copiada.');
                }}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <Copy className="w-3.5 h-3.5" />
                Copiar Webhook
              </button>
            </div>
          )}
        </div>

        {/* Sub-tabs */}
        <div className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1 w-fit dark:bg-slate-800">
          {(
            [
              { id: 'messages', label: 'Grade de Mensagens (50/pág)' },
              { id: 'channels', label: `Canais Configurados (${channels.length})` },
              { id: 'menus', label: 'Menus do Chatbot' },
              { id: 'attendances', label: 'Histórico de Atendimentos' },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setSubTab(t.id)}
              className={`rounded-md px-3 py-1.5 font-semibold transition-colors whitespace-nowrap shrink-0 ${
                subTab === t.id ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-slate-100' : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* SUB-ABA 1: GRADE DE MENSAGENS */}
      {subTab === 'messages' && (
        <div className="space-y-3">
          <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3 dark:border-slate-700 dark:bg-slate-900">
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => setFiltersOpen((o) => !o)}
                className="inline-flex items-center gap-1.5 font-semibold text-slate-800 dark:text-slate-100"
              >
                <Filter className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
                <span>Filtros da Grade de Mensagens</span>
                {filtersOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setMsgChannelId('');
                    setMsgOperator('');
                    setMsgContact('');
                    setMsgPhone('');
                    setMsgDir('all');
                    setMsgPage(1);
                  }}
                  className="text-slate-500 hover:text-slate-900 font-medium whitespace-nowrap dark:text-slate-400 dark:hover:text-white"
                >
                  Limpar filtros
                </button>
                <button
                  type="button"
                  onClick={() => loadMessages(msgPage)}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <RefreshCw className={`w-3 h-3 ${msgLoading ? 'animate-spin' : ''}`} />
                  Atualizar
                </button>
              </div>
            </div>

            {filtersOpen && (
              <div className="grid grid-cols-1 sm:grid-cols-5 gap-2.5 pt-2 border-t border-slate-100 dark:border-slate-800">
                <select
                  value={msgChannelId}
                  onChange={(e) => {
                    setMsgChannelId(e.target.value);
                    setMsgPage(1);
                  }}
                  className="rounded-lg border border-slate-200 px-2.5 py-1.5 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                >
                  <option value="">Todos os Canais</option>
                  {channels.map((c) => (
                    <option key={c.id} value={String(c.id)}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  value={msgOperator}
                  onChange={(e) => setMsgOperator(e.target.value)}
                  placeholder="Operador..."
                  className="rounded-lg border border-slate-200 px-2.5 py-1.5 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
                <input
                  type="text"
                  value={msgContact}
                  onChange={(e) => setMsgContact(e.target.value)}
                  placeholder="Contato ou Cliente..."
                  className="rounded-lg border border-slate-200 px-2.5 py-1.5 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
                <input
                  type="text"
                  value={msgPhone}
                  onChange={(e) => setMsgPhone(e.target.value)}
                  placeholder="Telefone..."
                  className="rounded-lg border border-slate-200 px-2.5 py-1.5 font-mono dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
                <div className="flex gap-1.5">
                  <select
                    value={msgDir}
                    onChange={(e) => {
                      setMsgDir(e.target.value);
                      setMsgPage(1);
                    }}
                    className="flex-1 rounded-lg border border-slate-200 px-2.5 py-1.5 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  >
                    <option value="all">Todas direções</option>
                    <option value="inbound">Recebidas</option>
                    <option value="outbound">Enviadas</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => {
                      setMsgPage(1);
                      loadMessages(1);
                    }}
                    className="rounded-lg bg-slate-900 px-3 py-1.5 font-semibold text-white whitespace-nowrap dark:bg-emerald-600"
                  >
                    Buscar
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden dark:border-slate-700 dark:bg-slate-900">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-300">
                  <tr>
                    <th className="px-4 py-2.5 whitespace-nowrap">
                      <button type="button" onClick={() => toggleSort('createdAt')} className="hover:text-slate-900 dark:hover:text-white">
                        Data/Hora {msgSortBy === 'createdAt' ? (msgSortDir === 'asc' ? '↑' : '↓') : ''}
                      </button>
                    </th>
                    <th className="px-4 py-2.5 whitespace-nowrap">
                      <button type="button" onClick={() => toggleSort('phone')} className="hover:text-slate-900 dark:hover:text-white">
                        Telefone (Histórico) {msgSortBy === 'phone' ? (msgSortDir === 'asc' ? '↑' : '↓') : ''}
                      </button>
                    </th>
                    <th className="px-4 py-2.5 whitespace-nowrap">
                      <button type="button" onClick={() => toggleSort('contact')} className="hover:text-slate-900 dark:hover:text-white">
                        Contato / Cliente {msgSortBy === 'contact' ? (msgSortDir === 'asc' ? '↑' : '↓') : ''}
                      </button>
                    </th>
                    <th className="px-4 py-2.5 whitespace-nowrap">
                      <button type="button" onClick={() => toggleSort('operator')} className="hover:text-slate-900 dark:hover:text-white">
                        Operador · Canal {msgSortBy === 'operator' ? (msgSortDir === 'asc' ? '↑' : '↓') : ''}
                      </button>
                    </th>
                    <th className="px-4 py-2.5 whitespace-nowrap">
                      <button type="button" onClick={() => toggleSort('direction')} className="hover:text-slate-900 dark:hover:text-white">
                        Direção {msgSortBy === 'direction' ? (msgSortDir === 'asc' ? '↑' : '↓') : ''}
                      </button>
                    </th>
                    <th className="px-4 py-2.5">Conteúdo</th>
                    <th className="px-4 py-2.5 text-right whitespace-nowrap">Detalhes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {msgLoading ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-slate-500 dark:text-slate-400">
                        Carregando mensagens GoTalk...
                      </td>
                    </tr>
                  ) : msgRows.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-slate-500 dark:text-slate-400">
                        Nenhuma mensagem GoTalk localizada para os filtros atuais.
                      </td>
                    </tr>
                  ) : (
                    msgRows.map((m) => (
                      <tr key={m.id} className="hover:bg-slate-50/80">
                        <td className="px-4 py-2.5 font-mono text-[11px] text-slate-600 tabular-nums whitespace-nowrap dark:text-slate-300">
                          {formatDateTimeBR(m.createdAt)}
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => {
                              setPhoneHistPage(1);
                              setPhoneHistTarget(m.phone);
                            }}
                            className="inline-flex items-center gap-1 font-mono font-semibold text-blue-700 hover:underline tabular-nums dark:text-blue-300"
                            title="Abrir Histórico Consolidado deste Número"
                          >
                            <Phone className="w-3 h-3" />
                            {m.phone}
                          </button>
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="font-medium text-slate-900 truncate max-w-[170px] dark:text-slate-100">{m.contactName}</div>
                          {m.clientName && (
                            <div className="text-[11px] text-slate-500 truncate max-w-[170px] dark:text-slate-400">{m.clientName}</div>
                          )}
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          <div className="text-slate-800 dark:text-slate-100">{m.operatorName || 'Fila Ivi'}</div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400">{m.channelName}</div>
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          <span
                            className={`font-semibold text-[11px] ${
                              m.direction === 'inbound' ? 'text-blue-700 dark:text-blue-300' : 'text-emerald-700 dark:text-emerald-300'
                            }`}
                          >
                            {m.direction === 'inbound' ? 'Entrada' : 'Saída'}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 max-w-sm">
                          <div className="text-slate-800 truncate dark:text-slate-100">{m.body}</div>
                        </td>
                        <td className="px-4 py-2.5 text-right whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => setDetailMsg(m)}
                            className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                          >
                            <Eye className="w-3 h-3" />
                            Ver
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between border-t border-slate-100 px-4 py-2.5 text-slate-600 dark:border-slate-800 dark:text-slate-300">
              <span className="font-mono tabular-nums">
                Total: {msgTotal} · Página {msgPage} de {msgTotalPages}
              </span>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  disabled={msgPage <= 1}
                  onClick={() => setMsgPage((p) => Math.max(1, p - 1))}
                  className="rounded border border-slate-200 px-2.5 py-1 font-semibold disabled:opacity-40 dark:border-slate-700"
                >
                  Anterior
                </button>
                <button
                  type="button"
                  disabled={msgPage >= msgTotalPages}
                  onClick={() => setMsgPage((p) => Math.min(msgTotalPages, p + 1))}
                  className="rounded border border-slate-200 px-2.5 py-1 font-semibold disabled:opacity-40 dark:border-slate-700"
                >
                  Próxima
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SUB-ABA 2: CANAIS CONFIGURADOS */}
      {subTab === 'channels' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
            <div className="text-slate-600 dark:text-slate-300">
              Gerencie os números oficiais GoTalk vinculados às unidades regionais.
            </div>
            {isAdmin && (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={discovering}
                  onClick={handleDiscoverSuggestions}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-semibold text-slate-800 hover:bg-slate-50 whitespace-nowrap dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${discovering ? 'animate-spin' : ''}`} />
                  {channels.length === 0 ? 'Detectar canal primário' : 'Sincronizar todos'}
                </button>
                <button
                  type="button"
                  onClick={openNewChannel}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-1.5 font-semibold text-white hover:bg-slate-800 whitespace-nowrap dark:bg-emerald-600 dark:hover:bg-emerald-500"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Novo Canal GoTalk
                </button>
              </div>
            )}
          </div>

          {suggestions.length > 0 && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 space-y-2 dark:border-emerald-800/70 dark:bg-emerald-950/50">
              <div className="font-semibold text-emerald-950 dark:text-emerald-300">
                Canais remotos sugeridos pela GoTalk ({suggestions.length})
              </div>
              <div className="space-y-1.5">
                {suggestions.map((sug) => (
                  <div
                    key={sug.suggestionKey}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-white px-3 py-2 dark:border-emerald-800/70 dark:bg-slate-900"
                  >
                    <div>
                      <span className="font-semibold text-slate-900 dark:text-slate-100">{sug.name}</span>
                      <span className="font-mono text-slate-500 ml-2 dark:text-slate-400">{sug.phoneNumber || 'Sem número'}</span>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={async () => {
                          await apiFetch('/api/config/gotalk/channels', {
                            method: 'POST',
                            body: JSON.stringify({
                              name: sug.name,
                              phoneNumber: sug.phoneNumber,
                              isPrimary: sug.isPrimary,
                              isActive: true,
                            }),
                          });
                          setSuggestions((prev) => prev.filter((x) => x.suggestionKey !== sug.suggestionKey));
                          await onRefreshConfig();
                          onToast(`Canal "${sug.name}" confirmado.`);
                        }}
                        className="rounded bg-emerald-600 px-2.5 py-1 font-semibold text-white hover:bg-emerald-700"
                      >
                        Confirmar
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setSuggestions((prev) => prev.filter((x) => x.suggestionKey !== sug.suggestionKey))
                        }
                        className="rounded border border-slate-200 px-2.5 py-1 font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                      >
                        Dispensar
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden dark:border-slate-700 dark:bg-slate-900">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-300">
                  <tr>
                    <th className="px-4 py-2.5">Nome &amp; Notas</th>
                    <th className="px-4 py-2.5 whitespace-nowrap">Telefone</th>
                    <th className="px-4 py-2.5 whitespace-nowrap">Unidade</th>
                    <th className="px-4 py-2.5 whitespace-nowrap">Papel</th>
                    <th className="px-4 py-2.5 whitespace-nowrap">Status</th>
                    <th className="px-4 py-2.5 text-right whitespace-nowrap">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {channels.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-slate-500 dark:text-slate-400">
                        Nenhum canal GoTalk configurado.
                      </td>
                    </tr>
                  ) : (
                    channels.map((ch) => {
                      const u = ch.unitId ? units.find((x) => x.id === ch.unitId) : null;
                      return (
                        <tr key={ch.id} className="hover:bg-slate-50/80">
                          <td className="px-4 py-2.5">
                            <div className="font-semibold text-slate-900 dark:text-slate-100">{ch.name}</div>
                            {ch.notes && <div className="text-[11px] text-slate-500 dark:text-slate-400">{ch.notes}</div>}
                          </td>
                          <td className="px-4 py-2.5 font-mono tabular-nums text-slate-800 whitespace-nowrap dark:text-slate-100">
                            {ch.phoneNumber || '—'}
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap text-slate-700 dark:text-slate-200">
                            {u ? `${u.code} · ${u.name}` : 'Global / Todas'}
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap text-slate-700 dark:text-slate-200">
                            {ch.isPrimary ? 'Principal' : 'Secundário'}
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap">
                            {isAdmin ? (
                              <button
                                type="button"
                                onClick={async () => {
                                  await apiFetch(`/api/config/gotalk/channels/${ch.id}/toggle`, {
                                    method: 'PATCH',
                                  });
                                  await onRefreshConfig();
                                }}
                                className={`font-semibold ${
                                  ch.isActive ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-400 dark:text-slate-400'
                                } hover:underline`}
                              >
                                {ch.isActive ? 'Ativo' : 'Inativo'}
                              </button>
                            ) : (
                              <span>{ch.isActive ? 'Ativo' : 'Inativo'}</span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-right whitespace-nowrap">
                            {isAdmin && (
                              <div className="inline-flex gap-1">
                                <button
                                  type="button"
                                  onClick={() => openEditChannel(ch)}
                                  className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                                >
                                  <Edit3 className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setDeleteChTarget(ch)}
                                  className="rounded-md p-1.5 text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/60"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
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
        </div>
      )}

      {/* SUB-ABA 3: MENUS DO CHATBOT */}
      {subTab === 'menus' && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-4 dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
            <div>
              <div className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                Árvore de Menus URA do Chatbot (Somente Leitura)
              </div>
              <p className="text-slate-500 dark:text-slate-400">
                Estrutura de triagem automática sincronizada com o fluxo de recepção GoTalk.
              </p>
            </div>
            <button
              type="button"
              onClick={loadChatbotMenus}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${menusLoading ? 'animate-spin' : ''}`} />
              Recarregar menus
            </button>
          </div>

          {chatbotMenus.map((menu) => {
            const open = expandedNodes[menu.id] !== false;
            return (
              <div key={menu.id} className="rounded-xl border border-slate-200 p-4 space-y-2 dark:border-slate-700">
                <button
                  type="button"
                  onClick={() => setExpandedNodes((p) => ({ ...p, [menu.id]: !open }))}
                  className="w-full flex items-center justify-between text-left"
                >
                  <div>
                    <div className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">{menu.title}</div>
                    <div className="text-slate-500 dark:text-slate-400">{menu.description}</div>
                  </div>
                  {open ? <ChevronDown className="w-4 h-4 text-slate-500 dark:text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-500 dark:text-slate-400" />}
                </button>
                {open && <div>{menu.options.map((opt) => renderTreeOption(opt, 0))}</div>}
              </div>
            );
          })}
        </div>
      )}

      {/* SUB-ABA 4: HISTÓRICO DE ATENDIMENTOS GOTALK */}
      {subTab === 'attendances' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Left: 20/page Attendances List */}
          <div className="lg:col-span-5 rounded-xl border border-slate-200 bg-white overflow-hidden flex flex-col dark:border-slate-700 dark:bg-slate-900">
            <div className="p-3 border-b border-slate-100 space-y-2 dark:border-slate-800">
              <div className="flex items-center justify-between gap-2">
                <div className="flex gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
                  {(
                    [
                      { id: 'all', label: 'Todos' },
                      { id: 'client', label: 'Cliente' },
                      { id: 'bank', label: 'Banco' },
                    ] as const
                  ).map((k) => (
                    <button
                      key={k.id}
                      type="button"
                      onClick={() => {
                        setAttType(k.id);
                        setAttPage(1);
                      }}
                      className={`rounded px-2.5 py-1 font-semibold whitespace-nowrap ${
                        attType === k.id ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-slate-100' : 'text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      {k.label}
                    </button>
                  ))}
                </div>

                <select
                  value={attUnitId}
                  onChange={(e) => {
                    setAttUnitId(e.target.value);
                    setAttPage(1);
                  }}
                  className="rounded-lg border border-slate-200 px-2 py-1 text-[11px] dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                >
                  <option value="">Todas Unidades</option>
                  {units.map((u) => (
                    <option key={u.id} value={String(u.id)}>
                      {u.code}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="divide-y divide-slate-100 max-h-[480px] overflow-y-auto flex-1 dark:divide-slate-800">
              {attLoading ? (
                <div className="p-6 text-center text-slate-500 dark:text-slate-400">Carregando atendimentos...</div>
              ) : attRows.length === 0 ? (
                <div className="p-6 text-center text-slate-500 dark:text-slate-400">Nenhum atendimento GoTalk registrado.</div>
              ) : (
                attRows.map((att) => {
                  const active = selectedAtt?.id === att.id;
                  return (
                    <button
                      key={att.id}
                      type="button"
                      onClick={() => setSelectedAtt(att)}
                      className={`w-full text-left px-4 py-3 transition-colors ${
                        active ? 'bg-blue-50/70 dark:bg-blue-950/50' : 'hover:bg-slate-50 dark:hover:bg-slate-800'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-slate-900 truncate dark:text-slate-100">{att.linkedEntityLabel}</span>
                        <span className="font-mono text-[10px] text-slate-500 tabular-nums shrink-0 dark:text-slate-400">
                          {att.messagesCount} msg
                        </span>
                      </div>
                      <div className="mt-0.5 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                        <span className="font-mono tabular-nums">{att.contactPhone}</span>
                        <span>
                          {att.type === 'bank' ? 'Contato Bancário' : 'Cliente'} · {att.operatorName}
                        </span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>

            <div className="flex items-center justify-between border-t border-slate-100 px-3 py-2 text-[11px] text-slate-500 dark:border-slate-800 dark:text-slate-400">
              <span className="font-mono tabular-nums">
                {attTotal} atend. · Pág {attPage}/{attTotalPages}
              </span>
              <div className="flex gap-1">
                <button
                  type="button"
                  disabled={attPage <= 1}
                  onClick={() => setAttPage((p) => Math.max(1, p - 1))}
                  className="rounded border border-slate-200 px-2 py-0.5 disabled:opacity-40 dark:border-slate-700"
                >
                  Ant
                </button>
                <button
                  type="button"
                  disabled={attPage >= attTotalPages}
                  onClick={() => setAttPage((p) => Math.min(attTotalPages, p + 1))}
                  className="rounded border border-slate-200 px-2 py-0.5 disabled:opacity-40 dark:border-slate-700"
                >
                  Próx
                </button>
              </div>
            </div>
          </div>

          {/* Right: Conversation Viewer + Reply + HSM */}
          <div className="lg:col-span-7 rounded-xl border border-slate-200 bg-white p-4 flex flex-col justify-between space-y-3 dark:border-slate-700 dark:bg-slate-900">
            {selectedAtt ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3 dark:border-slate-800">
                  <div>
                    <div className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                      {selectedAtt.linkedEntityLabel}
                    </div>
                    <div className="text-[11px] text-slate-500 font-mono tabular-nums dark:text-slate-400">
                      {selectedAtt.contactPhone} · {selectedAtt.department} · {selectedAtt.status}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (templates[0]) setSelectedTemplateName(templates[0].templateName);
                      setHsmVars({});
                      setHsmErr('');
                      setHsmModalOpen(true);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 font-semibold text-emerald-800 hover:bg-emerald-100 whitespace-nowrap shrink-0 dark:border-emerald-800/70 dark:bg-emerald-950/50 dark:text-emerald-300 dark:hover:bg-emerald-900/60"
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                    Enviar Template HSM
                  </button>
                </div>

                <div className="space-y-2 max-h-[360px] overflow-y-auto pr-1">
                  {convTotal > 100 && (
                    <div className="flex justify-between items-center text-[11px] text-slate-500 pb-2 dark:text-slate-400">
                      <span>
                        Exibindo {convOffset + 1}–{Math.min(convTotal, convOffset + 100)} de {convTotal}
                      </span>
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          disabled={convOffset === 0}
                          onClick={() => loadConversation(selectedAtt.id, Math.max(0, convOffset - 100))}
                          className="underline disabled:opacity-40"
                        >
                          Lote anterior
                        </button>
                        <button
                          type="button"
                          disabled={convOffset + 100 >= convTotal}
                          onClick={() => loadConversation(selectedAtt.id, convOffset + 100)}
                          className="underline disabled:opacity-40"
                        >
                          Próximo lote (100)
                        </button>
                      </div>
                    </div>
                  )}

                  {convMessages.map((m) => (
                    <div
                      key={m.id}
                      className={`rounded-xl p-3 max-w-[85%] ${
                        m.direction === 'outbound'
                          ? 'ml-auto bg-slate-900 text-white dark:bg-emerald-600'
                          : 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3 text-[10px] opacity-75 mb-1">
                        <span className="font-semibold">{m.senderName}</span>
                        <span className="font-mono tabular-nums">{formatDateTimeBR(m.createdAt)}</span>
                      </div>
                      <p className="whitespace-pre-wrap leading-relaxed">{m.body}</p>
                    </div>
                  ))}
                </div>

                <div className="border-t border-slate-100 pt-3 flex gap-2 items-end dark:border-slate-800">
                  <textarea
                    rows={2}
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSendReply();
                      }
                    }}
                    placeholder="Responder no atendimento... (Enter envia, Shift+Enter quebra linha)"
                    className="flex-1 rounded-lg border border-slate-200 p-2.5 text-xs dark:border-slate-700"
                  />
                  <button
                    type="button"
                    disabled={sendingReply || !replyText.trim()}
                    onClick={handleSendReply}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2.5 font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 whitespace-nowrap shrink-0"
                  >
                    <Send className="w-3.5 h-3.5" />
                    Enviar
                  </button>
                </div>
              </>
            ) : (
              <div className="py-16 text-center text-slate-500 dark:text-slate-400">
                Selecione um atendimento na coluna esquerda para visualizar as mensagens.
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL: DETALHES DA MENSAGEM (Fecha no X, clique fora ou Escape) */}
      {detailMsg && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 dark:bg-slate-950/80"
          onClick={() => setDetailMsg(null)}
        >
          <div
            className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl space-y-4 text-xs dark:border-slate-700 dark:bg-slate-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
              <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                Detalhes da Mensagem #{detailMsg.id}
              </h3>
              <button
                type="button"
                onClick={() => setDetailMsg(null)}
                className="rounded-lg p-1 text-slate-400 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2.5 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/70">
              <div>
                <div className="text-[10px] text-slate-500 dark:text-slate-400">Data/Hora</div>
                <div className="font-mono font-semibold text-slate-900 tabular-nums dark:text-slate-100">
                  {formatDateTimeBR(detailMsg.createdAt)}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-slate-500 dark:text-slate-400">Telefone</div>
                <div className="font-mono font-semibold text-slate-900 tabular-nums dark:text-slate-100">{detailMsg.phone}</div>
              </div>
              <div>
                <div className="text-[10px] text-slate-500 dark:text-slate-400">Contato / Cliente</div>
                <div className="font-semibold text-slate-900 dark:text-slate-100">{detailMsg.clientName || detailMsg.contactName}</div>
              </div>
              <div>
                <div className="text-[10px] text-slate-500 dark:text-slate-400">Canal · Operador</div>
                <div className="font-semibold text-slate-900 dark:text-slate-100">
                  {detailMsg.channelName} · {detailMsg.operatorName || 'Ivi'}
                </div>
              </div>
            </div>

            <div className="space-y-1">
              <div className="font-semibold text-slate-700 dark:text-slate-200">Conteúdo Integral</div>
              <div className="rounded-xl border border-slate-200 p-3 whitespace-pre-wrap text-slate-900 leading-relaxed dark:border-slate-700 dark:text-slate-100">
                {detailMsg.body}
              </div>
            </div>

            {detailMsg.iviAudioTranscript && (
              <div className="space-y-1">
                <div className="font-semibold text-blue-800 dark:text-blue-300">Transcrição Automática Ivi (Áudio)</div>
                <div className="rounded-xl border border-blue-200 bg-blue-50/70 p-3 text-slate-800 dark:border-blue-800/70 dark:bg-blue-950/50 dark:text-slate-100">
                  {detailMsg.iviAudioTranscript}
                </div>
              </div>
            )}

            {detailMsg.mediaUrl && (
              <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800/70">
                <span className="flex items-center gap-2 truncate">
                  <FileText className="w-4 h-4 text-slate-600 shrink-0 dark:text-slate-300" />
                  <span className="truncate">{detailMsg.attachmentName || 'Anexo de mídia'}</span>
                </span>
                <a
                  href={detailMsg.mediaUrl}
                  download={detailMsg.attachmentName || 'anexo'}
                  className="font-semibold text-blue-700 hover:underline shrink-0 dark:text-blue-300"
                >
                  Baixar arquivo
                </a>
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL: HISTÓRICO CONSOLIDADO DO NÚMERO */}
      {phoneHistTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 dark:bg-slate-950/80">
          <div className="w-full max-w-3xl rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl space-y-4 text-xs max-h-[85vh] flex flex-col dark:border-slate-700 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
              <div>
                <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                  Histórico do Número · <span className="font-mono">{phoneHistTarget}</span>
                </h3>
                <p className="text-slate-500 dark:text-slate-400">
                  Contato: {phoneHistContact} · {phoneHistTotal} mensagem(ns) localizada(s)
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPhoneHistTarget(null)}
                className="rounded-lg p-1 text-slate-400 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
              {phoneHistLoading ? (
                <div className="py-8 text-center text-slate-500 dark:text-slate-400">Carregando histórico do telefone...</div>
              ) : phoneHistRows.length === 0 ? (
                <div className="py-8 text-center text-slate-500 dark:text-slate-400">Nenhum registro para este telefone.</div>
              ) : (
                phoneHistRows.map((row) => (
                  <div key={row.id} className="py-2.5 space-y-1">
                    <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                      <span className="font-semibold text-slate-800 dark:text-slate-100">
                        {row.direction === 'inbound' ? 'Cliente → Equipe' : `${row.operatorName || 'Operador'} → Cliente`}
                      </span>
                      <span className="font-mono tabular-nums">{formatDateTimeBR(row.createdAt)}</span>
                    </div>
                    <div className="text-slate-800 whitespace-pre-wrap dark:text-slate-100">{row.body}</div>
                  </div>
                ))
              )}
            </div>

            <div className="flex items-center justify-between border-t border-slate-100 pt-3 dark:border-slate-800">
              <span className="font-mono text-slate-500 tabular-nums dark:text-slate-400">
                Página {phoneHistPage} de {phoneHistPages}
              </span>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  disabled={phoneHistPage <= 1}
                  onClick={() => setPhoneHistPage((p) => Math.max(1, p - 1))}
                  className="rounded border border-slate-200 px-2.5 py-1 font-semibold disabled:opacity-40 dark:border-slate-700"
                >
                  Anterior
                </button>
                <button
                  type="button"
                  disabled={phoneHistPage >= phoneHistPages}
                  onClick={() => setPhoneHistPage((p) => Math.min(phoneHistPages, p + 1))}
                  className="rounded border border-slate-200 px-2.5 py-1 font-semibold disabled:opacity-40 dark:border-slate-700"
                >
                  Próxima
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: NOVO / EDITAR CANAL GOTALK */}
      {chModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 dark:bg-slate-950/80">
          <form
            onSubmit={handleSaveChannel}
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl space-y-4 text-xs dark:border-slate-700 dark:bg-slate-900"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
              <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                {editChId ? 'Editar Canal GoTalk' : 'Adicionar Canal GoTalk'}
              </h3>
              <button
                type="button"
                onClick={() => setChModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {chErr && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-700 dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300">{chErr}</div>
            )}

            <div className="space-y-3">
              <div>
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Nome do Canal *</label>
                <input
                  type="text"
                  required
                  value={chName}
                  onChange={(e) => setChName(e.target.value)}
                  placeholder="Ex: Central Oficial Matriz"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Telefone</label>
                <input
                  type="text"
                  value={chPhone}
                  onChange={(e) => setChPhone(formatPhoneMask(e.target.value))}
                  placeholder="(81) 99988-7766"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono tabular-nums dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Unidade Associada</label>
                <select
                  value={chUnitId}
                  onChange={(e) => setChUnitId(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                >
                  <option value="">Global (Todas as Unidades)</option>
                  {units.map((u) => (
                    <option key={u.id} value={String(u.id)}>
                      {u.code} · {u.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Notas Operacionais</label>
                <textarea
                  rows={2}
                  value={chNotes}
                  onChange={(e) => setChNotes(e.target.value)}
                  placeholder="Observações sobre fila, horário ou finalidade deste canal..."
                  className="w-full rounded-lg border border-slate-200 p-2.5 dark:border-slate-700"
                />
              </div>
              <div className="flex flex-col gap-2">
                <label className="flex items-center gap-2 cursor-pointer font-medium text-slate-800 dark:text-slate-100">
                  <input
                    type="checkbox"
                    checked={chPrimary}
                    onChange={(e) => setChPrimary(e.target.checked)}
                  />
                  <span>Definir como Canal Principal (desmarca os demais)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer font-medium text-slate-800 dark:text-slate-100">
                  <input
                    type="checkbox"
                    checked={chActive}
                    onChange={(e) => setChActive(e.target.checked)}
                  />
                  <span>Canal ativo</span>
                </label>
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setChModalOpen(false)}
                className="rounded-lg border border-slate-200 px-3.5 py-2 font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={chSaving}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-emerald-600 dark:hover:bg-emerald-500"
              >
                <Check className="w-3.5 h-3.5" />
                {chSaving ? 'Salvando...' : 'Salvar Canal'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL: ENVIAR TEMPLATE HSM COM VARIÁVEIS {{n}} E ATALHO CTRL/⌘+ENTER */}
      {hsmModalOpen && selectedAtt && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 dark:bg-slate-950/80"
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
              e.preventDefault();
              handleSendHsm();
            }
          }}
        >
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl space-y-4 text-xs dark:border-slate-700 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                  Disparar Template HSM · {selectedAtt.linkedEntityLabel}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setHsmModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {templates.length === 0 ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900 dark:border-amber-800/70 dark:bg-amber-950/50 dark:text-amber-300">
                Nenhum template HSM sincronizado ainda. Clique em &ldquo;Autenticar &amp; Sincronizar&rdquo; no topo da aba.
              </div>
            ) : (
              <>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Template Aprovado *</label>
                  <select
                    value={activeTemplate?.templateName || ''}
                    onChange={(e) => {
                      setSelectedTemplateName(e.target.value);
                      setHsmVars({});
                    }}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono dark:border-slate-700"
                  >
                    {templates.map((t) => (
                      <option key={t.id} value={t.templateName}>
                        {t.templateName} ({t.language || 'pt_BR'})
                      </option>
                    ))}
                  </select>
                </div>

                {detectedVarKeys.length > 0 && (
                  <div className="space-y-2">
                    <div className="font-semibold text-slate-700 dark:text-slate-200">
                      Preencha as Variáveis Obrigatórias ({detectedVarKeys.length})
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {detectedVarKeys.map((k) => (
                        <div key={k}>
                          <label className="block font-mono text-[11px] text-slate-500 mb-0.5 dark:text-slate-400">
                            Variável {`{{${k}}}`} *
                          </label>
                          <input
                            type="text"
                            value={hsmVars[k] || ''}
                            onChange={(e) => setHsmVars((prev) => ({ ...prev, [k]: e.target.value }))}
                            placeholder={`Valor para {{${k}}}`}
                            className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 dark:border-slate-700"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {activeTemplate && (
                  <div className="space-y-1">
                    <div className="font-semibold text-slate-700 dark:text-slate-200">Pré-visualização da Mensagem</div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-1.5 dark:border-slate-700 dark:bg-slate-800/70">
                      {activeTemplate.headerText && (
                        <div className="font-bold text-slate-900 dark:text-slate-100">{activeTemplate.headerText}</div>
                      )}
                      <div className="whitespace-pre-wrap text-slate-800 leading-relaxed dark:text-slate-100">
                        {renderedHsmPreview}
                      </div>
                      {activeTemplate.footerText && (
                        <div className="text-[11px] text-slate-400 dark:text-slate-400">{activeTemplate.footerText}</div>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}

            {hsmErr && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-700 dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300">{hsmErr}</div>
            )}

            <div className="flex items-center justify-between border-t border-slate-100 pt-3 dark:border-slate-800">
              <span className="text-[11px] text-slate-400 dark:text-slate-400">Atalho: Ctrl/⌘ + Enter</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setHsmModalOpen(false)}
                  className="rounded-lg border border-slate-200 px-3.5 py-2 font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={hsmSending || !activeTemplate || !allHsmVarsFilled}
                  onClick={handleSendHsm}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
                >
                  <Send className="w-3.5 h-3.5" />
                  {hsmSending ? 'Enviando...' : 'Disparar Template'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <ConfirmDeleteModal
        open={Boolean(deleteChTarget)}
        title={`Remover Canal GoTalk · ${deleteChTarget?.name || ''}`}
        description="As conversas históricas vinculadas a este canal serão preservadas sem perda de mensagens."
        busy={deleteChBusy}
        onCancel={() => setDeleteChTarget(null)}
        onConfirm={async () => {
          if (!deleteChTarget) return;
          setDeleteChBusy(true);
          try {
            await apiFetch(`/api/config/gotalk/channels/${deleteChTarget.id}`, { method: 'DELETE' });
            onToast(`Canal "${deleteChTarget.name}" removido.`);
            setDeleteChTarget(null);
            await onRefreshConfig();
          } finally {
            setDeleteChBusy(false);
          }
        }}
      />
    </div>
  );
};
