import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  BarChart3,
  FileText,
  History,
  Kanban,
  Maximize2,
  Minimize2,
  RefreshCw,
  Users,
} from 'lucide-react';
import { apiFetch } from '../../lib/api.ts';
import type {
  Admission,
  Client,
  FinancialTitle,
  ModuleId,
  NavigationIntent,
  Negotiation,
  Unit,
} from '../../types.ts';
import {
  AdmissionDetailModal,
  AuditHistoryModal,
  ClientDetailModal,
  ConfirmDeleteModal,
} from './CollectionCoordinatorModalViews.tsx';
import { EntityAuditModal } from './cadastros/CadastrosShared.tsx';
import type {
  AvailableTitleRow,
  ClientModalContextPayload,
  NegotiationsBootstrapPayload,
} from './negotiations/types.ts';
import {
  NegotiationsGridContainer,
  type NegotiationSortField,
} from './negotiations/NegotiationsGridContainer.tsx';
import { AvailableTitlesGridContainer } from './negotiations/AvailableTitlesGridContainer.tsx';
import { ClientPortfolioContainer } from './negotiations/ClientPortfolioContainer.tsx';
import { PerformanceMetricsContainer } from './negotiations/PerformanceMetricsContainer.tsx';
import { CommercialPipelineContainer } from './negotiations/CommercialPipelineContainer.tsx';
import { NewNegotiationModalContainer } from './negotiations/NewNegotiationModalContainer.tsx';
import { NegotiationDetailModal } from './negotiations/NegotiationDetailModal.tsx';

type NegotiationsMainTab = 'negociacoes' | 'dashboard_cliente' | 'performance' | 'pipeline';

export const NegotiationsModule: React.FC<{
  units?: Unit[];
  wsTick?: number;
  navIntent?: NavigationIntent | null;
  onClearIntent?: () => void;
  onNavigate?: (module: ModuleId, intent?: NavigationIntent) => void;
  onGoBack?: () => void;
  previousScreenLabel?: string;
}> = ({ wsTick, navIntent, onClearIntent, onNavigate, onGoBack, previousScreenLabel }) => {
  const [data, setData] = useState<NegotiationsBootstrapPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [isExpanded, setIsExpanded] = useState(false);
  const [mainTab, setMainTab] = useState<NegotiationsMainTab>('negociacoes');
  const [tabHistory, setTabHistory] = useState<NegotiationsMainTab[]>([]);
  const mainTabRef = useRef<NegotiationsMainTab>('negociacoes');

  const switchMainTab = useCallback((nextTab: NegotiationsMainTab) => {
    const curr = mainTabRef.current;
    if (curr !== nextTab) {
      setTabHistory((prev) => [...prev.slice(-15), curr]);
      mainTabRef.current = nextTab;
    }
    setMainTab(nextTab);
  }, []);

  const handleHeaderGoBack = useCallback(() => {
    if (tabHistory.length > 0) {
      const prevTab = tabHistory[tabHistory.length - 1];
      setTabHistory((prev) => prev.slice(0, -1));
      mainTabRef.current = prevTab;
      setMainTab(prevTab);
      return;
    }
    if (onGoBack) {
      onGoBack();
    } else if (onNavigate) {
      onNavigate('overview');
    }
  }, [tabHistory, onGoBack, onNavigate]);

  // Grid & Filter State
  const [showSummaryAndFilters, setShowSummaryAndFilters] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('TODOS');
  const [bankFilter, setBankFilter] = useState('TODOS');
  const [collaboratorFilter, setCollaboratorFilter] = useState('TODOS');
  const [dateFromFilter, setDateFromFilter] = useState('');
  const [sortField, setSortField] = useState<NegotiationSortField>('openDate');
  const [sortAsc, setSortAsc] = useState(false);

  // Available Titles Bottom Grid State
  const [titlesSearch, setTitlesSearch] = useState('');
  const [titlesPage, setTitlesPage] = useState(1);
  const TITLES_PER_PAGE = 25;

  // Modals State
  const [selectedNegotiationId, setSelectedNegotiationId] = useState<number | null>(null);
  const [showNewNegModal, setShowNewNegModal] = useState(false);
  const [preselectedTitleForNew, setPreselectedTitleForNew] = useState<AvailableTitleRow | null>(null);
  const [deleteTargetNeg, setDeleteTargetNeg] = useState<Negotiation | null>(null);
  const [deletingNeg, setDeletingNeg] = useState(false);

  // Lazy Client / Admission / History Modal State
  const [clientModalState, setClientModalState] = useState<{
    client: Client;
    tab: 'dados' | 'whatsapp' | 'atendimentos';
    admissionId?: number | null;
    collaboratorId?: number | null;
  } | null>(null);
  const [fichaAdmission, setFichaAdmission] = useState<Admission | null>(null);
  const [clientContextCache, setClientContextCache] = useState<
    Record<number, ClientModalContextPayload>
  >({});
  const [historyTitleTarget, setHistoryTitleTarget] = useState<{
    title: FinancialTitle;
    clientName: string;
  } | null>(null);
  const [auditNegTarget, setAuditNegTarget] = useState<Negotiation | null>(null);
  const [sectorAuditOpen, setSectorAuditOpen] = useState(false);

  // Sub-tabs state
  const [dashboardClientId, setDashboardClientId] = useState<string>('');
  const [dashboardClientSearch, setDashboardClientSearch] = useState<string>('');
  const [perfCollaboratorFilter, setPerfCollaboratorFilter] = useState<string>('TODOS');

  const initialMountDoneRef = useRef(false);

  const loadBootstrap = useCallback(async (opts?: { force?: boolean; silent?: boolean }) => {
    if (!opts?.silent) {
      setLoading((prev) => (prev ? true : false));
    }
    try {
      const url = opts?.force
        ? '/api/negotiations/bootstrap?force=1'
        : '/api/negotiations/bootstrap';
      const res = await apiFetch<NegotiationsBootstrapPayload>(url);
      setData(res);
      const firstClientId = res.clients?.[0] ? String(res.clients[0].id) : '';
      if (firstClientId) {
        setDashboardClientId((prev) => prev || firstClientId);
      }
    } catch (err) {
      console.error('Error loading Negotiations bootstrap:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadBootstrap();
    initialMountDoneRef.current = true;
  }, [loadBootstrap]);

  // Debounced background sync on WebSocket events
  const prevWsTickRef = useRef(wsTick);
  useEffect(() => {
    if (!initialMountDoneRef.current || prevWsTickRef.current === wsTick) return;
    prevWsTickRef.current = wsTick;
    const timer = window.setTimeout(() => {
      void loadBootstrap({ silent: true });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [wsTick, loadBootstrap]);

  const fetchClientContext = useCallback(async (clientId: number, force = false) => {
    if (!clientId || Number.isNaN(clientId)) return null;
    try {
      const ctx = await apiFetch<ClientModalContextPayload>(
        `/api/negotiations/client-context/${clientId}`
      );
      setClientContextCache((prev) =>
        force || !prev[clientId] ? { ...prev, [clientId]: ctx } : { ...prev, [clientId]: ctx }
      );
      if (ctx.client) {
        setClientModalState((prev) =>
          prev && prev.client.id === clientId ? { ...prev, client: ctx.client! } : prev
        );
      }
      return ctx;
    } catch (err) {
      console.error('Error loading client modal context:', err);
      return null;
    }
  }, []);

  const negotiations = useMemo(() => data?.negotiations || [], [data]);
  const banks = useMemo(() => data?.banks || [], [data]);
  const collaborators = useMemo(() => data?.collaborators || [], [data]);
  const clients = useMemo(() => data?.clients || [], [data]);
  const clientMap = useMemo(() => new Map(clients.map((c) => [Number(c.id), c])), [clients]);
  const admissions = useMemo(() => data?.admissions || [], [data]);
  const availableTitles = useMemo(() => data?.availableTitles || [], [data]);
  const allReceberTitles = useMemo(
    () => data?.allReceberTitles || availableTitles,
    [data, availableTitles]
  );
  const goals = useMemo(() => data?.goals || [], [data]);
  const commercialDeals = useMemo(() => data?.commercialDeals || [], [data]);

  const activeNegotiation = useMemo(
    () => negotiations.find((n) => n.id === selectedNegotiationId) || null,
    [negotiations, selectedNegotiationId]
  );

  const filteredNegotiations = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    const list = negotiations.filter((n) => {
      if (q) {
        const hay =
          `${n.clientName || ''} ${n.contractNumber || ''} ${n.bankName || ''} ${n.collaboratorName || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (statusFilter !== 'TODOS' && (n.negotiationStatus || 'EM_ANDAMENTO') !== statusFilter) {
        return false;
      }
      if (bankFilter !== 'TODOS') {
        if (String(n.bankId) !== bankFilter && n.bankName !== bankFilter) return false;
      }
      if (collaboratorFilter !== 'TODOS') {
        if (
          String(n.collaboratorId) !== collaboratorFilter &&
          n.collaboratorName !== collaboratorFilter
        ) {
          return false;
        }
      }
      if (dateFromFilter && (n.openDate || '') < dateFromFilter) return false;
      return true;
    });

    return [...list].sort((a, b) => {
      let cmp = 0;
      if (sortField === 'originalDebtCents') {
        cmp = (a.originalDebtCents || 0) - (b.originalDebtCents || 0);
      } else {
        const va = String(a[sortField] || '').toLowerCase();
        const vb = String(b[sortField] || '').toLowerCase();
        cmp = va.localeCompare(vb, 'pt-BR');
      }
      return sortAsc ? cmp : -cmp;
    });
  }, [
    negotiations,
    searchTerm,
    statusFilter,
    bankFilter,
    collaboratorFilter,
    dateFromFilter,
    sortField,
    sortAsc,
  ]);

  const summaryKpis = useMemo(() => {
    const total = filteredNegotiations.length;
    const inProgress = filteredNegotiations.filter(
      (n) => (n.negotiationStatus || 'EM_ANDAMENTO') === 'EM_ANDAMENTO' || n.negotiationStatus === 'ABERTA'
    ).length;
    const closed = filteredNegotiations.filter((n) => n.negotiationStatus === 'ACORDO_FECHADO').length;
    const conversionRate = total > 0 ? Math.round((closed / total) * 100) : 0;
    const totalDebtCents = filteredNegotiations.reduce(
      (acc, n) => acc + (n.originalDebtCents || 0),
      0
    );
    const totalSavingsCents = filteredNegotiations.reduce(
      (acc, n) => acc + (n.estimatedSavingsCents || 0),
      0
    );
    const avgDiscount =
      total > 0
        ? Math.round(
            filteredNegotiations.reduce(
              (acc, n) => acc + (n.currentReductionPct || n.targetReductionPct || 0),
              0
            ) / total
          )
        : 0;
    return {
      total,
      inProgress,
      closed,
      conversionRate,
      totalDebtCents,
      totalSavingsCents,
      avgDiscount,
    };
  }, [filteredNegotiations]);

  const filteredAvailableTitles = useMemo(() => {
    const q = titlesSearch.trim().toLowerCase();
    if (!q) return availableTitles;
    return availableTitles.filter((t) => {
      const hay =
        `${t.documentNumber || ''} ${t.titleCode || ''} ${t.clientName || ''} ${t.contractNumber || ''} ${t.bankName || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [availableTitles, titlesSearch]);

  const totalAvailableBalanceCents = useMemo(
    () =>
      filteredAvailableTitles.reduce(
        (acc, t) => acc + (t.currentBalanceCents || t.amountCents || 0),
        0
      ),
    [filteredAvailableTitles]
  );

  const pagedAvailableTitles = useMemo(() => {
    const start = (titlesPage - 1) * TITLES_PER_PAGE;
    return filteredAvailableTitles.slice(start, start + TITLES_PER_PAGE);
  }, [filteredAvailableTitles, titlesPage]);

  const totalTitlePages = Math.max(1, Math.ceil(filteredAvailableTitles.length / TITLES_PER_PAGE));

  const toggleSort = (field: NegotiationSortField) => {
    if (sortField === field) {
      setSortAsc((prev) => !prev);
    } else {
      setSortField(field);
      setSortAsc(true);
    }
  };

  const openClientModal = useCallback(
    (
      rawClientId: number | string | null | undefined,
      opts?: {
        clientName?: string;
        tab?: 'dados' | 'whatsapp' | 'atendimentos';
        admissionId?: number | null;
        collaboratorId?: number | null;
      }
    ) => {
      const numericId = Number(rawClientId || 0);
      const matchedByName = opts?.clientName
        ? clients.find((c) => c.fullName.toLowerCase() === opts.clientName!.trim().toLowerCase())
        : undefined;
      const matchedByAdm = opts?.admissionId
        ? (() => {
            const adm = admissions.find((a) => a.id === opts.admissionId);
            return adm ? clientMap.get(Number(adm.clientId)) : undefined;
          })()
        : undefined;

      const resolvedClient: Client | null =
        (numericId ? clientMap.get(numericId) : undefined) ||
        matchedByAdm ||
        matchedByName ||
        (numericId
          ? {
              id: numericId,
              fullName: opts?.clientName || `Cliente #${numericId}`,
              cpfCnpj: '',
              rg: '',
              birthDate: '',
              phone: '',
              whatsapp: '',
              email: '',
              address: '',
              city: '',
              state: '',
              zipCode: '',
              clientType: 'PF',
              status: 'ativo',
              unitId: data?.units?.[0]?.id || 1,
            }
          : null);

      if (!resolvedClient) return;

      setClientModalState({
        client: resolvedClient,
        tab: opts?.tab || 'dados',
        admissionId: opts?.admissionId ?? null,
        collaboratorId: opts?.collaboratorId ?? null,
      });

      if (!clientContextCache[resolvedClient.id]) {
        void fetchClientContext(resolvedClient.id);
      }
    },
    [clients, clientMap, admissions, data?.units, clientContextCache, fetchClientContext]
  );

  const handleOpenClientFicha = useCallback(
    (clientId: number) => {
      const relatedNeg = negotiations.find((n) => Number(n.clientId) === Number(clientId));
      openClientModal(clientId, {
        clientName: relatedNeg?.clientName,
        admissionId: relatedNeg?.admissionId ?? null,
        collaboratorId: relatedNeg?.collaboratorId ?? null,
        tab: 'dados',
      });
    },
    [negotiations, openClientModal]
  );

  const handleOpenAdmissionFicha = useCallback(
    (admissionId: number | null, clientId: number) => {
      const found =
        (admissionId ? admissions.find((a) => a.id === admissionId) : undefined) ||
        admissions.find((a) => Number(a.clientId) === Number(clientId)) ||
        null;
      if (found) {
        setFichaAdmission(found);
        if (!clientContextCache[found.clientId]) {
          void fetchClientContext(found.clientId);
        }
      } else {
        openClientModal(clientId, { tab: 'dados' });
      }
    },
    [admissions, clientContextCache, fetchClientContext, openClientModal]
  );

  useEffect(() => {
    if (!navIntent || !data) return;
    if (navIntent.clientId) {
      setDashboardClientId(String(navIntent.clientId));
      openClientModal(navIntent.clientId, { tab: 'dados' });
    }
    onClearIntent?.();
  }, [navIntent, data, openClientModal, onClearIntent]);

  const handleOpenHistoryModal = (neg: Negotiation) => {
    const linkedTitle =
      (neg.titleId ? availableTitles.find((t) => t.id === neg.titleId) : undefined) ||
      availableTitles.find((t) => t.clientId === neg.clientId) ||
      ({
        id: neg.titleId || neg.id,
        titleCode: neg.contractNumber || `NEG-${neg.id}`,
        documentNumber: neg.contractNumber || `NEG-${neg.id}`,
        clientId: neg.clientId,
        clientName: neg.clientName || '',
        admissionId: neg.admissionId,
        unitId: neg.unitId,
        categoryId: null,
        installmentNumber: 1,
        totalInstallments: 1,
        isInitialFee: false,
        amountCents: neg.originalDebtCents,
        currentBalanceCents: neg.originalDebtCents,
        dueDate: neg.openDate || new Date().toISOString(),
        paidAt: null,
        status: 'ABERTO',
        boletoProvider: '',
        barcode: '',
        ourNumber: '',
        receiptDocId: null,
        collectorId: null,
        reguaStageSent: [],
      } as FinancialTitle);

    setHistoryTitleTarget({
      title: linkedTitle,
      clientName: neg.clientName || `Cliente #${neg.clientId}`,
    });
  };

  const handleConfirmDeleteNeg = async () => {
    if (!deleteTargetNeg) return;
    setDeletingNeg(true);
    try {
      await apiFetch(`/api/negotiations/${deleteTargetNeg.id}`, { method: 'DELETE' });
      const deletedId = deleteTargetNeg.id;
      setDeleteTargetNeg(null);
      if (selectedNegotiationId === deletedId) {
        setSelectedNegotiationId(null);
      }
      setData((prev) =>
        prev
          ? { ...prev, negotiations: prev.negotiations.filter((n) => n.id !== deletedId) }
          : prev
      );
      void loadBootstrap({ force: true, silent: true });
    } finally {
      setDeletingNeg(false);
    }
  };

  const handleNegotiationUpdated = useCallback(
    async (updatedNeg?: Negotiation) => {
      if (updatedNeg) {
        setData((prev) =>
          prev
            ? {
                ...prev,
                negotiations: prev.negotiations.map((n) =>
                  n.id === updatedNeg.id ? updatedNeg : n
                ),
              }
            : prev
        );
      } else {
        await loadBootstrap({ force: true, silent: true });
      }
    },
    [loadBootstrap]
  );

  const todayIso = new Date().toISOString().slice(0, 10);

  if (loading && !data) {
    return (
      <div className="p-8 text-center text-sm text-slate-500 flex items-center justify-center gap-2 dark:text-slate-400">
        <RefreshCw className="w-4 h-4 animate-spin text-blue-600 dark:text-blue-400" />
        Carregando Negociações Bancárias...
      </div>
    );
  }

  const activeClientId = clientModalState?.client?.id || fichaAdmission?.clientId || 0;
  const activeCtx = activeClientId ? clientContextCache[activeClientId] : undefined;

  return (
    <div
      className={
        isExpanded
          ? 'fixed inset-0 z-40 bg-slate-50 overflow-y-auto p-4 sm:p-6 space-y-5 dark:bg-slate-800/70'
          : 'space-y-5'
      }
    >
      {/* Top Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {(onGoBack || onNavigate || tabHistory.length > 0) && (
            <button
              type="button"
              onClick={handleHeaderGoBack}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
              title={
                tabHistory.length > 0
                  ? 'Voltar para a aba anterior'
                  : `Voltar para a tela anterior${previousScreenLabel ? ` (${previousScreenLabel})` : ''}`
              }
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="hidden sm:inline">Voltar</span>
            </button>
          )}
          <div>
            <h1 className="font-display text-xl font-bold text-slate-900 dark:text-slate-100">
              Negociações Bancárias
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Mesa de acordos, contatos vinculados aos bancos, canais de WhatsApp e Assessora Ivi IA
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setSectorAuditOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <History className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
            Auditoria
          </button>
          <button
            type="button"
            onClick={() => void loadBootstrap({ force: true })}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Atualizar
          </button>
          <button
            type="button"
            onClick={() => setIsExpanded((prev) => !prev)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            {isExpanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">{isExpanded ? 'Restaurar' : 'Tela Cheia'}</span>
          </button>
        </div>
      </div>

      {/* Main Module Navigation Tabs */}
      <div className="flex items-center gap-1 border-b border-slate-200 dark:border-slate-700 overflow-x-auto">
        <button
          type="button"
          onClick={() => switchMainTab('negociacoes')}
          className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap ${
            mainTab === 'negociacoes'
              ? 'border-blue-600 text-blue-700 dark:text-blue-400 bg-blue-50/40 dark:bg-blue-950/40'
              : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
          }`}
        >
          <FileText className="w-4 h-4" />
          Negociações ({negotiations.length})
        </button>

        <button
          type="button"
          onClick={() => switchMainTab('dashboard_cliente')}
          className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap ${
            mainTab === 'dashboard_cliente'
              ? 'border-blue-600 text-blue-700 dark:text-blue-400 bg-blue-50/40 dark:bg-blue-950/40'
              : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
          }`}
        >
          <Users className="w-4 h-4" />
          Carteira do Cliente
        </button>

        <button
          type="button"
          onClick={() => switchMainTab('performance')}
          className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap ${
            mainTab === 'performance'
              ? 'border-blue-600 text-blue-700 dark:text-blue-400 bg-blue-50/40 dark:bg-blue-950/40'
              : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
          }`}
        >
          <BarChart3 className="w-4 h-4" />
          Performance & Metas
        </button>

        <button
          type="button"
          onClick={() => switchMainTab('pipeline')}
          className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap ${
            mainTab === 'pipeline'
              ? 'border-blue-600 text-blue-700 dark:text-blue-400 bg-blue-50/40 dark:bg-blue-950/40'
              : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
          }`}
        >
          <Kanban className="w-4 h-4" />
          Pipeline Comercial ({commercialDeals.length})
        </button>
      </div>

      {/* Tab Content Containers */}
      {mainTab === 'negociacoes' && (
        <div className="space-y-5">
          <NegotiationsGridContainer
            negotiations={filteredNegotiations}
            banks={banks}
            collaborators={collaborators}
            todayIso={todayIso}
            showSummaryAndFilters={showSummaryAndFilters}
            onToggleSummaryAndFilters={() => setShowSummaryAndFilters((v) => !v)}
            searchTerm={searchTerm}
            onSearchTermChange={setSearchTerm}
            statusFilter={statusFilter}
            onStatusFilterChange={setStatusFilter}
            bankFilter={bankFilter}
            onBankFilterChange={setBankFilter}
            collaboratorFilter={collaboratorFilter}
            onCollaboratorFilterChange={setCollaboratorFilter}
            dateFromFilter={dateFromFilter}
            onDateFromFilterChange={setDateFromFilter}
            onClearFilters={() => {
              setSearchTerm('');
              setStatusFilter('TODOS');
              setBankFilter('TODOS');
              setCollaboratorFilter('TODOS');
              setDateFromFilter('');
            }}
            sortField={sortField}
            onToggleSort={toggleSort}
            summaryKpis={summaryKpis}
            onNewNegotiation={() => {
              setPreselectedTitleForNew(null);
              setShowNewNegModal(true);
            }}
            onSelectNegotiation={(id) => setSelectedNegotiationId(id)}
            onOpenClientModal={(neg) =>
              openClientModal(neg.clientId, {
                clientName: neg.clientName,
                admissionId: neg.admissionId,
                collaboratorId: neg.collaboratorId,
                tab: 'dados',
              })
            }
            onRequestDelete={(neg) => setDeleteTargetNeg(neg)}
          />

          <AvailableTitlesGridContainer
            titles={pagedAvailableTitles}
            totalCount={filteredAvailableTitles.length}
            totalAvailableBalanceCents={totalAvailableBalanceCents}
            search={titlesSearch}
            onSearchChange={(val) => {
              setTitlesSearch(val);
              setTitlesPage(1);
            }}
            page={titlesPage}
            totalPages={totalTitlePages}
            onPageChange={setTitlesPage}
            todayIso={todayIso}
            onStartNegotiation={(t) => {
              setPreselectedTitleForNew(t);
              setShowNewNegModal(true);
            }}
            onOpenClientModal={(t) =>
              openClientModal(t.clientId, {
                clientName: t.clientName,
                admissionId: t.admissionId,
                collaboratorId: t.collectorId,
                tab: 'dados',
              })
            }
          />
        </div>
      )}

      {mainTab === 'dashboard_cliente' && (
        <ClientPortfolioContainer
          clients={clients}
          admissions={admissions}
          negotiations={negotiations}
          allReceberTitles={allReceberTitles}
          dashboardClientId={dashboardClientId}
          onSelectClientId={setDashboardClientId}
          clientSearch={dashboardClientSearch}
          onClientSearchChange={setDashboardClientSearch}
          onOpenClientFicha={handleOpenClientFicha}
          onOpenAdmissionFicha={handleOpenAdmissionFicha}
          onSelectNegotiation={(id) => setSelectedNegotiationId(id)}
        />
      )}

      {mainTab === 'performance' && (
        <PerformanceMetricsContainer
          negotiations={negotiations}
          collaborators={collaborators}
          goals={goals}
          perfCollaboratorFilter={perfCollaboratorFilter}
          onPerfCollaboratorFilterChange={setPerfCollaboratorFilter}
          onSelectNegotiation={(id) => setSelectedNegotiationId(id)}
        />
      )}

      {mainTab === 'pipeline' && (
        <CommercialPipelineContainer
          deals={commercialDeals}
          clients={clients}
          banks={banks}
          collaborators={collaborators}
          onRefresh={() => loadBootstrap({ force: true, silent: true })}
          onConverted={(negId) => {
            setMainTab('negociacoes');
            setSelectedNegotiationId(negId);
          }}
        />
      )}

      {/* Modals */}
      <NewNegotiationModalContainer
        open={showNewNegModal}
        preselectedTitle={preselectedTitleForNew}
        clients={clients}
        admissions={admissions}
        banks={banks}
        collaborators={collaborators}
        availableTitles={availableTitles}
        onClose={() => {
          setShowNewNegModal(false);
          setPreselectedTitleForNew(null);
        }}
        onCreated={(created) => {
          setShowNewNegModal(false);
          setPreselectedTitleForNew(null);
          setData((prev) =>
            prev ? { ...prev, negotiations: [created, ...prev.negotiations] } : prev
          );
          setSelectedNegotiationId(created.id);
          void loadBootstrap({ force: true, silent: true });
        }}
      />

      <NegotiationDetailModal
        negotiation={activeNegotiation}
        banks={banks}
        collaborators={collaborators}
        goals={goals}
        allNegotiations={negotiations}
        wsTick={wsTick}
        onClose={() => setSelectedNegotiationId(null)}
        onUpdated={handleNegotiationUpdated}
        onOpenClientFicha={handleOpenClientFicha}
        onOpenAdmissionFicha={handleOpenAdmissionFicha}
        onOpenHistoryModal={handleOpenHistoryModal}
        onOpenNegAuditModal={(neg) => setAuditNegTarget(neg)}
      />

      <ConfirmDeleteModal
        open={Boolean(deleteTargetNeg)}
        title="Confirmar Exclusão da Negociação"
        message={
          deleteTargetNeg
            ? `Deseja realmente excluir a negociação do cliente ${deleteTargetNeg.clientName} (${deleteTargetNeg.bankName} · Contrato ${deleteTargetNeg.contractNumber})?`
            : ''
        }
        busy={deletingNeg}
        onCancel={() => setDeleteTargetNeg(null)}
        onConfirm={handleConfirmDeleteNeg}
      />

      <ClientDetailModal
        client={clientModalState?.client || null}
        initialTab={clientModalState?.tab || 'dados'}
        initialCollaboratorId={clientModalState?.collaboratorId ?? null}
        initialAdmissionId={clientModalState?.admissionId ?? null}
        admissions={admissions}
        portfolioTitles={allReceberTitles}
        allReceberTitles={allReceberTitles}
        collaborators={collaborators}
        users={activeCtx?.users || data?.users || []}
        documents={activeCtx?.documents || []}
        recalcScenarios={activeCtx?.recalcScenarios || []}
        gotalkEnabled={true}
        whatsappThreads={activeCtx?.whatsappThreads || []}
        whatsappMessages={activeCtx?.whatsappMessages || []}
        gotalkChannels={activeCtx?.gotalkChannels || []}
        gotalkOperators={activeCtx?.gotalkOperators || []}
        gotalkHsmTemplates={activeCtx?.gotalkHsmTemplates || []}
        onClose={() => setClientModalState(null)}
        onOpenAdmission={(adm) => {
          setClientModalState(null);
          setFichaAdmission(adm);
          if (!clientContextCache[adm.clientId]) {
            void fetchClientContext(adm.clientId);
          }
        }}
        onMessageSent={async () => {
          if (activeClientId) {
            await fetchClientContext(activeClientId, true);
          }
        }}
      />

      <AdmissionDetailModal
        admission={fichaAdmission}
        clients={clients}
        collaborators={collaborators}
        units={data?.units || []}
        banks={banks}
        modalities={activeCtx?.modalities || []}
        seriesList={activeCtx?.series || []}
        documents={activeCtx?.documents || []}
        recalcScenarios={activeCtx?.recalcScenarios || []}
        negotiations={negotiations}
        allReceberTitles={allReceberTitles}
        whatsappThreads={activeCtx?.whatsappThreads || []}
        whatsappMessages={activeCtx?.whatsappMessages || []}
        gotalkChannels={activeCtx?.gotalkChannels || []}
        gotalkHsmTemplates={activeCtx?.gotalkHsmTemplates || []}
        onSelectAdmission={(adm) => {
          setFichaAdmission(adm);
          if (!clientContextCache[adm.clientId]) {
            void fetchClientContext(adm.clientId);
          }
        }}
        onMessageSent={async () => {
          if (activeClientId) {
            await fetchClientContext(activeClientId, true);
          }
        }}
        onClose={() => setFichaAdmission(null)}
      />

      <AuditHistoryModal
        title={historyTitleTarget?.title || null}
        clientName={historyTitleTarget?.clientName || ''}
        onClose={() => setHistoryTitleTarget(null)}
      />

      <EntityAuditModal
        open={Boolean(auditNegTarget)}
        title={
          auditNegTarget
            ? `Negociação · ${auditNegTarget.clientName} (${auditNegTarget.contractNumber || `#${auditNegTarget.id}`})`
            : 'Negociação'
        }
        entityType="negotiations"
        entityId={auditNegTarget?.id || 0}
        onClose={() => setAuditNegTarget(null)}
      />
      <EntityAuditModal
        open={sectorAuditOpen}
        title="Negociações Bancárias · Auditoria Cumulativa"
        entityType="negotiations,negotiation_actions,bank_contacts"
        entityId="all"
        onClose={() => setSectorAuditOpen(false)}
      />
    </div>
  );
};
