import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  BellRing,
  Bot,
  Building2,
  CheckCheck,
  Filter,
  History,
  Lock,
  MailCheck,
  MessageSquareText,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { apiFetch, formatDateTimeBR } from '../../lib/api.ts';
import { AuthUser, ModuleId, NavigationIntent, Unit } from '../../types.ts';
import { EntityAuditModal } from './cadastros/CadastrosShared.tsx';

interface SectorSummaryItem {
  sector: string;
  label: string;
  shortLabel: string;
  defaultModuleId: ModuleId;
  unreadMessages: number;
  autoIviUnread: number;
  manualUnread: number;
  totalMessages: number;
  latestMessageAt: string | null;
  latestSubject: string;
}

interface InternalMessageItem {
  id: number;
  senderId: number | null;
  senderName: string;
  senderGroupId: number | null;
  senderGroupName?: string;
  recipientId: number | null;
  recipientName?: string;
  targetSector: string;
  sectorLabel: string;
  sectorShortLabel: string;
  targetModuleId: ModuleId;
  targetGroupId: number | null;
  targetGroupName: string;
  targetUnitId: number | null;
  targetUnitName: string;
  isAutoIvi: boolean;
  eventType: string;
  relatedEntityType: string;
  relatedEntityId: string;
  subject: string;
  body: string;
  isUnread: boolean;
  isRead: boolean;
  createdAt: string;
}

interface MessagingCapabilities {
  isAdmin: boolean;
  ownGroupId: number | null;
  ownGroupName: string;
  activeUnitId: number | null;
  availableGroups: Array<{ id: number; name: string; description?: string }>;
  availableUnits: Array<{ id: number; code: string; name: string }>;
  availableRecipients: Array<{
    id: number;
    name: string;
    email: string;
    groupId: number | null;
    role: string;
  }>;
}

interface InternalMessagingPayload {
  messages: InternalMessageItem[];
  sectorSummary: SectorSummaryItem[];
  totalUnreadMessages: number;
  capabilities: MessagingCapabilities;
}

interface InternalMessagingModuleProps {
  currentUser: AuthUser;
  units: Unit[];
  activeUnitId: number;
  wsTick: number;
  navIntent: NavigationIntent | null;
  onClearIntent: () => void;
  onNavigate: (mod: ModuleId, intent?: NavigationIntent) => void;
  onMessagesUpdated?: () => void;
}

export const InternalMessagingModule: React.FC<InternalMessagingModuleProps> = ({
  currentUser,
  activeUnitId,
  wsTick,
  navIntent,
  onClearIntent,
  onNavigate,
  onMessagesUpdated,
}) => {
  const [data, setData] = useState<InternalMessagingPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');

  // Feed filters
  const [selectedSectorFilter, setSelectedSectorFilter] = useState<string>('all');
  const [originFilter, setOriginFilter] = useState<'all' | 'unread' | 'ivi' | 'manual'>('all');
  const [searchTerm, setSearchTerm] = useState('');

  // Composer state
  const [targetSector, setTargetSector] = useState('juridico');
  const [targetGroupId, setTargetGroupId] = useState<string>('');
  const [targetUnitId, setTargetUnitId] = useState<string>('');
  const [recipientId, setRecipientId] = useState<string>('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [markingRead, setMarkingRead] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);

  const loadMessages = useCallback(async () => {
    setError('');
    try {
      const res = await apiFetch<InternalMessagingPayload>('/api/internal-messages');
      setData(res);

      // Initialize composer group & unit cleanly based on role
      setTargetGroupId((prev) => {
        if (!res.capabilities.isAdmin) {
          return res.capabilities.ownGroupId ? String(res.capabilities.ownGroupId) : '';
        }
        return prev || 'ALL';
      });
      setTargetUnitId((prev) => {
        if (!res.capabilities.isAdmin) {
          const fallbackUnit =
            res.capabilities.availableUnits.find((u) => u.id === activeUnitId)?.id ||
            res.capabilities.availableUnits[0]?.id ||
            activeUnitId;
          return fallbackUnit ? String(fallbackUnit) : '';
        }
        return prev || 'ALL';
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar mensageria interna.');
    } finally {
      setLoading(false);
    }
  }, [activeUnitId]);

  useEffect(() => {
    loadMessages();
  }, [loadMessages, wsTick, activeUnitId]);

  useEffect(() => {
    if (navIntent?.tab) {
      setSelectedSectorFilter(navIntent.tab);
      onClearIntent();
    }
  }, [navIntent, onClearIntent]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subject.trim() || !body.trim()) return;
    setSending(true);
    setError('');
    setFeedback('');
    try {
      const caps = data?.capabilities;
      const isAdmin = caps?.isAdmin ?? currentUser.role === 'admin';
      const resolvedGroupPayload = isAdmin
        ? targetGroupId === 'ALL' || !targetGroupId
          ? 'ALL'
          : Number(targetGroupId)
        : caps?.ownGroupId || currentUser.groupId;

      const resolvedUnitPayload = isAdmin
        ? targetUnitId === 'ALL' || !targetUnitId
          ? 'ALL'
          : Number(targetUnitId)
        : Number(targetUnitId || activeUnitId);

      await apiFetch('/api/internal-messages', {
        method: 'POST',
        body: JSON.stringify({
          targetSector,
          targetGroupId: resolvedGroupPayload,
          targetUnitId: resolvedUnitPayload,
          recipientId: recipientId ? Number(recipientId) : null,
          subject: subject.trim(),
          body: body.trim(),
        }),
      });
      setSubject('');
      setBody('');
      setRecipientId('');
      setFeedback('Mensagem enviada e sinalizador do setor atualizado em tempo real.');
      await loadMessages();
      onMessagesUpdated?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao enviar mensagem.');
    } finally {
      setSending(false);
    }
  };

  const handleMarkRead = async (opts: { messageIds?: number[]; sector?: string; markAll?: boolean }) => {
    setMarkingRead(true);
    setError('');
    try {
      await apiFetch('/api/internal-messages/mark-read', {
        method: 'POST',
        body: JSON.stringify(opts),
      });
      await loadMessages();
      onMessagesUpdated?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao confirmar leitura.');
    } finally {
      setMarkingRead(false);
    }
  };

  const filteredMessages = useMemo(() => {
    const list = data?.messages || [];
    const q = searchTerm.trim().toLowerCase();
    return list.filter((m) => {
      if (selectedSectorFilter !== 'all' && m.targetSector !== selectedSectorFilter) return false;
      if (originFilter === 'unread' && !m.isUnread) return false;
      if (originFilter === 'ivi' && !m.isAutoIvi) return false;
      if (originFilter === 'manual' && m.isAutoIvi) return false;
      if (!q) return true;
      const hay = `${m.subject} ${m.body} ${m.senderName} ${m.sectorLabel} ${m.targetGroupName} ${m.targetUnitName} ${m.recipientName || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [data?.messages, selectedSectorFilter, originFilter, searchTerm]);

  const caps = data?.capabilities;
  const isAdmin = caps?.isAdmin ?? currentUser.role === 'admin';
  const sectorSummary = data?.sectorSummary || [];
  const totalUnread = data?.totalUnreadMessages || 0;
  const activeSectorObj =
    selectedSectorFilter !== 'all'
      ? sectorSummary.find((s) => s.sector === selectedSectorFilter) || null
      : null;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold text-blue-700 dark:text-blue-400">
            <MessageSquareText className="w-4 h-4" />
            <span>Operação &amp; Tratativa · Comunicação Intersetorial</span>
          </div>
          <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Mensageria Interna &amp; Alertas Ivi
          </h1>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Transições automáticas entre setores disparadas pela Ivi e comunicados direcionados por grupo e unidade.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setAuditOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 min-h-[38px]"
          >
            <History className="w-3.5 h-3.5" />
            Auditoria
          </button>
          <button
            type="button"
            onClick={() => loadMessages()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 min-h-[38px]"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Atualizar
          </button>
          {totalUnread > 0 && (
            <button
              type="button"
              disabled={markingRead}
              onClick={() => handleMarkRead({ markAll: true })}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 min-h-[38px]"
            >
              <CheckCheck className="w-3.5 h-3.5" />
              Marcar Todas como Lidas ({totalUnread})
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/50 px-4 py-3 text-xs font-medium text-red-700 dark:text-red-300">
          {error}
        </div>
      )}
      {feedback && (
        <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/50 px-4 py-3 text-xs font-medium text-emerald-800 dark:text-emerald-300">
          {feedback}
        </div>
      )}

      {/* Live Sector Monitor Strip (Blinking Dots + Badges) */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-800 dark:text-slate-100">
            <BellRing className="w-4 h-4 text-amber-600 dark:text-amber-400" />
            <span>Painel de Movimentações &amp; Novas Mensagens por Setor</span>
          </div>
          <span className="text-[11px] text-slate-500 dark:text-slate-400">
            Setores com sinalizador piscando possuem movimentações ou mensagens não lidas
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
          <button
            type="button"
            onClick={() => setSelectedSectorFilter('all')}
            className={`text-left rounded-lg border p-3 transition-colors ${
              selectedSectorFilter === 'all'
                ? 'border-slate-900 bg-slate-900 text-white dark:border-emerald-500 dark:bg-emerald-600'
                : 'border-slate-200 bg-slate-50/70 hover:bg-slate-100 text-slate-800 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <div className="flex items-center justify-between gap-1.5">
              <span className="text-xs font-bold truncate">Todos os Setores</span>
              {totalUnread > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/20 px-2 py-0.5 font-mono text-[11px] font-bold text-amber-600 dark:text-amber-300">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500" />
                  </span>
                  {totalUnread}
                </span>
              )}
            </div>
            <div className={`mt-1 text-[11px] ${selectedSectorFilter === 'all' ? 'text-slate-200' : 'text-slate-500 dark:text-slate-400'}`}>
              {data?.messages.length || 0} registro(s) visíveis
            </div>
          </button>

          {sectorSummary.map((sec) => {
            const isSelected = selectedSectorFilter === sec.sector;
            const hasUnread = sec.unreadMessages > 0;
            return (
              <button
                key={sec.sector}
                type="button"
                onClick={() => setSelectedSectorFilter(sec.sector)}
                className={`text-left rounded-lg border p-3 transition-colors ${
                  isSelected
                    ? 'border-slate-900 bg-slate-900 text-white dark:border-emerald-500 dark:bg-emerald-600'
                    : hasUnread
                    ? 'border-amber-300 bg-amber-50/70 hover:bg-amber-100/70 text-slate-900 dark:border-amber-700/70 dark:bg-amber-950/30 dark:text-slate-100'
                    : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800'
                }`}
              >
                <div className="flex items-center justify-between gap-1.5">
                  <span className="text-xs font-bold truncate">{sec.shortLabel}</span>
                  {hasUnread ? (
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-mono text-[10px] font-bold tabular-nums ${
                        isSelected
                          ? 'bg-white/20 text-white'
                          : 'bg-red-100 text-red-700 dark:bg-red-900/60 dark:text-red-200'
                      }`}
                    >
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75" />
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-red-600 dark:bg-red-400" />
                      </span>
                      {sec.unreadMessages}
                    </span>
                  ) : (
                    <span className="font-mono text-[10px] text-slate-400">0</span>
                  )}
                </div>
                <div
                  className={`mt-1 text-[10px] truncate ${
                    isSelected ? 'text-slate-200' : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  {sec.label}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Split: Composer + Feed */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left: Composer (Strict RBAC per Requirement 02) */}
        <div className="lg:col-span-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4 h-fit">
          <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-100 dark:border-slate-800">
            <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
              Enviar Mensagem Manual
            </h2>
            {isAdmin ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 px-2.5 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">
                <ShieldCheck className="w-3 h-3" />
                Admin Global
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 px-2.5 py-0.5 text-[10px] font-bold text-amber-800 dark:text-amber-300">
                <Lock className="w-3 h-3" />
                Restrito ao Grupo
              </span>
            )}
          </div>

          <div
            className={`rounded-lg border p-3 text-[11px] leading-relaxed ${
              isAdmin
                ? 'border-emerald-200 bg-emerald-50/70 text-emerald-900 dark:border-emerald-800/70 dark:bg-emerald-950/30 dark:text-emerald-200'
                : 'border-amber-200 bg-amber-50/70 text-amber-900 dark:border-amber-800/70 dark:bg-amber-950/30 dark:text-amber-200'
            }`}
          >
            {isAdmin ? (
              <span>
                Perfil <strong>Administrador</strong>: você pode direcionar mensagens para{' '}
                <strong>todos os grupos</strong> e <strong>todas as unidades</strong> da empresa ou selecionar um destino específico.
              </span>
            ) : (
              <span>
                Regra corporativa ativa: usuários enviam mensagens{' '}
                <strong>exclusivamente para seu grupo ({caps?.ownGroupName || 'Sem grupo'})</strong> e unidade autorizada.
              </span>
            )}
          </div>

          <form onSubmit={handleSend} className="space-y-3">
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                Setor de Destino (Sinalizador &amp; Badge)
              </label>
              <select
                value={targetSector}
                onChange={(e) => setTargetSector(e.target.value)}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs font-medium text-slate-900 dark:text-slate-100"
              >
                <option value="agendamentos">Agendamentos</option>
                <option value="prospeccao">Comercial → Prospecção</option>
                <option value="admissao">Comercial → Admissão</option>
                <option value="auditoria">Auditoria &amp; Boletos</option>
                <option value="juridico">Jurídico &amp; Escavador</option>
                <option value="negociacoes">Negociações Bancárias</option>
                <option value="financeiro">Receita → Administração Financeira</option>
                <option value="cobranca">Receita → Cobrança &amp; Ranking</option>
                <option value="geral">Geral / Empresa</option>
              </select>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="flex items-center gap-1 text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  <Users className="w-3 h-3" />
                  Grupo de Usuários
                </label>
                <select
                  value={targetGroupId}
                  disabled={!isAdmin}
                  onChange={(e) => setTargetGroupId(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-2 text-xs font-medium text-slate-900 dark:text-slate-100 disabled:bg-slate-100 disabled:text-slate-600 dark:disabled:bg-slate-800 dark:disabled:text-slate-300"
                >
                  {isAdmin && <option value="ALL">Todos os Grupos da Empresa</option>}
                  {(caps?.availableGroups || []).map((g) => (
                    <option key={g.id} value={String(g.id)}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="flex items-center gap-1 text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  <Building2 className="w-3 h-3" />
                  Unidade
                </label>
                <select
                  value={targetUnitId}
                  onChange={(e) => setTargetUnitId(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-2 text-xs font-medium text-slate-900 dark:text-slate-100"
                >
                  {isAdmin && <option value="ALL">Todas as Unidades da Empresa</option>}
                  {(caps?.availableUnits || []).map((u) => (
                    <option key={u.id} value={String(u.id)}>
                      {u.code} · {u.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                Destinatário Específico (Opcional · {isAdmin ? 'Todos os colaboradores' : 'Membros do seu grupo'})
              </label>
              <select
                value={recipientId}
                onChange={(e) => setRecipientId(e.target.value)}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-2 text-xs font-medium text-slate-900 dark:text-slate-100"
              >
                <option value="">Todos do grupo / setor selecionado</option>
                {(caps?.availableRecipients || []).map((u) => (
                  <option key={u.id} value={String(u.id)}>
                    {u.name} ({u.role})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                Assunto
              </label>
              <input
                type="text"
                required
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Ex: Priorizar conferência documental ou retorno ao banco..."
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                Mensagem
              </label>
              <textarea
                rows={4}
                required
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Descreva a tarefa, encaminhamento ou aviso para o setor..."
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
              />
            </div>

            <button
              type="submit"
              disabled={sending || (!isAdmin && !caps?.ownGroupId)}
              className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 dark:bg-emerald-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-slate-800 dark:hover:bg-emerald-500 disabled:opacity-50 min-h-[40px]"
            >
              <Send className="w-3.5 h-3.5" />
              {sending ? 'Enviando...' : 'Enviar Mensagem ao Setor'}
            </button>
          </form>
        </div>

        {/* Right: Feed of Ivi Automations & Manual Messages */}
        <div className="lg:col-span-7 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden flex flex-col">
          <div className="p-4 border-b border-slate-100 dark:border-slate-800 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                  {activeSectorObj ? activeSectorObj.label : 'Caixa de Mensagens & Movimentações'}
                </h2>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  {filteredMessages.length} mensagem(ns) exibida(s)
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {activeSectorObj && activeSectorObj.unreadMessages > 0 && (
                  <button
                    type="button"
                    disabled={markingRead}
                    onClick={() => handleMarkRead({ sector: activeSectorObj.sector })}
                    className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/50 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100"
                  >
                    <MailCheck className="w-3.5 h-3.5" />
                    Marcar setor como lido
                  </button>
                )}
                {activeSectorObj && activeSectorObj.defaultModuleId !== 'internal_messaging' && (
                  <button
                    type="button"
                    onClick={() => onNavigate(activeSectorObj.defaultModuleId)}
                    className="inline-flex items-center gap-1 rounded-lg bg-slate-900 dark:bg-slate-700 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-slate-800"
                  >
                    Ir para {activeSectorObj.shortLabel}
                    <ArrowRight className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Buscar por assunto, cliente, grupo ou remetente..."
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 pl-8 pr-3 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                />
              </div>
              <div className="flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 p-1">
                <Filter className="w-3.5 h-3.5 text-slate-400 ml-1.5 mr-1 shrink-0" />
                {[
                  { key: 'all', label: 'Todas' },
                  { key: 'unread', label: 'Não lidas' },
                  { key: 'ivi', label: 'Ivi Auto' },
                  { key: 'manual', label: 'Manuais' },
                ].map((opt) => (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => setOriginFilter(opt.key as typeof originFilter)}
                    className={`rounded-md px-2 py-1 text-[11px] font-semibold transition-colors ${
                      originFilter === opt.key
                        ? 'bg-slate-900 text-white dark:bg-emerald-600'
                        : 'text-slate-600 hover:bg-white dark:text-slate-300 dark:hover:bg-slate-800'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {loading ? (
            <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">
              Carregando mensageria interna...
            </div>
          ) : filteredMessages.length === 0 ? (
            <div className="p-10 text-center space-y-2">
              <MessageSquareText className="w-8 h-8 text-slate-300 dark:text-slate-600 mx-auto" />
              <div className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                Nenhuma mensagem para este filtro
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Novas notificações da Ivi ao passar tarefas entre setores ou envios manuais aparecerão aqui em tempo real.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-[680px] overflow-y-auto">
              {filteredMessages.map((m) => (
                <div
                  key={m.id}
                  className={`p-4 space-y-2 transition-colors ${
                    m.isUnread
                      ? 'bg-amber-50/40 dark:bg-amber-950/15'
                      : 'hover:bg-slate-50/60 dark:hover:bg-slate-800/40'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {m.isUnread && (
                        <span
                          title="Nova movimentação / mensagem não lida"
                          className="relative flex h-2.5 w-2.5 mr-0.5"
                        >
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75" />
                          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-600" />
                        </span>
                      )}
                      <span
                        className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold ${
                          m.isAutoIvi
                            ? 'bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800'
                            : 'bg-slate-100 text-slate-700 border border-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700'
                        }`}
                      >
                        {m.isAutoIvi ? <Bot className="w-3 h-3" /> : <Send className="w-3 h-3" />}
                        {m.isAutoIvi ? 'Ivi Automação' : 'Envio Manual'}
                      </span>
                      <span className="rounded-md bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">
                        {m.sectorLabel}
                      </span>
                      <span className="rounded-md bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-2 py-0.5 text-[10px] font-medium text-slate-600 dark:text-slate-300">
                        {m.targetGroupName}
                      </span>
                      <span className="rounded-md bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-2 py-0.5 text-[10px] font-medium text-slate-600 dark:text-slate-300">
                        {m.targetUnitName}
                      </span>
                    </div>
                    <span className="font-mono text-[10px] text-slate-400 dark:text-slate-500">
                      {formatDateTimeBR(m.createdAt)}
                    </span>
                  </div>

                  <div>
                    <div className="text-xs font-bold text-slate-900 dark:text-slate-100">{m.subject}</div>
                    <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300 leading-relaxed whitespace-pre-line">
                      {m.body}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      De: <strong className="text-slate-700 dark:text-slate-200">{m.senderName}</strong>
                      {m.recipientName && (
                        <>
                          {' '}
                          · Para: <strong className="text-slate-700 dark:text-slate-200">{m.recipientName}</strong>
                        </>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      {m.isUnread && (
                        <button
                          type="button"
                          disabled={markingRead}
                          onClick={() => handleMarkRead({ messageIds: [m.id] })}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-[11px] font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
                        >
                          <CheckCheck className="w-3 h-3 text-emerald-600" />
                          Confirmar leitura
                        </button>
                      )}
                      {m.targetModuleId && m.targetModuleId !== 'internal_messaging' && (
                        <button
                          type="button"
                          onClick={() => {
                            if (m.isUnread) {
                              handleMarkRead({ messageIds: [m.id] });
                            }
                            onNavigate(m.targetModuleId);
                          }}
                          className="inline-flex items-center gap-1 rounded-md bg-slate-900 dark:bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-slate-800 dark:hover:bg-emerald-500"
                        >
                          Abrir Setor
                          <ArrowRight className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <EntityAuditModal
        open={auditOpen}
        title="Mensageria Interna & Alertas Ivi · Auditoria"
        entityType="internal_messages"
        entityId="all"
        onClose={() => setAuditOpen(false)}
      />
    </div>
  );
};
