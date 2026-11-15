import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownCircle,
  ArrowLeftRight,
  ArrowUpCircle,
  ArrowUpDown,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Filter,
  History,
  Link2,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { apiFetch, formatBRL } from '../../../lib/api.ts';
import {
  BankAccount,
  BankMovement,
  ChartAccountItem,
  ModuleId,
  NavigationIntent,
} from '../../../types.ts';
import {
  centsToMaskInput,
  formatCurrencyTyping,
  formatIsoDateToBR,
  formatSignedBRL,
  getCurrentMonthBounds,
  parseMaskInputToCents,
  toIsoDateOnly,
} from './currencyAndParsers.ts';
import { MovementAuditModal } from './MovementAuditModal.tsx';

interface BankMovementManagerProps {
  bankAccounts: BankAccount[];
  bankMovements: BankMovement[];
  chartOfAccounts: ChartAccountItem[];
  highlightMovementId?: number;
  onClearIntent?: () => void;
  onReload: () => Promise<void>;
  onNavigate?: (mod: ModuleId, intent?: NavigationIntent) => void;
}

type SortField =
  | 'movementDate'
  | 'description'
  | 'documentNumber'
  | 'origin'
  | 'entrada'
  | 'saida'
  | 'status';

const ORIGIN_LABELS: Record<string, string> = {
  BAIXA_RECEBER: 'Recebimento',
  BAIXA_PAGAR: 'Pagamento',
  MANUAL: 'Manual',
  TARIFA: 'Tarifa',
  TRANSFERENCIA: 'Transferência',
  DEPOSITO: 'Depósito',
  SAQUE: 'Saque',
};

function formatAccountLabel(acc: BankAccount): string {
  const parts = [acc.bankName];
  if (acc.agency) parts.push(`Ag ${acc.agency}`);
  if (acc.accountNumber) parts.push(`CC ${acc.accountNumber}`);
  return parts.join(' · ');
}

export const BankMovementManager: React.FC<BankMovementManagerProps> = ({
  bankAccounts,
  bankMovements,
  chartOfAccounts,
  highlightMovementId,
  onClearIntent,
  onReload,
  onNavigate,
}) => {
  const monthBounds = useMemo(() => getCurrentMonthBounds(), []);
  const [selectedAccountId, setSelectedAccountId] = useState<string>('all');
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Filters
  const [dateFrom, setDateFrom] = useState(monthBounds.firstDay);
  const [dateTo, setDateTo] = useState(monthBounds.lastDay);
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'CREDITO' | 'DEBITO'>('ALL');
  const [originFilter, setOriginFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [searchText, setSearchText] = useState('');

  // Sorting
  const [sortField, setSortField] = useState<SortField>('movementDate');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  // Toast / highlight
  const [toast, setToast] = useState('');
  const [errorBanner, setErrorBanner] = useState('');
  const [highlightedId, setHighlightedId] = useState<number | null>(null);
  const rowRefs = useRef<Record<number, HTMLTableRowElement | null>>({});

  // Modal: Generic New / Edit Movement
  const [genericModalOpen, setGenericModalOpen] = useState(false);
  const [editingMovement, setEditingMovement] = useState<BankMovement | null>(null);
  const [genAccountId, setGenAccountId] = useState<number>(0);
  const [genDate, setGenDate] = useState('');
  const [genType, setGenType] = useState<'CREDITO' | 'DEBITO'>('DEBITO');
  const [genAmountMask, setGenAmountMask] = useState('0,00');
  const [genDoc, setGenDoc] = useState('');
  const [genDesc, setGenDesc] = useState('');
  const [genCategoryId, setGenCategoryId] = useState<string>('');
  const [genOrigin, setGenOrigin] = useState<string>('MANUAL');
  const [genStatus, setGenStatus] = useState<'PENDENTE' | 'CONCILIADO'>('PENDENTE');
  const [genBusy, setGenBusy] = useState(false);
  const [genError, setGenError] = useState('');

  // Modal: Deposit
  const [depositOpen, setDepositOpen] = useState(false);
  const [depAccountId, setDepAccountId] = useState<number>(0);
  const [depDate, setDepDate] = useState('');
  const [depAmountMask, setDepAmountMask] = useState('0,00');
  const [depDesc, setDepDesc] = useState('');
  const [depCatId, setDepCatId] = useState('');
  const [depStatus, setDepStatus] = useState<'PENDENTE' | 'CONCILIADO'>('PENDENTE');
  const [depBusy, setDepBusy] = useState(false);
  const [depError, setDepError] = useState('');

  // Modal: Withdraw (Saque)
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [wdAccountId, setWdAccountId] = useState<number>(0);
  const [wdDate, setWdDate] = useState('');
  const [wdAmountMask, setWdAmountMask] = useState('0,00');
  const [wdDesc, setWdDesc] = useState('');
  const [wdCatId, setWdCatId] = useState('');
  const [wdStatus, setWdStatus] = useState<'PENDENTE' | 'CONCILIADO'>('PENDENTE');
  const [wdBusy, setWdBusy] = useState(false);
  const [wdError, setWdError] = useState('');

  // Modal: Transfer
  const [transferOpen, setTransferOpen] = useState(false);
  const [trSrcId, setTrSrcId] = useState<number>(0);
  const [trDstId, setTrDstId] = useState<number>(0);
  const [trDate, setTrDate] = useState('');
  const [trAmountMask, setTrAmountMask] = useState('0,00');
  const [trDesc, setTrDesc] = useState('');
  const [trCatId, setTrCatId] = useState('');
  const [trStatus, setTrStatus] = useState<'PENDENTE' | 'CONCILIADO'>('PENDENTE');
  const [trBusy, setTrBusy] = useState(false);
  const [trError, setTrError] = useState('');

  // Modal: Linked Title Lock
  const [linkedTarget, setLinkedTarget] = useState<BankMovement | null>(null);

  // Modal: Confirm Delete
  const [deleteTarget, setDeleteTarget] = useState<BankMovement | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  // Modal: Audit History
  const [auditTarget, setAuditTarget] = useState<BankMovement | null>(null);

  const todayIso = () => new Date().toISOString().slice(0, 10);

  const triggerHighlight = (id: number) => {
    setHighlightedId(id);
    setTimeout(() => {
      const el = rowRefs.current[id];
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 150);
    setTimeout(() => {
      setHighlightedId((curr) => (curr === id ? null : curr));
    }, 4000);
  };

  useEffect(() => {
    if (!highlightMovementId || bankMovements.length === 0) return;
    const match = bankMovements.find((m) => m.id === highlightMovementId);
    if (match) {
      const mDate = toIsoDateOnly(match.movementDate);
      if (mDate && ((dateFrom && mDate < dateFrom) || (dateTo && mDate > dateTo))) {
        setDateFrom('');
        setDateTo('');
      }
      if (selectedAccountId !== 'all' && String(match.bankAccountId) !== selectedAccountId) {
        setSelectedAccountId('all');
      }
      triggerHighlight(highlightMovementId);
      onClearIntent?.();
    }
  }, [highlightMovementId, bankMovements, dateFrom, dateTo, selectedAccountId, onClearIntent]);

  // Analytic accounts filtered by type
  const analyticRevenues = useMemo(
    () => chartOfAccounts.filter((c) => c.active !== false && c.isAnalytic && c.type === 'receita'),
    [chartOfAccounts]
  );
  const analyticExpenses = useMemo(
    () => chartOfAccounts.filter((c) => c.active !== false && c.isAnalytic && c.type === 'despesa'),
    [chartOfAccounts]
  );

  // Normalize movements & compute chronological running balance BEFORE filters (Section 3.2)
  const movementsWithAccumulated = useMemo(() => {
    const relevantAccounts =
      selectedAccountId === 'all'
        ? bankAccounts
        : bankAccounts.filter((a) => String(a.id) === selectedAccountId);

    const baseInitialCents = relevantAccounts.reduce((sum, a) => sum + (a.initialBalanceCents || 0), 0);

    const accountMovements = bankMovements
      .filter((m) => selectedAccountId === 'all' || String(m.bankAccountId) === selectedAccountId)
      .slice()
      .sort((a, b) => {
        const da = toIsoDateOnly(a.movementDate);
        const db = toIsoDateOnly(b.movementDate);
        if (da !== db) return da.localeCompare(db);
        return a.id - b.id;
      });

    let running = baseInitialCents;
    let totalLoadedCredits = 0;
    let totalLoadedDebits = 0;

    const enriched = accountMovements.map((m) => {
      const normType: 'CREDITO' | 'DEBITO' =
        String(m.movementType).toUpperCase() === 'CREDITO' ||
        String(m.movementType).toUpperCase() === 'ENTRADA'
          ? 'CREDITO'
          : 'DEBITO';
      const amt = Math.abs(m.amountCents || 0);
      if (normType === 'CREDITO') {
        running += amt;
        totalLoadedCredits += amt;
      } else {
        running -= amt;
        totalLoadedDebits += amt;
      }
      return {
        ...m,
        movementType: normType,
        isoDate: toIsoDateOnly(m.movementDate),
        accumulatedBalanceCents: running,
      };
    });

    const headerBalanceCents = baseInitialCents + totalLoadedCredits - totalLoadedDebits;
    return { baseInitialCents, headerBalanceCents, enriched };
  }, [bankAccounts, bankMovements, selectedAccountId]);

  // Apply local filters
  const filteredRows = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    return movementsWithAccumulated.enriched.filter((m) => {
      if (dateFrom && m.isoDate && m.isoDate < dateFrom) return false;
      if (dateTo && m.isoDate && m.isoDate > dateTo) return false;
      if (typeFilter !== 'ALL' && m.movementType !== typeFilter) return false;
      if (originFilter !== 'ALL' && String(m.origin || 'MANUAL').toUpperCase() !== originFilter) return false;
      if (statusFilter !== 'ALL' && String(m.status || 'PENDENTE').toUpperCase() !== statusFilter) return false;
      if (q) {
        const descMatch = (m.description || '').toLowerCase().includes(q);
        const docMatch = (m.documentNumber || '').toLowerCase().includes(q);
        if (!descMatch && !docMatch) return false;
      }
      return true;
    });
  }, [movementsWithAccumulated.enriched, dateFrom, dateTo, typeFilter, originFilter, statusFilter, searchText]);

  // Apply sorting (preserves accumulatedBalanceCents computed before filters)
  const sortedRows = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    return filteredRows.slice().sort((a, b) => {
      switch (sortField) {
        case 'movementDate':
          if (a.isoDate !== b.isoDate) return a.isoDate.localeCompare(b.isoDate) * dir;
          return (a.id - b.id) * dir;
        case 'description':
          return (a.description || '').localeCompare(b.description || '') * dir;
        case 'documentNumber':
          return (a.documentNumber || '').localeCompare(b.documentNumber || '') * dir;
        case 'origin':
          return String(a.origin || '').localeCompare(String(b.origin || '')) * dir;
        case 'entrada': {
          const va = a.movementType === 'CREDITO' ? a.amountCents : 0;
          const vb = b.movementType === 'CREDITO' ? b.amountCents : 0;
          return (va - vb) * dir;
        }
        case 'saida': {
          const va = a.movementType === 'DEBITO' ? a.amountCents : 0;
          const vb = b.movementType === 'DEBITO' ? b.amountCents : 0;
          return (va - vb) * dir;
        }
        case 'status':
          return String(a.status || '').localeCompare(String(b.status || '')) * dir;
        default:
          return 0;
      }
    });
  }, [filteredRows, sortField, sortDir]);

  const periodSummary = useMemo(() => {
    let entries = 0;
    let exits = 0;
    for (const r of filteredRows) {
      if (r.movementType === 'CREDITO') entries += r.amountCents;
      else exits += r.amountCents;
    }
    const periodBalance = movementsWithAccumulated.baseInitialCents + entries - exits;
    return { entries, exits, periodBalance, count: filteredRows.length };
  }, [filteredRows, movementsWithAccumulated.baseInitialCents]);

  const handleSortToggle = (field: SortField) => {
    if (sortField === field) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const renderSortIcon = (field: SortField) => {
    if (sortField !== field) return <ArrowUpDown className="w-3 h-3 text-slate-400 inline ml-1" />;
    return sortDir === 'asc' ? (
      <ChevronUp className="w-3.5 h-3.5 text-slate-900 inline ml-0.5" />
    ) : (
      <ChevronDown className="w-3.5 h-3.5 text-slate-900 inline ml-0.5" />
    );
  };

  // Open Generic New / Edit Modal
  const openGenericNewModal = () => {
    const defaultAcc =
      selectedAccountId !== 'all'
        ? Number(selectedAccountId)
        : bankAccounts[0]?.id || 0;
    setEditingMovement(null);
    setGenAccountId(defaultAcc);
    setGenDate(todayIso());
    setGenType('DEBITO');
    setGenAmountMask('0,00');
    setGenDoc('');
    setGenDesc('');
    setGenCategoryId('');
    setGenOrigin('MANUAL');
    setGenStatus('PENDENTE');
    setGenError('');
    setGenericModalOpen(true);
  };

  const openEditRow = (mov: BankMovement) => {
    if (mov.titleId && mov.titleSource) {
      setLinkedTarget(mov);
      return;
    }
    setEditingMovement(mov);
    setGenAccountId(mov.bankAccountId);
    setGenDate(toIsoDateOnly(mov.movementDate) || todayIso());
    setGenType(
      String(mov.movementType).toUpperCase() === 'CREDITO' ||
        String(mov.movementType).toUpperCase() === 'ENTRADA'
        ? 'CREDITO'
        : 'DEBITO'
    );
    setGenAmountMask(centsToMaskInput(mov.amountCents));
    setGenDoc(mov.documentNumber || '');
    setGenDesc(mov.description || '');
    setGenCategoryId(mov.categoryId ? String(mov.categoryId) : '');
    setGenOrigin(String(mov.origin || 'MANUAL').toUpperCase());
    setGenStatus(String(mov.status || 'PENDENTE').toUpperCase() === 'CONCILIADO' ? 'CONCILIADO' : 'PENDENTE');
    setGenError('');
    setGenericModalOpen(true);
  };

  const openDeleteRow = (mov: BankMovement) => {
    if (mov.titleId && mov.titleSource) {
      setLinkedTarget(mov);
      return;
    }
    setDeleteError('');
    setDeleteTarget(mov);
  };

  // Keyboard Ctrl+Enter / Cmd+Enter for Generic Modal (Section 4.3)
  const submitGenericForm = async () => {
    setGenError('');
    const amtCents = parseMaskInputToCents(genAmountMask);
    if (!genAccountId) {
      setGenError('Selecione a conta corrente.');
      return;
    }
    if (!genDate) {
      setGenError('Informe a data do lançamento.');
      return;
    }
    if (amtCents <= 0) {
      setGenError('Informe um valor maior que zero.');
      return;
    }
    if (!genDesc.trim()) {
      setGenError('Informe a descrição do lançamento.');
      return;
    }
    if (!genCategoryId) {
      setGenError('Selecione uma categoria do Plano de Contas.');
      return;
    }

    const catObj = chartOfAccounts.find((c) => String(c.id) === genCategoryId);
    const payload = {
      bankAccountId: genAccountId,
      movementDate: genDate,
      movementType: genType,
      amountCents: amtCents,
      documentNumber: genDoc.trim(),
      description: genDesc.trim(),
      categoryId: Number(genCategoryId),
      categoryName: catObj ? `${catObj.code} - ${catObj.name}` : '',
      origin: genOrigin,
      status: genStatus,
    };

    if (editingMovement) {
      setGenBusy(true);
      try {
        await apiFetch(`/api/finance/bank-movements/${editingMovement.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        setGenericModalOpen(false);
        setToast('Lançamento atualizado com sucesso.');
        await onReload();
        triggerHighlight(editingMovement.id);
      } catch {
        setGenError('Não foi possível atualizar o lançamento.');
      } finally {
        setGenBusy(false);
      }
    } else {
      setGenBusy(true);
      try {
        const res = await apiFetch<{ movement: BankMovement }>('/api/finance/bank-movements', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setGenericModalOpen(false);
        setToast('Lançamento registrado com sucesso.');
        await onReload();
        if (res?.movement?.id) triggerHighlight(res.movement.id);
      } catch (err) {
        setGenError(err instanceof Error ? err.message : 'Erro ao registrar lançamento.');
      } finally {
        setGenBusy(false);
      }
    }
  };

  useEffect(() => {
    if (!genericModalOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        submitGenericForm();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  // Deposit Modal handlers
  const openDepositModal = () => {
    setDepAccountId(bankAccounts[0]?.id || 0);
    setDepDate(todayIso());
    setDepAmountMask('0,00');
    setDepDesc('');
    setDepCatId('');
    setDepStatus('PENDENTE');
    setDepError('');
    setDepositOpen(true);
  };

  const submitDeposit = async (e: React.FormEvent) => {
    e.preventDefault();
    setDepError('');
    const amtCents = parseMaskInputToCents(depAmountMask);
    if (!depAccountId || !depDate || amtCents <= 0 || !depDesc.trim()) {
      setDepError('Preencha conta, data, valor positivo e descrição.');
      return;
    }
    const existingForAcc = bankMovements
      .filter((m) => m.bankAccountId === depAccountId)
      .map((m) => toIsoDateOnly(m.movementDate))
      .filter(Boolean)
      .sort();
    const isEarlierThanFirst = existingForAcc.length === 0 || depDate < existingForAcc[0];

    setDepBusy(true);
    try {
      const res = await apiFetch<{ movement: BankMovement }>('/api/finance/bank-movements', {
        method: 'POST',
        body: JSON.stringify({
          bankAccountId: depAccountId,
          movementDate: depDate,
          movementType: 'CREDITO',
          amountCents: amtCents,
          description: depDesc.trim(),
          categoryId: depCatId ? Number(depCatId) : null,
          origin: 'DEPOSITO',
          status: depStatus,
        }),
      });
      setDepositOpen(false);
      setToast(
        isEarlierThanFirst
          ? 'Depósito registrado. Saldo Inicial Atualizado na visualização cronológica.'
          : 'Depósito registrado com sucesso.'
      );
      await onReload();
      if (res?.movement?.id) triggerHighlight(res.movement.id);
    } catch (err) {
      setDepError(err instanceof Error ? err.message : 'Erro ao registrar depósito.');
    } finally {
      setDepBusy(false);
    }
  };

  // Withdraw (Saque) Modal handlers
  const openWithdrawModal = () => {
    setWdAccountId(bankAccounts[0]?.id || 0);
    setWdDate(todayIso());
    setWdAmountMask('0,00');
    setWdDesc('');
    setWdCatId('');
    setWdStatus('PENDENTE');
    setWdError('');
    setWithdrawOpen(true);
  };

  const submitWithdraw = async (e: React.FormEvent) => {
    e.preventDefault();
    setWdError('');
    const amtCents = parseMaskInputToCents(wdAmountMask);
    if (!wdAccountId || !wdDate || amtCents <= 0 || !wdDesc.trim()) {
      setWdError('Preencha conta, data, valor positivo e descrição.');
      return;
    }
    const existingForAcc = bankMovements
      .filter((m) => m.bankAccountId === wdAccountId)
      .map((m) => toIsoDateOnly(m.movementDate))
      .filter(Boolean)
      .sort();
    const isEarlierThanFirst = existingForAcc.length === 0 || wdDate < existingForAcc[0];

    setWdBusy(true);
    try {
      const res = await apiFetch<{ movement: BankMovement }>('/api/finance/bank-movements', {
        method: 'POST',
        body: JSON.stringify({
          bankAccountId: wdAccountId,
          movementDate: wdDate,
          movementType: 'DEBITO',
          amountCents: amtCents,
          description: wdDesc.trim(),
          categoryId: wdCatId ? Number(wdCatId) : null,
          origin: 'SAQUE',
          status: wdStatus,
        }),
      });
      setWithdrawOpen(false);
      setToast(
        isEarlierThanFirst
          ? 'Saque registrado. Saldo Inicial Atualizado na visualização cronológica.'
          : 'Saque registrado com sucesso.'
      );
      await onReload();
      if (res?.movement?.id) triggerHighlight(res.movement.id);
    } catch (err) {
      setWdError(err instanceof Error ? err.message : 'Erro ao registrar saque.');
    } finally {
      setWdBusy(false);
    }
  };

  // Transfer Modal handlers
  const openTransferModal = () => {
    setTrSrcId(bankAccounts[0]?.id || 0);
    setTrDstId(0);
    setTrDate(todayIso());
    setTrAmountMask('0,00');
    setTrDesc('');
    setTrCatId('');
    setTrStatus('PENDENTE');
    setTrError('');
    setTransferOpen(true);
  };

  const submitTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    setTrError('');
    const amtCents = parseMaskInputToCents(trAmountMask);
    if (!trSrcId || !trDstId) {
      setTrError('Selecione conta de origem e conta de destino.');
      return;
    }
    if (trSrcId === trDstId) {
      setTrError('A conta de destino deve ser diferente da conta de origem.');
      return;
    }
    if (!trDate || amtCents <= 0 || !trDesc.trim()) {
      setTrError('Informe data, valor positivo e descrição.');
      return;
    }
    setTrBusy(true);
    try {
      const res = await apiFetch<{ debitMovement: BankMovement; creditMovement: BankMovement }>(
        '/api/finance/bank-movements/transfer',
        {
          method: 'POST',
          body: JSON.stringify({
            sourceAccountId: trSrcId,
            destinationAccountId: trDstId,
            movementDate: trDate,
            amountCents: amtCents,
            description: trDesc.trim(),
            categoryId: trCatId ? Number(trCatId) : null,
            status: trStatus,
          }),
        }
      );
      setTransferOpen(false);
      setToast('Transferência realizada: 2 lançamentos (débito na origem e crédito no destino) criados.');
      await onReload();
      if (res?.debitMovement?.id) triggerHighlight(res.debitMovement.id);
    } catch (err) {
      setTrError(err instanceof Error ? err.message : 'Erro ao registrar transferência.');
    } finally {
      setTrBusy(false);
    }
  };

  // Delete confirmation
  const confirmDeleteMovement = async () => {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    setDeleteError('');
    try {
      await apiFetch(`/api/finance/bank-movements/${deleteTarget.id}`, { method: 'DELETE' });
      setDeleteTarget(null);
      setToast('Lançamento excluído permanentemente.');
      await onReload();
    } catch {
      setDeleteError('Não foi possível excluir o lançamento.');
    } finally {
      setDeleteBusy(false);
    }
  };

  const genCategoriesList = genType === 'CREDITO' ? analyticRevenues : analyticExpenses;

  return (
    <div className="space-y-4">
      {/* Header: Account Selector & Live Account Balance + Action Bar */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 flex-1 min-w-0">
            <div className="min-w-[240px] sm:max-w-xs w-full">
              <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                Conta Corrente
              </label>
              <select
                value={selectedAccountId}
                onChange={(e) => setSelectedAccountId(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-900"
              >
                <option value="all">Todas as Contas</option>
                {bankAccounts.map((acc) => (
                  <option key={acc.id} value={String(acc.id)}>
                    {formatAccountLabel(acc)}
                  </option>
                ))}
              </select>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 min-w-[220px]">
              <div className="text-[11px] font-medium text-slate-500">
                {selectedAccountId === 'all'
                  ? 'Saldo Total (Todas as Contas)'
                  : 'Saldo Atual da Conta'}
              </div>
              <div
                className={`mt-0.5 font-mono text-lg font-bold tabular-nums ${
                  movementsWithAccumulated.headerBalanceCents >= 0
                    ? 'text-emerald-700'
                    : 'text-red-600'
                }`}
              >
                {formatSignedBRL(movementsWithAccumulated.headerBalanceCents)}
              </div>
            </div>
          </div>

          {/* Barra de ações (Seção 2.1) */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setFiltersOpen((prev) => !prev)}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors whitespace-nowrap ${
                filtersOpen
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              <Filter className="w-3.5 h-3.5" />
              {filtersOpen ? 'Ocultar Filtros' : 'Mostrar Filtros'}
            </button>
            <button
              type="button"
              onClick={openDepositModal}
              disabled={bankAccounts.length === 0}
              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 whitespace-nowrap disabled:opacity-50"
            >
              <ArrowDownCircle className="w-3.5 h-3.5" />
              Depósito
            </button>
            <button
              type="button"
              onClick={openWithdrawModal}
              disabled={bankAccounts.length === 0}
              className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900 hover:bg-amber-100 whitespace-nowrap disabled:opacity-50"
            >
              <ArrowUpCircle className="w-3.5 h-3.5" />
              Saque
            </button>
            <button
              type="button"
              onClick={openTransferModal}
              disabled={bankAccounts.length < 2}
              className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-800 hover:bg-blue-100 whitespace-nowrap disabled:opacity-50"
            >
              <ArrowLeftRight className="w-3.5 h-3.5" />
              Transferência
            </button>
            <button
              type="button"
              onClick={openGenericNewModal}
              disabled={bankAccounts.length === 0}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800 whitespace-nowrap disabled:opacity-50"
            >
              <Plus className="w-3.5 h-3.5 text-emerald-400" />
              Novo Lançamento
            </button>
          </div>
        </div>

        {/* Collapsible Filters Panel (Seção 2.4) */}
        {filtersOpen && (
          <div className="pt-3 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 text-xs">
            <div>
              <label className="block font-semibold text-slate-600 mb-1">De</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 font-mono"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-600 mb-1">Até</label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 font-mono"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-600 mb-1">Tipo</label>
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value as any)}
                className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5"
              >
                <option value="ALL">Todos</option>
                <option value="CREDITO">Crédito</option>
                <option value="DEBITO">Débito</option>
              </select>
            </div>
            <div>
              <label className="block font-semibold text-slate-600 mb-1">Origem</label>
              <select
                value={originFilter}
                onChange={(e) => setOriginFilter(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5"
              >
                <option value="ALL">Todos</option>
                <option value="BAIXA_RECEBER">Baixa Receber</option>
                <option value="BAIXA_PAGAR">Baixa Pagar</option>
                <option value="MANUAL">Manual</option>
                <option value="TARIFA">Tarifa</option>
                <option value="TRANSFERENCIA">Transferência</option>
                <option value="DEPOSITO">Depósito</option>
                <option value="SAQUE">Saque</option>
              </select>
            </div>
            <div>
              <label className="block font-semibold text-slate-600 mb-1">Status</label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5"
              >
                <option value="ALL">Todos</option>
                <option value="CONCILIADO">Conciliado</option>
                <option value="PENDENTE">Pendente</option>
              </select>
            </div>
            <div>
              <label className="block font-semibold text-slate-600 mb-1">Pesquisar</label>
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" />
                <input
                  type="text"
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  placeholder="Descrição ou documento..."
                  className="w-full rounded-lg border border-slate-200 pl-8 pr-2.5 py-1.5"
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {toast && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-medium text-emerald-900 flex items-center justify-between">
          <span>{toast}</span>
          <button type="button" onClick={() => setToast('')}>
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {errorBanner && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-xs font-medium text-red-900 flex items-center justify-between">
          <span>{errorBanner}</span>
          <button type="button" onClick={() => setErrorBanner('')}>
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Indicadores do Período (Seção 2.3) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-[11px] font-medium text-slate-500">Total Entradas</div>
          <div className="mt-1 font-mono text-lg font-bold text-emerald-700 tabular-nums">
            {formatBRL(periodSummary.entries)}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-[11px] font-medium text-slate-500">Total Saídas</div>
          <div className="mt-1 font-mono text-lg font-bold text-red-600 tabular-nums">
            {formatSignedBRL(-periodSummary.exits)}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-[11px] font-medium text-slate-500">Saldo Período</div>
          <div
            className={`mt-1 font-mono text-lg font-bold tabular-nums ${
              periodSummary.periodBalance >= 0 ? 'text-slate-900' : 'text-red-600'
            }`}
          >
            {formatSignedBRL(periodSummary.periodBalance)}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-[11px] font-medium text-slate-500">Quantidade de movimentos</div>
          <div className="mt-1 font-mono text-lg font-bold text-blue-700 tabular-nums">
            {periodSummary.count} registro(s)
          </div>
        </div>
      </div>

      {/* Data Grid (Seção 3) */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="overflow-x-auto max-h-[540px] overflow-y-auto scroll-rulers">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-[11px] font-semibold text-slate-600 border-b border-slate-200 sticky top-0 z-10">
              <tr>
                {(
                  [
                    ['movementDate', 'Data'],
                    ['description', 'Descrição'],
                    ['documentNumber', 'Documento'],
                    ['origin', 'Origem'],
                    ['entrada', 'Entrada'],
                    ['saida', 'Saída'],
                  ] as Array<[SortField, string]>
                ).map(([field, label]) => (
                  <th
                    key={field}
                    tabIndex={0}
                    role="button"
                    onClick={() => handleSortToggle(field)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleSortToggle(field);
                      }
                    }}
                    className={`px-3 py-3 cursor-pointer select-none hover:bg-slate-100 whitespace-nowrap ${
                      field === 'entrada' || field === 'saida' ? 'text-right' : ''
                    }`}
                  >
                    {label}
                    {renderSortIcon(field)}
                  </th>
                ))}
                <th className="px-3 py-3 text-right whitespace-nowrap">Saldo Acumulado</th>
                <th
                  tabIndex={0}
                  role="button"
                  onClick={() => handleSortToggle('status')}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleSortToggle('status');
                    }
                  }}
                  className="px-3 py-3 cursor-pointer select-none hover:bg-slate-100 whitespace-nowrap"
                >
                  Status
                  {renderSortIcon('status')}
                </th>
                <th className="px-3 py-3 text-right whitespace-nowrap">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sortedRows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-10 text-center text-slate-500">
                    Nenhuma movimentação encontrada para o período selecionado.
                  </td>
                </tr>
              ) : (
                sortedRows.map((row) => {
                  const isLinked = Boolean(row.titleId && row.titleSource);
                  const isHighlighted = highlightedId === row.id;
                  const originLabel = ORIGIN_LABELS[String(row.origin || 'MANUAL').toUpperCase()] || row.origin;
                  return (
                    <tr
                      key={row.id}
                      ref={(el) => {
                        rowRefs.current[row.id] = el;
                      }}
                      className={`transition-colors ${
                        isHighlighted ? 'bg-blue-100/80' : 'hover:bg-slate-50'
                      }`}
                    >
                      <td className="px-3 py-2.5 font-mono text-slate-700 whitespace-nowrap">
                        {formatIsoDateToBR(row.isoDate)}
                      </td>
                      <td className="px-3 py-2.5 font-medium text-slate-900 max-w-[260px]">
                        <div className="flex items-center gap-1.5">
                          {isLinked && (
                            <span
                              title={`Vinculado a Título (${row.titleSource})`}
                              className="text-blue-600 shrink-0"
                            >
                              <Link2 className="w-3.5 h-3.5" />
                            </span>
                          )}
                          <span className="truncate" title={row.description}>
                            {row.description}
                          </span>
                        </div>
                        {row.categoryName && (
                          <div className="text-[10px] text-slate-400 truncate">{row.categoryName}</div>
                        )}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-slate-600 whitespace-nowrap">
                        {row.documentNumber || '-'}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <span className="inline-block rounded bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-700">
                          {originLabel}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 font-mono font-semibold text-emerald-700 text-right tabular-nums whitespace-nowrap">
                        {row.movementType === 'CREDITO' ? formatBRL(row.amountCents) : '-'}
                      </td>
                      <td className="px-3 py-2.5 font-mono font-semibold text-red-600 text-right tabular-nums whitespace-nowrap">
                        {row.movementType === 'DEBITO' ? formatSignedBRL(-row.amountCents) : '-'}
                      </td>
                      <td
                        className={`px-3 py-2.5 font-mono font-bold text-right tabular-nums whitespace-nowrap ${
                          row.accumulatedBalanceCents >= 0 ? 'text-slate-900' : 'text-red-600'
                        }`}
                      >
                        {formatSignedBRL(row.accumulatedBalanceCents)}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <span
                          className={`inline-block rounded px-2 py-0.5 text-[10px] font-bold ${
                            row.status === 'CONCILIADO'
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {row.status === 'CONCILIADO' ? 'Conciliado' : 'Pendente'}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => openEditRow(row)}
                            title={isLinked ? 'Lançamento vinculado' : 'Editar lançamento'}
                            className="text-blue-700 hover:text-blue-900 p-1"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => openDeleteRow(row)}
                            title={isLinked ? 'Lançamento vinculado' : 'Excluir lançamento'}
                            className="text-red-600 hover:text-red-800 p-1"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                          {isLinked && onNavigate && (
                            <button
                              type="button"
                              onClick={() => onNavigate('finance_operacao')}
                              title="Ver título no Financeiro"
                              className="text-indigo-600 hover:text-indigo-900 p-1"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setAuditTarget(row)}
                            title="Histórico de Auditoria"
                            className="text-slate-500 hover:text-slate-900 p-1"
                          >
                            <History className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
            {sortedRows.length > 0 && (
              <tfoot className="bg-slate-50 border-t border-slate-200 font-mono text-xs font-bold text-slate-900">
                <tr>
                  <td colSpan={4} className="px-3 py-3 text-right font-sans text-slate-600">
                    Totais do Período ({periodSummary.count} movimentos):
                  </td>
                  <td className="px-3 py-3 text-right text-emerald-700 tabular-nums">
                    {formatBRL(periodSummary.entries)}
                  </td>
                  <td className="px-3 py-3 text-right text-red-600 tabular-nums">
                    {formatSignedBRL(-periodSummary.exits)}
                  </td>
                  <td
                    className={`px-3 py-3 text-right tabular-nums ${
                      periodSummary.periodBalance >= 0 ? 'text-slate-900' : 'text-red-600'
                    }`}
                  >
                    {formatSignedBRL(periodSummary.periodBalance)}
                  </td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* ================= MODAL 1: NOVO / EDITAR LANÇAMENTO (Seção 4) ================= */}
      {genericModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4"
          onClick={() => setGenericModalOpen(false)}
        >
          <div
            className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl space-y-4 text-xs"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-display text-base font-bold text-slate-900">
                {editingMovement ? 'Editar Lançamento' : 'Novo Lançamento'}
              </h3>
              <button
                type="button"
                onClick={() => setGenericModalOpen(false)}
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {genError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-700 font-medium">
                {genError}
              </div>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                submitGenericForm();
              }}
              className="space-y-4"
            >
              {/* Dados do Lançamento */}
              <div className="space-y-3">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  Dados do Lançamento
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="sm:col-span-2">
                    <label className="block font-semibold text-slate-700 mb-1">Conta Corrente *</label>
                    <select
                      required
                      value={genAccountId}
                      onChange={(e) => setGenAccountId(Number(e.target.value))}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2"
                    >
                      <option value={0}>Selecione...</option>
                      {bankAccounts.map((acc) => (
                        <option key={acc.id} value={acc.id}>
                          {formatAccountLabel(acc)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Data *</label>
                    <input
                      type="date"
                      required
                      value={genDate}
                      onChange={(e) => setGenDate(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Tipo *</label>
                    <select
                      value={genType}
                      onChange={(e) => {
                        setGenType(e.target.value as 'CREDITO' | 'DEBITO');
                        setGenCategoryId('');
                      }}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 font-semibold"
                    >
                      <option value="DEBITO">Débito (Saída)</option>
                      <option value="CREDITO">Crédito (Entrada)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Valor (R$) *</label>
                    <input
                      type="text"
                      required
                      value={genAmountMask}
                      onChange={(e) => setGenAmountMask(formatCurrencyTyping(e.target.value))}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono font-bold text-right"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Nº Documento</label>
                    <input
                      type="text"
                      value={genDoc}
                      onChange={(e) => setGenDoc(e.target.value)}
                      placeholder="Opcional"
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block font-semibold text-slate-700 mb-1">Descrição *</label>
                    <input
                      type="text"
                      required
                      value={genDesc}
                      onChange={(e) => setGenDesc(e.target.value)}
                      placeholder="Ex: Tarifa bancária mensal"
                      className="w-full rounded-lg border border-slate-200 px-3 py-2"
                    />
                  </div>
                </div>
              </div>

              {/* Classificação */}
              <div className="space-y-3 pt-2 border-t border-slate-100">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  Classificação
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="sm:col-span-3">
                    <label className="block font-semibold text-slate-700 mb-1">
                      Categoria (Plano de Contas) *
                    </label>
                    <select
                      required
                      value={genCategoryId}
                      onChange={(e) => setGenCategoryId(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2"
                    >
                      <option value="">
                        Selecione ({genType === 'CREDITO' ? 'Receitas analíticas' : 'Despesas analíticas'})...
                      </option>
                      {genCategoriesList.map((cat) => (
                        <option key={cat.id} value={String(cat.id)}>
                          {cat.code} - {cat.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block font-semibold text-slate-700 mb-1">Origem</label>
                    <select
                      value={genOrigin}
                      onChange={(e) => setGenOrigin(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2"
                    >
                      <option value="MANUAL">Manual</option>
                      <option value="TARIFA">Tarifa</option>
                      <option value="TRANSFERENCIA">Transferência</option>
                      {editingMovement && genOrigin === 'DEPOSITO' && (
                        <option value="DEPOSITO">Depósito</option>
                      )}
                      {editingMovement && genOrigin === 'SAQUE' && (
                        <option value="SAQUE">Saque</option>
                      )}
                    </select>
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Status</label>
                    <select
                      value={genStatus}
                      onChange={(e) => setGenStatus(e.target.value as 'PENDENTE' | 'CONCILIADO')}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2"
                    >
                      <option value="PENDENTE">Pendente</option>
                      <option value="CONCILIADO">Conciliado</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between pt-3 border-t border-slate-100">
                <span className="text-[10px] text-slate-400">Atalho: Ctrl+Enter para salvar</span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={genBusy}
                    onClick={() => setGenericModalOpen(false)}
                    className="rounded-lg border border-slate-200 px-4 py-2 font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={genBusy}
                    className="rounded-lg bg-emerald-600 px-4 py-2 font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {genBusy ? 'Salvando...' : 'Salvar'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================= MODAL 2: DEPÓSITO (Seção 5) ================= */}
      {depositOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl space-y-4 text-xs">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-display text-base font-bold text-slate-900">Depósito</h3>
              <button type="button" onClick={() => setDepositOpen(false)} className="text-slate-400 hover:text-slate-700">
                <X className="w-4 h-4" />
              </button>
            </div>
            {depError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-700 font-medium">
                {depError}
              </div>
            )}
            <form onSubmit={submitDeposit} className="space-y-3">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Conta *</label>
                <select
                  required
                  value={depAccountId}
                  onChange={(e) => setDepAccountId(Number(e.target.value))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2"
                >
                  {bankAccounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {formatAccountLabel(acc)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Data *</label>
                  <input
                    type="date"
                    required
                    value={depDate}
                    onChange={(e) => setDepDate(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Valor (R$) *</label>
                  <input
                    type="text"
                    required
                    value={depAmountMask}
                    onChange={(e) => setDepAmountMask(formatCurrencyTyping(e.target.value))}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono font-bold text-right"
                  />
                </div>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Descrição *</label>
                <input
                  type="text"
                  required
                  value={depDesc}
                  onChange={(e) => setDepDesc(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Categoria (Plano de Contas — opcional)
                </label>
                <select
                  value={depCatId}
                  onChange={(e) => setDepCatId(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2"
                >
                  <option value="">Sem seleção</option>
                  {analyticRevenues.map((cat) => (
                    <option key={cat.id} value={String(cat.id)}>
                      {cat.code} - {cat.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Status</label>
                <select
                  value={depStatus}
                  onChange={(e) => setDepStatus(e.target.value as 'PENDENTE' | 'CONCILIADO')}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2"
                >
                  <option value="PENDENTE">Pendente</option>
                  <option value="CONCILIADO">Conciliado</option>
                </select>
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setDepositOpen(false)}
                  className="rounded-lg border border-slate-200 px-4 py-2 font-semibold text-slate-700"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={depBusy}
                  className="rounded-lg bg-emerald-600 px-4 py-2 font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {depBusy ? 'Registrando...' : 'Registrar Depósito'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================= MODAL 3: SAQUE (Seção 6) ================= */}
      {withdrawOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl space-y-4 text-xs">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-display text-base font-bold text-slate-900">Saque</h3>
              <button type="button" onClick={() => setWithdrawOpen(false)} className="text-slate-400 hover:text-slate-700">
                <X className="w-4 h-4" />
              </button>
            </div>
            {wdError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-700 font-medium">
                {wdError}
              </div>
            )}
            <form onSubmit={submitWithdraw} className="space-y-3">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Conta *</label>
                <select
                  required
                  value={wdAccountId}
                  onChange={(e) => setWdAccountId(Number(e.target.value))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2"
                >
                  {bankAccounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {formatAccountLabel(acc)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Data *</label>
                  <input
                    type="date"
                    required
                    value={wdDate}
                    onChange={(e) => setWdDate(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Valor (R$) *</label>
                  <input
                    type="text"
                    required
                    value={wdAmountMask}
                    onChange={(e) => setWdAmountMask(formatCurrencyTyping(e.target.value))}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono font-bold text-right"
                  />
                </div>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Descrição *</label>
                <input
                  type="text"
                  required
                  value={wdDesc}
                  onChange={(e) => setWdDesc(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Categoria (Plano de Contas — opcional)
                </label>
                <select
                  value={wdCatId}
                  onChange={(e) => setWdCatId(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2"
                >
                  <option value="">Sem seleção</option>
                  {analyticExpenses.map((cat) => (
                    <option key={cat.id} value={String(cat.id)}>
                      {cat.code} - {cat.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Status</label>
                <select
                  value={wdStatus}
                  onChange={(e) => setWdStatus(e.target.value as 'PENDENTE' | 'CONCILIADO')}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2"
                >
                  <option value="PENDENTE">Pendente</option>
                  <option value="CONCILIADO">Conciliado</option>
                </select>
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setWithdrawOpen(false)}
                  className="rounded-lg border border-slate-200 px-4 py-2 font-semibold text-slate-700"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={wdBusy}
                  className="rounded-lg bg-amber-600 px-4 py-2 font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
                >
                  {wdBusy ? 'Registrando...' : 'Registrar Saque'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================= MODAL 4: TRANSFERÊNCIA ENTRE CONTAS (Seção 7) ================= */}
      {transferOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl space-y-4 text-xs">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-display text-base font-bold text-slate-900">
                Transferência entre Contas
              </h3>
              <button type="button" onClick={() => setTransferOpen(false)} className="text-slate-400 hover:text-slate-700">
                <X className="w-4 h-4" />
              </button>
            </div>
            {trError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-700 font-medium">
                {trError}
              </div>
            )}
            <form onSubmit={submitTransfer} className="space-y-3">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Conta de Origem (Débito) *
                </label>
                <select
                  required
                  value={trSrcId}
                  onChange={(e) => {
                    const nextSrc = Number(e.target.value);
                    setTrSrcId(nextSrc);
                    if (trDstId === nextSrc) setTrDstId(0);
                  }}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2"
                >
                  {bankAccounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {formatAccountLabel(acc)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Conta de Destino (Crédito) *
                </label>
                <select
                  required
                  value={trDstId}
                  onChange={(e) => setTrDstId(Number(e.target.value))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2"
                >
                  <option value={0}>Selecione a conta de destino...</option>
                  {bankAccounts
                    .filter((acc) => acc.id !== trSrcId)
                    .map((acc) => (
                      <option key={acc.id} value={acc.id}>
                        {formatAccountLabel(acc)}
                      </option>
                    ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Data *</label>
                  <input
                    type="date"
                    required
                    value={trDate}
                    onChange={(e) => setTrDate(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Valor (R$) *</label>
                  <input
                    type="text"
                    required
                    value={trAmountMask}
                    onChange={(e) => setTrAmountMask(formatCurrencyTyping(e.target.value))}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono font-bold text-right"
                  />
                </div>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Descrição *</label>
                <input
                  type="text"
                  required
                  value={trDesc}
                  onChange={(e) => setTrDesc(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Categoria (Plano de Contas — opcional)
                </label>
                <select
                  value={trCatId}
                  onChange={(e) => setTrCatId(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2"
                >
                  <option value="">Sem seleção</option>
                  {analyticExpenses.map((cat) => (
                    <option key={cat.id} value={String(cat.id)}>
                      {cat.code} - {cat.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Status</label>
                <select
                  value={trStatus}
                  onChange={(e) => setTrStatus(e.target.value as 'PENDENTE' | 'CONCILIADO')}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2"
                >
                  <option value="PENDENTE">Pendente</option>
                  <option value="CONCILIADO">Conciliado</option>
                </select>
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setTransferOpen(false)}
                  className="rounded-lg border border-slate-200 px-4 py-2 font-semibold text-slate-700"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={trBusy}
                  className="rounded-lg bg-blue-700 px-4 py-2 font-semibold text-white hover:bg-blue-800 disabled:opacity-50"
                >
                  {trBusy ? 'Processando...' : 'Confirmar Transferência'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================= MODAL 5: LANÇAMENTO VINCULADO (Seção 8.1) ================= */}
      {linkedTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4"
          onClick={() => setLinkedTarget(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl space-y-4 text-xs"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div className="h-9 w-9 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center shrink-0">
                <Link2 className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 className="font-display text-sm font-bold text-slate-900">Lançamento Vinculado</h3>
                <p className="text-slate-600 leading-relaxed">
                  Este lançamento foi gerado automaticamente pela baixa de um título em{' '}
                  <strong>
                    {linkedTarget.titleSource === 'PAGAR' ? 'Contas a Pagar' : 'Contas a Receber'}
                  </strong>
                  . Para alterá-lo ou removê-lo, localize o título original e cancele a baixa.
                </p>
              </div>
            </div>

            <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 space-y-1.5">
              <div>
                <span className="text-slate-500">Descrição:</span>{' '}
                <strong className="text-slate-900">{linkedTarget.description}</strong>
              </div>
              <div>
                <span className="text-slate-500">Data:</span>{' '}
                <strong className="font-mono text-slate-900">
                  {formatIsoDateToBR(toIsoDateOnly(linkedTarget.movementDate))}
                </strong>
              </div>
              <div>
                <span className="text-slate-500">Valor:</span>{' '}
                <strong className="font-mono text-slate-900">
                  {formatBRL(linkedTarget.amountCents)}
                </strong>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              {onNavigate && (
                <button
                  type="button"
                  onClick={() => {
                    const targetScopeMod: ModuleId =
                      linkedTarget.titleSource === 'PAGAR' ? 'finance_pagar' : 'finance_receber';
                    const targetTitleId = linkedTarget.titleId || undefined;
                    setLinkedTarget(null);
                    onNavigate(targetScopeMod, { titleId: targetTitleId });
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3.5 py-2 font-semibold text-blue-800 hover:bg-blue-100"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Ver Título
                </button>
              )}
              <button
                type="button"
                onClick={() => setLinkedTarget(null)}
                className="rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white hover:bg-slate-800"
              >
                Entendido
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================= MODAL 6: CONFIRMAR EXCLUSÃO (Seção 8.2) ================= */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl space-y-4 text-xs">
            <div className="flex items-start gap-3">
              <div className="h-9 w-9 rounded-xl bg-red-100 text-red-700 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 className="font-display text-sm font-bold text-slate-900">Confirmar Exclusão</h3>
                <p className="text-slate-600 leading-relaxed">
                  A exclusão deste lançamento é permanente e não pode ser desfeita.
                </p>
              </div>
            </div>

            <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 space-y-1.5">
              <div>
                <span className="text-slate-500">Descrição:</span>{' '}
                <strong className="text-slate-900">{deleteTarget.description}</strong>
              </div>
              <div>
                <span className="text-slate-500">Data:</span>{' '}
                <strong className="font-mono text-slate-900">
                  {formatIsoDateToBR(toIsoDateOnly(deleteTarget.movementDate))}
                </strong>
              </div>
              <div>
                <span className="text-slate-500">Tipo:</span>{' '}
                <strong className="text-slate-900">
                  {String(deleteTarget.movementType).toUpperCase() === 'CREDITO' ? 'Entrada' : 'Saída'}
                </strong>
              </div>
              <div>
                <span className="text-slate-500">Valor:</span>{' '}
                <strong className="font-mono text-slate-900">
                  {formatBRL(deleteTarget.amountCents)}
                </strong>
              </div>
            </div>

            {deleteError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-700 font-medium">
                {deleteError}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                disabled={deleteBusy}
                onClick={() => setDeleteTarget(null)}
                className="rounded-lg border border-slate-200 px-4 py-2 font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={deleteBusy}
                onClick={confirmDeleteMovement}
                className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
                {deleteBusy ? 'Excluindo...' : 'Excluir'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================= MODAL 7: HISTÓRICO DE MOVIMENTAÇÕES (Seção 8.3) ================= */}
      <MovementAuditModal
        open={Boolean(auditTarget)}
        movementId={auditTarget?.id || null}
        movementDescription={auditTarget?.description || ''}
        onClose={() => setAuditTarget(null)}
      />
    </div>
  );
};
