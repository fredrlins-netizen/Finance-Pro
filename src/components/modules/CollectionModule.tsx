import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronDown,
  Eye,
  Filter,
  History,
  Maximize2,
  MessageSquare,
  Minimize2,
  PanelRightOpen,
  PhoneCall,
  RefreshCw,
  Search,
  Trash2,
  User,
  UserCog,
  X,
} from 'lucide-react';
import { apiFetch, formatBRL, formatDateBR } from '../../lib/api.ts';
import {
  Admission,
  AuthUser,
  BankItem,
  Client,
  CollaboratorItem,
  CollectionCase,
  CollectionNote,
  DocumentObject,
  FinancialTitle,
  GotalkChannelPublic,
  GotalkHsmTemplate,
  GotalkOperatorPublic,
  ModalityItem,
  ModuleId,
  NavigationIntent,
  Negotiation,
  RecalcScenario,
  SeriesItem,
  TitleSettlement,
  Unit,
  UserGroup,
  WhatsappMessage,
  WhatsappThread,
} from '../../types.ts';
import { CollaboratorRankingTables } from './CollaboratorRankingTables.tsx';
import {
  AdmissionDetailModal,
  AuditHistoryModal,
  ClientDetailModal,
  computeAgingDays,
  ConfirmDeleteModal,
  formatDueDateLocalBR,
  getAgingBucket,
  toIsoDateInput,
  translateCollectionSituation,
  translateTitleStatus,
} from './CollectionCoordinatorModalViews.tsx';
import { CollectionCoordinatorView } from './CollectionCoordinatorView.tsx';
import { CollectionOperationalDashboard } from './CollectionOperationalDashboard.tsx';
import {
  CollectionContactModal,
  CollectionSidePanel,
  computeTitleFinancialBreakdown,
} from './CollectionOperationalModals.tsx';
import { EntityAuditModal } from './cadastros/CadastrosShared.tsx';

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

interface OperationalPayload {
  cases: CollectionCase[];
  titles: FinancialTitle[];
  portfolioTitles?: FinancialTitle[];
  paidTitles?: FinancialTitle[];
  gridTitles?: FinancialTitle[];
  allReceberTitles?: FinancialTitle[];
  settlements: TitleSettlement[];
  titleSettlements?: TitleSettlement[];
  clients: Client[];
  categories: Array<{ id: number; name: string; providerCode: string }>;
  operators: Array<{
    id: number;
    name: string;
    email?: string;
    role: string;
    groupId?: number | null;
    points: number;
    whatsappPhone?: string;
  }>;
  collaborators: CollaboratorItem[];
  admissions?: Admission[];
  documents: DocumentObject[];
  units?: Unit[];
  banks?: BankItem[];
  modalities?: ModalityItem[];
  series?: SeriesItem[];
  notes: CollectionNote[];
  collectionNotes?: CollectionNote[];
  recalcScenarios?: RecalcScenario[];
  negotiations?: Negotiation[];
  admissionSummaryByClient?: Record<
    number,
    { fichas: number; aditivos: number; latestAddendumDate: string | null }
  >;
  gotalkEnabled?: boolean;
  whatsappThreads?: WhatsappThread[];
  whatsappMessages?: WhatsappMessage[];
  gotalkChannels?: GotalkChannelPublic[];
  gotalkOperators?: GotalkOperatorPublic[];
  gotalkHsmTemplates?: GotalkHsmTemplate[];
}

type OperationalSortKey =
  | 'clientName'
  | 'documentNumber'
  | 'dueDate'
  | 'balanceCents'
  | 'agingDays';

const PAGE_SIZE = 50;

function normUpperStatus(raw: string | undefined | null): string {
  const s = String(raw || 'ABERTO').trim().toUpperCase();
  return s === 'VENCIDO' ? 'ABERTO' : s;
}

export const CollectionModule: React.FC<CollectionModuleProps> = ({
  units,
  currentUser = null,
  group = null,
  activeSubmenu = 'operacional',
  wsTick,
  navIntent,
  onClearIntent,
  onNavigate,
}) => {
  const [payload, setPayload] = useState<OperationalPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState('');
  const [errToast, setErrToast] = useState('');

  // Modos de visualização: Carteira (GRID), Dashboard (DASHBOARD), Ranking (RANKING)
  const [viewMode, setViewMode] = useState<'GRID' | 'DASHBOARD' | 'RANKING'>('GRID');
  const [isExpanded, setIsExpanded] = useState(false);

  // Busca com debounce de 300ms + filtros colapsáveis
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [unitFilter, setUnitFilter] = useState('all');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [filterCollaborator, setFilterCollaborator] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterAgingBucket, setFilterAgingBucket] = useState('');
  const [filterDueFrom, setFilterDueFrom] = useState('');
  const [filterDueTo, setFilterDueTo] = useState('');
  const [filterUf, setFilterUf] = useState('');

  // Ordenação & Paginação (50 por página)
  const [sortKey, setSortKey] = useState<OperationalSortKey>('dueDate');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);

  // Solicitações de Cancelamento colapsável
  const [cancelSectionOpen, setCancelSectionOpen] = useState(false);
  const [deletingCancelNote, setDeletingCancelNote] = useState<CollectionNote | null>(null);
  const [deleteCancelBusy, setDeleteCancelBusy] = useState(false);

  // Painel Lateral (Duplo clique na linha) & Modais Integrados
  const [sidePanelTitleId, setSidePanelTitleId] = useState<number | null>(null);
  const [contactModalTitleId, setContactModalTitleId] = useState<number | null>(null);
  const [historyTitle, setHistoryTitle] = useState<FinancialTitle | null>(null);
  const [sectorAuditOpen, setSectorAuditOpen] = useState(false);
  const [deletingTitle, setDeletingTitle] = useState<FinancialTitle | null>(null);
  const [deleteTitleBusy, setDeleteTitleBusy] = useState(false);

  const [clientModalState, setClientModalState] = useState<{
    clientId: number;
    tab: 'dados' | 'whatsapp' | 'atendimentos';
    collaboratorId?: number | null;
    admissionId?: number | null;
  } | null>(null);
  const [admissionModalObj, setAdmissionModalObj] = useState<Admission | null>(null);

  // Intenções vindas de busca global / outros módulos
  const [pendingClientIntent, setPendingClientIntent] = useState<number | undefined>(undefined);
  const [pendingTitleIntent, setPendingTitleIntent] = useState<number | undefined>(undefined);

  const loadOperationalData = useCallback(async (toastMsg?: string) => {
    setErrToast('');
    try {
      const res = await apiFetch<OperationalPayload>('/api/collection');
      setPayload(res);
      if (toastMsg) setToast(toastMsg);
    } catch (err) {
      setErrToast(
        err instanceof Error ? err.message : 'Erro ao carregar módulo operacional de cobrança.'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeSubmenu === 'operacional') {
      void loadOperationalData();
    }
  }, [activeSubmenu, wsTick, loadOperationalData]);

  // Debounce 300ms na busca
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchInput.trim().toLowerCase());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // Deep links / intents
  useEffect(() => {
    if (!navIntent) return;
    if (navIntent.clientId) setPendingClientIntent(navIntent.clientId);
    if (navIntent.titleId) setPendingTitleIntent(navIntent.titleId);
    if (navIntent.tab === 'ranking') setViewMode('RANKING');

    if (activeSubmenu === 'operacional' && payload) {
      if (navIntent.titleId) {
        setSidePanelTitleId(navIntent.titleId);
        setViewMode('GRID');
      } else if (navIntent.clientId) {
        const match = (payload.gridTitles || payload.titles || []).find(
          (t) => t.clientId === navIntent.clientId
        );
        if (match) {
          setSidePanelTitleId(match.id);
          setViewMode('GRID');
        } else {
          setClientModalState({ clientId: navIntent.clientId, tab: 'dados' });
        }
      }
      onClearIntent?.();
    }
  }, [navIntent, activeSubmenu, payload, onClearIntent]);

  // Permissões e vínculo Usuário -> Colaborador
  const isAdmin = currentUser?.role === 'admin';
  const canExcluir =
    isAdmin ||
    group?.modulePermissions?.fin_cobranca_coord_excluir === true ||
    group?.modulePermissions?.collection !== false;
  const canVerFicha =
    isAdmin ||
    group?.modulePermissions?.com_admissao_visualizar === true ||
    group?.modulePermissions?.admission !== false;

  const collaborators = payload?.collaborators || [];
  const clients = payload?.clients || [];
  const notes = payload?.collectionNotes || payload?.notes || [];
  const settlements = payload?.titleSettlements || payload?.settlements || [];
  const cases = payload?.cases || [];
  const allReceberTitles = payload?.allReceberTitles || payload?.titles || [];

  const linkedCollaborator = useMemo(() => {
    if (!currentUser) return null;
    const byUserId = collaborators.find((c) => c.userId === currentUser.id);
    if (byUserId) return byUserId;
    const emailLower = (currentUser.email || '').trim().toLowerCase();
    if (emailLower) {
      const byEmail = collaborators.find(
        (c) => (c.email || '').trim().toLowerCase() === emailLower
      );
      if (byEmail) return byEmail;
    }
    return null;
  }, [collaborators, currentUser]);

  const caseByTitleMap = useMemo(() => new Map(cases.map((c) => [c.titleId, c])), [cases]);
  const clientMap = useMemo(() => new Map(clients.map((c) => [c.id, c])), [clients]);
  const collabMap = useMemo(() => new Map(collaborators.map((c) => [c.id, c])), [collaborators]);

  // Soma real de baixas por título (title_settlements)
  const settledByTitleMap = useMemo(() => {
    const map = new Map<number, number>();
    for (const s of settlements) {
      map.set(s.titleId, (map.get(s.titleId) || 0) + Number(s.amountCents || 0));
    }
    return map;
  }, [settlements]);

  // Escopo certificado por perfil (Admin vê todas as carteiras; Operador vê sua carteira atribuída)
  const belongsToOperatorScope = useCallback(
    (t: FinancialTitle): boolean => {
      if (isAdmin) return true;
      if (!currentUser || !linkedCollaborator) return false;
      if (t.assignedCollaboratorId === linkedCollaborator.id) return true;
      const linkedCase = caseByTitleMap.get(t.id);
      if (linkedCase?.assignedCollectorId === currentUser.id) return true;
      if (!t.assignedCollaboratorId && t.collectorId === currentUser.id) return true;
      return false;
    },
    [isAdmin, currentUser, linkedCollaborator, caseByTitleMap]
  );

  const scopedGridTitles = useMemo(() => {
    const base = payload?.gridTitles || [];
    return base.filter((t) => {
      if (!belongsToOperatorScope(t)) return false;
      if (unitFilter !== 'all' && String(t.unitId) !== unitFilter) return false;
      return true;
    });
  }, [payload?.gridTitles, belongsToOperatorScope, unitFilter]);

  const scopedPortfolioTitles = useMemo(() => {
    const base = payload?.portfolioTitles || [];
    return base.filter((t) => {
      if (!belongsToOperatorScope(t)) return false;
      if (unitFilter !== 'all' && String(t.unitId) !== unitFilter) return false;
      return true;
    });
  }, [payload?.portfolioTitles, belongsToOperatorScope, unitFilter]);

  const scopedPaidTitles = useMemo(() => {
    const base = payload?.paidTitles || [];
    return base.filter((t) => {
      if (!belongsToOperatorScope(t)) return false;
      if (unitFilter !== 'all' && String(t.unitId) !== unitFilter) return false;
      return true;
    });
  }, [payload?.paidTitles, belongsToOperatorScope, unitFilter]);

  const scopedAllTitles = useMemo(() => {
    return allReceberTitles.filter((t) => {
      if (!belongsToOperatorScope(t)) return false;
      if (unitFilter !== 'all' && String(t.unitId) !== unitFilter) return false;
      return true;
    });
  }, [allReceberTitles, belongsToOperatorScope, unitFilter]);

  // Contagem de notas e próximo contato por título / cliente
  const noteMetaByTitle = useMemo(() => {
    const countByTitle = new Map<number, number>();
    const nextDateByTitle = new Map<number, string>();
    const nextDateByClient = new Map<number, string>();

    // notes já vêm ordenadas desc por createdAt no backend
    for (const n of notes) {
      if (n.titleId != null) {
        countByTitle.set(n.titleId, (countByTitle.get(n.titleId) || 0) + 1);
        if (n.nextContactDate && !nextDateByTitle.has(n.titleId)) {
          nextDateByTitle.set(n.titleId, n.nextContactDate);
        }
      }
      if (n.nextContactDate && !nextDateByClient.has(n.clientId)) {
        nextDateByClient.set(n.clientId, n.nextContactDate);
      }
    }
    return { countByTitle, nextDateByTitle, nextDateByClient };
  }, [notes]);

  // Mensagens não lidas do WhatsApp por cliente
  const unreadWhatsappByClient = useMemo(() => {
    const map = new Map<number, number>();
    const threads = payload?.whatsappThreads || [];
    for (const th of threads) {
      if (th.clientId && th.unreadCount > 0) {
        map.set(th.clientId, (map.get(th.clientId) || 0) + th.unreadCount);
      }
    }
    return map;
  }, [payload?.whatsappThreads]);

  const availableUfs = useMemo(() => {
    const set = new Set<string>();
    for (const t of scopedGridTitles) {
      const uf = String(clientMap.get(t.clientId)?.state || '').trim().toUpperCase();
      if (uf) set.add(uf);
    }
    return [...set].sort();
  }, [scopedGridTitles, clientMap]);

  // Filtragem completa antes da paginação (garante KPIs e Rodapé 100% exatos)
  const filteredTitles = useMemo(() => {
    return scopedGridTitles.filter((t) => {
      const cl = clientMap.get(t.clientId);
      const clientName = (cl?.fullName || t.clientName || '').toLowerCase();
      const cpfCnpj = (cl?.cpfCnpj || '').toLowerCase();
      const docNum = (t.documentNumber || t.titleCode || '').toLowerCase();
      const desc = (t.description || '').toLowerCase();

      if (debouncedSearch) {
        const hit =
          clientName.includes(debouncedSearch) ||
          cpfCnpj.includes(debouncedSearch) ||
          docNum.includes(debouncedSearch) ||
          desc.includes(debouncedSearch);
        if (!hit) return false;
      }

      const st = normUpperStatus(t.status);
      const days = st === 'PAGO' ? 0 : computeAgingDays(t.dueDate);

      if (overdueOnly && (st === 'PAGO' || days <= 0)) return false;
      if (filterStatus && st !== filterStatus) return false;

      if (isAdmin && filterCollaborator) {
        if (filterCollaborator === '__unassigned__') {
          if (t.assignedCollaboratorId) return false;
        } else if (String(t.assignedCollaboratorId || '') !== filterCollaborator) {
          return false;
        }
      }

      if (filterAgingBucket) {
        if (st === 'PAGO') return false;
        if (getAgingBucket(days) !== filterAgingBucket) return false;
      }

      const dueIso = toIsoDateInput(t.dueDate);
      if (filterDueFrom && (!dueIso || dueIso < filterDueFrom)) return false;
      if (filterDueTo && (!dueIso || dueIso > filterDueTo)) return false;

      if (filterUf) {
        const clientUf = String(cl?.state || '').trim().toUpperCase();
        if (clientUf !== filterUf) return false;
      }

      return true;
    });
  }, [
    scopedGridTitles,
    clientMap,
    debouncedSearch,
    overdueOnly,
    filterStatus,
    isAdmin,
    filterCollaborator,
    filterAgingBucket,
    filterDueFrom,
    filterDueTo,
    filterUf,
  ]);

  // Ordenação
  const sortedTitles = useMemo(() => {
    const arr = [...filteredTitles];
    const mult = sortDir === 'asc' ? 1 : -1;
    arr.sort((a, b) => {
      if (sortKey === 'clientName') {
        const na = clientMap.get(a.clientId)?.fullName || a.clientName || '';
        const nb = clientMap.get(b.clientId)?.fullName || b.clientName || '';
        return na.localeCompare(nb, 'pt-BR') * mult;
      }
      if (sortKey === 'documentNumber') {
        const da = a.documentNumber || a.titleCode || '';
        const db = b.documentNumber || b.titleCode || '';
        return da.localeCompare(db, 'pt-BR', { numeric: true }) * mult;
      }
      if (sortKey === 'balanceCents') {
        const ba = computeTitleFinancialBreakdown(a, settledByTitleMap).balanceCents;
        const bb = computeTitleFinancialBreakdown(b, settledByTitleMap).balanceCents;
        return (ba - bb) * mult;
      }
      if (sortKey === 'agingDays') {
        const aa = normUpperStatus(a.status) === 'PAGO' ? -99999 : computeAgingDays(a.dueDate);
        const ab = normUpperStatus(b.status) === 'PAGO' ? -99999 : computeAgingDays(b.dueDate);
        return (aa - ab) * mult;
      }
      // dueDate default
      const ia = toIsoDateInput(a.dueDate);
      const ib = toIsoDateInput(b.dueDate);
      return ia.localeCompare(ib) * mult || (a.id - b.id) * mult;
    });
    return arr;
  }, [filteredTitles, sortKey, sortDir, clientMap, settledByTitleMap]);

  // KPIs de topo + Recálculo Financeiro de Rodapé (calculados sobre TODO o conjunto filtrado)
  const gridSummary = useMemo(() => {
    let activeCount = 0;
    let dueSoonCount = 0;
    let dueSoonCents = 0;
    let overdueCount = 0;
    let overdueCents = 0;
    let totalOpenBalanceCents = 0;
    const activeClientSet = new Set<number>();

    let footOriginalCents = 0;
    let footInterestCents = 0;
    let footFineCents = 0;
    let footDiscountCents = 0;
    let footUpdatedCents = 0;
    let footReceivedCents = 0;
    let footBalanceCents = 0;

    for (const t of filteredTitles) {
      const b = computeTitleFinancialBreakdown(t, settledByTitleMap);
      const st = normUpperStatus(t.status);
      const days = st === 'PAGO' ? 0 : computeAgingDays(t.dueDate);

      footOriginalCents += b.originalCents;
      footInterestCents += b.interestCents;
      footFineCents += b.fineCents;
      footDiscountCents += b.discountCents;
      footUpdatedCents += b.updatedCents;
      footReceivedCents += b.receivedCents;
      footBalanceCents += b.balanceCents;

      if (st !== 'PAGO') {
        activeCount += 1;
        totalOpenBalanceCents += b.balanceCents;
        activeClientSet.add(t.clientId);
        if (days > 0) {
          overdueCount += 1;
          overdueCents += b.balanceCents;
        } else {
          dueSoonCount += 1;
          dueSoonCents += b.balanceCents;
        }
      }
    }

    return {
      activeCount,
      dueSoonCount,
      dueSoonCents,
      overdueCount,
      overdueCents,
      totalOpenBalanceCents,
      distinctClientsCount: activeClientSet.size,
      footer: {
        originalCents: footOriginalCents,
        interestCents: footInterestCents,
        fineCents: footFineCents,
        discountCents: footDiscountCents,
        updatedCents: footUpdatedCents,
        receivedCents: footReceivedCents,
        balanceCents: footBalanceCents,
      },
    };
  }, [filteredTitles, settledByTitleMap]);

  // Solicitações de Cancelamento dentro do escopo atual
  const scopedCancelRequests = useMemo(() => {
    const scopedClientIds = new Set(scopedAllTitles.map((t) => t.clientId));
    return notes.filter((n) => {
      if (n.negotiationStatus !== 'SOLICITA_CANCELAMENTO' || !n.cancelRequest) return false;
      if (isAdmin) return true;
      if (linkedCollaborator && n.collaboratorId === linkedCollaborator.id) return true;
      if (currentUser && n.userId === currentUser.id) return true;
      return scopedClientIds.has(n.clientId);
    });
  }, [notes, scopedAllTitles, isAdmin, linkedCollaborator, currentUser]);

  // Paginação 50 linhas
  const totalPages = Math.max(1, Math.ceil(sortedTitles.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pagedTitles = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return sortedTitles.slice(start, start + PAGE_SIZE);
  }, [sortedTitles, safePage]);

  // Objetos ativos para Painel Lateral e Modais
  const activeSideTitle = useMemo(
    () =>
      sidePanelTitleId
        ? allReceberTitles.find((t) => t.id === sidePanelTitleId) || null
        : null,
    [sidePanelTitleId, allReceberTitles]
  );
  const activeSideClient = activeSideTitle ? clientMap.get(activeSideTitle.clientId) : undefined;

  const contactModalTitle = useMemo(
    () =>
      contactModalTitleId
        ? allReceberTitles.find((t) => t.id === contactModalTitleId) || null
        : null,
    [contactModalTitleId, allReceberTitles]
  );
  const contactModalClient = contactModalTitle
    ? clientMap.get(contactModalTitle.clientId)
    : undefined;

  const activeClientForModal = useMemo(
    () => (clientModalState ? clientMap.get(clientModalState.clientId) || null : null),
    [clientModalState, clientMap]
  );

  // Delegação para Coordenação quando submenu === 'coordenacao'
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

  const toggleSort = (key: OperationalSortKey) => {
    if (sortKey === key) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'balanceCents' || key === 'agingDays' ? 'desc' : 'asc');
    }
    setPage(1);
  };

  const renderSortIcon = (key: OperationalSortKey) => {
    if (sortKey !== key) return <ArrowUpDown className="w-3 h-3 text-slate-400 dark:text-slate-400" />;
    return sortDir === 'asc' ? (
      <ArrowUp className="w-3 h-3 text-slate-900 dark:text-slate-100" />
    ) : (
      <ArrowDown className="w-3 h-3 text-slate-900 dark:text-slate-100" />
    );
  };

  const clearAllFilters = () => {
    setSearchInput('');
    setDebouncedSearch('');
    setOverdueOnly(false);
    setFilterCollaborator('');
    setFilterStatus('');
    setFilterAgingBucket('');
    setFilterDueFrom('');
    setFilterDueTo('');
    setFilterUf('');
    setUnitFilter('all');
    setPage(1);
  };

  const activeFilterCount = [
    overdueOnly,
    Boolean(filterCollaborator),
    Boolean(filterStatus),
    Boolean(filterAgingBucket),
    Boolean(filterDueFrom),
    Boolean(filterDueTo),
    Boolean(filterUf),
    unitFilter !== 'all',
  ].filter(Boolean).length;

  const handleConfirmDeleteTitle = async () => {
    if (!deletingTitle) return;
    setDeleteTitleBusy(true);
    setErrToast('');
    try {
      await apiFetch(`/api/financial-titles/${deletingTitle.id}`, { method: 'DELETE' });
      if (sidePanelTitleId === deletingTitle.id) setSidePanelTitleId(null);
      setDeletingTitle(null);
      await loadOperationalData('Título excluído permanentemente.');
    } catch (err) {
      setDeletingTitle(null);
      setErrToast(err instanceof Error ? err.message : 'Não foi possível excluir o título.');
    } finally {
      setDeleteTitleBusy(false);
    }
  };

  const handleConfirmDeleteCancelRequest = async () => {
    if (!deletingCancelNote) return;
    setDeleteCancelBusy(true);
    setErrToast('');
    try {
      await apiFetch(`/api/collection-notes/${deletingCancelNote.id}`, { method: 'DELETE' });
      setDeletingCancelNote(null);
      await loadOperationalData('Solicitação de cancelamento removida.');
    } catch (err) {
      setDeletingCancelNote(null);
      setErrToast(err instanceof Error ? err.message : 'Erro ao remover solicitação.');
    } finally {
      setDeleteCancelBusy(false);
    }
  };

  const roleSubtitle = isAdmin
    ? 'Visão administrativa — todos os títulos em cobrança'
    : linkedCollaborator
    ? `Minha carteira — títulos atribuídos a ${linkedCollaborator.name}`
    : 'Minha carteira — aguardando vínculo de colaborador';

  const containerClasses = isExpanded
    ? 'fixed inset-0 z-40 overflow-y-auto bg-slate-50 p-5 space-y-5 dark:bg-slate-800/70'
    : 'space-y-5';

  return (
    <div className={containerClasses}>
      {/* Cabeçalho Principal */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-3 border-b border-slate-200 pb-4 dark:border-slate-700">
        <div>
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            {isAdmin ? 'Administrador' : linkedCollaborator?.name || currentUser?.name || 'Operador'}{' '}
            · {roleSubtitle}
          </p>
          <h1 className="mt-1 font-display text-2xl font-bold text-slate-900 dark:text-slate-100">
            Cobrança & Ranking — Operacional
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Abas Principais */}
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg border border-slate-200 dark:bg-slate-800 dark:border-slate-700">
            <button
              type="button"
              onClick={() => setViewMode('GRID')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
                viewMode === 'GRID'
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-slate-100'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
              }`}
            >
              {isAdmin ? 'Todas as Carteiras' : 'Minha Carteira'} ({scopedPortfolioTitles.length})
            </button>
            <button
              type="button"
              onClick={() => setViewMode('DASHBOARD')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
                viewMode === 'DASHBOARD'
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-slate-100'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
              }`}
            >
              {isAdmin ? 'Resultados Gerais' : 'Meus Resultados'}
            </button>
            <button
              type="button"
              onClick={() => setViewMode('RANKING')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
                viewMode === 'RANKING'
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-slate-100'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
              }`}
            >
              Ranking Colaboradores
            </button>
          </div>

          <button
            type="button"
            onClick={() => setSectorAuditOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <History className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
            Auditoria
          </button>

          <button
            type="button"
            onClick={() => void loadOperationalData('Carteira atualizada.')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Atualizar
          </button>

          <button
            type="button"
            onClick={() => setIsExpanded((p) => !p)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            {isExpanded ? (
              <>
                <Minimize2 className="w-3.5 h-3.5" />
                Minimizar
              </>
            ) : (
              <>
                <Maximize2 className="w-3.5 h-3.5" />
                Expandir
              </>
            )}
          </button>

          {onNavigate && (
            <button
              type="button"
              onClick={() => onNavigate('collection_coordenacao')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <UserCog className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
              Coordenação
            </button>
          )}
        </div>
      </div>

      {/* Aviso de Usuário Operador sem Vínculo */}
      {!loading && !isAdmin && !linkedCollaborator && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-950 flex items-center gap-2.5 dark:border-amber-800/70 dark:bg-amber-950/50 dark:text-amber-300">
          <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 dark:text-amber-300" />
          <span>
            Seu usuário não está vinculado a um colaborador. Solicite ao administrador que vincule seu cadastro em{' '}
            <strong>Cadastros Comuns → Colaboradores</strong> para visualizar os títulos atribuídos à sua carteira.
          </span>
        </div>
      )}

      {toast && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-medium text-emerald-900 flex items-center justify-between gap-2 dark:border-emerald-800/70 dark:bg-emerald-950/50 dark:text-emerald-300">
          <span>{toast}</span>
          <button
            type="button"
            onClick={() => setToast('')}
            className="text-emerald-700 hover:text-emerald-950 dark:text-emerald-300"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {errToast && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-xs font-medium text-red-900 flex items-center justify-between gap-2 dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300">
          <span>{errToast}</span>
          <button
            type="button"
            onClick={() => setErrToast('')}
            className="text-red-700 hover:text-red-950 dark:text-red-300"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* ===================================================================== */}
      {/* ABA 1: CARTEIRA OPERACIONAL (GRID + KPIs + PAINEL LATERAL)            */}
      {/* ===================================================================== */}
      {viewMode === 'GRID' && (
        <div className="space-y-4">
          {/* 4 KPIs Clicáveis */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <button
              type="button"
              onClick={() => {
                setOverdueOnly(false);
                setFilterAgingBucket('');
                setFilterStatus('');
                setPage(1);
              }}
              className={`text-left rounded-xl border p-4 transition-colors ${
                !overdueOnly && !filterAgingBucket
                  ? 'border-slate-900 bg-white dark:border-emerald-500 dark:bg-slate-900'
                  : 'border-slate-200 bg-white hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900'
              }`}
            >
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Total Títulos Ativos</p>
              <p className="mt-1.5 font-mono text-2xl font-bold text-slate-900 tabular-nums dark:text-slate-100">
                {gridSummary.activeCount}
              </p>
              <p className="mt-1 text-xs text-slate-500 font-mono tabular-nums dark:text-slate-400">
                {gridSummary.distinctClientsCount} cliente(s) na seleção
              </p>
            </button>

            <button
              type="button"
              onClick={() => {
                setOverdueOnly(false);
                setFilterAgingBucket((prev) => (prev === 'a_vencer' ? '' : 'a_vencer'));
                setPage(1);
              }}
              className={`text-left rounded-xl border p-4 transition-colors ${
                filterAgingBucket === 'a_vencer'
                  ? 'border-emerald-600 bg-emerald-50/30 dark:bg-emerald-950/50'
                  : 'border-slate-200 bg-white hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900'
              }`}
            >
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">A Vencer</p>
              <p className="mt-1.5 font-mono text-2xl font-bold text-emerald-700 tabular-nums dark:text-emerald-300">
                {gridSummary.dueSoonCount}
              </p>
              <p className="mt-1 text-xs text-slate-500 font-mono tabular-nums dark:text-slate-400">
                {formatBRL(gridSummary.dueSoonCents)}
              </p>
            </button>

            <button
              type="button"
              onClick={() => {
                setFilterAgingBucket('');
                setOverdueOnly((prev) => !prev);
                setPage(1);
              }}
              className={`text-left rounded-xl border p-4 transition-colors ${
                overdueOnly
                  ? 'border-red-600 bg-red-50/30 dark:bg-red-950/50'
                  : 'border-slate-200 bg-white hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900'
              }`}
            >
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Vencidos</p>
              <p className="mt-1.5 font-mono text-2xl font-bold text-red-600 tabular-nums dark:text-red-400">
                {gridSummary.overdueCount}
              </p>
              <p className="mt-1 text-xs text-slate-500 font-mono tabular-nums dark:text-slate-400">
                {formatBRL(gridSummary.overdueCents)}
              </p>
            </button>

            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Saldo Devedor Total</p>
              <p className="mt-1.5 font-mono text-2xl font-bold text-slate-900 tabular-nums dark:text-slate-100">
                {formatBRL(gridSummary.totalOpenBalanceCents)}
              </p>
              <p className="mt-1 text-xs text-slate-500 font-mono tabular-nums dark:text-slate-400">
                Recebido: {formatBRL(gridSummary.footer.receivedCents)}
              </p>
            </div>
          </div>

          {/* Card de Solicitações de Cancelamento */}
          {scopedCancelRequests.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-white overflow-hidden dark:border-amber-800/70 dark:bg-slate-900">
              <button
                type="button"
                onClick={() => setCancelSectionOpen((p) => !p)}
                className="w-full px-4 py-3 flex items-center justify-between text-xs font-semibold text-slate-900 hover:bg-amber-50/40 dark:text-slate-100"
              >
                <span className="tabular-nums">
                  Solicitações de Cancelamento Encaminhadas ({scopedCancelRequests.length})
                </span>
                <ChevronDown
                  className={`w-4 h-4 text-slate-500 transition-transform dark:text-slate-400 ${
                    cancelSectionOpen ? 'rotate-180' : ''
                  }`}
                />
              </button>
              {cancelSectionOpen && (
                <div className="divide-y divide-slate-100 border-t border-amber-100 max-h-60 overflow-y-auto dark:divide-slate-800 dark:border-amber-800/70">
                  {scopedCancelRequests.map((reqNote) => {
                    const cl = clientMap.get(reqNote.clientId);
                    const linkedAdm = reqNote.cancelRequest?.admissionId
                      ? (payload?.admissions || []).find(
                          (a) => a.id === reqNote.cancelRequest?.admissionId
                        )
                      : undefined;
                    return (
                      <div
                        key={reqNote.id}
                        className="px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs"
                      >
                        <div className="min-w-0">
                          <span className="font-semibold text-slate-900 dark:text-slate-100">
                            {cl?.fullName || `Cliente #${reqNote.clientId}`}
                          </span>
                          <span className="text-slate-500 font-mono tabular-nums dark:text-slate-400">
                            {' '}
                            · {reqNote.cancelRequest?.admissionContract || 'Contrato não informado'} ·{' '}
                            {formatDueDateLocalBR(reqNote.cancelRequest?.requestDate)} · Resp:{' '}
                            {reqNote.collaboratorName}
                          </span>
                          {reqNote.note && (
                            <p className="text-[11px] text-slate-600 truncate max-w-2xl mt-0.5 dark:text-slate-300">
                              {reqNote.note}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {linkedAdm && canVerFicha && (
                            <button
                              type="button"
                              onClick={() => setAdmissionModalObj(linkedAdm)}
                              className="rounded border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                            >
                              Ver Ficha
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() =>
                              setClientModalState({ clientId: reqNote.clientId, tab: 'dados' })
                            }
                            className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                          >
                            <Eye className="w-3 h-3" />
                            Ver Cliente
                          </button>
                          {canExcluir && (
                            <button
                              type="button"
                              onClick={() => setDeletingCancelNote(reqNote)}
                              className="p-1 text-slate-400 hover:text-red-600 dark:text-slate-400"
                              title="Excluir solicitação"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Barra de Busca + Filtros Colapsáveis */}
          <div className="rounded-xl border border-slate-200 bg-white p-3.5 space-y-3 dark:border-slate-700 dark:bg-slate-900">
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="relative flex-1 min-w-[240px]">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 dark:text-slate-400" />
                <input
                  type="text"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="Buscar por cliente, CPF/CNPJ, nº documento ou histórico..."
                  className="w-full rounded-lg border border-slate-200 bg-slate-50/60 pl-9 pr-8 py-2 text-xs text-slate-900 focus:bg-white focus:border-slate-900 focus:outline-none dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-100 dark:focus:bg-slate-900"
                />
                {searchInput && (
                  <button
                    type="button"
                    onClick={() => setSearchInput('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              <select
                value={unitFilter}
                onChange={(e) => {
                  setUnitFilter(e.target.value);
                  setPage(1);
                }}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
              >
                <option value="all">Todas as Unidades</option>
                {units.map((u) => (
                  <option key={u.id} value={String(u.id)}>
                    {u.name}
                  </option>
                ))}
              </select>

              <select
                value={filterUf}
                onChange={(e) => {
                  setFilterUf(e.target.value);
                  setPage(1);
                }}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
              >
                <option value="">Todos os Estados (UF)</option>
                {availableUfs.map((uf) => (
                  <option key={uf} value={uf}>
                    UF: {uf}
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={() => {
                  setOverdueOnly((p) => !p);
                  setPage(1);
                }}
                className={`rounded-lg border px-3 py-2 text-xs font-semibold transition-colors whitespace-nowrap ${
                  overdueOnly
                    ? 'border-red-600 bg-red-600 text-white'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800'
                }`}
              >
                Apenas Vencidos
              </button>

              <button
                type="button"
                onClick={() => setFiltersOpen((p) => !p)}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold whitespace-nowrap ${
                  filtersOpen || activeFilterCount > 0
                    ? 'border-slate-900 bg-slate-900 text-white dark:border-emerald-500 dark:bg-emerald-600'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800'
                }`}
              >
                <Filter className="w-3.5 h-3.5" />
                Filtros{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
              </button>

              {activeFilterCount > 0 && (
                <button
                  type="button"
                  onClick={clearAllFilters}
                  className="text-xs font-semibold text-slate-600 hover:text-slate-900 px-2 whitespace-nowrap dark:text-slate-300 dark:hover:text-white"
                >
                  Limpar Filtros
                </button>
              )}
            </div>

            {filtersOpen && (
              <div className="pt-3 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 dark:border-slate-800">
                {isAdmin && (
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1 dark:text-slate-300">
                      Responsável
                    </label>
                    <select
                      value={filterCollaborator}
                      onChange={(e) => {
                        setFilterCollaborator(e.target.value);
                        setPage(1);
                      }}
                      className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    >
                      <option value="">Todos os Operadores</option>
                      <option value="__unassigned__">Sem Atribuição</option>
                      {collaborators.map((c) => (
                        <option key={c.id} value={String(c.id)}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1 dark:text-slate-300">
                    Status do Título
                  </label>
                  <select
                    value={filterStatus}
                    onChange={(e) => {
                      setFilterStatus(e.target.value);
                      setPage(1);
                    }}
                    className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  >
                    <option value="">Todos os Status</option>
                    <option value="ABERTO">Em Aberto</option>
                    <option value="PARCIAL">Recebimento Parcial</option>
                    <option value="PAGO">Recebimento Total</option>
                    <option value="PROTESTADO">Protestado</option>
                    <option value="PROVISAO">Provisão</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1 dark:text-slate-300">
                    Faixa de Atraso
                  </label>
                  <select
                    value={filterAgingBucket}
                    onChange={(e) => {
                      setFilterAgingBucket(e.target.value);
                      setPage(1);
                    }}
                    className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  >
                    <option value="">Todas as Faixas</option>
                    <option value="a_vencer">A Vencer</option>
                    <option value="1_30">1–30 dias</option>
                    <option value="31_60">31–60 dias</option>
                    <option value="61_90">61–90 dias</option>
                    <option value="90_plus">90+ dias</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1 dark:text-slate-300">
                    Vencimento De
                  </label>
                  <input
                    type="date"
                    value={filterDueFrom}
                    onChange={(e) => {
                      setFilterDueFrom(e.target.value);
                      setPage(1);
                    }}
                    className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-mono tabular-nums text-slate-900 dark:border-slate-700 dark:text-slate-100"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1 dark:text-slate-300">
                    Vencimento Até
                  </label>
                  <input
                    type="date"
                    value={filterDueTo}
                    onChange={(e) => {
                      setFilterDueTo(e.target.value);
                      setPage(1);
                    }}
                    className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-mono tabular-nums text-slate-900 dark:border-slate-700 dark:text-slate-100"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Workspace: Data Grid + Painel Lateral (Duplo clique na linha) */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            <div
              className={`${
                activeSideTitle && activeSideClient ? 'lg:col-span-7' : 'lg:col-span-12'
              } rounded-xl border border-slate-200 bg-white overflow-hidden dark:border-slate-700 dark:bg-slate-900`}
            >
              <div className="px-4 py-2.5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600 dark:border-slate-800 dark:text-slate-300">
                <span className="font-semibold text-slate-800 tabular-nums dark:text-slate-100">
                  {sortedTitles.length} título(s) encontrado(s) · Página {safePage} de {totalPages}
                </span>
                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                  Duplo clique em qualquer linha para abrir o painel lateral completo
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/80 text-[11px] font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300">
                      <th className="py-2.5 pl-3 pr-2 w-8">Risco</th>
                      <th className="py-2.5 px-2.5">
                        <button
                          type="button"
                          onClick={() => toggleSort('clientName')}
                          className="inline-flex items-center gap-1 hover:text-slate-900 whitespace-nowrap dark:hover:text-white"
                        >
                          Cliente
                          {renderSortIcon('clientName')}
                        </button>
                      </th>
                      <th className="py-2.5 px-2 text-center whitespace-nowrap">Fichas</th>
                      <th className="py-2.5 px-2 text-center whitespace-nowrap">Aditivos</th>
                      {isAdmin && (
                        <th className="py-2.5 px-2.5 whitespace-nowrap">Responsável</th>
                      )}
                      <th className="py-2.5 px-2.5">
                        <button
                          type="button"
                          onClick={() => toggleSort('documentNumber')}
                          className="inline-flex items-center gap-1 hover:text-slate-900 whitespace-nowrap dark:hover:text-white"
                        >
                          Documento
                          {renderSortIcon('documentNumber')}
                        </button>
                      </th>
                      <th className="py-2.5 px-2.5">
                        <button
                          type="button"
                          onClick={() => toggleSort('dueDate')}
                          className="inline-flex items-center gap-1 hover:text-slate-900 whitespace-nowrap dark:hover:text-white"
                        >
                          Vencimento
                          {renderSortIcon('dueDate')}
                        </button>
                      </th>
                      <th className="py-2.5 px-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => toggleSort('balanceCents')}
                          className="inline-flex items-center justify-end gap-1 hover:text-slate-900 whitespace-nowrap ml-auto dark:hover:text-white"
                        >
                          Saldo
                          {renderSortIcon('balanceCents')}
                        </button>
                      </th>
                      <th className="py-2.5 px-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => toggleSort('agingDays')}
                          className="inline-flex items-center justify-end gap-1 hover:text-slate-900 whitespace-nowrap ml-auto dark:hover:text-white"
                        >
                          Atraso
                          {renderSortIcon('agingDays')}
                        </button>
                      </th>
                      <th className="py-2.5 px-2.5 whitespace-nowrap">Status</th>
                      <th className="py-2.5 px-2.5 whitespace-nowrap">Próx. Contato</th>
                      <th className="py-2.5 pl-2 pr-3 text-right whitespace-nowrap">Ações</th>
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-slate-100 text-xs dark:divide-slate-800">
                    {loading ? (
                      <tr>
                        <td
                          colSpan={isAdmin ? 12 : 11}
                          className="py-14 text-center text-xs text-slate-500 dark:text-slate-400"
                        >
                          Carregando carteira certificada de cobrança...
                        </td>
                      </tr>
                    ) : pagedTitles.length === 0 ? (
                      <tr>
                        <td
                          colSpan={isAdmin ? 12 : 11}
                          className="py-14 text-center text-xs text-slate-500 dark:text-slate-400"
                        >
                          Nenhum título encontrado para os filtros selecionados.
                        </td>
                      </tr>
                    ) : (
                      pagedTitles.map((t) => {
                        const cl = clientMap.get(t.clientId);
                        const collab = t.assignedCollaboratorId
                          ? collabMap.get(t.assignedCollaboratorId)
                          : undefined;
                        const st = normUpperStatus(t.status);
                        const days = st === 'PAGO' ? 0 : computeAgingDays(t.dueDate);
                        const bucket = getAgingBucket(days);
                        const b = computeTitleFinancialBreakdown(t, settledByTitleMap);
                        const admSummary = payload?.admissionSummaryByClient?.[t.clientId] || {
                          fichas: 0,
                          aditivos: 0,
                          latestAddendumDate: null,
                        };
                        const notesCount = noteMetaByTitle.countByTitle.get(t.id) || 0;
                        const nextContact =
                          noteMetaByTitle.nextDateByTitle.get(t.id) ||
                          noteMetaByTitle.nextDateByClient.get(t.clientId) ||
                          '';
                        const unreadWa = unreadWhatsappByClient.get(t.clientId) || 0;
                        const isSideOpen = sidePanelTitleId === t.id;
                        const isBlocked =
                          cl?.status === 'suspenso' || cl?.status === 'cancelado';

                        const riskBarColor =
                          st === 'PAGO'
                            ? 'bg-emerald-500'
                            : bucket === 'a_vencer'
                            ? 'bg-emerald-500'
                            : bucket === '1_30'
                            ? 'bg-amber-500'
                            : bucket === '31_60'
                            ? 'bg-orange-500'
                            : 'bg-red-600';

                        return (
                          <tr
                            key={t.id}
                            onDoubleClick={() =>
                              setSidePanelTitleId((prev) => (prev === t.id ? null : t.id))
                            }
                            className={`transition-colors cursor-pointer ${
                              isSideOpen ? 'bg-slate-900/[0.04]' : 'hover:bg-slate-50/90 dark:hover:bg-slate-800'
                            }`}
                          >
                            <td className="py-2.5 pl-3 pr-2">
                              <span
                                title={
                                  st === 'PAGO'
                                    ? 'Liquidado'
                                    : days > 0
                                    ? `${days} dias em atraso`
                                    : 'Em dia / A vencer'
                                }
                                className={`block w-1.5 h-6 rounded-xs ${riskBarColor}`}
                              />
                            </td>

                            <td className="py-2.5 px-2.5 max-w-[230px]">
                              <div className="font-semibold text-slate-900 truncate dark:text-slate-100">
                                {cl?.fullName || t.clientName || `Cliente #${t.clientId}`}
                              </div>
                              <div className="text-[11px] font-mono text-slate-500 tabular-nums flex flex-wrap items-center gap-x-1.5 dark:text-slate-400">
                                <span>{cl?.cpfCnpj || '—'}</span>
                                {cl?.state && <span>· {cl.state.toUpperCase()}</span>}
                                {unreadWa > 0 && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setClientModalState({
                                        clientId: t.clientId,
                                        tab: 'whatsapp',
                                      });
                                    }}
                                    className="text-emerald-700 font-semibold hover:underline dark:text-emerald-300"
                                  >
                                    · {unreadWa} msg WhatsApp
                                  </button>
                                )}
                                {isBlocked && (
                                  <span className="text-red-700 font-semibold dark:text-red-300">
                                    · {cl?.status.toUpperCase()}
                                  </span>
                                )}
                              </div>
                            </td>

                            <td className="py-2.5 px-2 text-center font-mono tabular-nums">
                              {admSummary.fichas > 0 ? (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const firstAdm = (payload?.admissions || []).find(
                                      (a) => a.clientId === t.clientId
                                    );
                                    if (firstAdm && canVerFicha) {
                                      setAdmissionModalObj(firstAdm);
                                    } else {
                                      setClientModalState({
                                        clientId: t.clientId,
                                        tab: 'dados',
                                      });
                                    }
                                  }}
                                  className="font-semibold text-slate-900 hover:underline dark:text-slate-100"
                                >
                                  {admSummary.fichas}
                                </button>
                              ) : (
                                <span className="text-slate-400 dark:text-slate-400">0</span>
                              )}
                            </td>

                            <td className="py-2.5 px-2 text-center font-mono tabular-nums">
                              {admSummary.aditivos > 0 ? (
                                <div className="leading-tight">
                                  <span className="font-semibold text-slate-900 dark:text-slate-100">
                                    {admSummary.aditivos}
                                  </span>
                                  {admSummary.latestAddendumDate && (
                                    <span className="block text-[10px] text-slate-500 dark:text-slate-400">
                                      {formatDateBR(admSummary.latestAddendumDate)}
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <span className="text-slate-400 dark:text-slate-400">0</span>
                              )}
                            </td>

                            {isAdmin && (
                              <td className="py-2.5 px-2.5 text-slate-700 max-w-[150px] truncate dark:text-slate-200">
                                {collab ? (
                                  collab.name
                                ) : (
                                  <span className="text-slate-400 dark:text-slate-400">Sem atribuição</span>
                                )}
                              </td>
                            )}

                            <td className="py-2.5 px-2.5 font-mono text-slate-800 tabular-nums whitespace-nowrap dark:text-slate-100">
                              <div>{t.documentNumber || t.titleCode}</div>
                              {t.totalInstallments > 1 && (
                                <div className="text-[10px] text-slate-500 dark:text-slate-400">
                                  Parc. {t.installmentNumber}/{t.totalInstallments}
                                </div>
                              )}
                            </td>

                            <td className="py-2.5 px-2.5 font-mono text-slate-800 tabular-nums whitespace-nowrap dark:text-slate-100">
                              {formatDueDateLocalBR(t.dueDate)}
                            </td>

                            <td className="py-2.5 px-2.5 text-right font-mono font-bold tabular-nums whitespace-nowrap">
                              <span
                                className={
                                  st === 'PAGO'
                                    ? 'text-emerald-700 dark:text-emerald-300'
                                    : days > 0
                                    ? 'text-red-600 dark:text-red-400'
                                    : 'text-slate-900 dark:text-slate-100'
                                }
                              >
                                {formatBRL(b.balanceCents)}
                              </span>
                            </td>

                            <td className="py-2.5 px-2.5 text-right font-mono tabular-nums whitespace-nowrap">
                              {st === 'PAGO' ? (
                                <span className="text-emerald-700 font-semibold dark:text-emerald-300">Liquidado</span>
                              ) : days > 0 ? (
                                <span className="text-red-600 font-semibold dark:text-red-400">{days}d</span>
                              ) : days === 0 ? (
                                <span className="text-amber-700 font-semibold dark:text-amber-300">Hoje</span>
                              ) : (
                                <span className="text-slate-500 dark:text-slate-400">em {Math.abs(days)}d</span>
                              )}
                            </td>

                            <td className="py-2.5 px-2.5 whitespace-nowrap">
                              <div className="text-slate-800 font-medium dark:text-slate-100">
                                {translateTitleStatus(t.status)}
                              </div>
                              <div className="text-[10px] text-slate-500 dark:text-slate-400">
                                {translateCollectionSituation(t.collectionStatus)}
                              </div>
                            </td>

                            <td className="py-2.5 px-2.5 font-mono text-[11px] text-slate-700 tabular-nums whitespace-nowrap dark:text-slate-200">
                              {nextContact ? (
                                formatDueDateLocalBR(nextContact)
                              ) : (
                                <span className="text-slate-400 dark:text-slate-400">—</span>
                              )}
                            </td>

                            <td
                              className="py-2.5 pl-2 pr-3 text-right whitespace-nowrap"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <div className="inline-flex items-center justify-end gap-1">
                                <button
                                  type="button"
                                  title="Simulação, Negociação & Contatos (3 Colunas)"
                                  onClick={() => setContactModalTitleId(t.id)}
                                  className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-800 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                                >
                                  <PhoneCall className="w-3 h-3 text-slate-600 dark:text-slate-300" />
                                  {notesCount > 0 && (
                                    <span className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                                      {notesCount > 9 ? '9+' : notesCount}
                                    </span>
                                  )}
                                </button>

                                <button
                                  type="button"
                                  title="Abrir Painel Lateral Completo"
                                  onClick={() =>
                                    setSidePanelTitleId((prev) => (prev === t.id ? null : t.id))
                                  }
                                  className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
                                >
                                  <PanelRightOpen className="w-3.5 h-3.5" />
                                </button>

                                <button
                                  type="button"
                                  title="Histórico de Movimentações e Auditoria"
                                  onClick={() => setHistoryTitle(t)}
                                  className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
                                >
                                  <History className="w-3.5 h-3.5" />
                                </button>

                                <button
                                  type="button"
                                  title="Ficha do Cliente & WhatsApp"
                                  onClick={() =>
                                    setClientModalState({ clientId: t.clientId, tab: 'dados' })
                                  }
                                  className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
                                >
                                  <User className="w-3.5 h-3.5" />
                                </button>

                                <button
                                  type="button"
                                  title="Conversa WhatsApp 3-Colunas & Ligação Uazapi"
                                  onClick={() =>
                                    setClientModalState({
                                      clientId: t.clientId,
                                      tab: 'whatsapp',
                                    })
                                  }
                                  className="p-1.5 rounded-md text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-950/60"
                                >
                                  <MessageSquare className="w-3.5 h-3.5" />
                                </button>

                                {canExcluir && (
                                  <button
                                    type="button"
                                    title="Excluir Título (permitido apenas quando Cancelado)"
                                    onClick={() => setDeletingTitle(t)}
                                    className="p-1.5 rounded-md text-slate-400 hover:bg-red-50 hover:text-red-600 dark:text-slate-400 dark:hover:bg-red-950/60"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {/* Rodapé: Recálculo Financeiro Consolidado de Todos os Filtrados */}
              <div className="border-t border-slate-200 bg-slate-50/80 px-4 py-3 dark:border-slate-700 dark:bg-slate-800/60">
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 text-xs font-mono tabular-nums">
                  <span className="font-sans font-semibold text-slate-700 dark:text-slate-200">
                    Recálculo Financeiro ({filteredTitles.length} títulos filtrados):
                  </span>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-slate-600 dark:text-slate-300">
                    <span>
                      Orig: <strong className="text-slate-900 dark:text-slate-100">{formatBRL(gridSummary.footer.originalCents)}</strong>
                    </span>
                    <span>·</span>
                    <span>
                      Juros: <strong className="text-slate-800 dark:text-slate-100">{formatBRL(gridSummary.footer.interestCents)}</strong>
                    </span>
                    <span>·</span>
                    <span>
                      Multa: <strong className="text-slate-800 dark:text-slate-100">{formatBRL(gridSummary.footer.fineCents)}</strong>
                    </span>
                    <span>·</span>
                    <span>
                      Desc: <strong className="text-amber-700 dark:text-amber-300">{formatBRL(gridSummary.footer.discountCents)}</strong>
                    </span>
                    <span>·</span>
                    <span>
                      Atualiz.: <strong className="text-slate-900 dark:text-slate-100">{formatBRL(gridSummary.footer.updatedCents)}</strong>
                    </span>
                    <span>·</span>
                    <span>
                      Recebido: <strong className="text-emerald-700 dark:text-emerald-300">{formatBRL(gridSummary.footer.receivedCents)}</strong>
                    </span>
                    <span>·</span>
                    <span>
                      Saldo: <strong className="text-red-600 dark:text-red-400">{formatBRL(gridSummary.footer.balanceCents)}</strong>
                    </span>
                  </div>
                </div>
              </div>

              {/* Paginação (50 itens por página) */}
              {totalPages > 1 && (
                <div className="border-t border-slate-200 bg-white px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs font-mono tabular-nums dark:border-slate-700 dark:bg-slate-900">
                  <span className="text-slate-600 dark:text-slate-300">
                    Exibindo {(safePage - 1) * PAGE_SIZE + 1}–
                    {Math.min(safePage * PAGE_SIZE, sortedTitles.length)} de {sortedTitles.length}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      disabled={safePage <= 1}
                      onClick={() => setPage(1)}
                      className="rounded border border-slate-200 bg-white px-2.5 py-1 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
                    >
                      Primeira
                    </button>
                    <button
                      type="button"
                      disabled={safePage <= 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      className="rounded border border-slate-200 bg-white px-2.5 py-1 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
                    >
                      Anterior
                    </button>
                    <span className="px-2 font-semibold text-slate-900 dark:text-slate-100">
                      {safePage} / {totalPages}
                    </span>
                    <button
                      type="button"
                      disabled={safePage >= totalPages}
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      className="rounded border border-slate-200 bg-white px-2.5 py-1 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
                    >
                      Próxima
                    </button>
                    <button
                      type="button"
                      disabled={safePage >= totalPages}
                      onClick={() => setPage(totalPages)}
                      className="rounded border border-slate-200 bg-white px-2.5 py-1 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
                    >
                      Última
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Painel Lateral (Aberto por Duplo Clique ou botão Painel) */}
            {activeSideTitle && activeSideClient && (
              <div className="lg:col-span-5">
                <CollectionSidePanel
                  title={activeSideTitle}
                  client={activeSideClient}
                  allClientTitles={allReceberTitles.filter(
                    (t) => t.clientId === activeSideClient.id
                  )}
                  admissions={payload?.admissions || []}
                  documents={payload?.documents || []}
                  notes={notes}
                  cases={cases}
                  categories={payload?.categories || []}
                  settledByTitleMap={settledByTitleMap}
                  canVerFicha={canVerFicha}
                  canExcluirDoc={canExcluir}
                  onSelectTitle={(t) => setSidePanelTitleId(t.id)}
                  onOpenContactModal={(t) => setContactModalTitleId(t.id)}
                  onOpenClientModal={(cId, tab) => setClientModalState({ clientId: cId, tab })}
                  onOpenAdmissionModal={(adm) => setAdmissionModalObj(adm)}
                  onClose={() => setSidePanelTitleId(null)}
                  onReload={loadOperationalData}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* ABA 2: DASHBOARD OPERACIONAL (Meus Resultados / Resultados Gerais)    */}
      {/* ===================================================================== */}
      {viewMode === 'DASHBOARD' && (
        <CollectionOperationalDashboard
          isAdmin={isAdmin}
          operatorLabel={
            isAdmin
              ? 'Todas as Carteiras (Visão Administrativa)'
              : `Minha Carteira (${linkedCollaborator?.name || currentUser?.name || 'Operador'})`
          }
          scopedPortfolioTitles={scopedPortfolioTitles}
          scopedPaidTitles={scopedPaidTitles}
          scopedAllTitles={scopedAllTitles}
          settlements={settlements}
          clients={clients}
          collaborators={collaborators}
          settledByTitleMap={settledByTitleMap}
          onSelectAgingBucket={(bucketKey) => {
            setOverdueOnly(false);
            setFilterAgingBucket(bucketKey);
            setFiltersOpen(true);
            setViewMode('GRID');
            setPage(1);
          }}
        />
      )}

      {/* ===================================================================== */}
      {/* ABA 3: RANKING COLABORADORES (2 Tabelas Certificadas)                 */}
      {/* ===================================================================== */}
      {viewMode === 'RANKING' && (
        <CollaboratorRankingTables
          titles={allReceberTitles}
          settlements={settlements}
          collaborators={collaborators}
          operators={payload?.operators || []}
          notes={notes}
          cases={cases}
          unitFilter={unitFilter}
        />
      )}

      {/* ===================================================================== */}
      {/* MODAIS COMPARTILHADOS & OPERACIONAIS                                  */}
      {/* ===================================================================== */}
      <CollectionContactModal
        open={Boolean(contactModalTitle && contactModalClient)}
        title={contactModalTitle}
        client={contactModalClient}
        admissions={payload?.admissions || []}
        collaborators={collaborators}
        documents={payload?.documents || []}
        notes={notes}
        settledByTitleMap={settledByTitleMap}
        whatsappThreads={payload?.whatsappThreads || []}
        defaultCollaboratorId={linkedCollaborator?.id ?? null}
        onClose={() => setContactModalTitleId(null)}
        onOpenClientWhatsapp={(clientId) => {
          setContactModalTitleId(null);
          setClientModalState({ clientId, tab: 'whatsapp' });
        }}
        onSaved={async (msg) => {
          await loadOperationalData(msg);
        }}
      />

      <AuditHistoryModal
        title={historyTitle}
        clientName={
          historyTitle
            ? clientMap.get(historyTitle.clientId)?.fullName || historyTitle.clientName || 'Cliente'
            : ''
        }
        onClose={() => setHistoryTitle(null)}
      />

      <EntityAuditModal
        open={sectorAuditOpen}
        title="Cobrança & Ranking · Auditoria Cumulativa"
        entityType="collection_cases,collection_notes,financial_titles,title_settlements"
        entityId="all"
        onClose={() => setSectorAuditOpen(false)}
      />

      <ConfirmDeleteModal
        open={Boolean(deletingTitle)}
        title="Excluir Título"
        message={
          deletingTitle
            ? `Excluir o título "${deletingTitle.documentNumber || deletingTitle.titleCode}" de ${
                clientMap.get(deletingTitle.clientId)?.fullName ||
                deletingTitle.clientName ||
                'Cliente'
              }? Exclusão permitida apenas para títulos com status CANCELADO e sem baixas.`
            : ''
        }
        busy={deleteTitleBusy}
        onCancel={() => setDeletingTitle(null)}
        onConfirm={handleConfirmDeleteTitle}
      />

      <ConfirmDeleteModal
        open={Boolean(deletingCancelNote)}
        title="Excluir Solicitação de Cancelamento"
        message="Deseja excluir esta solicitação de cancelamento? A ação será gravada no log de auditoria."
        busy={deleteCancelBusy}
        onCancel={() => setDeletingCancelNote(null)}
        onConfirm={handleConfirmDeleteCancelRequest}
      />

      <ClientDetailModal
        client={activeClientForModal}
        initialTab={clientModalState?.tab || 'dados'}
        initialCollaboratorId={clientModalState?.collaboratorId ?? null}
        initialAdmissionId={clientModalState?.admissionId ?? null}
        admissions={payload?.admissions || []}
        portfolioTitles={payload?.portfolioTitles || []}
        allReceberTitles={allReceberTitles}
        collaborators={collaborators}
        users={payload?.operators || []}
        documents={payload?.documents || []}
        recalcScenarios={payload?.recalcScenarios || []}
        gotalkEnabled={Boolean(payload?.gotalkEnabled)}
        whatsappThreads={payload?.whatsappThreads || []}
        whatsappMessages={payload?.whatsappMessages || []}
        gotalkChannels={payload?.gotalkChannels || []}
        gotalkOperators={payload?.gotalkOperators || []}
        gotalkHsmTemplates={payload?.gotalkHsmTemplates || []}
        onClose={() => setClientModalState(null)}
        onOpenAdmission={(adm) => {
          if (!canVerFicha) {
            setErrToast('Sem permissão para visualizar a Ficha de Admissão.');
            return;
          }
          setAdmissionModalObj(adm);
        }}
        onMessageSent={() => loadOperationalData()}
      />

      <AdmissionDetailModal
        admission={admissionModalObj}
        clients={clients}
        collaborators={collaborators}
        units={payload?.units || units}
        banks={payload?.banks || []}
        modalities={payload?.modalities || []}
        seriesList={payload?.series || []}
        documents={payload?.documents || []}
        recalcScenarios={payload?.recalcScenarios || []}
        negotiations={payload?.negotiations || []}
        titleSettlements={settlements}
        allReceberTitles={allReceberTitles}
        clientAdmissions={
          admissionModalObj
            ? (payload?.admissions || []).filter((a) => a.clientId === admissionModalObj.clientId)
            : []
        }
        whatsappThreads={payload?.whatsappThreads || []}
        whatsappMessages={payload?.whatsappMessages || []}
        gotalkChannels={payload?.gotalkChannels || []}
        gotalkHsmTemplates={payload?.gotalkHsmTemplates || []}
        onSelectAdmission={(adm) => setAdmissionModalObj(adm)}
        onMessageSent={() => loadOperationalData()}
        onClose={() => setAdmissionModalObj(null)}
      />
    </div>
  );
};
