import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertOctagon,
  ArrowUpRight,
  CheckCircle2,
  ChevronDown,
  ClipboardPaste,
  MessageSquarePlus,
  PauseCircle,
  Send,
  UserCog,
} from 'lucide-react';
import { apiFetch, formatBRL, formatDateBR, formatDateTimeBR } from '../../lib/api.ts';
import {
  AuthUser,
  Client,
  CollaboratorItem,
  CollectionCase,
  CollectionNote,
  FinancialTitle,
  ModuleId,
  NavigationIntent,
  TitleSettlement,
  Unit,
  UserGroup,
} from '../../types.ts';
import { CollapsibleFilterBar } from '../CollapsibleFilterBar.tsx';
import { CollectionCoordinatorView } from './CollectionCoordinatorView.tsx';
import { computeAgingDays } from './CollectionCoordinatorModalViews.tsx';
import { CollaboratorRankingTables } from './CollaboratorRankingTables.tsx';

interface CollectionModuleProps {
  units: Unit[];
  currentUser?: AuthUser | null;
  group?: UserGroup | null;
  activeSubmenu?: 'coordenacao' | 'operacional';
  wsTick: number;
  copiedWhatsappText?: string;
  navIntent?: NavigationIntent | null;
  onClearIntent?: () => void;
  onNavigate?: (mod: ModuleId, intent?: NavigationIntent) => void;
}

interface UnifiedQueueRow {
  key: string;
  caseId: number | null;
  titleId: number;
  clientId: number;
  unitId: number;
  stateCode: string;
  priorityValueCents: number;
  status: string;
  pointsAwarded: number;
  conversationSummary: string;
  assignedCollaboratorId: number | null;
  dueDate: string;
  agingDays: number;
  titleCode: string;
  documentNumber: string;
}

const EXCLUDED_OVERDUE_STATUSES = new Set([
  'PAGO',
  'CANCELADO',
  'AGRUPADO',
  'FATURA_GERADA',
  'ADIANTAMENTO',
  'ADIANTAMENTO_PARCIAL',
  'DEVOLUCAO',
  'DEVOLUCAO_VINCULADA',
  'DEVOLUCAO_PARCIAL',
]);

export const CollectionModule: React.FC<CollectionModuleProps> = ({
  units,
  currentUser = null,
  group = null,
  activeSubmenu = 'operacional',
  wsTick,
  copiedWhatsappText,
  navIntent,
  onClearIntent,
  onNavigate,
}) => {
  const [cases, setCases] = useState<CollectionCase[]>([]);
  const [titles, setTitles] = useState<FinancialTitle[]>([]);
  const [settlements, setSettlements] = useState<TitleSettlement[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [collaborators, setCollaborators] = useState<CollaboratorItem[]>([]);
  const [notes, setNotes] = useState<CollectionNote[]>([]);
  const [categories, setCategories] = useState<
    Array<{ id: number; name: string; providerCode: string }>
  >([]);
  const [operators, setOperators] = useState<
    Array<{ id: number; name: string; role: string; points: number }>
  >([]);

  const [tab, setTab] = useState<'fila' | 'ranking'>('fila');
  const [unitFilter, setUnitFilter] = useState('all');
  const [periodFilter, setPeriodFilter] = useState('30d');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [stateFilter, setStateFilter] = useState('all');

  const [selectedTitleId, setSelectedTitleId] = useState<number | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('');
  const [summaryDraft, setSummaryDraft] = useState('');

  // Registro de Tratativa / Solicitação de Cancelamento (CollectionNotes no PostgreSQL)
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteChannel, setNoteChannel] = useState<'TELEFONE' | 'WHATSAPP' | 'EMAIL' | 'PRESENCIAL'>('TELEFONE');
  const [noteNegotiationStatus, setNoteNegotiationStatus] = useState<
    'AGUARDANDO_CONTATO' | 'ENCAMINHOU_BOLETO' | 'RECUSA_DIVIDA' | 'FECHADA' | 'OUTROS' | 'SOLICITA_CANCELAMENTO'
  >('AGUARDANDO_CONTATO');
  const [noteContract, setNoteContract] = useState('');
  const [noteText, setNoteText] = useState('');

  const [riskSectionOpen, setRiskSectionOpen] = useState(false);
  const [statusReason, setStatusReason] = useState('');
  const [cancelFutureTitles, setCancelFutureTitles] = useState(true);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const [errToast, setErrToast] = useState('');

  const [pendingClientIntent, setPendingClientIntent] = useState<number | undefined>(undefined);
  const [pendingTitleIntent, setPendingTitleIntent] = useState<number | undefined>(undefined);

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<{
        cases: CollectionCase[];
        titles: FinancialTitle[];
        settlements?: TitleSettlement[];
        clients: Client[];
        collaborators?: CollaboratorItem[];
        notes?: CollectionNote[];
        categories: Array<{ id: number; name: string; providerCode: string }>;
        operators: Array<{ id: number; name: string; role: string; points: number }>;
      }>('/api/collection');
      setCases(data.cases);
      setTitles(data.titles);
      setSettlements(data.settlements || []);
      setClients(data.clients);
      setCollaborators(data.collaborators || []);
      setNotes(data.notes || []);
      setCategories(data.categories);
      setOperators(data.operators);
      if (!selectedCategoryId && data.categories[0]) {
        setSelectedCategoryId(String(data.categories[0].id));
      }
    } catch (err) {
      setErrToast(err instanceof Error ? err.message : 'Erro ao carregar módulo operacional.');
    }
  }, [selectedCategoryId]);

  useEffect(() => {
    if (activeSubmenu === 'operacional') {
      void load();
    }
  }, [activeSubmenu, wsTick, load]);

  useEffect(() => {
    if (!navIntent) return;
    if (navIntent.clientId) setPendingClientIntent(navIntent.clientId);
    if (navIntent.titleId) setPendingTitleIntent(navIntent.titleId);
    if (navIntent.tab === 'ranking') setTab('ranking');
    if (activeSubmenu === 'operacional' && navIntent.clientId) {
      const matchCase = cases.find((c) => c.clientId === navIntent.clientId);
      if (matchCase) {
        setSelectedTitleId(matchCase.titleId);
        setSummaryDraft(matchCase.conversationSummary || '');
        setTab('fila');
      } else {
        const matchTitle = titles.find(
          (t) =>
            t.clientId === navIntent.clientId &&
            (t.scope || 'RECEBER') === 'RECEBER' &&
            !EXCLUDED_OVERDUE_STATUSES.has(String(t.status || '').toUpperCase())
        );
        if (matchTitle) {
          setSelectedTitleId(matchTitle.id);
          setTab('fila');
        }
      }
    }
    onClearIntent?.();
  }, [navIntent, activeSubmenu, cases, titles, onClearIntent]);

  useEffect(() => {
    if (copiedWhatsappText) {
      setSummaryDraft((prev) =>
        prev
          ? `${prev}\n[WhatsApp Copiado]: ${copiedWhatsappText}`
          : `[WhatsApp Copiado]: ${copiedWhatsappText}`
      );
    }
  }, [copiedWhatsappText]);

  const clientMap = useMemo(() => new Map(clients.map((c) => [c.id, c])), [clients]);
  const collabMap = useMemo(() => new Map(collaborators.map((c) => [c.id, c])), [collaborators]);
  const titleMap = useMemo(() => new Map(titles.map((t) => [t.id, t])), [titles]);

  // Unifica collection_cases + títulos a receber vencidos/em cobrança para total sincronia com Coordenação
  const unifiedQueue = useMemo<UnifiedQueueRow[]>(() => {
    const byTitleId = new Map<number, UnifiedQueueRow>();

    for (const c of cases) {
      const t = titleMap.get(c.titleId);
      const cl = clientMap.get(c.clientId);
      const days = t ? computeAgingDays(t.dueDate) : 0;
      byTitleId.set(c.titleId, {
        key: `case-${c.id}`,
        caseId: c.id,
        titleId: c.titleId,
        clientId: c.clientId,
        unitId: c.unitId,
        stateCode: (c.stateCode || cl?.state || 'PE').toUpperCase(),
        priorityValueCents: Number(
          t ? t.currentBalanceCents ?? t.amountCents : c.priorityValueCents || 0
        ),
        status: c.status,
        pointsAwarded: c.pointsAwarded,
        conversationSummary: c.conversationSummary || '',
        assignedCollaboratorId: t?.assignedCollaboratorId ?? null,
        dueDate: t?.dueDate || '',
        agingDays: days,
        titleCode: t?.titleCode || `#${c.titleId}`,
        documentNumber: t?.documentNumber || t?.titleCode || `#${c.titleId}`,
      });
    }

    for (const t of titles) {
      if ((t.scope || 'RECEBER') !== 'RECEBER') continue;
      if (String(t.titleType || 'PADRAO').toUpperCase() !== 'PADRAO') continue;
      const upperStatus = String(t.status || '').toUpperCase();
      if (EXCLUDED_OVERDUE_STATUSES.has(upperStatus)) continue;

      const days = computeAgingDays(t.dueDate);
      const sit = String(t.collectionStatus || 'COBRAR').toUpperCase();
      // Inclui no operacional todo título vencido OU explicitamente atribuído/marcado como COBRAR
      if (days <= 0 && sit !== 'COBRAR' && !t.assignedCollaboratorId) continue;

      if (!byTitleId.has(t.id)) {
        const cl = clientMap.get(t.clientId);
        byTitleId.set(t.id, {
          key: `title-${t.id}`,
          caseId: null,
          titleId: t.id,
          clientId: t.clientId,
          unitId: t.unitId,
          stateCode: (cl?.state || 'PE').toUpperCase(),
          priorityValueCents: Number(t.currentBalanceCents ?? t.amountCents ?? 0),
          status:
            cl?.status === 'suspenso'
              ? 'suspenso'
              : cl?.status === 'cancelado'
              ? 'cancelado'
              : 'em_cobranca',
          pointsAwarded: 0,
          conversationSummary: '',
          assignedCollaboratorId: t.assignedCollaboratorId ?? null,
          dueDate: t.dueDate,
          agingDays: days,
          titleCode: t.titleCode,
          documentNumber: t.documentNumber || t.titleCode,
        });
      }
    }

    return [...byTitleId.values()].sort((a, b) => {
      if (a.status === 'em_cobranca' && b.status !== 'em_cobranca') return -1;
      if (b.status === 'em_cobranca' && a.status !== 'em_cobranca') return 1;
      if (b.agingDays !== a.agingDays) return b.agingDays - a.agingDays;
      return b.priorityValueCents - a.priorityValueCents;
    });
  }, [cases, titles, titleMap, clientMap]);

  const filteredQueue = useMemo(() => {
    return unifiedQueue.filter((row) => {
      if (unitFilter !== 'all' && String(row.unitId) !== unitFilter) return false;
      if (statusFilter !== 'all' && row.status !== statusFilter) return false;
      if (stateFilter !== 'all' && row.stateCode !== stateFilter) return false;
      if (searchQuery.trim()) {
        const cl = clientMap.get(row.clientId);
        const q = searchQuery.toLowerCase();
        const hit =
          (cl?.fullName || '').toLowerCase().includes(q) ||
          row.documentNumber.toLowerCase().includes(q);
        if (!hit) return false;
      }
      return true;
    });
  }, [unifiedQueue, unitFilter, statusFilter, stateFilter, searchQuery, clientMap]);

  useEffect(() => {
    if (!selectedTitleId && filteredQueue[0]) {
      setSelectedTitleId(filteredQueue[0].titleId);
      setSummaryDraft(filteredQueue[0].conversationSummary || '');
    }
  }, [filteredQueue, selectedTitleId]);

  const activeRow =
    filteredQueue.find((r) => r.titleId === selectedTitleId) ||
    unifiedQueue.find((r) => r.titleId === selectedTitleId) ||
    filteredQueue[0];
  const activeClient = activeRow ? clientMap.get(activeRow.clientId) : undefined;
  const activeTitle = activeRow ? titleMap.get(activeRow.titleId) : undefined;
  const activeClientNotes = useMemo(() => {
    if (!activeClient) return [];
    return notes.filter((n) => n.clientId === activeClient.id);
  }, [notes, activeClient]);

  if (activeSubmenu === 'coordenacao') {
    return (
      <CollectionCoordinatorView
        currentUser={currentUser}
        group={group}
        wsTick={wsTick}
        initialClientId={pendingClientIntent}
        initialTitleId={pendingTitleIntent}
        onSwitchToOperacional={(cId) => {
          onNavigate?.('collection_operacional', cId ? { clientId: cId } : undefined);
        }}
      />
    );
  }

  const handleSettle = async () => {
    if (!activeRow) return;
    setBusy(true);
    setToast('');
    setErrToast('');
    try {
      let targetCaseId = activeRow.caseId;
      if (!targetCaseId) {
        const ensured = await apiFetch<{ case: CollectionCase }>(
          `/api/collection/titles/${activeRow.titleId}/ensure-case`,
          { method: 'POST' }
        );
        targetCaseId = ensured.case.id;
      }
      const res = await apiFetch<{ pointsAwarded: number }>(
        `/api/collection/cases/${targetCaseId}/settle`,
        {
          method: 'POST',
          body: JSON.stringify({ categoryId: Number(selectedCategoryId) || undefined }),
        }
      );
      setToast(`Pagamento baixado! +${res.pointsAwarded} pontos creditados ao seu ranking.`);
      await load();
    } catch (err) {
      setErrToast(err instanceof Error ? err.message : 'Erro ao baixar pagamento.');
    } finally {
      setBusy(false);
    }
  };

  const handleSaveNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeClient || !activeRow) return;
    if (!noteText.trim()) {
      setErrToast('Informe o histórico ou justificativa da tratativa.');
      return;
    }
    setBusy(true);
    setToast('');
    setErrToast('');
    try {
      await apiFetch('/api/collection-notes', {
        method: 'POST',
        body: JSON.stringify({
          titleId: activeRow.titleId,
          clientId: activeClient.id,
          collaboratorId: activeRow.assignedCollaboratorId || undefined,
          channel: noteChannel,
          negotiationStatus: noteNegotiationStatus,
          note: noteText.trim(),
          cancelRequest:
            noteNegotiationStatus === 'SOLICITA_CANCELAMENTO'
              ? {
                  requestDate: new Date().toISOString().slice(0, 10),
                  admissionContract: noteContract.trim() || activeTitle?.contractNumber || '',
                  notes: noteText.trim(),
                }
              : null,
        }),
      });
      setNoteText('');
      setNoteContract('');
      setNoteOpen(false);
      setToast(
        noteNegotiationStatus === 'SOLICITA_CANCELAMENTO'
          ? 'Solicitação de cancelamento enviada para a Coordenação.'
          : 'Tratativa de cobrança registrada no histórico.'
      );
      await load();
    } catch (err) {
      setErrToast(err instanceof Error ? err.message : 'Erro ao registrar nota.');
    } finally {
      setBusy(false);
    }
  };

  const handleStatusChange = async (newStatus: 'suspenso' | 'cancelado' | 'ativo') => {
    if (!activeClient) return;
    if ((newStatus === 'suspenso' || newStatus === 'cancelado') && !statusReason.trim()) {
      setErrToast('Informe a causa obrigatória antes de suspender ou cancelar o cliente.');
      return;
    }
    setBusy(true);
    setToast('');
    setErrToast('');
    try {
      const res = await apiFetch<{
        affectedProcessesCount?: number;
        escavadorActionSummary?: string;
      }>(`/api/collection/clients/${activeClient.id}/status`, {
        method: 'POST',
        body: JSON.stringify({
          status: newStatus,
          reason:
            statusReason.trim() ||
            (newStatus === 'ativo' ? 'Retorno ao status normal registrado em Cobrança.' : ''),
          cancelFutureTitles: newStatus === 'cancelado' ? cancelFutureTitles : false,
        }),
      });
      setStatusReason('');
      setRiskSectionOpen(false);
      setToast(
        res.escavadorActionSummary ||
          `Cliente marcado como ${newStatus.toUpperCase()}. Jurídico e Escavador sincronizados (${
            res.affectedProcessesCount ?? 0
          } processo(s)).`
      );
      await load();
    } catch (err) {
      setErrToast(err instanceof Error ? err.message : 'Erro ao atualizar status.');
    } finally {
      setBusy(false);
    }
  };

  const uniqueStates = [...new Set(unifiedQueue.map((c) => c.stateCode).filter(Boolean))];

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 border-b border-slate-200 pb-4">
        <div>
          <p className="text-xs font-medium text-slate-500">
            Cobrança & Ranking · Fila de Títulos Vencidos · Notas & Solicitações · Ranking de Recuperação
          </p>
          <h1 className="mt-1 font-display text-2xl font-bold text-slate-900">
            Cobrança & Ranking — Operacional
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg border border-slate-200">
            <button
              type="button"
              onClick={() => setTab('fila')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md whitespace-nowrap ${
                tab === 'fila'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Fila de Cobrança ({filteredQueue.length})
            </button>
            <button
              type="button"
              onClick={() => setTab('ranking')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md whitespace-nowrap ${
                tab === 'ranking'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Ranking Colaboradores
            </button>
          </div>

          <select
            value={stateFilter}
            onChange={(e) => setStateFilter(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700"
          >
            <option value="all">Todos os Estados (UF)</option>
            {uniqueStates.map((uf) => (
              <option key={uf} value={uf}>
                UF: {uf}
              </option>
            ))}
          </select>

          {onNavigate && (
            <button
              type="button"
              onClick={() => onNavigate('collection_coordenacao')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              <UserCog className="w-3.5 h-3.5 text-slate-500" />
              Coordenação
            </button>
          )}
        </div>
      </div>

      <CollapsibleFilterBar
        units={units}
        selectedUnitId={unitFilter}
        onUnitChange={setUnitFilter}
        period={periodFilter}
        onPeriodChange={setPeriodFilter}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        extraStatuses={[
          { value: 'em_cobranca', label: 'Em Cobrança' },
          { value: 'pago', label: 'Recuperado / Pago' },
          { value: 'suspenso', label: 'Suspenso' },
          { value: 'cancelado', label: 'Cancelado' },
        ]}
        selectedStatus={statusFilter}
        onStatusChange={setStatusFilter}
      />

      {toast && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-medium text-emerald-900">
          {toast}
        </div>
      )}
      {errToast && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-xs font-medium text-red-900">
          {errToast}
        </div>
      )}

      {tab === 'fila' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Queue sorted by aging/priority value */}
          <div className="lg:col-span-5 rounded-xl border border-slate-200 bg-white overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 text-xs font-bold text-slate-800 flex justify-between">
              <span>Fila Priorizada por Atraso / Valor ({filteredQueue.length})</span>
              <span className="text-[11px] font-medium text-slate-500">Estado · Risco</span>
            </div>
            <div className="divide-y divide-slate-100 max-h-[580px] overflow-y-auto">
              {filteredQueue.length === 0 ? (
                <div className="py-12 text-center text-xs text-slate-500">
                  Nenhum título vencido ou caso em cobrança encontrado.
                </div>
              ) : (
                filteredQueue.map((row) => {
                  const cl = clientMap.get(row.clientId);
                  const collab = row.assignedCollaboratorId
                    ? collabMap.get(row.assignedCollaboratorId)
                    : undefined;
                  const isSelected = activeRow?.titleId === row.titleId;
                  return (
                    <button
                      key={row.key}
                      type="button"
                      onClick={() => {
                        setSelectedTitleId(row.titleId);
                        setSummaryDraft(row.conversationSummary || '');
                        setRiskSectionOpen(false);
                      }}
                      className={`w-full text-left px-4 py-3.5 transition-colors ${
                        isSelected ? 'bg-blue-50/70' : 'hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-slate-900 truncate">
                          {cl?.fullName || 'Cliente'}
                        </span>
                        <span className="font-mono text-xs font-bold text-red-600 tabular-nums shrink-0">
                          {formatBRL(row.priorityValueCents)}
                        </span>
                      </div>
                      <div className="mt-1 text-[11px] text-slate-500 font-mono flex flex-wrap gap-x-2">
                        <span>Doc: {row.documentNumber}</span>
                        <span>· UF: {row.stateCode}</span>
                        {row.agingDays > 0 && (
                          <span className="text-red-700 font-bold">· {row.agingDays}d atraso</span>
                        )}
                        {collab && <span>· Resp: {collab.name}</span>}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Workspace for Selected Title / Case */}
          <div className="lg:col-span-7">
            {activeRow && activeClient && (
              <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
                  <div>
                    <h2 className="font-display text-base font-bold text-slate-900">
                      {activeClient.fullName} · CPF/CNPJ {activeClient.cpfCnpj}
                    </h2>
                    <p className="text-xs text-slate-500 font-mono mt-0.5 tabular-nums">
                      Título {activeRow.documentNumber} · Vencimento{' '}
                      {formatDateBR(activeTitle?.dueDate || activeRow.dueDate)} ·{' '}
                      {formatBRL(activeRow.priorityValueCents)}
                      {activeRow.assignedCollaboratorId &&
                        collabMap.get(activeRow.assignedCollaboratorId) &&
                        ` · Resp: ${collabMap.get(activeRow.assignedCollaboratorId)?.name}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold text-slate-700">
                      {activeClient.status.toUpperCase()}
                    </span>
                    {onNavigate && (
                      <button
                        type="button"
                        onClick={() =>
                          onNavigate('admission', { clientId: activeClient.id, tab: 'clientes' })
                        }
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        Dossiê
                        <ArrowUpRight className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Conversation Summary */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-semibold text-slate-700">
                      Resumo do Acordo / Transcrição WhatsApp
                    </label>
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          const txt = await navigator.clipboard.readText();
                          if (txt) setSummaryDraft((p) => (p ? `${p}\n${txt}` : txt));
                        } catch {
                          // ignore clipboard read permission errors
                        }
                      }}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-700 hover:text-blue-900"
                    >
                      <ClipboardPaste className="w-3 h-3" />
                      Colar WhatsApp
                    </button>
                  </div>
                  <textarea
                    rows={2}
                    value={summaryDraft}
                    onChange={(e) => setSummaryDraft(e.target.value)}
                    placeholder="Use 'Copiar p/ Cobrança' no WhatsApp ou digite os termos combinados com o cliente..."
                    className="w-full rounded-lg border border-slate-200 bg-slate-50/50 p-2.5 text-xs text-slate-800"
                  />
                </div>

                {/* Primary Daily Action: Settle */}
                <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3.5 space-y-2.5">
                  <div className="text-xs font-bold text-emerald-950">
                    Baixar Pagamento & Creditar Pontuação (+25 pts)
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <select
                      value={selectedCategoryId}
                      onChange={(e) => setSelectedCategoryId(e.target.value)}
                      className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800"
                    >
                      {categories.map((cat) => (
                        <option key={cat.id} value={String(cat.id)}>
                          {cat.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={busy || activeRow.status === 'pago'}
                      onClick={() => void handleSettle()}
                      className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 whitespace-nowrap"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      {activeRow.status === 'pago'
                        ? 'Título Já Liquidado'
                        : 'Confirmar Baixa (+25 pts)'}
                    </button>
                  </div>
                </div>

                {/* Registro de Nota Operacional & Solicitação de Cancelamento -> Coordenação */}
                <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setNoteOpen((p) => !p)}
                    className="w-full px-3.5 py-2.5 flex items-center justify-between text-xs font-semibold text-slate-800 hover:bg-slate-50"
                  >
                    <span className="flex items-center gap-2">
                      <MessageSquarePlus className="w-4 h-4 text-blue-600" />
                      Registrar Tratativa / Solicitar Cancelamento à Coordenação ({activeClientNotes.length})
                    </span>
                    <ChevronDown
                      className={`w-4 h-4 text-slate-400 transition-transform ${
                        noteOpen ? 'rotate-180' : ''
                      }`}
                    />
                  </button>
                  {noteOpen && (
                    <form onSubmit={handleSaveNote} className="p-3.5 border-t border-slate-200 space-y-3 bg-slate-50/50">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        <div>
                          <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                            Canal de Contato
                          </label>
                          <select
                            value={noteChannel}
                            onChange={(e) => setNoteChannel(e.target.value as typeof noteChannel)}
                            className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
                          >
                            <option value="TELEFONE">Telefone</option>
                            <option value="WHATSAPP">WhatsApp</option>
                            <option value="EMAIL">E-mail</option>
                            <option value="PRESENCIAL">Presencial</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                            Resultado / Negociação
                          </label>
                          <select
                            value={noteNegotiationStatus}
                            onChange={(e) =>
                              setNoteNegotiationStatus(e.target.value as typeof noteNegotiationStatus)
                            }
                            className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
                          >
                            <option value="AGUARDANDO_CONTATO">Aguardando Contato</option>
                            <option value="ENCAMINHOU_BOLETO">Encaminhou Boleto</option>
                            <option value="RECUSA_DIVIDA">Recusa Dívida</option>
                            <option value="FECHADA">Acordo / Negociação Fechada</option>
                            <option value="OUTROS">Outros</option>
                            <option value="SOLICITA_CANCELAMENTO">Solicitar Cancelamento (Coordenação)</option>
                          </select>
                        </div>
                      </div>
                      {noteNegotiationStatus === 'SOLICITA_CANCELAMENTO' && (
                        <div>
                          <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                            Contrato / Admissão Referência
                          </label>
                          <input
                            type="text"
                            value={noteContract}
                            onChange={(e) => setNoteContract(e.target.value)}
                            placeholder="Número do contrato (opcional)"
                            className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-mono"
                          />
                        </div>
                      )}
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                          Descrição da Tratativa *
                        </label>
                        <textarea
                          rows={2}
                          required
                          value={noteText}
                          onChange={(e) => setNoteText(e.target.value)}
                          placeholder="Descreva o contato realizado ou o motivo da solicitação de cancelamento..."
                          className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
                        />
                      </div>
                      <div className="flex justify-end">
                        <button
                          type="submit"
                          disabled={busy || !noteText.trim()}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                        >
                          <Send className="w-3.5 h-3.5" />
                          Registrar no Banco
                        </button>
                      </div>

                      {activeClientNotes.length > 0 && (
                        <div className="pt-2 border-t border-slate-200 space-y-1.5 max-h-40 overflow-y-auto">
                          <div className="text-[11px] font-bold text-slate-600">
                            Histórico recente deste cliente:
                          </div>
                          {activeClientNotes.map((n) => (
                            <div
                              key={n.id}
                              className="rounded border border-slate-200 bg-white px-2.5 py-1.5 text-[11px]"
                            >
                              <div className="flex justify-between font-mono text-slate-500">
                                <span>
                                  {n.collaboratorName} · {n.channel} · {n.negotiationStatus}
                                </span>
                                <span>{formatDateTimeBR(n.createdAt)}</span>
                              </div>
                              <div className="text-slate-800 mt-0.5">{n.note}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </form>
                  )}
                </div>

                {/* Intentionally Collapsible Destructive / Risk & Reactivation Actions */}
                <div className="rounded-lg border border-slate-200 bg-slate-50/50 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setRiskSectionOpen((p) => !p)}
                    className={`w-full px-3.5 py-2.5 flex items-center justify-between text-xs font-semibold ${
                      activeClient.status === 'suspenso' || activeClient.status === 'cancelado'
                        ? 'text-blue-800 hover:bg-blue-50/50'
                        : 'text-red-800 hover:bg-red-50/40'
                    }`}
                  >
                    <span>
                      {activeClient.status === 'suspenso' || activeClient.status === 'cancelado'
                        ? `Status Restrito (${activeClient.status.toUpperCase()}) · Retornar ao Normal ou Ajustar`
                        : 'Opções Avançadas: Suspender ou Cancelar Cliente / Contrato'}
                    </span>
                    <ChevronDown
                      className={`w-4 h-4 transition-transform ${
                        riskSectionOpen ? 'rotate-180' : ''
                      }`}
                    />
                  </button>
                  {riskSectionOpen && (
                    <div className="p-3.5 border-t border-slate-200 bg-red-50/20 space-y-2.5">
                      {(activeClient.status === 'suspenso' || activeClient.status === 'cancelado') && (
                        <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-[11px] text-amber-950 space-y-1">
                          <div>
                            <strong>Causa atual registrada:</strong>{' '}
                            {activeClient.suspensionReason ||
                              activeClient.cancelledReason ||
                              'Não informada.'}
                          </div>
                          <div>
                            A Ivi retirou o CPF/CNPJ {activeClient.cpfCnpj} da pesquisa do Escavador. Ao retornar ao status normal, a varredura será reativada automaticamente.
                          </div>
                        </div>
                      )}
                      <p className="text-[11px] text-slate-600">
                        Suspender ou cancelar grava a causa no histórico do Jurídico, atualiza o status do processo e faz a Ivi retirar automaticamente o CPF/CNPJ da pesquisa no Escavador.
                      </p>
                      <input
                        type="text"
                        value={statusReason}
                        onChange={(e) => setStatusReason(e.target.value)}
                        placeholder={
                          activeClient.status === 'suspenso' || activeClient.status === 'cancelado'
                            ? 'Observação para retorno ao status normal (ou nova causa)...'
                            : 'Causa obrigatória (ex: Inadimplência >60d, desistência formalizada)...'
                        }
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900"
                      />
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <label className="flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={cancelFutureTitles}
                            onChange={(e) => setCancelFutureTitles(e.target.checked)}
                          />
                          Ao cancelar, cancelar títulos futuros
                        </label>
                        <div className="flex flex-wrap gap-2">
                          {(activeClient.status === 'suspenso' ||
                            activeClient.status === 'cancelado') && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void handleStatusChange('ativo')}
                              className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              Retornar ao Status Normal (Reativar Escavador)
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void handleStatusChange('suspenso')}
                            className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-50"
                          >
                            <PauseCircle className="w-3.5 h-3.5" />
                            Suspender
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void handleStatusChange('cancelado')}
                            className="inline-flex items-center gap-1 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                          >
                            <AlertOctagon className="w-3.5 h-3.5" />
                            Cancelar Cliente
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'ranking' && (
        <CollaboratorRankingTables
          titles={titles}
          settlements={settlements}
          collaborators={collaborators}
          operators={operators}
          notes={notes}
          cases={cases}
          unitFilter={unitFilter}
        />
      )}
    </div>
  );
};
