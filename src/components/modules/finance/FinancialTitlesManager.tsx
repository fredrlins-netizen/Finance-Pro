import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpDown,
  BellRing,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Columns3,
  FileText,
  Filter,
  History,
  Layers,
  Plus,
  RefreshCw,
  Repeat,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Trash2,
  Unlock,
  X,
} from 'lucide-react';
import { apiFetch, formatBRL } from '../../../lib/api.ts';
import {
  BankAccount,
  BearerItem,
  ChartAccountItem,
  Client,
  CollaboratorItem,
  DepartmentItem,
  DocumentTypeItem,
  FinancialTitle,
  ModuleId,
  NavigationIntent,
  TitleSettlement,
  Unit,
} from '../../../types.ts';
import { formatIsoDateToBR, toIsoDateOnly } from './currencyAndParsers.ts';
import { FinancialTitleFormView } from './FinancialTitleFormView.tsx';
import {
  AdmissionViewerModal,
  CancelSettlementModal,
  CancelTitlesModal,
  DeductionModal,
  DeleteTitleConfirmModal,
  EditPartnerModal,
  GroupInvoiceModal,
  InvoiceTraceModal,
  RecurringInstallmentsModal,
  ReleaseProtestProvisionModal,
  SettlementModal,
  TitleAuditModal,
  ViewChildrenModal,
} from './FinancialTitlesModals.tsx';

interface FinancialTitlesManagerProps {
  scope: 'RECEBER' | 'PAGAR';
  units: Unit[];
  clients: Client[];
  documentTypes: DocumentTypeItem[];
  bearers: BearerItem[];
  chartOfAccounts: ChartAccountItem[];
  bankAccounts: BankAccount[];
  departments: DepartmentItem[];
  collaborators: CollaboratorItem[];
  wsTick: number;
  navIntent?: NavigationIntent | null;
  onClearIntent?: () => void;
  onNavigate?: (mod: ModuleId, intent?: NavigationIntent) => void;
  onReloadFinance: () => Promise<void>;
}

type QuickTab = 'open' | 'overdue' | 'partial' | 'settled' | 'all';
type OverdueBracket = '1-5' | '6-30' | '31-60' | '61-90' | '90+' | null;
type SortField = 'documentNumber' | 'clientName' | 'dueDate' | 'issueDate' | 'balance' | 'amount' | 'status';

function normStatusUpper(raw: string | null | undefined): string {
  const s = String(raw || 'ABERTO').trim().toUpperCase();
  if (s === 'VENCIDO') return 'ABERTO';
  return s;
}

function getTitleBalance(t: FinancialTitle): number {
  const st = normStatusUpper(t.status);
  if (st === 'PAGO' || st === 'CANCELADO' || st === 'AGRUPADO' || st === 'DEVOLUCAO_VINCULADA') {
    return 0;
  }
  const bal = t.currentBalanceCents ?? 0;
  return bal > 0 ? bal : t.amountCents;
}

function getStatusLabel(stUpper: string): string {
  switch (stUpper) {
    case 'PAGO':
      return 'LIQUIDADO';
    case 'PARCIAL':
      return 'PARCIAL';
    case 'ABERTO':
      return 'EM ABERTO';
    case 'PROTESTADO':
      return 'PROTESTADO';
    case 'PROVISAO':
      return 'PROVISÃO';
    case 'ADIANTAMENTO':
      return 'ADIANTAMENTO';
    case 'ADIANTAMENTO_PARCIAL':
      return 'ADIANT. PARCIAL';
    case 'DEVOLUCAO':
      return 'DEVOLUÇÃO';
    case 'DEVOLUCAO_PARCIAL':
      return 'DEVOL. PARCIAL';
    case 'DEVOLUCAO_VINCULADA':
      return 'DEVOL. VINCULADA';
    case 'AGRUPADO':
      return 'AGRUPADO FAT.';
    case 'FATURA_GERADA':
      return 'FATURA';
    case 'CANCELADO':
      return 'CANCELADO';
    default:
      return stUpper;
  }
}

function getStatusToneClass(stUpper: string, isOverdue: boolean): string {
  if (stUpper === 'PAGO' || stUpper === 'DEVOLUCAO_VINCULADA') return 'text-emerald-700 font-semibold dark:text-emerald-300';
  if (stUpper === 'CANCELADO') return 'text-slate-400 line-through';
  if (stUpper === 'PROTESTADO') return 'text-red-800 font-bold dark:text-red-200';
  if (stUpper.startsWith('ADIANTAMENTO')) return 'text-amber-700 font-semibold dark:text-amber-300';
  if (stUpper.startsWith('DEVOLUCAO')) return 'text-rose-700 font-semibold dark:text-rose-300';
  if (stUpper === 'AGRUPADO' || stUpper === 'FATURA_GERADA') return 'text-indigo-700 font-semibold';
  if (isOverdue) return 'text-red-600 font-bold dark:text-red-400';
  if (stUpper === 'PARCIAL') return 'text-amber-700 font-semibold dark:text-amber-300';
  return 'text-blue-700 font-semibold dark:text-blue-300';
}

export const FinancialTitlesManager: React.FC<FinancialTitlesManagerProps> = ({
  scope,
  units,
  clients,
  documentTypes,
  bearers,
  chartOfAccounts,
  bankAccounts,
  departments,
  collaborators,
  wsTick,
  navIntent,
  onClearIntent,
  onNavigate,
  onReloadFinance,
}) => {
  const isReceber = scope === 'RECEBER';
  const personLabel = isReceber ? 'Cliente / Parceiro' : 'Fornecedor';

  const [titles, setTitles] = useState<FinancialTitle[]>([]);
  const [settlementsByTitle, setSettlementsByTitle] = useState<Record<number, TitleSettlement[]>>({});
  const [localClients, setLocalClients] = useState<Client[]>(clients);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState('');
  const [errorBanner, setErrorBanner] = useState('');

  // Form view mode
  const [viewMode, setViewMode] = useState<'list' | 'form'>('list');
  const [editingTitle, setEditingTitle] = useState<FinancialTitle | null>(null);

  // Filters & Columns
  const [quickTab, setQuickTab] = useState<QuickTab>('open');
  const [overdueBracket, setOverdueBracket] = useState<OverdueBracket>(null);
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [advFiltersOpen, setAdvFiltersOpen] = useState(false);
  const [exactStatusFilter, setExactStatusFilter] = useState<string>('ALL');
  const [personFilterId, setPersonFilterId] = useState<string>('ALL');
  const [docTypeFilterId, setDocTypeFilterId] = useState<string>('ALL');
  const [issueFrom, setIssueFrom] = useState('');
  const [issueTo, setIssueTo] = useState('');
  const [dueFrom, setDueFrom] = useState('');
  const [dueTo, setDueTo] = useState('');
  const [settledFrom, setSettledFrom] = useState('');
  const [settledTo, setSettledTo] = useState('');

  // Column visibility (Emissão starts hidden per specification)
  const [colsOpen, setColsOpen] = useState(false);
  const [showIssueCol, setShowIssueCol] = useState(false);
  const [showDocTypeCol, setShowDocTypeCol] = useState(true);
  const [showHistoryCol, setShowHistoryCol] = useState(true);

  // Sorting & Pagination
  const [sortField, setSortField] = useState<SortField>('dueDate');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);
  const [showTotalsFooter, setShowTotalsFooter] = useState(false);

  // Row selection & Action Dropdown
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false);
  const actionsMenuRef = useRef<HTMLDivElement | null>(null);

  // Modals state
  const [settlementModal, setSettlementModal] = useState<{
    open: boolean;
    mode: 'total' | 'parcial';
    titles: FinancialTitle[];
  }>({ open: false, mode: 'total', titles: [] });

  const [deductionPrompt, setDeductionPrompt] = useState<{
    open: boolean;
    mode: 'pre-settle-total' | 'pre-settle-parcial' | 'post-create';
    targetTitles: FinancialTitle[];
    credits: FinancialTitle[];
  }>({ open: false, mode: 'post-create', targetTitles: [], credits: [] });

  const [releaseTarget, setReleaseTarget] = useState<FinancialTitle | null>(null);
  const [cancelSettlementTargets, setCancelSettlementTargets] = useState<FinancialTitle[] | null>(null);
  const [recurringModel, setRecurringModel] = useState<FinancialTitle | null>(null);
  const [viewChildrenTarget, setViewChildrenTarget] = useState<FinancialTitle | null>(null);
  const [groupInvoiceTargets, setGroupInvoiceTargets] = useState<FinancialTitle[] | null>(null);
  const [traceTarget, setTraceTarget] = useState<FinancialTitle | null>(null);
  const [editPartnerTarget, setEditPartnerTarget] = useState<Client | null>(null);
  const [cancelModal, setCancelModal] = useState<{
    open: boolean;
    titles: FinancialTitle[];
    isInvoiceGroup: boolean;
  }>({ open: false, titles: [], isInvoiceGroup: false });
  const [deleteTarget, setDeleteTarget] = useState<FinancialTitle | null>(null);
  const [admissionViewer, setAdmissionViewer] = useState<{
    admissionId: number | null;
    contractRef: string;
  }>({ admissionId: null, contractRef: '' });
  const [auditTarget, setAuditTarget] = useState<FinancialTitle | null>(null);

  useEffect(() => {
    setLocalClients(clients);
  }, [clients]);

  // Debounce search (300ms)
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchInput.trim().toLowerCase());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // Close actions menu on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (actionsMenuRef.current && !actionsMenuRef.current.contains(e.target as Node)) {
        setActionsMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const loadTitles = useCallback(async () => {
    setLoading(true);
    setErrorBanner('');
    try {
      const res = await apiFetch<{
        titles: FinancialTitle[];
        total: number;
        settlementsByTitle: Record<number, TitleSettlement[]>;
      }>(`/api/financial-titles?scope=${scope}&page=1&pageSize=200`);
      setTitles(res.titles || []);
      setSettlementsByTitle(res.settlementsByTitle || {});
    } catch (e) {
      setErrorBanner(e instanceof Error ? e.message : 'Erro ao carregar títulos financeiros.');
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    setViewMode('list');
    setEditingTitle(null);
    setSelectedIds([]);
    setOverdueBracket(null);
    setQuickTab('open');
    setPage(1);
    loadTitles();
  }, [scope, wsTick, loadTitles]);

  // Handle cross-module NavigationIntent (titleId or clientId)
  useEffect(() => {
    if (!navIntent || loading) return;
    if (navIntent.titleId && titles.length > 0) {
      const match = titles.find((t) => t.id === navIntent.titleId);
      if (match) {
        setEditingTitle(match);
        setViewMode('form');
        onClearIntent?.();
        return;
      }
    }
    if (navIntent.clientId && localClients.length > 0) {
      const cl = localClients.find((c) => c.id === navIntent.clientId);
      if (cl) {
        setSearchInput(cl.fullName);
        setQuickTab('all');
      }
      onClearIntent?.();
    }
  }, [navIntent, titles, localClients, loading, onClearIntent]);

  const clientMap = useMemo(() => new Map(localClients.map((c) => [c.id, c])), [localClients]);
  const docTypeMap = useMemo(() => new Map(documentTypes.map((d) => [d.id, d])), [documentTypes]);
  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);

  // Helper to compute overdue days accurately
  const getDaysOverdue = useCallback(
    (t: FinancialTitle): number => {
      const st = normStatusUpper(t.status);
      if (['PAGO', 'CANCELADO', 'AGRUPADO', 'PROVISAO', 'DEVOLUCAO_VINCULADA'].includes(st)) {
        return 0;
      }
      if (st.startsWith('ADIANTAMENTO') || st.startsWith('DEVOLUCAO')) return 0;
      const due = toIsoDateOnly(t.dueDate);
      if (!due || due >= todayIso) return 0;
      const diff = Math.floor(
        (new Date(`${todayIso}T12:00:00`).getTime() - new Date(`${due}T12:00:00`).getTime()) / 86400000
      );
      return Math.max(0, diff);
    },
    [todayIso]
  );

  // KPIs + Overdue 5 Range Cards computed on all loaded scope titles
  const metrics = useMemo(() => {
    let settledCents = 0;
    let openCents = 0;
    let overdueCents = 0;
    let next7DaysCents = 0;
    const paidDays: number[] = [];

    const brackets: Record<Exclude<OverdueBracket, null>, { count: number; cents: number }> = {
      '1-5': { count: 0, cents: 0 },
      '6-30': { count: 0, cents: 0 },
      '31-60': { count: 0, cents: 0 },
      '61-90': { count: 0, cents: 0 },
      '90+': { count: 0, cents: 0 },
    };

    const in7Iso = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

    for (const t of titles) {
      const st = normStatusUpper(t.status);
      const bal = getTitleBalance(t);
      const tType = String(t.titleType || 'PADRAO').toUpperCase();

      if (st === 'PAGO') {
        settledCents += t.originalValueCents || t.amountCents;
        if (t.paidAt) {
          const days = Math.max(
            1,
            Math.round((new Date(t.paidAt).getTime() - new Date(t.dueDate).getTime()) / 86400000) + 15
          );
          paidDays.push(days);
        }
      } else if (st !== 'CANCELADO' && st !== 'AGRUPADO' && tType !== 'DEVOLUCAO' && tType !== 'ADIANTAMENTO') {
        openCents += bal;
        const overdue = getDaysOverdue(t);
        if (overdue > 0) {
          overdueCents += bal;
          const bKey: Exclude<OverdueBracket, null> =
            overdue <= 5
              ? '1-5'
              : overdue <= 30
              ? '6-30'
              : overdue <= 60
              ? '31-60'
              : overdue <= 90
              ? '61-90'
              : '90+';
          brackets[bKey].count += 1;
          brackets[bKey].cents += bal;
        }
        const due = toIsoDateOnly(t.dueDate);
        if (due && due >= todayIso && due <= in7Iso) {
          next7DaysCents += bal;
        }
      }
    }

    const avgReceiptDays = paidDays.length
      ? Math.round(paidDays.reduce((a, b) => a + b, 0) / paidDays.length)
      : 18;

    return {
      settledCents,
      openCents,
      overdueCents,
      next7DaysCents,
      avgReceiptDays,
      brackets,
    };
  }, [titles, getDaysOverdue, todayIso]);

  // Quick tab counters
  const tabCounts = useMemo(() => {
    let open = 0;
    let overdue = 0;
    let partial = 0;
    let settled = 0;
    for (const t of titles) {
      const st = normStatusUpper(t.status);
      if (st === 'PAGO') settled += 1;
      else if (st === 'PARCIAL') partial += 1;
      if (getDaysOverdue(t) > 0) overdue += 1;
      if (['ABERTO', 'PARCIAL', 'PROTESTADO', 'PROVISAO', 'FATURA_GERADA', 'ADIANTAMENTO', 'ADIANTAMENTO_PARCIAL', 'DEVOLUCAO', 'DEVOLUCAO_PARCIAL'].includes(st)) {
        open += 1;
      }
    }
    return { open, overdue, partial, settled, all: titles.length };
  }, [titles, getDaysOverdue]);

  // Parent IDs that actually have child recurrences so we show "Parcelas" cleanly
  const parentIdsWithChildren = useMemo(() => {
    const s = new Set<number>();
    for (const t of titles) {
      if (t.parentId) s.add(t.parentId);
    }
    return s;
  }, [titles]);

  // Filtered list
  const filteredTitles = useMemo(() => {
    return titles.filter((t) => {
      const st = normStatusUpper(t.status);
      const overdue = getDaysOverdue(t);

      // Overdue card bracket filter overrides quickTab when active
      if (overdueBracket) {
        if (overdue <= 0) return false;
        if (overdueBracket === '1-5' && overdue > 5) return false;
        if (overdueBracket === '6-30' && (overdue < 6 || overdue > 30)) return false;
        if (overdueBracket === '31-60' && (overdue < 31 || overdue > 60)) return false;
        if (overdueBracket === '61-90' && (overdue < 61 || overdue > 90)) return false;
        if (overdueBracket === '90+' && overdue <= 90) return false;
      } else if (exactStatusFilter !== 'ALL') {
        if (st !== exactStatusFilter) return false;
      } else {
        if (quickTab === 'open') {
          if (['PAGO', 'CANCELADO', 'AGRUPADO', 'DEVOLUCAO_VINCULADA'].includes(st)) return false;
        } else if (quickTab === 'overdue') {
          if (overdue <= 0) return false;
        } else if (quickTab === 'partial') {
          if (st !== 'PARCIAL') return false;
        } else if (quickTab === 'settled') {
          if (st !== 'PAGO') return false;
        }
      }

      if (personFilterId !== 'ALL' && String(t.clientId) !== personFilterId) return false;
      if (docTypeFilterId !== 'ALL' && String(t.documentTypeId || '') !== docTypeFilterId) return false;

      const iss = toIsoDateOnly(t.issueDate);
      const due = toIsoDateOnly(t.dueDate);
      if (issueFrom && iss && iss < issueFrom) return false;
      if (issueTo && iss && iss > issueTo) return false;
      if (dueFrom && due && due < dueFrom) return false;
      if (dueTo && due && due > dueTo) return false;

      if (settledFrom || settledTo) {
        const setts = settlementsByTitle[t.id] || [];
        const hasMatch = setts.some((s) => {
          const d = toIsoDateOnly(s.settlementDate);
          if (settledFrom && d < settledFrom) return false;
          if (settledTo && d > settledTo) return false;
          return true;
        });
        if (!hasMatch) return false;
      }

      if (debouncedSearch) {
        const cl = clientMap.get(t.clientId);
        const name = (cl?.fullName || t.clientName || '').toLowerCase();
        const doc = (t.documentNumber || t.titleCode || '').toLowerCase();
        const desc = (t.description || '').toLowerCase();
        if (!name.includes(debouncedSearch) && !doc.includes(debouncedSearch) && !desc.includes(debouncedSearch)) {
          return false;
        }
      }

      return true;
    });
  }, [
    titles,
    overdueBracket,
    exactStatusFilter,
    quickTab,
    personFilterId,
    docTypeFilterId,
    issueFrom,
    issueTo,
    dueFrom,
    dueTo,
    settledFrom,
    settledTo,
    settlementsByTitle,
    debouncedSearch,
    clientMap,
    getDaysOverdue,
  ]);

  // Sorting
  const sortedTitles = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    return filteredTitles.slice().sort((a, b) => {
      switch (sortField) {
        case 'documentNumber':
          return (a.documentNumber || a.titleCode || '').localeCompare(b.documentNumber || b.titleCode || '') * dir;
        case 'clientName': {
          const ca = clientMap.get(a.clientId)?.fullName || a.clientName || '';
          const cb = clientMap.get(b.clientId)?.fullName || b.clientName || '';
          return ca.localeCompare(cb) * dir;
        }
        case 'issueDate':
          return toIsoDateOnly(a.issueDate).localeCompare(toIsoDateOnly(b.issueDate)) * dir;
        case 'dueDate': {
          const cmp = toIsoDateOnly(a.dueDate).localeCompare(toIsoDateOnly(b.dueDate));
          return cmp !== 0 ? cmp * dir : (a.id - b.id) * dir;
        }
        case 'balance':
          return (getTitleBalance(a) - getTitleBalance(b)) * dir;
        case 'amount':
          return (a.amountCents - b.amountCents) * dir;
        case 'status':
          return normStatusUpper(a.status).localeCompare(normStatusUpper(b.status)) * dir;
        default:
          return 0;
      }
    });
  }, [filteredTitles, sortField, sortDir, clientMap]);

  // Pagination (50 rows per page per spec)
  const pageSize = 50;
  const totalPages = Math.max(1, Math.ceil(sortedTitles.length / pageSize));
  const pagedTitles = useMemo(
    () => sortedTitles.slice((page - 1) * pageSize, page * pageSize),
    [sortedTitles, page]
  );

  // Filtered Totals Footer
  const footerTotals = useMemo(() => {
    let origCents = 0;
    let balCents = 0;
    let settledCents = 0;
    for (const t of filteredTitles) {
      const sign = String(t.titleType || '').toUpperCase() === 'DEVOLUCAO' ? -1 : 1;
      const origRaw = t.originalValueCents ?? 0;
      const orig = origRaw > 0 ? origRaw : t.amountCents;
      const bal = getTitleBalance(t);
      origCents += orig * sign;
      balCents += bal * sign;
      settledCents += Math.max(0, orig - bal) * sign;
    }
    return { origCents, balCents, settledCents, count: filteredTitles.length };
  }, [filteredTitles]);

  const handleSortToggle = (field: SortField) => {
    if (sortField === field) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const renderSortIcon = (field: SortField) => {
    if (sortField !== field) return <ArrowUpDown className="w-3 h-3 text-slate-400 inline ml-1 dark:text-slate-400" />;
    return sortDir === 'asc' ? (
      <ChevronUp className="w-3.5 h-3.5 text-slate-900 inline ml-0.5 dark:text-slate-100" />
    ) : (
      <ChevronDown className="w-3.5 h-3.5 text-slate-900 inline ml-0.5 dark:text-slate-100" />
    );
  };

  const clearAllFilters = () => {
    setOverdueBracket(null); // Required: clear active range card too!
    setExactStatusFilter('ALL');
    setPersonFilterId('ALL');
    setDocTypeFilterId('ALL');
    setIssueFrom('');
    setIssueTo('');
    setDueFrom('');
    setDueTo('');
    setSettledFrom('');
    setSettledTo('');
    setSearchInput('');
    setDebouncedSearch('');
    setQuickTab('open');
    setPage(1);
  };

  const selectedTitles = useMemo(
    () => titles.filter((t) => selectedIds.includes(t.id)),
    [titles, selectedIds]
  );

  const checkBlockedPeople = (list: FinancialTitle[]): string | null => {
    for (const t of list) {
      const p = clientMap.get(t.clientId);
      if (p && (p.status === 'suspenso' || p.status === 'cancelado')) {
        return `Operação bloqueada: ${p.fullName} está com status "${p.status.toUpperCase()}".`;
      }
    }
    return null;
  };

  const getAvailableCreditsForPerson = (clientId: number, excludeIds: number[] = []) => {
    return titles.filter((t) => {
      if (t.clientId !== clientId || excludeIds.includes(t.id)) return false;
      const tType = String(t.titleType || '').toUpperCase();
      if (tType !== 'ADIANTAMENTO' && tType !== 'DEVOLUCAO') return false;
      return getTitleBalance(t) > 0;
    });
  };

  const triggerSettleFlow = (targets: FinancialTitle[], mode: 'total' | 'parcial') => {
    setActionsMenuOpen(false);
    setErrorBanner('');
    if (targets.length === 0) return setErrorBanner('Selecione ao menos um título.');
    const blockedErr = checkBlockedPeople(targets);
    if (blockedErr) return setErrorBanner(blockedErr);

    const firstClient = targets[0].clientId;
    if (targets.some((t) => t.clientId !== firstClient)) {
      return setErrorBanner(`Todos os títulos selecionados para baixa devem pertencer à mesma pessoa (${personLabel}).`);
    }

    for (const t of targets) {
      const st = normStatusUpper(t.status);
      if (st === 'AGRUPADO') {
        return setErrorBanner(`O título ${t.documentNumber || t.titleCode} está AGRUPADO em fatura. Use Rastreio para abrir a fatura ativa.`);
      }
      if (st === 'PAGO' || st === 'CANCELADO' || st === 'DEVOLUCAO_VINCULADA') {
        return setErrorBanner(`O título ${t.documentNumber || t.titleCode} (${getStatusLabel(st)}) não possui saldo para baixa.`);
      }
      if (t.isProtested || t.isProvision) {
        return setErrorBanner(`O título ${t.documentNumber || t.titleCode} está sob ${t.isProtested ? 'PROTESTO' : 'PROVISÃO'}. Libere antes de baixar.`);
      }
    }

    const eligibleCredits = getAvailableCreditsForPerson(
      firstClient,
      targets.map((t) => t.id)
    );
    const hasStandard = targets.some((t) => {
      const tt = String(t.titleType || 'PADRAO').toUpperCase();
      return tt === 'PADRAO' || tt === 'FATURA';
    });

    if (hasStandard && eligibleCredits.length > 0) {
      setDeductionPrompt({
        open: true,
        mode: mode === 'total' ? 'pre-settle-total' : 'pre-settle-parcial',
        targetTitles: targets,
        credits: eligibleCredits,
      });
      return;
    }

    setSettlementModal({ open: true, mode, titles: targets });
  };

  const triggerGroupInvoice = () => {
    setActionsMenuOpen(false);
    setErrorBanner('');
    if (selectedTitles.length < 2) {
      return setErrorBanner('Selecione ao menos 2 títulos da mesma pessoa para gerar fatura.');
    }
    const blockedErr = checkBlockedPeople(selectedTitles);
    if (blockedErr) return setErrorBanner(blockedErr);
    const firstClient = selectedTitles[0].clientId;
    if (selectedTitles.some((t) => t.clientId !== firstClient)) {
      return setErrorBanner('Todos os títulos agrupados na fatura devem ser da mesma pessoa.');
    }
    for (const t of selectedTitles) {
      const st = normStatusUpper(t.status);
      if (['PAGO', 'CANCELADO', 'AGRUPADO', 'FATURA_GERADA'].includes(st)) {
        return setErrorBanner(`O título ${t.documentNumber || t.titleCode} (${getStatusLabel(st)}) não pode ser agrupado.`);
      }
    }
    setGroupInvoiceTargets(selectedTitles);
  };

  const triggerCancelTitles = (targets: FinancialTitle[]) => {
    setActionsMenuOpen(false);
    setErrorBanner('');
    if (targets.length === 0) return setErrorBanner('Selecione ao menos um título.');
    if (targets.length === 1 && targets[0].invoiceGroupId && normStatusUpper(targets[0].status) === 'FATURA_GERADA') {
      setCancelModal({ open: true, titles: targets, isInvoiceGroup: true });
      return;
    }
    setCancelModal({ open: true, titles: targets, isInvoiceGroup: false });
  };

  const handleReopenSelected = async (targets: FinancialTitle[]) => {
    setActionsMenuOpen(false);
    setErrorBanner('');
    if (targets.length !== 1) return setErrorBanner('Selecione exatamente 1 título Cancelado ou Agrupado para reabrir.');
    const t = targets[0];
    const st = normStatusUpper(t.status);
    if (st !== 'CANCELADO' && st !== 'AGRUPADO') {
      return setErrorBanner('Somente títulos CANCELADOS ou AGRUPADOS podem ser reabertos.');
    }
    try {
      await apiFetch(`/api/financial-titles/${t.id}/reopen`, { method: 'PATCH' });
      setToast(`Título ${t.documentNumber || t.titleCode} reaberto com saldo restaurado.`);
      setSelectedIds([]);
      await loadTitles();
      await onReloadFinance();
    } catch (e) {
      setErrorBanner(e instanceof Error ? e.message : 'Erro ao reabrir título.');
    }
  };

  const handleRefreshAll = async (msg?: string) => {
    if (msg) setToast(msg);
    setSelectedIds([]);
    await loadTitles();
    await onReloadFinance();
  };

  // RENDER FORM VIEW IF CREATING OR EDITING
  if (viewMode === 'form') {
    return (
      <>
        <FinancialTitleFormView
          scope={scope}
          editingTitle={editingTitle}
          allLoadedTitles={titles}
          clients={localClients}
          units={units}
          documentTypes={documentTypes}
          bearers={bearers}
          chartOfAccounts={chartOfAccounts}
          bankAccounts={bankAccounts}
          departments={departments}
          collaborators={collaborators}
          onClose={() => {
            setViewMode('list');
            setEditingTitle(null);
          }}
          onSaved={async (savedTitle, isNew) => {
            setToast(
              isNew
                ? `Título ${savedTitle.documentNumber || savedTitle.titleCode} lançado com sucesso.`
                : `Título ${savedTitle.documentNumber || savedTitle.titleCode} atualizado.`
            );
            setViewMode('list');
            setEditingTitle(null);
            await loadTitles();
            await onReloadFinance();

            // Check if saved a new PADRAO title & person has available ADIANTAMENTO/DEVOLUCAO
            if (isNew && String(savedTitle.titleType || 'PADRAO').toUpperCase() === 'PADRAO') {
              const credits = getAvailableCreditsForPerson(savedTitle.clientId, [savedTitle.id]);
              if (credits.length > 0) {
                setDeductionPrompt({
                  open: true,
                  mode: 'post-create',
                  targetTitles: [savedTitle],
                  credits,
                });
              }
            }
          }}
          onOpenEditPartner={(c) => setEditPartnerTarget(c)}
          onOpenAdmissionViewer={(admId, ref) =>
            setAdmissionViewer({ admissionId: admId, contractRef: ref })
          }
          onSelectRelatedTitle={(related) => {
            setEditingTitle(related);
          }}
          onNavigate={onNavigate}
        />

        <EditPartnerModal
          person={editPartnerTarget}
          label={personLabel}
          onClose={() => setEditPartnerTarget(null)}
          onUpdated={async (updated) => {
            setLocalClients((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
            setToast(`Cadastro de ${updated.fullName} atualizado com sucesso.`);
            await onReloadFinance();
          }}
        />

        {isReceber && (
          <AdmissionViewerModal
            admissionId={admissionViewer.admissionId}
            contractRef={admissionViewer.contractRef}
            onClose={() => setAdmissionViewer({ admissionId: null, contractRef: '' })}
          />
        )}
      </>
    );
  }

  return (
    <div className="space-y-4">
      {/* Feedback Banners */}
      {toast && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-medium text-emerald-900 flex items-center justify-between gap-2 dark:border-emerald-800/70 dark:bg-emerald-950/50 dark:text-emerald-300">
          <span className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 dark:text-emerald-300" />
            {toast}
          </span>
          <button type="button" onClick={() => setToast('')}>
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {errorBanner && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-xs font-medium text-red-900 flex items-center justify-between gap-2 dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300">
          <span className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-700 shrink-0 dark:text-red-300" />
            {errorBanner}
          </span>
          <button type="button" onClick={() => setErrorBanner('')}>
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Dedicated Régua separation notice on Contas a Receber */}
      {isReceber && (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-start sm:items-center gap-2.5 text-xs text-slate-600 dark:text-slate-300">
            <BellRing className="w-4 h-4 text-blue-700 shrink-0 mt-0.5 sm:mt-0 dark:text-blue-300" />
            <span>
              <strong className="text-slate-900 dark:text-slate-100">Rotina diária segura:</strong> os disparos da{' '}
              <strong>Régua de Cobrança Ivi (-15d / -5d / +7d)</strong> ficam em tela separada para revisão e confirmação de lote antes do envio automático.
            </span>
          </div>
          {onNavigate && (
            <button
              type="button"
              onClick={() => onNavigate('finance_regua')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-800 hover:bg-blue-100 whitespace-nowrap shrink-0 dark:border-blue-800/70 dark:bg-blue-950/50 dark:text-blue-300 dark:hover:bg-blue-900/60"
            >
              <BellRing className="w-3.5 h-3.5" />
              Abrir Régua Ivi
            </button>
          )}
        </div>
      )}

      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
          <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
            {isReceber ? 'Recebimentos Liquidados' : 'Pagamentos Efetuados'}
          </div>
          <div className="mt-1 font-mono text-xl font-bold text-emerald-700 tabular-nums dark:text-emerald-300">
            {formatBRL(metrics.settledCents)}
          </div>
          <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            {tabCounts.settled} título(s) liquidado(s)
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
          <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
            {isReceber ? 'Total a Receber em Aberto' : 'Total a Pagar em Aberto'}
          </div>
          <div className="mt-1 font-mono text-xl font-bold text-blue-700 tabular-nums dark:text-blue-300">
            {formatBRL(metrics.openCents)}
          </div>
          <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            {tabCounts.open} lançamento(s) ativo(s)
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
          <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
            {isReceber ? 'Vencido (Em Atraso)' : 'Contas Vencidas'}
          </div>
          <div className="mt-1 font-mono text-xl font-bold text-red-600 tabular-nums dark:text-red-400">
            {formatBRL(metrics.overdueCents)}
          </div>
          <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            {tabCounts.overdue} título(s) vencido(s)
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
          <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
            {isReceber ? 'Prazo Médio Recebimento' : 'Vencimentos Próx. 7 Dias'}
          </div>
          <div className="mt-1 font-mono text-xl font-bold text-slate-900 tabular-nums dark:text-slate-100">
            {isReceber ? `${metrics.avgReceiptDays} dias` : formatBRL(metrics.next7DaysCents)}
          </div>
          <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            {isReceber ? 'Média sobre baixas liquidadas' : 'Compromissos da semana'}
          </div>
        </div>
      </div>

      {/* 5 Overdue Range Cards (clickable filter toggle) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
        {(
          [
            { key: '1-5' as const, label: 'Atraso 1 a 5 dias' },
            { key: '6-30' as const, label: 'Atraso 6 a 30 dias' },
            { key: '31-60' as const, label: 'Atraso 31 a 60 dias' },
            { key: '61-90' as const, label: 'Atraso 61 a 90 dias' },
            { key: '90+' as const, label: 'Mais de 90 dias' },
          ] as const
        ).map((card) => {
          const active = overdueBracket === card.key;
          const info = metrics.brackets[card.key];
          return (
            <button
              key={card.key}
              type="button"
              onClick={() => {
                setOverdueBracket((prev) => (prev === card.key ? null : card.key));
                setPage(1);
              }}
              className={`rounded-xl border p-3 text-left transition-colors ${
                active
                  ? 'border-red-600 bg-red-50/70 dark:bg-red-950/50'
                  : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800'
              }`}
            >
              <div className="flex items-center justify-between text-[11px]">
                <span className={active ? 'font-bold text-red-900 dark:text-red-300' : 'font-medium text-slate-500 dark:text-slate-400'}>
                  {card.label}
                </span>
                <span className="font-mono font-semibold text-slate-600 tabular-nums dark:text-slate-300">{info.count}</span>
              </div>
              <div
                className={`mt-1 font-mono text-sm font-bold tabular-nums ${
                  info.cents > 0 ? 'text-red-700 dark:text-red-300' : 'text-slate-400 dark:text-slate-400'
                }`}
              >
                {formatBRL(info.cents)}
              </div>
            </button>
          );
        })}
      </div>

      {/* Main Data Grid Container */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-visible dark:border-slate-700 dark:bg-slate-900">
        {/* Header Bar: Quick Lay-User Tabs + Primary CTA + Ações Menu */}
        <div className="p-4 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-3 dark:border-slate-700">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto dark:bg-slate-800">
            {(
              [
                { id: 'open' as const, label: `Em Aberto (${tabCounts.open})` },
                { id: 'overdue' as const, label: `Em Atraso (${tabCounts.overdue})` },
                { id: 'partial' as const, label: `Parciais (${tabCounts.partial})` },
                { id: 'settled' as const, label: `Liquidados (${tabCounts.settled})` },
                { id: 'all' as const, label: `Todos (${tabCounts.all})` },
              ] as const
            ).map((t) => {
              const active = !overdueBracket && exactStatusFilter === 'ALL' && quickTab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    setOverdueBracket(null);
                    setExactStatusFilter('ALL');
                    setQuickTab(t.id);
                    setPage(1);
                  }}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md whitespace-nowrap transition-colors ${
                    active ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-slate-100' : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
                  }`}
                >
                  {t.label}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Column visibility popover */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setColsOpen((o) => !o)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <Columns3 className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
                Colunas
              </button>
              {colsOpen && (
                <div className="absolute right-0 mt-1.5 w-48 rounded-xl border border-slate-200 bg-white p-2.5 shadow-xl z-30 text-xs space-y-1.5 dark:border-slate-700 dark:bg-slate-900">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={showIssueCol}
                      onChange={(e) => setShowIssueCol(e.target.checked)}
                    />
                    <span>Data de Emissão</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={showDocTypeCol}
                      onChange={(e) => setShowDocTypeCol(e.target.checked)}
                    />
                    <span>Tipo de Documento</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={showHistoryCol}
                      onChange={(e) => setShowHistoryCol(e.target.checked)}
                    />
                    <span>Histórico</span>
                  </label>
                </div>
              )}
            </div>

            {/* Batch Actions Menu */}
            <div className="relative" ref={actionsMenuRef}>
              <button
                type="button"
                onClick={() => setActionsMenuOpen((o) => !o)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 whitespace-nowrap dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
              >
                <SlidersHorizontal className="w-3.5 h-3.5 text-slate-600 dark:text-slate-300" />
                Ações {selectedIds.length > 0 ? `(${selectedIds.length})` : ''}
                <ChevronDown className="w-3.5 h-3.5 text-slate-400 dark:text-slate-400" />
              </button>

              {actionsMenuOpen && (
                <div className="absolute right-0 mt-1.5 w-60 rounded-xl border border-slate-200 bg-white py-1.5 shadow-xl z-30 text-xs dark:border-slate-700 dark:bg-slate-900">
                  <button
                    type="button"
                    onClick={() => triggerSettleFlow(selectedTitles, 'total')}
                    className="w-full px-3.5 py-2 text-left hover:bg-slate-50 flex items-center gap-2 font-semibold text-emerald-700 dark:hover:bg-slate-800 dark:text-emerald-300"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Baixa Total em Lote
                  </button>
                  <button
                    type="button"
                    onClick={() => triggerSettleFlow(selectedTitles, 'parcial')}
                    className="w-full px-3.5 py-2 text-left hover:bg-slate-50 flex items-center gap-2 font-semibold text-blue-700 dark:hover:bg-slate-800 dark:text-blue-300"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Baixa Parcial
                  </button>
                  <button
                    type="button"
                    onClick={triggerGroupInvoice}
                    className="w-full px-3.5 py-2 text-left hover:bg-slate-50 flex items-center gap-2 text-slate-800 dark:hover:bg-slate-800 dark:text-slate-100"
                  >
                    <Layers className="w-3.5 h-3.5 text-indigo-700 dark:text-indigo-300" />
                    Gerar Faturas (Agrupar 2+)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setActionsMenuOpen(false);
                      if (selectedTitles.length !== 1) {
                        setErrorBanner('Selecione exatamente 1 título modelo para gerar parcelas recorrentes.');
                        return;
                      }
                      setRecurringModel(selectedTitles[0]);
                    }}
                    className="w-full px-3.5 py-2 text-left hover:bg-slate-50 flex items-center gap-2 text-slate-800 dark:hover:bg-slate-800 dark:text-slate-100"
                  >
                    <Repeat className="w-3.5 h-3.5 text-blue-700 dark:text-blue-300" />
                    Lançamento Recorrente
                  </button>
                  <div className="my-1 border-t border-slate-100 dark:border-slate-800" />
                  <button
                    type="button"
                    onClick={() => {
                      setActionsMenuOpen(false);
                      const target = selectedTitles.find((t) => t.isProtested || t.isProvision);
                      if (!target) {
                        setErrorBanner('Selecione 1 título marcado como Protestado ou Provisão.');
                        return;
                      }
                      setReleaseTarget(target);
                    }}
                    className="w-full px-3.5 py-2 text-left hover:bg-slate-50 flex items-center gap-2 text-slate-800 dark:hover:bg-slate-800 dark:text-slate-100"
                  >
                    <Unlock className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-300" />
                    Liberar Protesto / Provisão
                  </button>
                  <button
                    type="button"
                    onClick={() => handleReopenSelected(selectedTitles)}
                    className="w-full px-3.5 py-2 text-left hover:bg-slate-50 flex items-center gap-2 text-slate-800 dark:hover:bg-slate-800 dark:text-slate-100"
                  >
                    <RotateCcw className="w-3.5 h-3.5 text-amber-700 dark:text-amber-300" />
                    Reabrir Título
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setActionsMenuOpen(false);
                      if (selectedTitles.length === 0) {
                        setErrorBanner('Selecione ao menos 1 título com baixa registrada.');
                        return;
                      }
                      setCancelSettlementTargets(selectedTitles);
                    }}
                    className="w-full px-3.5 py-2 text-left hover:bg-slate-50 flex items-center gap-2 text-amber-800 dark:hover:bg-slate-800 dark:text-amber-300"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Cancelar Baixa(s)
                  </button>
                  <button
                    type="button"
                    onClick={() => triggerCancelTitles(selectedTitles)}
                    className="w-full px-3.5 py-2 text-left hover:bg-red-50 flex items-center gap-2 text-red-700 font-semibold dark:hover:bg-red-950/60 dark:text-red-300"
                  >
                    <X className="w-3.5 h-3.5" />
                    Cancelar Título(s)
                  </button>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => {
                setEditingTitle(null);
                setViewMode('form');
              }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-700 whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              Novo Lançamento
            </button>
          </div>
        </div>

        {/* Search & Advanced Filters Row */}
        <div className="px-4 py-3 bg-slate-50/70 border-b border-slate-200 space-y-3 dark:bg-slate-800/60 dark:border-slate-700">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5 dark:text-slate-400" />
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder={`Buscar por Nº Documento, ${personLabel} ou histórico...`}
                className="w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 py-1.5 text-xs focus:border-slate-900 focus:outline-none dark:border-slate-700 dark:bg-slate-900"
              />
            </div>

            <button
              type="button"
              onClick={() => setAdvFiltersOpen((o) => !o)}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold whitespace-nowrap ${
                advFiltersOpen
                  ? 'border-slate-900 bg-slate-900 text-white dark:border-emerald-500 dark:bg-emerald-600'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800'
              }`}
            >
              <Filter className="w-3.5 h-3.5" />
              Filtros Avançados
            </button>

            {(overdueBracket ||
              exactStatusFilter !== 'ALL' ||
              personFilterId !== 'ALL' ||
              docTypeFilterId !== 'ALL' ||
              issueFrom ||
              dueFrom ||
              settledFrom ||
              searchInput) && (
              <button
                type="button"
                onClick={clearAllFilters}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 whitespace-nowrap dark:border-slate-700 dark:bg-slate-900 dark:text-red-300 dark:hover:bg-red-950/60"
              >
                <X className="w-3.5 h-3.5" />
                Limpar Filtros
              </button>
            )}

            <button
              type="button"
              onClick={() => loadTitles()}
              title="Atualizar listagem"
              className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {advFiltersOpen && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 pt-2 border-t border-slate-200 text-xs dark:border-slate-700">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1 dark:text-slate-300">Status Exato</label>
                <select
                  value={exactStatusFilter}
                  onChange={(e) => {
                    setExactStatusFilter(e.target.value);
                    setOverdueBracket(null);
                    setPage(1);
                  }}
                  className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 dark:border-slate-700 dark:bg-slate-900"
                >
                  <option value="ALL">Usar aba rápida</option>
                  <option value="ABERTO">Em Aberto</option>
                  <option value="PARCIAL">Parcial</option>
                  <option value="PAGO">Liquidado / Pago</option>
                  <option value="ADIANTAMENTO">Adiantamento</option>
                  <option value="ADIANTAMENTO_PARCIAL">Adiantamento Parcial</option>
                  <option value="DEVOLUCAO">Devolução</option>
                  <option value="DEVOLUCAO_PARCIAL">Devolução Parcial</option>
                  <option value="DEVOLUCAO_VINCULADA">Devolução Vinculada</option>
                  <option value="AGRUPADO">Baixada Por Fatura (Agrupado)</option>
                  <option value="FATURA_GERADA">Fatura Gerada</option>
                  <option value="PROTESTADO">Protestado</option>
                  <option value="PROVISAO">Provisão</option>
                  <option value="CANCELADO">Cancelado</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1 dark:text-slate-300">{personLabel}</label>
                <select
                  value={personFilterId}
                  onChange={(e) => {
                    setPersonFilterId(e.target.value);
                    setPage(1);
                  }}
                  className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                >
                  <option value="ALL">Todos</option>
                  {localClients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.fullName}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1 dark:text-slate-300">Tipo de Documento</label>
                <select
                  value={docTypeFilterId}
                  onChange={(e) => {
                    setDocTypeFilterId(e.target.value);
                    setPage(1);
                  }}
                  className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                >
                  <option value="ALL">Todos</option>
                  {documentTypes.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.description}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1 dark:text-slate-300">Vencimento (De / Até)</label>
                <div className="flex gap-1">
                  <input
                    type="date"
                    value={dueFrom}
                    onChange={(e) => setDueFrom(e.target.value)}
                    className="w-1/2 rounded-lg border border-slate-200 bg-white px-1.5 py-1.5 font-mono text-[11px] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  />
                  <input
                    type="date"
                    value={dueTo}
                    onChange={(e) => setDueTo(e.target.value)}
                    className="w-1/2 rounded-lg border border-slate-200 bg-white px-1.5 py-1.5 font-mono text-[11px] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1 dark:text-slate-300">Data de Baixa (De / Até)</label>
                <div className="flex gap-1">
                  <input
                    type="date"
                    value={settledFrom}
                    onChange={(e) => setSettledFrom(e.target.value)}
                    className="w-1/2 rounded-lg border border-slate-200 bg-white px-1.5 py-1.5 font-mono text-[11px] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  />
                  <input
                    type="date"
                    value={settledTo}
                    onChange={(e) => setSettledTo(e.target.value)}
                    className="w-1/2 rounded-lg border border-slate-200 bg-white px-1.5 py-1.5 font-mono text-[11px] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* High-Density Data Grid */}
        <div className="overflow-x-auto scroll-rulers">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-[11px] font-semibold text-slate-500 border-b border-slate-200 dark:bg-slate-800/70 dark:text-slate-400 dark:border-slate-700">
              <tr>
                <th className="px-3 py-2.5 w-8">
                  <input
                    type="checkbox"
                    checked={pagedTitles.length > 0 && pagedTitles.every((t) => selectedIds.includes(t.id))}
                    onChange={(e) => {
                      const pageIds = pagedTitles.map((t) => t.id);
                      if (e.target.checked) {
                        setSelectedIds((prev) => Array.from(new Set([...prev, ...pageIds])));
                      } else {
                        setSelectedIds((prev) => prev.filter((id) => !pageIds.includes(id)));
                      }
                    }}
                  />
                </th>
                <th
                  tabIndex={0}
                  onClick={() => handleSortToggle('documentNumber')}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') handleSortToggle('documentNumber');
                  }}
                  className="px-3 py-2.5 cursor-pointer select-none whitespace-nowrap"
                >
                  Documento {renderSortIcon('documentNumber')}
                </th>
                <th
                  tabIndex={0}
                  onClick={() => handleSortToggle('clientName')}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') handleSortToggle('clientName');
                  }}
                  className="px-3 py-2.5 cursor-pointer select-none whitespace-nowrap"
                >
                  {personLabel} {renderSortIcon('clientName')}
                </th>
                {showHistoryCol && <th className="px-3 py-2.5">Histórico</th>}
                {showDocTypeCol && <th className="px-3 py-2.5 whitespace-nowrap">Tipo Doc</th>}
                <th className="px-3 py-2.5 whitespace-nowrap">Parcela</th>
                {showIssueCol && (
                  <th
                    tabIndex={0}
                    onClick={() => handleSortToggle('issueDate')}
                    className="px-3 py-2.5 cursor-pointer select-none whitespace-nowrap"
                  >
                    Emissão {renderSortIcon('issueDate')}
                  </th>
                )}
                <th
                  tabIndex={0}
                  onClick={() => handleSortToggle('dueDate')}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') handleSortToggle('dueDate');
                  }}
                  className="px-3 py-2.5 cursor-pointer select-none whitespace-nowrap"
                >
                  Vencimento {renderSortIcon('dueDate')}
                </th>
                <th
                  tabIndex={0}
                  onClick={() => handleSortToggle('balance')}
                  className="px-3 py-2.5 text-right cursor-pointer select-none whitespace-nowrap"
                >
                  Saldo Aberto {renderSortIcon('balance')}
                </th>
                <th
                  tabIndex={0}
                  onClick={() => handleSortToggle('amount')}
                  className="px-3 py-2.5 text-right cursor-pointer select-none whitespace-nowrap"
                >
                  Valor Total {renderSortIcon('amount')}
                </th>
                <th
                  tabIndex={0}
                  onClick={() => handleSortToggle('status')}
                  className="px-3 py-2.5 cursor-pointer select-none whitespace-nowrap"
                >
                  Status {renderSortIcon('status')}
                </th>
                <th className="px-3 py-2.5 text-right whitespace-nowrap">Ações</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {loading && titles.length === 0 ? (
                <tr>
                  <td colSpan={12} className="py-10 text-center text-slate-500 dark:text-slate-400">
                    Carregando títulos financeiros...
                  </td>
                </tr>
              ) : pagedTitles.length === 0 ? (
                <tr>
                  <td colSpan={12} className="py-10 text-center text-slate-500 dark:text-slate-400">
                    Nenhum lançamento encontrado para os filtros aplicados.
                  </td>
                </tr>
              ) : (
                pagedTitles.map((t) => {
                  const st = normStatusUpper(t.status);
                  const cl = clientMap.get(t.clientId);
                  const docType = t.documentTypeId ? docTypeMap.get(t.documentTypeId) : null;
                  const overdueDays = getDaysOverdue(t);
                  const bal = getTitleBalance(t);
                  const tType = String(t.titleType || 'PADRAO').toUpperCase();
                  const isDev = tType === 'DEVOLUCAO';
                  const isAdt = tType === 'ADIANTAMENTO';
                  const canSettle =
                    !t.isProtested &&
                    !t.isProvision &&
                    bal > 0 &&
                    !['PAGO', 'CANCELADO', 'AGRUPADO', 'DEVOLUCAO_VINCULADA'].includes(st);
                  const hasChildren = parentIdsWithChildren.has(t.id) || Boolean(t.parentId);

                  return (
                    <tr
                      key={t.id}
                      onClick={() => {
                        setEditingTitle(t);
                        setViewMode('form');
                      }}
                      className="hover:bg-slate-50/90 cursor-pointer transition-colors"
                    >
                      <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(t.id)}
                          onChange={(e) =>
                            setSelectedIds((prev) =>
                              e.target.checked ? [...prev, t.id] : prev.filter((id) => id !== t.id)
                            )
                          }
                        />
                      </td>

                      <td className="px-3 py-2.5 font-mono font-semibold text-slate-900 whitespace-nowrap dark:text-slate-100">
                        <div>{t.documentNumber || t.titleCode}</div>
                        {(t.origin === 'AUDITORIA' || t.origin === 'RECORRENCIA' || t.origin === 'FATURAMENTO') && (
                          <div className="text-[10px] font-normal text-slate-400 dark:text-slate-400">{t.origin}</div>
                        )}
                      </td>

                      <td className="px-3 py-2.5 font-medium text-slate-800 dark:text-slate-100">
                        <div className="truncate max-w-[200px]">{cl?.fullName || t.clientName || '—'}</div>
                        {cl && (cl.status === 'suspenso' || cl.status === 'cancelado') && (
                          <span className="text-[10px] font-bold text-red-700 uppercase dark:text-red-300">
                            Pessoa {cl.status}
                          </span>
                        )}
                      </td>

                      {showHistoryCol && (
                        <td className="px-3 py-2.5 text-slate-600 max-w-[220px] truncate dark:text-slate-300">
                          {t.description || '—'}
                        </td>
                      )}

                      {showDocTypeCol && (
                        <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap dark:text-slate-300">
                          {docType?.description || '—'}
                        </td>
                      )}

                      <td className="px-3 py-2.5 font-mono tabular-nums text-slate-600 whitespace-nowrap dark:text-slate-300">
                        {t.installmentNumber}/{t.totalInstallments}
                      </td>

                      {showIssueCol && (
                        <td className="px-3 py-2.5 font-mono tabular-nums text-slate-500 whitespace-nowrap dark:text-slate-400">
                          {t.issueDate ? formatIsoDateToBR(t.issueDate) : '—'}
                        </td>
                      )}

                      <td className="px-3 py-2.5 font-mono tabular-nums whitespace-nowrap">
                        <span className={overdueDays > 0 ? 'text-red-600 font-bold dark:text-red-400' : 'text-slate-700 dark:text-slate-200'}>
                          {formatIsoDateToBR(t.dueDate)}
                        </span>
                        {overdueDays > 0 && (
                          <span className="ml-1.5 text-[10px] font-bold text-red-600 dark:text-red-400">
                            +{overdueDays}d
                          </span>
                        )}
                      </td>

                      <td
                        className={`px-3 py-2.5 text-right font-mono font-bold tabular-nums whitespace-nowrap ${
                          isAdt ? 'text-amber-700 dark:text-amber-300' : isDev ? 'text-rose-700 dark:text-rose-300' : 'text-slate-900 dark:text-slate-100'
                        }`}
                      >
                        {isDev && bal > 0 ? `-${formatBRL(bal)}` : formatBRL(bal)}
                      </td>

                      <td
                        className={`px-3 py-2.5 text-right font-mono tabular-nums whitespace-nowrap ${
                          isAdt ? 'text-amber-700 font-semibold dark:text-amber-300' : 'text-slate-600 dark:text-slate-300'
                        }`}
                      >
                        {isDev ? `-${formatBRL(t.amountCents)}` : formatBRL(t.amountCents)}
                      </td>

                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <span className={getStatusToneClass(st, overdueDays > 0)}>
                          {getStatusLabel(st)}
                        </span>
                      </td>

                      <td
                        className="px-3 py-2.5 text-right whitespace-nowrap space-x-2.5"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {canSettle && (
                          <button
                            type="button"
                            onClick={() => triggerSettleFlow([t], 'total')}
                            className="text-[11px] font-semibold text-emerald-700 hover:underline dark:text-emerald-300"
                          >
                            Baixar
                          </button>
                        )}
                        {(t.isProtested || t.isProvision) && (
                          <button
                            type="button"
                            onClick={() => setReleaseTarget(t)}
                            className="text-[11px] font-semibold text-blue-700 hover:underline dark:text-blue-300"
                          >
                            Liberar
                          </button>
                        )}
                        {hasChildren && (
                          <button
                            type="button"
                            onClick={() => setViewChildrenTarget(t)}
                            className="text-[11px] font-semibold text-slate-700 hover:underline dark:text-slate-200"
                          >
                            Parcelas
                          </button>
                        )}
                        {t.invoiceGroupId && (
                          <button
                            type="button"
                            onClick={() => setTraceTarget(t)}
                            className="text-[11px] font-semibold text-indigo-700 hover:underline dark:text-indigo-300"
                          >
                            Rastreio
                          </button>
                        )}
                        {st === 'CANCELADO' ? (
                          <button
                            type="button"
                            onClick={() => setDeleteTarget(t)}
                            title="Excluir definitivamente"
                            className="text-[11px] font-semibold text-red-700 hover:underline inline-flex items-center gap-0.5 dark:text-red-300"
                          >
                            <Trash2 className="w-3 h-3" />
                            Excluir
                          </button>
                        ) : (
                          st !== 'PAGO' &&
                          st !== 'AGRUPADO' && (
                            <button
                              type="button"
                              onClick={() => triggerCancelTitles([t])}
                              className="text-[11px] font-semibold text-slate-500 hover:text-red-700 hover:underline dark:text-slate-400"
                            >
                              Cancelar
                            </button>
                          )
                        )}
                        <button
                          type="button"
                          onClick={() => setAuditTarget(t)}
                          title="Histórico de Auditoria"
                          className="text-[11px] font-semibold text-slate-500 hover:text-slate-900 inline-flex items-center gap-0.5 dark:text-slate-400 dark:hover:text-white"
                        >
                          <History className="w-3 h-3" />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Footer: Totals Drawer & 50/page Pagination */}
        <div className="px-4 py-3 border-t border-slate-200 bg-slate-50/70 space-y-2.5 text-xs dark:border-slate-700 dark:bg-slate-800/60">
          {showTotalsFooter && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pb-2 border-b border-slate-200 dark:border-slate-700">
              <div>
                <div className="text-[10px] text-slate-500 dark:text-slate-400">Qtd. Filtrada</div>
                <div className="font-mono font-bold text-slate-900 tabular-nums dark:text-slate-100">{footerTotals.count} título(s)</div>
              </div>
              <div>
                <div className="text-[10px] text-slate-500 dark:text-slate-400">Valor Total Filtrado</div>
                <div className="font-mono font-bold text-slate-900 tabular-nums dark:text-slate-100">{formatBRL(footerTotals.origCents)}</div>
              </div>
              <div>
                <div className="text-[10px] text-slate-500 dark:text-slate-400">Total Baixado</div>
                <div className="font-mono font-bold text-emerald-700 tabular-nums dark:text-emerald-300">{formatBRL(footerTotals.settledCents)}</div>
              </div>
              <div>
                <div className="text-[10px] text-slate-500 dark:text-slate-400">Saldo em Aberto Filtrado</div>
                <div className="font-mono font-bold text-blue-700 tabular-nums dark:text-blue-300">{formatBRL(footerTotals.balCents)}</div>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setShowTotalsFooter((v) => !v)}
              className="text-[11px] font-semibold text-blue-700 hover:underline dark:text-blue-300"
            >
              {showTotalsFooter ? 'Ocultar Totais' : 'Ver Totais do Filtro'}
            </button>

            <div className="flex items-center gap-3 text-[11px] text-slate-600 dark:text-slate-300">
              <span>
                Mostrando {pagedTitles.length} de {sortedTitles.length} título(s) · Página {page} de {totalPages}
              </span>
              {totalPages > 1 && (
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => p - 1)}
                    className="rounded border border-slate-200 bg-white px-2.5 py-1 font-semibold disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900"
                  >
                    Anterior
                  </button>
                  <button
                    type="button"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => p + 1)}
                    className="rounded border border-slate-200 bg-white px-2.5 py-1 font-semibold disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900"
                  >
                    Próxima
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ALL MODALS */}
      <SettlementModal
        open={settlementModal.open}
        mode={settlementModal.mode}
        scope={scope}
        titles={settlementModal.titles}
        bankAccounts={bankAccounts}
        onClose={() => setSettlementModal({ open: false, mode: 'total', titles: [] })}
        onSettled={handleRefreshAll}
      />

      <DeductionModal
        open={deductionPrompt.open}
        title={
          deductionPrompt.mode === 'post-create'
            ? 'Crédito Disponível para Vincular'
            : 'Deduzir Adiantamento / Devolução na Baixa'
        }
        subtitle={`${personLabel} possui créditos abertos. Aplique abaixo para compensar o saldo antes da movimentação bancária.`}
        targetTitles={deductionPrompt.targetTitles}
        availableCredits={deductionPrompt.credits}
        skipLabel={deductionPrompt.mode === 'post-create' ? 'Ignorar por Agora' : 'Pular e Baixar no Banco'}
        onClose={() => setDeductionPrompt({ open: false, mode: 'post-create', targetTitles: [], credits: [] })}
        onSkip={() => {
          const nextMode = deductionPrompt.mode;
          const nextTargets = deductionPrompt.targetTitles;
          setDeductionPrompt({ open: false, mode: 'post-create', targetTitles: [], credits: [] });
          if (nextMode === 'pre-settle-total') {
            setSettlementModal({ open: true, mode: 'total', titles: nextTargets });
          } else if (nextMode === 'pre-settle-parcial') {
            setSettlementModal({ open: true, mode: 'parcial', titles: nextTargets });
          }
        }}
        onApplied={async (coveredFull, totalAppliedCents) => {
          const prevMode = deductionPrompt.mode;
          const targetIds = deductionPrompt.targetTitles.map((t) => t.id);
          setDeductionPrompt({ open: false, mode: 'post-create', targetTitles: [], credits: [] });
          await handleRefreshAll(`Dedução de ${formatBRL(totalAppliedCents)} compensada com sucesso.`);
          if (!coveredFull && (prevMode === 'pre-settle-total' || prevMode === 'pre-settle-parcial')) {
            // Re-fetch refreshed titles cleanly and open bank settlement with remaining balance
            const res = await apiFetch<{ titles: FinancialTitle[] }>(
              `/api/financial-titles?scope=${scope}&page=1&pageSize=200`
            );
            const refreshedTargets = (res.titles || []).filter(
              (t) => targetIds.includes(t.id) && getTitleBalance(t) > 0
            );
            if (refreshedTargets.length > 0) {
              setSettlementModal({
                open: true,
                mode: prevMode === 'pre-settle-total' ? 'total' : 'parcial',
                titles: refreshedTargets,
              });
            }
          }
        }}
      />

      <ReleaseProtestProvisionModal
        title={releaseTarget}
        onClose={() => setReleaseTarget(null)}
        onReleased={handleRefreshAll}
      />

      <CancelSettlementModal
        open={Boolean(cancelSettlementTargets)}
        titles={cancelSettlementTargets || []}
        settlementsByTitle={settlementsByTitle}
        onClose={() => setCancelSettlementTargets(null)}
        onCancelled={handleRefreshAll}
      />

      <RecurringInstallmentsModal
        modelTitle={recurringModel}
        onClose={() => setRecurringModel(null)}
        onCreated={handleRefreshAll}
      />

      <ViewChildrenModal
        parentTitle={viewChildrenTarget}
        onClose={() => setViewChildrenTarget(null)}
        onOpenTitle={(t) => {
          setEditingTitle(t);
          setViewMode('form');
        }}
      />

      <GroupInvoiceModal
        open={Boolean(groupInvoiceTargets)}
        titles={groupInvoiceTargets || []}
        onClose={() => setGroupInvoiceTargets(null)}
        onGrouped={handleRefreshAll}
      />

      <InvoiceTraceModal
        targetTitle={traceTarget}
        allTitles={titles}
        onClose={() => setTraceTarget(null)}
        onOpenTitle={(t) => {
          setEditingTitle(t);
          setViewMode('form');
        }}
      />

      <CancelTitlesModal
        open={cancelModal.open}
        titles={cancelModal.titles}
        isInvoiceGroup={cancelModal.isInvoiceGroup}
        onClose={() => setCancelModal({ open: false, titles: [], isInvoiceGroup: false })}
        onCancelled={handleRefreshAll}
      />

      <DeleteTitleConfirmModal
        target={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onDeleted={handleRefreshAll}
      />

      <TitleAuditModal target={auditTarget} scope={scope} onClose={() => setAuditTarget(null)} />
    </div>
  );
};
