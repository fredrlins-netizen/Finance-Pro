import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowRightLeft,
  ArrowUp,
  ArrowUpDown,
  BarChart3,
  Barcode,
  Bot,
  Briefcase,
  ChevronDown,
  ChevronRight,
  Clock,
  Download,
  Edit3,
  Eye,
  FileSpreadsheet,
  FileText,
  Filter,
  History,
  Landmark,
  ListFilter,
  ListTodo,
  MapPin,
  MessageSquare,
  Monitor,
  Paperclip,
  QrCode,
  RefreshCw,
  Repeat,
  Search,
  ShieldAlert,
  Sparkles,
  Trash2,
  Trophy,
  UserCheck,
  X,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { apiFetch, formatBRL, formatDateBR, formatDateTimeBR } from '../../lib/api.ts';
import {
  exportDashboardSnapshotToExcel,
  exportDashboardSnapshotToPdf,
  exportReportToExcel,
  exportReportToPdf,
  exportStateMonthlyIndicatorsToExcel,
  exportStateMonthlyIndicatorsToPdf,
  formatReportCellValue,
} from '../../lib/collectionExport.ts';
import {
  Admission,
  AuthUser,
  BankAccount,
  BankItem,
  Client,
  CollaboratorItem,
  CollectionNote,
  CollectionReport,
  DocumentObject,
  FinancialTitle,
  GotalkChannelPublic,
  GotalkHsmTemplate,
  GotalkOperatorPublic,
  IviCollectionInsightCard,
  IviCollectionInsightsPayload,
  IviStateMonthAnalysis,
  ModalityItem,
  Negotiation,
  RecalcScenario,
  SeriesItem,
  StateDebtRecoveryMetric,
  TitleSettlement,
  Unit,
  UserGroup,
  WhatsappMessage,
  WhatsappThread,
} from '../../types.ts';
import {
  AdmissionDetailModal,
  AuditHistoryModal,
  BatchAssignModal,
  ClientDetailModal,
  computeAgingDays,
  ConfirmDeleteModal,
  EditTitleModal,
  formatDueDateLocalBR,
  getAgingBucket,
  OperatorShadowModal,
  toIsoDateInput,
  translateCollectionSituation,
  translateTitleStatus,
} from './CollectionCoordinatorModalViews.tsx';
import { CollectionCoordinatorTasksView } from './CollectionCoordinatorTasksView.tsx';
import { CollaboratorRankingTables } from './CollaboratorRankingTables.tsx';
import { EntityAuditModal } from './cadastros/CadastrosShared.tsx';
import { RecurringInstallmentsModal } from './finance/FinancialTitlesModals.tsx';
import { SantanderPaymentModal } from './finance/SantanderPaymentModal.tsx';
import {
  ApiBankSettlementModal,
  EmitReissueBoletoModal,
} from './finance/SantanderReceivablesActionsModals.tsx';

interface CoordinatorPayload {
  portfolioTitles: FinancialTitle[];
  paidTitles: FinancialTitle[];
  gridTitles?: FinancialTitle[];
  allReceberTitles: FinancialTitle[];
  clients: Client[];
  collaborators: CollaboratorItem[];
  users: Array<{
    id: number;
    name: string;
    email?: string;
    role: string;
    points: number;
    whatsappPhone?: string;
  }>;
  admissions: Admission[];
  documents: DocumentObject[];
  units: Unit[];
  banks: BankItem[];
  bankAccounts?: BankAccount[];
  modalities: ModalityItem[];
  series: SeriesItem[];
  collectionNotes: CollectionNote[];
  recalcScenarios: RecalcScenario[];
  negotiations?: Negotiation[];
  titleSettlements?: TitleSettlement[];
  collectionReports?: CollectionReport[];
  admissionSummaryByClient: Record<
    number,
    { fichas: number; aditivos: number; latestAddendumDate: string | null }
  >;
  gotalkEnabled: boolean;
  whatsappThreads: WhatsappThread[];
  whatsappMessages: WhatsappMessage[];
  gotalkChannels: GotalkChannelPublic[];
  gotalkOperators?: GotalkOperatorPublic[];
  gotalkHsmTemplates: GotalkHsmTemplate[];
}

type SortKey = 'clientName' | 'documentNumber' | 'dueDate' | 'originalValueCents' | 'currentBalanceCents';

interface CollectionCoordinatorViewProps {
  currentUser: AuthUser | null;
  group: UserGroup | null;
  wsTick: number;
  initialClientId?: number;
  initialTitleId?: number;
  onSwitchToOperacional?: (clientId?: number) => void;
}

export const CollectionCoordinatorView: React.FC<CollectionCoordinatorViewProps> = ({
  currentUser,
  group,
  wsTick,
  initialClientId,
  initialTitleId,
  onSwitchToOperacional,
}) => {
  const [data, setData] = useState<CoordinatorPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorBanner, setErrorBanner] = useState('');
  const [toast, setToast] = useState('');

  // Modo principal: GRID ('Carteira de Títulos'), DASHBOARD ('Dashboard'), RANKING ('Ranking') ou TAREFAS ('Tarefas')
  const [viewMode, setViewMode] = useState<'GRID' | 'DASHBOARD' | 'RANKING' | 'TAREFAS'>('GRID');

  // Filtros do GRID (§1.3 & §1.4)
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterSituation, setFilterSituation] = useState('');
  const [filterCollaborator, setFilterCollaborator] = useState('');
  const [filterAgingBucket, setFilterAgingBucket] = useState('');
  const [filterDueFrom, setFilterDueFrom] = useState('');
  const [filterDueTo, setFilterDueTo] = useState('');
  const [filterUf, setFilterUf] = useState('');

  // Ordenação (§1.5 — inicial dueDate ascendente) e paginação (50/página)
  const [sortKey, setSortKey] = useState<SortKey>('dueDate');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);

  // Seleção em lote & Transferência pontual
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [assignOverrideTitles, setAssignOverrideTitles] = useState<FinancialTitle[] | null>(null);

  // Filtros do DASHBOARD (§5.1 + Acumulado Mensal & Estado)
  const [dashDueFrom, setDashDueFrom] = useState('');
  const [dashDueTo, setDashDueTo] = useState('');
  const [dashCollaborator, setDashCollaborator] = useState('');
  const [dashMonth, setDashMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [ufChartMode, setUfChartMode] = useState<'GERAL' | 'MES'>('GERAL');
  const [iviStateAnalysis, setIviStateAnalysis] = useState<IviStateMonthAnalysis | null>(null);
  const [iviStateBusy, setIviStateBusy] = useState(false);
  const [cancelCardOpen, setCancelCardOpen] = useState(false);

  // Espelhamento Silencioso do Operador
  const [shadowCollaboratorId, setShadowCollaboratorId] = useState<number | null>(null);
  const [shadowSelectId, setShadowSelectId] = useState<string>('');

  // Insights da Ivi
  const [iviInsightsOpen, setIviInsightsOpen] = useState(false);
  const [iviInsightsLoading, setIviInsightsLoading] = useState(false);
  const [iviInsights, setIviInsights] = useState<IviCollectionInsightsPayload | null>(null);

  // Ivi Relatórios & Planilhas Salvas no Dashboard
  const [customReportPrompt, setCustomReportPrompt] = useState('');
  const [generatingReport, setGeneratingReport] = useState(false);
  const [selectedReportId, setSelectedReportId] = useState<number | null>(null);

  // Modais
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [editingTitle, setEditingTitle] = useState<FinancialTitle | null>(null);
  const [historyTitle, setHistoryTitle] = useState<FinancialTitle | null>(null);
  const [sectorAuditOpen, setSectorAuditOpen] = useState(false);
  const [deletingTitle, setDeletingTitle] = useState<FinancialTitle | null>(null);
  const [deleteTitleBusy, setDeleteTitleBusy] = useState(false);
  const [deletingCancelNote, setDeletingCancelNote] = useState<CollectionNote | null>(null);
  const [deleteNoteBusy, setDeleteNoteBusy] = useState(false);

  const [clientModalState, setClientModalState] = useState<{
    clientId: number;
    tab: 'dados' | 'whatsapp' | 'atendimentos';
    collaboratorId?: number | null;
    admissionId?: number | null;
  } | null>(null);
  const [admissionModalObj, setAdmissionModalObj] = useState<Admission | null>(null);
  const [recurringModel, setRecurringModel] = useState<FinancialTitle | null>(null);
  const [emitReissueTargets, setEmitReissueTargets] = useState<FinancialTitle[] | null>(null);
  const [apiSettlementOpen, setApiSettlementOpen] = useState(false);
  const [paymentModalTitleId, setPaymentModalTitleId] = useState<number | null>(null);

  const loadCoordinatorData = useCallback(async () => {
    setErrorBanner('');
    try {
      const payload = await apiFetch<CoordinatorPayload>('/api/collection/coordinator');
      setData(payload);
    } catch (err) {
      setErrorBanner(
        err instanceof Error ? err.message : 'Erro ao carregar carteira de cobrança.'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCoordinatorData();
  }, [loadCoordinatorData, wsTick]);

  // Debounce 300ms (§1.3)
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchInput.trim().toLowerCase());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // Deep link inicial se vier de busca global / financeiro
  useEffect(() => {
    if (!data) return;
    if (initialClientId) {
      setClientModalState({ clientId: initialClientId, tab: 'dados' });
    } else if (initialTitleId) {
      const matched = (data.gridTitles || data.portfolioTitles).find((t) => t.id === initialTitleId);
      if (matched) {
        setClientModalState({
          clientId: matched.clientId,
          tab: 'dados',
          admissionId: matched.admissionId || null,
        });
      }
    }
  }, [initialClientId, initialTitleId, data]);

  // Permissões (§2.4 & §3.5)
  const isAdmin = currentUser?.role === 'admin';
  const canExcluir =
    isAdmin ||
    group?.modulePermissions?.fin_cobranca_coord_excluir === true ||
    group?.modulePermissions?.collection !== false;
  const canVerFicha =
    isAdmin ||
    group?.modulePermissions?.com_admissao_visualizar === true ||
    group?.modulePermissions?.admission !== false;

  const clientMap = useMemo(
    () => new Map((data?.clients || []).map((c) => [c.id, c])),
    [data?.clients]
  );
  const collabMap = useMemo(
    () => new Map((data?.collaborators || []).map((c) => [c.id, c])),
    [data?.collaborators]
  );

  const gridSourceTitles = useMemo(
    () => (data?.gridTitles && data.gridTitles.length > 0 ? data.gridTitles : data?.portfolioTitles || []),
    [data?.gridTitles, data?.portfolioTitles]
  );

  // Lista de UFs distintas dos títulos elegíveis carregados (§1.4)
  const availableUfs = useMemo(() => {
    const ufSet = new Set<string>();
    for (const t of gridSourceTitles) {
      const cl = clientMap.get(t.clientId);
      const uf = String(cl?.state || '').trim().toUpperCase();
      if (uf) ufSet.add(uf);
    }
    return [...ufSet].sort();
  }, [gridSourceTitles, clientMap]);

  // Filtragem completa do GRID (§1.4)
  const filteredTitles = useMemo(() => {
    return gridSourceTitles.filter((t) => {
      const cl = clientMap.get(t.clientId);
      const clientName = (cl?.fullName || t.clientName || '').toLowerCase();
      const docNum = (t.documentNumber || t.titleCode || '').toLowerCase();
      const desc = (t.description || '').toLowerCase();

      if (debouncedSearch) {
        const hit =
          clientName.includes(debouncedSearch) ||
          docNum.includes(debouncedSearch) ||
          desc.includes(debouncedSearch);
        if (!hit) return false;
      }

      const normSt = String(t.status || 'ABERTO').trim().toUpperCase();
      const effectiveSt = normSt === 'VENCIDO' ? 'ABERTO' : normSt;
      const days = effectiveSt === 'PAGO' ? 0 : computeAgingDays(t.dueDate);
      if (overdueOnly && (effectiveSt === 'PAGO' || days <= 0)) return false;

      if (filterStatus && effectiveSt !== filterStatus) return false;

      const effectiveSit = String(t.collectionStatus || 'EM_DIA').trim().toUpperCase();
      if (filterSituation && effectiveSit !== filterSituation) return false;

      if (filterCollaborator) {
        if (filterCollaborator === '__unassigned__') {
          if (t.assignedCollaboratorId) return false;
        } else if (String(t.assignedCollaboratorId || '') !== filterCollaborator) {
          return false;
        }
      }

      if (filterAgingBucket && getAgingBucket(days) !== filterAgingBucket) return false;

      const dueIso = toIsoDateInput(t.dueDate);
      if (filterDueFrom && (!dueIso || dueIso < filterDueFrom)) return false;
      if (filterDueTo && (!dueIso || dueIso > filterDueTo)) return false;

      if (filterUf) {
        const clientUf = String(cl?.state || '').toUpperCase();
        if (clientUf !== filterUf) return false;
      }

      return true;
    });
  }, [
    gridSourceTitles,
    clientMap,
    debouncedSearch,
    overdueOnly,
    filterStatus,
    filterSituation,
    filterCollaborator,
    filterAgingBucket,
    filterDueFrom,
    filterDueTo,
    filterUf,
  ]);

  // Ordenação local sobre toda a carteira filtrada
  const sortedTitles = useMemo(() => {
    const arr = [...filteredTitles];
    arr.sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'clientName') {
        const na = clientMap.get(a.clientId)?.fullName || a.clientName || '';
        const nb = clientMap.get(b.clientId)?.fullName || b.clientName || '';
        cmp = na < nb ? -1 : na > nb ? 1 : 0;
      } else if (sortKey === 'documentNumber') {
        const da = a.documentNumber || a.titleCode || '';
        const db = b.documentNumber || b.titleCode || '';
        cmp = da < db ? -1 : da > db ? 1 : 0;
      } else if (sortKey === 'dueDate') {
        const dda = toIsoDateInput(a.dueDate);
        const ddb = toIsoDateInput(b.dueDate);
        cmp = dda < ddb ? -1 : dda > ddb ? 1 : 0;
      } else if (sortKey === 'originalValueCents') {
        cmp =
          Number(a.originalValueCents || a.amountCents || 0) -
          Number(b.originalValueCents || b.amountCents || 0);
      } else if (sortKey === 'currentBalanceCents') {
        const balA = String(a.status || '').toUpperCase() === 'PAGO' ? 0 : Number(a.currentBalanceCents ?? a.amountCents ?? 0);
        const balB = String(b.status || '').toUpperCase() === 'PAGO' ? 0 : Number(b.currentBalanceCents ?? b.amountCents ?? 0);
        cmp = balA - balB;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [filteredTitles, sortKey, sortDir, clientMap]);

  // Totais do GRID (Saldo & Vencido globais do conjunto filtrado)
  const gridTotals = useMemo(() => {
    let totalBalanceCents = 0;
    let overdueBalanceCents = 0;
    let overdueCount = 0;
    for (const t of sortedTitles) {
      const isPaid = String(t.status || '').toUpperCase() === 'PAGO';
      const bal = isPaid ? 0 : Number(t.currentBalanceCents ?? t.amountCents ?? 0);
      totalBalanceCents += bal;
      if (!isPaid && computeAgingDays(t.dueDate) > 0) {
        overdueBalanceCents += bal;
        overdueCount += 1;
      }
    }
    return { totalBalanceCents, overdueBalanceCents, overdueCount };
  }, [sortedTitles]);

  const pageSize = 50;
  const totalPages = Math.max(1, Math.ceil(sortedTitles.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pagedTitles = sortedTitles.slice((safePage - 1) * pageSize, safePage * pageSize);

  const handleSortToggle = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const toggleSelectAll = () => {
    const visibleIds = sortedTitles.map((t) => t.id);
    const allVisibleSelected =
      visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id));
    if (allVisibleSelected) {
      setSelectedIds((prev) => prev.filter((id) => !visibleIds.includes(id)));
    } else {
      setSelectedIds((prev) => [...new Set([...prev, ...visibleIds])]);
    }
  };

  const toggleRow = (id: number) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const clearAllGridFilters = () => {
    setSearchInput('');
    setDebouncedSearch('');
    setOverdueOnly(false);
    setFilterStatus('');
    setFilterSituation('');
    setFilterCollaborator('');
    setFilterAgingBucket('');
    setFilterDueFrom('');
    setFilterDueTo('');
    setFilterUf('');
    setPage(1);
  };

  // KPIs e painéis globais do DASHBOARD (§5 + Indicadores por Estado & Acumulado Mensal)
  const dashboardMetrics = useMemo(() => {
    const activeMonth = dashMonth || new Date().toISOString().slice(0, 7);
    const [mYear, mMon] = activeMonth.split('-').map(Number);
    const monthLabelDate = new Date(mYear || new Date().getFullYear(), (mMon || 1) - 1, 1);
    const monthLabel = Number.isNaN(monthLabelDate.getTime())
      ? activeMonth
      : monthLabelDate
          .toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
          .replace(/^\w/, (ch) => ch.toUpperCase());

    if (!data) {
      return {
        filteredActive: [] as FinancialTitle[],
        filteredPaid: [] as FinancialTitle[],
        totalCount: 0,
        overdueCount: 0,
        defaultRate: 0,
        totalBalanceCents: 0,
        overdueBalanceCents: 0,
        recoveredCents: 0,
        recoveryRate: 0,
        dsoDays: 0,
        agingBuckets: [] as Array<{
          key: string;
          label: string;
          count: number;
          balanceCents: number;
          barClass: string;
        }>,
        collabPerformance: [] as Array<{
          key: string;
          name: string;
          count: number;
          balanceCents: number;
          overdueBalanceCents: number;
        }>,
        stateMetrics: [] as StateDebtRecoveryMetric[],
        monthlyAccumulated: {
          month: activeMonth,
          monthLabel,
          monthDebtCents: 0,
          monthOverdueDebtCents: 0,
          monthRecoveredCents: 0,
          monthRecoveryRatePct: 0,
          monthOpenCount: 0,
          monthSettledCount: 0,
        },
      };
    }

    const filteredActive = data.portfolioTitles.filter((t) => {
      const dueIso = toIsoDateInput(t.dueDate);
      if (dashDueFrom && (!dueIso || dueIso < dashDueFrom)) return false;
      if (dashDueTo && (!dueIso || dueIso > dashDueTo)) return false;
      if (dashCollaborator && String(t.assignedCollaboratorId || '') !== dashCollaborator) {
        return false;
      }
      return true;
    });

    const filteredPaid = data.paidTitles.filter((t) => {
      const dueIso = toIsoDateInput(t.dueDate);
      if (dashDueFrom && (!dueIso || dueIso < dashDueFrom)) return false;
      if (dashDueTo && (!dueIso || dueIso > dashDueTo)) return false;
      if (dashCollaborator && String(t.assignedCollaboratorId || '') !== dashCollaborator) {
        return false;
      }
      return true;
    });

    const totalCount = filteredActive.length;
    let overdueCount = 0;
    let totalBalanceCents = 0;
    let overdueBalanceCents = 0;

    const bucketsMap = {
      a_vencer: { count: 0, balanceCents: 0 },
      '1_30': { count: 0, balanceCents: 0 },
      '31_60': { count: 0, balanceCents: 0 },
      '61_90': { count: 0, balanceCents: 0 },
      '90_plus': { count: 0, balanceCents: 0 },
    };

    const collabGroups = new Map<
      string,
      { key: string; name: string; count: number; balanceCents: number; overdueBalanceCents: number }
    >();

    // Mapa por Estado (UF) + Acumulado do Mês
    const stateGroups = new Map<
      string,
      {
        uf: string;
        clientIds: Set<number>;
        openTitlesCount: number;
        debtBalanceCents: number;
        overdueDebtCents: number;
        recoveredTotalCents: number;
        monthOpenCount: number;
        monthDebtCents: number;
        monthOverdueDebtCents: number;
        monthRecoveredCents: number;
      }
    >();

    const getUfBucket = (clientId: number) => {
      const rawUf = String(clientMap.get(clientId)?.state || '').trim().toUpperCase();
      const uf = rawUf || 'N/I';
      let bucket = stateGroups.get(uf);
      if (!bucket) {
        bucket = {
          uf,
          clientIds: new Set<number>(),
          openTitlesCount: 0,
          debtBalanceCents: 0,
          overdueDebtCents: 0,
          recoveredTotalCents: 0,
          monthOpenCount: 0,
          monthDebtCents: 0,
          monthOverdueDebtCents: 0,
          monthRecoveredCents: 0,
        };
        stateGroups.set(uf, bucket);
      }
      return bucket;
    };

    let monthDebtCents = 0;
    let monthOverdueDebtCents = 0;
    let monthOpenCount = 0;
    let monthRecoveredCents = 0;
    let monthSettledCount = 0;

    for (const t of filteredActive) {
      const bal = Number(t.currentBalanceCents ?? t.amountCents ?? 0);
      const orig = Number(t.originalValueCents || t.amountCents || 0);
      const partialPaid = Math.max(0, orig - bal);
      const days = computeAgingDays(t.dueDate);
      const bucketKey = getAgingBucket(days);

      totalBalanceCents += bal;
      if (days > 0) {
        overdueCount += 1;
        overdueBalanceCents += bal;
      }
      bucketsMap[bucketKey].count += 1;
      bucketsMap[bucketKey].balanceCents += bal;

      const cKey = t.assignedCollaboratorId ? String(t.assignedCollaboratorId) : '__sem_atribuicao__';
      const cName = t.assignedCollaboratorId
        ? collabMap.get(t.assignedCollaboratorId)?.name || 'Sem Atribuição'
        : 'Sem Atribuição';
      const grp = collabGroups.get(cKey) || {
        key: cKey,
        name: cName,
        count: 0,
        balanceCents: 0,
        overdueBalanceCents: 0,
      };
      grp.count += 1;
      grp.balanceCents += bal;
      if (days > 0) grp.overdueBalanceCents += bal;
      collabGroups.set(cKey, grp);

      const ufEntry = getUfBucket(t.clientId);
      ufEntry.clientIds.add(t.clientId);
      ufEntry.openTitlesCount += 1;
      ufEntry.debtBalanceCents += bal;
      if (days > 0) ufEntry.overdueDebtCents += bal;
      if (partialPaid > 0) ufEntry.recoveredTotalCents += partialPaid;

      const dueIso = toIsoDateInput(t.dueDate);
      if (dueIso.startsWith(activeMonth)) {
        monthOpenCount += 1;
        monthDebtCents += bal;
        ufEntry.monthOpenCount += 1;
        ufEntry.monthDebtCents += bal;
        if (days > 0) {
          monthOverdueDebtCents += bal;
          ufEntry.monthOverdueDebtCents += bal;
        }
      }
    }

    // Recuperado Total Geral (PAGO + Baixas Parciais já computadas nos ativos)
    let recoveredCents = 0;
    for (const t of filteredPaid) {
      const paidVal = Number(t.originalValueCents || t.amountCents || 0);
      recoveredCents += paidVal;
      const ufEntry = getUfBucket(t.clientId);
      ufEntry.clientIds.add(t.clientId);
      ufEntry.recoveredTotalCents += paidVal;
    }

    // Recuperação Acumulada no Mês via Liquidações (titleSettlements) + PAGO sem liquidação explícita no mês
    const allTitleById = new Map<number, FinancialTitle>();
    for (const t of data.allReceberTitles) allTitleById.set(t.id, t);
    const settledTitleIdsInMonth = new Set<number>();

    for (const s of data.titleSettlements || []) {
      const sIso = toIsoDateInput(s.settlementDate);
      if (!sIso.startsWith(activeMonth)) continue;
      const linkedTitle = allTitleById.get(s.titleId);
      if (!linkedTitle) continue;
      if (dashCollaborator && String(linkedTitle.assignedCollaboratorId || '') !== dashCollaborator) {
        continue;
      }
      const val = Number(s.amountCents || 0);
      if (val <= 0) continue;
      settledTitleIdsInMonth.add(linkedTitle.id);
      monthRecoveredCents += val;
      monthSettledCount += 1;

      const ufEntry = getUfBucket(linkedTitle.clientId);
      ufEntry.clientIds.add(linkedTitle.clientId);
      ufEntry.monthRecoveredCents += val;
    }

    for (const t of data.paidTitles) {
      if (settledTitleIdsInMonth.has(t.id)) continue;
      if (dashCollaborator && String(t.assignedCollaboratorId || '') !== dashCollaborator) {
        continue;
      }
      const paidIso = toIsoDateInput(t.paidAt || t.dueDate);
      if (!paidIso.startsWith(activeMonth)) continue;
      const val = Number(t.originalValueCents || t.amountCents || 0);
      if (val <= 0) continue;
      monthRecoveredCents += val;
      monthSettledCount += 1;

      const ufEntry = getUfBucket(t.clientId);
      ufEntry.clientIds.add(t.clientId);
      ufEntry.monthRecoveredCents += val;
    }

    // Incluir também títulos em aberto que tiveram baixa parcial no mês (caso ainda existam saldos no mês)
    const stateMetrics: StateDebtRecoveryMetric[] = [...stateGroups.values()]
      .map((s) => {
        const genDenom = s.debtBalanceCents + s.recoveredTotalCents;
        const monDenom = s.monthDebtCents + s.monthRecoveredCents;
        return {
          uf: s.uf,
          clientsCount: s.clientIds.size,
          openTitlesCount: s.openTitlesCount,
          debtBalanceCents: s.debtBalanceCents,
          overdueDebtCents: s.overdueDebtCents,
          recoveredTotalCents: s.recoveredTotalCents,
          recoveryRatePct: genDenom > 0 ? (100 * s.recoveredTotalCents) / genDenom : 0,
          monthOpenCount: s.monthOpenCount,
          monthDebtCents: s.monthDebtCents,
          monthOverdueDebtCents: s.monthOverdueDebtCents,
          monthRecoveredCents: s.monthRecoveredCents,
          monthRecoveryRatePct: monDenom > 0 ? (100 * s.monthRecoveredCents) / monDenom : 0,
        };
      })
      .sort(
        (a, b) =>
          b.debtBalanceCents - a.debtBalanceCents ||
          b.recoveredTotalCents - a.recoveredTotalCents ||
          a.uf.localeCompare(b.uf)
      );

    const monthDenom = monthDebtCents + monthRecoveredCents;
    const monthRecoveryRatePct = monthDenom > 0 ? (100 * monthRecoveredCents) / monthDenom : 0;

    const defaultRate = totalCount > 0 ? (100 * overdueCount) / totalCount : 0;
    const totalPortfolioCents = totalBalanceCents + recoveredCents;
    const recoveryRate = totalPortfolioCents > 0 ? (100 * recoveredCents) / totalPortfolioCents : 0;

    const avgBalance = totalCount > 0 ? totalBalanceCents / totalCount : 0;
    const dailyRevenue = recoveredCents > 0 ? recoveredCents / 30 : 1;
    const dsoDays = totalCount > 0 && dailyRevenue > 0 ? Math.round((avgBalance / dailyRevenue) * 30) : 0;

    const agingBuckets = [
      { key: 'a_vencer', label: 'A Vencer', ...bucketsMap.a_vencer, barClass: 'bg-emerald-500' },
      { key: '1_30', label: '1-30 dias', ...bucketsMap['1_30'], barClass: 'bg-amber-400' },
      { key: '31_60', label: '31-60 dias', ...bucketsMap['31_60'], barClass: 'bg-orange-500' },
      { key: '61_90', label: '61-90 dias', ...bucketsMap['61_90'], barClass: 'bg-red-500' },
      { key: '90_plus', label: '90+ dias', ...bucketsMap['90_plus'], barClass: 'bg-red-700' },
    ];

    const collabPerformance = [...collabGroups.values()].sort(
      (a, b) => b.balanceCents - a.balanceCents
    );

    return {
      filteredActive,
      filteredPaid,
      totalCount,
      overdueCount,
      defaultRate,
      totalBalanceCents,
      overdueBalanceCents,
      recoveredCents,
      recoveryRate,
      dsoDays,
      agingBuckets,
      collabPerformance,
      stateMetrics,
      monthlyAccumulated: {
        month: activeMonth,
        monthLabel,
        monthDebtCents,
        monthOverdueDebtCents,
        monthRecoveredCents,
        monthRecoveryRatePct,
        monthOpenCount,
        monthSettledCount,
      },
    };
  }, [data, dashDueFrom, dashDueTo, dashCollaborator, dashMonth, collabMap, clientMap]);

  // Solicitações de cancelamento pendentes do banco PostgreSQL (§5.5)
  const pendingCancelRequests = useMemo(() => {
    if (!data) return [];
    return (data.collectionNotes || []).filter(
      (n) => n.negotiationStatus === 'SOLICITA_CANCELAMENTO' && Boolean(n.cancelRequest)
    );
  }, [data]);

  const handleConfirmDeleteTitle = async () => {
    if (!deletingTitle) return;
    setDeleteTitleBusy(true);
    setErrorBanner('');
    try {
      await apiFetch(`/api/financial-titles/${deletingTitle.id}`, { method: 'DELETE' });
      setToast('Título removido com sucesso.');
      setSelectedIds((prev) => prev.filter((id) => id !== deletingTitle.id));
      await loadCoordinatorData();
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Não foi possível excluir o título.');
    } finally {
      setDeleteTitleBusy(false);
      setDeletingTitle(null);
    }
  };

  const handleConfirmDeleteCancelNote = async () => {
    if (!deletingCancelNote) return;
    setDeleteNoteBusy(true);
    setErrorBanner('');
    try {
      await apiFetch(`/api/collection-notes/${deletingCancelNote.id}`, { method: 'DELETE' });
      setToast('Solicitação de cancelamento excluída.');
      await loadCoordinatorData();
    } catch (err) {
      setErrorBanner(
        err instanceof Error ? err.message : 'Não foi possível excluir a solicitação.'
      );
    } finally {
      setDeleteNoteBusy(false);
      setDeletingCancelNote(null);
    }
  };

  const selectedTitleObjects = useMemo(() => {
    if (assignOverrideTitles && assignOverrideTitles.length > 0) return assignOverrideTitles;
    const idSet = new Set(selectedIds);
    return gridSourceTitles.filter((t) => idSet.has(t.id));
  }, [assignOverrideTitles, gridSourceTitles, selectedIds]);

  const selectedGridTitles = useMemo(() => {
    const idSet = new Set(selectedIds);
    return gridSourceTitles.filter((t) => idSet.has(t.id));
  }, [gridSourceTitles, selectedIds]);

  const savedReports = data?.collectionReports || [];
  const activeSavedReport = useMemo(() => {
    if (savedReports.length === 0) return null;
    if (selectedReportId) {
      const exact = savedReports.find((r) => r.id === selectedReportId);
      if (exact) return exact;
    }
    return savedReports[0];
  }, [savedReports, selectedReportId]);

  const handleLoadIviInsights = async () => {
    if (!iviInsightsOpen) {
      setIviInsightsOpen(true);
    }
    setIviInsightsLoading(true);
    setErrorBanner('');
    try {
      const res = await apiFetch<IviCollectionInsightsPayload>(
        '/api/collection/coordinator/ivi-insights',
        { method: 'POST', body: JSON.stringify({}) }
      );
      setIviInsights(res);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Erro ao consultar insights da Ivi.');
    } finally {
      setIviInsightsLoading(false);
    }
  };

  const applyInsightFilter = (card: IviCollectionInsightCard) => {
    const p = card.filterPreset;
    if (!p) return;
    clearAllGridFilters();
    if (p.overdueOnly) setOverdueOnly(true);
    if (p.filterStatus) setFilterStatus(p.filterStatus);
    if (p.filterCollaborator) setFilterCollaborator(p.filterCollaborator);
    if (p.filterAgingBucket) setFilterAgingBucket(p.filterAgingBucket);
    if (p.filterUf) setFilterUf(p.filterUf);
    setFiltersOpen(true);
    setViewMode('GRID');
    setPage(1);
    setToast(`Filtro da Ivi aplicado: ${card.title}`);
  };

  const handleGenerateIviReport = async (
    reportType:
      | 'carteira_vencida'
      | 'ranking_operadores'
      | 'recebimentos'
      | 'inadimplencia_uf'
      | 'custom_ivi',
    promptOverride?: string
  ) => {
    setGeneratingReport(true);
    setErrorBanner('');
    try {
      const res = await apiFetch<{ report: CollectionReport }>(
        '/api/collection/coordinator/reports',
        {
          method: 'POST',
          body: JSON.stringify({
            reportType,
            customPrompt: (promptOverride ?? customReportPrompt).trim() || undefined,
          }),
        }
      );
      if (res.report) {
        setSelectedReportId(res.report.id);
        setToast(`Planilha/Relatório "${res.report.title}" salvo no Dashboard.`);
        if (reportType === 'custom_ivi') setCustomReportPrompt('');
        await loadCoordinatorData();
      }
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Erro ao gerar relatório da Ivi.');
    } finally {
      setGeneratingReport(false);
    }
  };

  const handleDeleteSavedReport = async (reportId: number) => {
    setErrorBanner('');
    try {
      await apiFetch(`/api/collection/coordinator/reports/${reportId}`, { method: 'DELETE' });
      if (selectedReportId === reportId) setSelectedReportId(null);
      setToast('Relatório salvo removido do Dashboard.');
      await loadCoordinatorData();
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Erro ao excluir relatório.');
    }
  };

  const handleAnalyzeStateAndMonthWithIvi = async () => {
    setIviStateBusy(true);
    setErrorBanner('');
    try {
      const collabLabel = dashCollaborator
        ? `Op. ${collabMap.get(Number(dashCollaborator))?.name || dashCollaborator}`
        : 'Carteira Global';
      const res = await apiFetch<IviStateMonthAnalysis>(
        '/api/collection/coordinator/ivi-state-analysis',
        {
          method: 'POST',
          body: JSON.stringify({
            month: dashboardMetrics.monthlyAccumulated.month,
            monthLabel: dashboardMetrics.monthlyAccumulated.monthLabel,
            collaboratorLabel: collabLabel,
            monthlyTotals: dashboardMetrics.monthlyAccumulated,
            stateBreakdown: dashboardMetrics.stateMetrics,
          }),
        }
      );
      setIviStateAnalysis(res);
      setToast('Análise estadual e mensal da Ivi atualizada.');
    } catch (err) {
      setErrorBanner(
        err instanceof Error ? err.message : 'Erro ao solicitar análise estadual da Ivi.'
      );
    } finally {
      setIviStateBusy(false);
    }
  };

  const activeClientForModal = clientModalState
    ? clientMap.get(clientModalState.clientId) || null
    : null;

  const renderSortIcon = (key: SortKey) => {
    if (sortKey !== key) return <ArrowUpDown className="w-3 h-3 text-slate-400 dark:text-slate-400" />;
    return sortDir === 'asc' ? (
      <ArrowUp className="w-3 h-3 text-slate-900 dark:text-slate-100" />
    ) : (
      <ArrowDown className="w-3 h-3 text-slate-900 dark:text-slate-100" />
    );
  };

  return (
    <div className="space-y-5">
      {/* Cabeçalho Principal (§1.1) */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-3 border-b border-slate-200 pb-4 dark:border-slate-700">
        <div>
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Cobrança & Ranking · Coordenação, comprovação no Bucket, transferência auditada, espelhamento e relatórios Ivi
          </p>
          <h1 className="mt-1 font-display text-2xl font-bold text-slate-900 dark:text-slate-100">
            Cobrança — Coordenação
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg border border-slate-200 dark:bg-slate-800 dark:border-slate-700">
            <button
              type="button"
              onClick={() => setViewMode('GRID')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                viewMode === 'GRID'
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-slate-100'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
              }`}
            >
              <ListFilter className="w-3.5 h-3.5" />
              Carteira de Títulos
            </button>
            <button
              type="button"
              onClick={() => setViewMode('DASHBOARD')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
                viewMode === 'DASHBOARD'
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-slate-100'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
              }`}
            >
              <BarChart3 className="w-3.5 h-3.5" />
              Dashboard & Ivi
            </button>
            <button
              type="button"
              onClick={() => setViewMode('RANKING')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
                viewMode === 'RANKING'
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-slate-100'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
              }`}
            >
              <Trophy className="w-3.5 h-3.5" />
              Ranking
            </button>
            <button
              type="button"
              onClick={() => setViewMode('TAREFAS')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
                viewMode === 'TAREFAS'
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-slate-100'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
              }`}
            >
              <ListTodo className="w-3.5 h-3.5" />
              Tarefas
            </button>
          </div>

          <button
            type="button"
            onClick={() => setSectorAuditOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <History className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
            Auditoria
          </button>

          <button
            type="button"
            onClick={() => void handleLoadIviInsights()}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${
              iviInsightsOpen
                ? 'border-blue-700 bg-blue-700 text-white'
                : 'border-blue-200 bg-blue-50 text-blue-800 hover:bg-blue-100 dark:border-blue-800/70 dark:bg-blue-950/50 dark:text-blue-300 dark:hover:bg-blue-900/60'
            }`}
          >
            <Bot className="w-3.5 h-3.5" />
            {iviInsightsLoading ? 'Ivi Analisando...' : 'Insights Ivi'}
          </button>

          <div className="inline-flex items-center rounded-lg border border-slate-200 bg-white overflow-hidden dark:border-slate-700 dark:bg-slate-900">
            <select
              value={shadowSelectId}
              onChange={(e) => {
                const val = e.target.value;
                setShadowSelectId(val);
                if (val) setShadowCollaboratorId(Number(val));
              }}
              aria-label="Espelhar tela de operador silenciosamente"
              className="px-2.5 py-2 text-xs text-slate-700 bg-white focus:outline-none dark:text-slate-200 dark:bg-slate-900"
            >
              <option value="">Espelhar Operador...</option>
              {(data?.collaborators || []).map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.name}
                </option>
              ))}
            </select>
            {shadowSelectId && (
              <button
                type="button"
                onClick={() => setShadowCollaboratorId(Number(shadowSelectId))}
                title="Abrir espelhamento silencioso"
                className="px-2.5 py-2 bg-slate-900 text-white hover:bg-slate-800 text-xs font-semibold inline-flex items-center gap-1 dark:bg-emerald-600 dark:hover:bg-emerald-500"
              >
                <Monitor className="w-3.5 h-3.5" />
                Ver
              </button>
            )}
          </div>

          {onSwitchToOperacional && (
            <button
              type="button"
              onClick={() => onSwitchToOperacional()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <Briefcase className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
              Operacional & Ranking
            </button>
          )}
        </div>
      </div>

      {toast && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-medium text-emerald-900 flex items-center justify-between dark:border-emerald-800/70 dark:bg-emerald-950/50 dark:text-emerald-300">
          <span>{toast}</span>
          <button type="button" onClick={() => setToast('')} className="text-emerald-700 hover:text-emerald-950 dark:text-emerald-300">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {errorBanner && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-xs font-medium text-red-900 flex items-center justify-between dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300">
          <span>{errorBanner}</span>
          <button type="button" onClick={() => setErrorBanner('')} className="text-red-700 hover:text-red-950 dark:text-red-300">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* PAINEL PROATIVO DE INSIGHTS E SUGESTÕES DA IVI */}
      {iviInsightsOpen && (
        <div className="rounded-xl border border-blue-200 bg-blue-50/40 p-4 space-y-3 dark:border-blue-800/70 dark:bg-blue-950/50">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-blue-700 shrink-0 dark:text-blue-300" />
              <div>
                <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                  Insights & Sugestões da Ivi — Coordenação
                </h3>
                {iviInsights?.executiveHeadline && (
                  <p className="text-xs text-slate-700 dark:text-slate-200">{iviInsights.executiveHeadline}</p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={iviInsightsLoading}
                onClick={() => void handleLoadIviInsights()}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${iviInsightsLoading ? 'animate-spin' : ''}`} />
                Reanalisar
              </button>
              <button
                type="button"
                onClick={() => setIviInsightsOpen(false)}
                className="p-1 rounded text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {iviInsightsLoading && !iviInsights ? (
            <div className="py-6 text-center text-xs text-slate-600 dark:text-slate-300">
              Ivi analisando carteira em tempo real, comprovantes, atribuições e UFs...
            </div>
          ) : iviInsights?.insights?.length ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              {iviInsights.insights.map((card) => {
                const borderAccent =
                  card.severity === 'critico'
                    ? 'border-l-4 border-l-red-600'
                    : card.severity === 'atencao'
                    ? 'border-l-4 border-l-amber-500'
                    : 'border-l-4 border-l-emerald-600';
                return (
                  <div
                    key={card.id}
                    className={`rounded-lg border border-slate-200 bg-white p-3 space-y-2 flex flex-col justify-between dark:border-slate-700 dark:bg-slate-900 ${borderAccent}`}
                  >
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-[10px] font-mono uppercase text-slate-500 dark:text-slate-400">
                        <span>{card.category}</span>
                        <span
                          className={`font-bold ${
                            card.severity === 'critico'
                              ? 'text-red-700 dark:text-red-300'
                              : card.severity === 'atencao'
                              ? 'text-amber-700 dark:text-amber-300'
                              : 'text-emerald-800 dark:text-emerald-300'
                          }`}
                        >
                          {card.severity}
                        </span>
                      </div>
                      <div className="font-display text-xs font-bold text-slate-900 dark:text-slate-100">
                        {card.title}
                      </div>
                      <p className="text-[11px] text-slate-600 leading-relaxed dark:text-slate-300">
                        {card.description}
                      </p>
                      <p className="text-[11px] font-medium text-blue-900 bg-blue-50/70 rounded p-1.5 dark:text-blue-300 dark:bg-blue-950/50">
                        {card.recommendedAction}
                      </p>
                    </div>
                    {card.filterPreset && (
                      <button
                        type="button"
                        onClick={() => applyInsightFilter(card)}
                        className="w-full rounded border border-slate-200 bg-slate-50 py-1 text-[11px] font-semibold text-slate-800 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-100 dark:hover:bg-slate-800"
                      >
                        Aplicar Filtro na Carteira
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODO 1: CARTEIRA DE TÍTULOS (GRID)                                    */}
      {/* ===================================================================== */}
      {viewMode === 'GRID' && (
        <div className="space-y-4">
          {/* Barra de Operações (§1.3) */}
          <div className="rounded-xl border border-slate-200 bg-white p-3.5 space-y-3 dark:border-slate-700 dark:bg-slate-900">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2 flex-1">
                <div className="relative flex-1 min-w-[220px] max-w-md">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5 dark:text-slate-400" />
                  <input
                    type="text"
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    placeholder="Buscar cliente, documento ou descrição..."
                    className="w-full rounded-lg border border-slate-200 bg-slate-50/50 pl-8 pr-3 py-2 text-xs text-slate-900 focus:border-blue-600 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-100 dark:focus:bg-slate-900"
                  />
                </div>

                <button
                  type="button"
                  onClick={() => setFiltersOpen((p) => !p)}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${
                    filtersOpen
                      ? 'border-slate-900 bg-slate-900 text-white dark:border-emerald-500 dark:bg-emerald-600'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800'
                  }`}
                >
                  <Filter className="w-3.5 h-3.5" />
                  Filtros
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setOverdueOnly((p) => !p);
                    setPage(1);
                  }}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${
                    overdueOnly
                      ? 'border-red-300 bg-red-50 text-red-800 dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800'
                  }`}
                >
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Somente Vencidos
                </button>

                <button
                  type="button"
                  onClick={() => void loadCoordinatorData()}
                  title="Atualizar carteira"
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                <div className="font-mono text-xs text-slate-700 tabular-nums dark:text-slate-200 mr-1">
                  <strong>{sortedTitles.length}</strong> título(s) | Saldo:{' '}
                  <strong>{formatBRL(gridTotals.totalBalanceCents)}</strong>{' '}
                  <span className="text-red-700 font-semibold dark:text-red-300">
                    (Vencido: {formatBRL(gridTotals.overdueBalanceCents)})
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setErrorBanner('');
                    if (selectedGridTitles.length !== 1) {
                      setErrorBanner('Selecione exatamente 1 título modelo na grade para gerar parcelas recorrentes.');
                      return;
                    }
                    setRecurringModel(selectedGridTitles[0]);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 whitespace-nowrap dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                >
                  <Repeat className="w-3.5 h-3.5 text-blue-700 dark:text-blue-300" />
                  Lançamento Recorrente
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setErrorBanner('');
                    if (selectedGridTitles.length === 0) {
                      setErrorBanner('Marque ao menos 1 título na grade para emitir ou reemitir boleto.');
                      return;
                    }
                    setEmitReissueTargets(selectedGridTitles);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50/70 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-100 whitespace-nowrap dark:border-red-800/70 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-900/50"
                >
                  <Barcode className="w-3.5 h-3.5" />
                  Emitir / Reemitir Boleto
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setErrorBanner('');
                    setApiSettlementOpen(true);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 whitespace-nowrap dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                >
                  <Landmark className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                  Baixar via API
                </button>

                {selectedIds.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setAssignOverrideTitles(null);
                      setAssignModalOpen(true);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800 whitespace-nowrap dark:bg-emerald-600 dark:hover:bg-emerald-500"
                  >
                    <UserCheck className="w-3.5 h-3.5 text-emerald-400" />
                    Atribuir / Transferir ({selectedIds.length})
                  </button>
                )}
              </div>
            </div>

            {/* 8 Filtros Avançados (§1.4) */}
            {filtersOpen && (
              <div className="pt-3 border-t border-slate-200 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 text-xs dark:border-slate-700">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1 dark:text-slate-300">Status</label>
                  <select
                    value={filterStatus}
                    onChange={(e) => {
                      setFilterStatus(e.target.value);
                      setPage(1);
                    }}
                    className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  >
                    <option value="">Todos</option>
                    <option value="ABERTO">Em Aberto</option>
                    <option value="PARCIAL">Recebimento Parcial</option>
                    <option value="PAGO">Recebimento Total</option>
                    <option value="PROTESTADO">Protestado</option>
                    <option value="PROVISAO">Provisão</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1 dark:text-slate-300">
                    Situação Cobrança
                  </label>
                  <select
                    value={filterSituation}
                    onChange={(e) => {
                      setFilterSituation(e.target.value);
                      setPage(1);
                    }}
                    className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900"
                  >
                    <option value="">Todos</option>
                    <option value="EM_DIA">Em Dia</option>
                    <option value="COBRAR">Cobrar</option>
                    <option value="NAO_COBRAR">Não Cobrar</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1 dark:text-slate-300">
                    Colaborador
                  </label>
                  <select
                    value={filterCollaborator}
                    onChange={(e) => {
                      setFilterCollaborator(e.target.value);
                      setPage(1);
                    }}
                    className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900"
                  >
                    <option value="">Todos</option>
                    <option value="__unassigned__">Sem Atribuição</option>
                    {(data?.collaborators || []).map((c) => (
                      <option key={c.id} value={String(c.id)}>
                        {c.name}
                      </option>
                    ))}
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
                    className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900"
                  >
                    <option value="">Todos</option>
                    <option value="a_vencer">A Vencer</option>
                    <option value="1_30">1-30 dias</option>
                    <option value="31_60">31-60 dias</option>
                    <option value="61_90">61-90 dias</option>
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
                    className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-mono dark:border-slate-700"
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
                    className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-mono dark:border-slate-700"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1 dark:text-slate-300">
                    Estado (UF)
                  </label>
                  <select
                    value={filterUf}
                    onChange={(e) => {
                      setFilterUf(e.target.value);
                      setPage(1);
                    }}
                    className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  >
                    <option value="">Todos os estados</option>
                    {availableUfs.map((uf) => (
                      <option key={uf} value={uf}>
                        {uf}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-end">
                  <button
                    type="button"
                    onClick={clearAllGridFilters}
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    Limpar Filtros
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* 13 Colunas Sortable Data Grid (§1.5) */}
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden dark:border-slate-700 dark:bg-slate-900">
            <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="sticky top-0 z-10 bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600 dark:bg-slate-800/70 dark:border-slate-700 dark:text-slate-300">
                  <tr>
                    <th className="py-2.5 px-3 w-9">
                      <input
                        type="checkbox"
                        aria-label="Selecionar todos"
                        checked={
                          sortedTitles.length > 0 &&
                          sortedTitles.every((t) => selectedIds.includes(t.id))
                        }
                        onChange={toggleSelectAll}
                      />
                    </th>
                    <th className="py-2.5 px-3">
                      <button
                        type="button"
                        onClick={() => handleSortToggle('clientName')}
                        className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white"
                      >
                        Cliente {renderSortIcon('clientName')}
                      </button>
                    </th>
                    <th className="py-2.5 px-2 text-center">Fichas</th>
                    <th className="py-2.5 px-2 text-center">Aditivos</th>
                    <th className="py-2.5 px-3">
                      <button
                        type="button"
                        onClick={() => handleSortToggle('documentNumber')}
                        className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white"
                      >
                        Documento {renderSortIcon('documentNumber')}
                      </button>
                    </th>
                    <th className="py-2.5 px-3">
                      <button
                        type="button"
                        onClick={() => handleSortToggle('dueDate')}
                        className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white"
                      >
                        Vencimento {renderSortIcon('dueDate')}
                      </button>
                    </th>
                    <th className="py-2.5 px-3 text-right">
                      <button
                        type="button"
                        onClick={() => handleSortToggle('originalValueCents')}
                        className="inline-flex items-center gap-1 hover:text-slate-900 ml-auto dark:hover:text-white"
                      >
                        Valor {renderSortIcon('originalValueCents')}
                      </button>
                    </th>
                    <th className="py-2.5 px-3 text-right">
                      <button
                        type="button"
                        onClick={() => handleSortToggle('currentBalanceCents')}
                        className="inline-flex items-center gap-1 hover:text-slate-900 ml-auto dark:hover:text-white"
                      >
                        Saldo {renderSortIcon('currentBalanceCents')}
                      </button>
                    </th>
                    <th className="py-2.5 px-3 text-center">Atraso</th>
                    <th className="py-2.5 px-3">Status</th>
                    <th className="py-2.5 px-3">Sit. Cobrança</th>
                    <th className="py-2.5 px-3">Responsável</th>
                    <th className="py-2.5 px-3 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {loading && !data ? (
                    <tr>
                      <td colSpan={13} className="py-12 text-center text-slate-500 dark:text-slate-400">
                        Carregando carteira de cobrança...
                      </td>
                    </tr>
                  ) : pagedTitles.length === 0 ? (
                    <tr>
                      <td colSpan={13} className="py-12 text-center text-slate-500 dark:text-slate-400">
                        Nenhum título encontrado.
                      </td>
                    </tr>
                  ) : (
                    pagedTitles.map((t) => {
                      const cl = clientMap.get(t.clientId);
                      const isBlocked = cl?.status === 'suspenso' || cl?.status === 'cancelado';
                      const summary = data?.admissionSummaryByClient?.[t.clientId];
                      const stUpper = String(t.status || 'ABERTO').toUpperCase();
                      const isPaid = stUpper === 'PAGO';
                      const isPartial = stUpper === 'PARCIAL';
                      const days = isPaid ? 0 : computeAgingDays(t.dueDate);
                      const isOverdue = !isPaid && days > 0;
                      const collabName = t.assignedCollaboratorId
                        ? collabMap.get(t.assignedCollaboratorId)?.name
                        : undefined;
                      const origCents = Number(t.originalValueCents || t.amountCents || 0);
                      const balCents = isPaid ? 0 : Number(t.currentBalanceCents ?? t.amountCents ?? 0);
                      const sitUpper = String(t.collectionStatus || 'EM_DIA').toUpperCase();

                      return (
                        <tr
                          key={t.id}
                          className={`transition-colors ${
                            isPaid
                              ? 'bg-emerald-50/30 hover:bg-emerald-50/60 dark:bg-emerald-950/50 dark:hover:bg-emerald-900/50'
                              : isOverdue
                              ? 'bg-red-50/40 hover:bg-red-50/70 dark:bg-red-950/50 dark:hover:bg-red-900/50'
                              : 'hover:bg-slate-50 dark:hover:bg-slate-800'
                          }`}
                        >
                          <td className="py-2.5 px-3">
                            <input
                              type="checkbox"
                              aria-label={`Selecionar ${t.documentNumber || t.titleCode}`}
                              checked={selectedIds.includes(t.id)}
                              onChange={() => toggleRow(t.id)}
                            />
                          </td>
                          <td className="py-2.5 px-3 max-w-[200px]">
                            <button
                              type="button"
                              onClick={() =>
                                setClientModalState({
                                  clientId: t.clientId,
                                  tab: 'dados',
                                  admissionId: t.admissionId || null,
                                  collaboratorId: t.assignedCollaboratorId || null,
                                })
                              }
                              className="font-semibold text-slate-900 hover:text-blue-700 text-left truncate block max-w-full dark:text-slate-100"
                            >
                              {cl?.fullName || t.clientName || `Cliente #${t.clientId}`}
                            </button>
                            {isBlocked && (
                              <span
                                className={`inline-flex items-center gap-1 font-mono text-[10px] font-bold uppercase ${
                                  cl?.status === 'cancelado'
                                    ? 'text-red-700 animate-pulse dark:text-red-300'
                                    : 'text-amber-700 dark:text-amber-300'
                                }`}
                              >
                                <ShieldAlert className="w-3 h-3" />
                                {cl?.status}
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 px-2 text-center font-mono tabular-nums">
                            {summary ? (
                              <span
                                className={
                                  summary.fichas > 0
                                    ? 'font-bold text-purple-700 dark:text-purple-300'
                                    : 'text-slate-400 dark:text-slate-400'
                                }
                              >
                                {summary.fichas}
                              </span>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className="py-2.5 px-2 text-center font-mono tabular-nums">
                            {summary ? (
                              <span
                                className={
                                  summary.aditivos > 0 ? 'font-bold text-red-700 dark:text-red-300' : 'text-slate-400 dark:text-slate-400'
                                }
                              >
                                {summary.aditivos}
                              </span>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className="py-2.5 px-3 font-mono text-slate-800 whitespace-nowrap dark:text-slate-100">
                            {t.documentNumber || t.titleCode}
                          </td>
                          <td className="py-2.5 px-3 font-mono text-slate-700 whitespace-nowrap tabular-nums dark:text-slate-200">
                            {formatDueDateLocalBR(t.dueDate)}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-semibold text-blue-700 whitespace-nowrap tabular-nums dark:text-blue-300">
                            {formatBRL(origCents)}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900 whitespace-nowrap tabular-nums dark:text-slate-100">
                            {formatBRL(balCents)}
                          </td>
                          <td className="py-2.5 px-3 text-center font-mono whitespace-nowrap tabular-nums">
                            {isPaid ? (
                              <span className="font-semibold text-emerald-800 dark:text-emerald-300">Liquidado</span>
                            ) : isOverdue ? (
                              <span className="font-bold text-red-700 dark:text-red-300">{days}d</span>
                            ) : (
                              <span className="font-semibold text-emerald-700 dark:text-emerald-300">Em dia</span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 whitespace-nowrap">
                            <div className="flex items-center gap-1.5">
                              <span
                                className={`font-mono text-[11px] ${
                                  isPaid
                                    ? 'font-bold text-emerald-800 dark:text-emerald-300'
                                    : isPartial
                                    ? 'font-bold text-blue-700 dark:text-blue-300'
                                    : stUpper === 'PROTESTADO'
                                    ? 'font-semibold text-red-700 dark:text-red-300'
                                    : stUpper === 'PROVISAO'
                                    ? 'font-semibold text-amber-700 dark:text-amber-300'
                                    : 'font-semibold text-slate-600 dark:text-slate-300'
                                }`}
                              >
                                {translateTitleStatus(t.status)}
                              </span>
                              {(isPaid || isPartial || Boolean(t.receiptDocId)) && (
                                <button
                                  type="button"
                                  onClick={() => setEditingTitle(t)}
                                  title={
                                    t.receiptDocId
                                      ? 'Visualizar ou atualizar comprovante no Bucket da Invicta'
                                      : 'Anexar comprovante no Bucket da Invicta'
                                  }
                                  className={`p-1 rounded hover:bg-slate-200/70 ${
                                    t.receiptDocId ? 'text-emerald-800 dark:text-emerald-300' : 'text-slate-400 hover:text-blue-700 dark:text-slate-400'
                                  }`}
                                >
                                  <Paperclip className="w-3 h-3" />
                                </button>
                              )}
                            </div>
                          </td>
                          <td className="py-2.5 px-3 whitespace-nowrap">
                            <span
                              className={`font-mono text-[11px] font-semibold ${
                                sitUpper === 'COBRAR'
                                  ? 'text-amber-700 dark:text-amber-300'
                                  : sitUpper === 'NAO_COBRAR'
                                  ? 'text-slate-500 dark:text-slate-400'
                                  : 'text-emerald-700 dark:text-emerald-300'
                              }`}
                            >
                              {translateCollectionSituation(t.collectionStatus)}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-slate-700 max-w-[165px] dark:text-slate-200">
                            <div className="flex items-center gap-1">
                              <span className="truncate">{collabName || '—'}</span>
                              {t.assignedCollaboratorId && (
                                <button
                                  type="button"
                                  title="Espelhar tela deste operador silenciosamente"
                                  onClick={() => setShadowCollaboratorId(t.assignedCollaboratorId || null)}
                                  className="p-0.5 rounded text-slate-400 hover:text-slate-900 hover:bg-slate-200/70 shrink-0 dark:text-slate-400 dark:hover:text-white"
                                >
                                  <Monitor className="w-3 h-3" />
                                </button>
                              )}
                            </div>
                          </td>
                          <td className="py-2.5 px-3 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-1">
                              <button
                                type="button"
                                title="Boleto / PIX Santander"
                                onClick={() => setPaymentModalTitleId(t.id)}
                                className="p-1.5 rounded hover:bg-red-100 text-red-700 dark:hover:bg-red-900/50 dark:text-red-300"
                              >
                                <QrCode className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                title="Atribuir / Transferir Operador"
                                onClick={() => {
                                  setAssignOverrideTitles([t]);
                                  setAssignModalOpen(true);
                                }}
                                className="p-1.5 rounded hover:bg-indigo-100 text-indigo-700 dark:hover:bg-indigo-900/60 dark:text-indigo-300"
                              >
                                <ArrowRightLeft className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                title="Histórico de Movimentações"
                                onClick={() => setHistoryTitle(t)}
                                className="p-1.5 rounded hover:bg-slate-200/70 text-slate-600 dark:text-slate-300"
                              >
                                <Clock className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                title="Editar Lançamento / Comprovante"
                                onClick={() => setEditingTitle(t)}
                                className="p-1.5 rounded hover:bg-blue-100 text-blue-700 dark:hover:bg-blue-900/60 dark:text-blue-300"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                title="Dados do Cliente"
                                onClick={() =>
                                  setClientModalState({
                                    clientId: t.clientId,
                                    tab: 'dados',
                                    admissionId: t.admissionId || null,
                                    collaboratorId: t.assignedCollaboratorId || null,
                                  })
                                }
                                className="p-1.5 rounded hover:bg-slate-200/70 text-slate-700 dark:text-slate-200"
                              >
                                <Eye className="w-3.5 h-3.5" />
                              </button>
                              {(data?.gotalkEnabled || (data?.whatsappThreads || []).length > 0) && (
                                <button
                                  type="button"
                                  title="WhatsApp GoTalk/Uazapi & Atendimentos"
                                  onClick={() =>
                                    setClientModalState({
                                      clientId: t.clientId,
                                      tab: 'whatsapp',
                                      admissionId: t.admissionId || null,
                                      collaboratorId: t.assignedCollaboratorId || null,
                                    })
                                  }
                                  className="p-1.5 rounded hover:bg-emerald-100 text-emerald-700 dark:hover:bg-emerald-900/60 dark:text-emerald-300"
                                >
                                  <MessageSquare className="w-3.5 h-3.5" />
                                </button>
                              )}
                              {canExcluir && (
                                <button
                                  type="button"
                                  title="Excluir Título"
                                  onClick={() => {
                                    if (isBlocked) {
                                      setErrorBanner(
                                        'Cliente bloqueado — não é possível excluir este título.'
                                      );
                                      return;
                                    }
                                    setDeletingTitle(t);
                                  }}
                                  className="p-1.5 rounded hover:bg-red-100 text-red-600 dark:hover:bg-red-900/60 dark:text-red-400"
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

            {totalPages > 1 && (
              <div className="px-4 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-300">
                <span className="font-mono tabular-nums">
                  Mostrando {(safePage - 1) * pageSize + 1}–
                  {Math.min(safePage * pageSize, sortedTitles.length)} de {sortedTitles.length}
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={safePage <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="rounded border border-slate-200 bg-white px-2.5 py-1 font-semibold disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900"
                  >
                    Anterior
                  </button>
                  <span className="font-mono px-2 tabular-nums">
                    {safePage} / {totalPages}
                  </span>
                  <button
                    type="button"
                    disabled={safePage >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    className="rounded border border-slate-200 bg-white px-2.5 py-1 font-semibold disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900"
                  >
                    Próxima
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODO 2: DASHBOARD GERENCIAL GLOBAL + RELATÓRIOS SALVOS IVI            */}
      {/* ===================================================================== */}
      {viewMode === 'DASHBOARD' && (
        <div className="space-y-5">
          {/* Filtros do Dashboard + Mês Acumulado + Exportação Geral PDF & Excel */}
          <div className="rounded-xl border border-slate-200 bg-white p-3.5 flex flex-col xl:flex-row xl:items-end justify-between gap-3 text-xs dark:border-slate-700 dark:bg-slate-900">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 flex-1">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1 dark:text-slate-300">
                  Período De (Vencimento)
                </label>
                <input
                  type="date"
                  value={dashDueFrom}
                  onChange={(e) => setDashDueFrom(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1 dark:text-slate-300">
                  Período Até (Vencimento)
                </label>
                <input
                  type="date"
                  value={dashDueTo}
                  onChange={(e) => setDashDueTo(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1 dark:text-slate-300">
                  Mês (Acumulado)
                </label>
                <input
                  type="month"
                  value={dashMonth}
                  onChange={(e) => setDashMonth(e.target.value || new Date().toISOString().slice(0, 7))}
                  className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1 dark:text-slate-300">
                  Colaborador
                </label>
                <select
                  value={dashCollaborator}
                  onChange={(e) => setDashCollaborator(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                >
                  <option value="">Todos</option>
                  {(data?.collaborators || []).map((c) => (
                    <option key={c.id} value={String(c.id)}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-end">
                <button
                  type="button"
                  onClick={() => {
                    setDashDueFrom('');
                    setDashDueTo('');
                    setDashCollaborator('');
                    setDashMonth(new Date().toISOString().slice(0, 7));
                  }}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  Limpar Filtros
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() =>
                  exportDashboardSnapshotToPdf({
                    ...dashboardMetrics,
                    titles: dashboardMetrics.filteredActive,
                    getClientName: (cId, fb) => clientMap.get(cId)?.fullName || fb || `Cliente #${cId}`,
                    getCollaboratorName: (cId) =>
                      cId ? collabMap.get(cId)?.name || `#${cId}` : 'Sem Atribuição',
                    filterLabel: [
                      dashDueFrom ? `De ${formatDateBR(dashDueFrom)}` : '',
                      dashDueTo ? `Até ${formatDateBR(dashDueTo)}` : '',
                      `Mês ${dashboardMetrics.monthlyAccumulated.monthLabel}`,
                      dashCollaborator
                        ? `Op. ${collabMap.get(Number(dashCollaborator))?.name || dashCollaborator}`
                        : 'Carteira Global',
                    ]
                      .filter(Boolean)
                      .join(' · '),
                    iviStateAnalysis,
                  })
                }
                className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-800 hover:bg-red-100 dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300 dark:hover:bg-red-900/60"
              >
                <FileText className="w-3.5 h-3.5" />
                Exportar Dashboard PDF
              </button>
              <button
                type="button"
                onClick={() =>
                  exportDashboardSnapshotToExcel({
                    ...dashboardMetrics,
                    titles: dashboardMetrics.filteredActive,
                    getClientName: (cId, fb) => clientMap.get(cId)?.fullName || fb || `Cliente #${cId}`,
                    getCollaboratorName: (cId) =>
                      cId ? collabMap.get(cId)?.name || `#${cId}` : 'Sem Atribuição',
                    filterLabel: [
                      dashDueFrom ? `De ${formatDateBR(dashDueFrom)}` : '',
                      dashDueTo ? `Até ${formatDateBR(dashDueTo)}` : '',
                      `Mês ${dashboardMetrics.monthlyAccumulated.monthLabel}`,
                      dashCollaborator
                        ? `Op. ${collabMap.get(Number(dashCollaborator))?.name || dashCollaborator}`
                        : 'Carteira Global',
                    ]
                      .filter(Boolean)
                      .join(' · '),
                    iviStateAnalysis,
                  })
                }
                className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 dark:border-emerald-800/70 dark:bg-emerald-950/50 dark:text-emerald-300 dark:hover:bg-emerald-900/60"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                Exportar Dashboard Excel
              </button>
            </div>
          </div>

          {/* 4 Cartões de Indicadores Globais (§5.2) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-1 dark:border-slate-700 dark:bg-slate-900">
              <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">Taxa Inadimplência</div>
              <div className="font-mono text-2xl font-bold text-red-700 tabular-nums dark:text-red-300">
                {dashboardMetrics.defaultRate.toFixed(1)}%
              </div>
              <div className="text-xs text-slate-500 font-mono tabular-nums dark:text-slate-400">
                {dashboardMetrics.overdueCount} de {dashboardMetrics.totalCount} títulos vencidos
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-1 dark:border-slate-700 dark:bg-slate-900">
              <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">Taxa Recuperação</div>
              <div className="font-mono text-2xl font-bold text-emerald-700 tabular-nums dark:text-emerald-300">
                {dashboardMetrics.recoveryRate.toFixed(1)}%
              </div>
              <div className="text-xs text-slate-500 font-mono tabular-nums dark:text-slate-400">
                Recuperado: {formatBRL(dashboardMetrics.recoveredCents)}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-1 dark:border-slate-700 dark:bg-slate-900">
              <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">DSO (Dias)</div>
              <div className="font-mono text-2xl font-bold text-slate-900 tabular-nums dark:text-slate-100">
                {dashboardMetrics.dsoDays}d
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400">Prazo médio de recebimento</div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-1 dark:border-slate-700 dark:bg-slate-900">
              <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">Saldo Total</div>
              <div className="font-mono text-2xl font-bold text-slate-900 tabular-nums dark:text-slate-100">
                {formatBRL(dashboardMetrics.totalBalanceCents)}
              </div>
              <div className="text-xs text-red-700 font-mono font-semibold tabular-nums dark:text-red-300">
                Vencido: {formatBRL(dashboardMetrics.overdueBalanceCents)}
              </div>
            </div>
          </div>

          {/* 4 Cartões de Indicadores ACUMULADOS NO MÊS */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-3 dark:border-slate-700 dark:bg-slate-800/60">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                  Indicadores Acumulados no Mês · {dashboardMetrics.monthlyAccumulated.monthLabel}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Endividamento com vencimento no mês de referência vs. recuperação efetiva registrada no mês.
                </p>
              </div>
              <span className="font-mono text-[11px] font-semibold text-slate-600 border border-slate-200 bg-white px-2.5 py-1 rounded dark:text-slate-300 dark:border-slate-700 dark:bg-slate-900">
                Competência {dashboardMetrics.monthlyAccumulated.month}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="rounded-lg border border-slate-200 bg-white p-3.5 space-y-1 dark:border-slate-700 dark:bg-slate-900">
                <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                  Endividamento Acumulado no Mês
                </div>
                <div className="font-mono text-xl font-bold text-slate-900 tabular-nums dark:text-slate-100">
                  {formatBRL(dashboardMetrics.monthlyAccumulated.monthDebtCents)}
                </div>
                <div className="text-[11px] text-slate-500 font-mono tabular-nums dark:text-slate-400">
                  {dashboardMetrics.monthlyAccumulated.monthOpenCount} título(s) no mês
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-3.5 space-y-1 dark:border-slate-700 dark:bg-slate-900">
                <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                  Já Vencido no Mês
                </div>
                <div className="font-mono text-xl font-bold text-red-700 tabular-nums dark:text-red-300">
                  {formatBRL(dashboardMetrics.monthlyAccumulated.monthOverdueDebtCents)}
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  Parcela do mês vencida até hoje
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-3.5 space-y-1 dark:border-slate-700 dark:bg-slate-900">
                <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                  Recuperação Acumulada no Mês
                </div>
                <div className="font-mono text-xl font-bold text-emerald-700 tabular-nums dark:text-emerald-300">
                  {formatBRL(dashboardMetrics.monthlyAccumulated.monthRecoveredCents)}
                </div>
                <div className="text-[11px] text-slate-500 font-mono tabular-nums dark:text-slate-400">
                  {dashboardMetrics.monthlyAccumulated.monthSettledCount} baixa(s)/liquidação(ões)
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-3.5 space-y-1 dark:border-slate-700 dark:bg-slate-900">
                <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                  Taxa de Recuperação no Mês
                </div>
                <div className="font-mono text-xl font-bold text-blue-700 tabular-nums dark:text-blue-300">
                  {dashboardMetrics.monthlyAccumulated.monthRecoveryRatePct.toFixed(1)}%
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  Recuperado ÷ (Aberto + Recuperado Mês)
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Carteira por Faixa de Atraso (§5.3) */}
            <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3 dark:border-slate-700 dark:bg-slate-900">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                  Carteira por Faixa de Atraso
                </h3>
                <span className="text-[11px] text-slate-400 dark:text-slate-400">Clique na faixa para filtrar</span>
              </div>
              <div className="space-y-3">
                {(() => {
                  const maxBal = Math.max(
                    1,
                    ...dashboardMetrics.agingBuckets.map((b) => b.balanceCents)
                  );
                  return dashboardMetrics.agingBuckets.map((b) => {
                    const widthPct = Math.max((b.balanceCents / maxBal) * 100, 2);
                    return (
                      <button
                        key={b.key}
                        type="button"
                        onClick={() => {
                          setFilterAgingBucket(b.key);
                          setViewMode('GRID');
                          setFiltersOpen(true);
                          setPage(1);
                        }}
                        className="w-full text-left group space-y-1"
                      >
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-semibold text-slate-800 group-hover:text-blue-700 dark:text-slate-100">
                            {b.label}
                          </span>
                          <span className="font-mono text-slate-700 tabular-nums dark:text-slate-200">
                            {formatBRL(b.balanceCents)} · <strong>{b.count}</strong> tít.
                          </span>
                        </div>
                        <div className="w-full h-2.5 rounded bg-slate-100 overflow-hidden dark:bg-slate-800">
                          <div
                            className={`h-full rounded ${b.barClass}`}
                            style={{ width: `${widthPct}%` }}
                          />
                        </div>
                      </button>
                    );
                  });
                })()}
              </div>
            </div>

            {/* Performance por Colaborador (§5.4) + Botão Espelhar */}
            <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3 dark:border-slate-700 dark:bg-slate-900">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                  Performance por Colaborador (Carteira Pendente)
                </h3>
                <span className="text-[11px] text-slate-400 dark:text-slate-400">Clique no monitor para espelhar</span>
              </div>
              {dashboardMetrics.collabPerformance.length === 0 ? (
                <div className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">
                  Nenhum título na carteira.
                </div>
              ) : (
                <div className="space-y-3">
                  {(() => {
                    const maxBal = Math.max(
                      1,
                      ...dashboardMetrics.collabPerformance.map((c) => c.balanceCents)
                    );
                    return dashboardMetrics.collabPerformance.map((grp) => {
                      const widthPct = Math.max((grp.balanceCents / maxBal) * 100, 2);
                      const numericCollabId = grp.key !== '__sem_atribuicao__' ? Number(grp.key) : null;
                      return (
                        <div key={grp.key} className="space-y-1">
                          <div className="flex items-center justify-between text-xs gap-2">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="font-semibold text-slate-800 truncate dark:text-slate-100">{grp.name}</span>
                              {numericCollabId && (
                                <button
                                  type="button"
                                  title={`Espelhar tela de ${grp.name}`}
                                  onClick={() => setShadowCollaboratorId(numericCollabId)}
                                  className="p-0.5 rounded text-slate-400 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-white dark:hover:bg-slate-800"
                                >
                                  <Monitor className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                            <span className="font-mono text-slate-700 tabular-nums shrink-0 dark:text-slate-200">
                              {formatBRL(grp.balanceCents)} · <strong>{grp.count}</strong> tít.
                            </span>
                          </div>
                          <div className="w-full h-2.5 rounded bg-slate-100 overflow-hidden dark:bg-slate-800">
                            <div
                              className="h-full rounded bg-slate-800"
                              style={{ width: `${widthPct}%` }}
                            />
                          </div>
                        </div>
                      );
                    });
                  })()}
                </div>
              )}
            </div>
          </div>

          {/* ================================================================= */}
          {/* RANKING DOS COLABORADORES (2 TABELAS OFICIAIS)                    */}
          {/* ================================================================= */}
          <CollaboratorRankingTables
            titles={data?.allReceberTitles || []}
            settlements={data?.titleSettlements || []}
            collaborators={data?.collaborators || []}
            operators={data?.users || []}
            notes={data?.collectionNotes || []}
            onMirrorOperator={(id) => setShadowCollaboratorId(id)}
          />

          {/* ================================================================= */}
          {/* ENDIVIDAMENTO & RECUPERAÇÃO POR ESTADO (UF) E ACUMULADO NO MÊS     */}
          {/* ================================================================= */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4 dark:border-slate-700 dark:bg-slate-900">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-slate-100 pb-3 dark:border-slate-800">
              <div>
                <h3 className="font-display text-sm font-bold text-slate-900 flex items-center gap-2 dark:text-slate-100">
                  <MapPin className="w-4 h-4 text-slate-700 dark:text-slate-200" />
                  Endividamento & Recuperação por Estado (UF) e Acumulado de {dashboardMetrics.monthlyAccumulated.monthLabel}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5 dark:text-slate-400">
                  Comparativo estadual entre saldo devedor, volume vencido e recuperação acumulada (clique na UF para abrir na Carteira).
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <div className="inline-flex items-center gap-1 p-0.5 bg-slate-100 rounded-lg border border-slate-200 dark:bg-slate-800 dark:border-slate-700">
                  <button
                    type="button"
                    onClick={() => setUfChartMode('GERAL')}
                    className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition-colors ${
                      ufChartMode === 'GERAL' ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-slate-100' : 'text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    Carteira Geral (UF)
                  </button>
                  <button
                    type="button"
                    onClick={() => setUfChartMode('MES')}
                    className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition-colors ${
                      ufChartMode === 'MES' ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-slate-100' : 'text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    Acumulado Mês (UF)
                  </button>
                </div>

                <button
                  type="button"
                  disabled={iviStateBusy}
                  onClick={() => void handleAnalyzeStateAndMonthWithIvi()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-800 hover:bg-blue-100 disabled:opacity-50 dark:border-blue-800/70 dark:bg-blue-950/50 dark:text-blue-300 dark:hover:bg-blue-900/60"
                >
                  <Bot className="w-3.5 h-3.5" />
                  {iviStateBusy ? 'Ivi Analisando...' : 'Análise Ivi (UF & Mês)'}
                </button>

                <button
                  type="button"
                  onClick={() =>
                    exportStateMonthlyIndicatorsToPdf({
                      month: dashboardMetrics.monthlyAccumulated.month,
                      monthLabel: dashboardMetrics.monthlyAccumulated.monthLabel,
                      filterLabel: dashCollaborator
                        ? `Op. ${collabMap.get(Number(dashCollaborator))?.name || dashCollaborator}`
                        : 'Carteira Global',
                      monthlyAccumulated: dashboardMetrics.monthlyAccumulated,
                      stateMetrics: dashboardMetrics.stateMetrics,
                      iviAnalysis: iviStateAnalysis,
                    })
                  }
                  className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-800 hover:bg-red-100 dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300 dark:hover:bg-red-900/60"
                >
                  <Download className="w-3.5 h-3.5" />
                  PDF
                </button>

                <button
                  type="button"
                  onClick={() =>
                    exportStateMonthlyIndicatorsToExcel({
                      month: dashboardMetrics.monthlyAccumulated.month,
                      monthLabel: dashboardMetrics.monthlyAccumulated.monthLabel,
                      filterLabel: dashCollaborator
                        ? `Op. ${collabMap.get(Number(dashCollaborator))?.name || dashCollaborator}`
                        : 'Carteira Global',
                      monthlyAccumulated: dashboardMetrics.monthlyAccumulated,
                      stateMetrics: dashboardMetrics.stateMetrics,
                      iviAnalysis: iviStateAnalysis,
                    })
                  }
                  className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 dark:border-emerald-800/70 dark:bg-emerald-950/50 dark:text-emerald-300 dark:hover:bg-emerald-900/60"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  Excel (.xlsx)
                </button>
              </div>
            </div>

            {dashboardMetrics.stateMetrics.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">
                Nenhum título encontrado para consolidação por Estado nos filtros selecionados.
              </div>
            ) : (
              <div className="space-y-4">
                {/* Gráfico Recharts por Estado (UF) */}
                <div className="h-[270px] w-full rounded-lg border border-slate-100 bg-slate-50/40 p-3 dark:border-slate-800">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={dashboardMetrics.stateMetrics.slice(0, 12).map((s) => ({
                        uf: s.uf,
                        Endividamento: Number(
                          ((ufChartMode === 'MES' ? s.monthDebtCents : s.debtBalanceCents) / 100).toFixed(2)
                        ),
                        Recuperado: Number(
                          ((ufChartMode === 'MES' ? s.monthRecoveredCents : s.recoveredTotalCents) / 100).toFixed(2)
                        ),
                      }))}
                      margin={{ top: 10, right: 16, left: 6, bottom: 4 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                      <XAxis dataKey="uf" tick={{ fontSize: 11, fill: '#475569' }} />
                      <YAxis
                        tick={{ fontSize: 11, fill: '#475569' }}
                        tickFormatter={(val: number) =>
                          val >= 1000 ? `R$${(val / 1000).toFixed(0)}k` : `R$${val}`
                        }
                      />
                      <Tooltip
                        formatter={(value: unknown) =>
                          Number(value || 0).toLocaleString('pt-BR', {
                            style: 'currency',
                            currency: 'BRL',
                          })
                        }
                      />
                      <Legend wrapperStyle={{ fontSize: '12px' }} />
                      <Bar
                        dataKey="Endividamento"
                        name={ufChartMode === 'MES' ? 'Endividamento no Mês (R$)' : 'Endividamento Total (R$)'}
                        fill="#0f172a"
                        radius={[4, 4, 0, 0]}
                      />
                      <Bar
                        dataKey="Recuperado"
                        name={ufChartMode === 'MES' ? 'Recuperado no Mês (R$)' : 'Recuperado Total (R$)'}
                        fill="#059669"
                        radius={[4, 4, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                {/* Parecer Estratégico da Ivi sobre Estado & Mês */}
                {iviStateAnalysis && (
                  <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-4 space-y-2.5 text-xs dark:border-blue-800/70 dark:bg-blue-950/50">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-blue-700 shrink-0 dark:text-blue-300" />
                        <h4 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                          Análise Ivi · Endividamento & Recuperação ({dashboardMetrics.monthlyAccumulated.monthLabel})
                        </h4>
                      </div>
                      <span className="font-mono text-[10px] text-slate-500 dark:text-slate-400">
                        Motor: {iviStateAnalysis.provider} · {formatDateTimeBR(iviStateAnalysis.generatedAt)}
                      </span>
                    </div>

                    <p className="text-slate-800 leading-relaxed dark:text-slate-100">{iviStateAnalysis.executiveSummary}</p>

                    {iviStateAnalysis.highlights.length > 0 && (
                      <ul className="list-disc pl-4 space-y-1 text-slate-700 dark:text-slate-200">
                        {iviStateAnalysis.highlights.map((h, i) => (
                          <li key={i}>{h}</li>
                        ))}
                      </ul>
                    )}

                    {iviStateAnalysis.focusUfs.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5 pt-1">
                        <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                          Estados Prioritários Ivi:
                        </span>
                        {iviStateAnalysis.focusUfs.map((uf) => (
                          <button
                            key={uf}
                            type="button"
                            onClick={() => {
                              if (uf !== 'N/I') {
                                setFilterUf(uf);
                                setFiltersOpen(true);
                                setViewMode('GRID');
                                setPage(1);
                              }
                            }}
                            className="rounded border border-blue-200 bg-white px-2 py-0.5 font-mono text-[11px] font-bold text-blue-800 hover:bg-blue-100 dark:border-blue-800/70 dark:bg-slate-900 dark:text-blue-300 dark:hover:bg-blue-900/60"
                          >
                            {uf}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Tabela Detalhada por Estado (UF) */}
                <div className="border border-slate-200 rounded-lg overflow-x-auto dark:border-slate-700">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600 dark:bg-slate-800/70 dark:border-slate-700 dark:text-slate-300">
                      <tr>
                        <th className="py-2.5 px-3">Estado (UF)</th>
                        <th className="py-2.5 px-3 text-right">Clientes</th>
                        <th className="py-2.5 px-3 text-right">Tít. Abertos</th>
                        <th className="py-2.5 px-3 text-right">Endivid. Total</th>
                        <th className="py-2.5 px-3 text-right">Saldo Vencido</th>
                        <th className="py-2.5 px-3 text-right">Recuperado Total</th>
                        <th className="py-2.5 px-3 text-right">% Recup.</th>
                        <th className="py-2.5 px-3 text-right">Endivid. Mês</th>
                        <th className="py-2.5 px-3 text-right">Recuperado Mês</th>
                        <th className="py-2.5 px-3 text-right">% Recup. Mês</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {dashboardMetrics.stateMetrics.map((row) => (
                        <tr
                          key={row.uf}
                          onClick={() => {
                            if (row.uf !== 'N/I') {
                              setFilterUf(row.uf);
                              setFiltersOpen(true);
                              setViewMode('GRID');
                              setPage(1);
                            }
                          }}
                          className="hover:bg-slate-50 cursor-pointer transition-colors dark:hover:bg-slate-800"
                          title={
                            row.uf !== 'N/I'
                              ? `Clique para filtrar a Carteira de Títulos por ${row.uf}`
                              : 'Clientes sem UF cadastrada'
                          }
                        >
                          <td className="py-2 px-3 font-mono font-bold text-slate-900 dark:text-slate-100">{row.uf}</td>
                          <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-700 dark:text-slate-200">
                            {row.clientsCount}
                          </td>
                          <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-700 dark:text-slate-200">
                            {row.openTitlesCount}
                          </td>
                          <td className="py-2 px-3 text-right font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                            {formatBRL(row.debtBalanceCents)}
                          </td>
                          <td className="py-2 px-3 text-right font-mono tabular-nums text-red-700 font-semibold dark:text-red-300">
                            {formatBRL(row.overdueDebtCents)}
                          </td>
                          <td className="py-2 px-3 text-right font-mono tabular-nums text-emerald-700 font-semibold dark:text-emerald-300">
                            {formatBRL(row.recoveredTotalCents)}
                          </td>
                          <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-700 dark:text-slate-200">
                            {row.recoveryRatePct.toFixed(1)}%
                          </td>
                          <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-800 dark:text-slate-100">
                            {formatBRL(row.monthDebtCents)}
                          </td>
                          <td className="py-2 px-3 text-right font-mono tabular-nums text-emerald-700 font-semibold dark:text-emerald-300">
                            {formatBRL(row.monthRecoveredCents)}
                          </td>
                          <td className="py-2 px-3 text-right font-mono tabular-nums font-semibold text-blue-700 dark:text-blue-300">
                            {row.monthRecoveryRatePct.toFixed(1)}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* ================================================================= */}
          {/* IVI ANALYTICS — RELATÓRIOS E PLANILHAS SALVAS NO DASHBOARD         */}
          {/* ================================================================= */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4 dark:border-slate-700 dark:bg-slate-900">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-slate-100 pb-3 dark:border-slate-800">
              <div>
                <h3 className="font-display text-sm font-bold text-slate-900 flex items-center gap-2 dark:text-slate-100">
                  <Bot className="w-4 h-4 text-blue-700 dark:text-blue-300" />
                  Ivi Analytics · Relatórios & Planilhas Salvos no Dashboard
                </h3>
                <p className="text-xs text-slate-500 mt-0.5 dark:text-slate-400">
                  A Ivi consulta a base real do PostgreSQL, monta planilhas e gráficos salvos aqui e permite exportar em PDF ou Excel (.xlsx).
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {[
                  { id: 'carteira_vencida', label: 'Carteira Vencida' },
                  { id: 'ranking_operadores', label: 'Ranking Operadores' },
                  { id: 'recebimentos', label: 'Recebimentos Total/Parcial' },
                  { id: 'inadimplencia_uf', label: 'Inadimplência por UF' },
                ].map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    disabled={generatingReport}
                    onClick={() =>
                      void handleGenerateIviReport(
                        preset.id as
                          | 'carteira_vencida'
                          | 'ranking_operadores'
                          | 'recebimentos'
                          | 'inadimplencia_uf'
                      )
                    }
                    className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[11px] font-semibold text-slate-800 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-100 dark:hover:bg-slate-800"
                  >
                    + {preset.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={customReportPrompt}
                onChange={(e) => setCustomReportPrompt(e.target.value)}
                placeholder="Peça à Ivi uma planilha/relatório específico (ex.: Títulos vencidos acima de 60 dias sem comprovante)..."
                className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:text-slate-100"
              />
              <button
                type="button"
                disabled={generatingReport}
                onClick={() => void handleGenerateIviReport('custom_ivi')}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50 shrink-0 dark:bg-emerald-600 dark:hover:bg-emerald-500"
              >
                <Sparkles className={`w-3.5 h-3.5 text-emerald-400 ${generatingReport ? 'animate-spin' : ''}`} />
                {generatingReport ? 'Gerando e Salvando...' : 'Gerar & Salvar Planilha Ivi'}
              </button>
            </div>

            {savedReports.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-200 py-8 text-center text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
                Nenhum relatório/planilha salvo ainda. Clique em um dos modelos acima ou peça um relatório personalizado para a Ivi.
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
                {/* Lista de Relatórios Salvos */}
                <div className="lg:col-span-4 border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-[460px] overflow-y-auto dark:border-slate-700 dark:divide-slate-800">
                  {savedReports.map((rep) => {
                    const isSel = activeSavedReport?.id === rep.id;
                    return (
                      <div
                        key={rep.id}
                        className={`p-3 flex items-start justify-between gap-2 cursor-pointer transition-colors ${
                          isSel ? 'bg-slate-900 text-white dark:bg-emerald-600' : 'hover:bg-slate-50 text-slate-900 dark:hover:bg-slate-800 dark:text-slate-100'
                        }`}
                        onClick={() => setSelectedReportId(rep.id)}
                      >
                        <div className="min-w-0">
                          <div className="font-semibold text-xs truncate">{rep.title}</div>
                          <div
                            className={`text-[10px] font-mono mt-0.5 ${
                              isSel ? 'text-slate-300' : 'text-slate-500 dark:text-slate-400'
                            }`}
                          >
                            {rep.rowsJson?.length || 0} linhas · {formatDateTimeBR(rep.createdAt)} ·{' '}
                            {rep.createdByName}
                          </div>
                        </div>
                        <button
                          type="button"
                          title="Excluir relatório salvo"
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleDeleteSavedReport(rep.id);
                          }}
                          className={`p-1 rounded shrink-0 ${
                            isSel
                              ? 'text-slate-300 hover:text-red-300 hover:bg-slate-800'
                              : 'text-slate-400 hover:text-red-600 hover:bg-red-50 dark:text-slate-400 dark:hover:bg-red-950/60'
                          }`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>

                {/* Visualização, Gráfico e Exportação PDF/Excel do Relatório Selecionado */}
                <div className="lg:col-span-8 rounded-lg border border-slate-200 p-4 space-y-4 dark:border-slate-700">
                  {activeSavedReport && (
                    <>
                      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-3 dark:border-slate-800">
                        <div className="min-w-0">
                          <h4 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                            {activeSavedReport.title}
                          </h4>
                          <p className="text-xs text-slate-600 mt-0.5 dark:text-slate-300">
                            {activeSavedReport.executiveSummary}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => exportReportToPdf(activeSavedReport)}
                            className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-800 hover:bg-red-100 dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300 dark:hover:bg-red-900/60"
                          >
                            <Download className="w-3.5 h-3.5" />
                            PDF
                          </button>
                          <button
                            type="button"
                            onClick={() => exportReportToExcel(activeSavedReport)}
                            className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 dark:border-emerald-800/70 dark:bg-emerald-950/50 dark:text-emerald-300 dark:hover:bg-emerald-900/60"
                          >
                            <FileSpreadsheet className="w-3.5 h-3.5" />
                            Excel (.xlsx)
                          </button>
                        </div>
                      </div>

                      {(activeSavedReport.insightsJson || []).length > 0 && (
                        <div className="rounded-lg border border-blue-100 bg-blue-50/50 p-3 space-y-1 text-xs dark:border-blue-800/70 dark:bg-blue-950/50">
                          <div className="font-bold text-blue-950 dark:text-blue-300">Insights Ivi sobre os dados:</div>
                          <ul className="list-disc pl-4 space-y-0.5 text-slate-700 dark:text-slate-200">
                            {activeSavedReport.insightsJson.map((ins, i) => (
                              <li key={i}>{ins}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {(activeSavedReport.chartSeriesJson || []).length > 0 && (
                        <div className="space-y-2">
                          <div className="text-xs font-bold text-slate-700 dark:text-slate-200">Gráfico Consolidado</div>
                          <div className="space-y-1.5">
                            {(() => {
                              const pts = activeSavedReport.chartSeriesJson;
                              const maxVal = Math.max(1, ...pts.map((p) => p.value || 0));
                              return pts.map((pt, idx) => {
                                const pct = Math.max(((pt.value || 0) / maxVal) * 100, 2);
                                return (
                                  <div key={idx} className="space-y-0.5 text-[11px]">
                                    <div className="flex items-center justify-between">
                                      <span className="font-medium text-slate-800 dark:text-slate-100">{pt.label}</span>
                                      <span className="font-mono text-slate-600 tabular-nums dark:text-slate-300">
                                        {pt.value.toLocaleString('pt-BR', {
                                          maximumFractionDigits: 2,
                                        })}
                                        {pt.secondaryValue !== undefined
                                          ? ` (${pt.secondaryValue} reg.)`
                                          : ''}
                                      </span>
                                    </div>
                                    <div className="w-full h-2 rounded bg-slate-100 overflow-hidden dark:bg-slate-800">
                                      <div
                                        className="h-full rounded bg-blue-700"
                                        style={{ width: `${pct}%` }}
                                      />
                                    </div>
                                  </div>
                                );
                              });
                            })()}
                          </div>
                        </div>
                      )}

                      <div className="border border-slate-200 rounded-lg overflow-x-auto max-h-64 overflow-y-auto dark:border-slate-700">
                        <table className="w-full text-left border-collapse text-xs">
                          <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600 dark:bg-slate-800/70 dark:border-slate-700 dark:text-slate-300">
                            <tr>
                              {(activeSavedReport.columnsJson || []).map((col) => (
                                <th key={col.key} className="py-2 px-3 whitespace-nowrap">
                                  {col.label}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                            {(activeSavedReport.rowsJson || []).slice(0, 80).map((row, idx) => (
                              <tr key={idx} className="hover:bg-slate-50/70 dark:hover:bg-slate-800">
                                {(activeSavedReport.columnsJson || []).map((col) => (
                                  <td
                                    key={col.key}
                                    className="py-1.5 px-3 font-mono text-[11px] text-slate-800 whitespace-nowrap tabular-nums dark:text-slate-100"
                                  >
                                    {formatReportCellValue(row[col.key], col.format)}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Solicitações de Cancelamento Pendentes — Lido ao vivo do PostgreSQL (§5.5) */}
          {pendingCancelRequests.length > 0 && (
            <div className="rounded-xl border border-amber-300 bg-amber-50/60 overflow-hidden dark:border-amber-800/70 dark:bg-amber-950/50">
              <button
                type="button"
                onClick={() => setCancelCardOpen((p) => !p)}
                className="w-full px-5 py-3.5 flex items-center justify-between gap-3 text-left hover:bg-amber-50 dark:hover:bg-amber-950/60"
              >
                <div>
                  <h3 className="font-display text-sm font-bold text-amber-950 dark:text-amber-300">
                    Solicitações de Cancelamento Pendentes ({pendingCancelRequests.length})
                  </h3>
                  <p className="text-xs text-amber-800 dark:text-amber-300">
                    Solicitadas pela equipe operacional — requerem ação da coordenação
                  </p>
                </div>
                {cancelCardOpen ? (
                  <ChevronDown className="w-4 h-4 text-amber-800 shrink-0 dark:text-amber-300" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-amber-800 shrink-0 dark:text-amber-300" />
                )}
              </button>

              {cancelCardOpen && (
                <div className="border-t border-amber-200 bg-white divide-y divide-slate-100 dark:border-amber-800/70 dark:bg-slate-900 dark:divide-slate-800">
                  {pendingCancelRequests.map((note) => {
                    const linkedTitle = note.titleId
                      ? data?.allReceberTitles.find((t) => t.id === note.titleId)
                      : undefined;
                    const linkedClient = clientMap.get(note.clientId);
                    const linkedCollab = note.collaboratorId
                      ? collabMap.get(note.collaboratorId)
                      : undefined;
                    return (
                      <div
                        key={note.id}
                        className="px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                      >
                        <div className="space-y-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-bold text-slate-900 dark:text-slate-100">
                              {linkedTitle?.clientName ||
                                linkedClient?.fullName ||
                                `Cliente #${note.clientId}`}
                            </span>
                            {linkedTitle && (
                              <span className="font-mono text-slate-500 dark:text-slate-400">
                                Doc. {linkedTitle.documentNumber || linkedTitle.titleCode}
                              </span>
                            )}
                            <span className="font-mono text-[11px] font-bold text-amber-800 border border-amber-300 bg-amber-50 px-1.5 py-0.5 rounded dark:text-amber-300 dark:border-amber-800/70 dark:bg-amber-950/50">
                              Pendente
                            </span>
                          </div>
                          <div className="text-slate-600 flex flex-wrap gap-x-4 gap-y-1 dark:text-slate-300">
                            <span>
                              Operador:{' '}
                              <strong>{linkedCollab?.name || note.collaboratorName || '—'}</strong>
                            </span>
                            <span>
                              Data Solic.:{' '}
                              <span className="font-mono">
                                {note.cancelRequest?.requestDate
                                  ? formatDueDateLocalBR(note.cancelRequest.requestDate)
                                  : '—'}
                              </span>
                            </span>
                            <span>
                              Contrato:{' '}
                              <span className="font-mono">
                                {note.cancelRequest?.admissionContract || '—'}
                              </span>
                            </span>
                            {linkedTitle && (
                              <span>
                                Saldo:{' '}
                                <strong className="font-mono tabular-nums">
                                  {formatBRL(
                                    linkedTitle.currentBalanceCents ?? linkedTitle.amountCents
                                  )}
                                </strong>
                              </span>
                            )}
                          </div>
                          {note.cancelRequest?.notes && (
                            <p className="text-slate-700 bg-slate-50 rounded px-2.5 py-1.5 border border-slate-100 dark:text-slate-200 dark:bg-slate-800/70 dark:border-slate-800">
                              {note.cancelRequest.notes}
                            </p>
                          )}
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() =>
                              setClientModalState({
                                clientId: note.clientId,
                                tab: 'dados',
                                admissionId: linkedTitle?.admissionId || null,
                              })
                            }
                            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                          >
                            Ver Cliente
                          </button>
                          {onSwitchToOperacional && (
                            <button
                              type="button"
                              onClick={() => onSwitchToOperacional(note.clientId)}
                              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                            >
                              Tratar Status
                            </button>
                          )}
                          {canExcluir && (
                            <button
                              type="button"
                              onClick={() => setDeletingCancelNote(note)}
                              className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100 dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300 dark:hover:bg-red-900/60"
                            >
                              Excluir
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
        </div>
      )}

      {viewMode === 'RANKING' && (
        <CollaboratorRankingTables
          titles={data?.allReceberTitles || []}
          settlements={data?.titleSettlements || []}
          collaborators={data?.collaborators || []}
          operators={data?.users || []}
          notes={data?.collectionNotes || []}
          onMirrorOperator={(id) => setShadowCollaboratorId(id)}
        />
      )}

      {viewMode === 'TAREFAS' && (
        <CollectionCoordinatorTasksView
          currentUser={currentUser}
          clients={data?.clients || []}
          collaborators={data?.collaborators || []}
          wsTick={wsTick}
          onToast={(msg) => setToast(msg)}
          onError={(msg) => setErrorBanner(msg)}
          onOpenClient={(cId) =>
            setClientModalState({ clientId: cId, tab: 'dados' })
          }
        />
      )}

      {/* ===================================================================== */}
      {/* MODAIS INTEGRADOS                                                     */}
      {/* ===================================================================== */}
      <BatchAssignModal
        open={assignModalOpen}
        selectedTitles={selectedTitleObjects}
        clients={data?.clients || []}
        collaborators={data?.collaborators || []}
        onClose={() => {
          setAssignModalOpen(false);
          setAssignOverrideTitles(null);
        }}
        onSuccess={async (msg) => {
          setToast(msg);
          setSelectedIds([]);
          setAssignOverrideTitles(null);
          await loadCoordinatorData();
        }}
      />

      <EditTitleModal
        title={editingTitle}
        client={editingTitle ? clientMap.get(editingTitle.clientId) : undefined}
        collaborators={data?.collaborators || []}
        documents={data?.documents || []}
        titleSettlements={data?.titleSettlements || []}
        onClose={() => setEditingTitle(null)}
        onSaved={async (msg) => {
          setToast(msg);
          await loadCoordinatorData();
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
        title="Cobrança · Coordenação · Auditoria Cumulativa"
        entityType="collection_cases,collection_notes,financial_titles,title_settlements,coordinator_tasks"
        entityId="all"
        onClose={() => setSectorAuditOpen(false)}
      />

      <ConfirmDeleteModal
        open={Boolean(deletingTitle)}
        title="Excluir Título"
        message={
          deletingTitle
            ? `Excluir o título "${deletingTitle.documentNumber || deletingTitle.titleCode}" de ${
                clientMap.get(deletingTitle.clientId)?.fullName || deletingTitle.clientName || 'Cliente'
              }? Esta ação não pode ser desfeita.`
            : ''
        }
        busy={deleteTitleBusy}
        onCancel={() => setDeletingTitle(null)}
        onConfirm={handleConfirmDeleteTitle}
      />

      <ConfirmDeleteModal
        open={Boolean(deletingCancelNote)}
        title="Excluir Solicitação de Cancelamento"
        message="Excluir esta solicitação de cancelamento? Esta ação não pode ser desfeita."
        busy={deleteNoteBusy}
        onCancel={() => setDeletingCancelNote(null)}
        onConfirm={handleConfirmDeleteCancelNote}
      />

      <ClientDetailModal
        client={activeClientForModal}
        initialTab={clientModalState?.tab || 'dados'}
        initialCollaboratorId={clientModalState?.collaboratorId ?? null}
        initialAdmissionId={clientModalState?.admissionId ?? null}
        admissions={data?.admissions || []}
        portfolioTitles={data?.portfolioTitles || []}
        allReceberTitles={data?.allReceberTitles || []}
        collaborators={data?.collaborators || []}
        users={data?.users || []}
        documents={data?.documents || []}
        recalcScenarios={data?.recalcScenarios || []}
        gotalkEnabled={Boolean(data?.gotalkEnabled)}
        whatsappThreads={data?.whatsappThreads || []}
        whatsappMessages={data?.whatsappMessages || []}
        gotalkChannels={data?.gotalkChannels || []}
        gotalkOperators={data?.gotalkOperators || []}
        gotalkHsmTemplates={data?.gotalkHsmTemplates || []}
        onClose={() => setClientModalState(null)}
        onOpenAdmission={(adm) => {
          if (!canVerFicha) {
            setErrorBanner('Sem permissão para visualizar a Ficha de Admissão.');
            return;
          }
          setAdmissionModalObj(adm);
        }}
        onMessageSent={loadCoordinatorData}
      />

      <AdmissionDetailModal
        admission={admissionModalObj}
        clients={data?.clients || []}
        collaborators={data?.collaborators || []}
        units={data?.units || []}
        banks={data?.banks || []}
        modalities={data?.modalities || []}
        seriesList={data?.series || []}
        documents={data?.documents || []}
        recalcScenarios={data?.recalcScenarios || []}
        negotiations={data?.negotiations || []}
        titleSettlements={data?.titleSettlements || []}
        allReceberTitles={data?.allReceberTitles || []}
        clientAdmissions={
          admissionModalObj
            ? (data?.admissions || []).filter((a) => a.clientId === admissionModalObj.clientId)
            : []
        }
        whatsappThreads={data?.whatsappThreads || []}
        whatsappMessages={data?.whatsappMessages || []}
        gotalkChannels={data?.gotalkChannels || []}
        gotalkHsmTemplates={data?.gotalkHsmTemplates || []}
        onSelectAdmission={(adm) => setAdmissionModalObj(adm)}
        onMessageSent={loadCoordinatorData}
        onClose={() => setAdmissionModalObj(null)}
      />

      <OperatorShadowModal
        collaboratorId={shadowCollaboratorId}
        collaborators={data?.collaborators || []}
        onChangeCollaborator={(id) => {
          setShadowCollaboratorId(id);
          setShadowSelectId(String(id));
        }}
        onInspectClient={(cId) =>
          setClientModalState({ clientId: cId, tab: 'dados' })
        }
        onClose={() => setShadowCollaboratorId(null)}
      />

      <RecurringInstallmentsModal
        modelTitle={recurringModel}
        scope="RECEBER"
        bankAccounts={data?.bankAccounts || []}
        onClose={() => setRecurringModel(null)}
        onCreated={async (msg) => {
          setToast(msg);
          setSelectedIds([]);
          await loadCoordinatorData();
        }}
      />

      <EmitReissueBoletoModal
        open={Boolean(emitReissueTargets && emitReissueTargets.length > 0)}
        titles={emitReissueTargets || []}
        bankAccounts={data?.bankAccounts || []}
        onClose={() => setEmitReissueTargets(null)}
        onCompleted={async (msg) => {
          setToast(msg);
          await loadCoordinatorData();
        }}
        onViewBoleto={(tid) => setPaymentModalTitleId(tid)}
      />

      <ApiBankSettlementModal
        open={apiSettlementOpen}
        bankAccounts={data?.bankAccounts || []}
        onClose={() => setApiSettlementOpen(false)}
        onSettled={async (msg) => {
          setToast(msg);
          setSelectedIds([]);
          await loadCoordinatorData();
        }}
        onOpenTitleById={(tid) => {
          const found =
            gridSourceTitles.find((item) => item.id === tid) ||
            (data?.allReceberTitles || []).find((item) => item.id === tid);
          if (found) setEditingTitle(found);
        }}
        onOpenBoletoModal={(tid) => setPaymentModalTitleId(tid)}
      />

      <SantanderPaymentModal
        titleId={paymentModalTitleId}
        onClose={() => setPaymentModalTitleId(null)}
        onUpdated={loadCoordinatorData}
      />
    </div>
  );
};
