import React, { useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  Eraser,
  FileSpreadsheet,
  History,
  Plus,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import { apiFetch, formatBRL } from '../../../lib/api.ts';
import { BankAccount, BankMovement, ChartAccountItem } from '../../../types.ts';
import { EntityAuditModal } from '../cadastros/CadastrosShared.tsx';
import {
  centsToMaskInput,
  formatCurrencyTyping,
  formatIsoDateToBR,
  formatSignedBRL,
  ImportedStatementRow,
  parseMaskInputToCents,
  parseOfxText,
  parseXlsxBuffer,
  toIsoDateOnly,
} from './currencyAndParsers.ts';

interface BankReconciliationManagerProps {
  bankAccounts: BankAccount[];
  bankMovements: BankMovement[];
  chartOfAccounts: ChartAccountItem[];
  onReload: () => Promise<void>;
}

function formatAccountLabel(acc: BankAccount): string {
  const parts = [acc.bankName];
  if (acc.agency) parts.push(`Ag ${acc.agency}`);
  if (acc.accountNumber) parts.push(`CC ${acc.accountNumber}`);
  return parts.join(' · ');
}

export const BankReconciliationManager: React.FC<BankReconciliationManagerProps> = ({
  bankAccounts,
  bankMovements,
  chartOfAccounts,
  onReload,
}) => {
  const [selectedAccountId, setSelectedAccountId] = useState<string>('');
  const [periodFrom, setPeriodFrom] = useState('');
  const [periodTo, setPeriodTo] = useState('');
  const [reconciliationDate, setReconciliationDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [compensationDate, setCompensationDate] = useState('');

  // Imported statement rows (local state per Section 11.4)
  const [statementRows, setStatementRows] = useState<ImportedStatementRow[]>([]);
  const [importedFileName, setImportedFileName] = useState('');
  const [selectedStatementIds, setSelectedStatementIds] = useState<string[]>([]);
  const [selectedMovementIds, setSelectedMovementIds] = useState<number[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [auditTarget, setAuditTarget] = useState<{
    title: string;
    entityType: string;
    entityId: number | string;
  } | null>(null);

  // Modal: Novo / Editar Lançamento (Seção 16)
  const [entryModalOpen, setEntryModalOpen] = useState(false);
  const [editingMovement, setEditingMovement] = useState<BankMovement | null>(null);
  const [entryDate, setEntryDate] = useState('');
  const [entryType, setEntryType] = useState<'DEBITO' | 'CREDITO'>('DEBITO');
  const [entryAmountMask, setEntryAmountMask] = useState('0,00');
  const [entryDesc, setEntryDesc] = useState('');
  const [entryDoc, setEntryDoc] = useState('');
  const [entryStatus, setEntryStatus] = useState<'PENDENTE' | 'CONCILIADO'>('PENDENTE');
  const [entryCategoryId, setEntryCategoryId] = useState('');
  const [entryBusy, setEntryBusy] = useState(false);
  const [entryError, setEntryError] = useState('');

  const selectedAccount = useMemo(
    () => bankAccounts.find((a) => String(a.id) === selectedAccountId) || null,
    [bankAccounts, selectedAccountId]
  );

  const analyticRevenues = useMemo(
    () => chartOfAccounts.filter((c) => c.active !== false && c.isAnalytic && c.type === 'receita'),
    [chartOfAccounts]
  );
  const analyticExpenses = useMemo(
    () => chartOfAccounts.filter((c) => c.active !== false && c.isAnalytic && c.type === 'despesa'),
    [chartOfAccounts]
  );

  // Filtered statement rows (Left Grid)
  const filteredStatement = useMemo(() => {
    return statementRows.filter((row) => {
      if (periodFrom && row.date && row.date < periodFrom) return false;
      if (periodTo && row.date && row.date > periodTo) return false;
      return true;
    });
  }, [statementRows, periodFrom, periodTo]);

  // Filtered system movements (Right Grid, ordered by movementDate asc per Section 12.2)
  const filteredMovements = useMemo(() => {
    if (!selectedAccountId) return [];
    return bankMovements
      .filter((m) => String(m.bankAccountId) === selectedAccountId)
      .map((m) => ({
        ...m,
        isoDate: toIsoDateOnly(m.movementDate),
        normType: (
          String(m.movementType).toUpperCase() === 'CREDITO' ||
          String(m.movementType).toUpperCase() === 'ENTRADA'
            ? 'CREDITO'
            : 'DEBITO'
        ) as 'CREDITO' | 'DEBITO',
      }))
      .filter((m) => {
        if (periodFrom && m.isoDate && m.isoDate < periodFrom) return false;
        if (periodTo && m.isoDate && m.isoDate > periodTo) return false;
        return true;
      })
      .sort((a, b) => {
        if (a.isoDate !== b.isoDate) return a.isoDate.localeCompare(b.isoDate);
        return a.id - b.id;
      });
  }, [bankMovements, selectedAccountId, periodFrom, periodTo]);

  // Totals for Left Grid (Extrato)
  const statementTotals = useMemo(() => {
    let entries = 0;
    let exits = 0;
    let reconciledSigned = 0;
    for (const r of filteredStatement) {
      if (r.type === 'CREDITO') entries += r.amountCents;
      else exits += r.amountCents;
      if (r.matched) {
        reconciledSigned += r.type === 'CREDITO' ? r.amountCents : -r.amountCents;
      }
    }
    return {
      entries,
      exits,
      movedBalance: entries - exits,
      reconciledBalance: reconciledSigned,
    };
  }, [filteredStatement]);

  // Totals for Right Grid (Sistema)
  const systemTotals = useMemo(() => {
    let entries = 0;
    let exits = 0;
    let reconciledSigned = 0;
    for (const m of filteredMovements) {
      if (m.normType === 'CREDITO') entries += m.amountCents;
      else exits += m.amountCents;
      if (m.reconciled) {
        reconciledSigned += m.normType === 'CREDITO' ? m.amountCents : -m.amountCents;
      }
    }
    return {
      entries,
      exits,
      movedBalance: entries - exits,
      reconciledBalance: reconciledSigned,
    };
  }, [filteredMovements]);

  // File Import (Section 11)
  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setErrorMsg('');
    setToast('');
    const lower = file.name.toLowerCase();
    setImportedFileName(file.name);

    try {
      if (lower.endsWith('.xls')) {
        throw new Error(
          'Formato .xls antigo não suportado diretamente. Por favor, salve a planilha como .xlsx e tente novamente.'
        );
      }
      if (lower.endsWith('.ofx')) {
        const text = await file.text();
        const rows = parseOfxText(text);
        setStatementRows(rows);
        setSelectedStatementIds([]);
        setToast(`Extrato OFX importado: ${rows.length} lançamento(s) carregado(s).`);
      } else if (lower.endsWith('.xlsx')) {
        const buf = await file.arrayBuffer();
        const rows = parseXlsxBuffer(buf);
        setStatementRows(rows);
        setSelectedStatementIds([]);
        setToast(`Extrato XLSX importado: ${rows.length} lançamento(s) carregado(s).`);
      } else {
        throw new Error('Formato não suportado. Apenas arquivos .xlsx ou .ofx são suportados.');
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao analisar arquivo de extrato.');
    }
  };

  const handleClearStatement = () => {
    setStatementRows([]);
    setImportedFileName('');
    setSelectedStatementIds([]);
    setToast('Extrato local limpo.');
  };

  // Manual Reconcile (Section 13)
  const totalSelectedCount = selectedStatementIds.length + selectedMovementIds.length;

  const handleManualReconcile = async () => {
    setErrorMsg('');
    if (totalSelectedCount === 0) return;
    if (!reconciliationDate) {
      setErrorMsg('Informe a Data Conciliação antes de conciliar.');
      return;
    }

    if (selectedStatementIds.length > 0) {
      setStatementRows((prev) =>
        prev.map((row) =>
          selectedStatementIds.includes(row.localId) ? { ...row, matched: true } : row
        )
      );
    }

    if (selectedMovementIds.length > 0) {
      setBusy(true);
      try {
        await apiFetch('/api/finance/bank-movements/reconcile', {
          method: 'POST',
          body: JSON.stringify({
            movementIds: selectedMovementIds,
            reconciled: true,
            reconciliationDate,
            compensationDate,
          }),
        });
        await onReload();
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : 'Erro ao conciliar movimentos.');
      } finally {
        setBusy(false);
      }
    }

    setToast(`${totalSelectedCount} item(ns) marcado(s) como conciliado(s).`);
    setSelectedStatementIds([]);
    setSelectedMovementIds([]);
  };

  // Auto-Reconcile (Section 14.1: exact same date, same type, abs diff < 2 cents)
  const handleAutoReconcile = async () => {
    setErrorMsg('');
    if (statementRows.length === 0 || filteredMovements.length === 0) {
      setErrorMsg('Importe um extrato e tenha movimentos disponíveis na conta para Auto-Conciliar.');
      return;
    }

    const usedMovIds = new Set<number>();
    const matchedStmtMap = new Map<string, number>();

    for (const stmt of statementRows) {
      if (stmt.matched) continue;
      const match = filteredMovements.find(
        (mov) =>
          !mov.reconciled &&
          !usedMovIds.has(mov.id) &&
          mov.isoDate === stmt.date &&
          mov.normType === stmt.type &&
          Math.abs(mov.amountCents - stmt.amountCents) < 2
      );
      if (match) {
        usedMovIds.add(match.id);
        matchedStmtMap.set(stmt.localId, match.id);
      }
    }

    if (matchedStmtMap.size === 0) {
      setToast('Nenhum par exato (mesma data, tipo e diferença menor que R$ 0,02) encontrado.');
      return;
    }

    setStatementRows((prev) =>
      prev.map((row) =>
        matchedStmtMap.has(row.localId)
          ? { ...row, matched: true, matchedMovementId: matchedStmtMap.get(row.localId) }
          : row
      )
    );

    const movIdsToUpdate = Array.from(usedMovIds);
    setBusy(true);
    try {
      await apiFetch('/api/finance/bank-movements/reconcile', {
        method: 'POST',
        body: JSON.stringify({
          movementIds: movIdsToUpdate,
          reconciled: true,
          reconciliationDate: reconciliationDate || new Date().toISOString().slice(0, 10),
          compensationDate,
        }),
      });
      await onReload();
      setToast(`${matchedStmtMap.size} par(es) conciliado(s) automaticamente.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro na auto-conciliação.');
    } finally {
      setBusy(false);
    }
  };

  // Unreconcile System Movement (Section 14.2)
  const handleUnreconcileMovement = async (movId: number) => {
    setBusy(true);
    setErrorMsg('');
    try {
      await apiFetch('/api/finance/bank-movements/reconcile', {
        method: 'POST',
        body: JSON.stringify({
          movementIds: [movId],
          reconciled: false,
        }),
      });
      setToast('Movimento marcado como pendente.');
      await onReload();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao desconciliar movimento.');
    } finally {
      setBusy(false);
    }
  };

  // Unreconcile Statement Row (Section 14.3)
  const handleUnreconcileStatementRow = (localId: string) => {
    setStatementRows((prev) =>
      prev.map((r) =>
        r.localId === localId ? { ...r, matched: false, matchedMovementId: null } : r
      )
    );
    setToast('Lançamento do extrato desmarcado.');
  };

  // Select-all toggles
  const pendingStatementRows = filteredStatement.filter((r) => !r.matched);
  const allPendingStmtSelected =
    pendingStatementRows.length > 0 &&
    selectedStatementIds.length >= pendingStatementRows.length;

  const toggleAllStatement = () => {
    if (allPendingStmtSelected) {
      setSelectedStatementIds([]);
    } else {
      setSelectedStatementIds(pendingStatementRows.map((r) => r.localId));
    }
  };

  const pendingSystemMovements = filteredMovements.filter((m) => !m.reconciled);
  const allPendingSysSelected =
    pendingSystemMovements.length > 0 &&
    selectedMovementIds.length >= pendingSystemMovements.length;

  const toggleAllSystem = () => {
    if (allPendingSysSelected) {
      setSelectedMovementIds([]);
    } else {
      setSelectedMovementIds(pendingSystemMovements.map((m) => m.id));
    }
  };

  // Modal: Novo / Editar Lançamento (Section 16)
  const openNewEntryModal = () => {
    if (!selectedAccount) return;
    setEditingMovement(null);
    setEntryDate(new Date().toISOString().slice(0, 10));
    setEntryType('DEBITO');
    setEntryAmountMask('0,00');
    setEntryDesc('');
    setEntryDoc('');
    setEntryStatus('PENDENTE');
    setEntryCategoryId('');
    setEntryError('');
    setEntryModalOpen(true);
  };

  const handleRowDoubleClick = (mov: BankMovement) => {
    if (mov.titleId) {
      setErrorMsg(
        'Este lançamento possui vínculo com título financeiro. Cancele a baixa em Contas a Receber/Pagar para editá-lo.'
      );
      return;
    }
    setEditingMovement(mov);
    setEntryDate(toIsoDateOnly(mov.movementDate) || new Date().toISOString().slice(0, 10));
    setEntryType(
      String(mov.movementType).toUpperCase() === 'CREDITO' ||
        String(mov.movementType).toUpperCase() === 'ENTRADA'
        ? 'CREDITO'
        : 'DEBITO'
    );
    setEntryAmountMask(centsToMaskInput(mov.amountCents));
    setEntryDesc(mov.description || '');
    setEntryDoc(mov.documentNumber || '');
    setEntryStatus(String(mov.status || 'PENDENTE').toUpperCase() === 'CONCILIADO' ? 'CONCILIADO' : 'PENDENTE');
    setEntryCategoryId(mov.categoryId ? String(mov.categoryId) : '');
    setEntryError('');
    setEntryModalOpen(true);
  };

  const handleSaveEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    setEntryError('');
    if (!selectedAccount) return;
    const amtCents = parseMaskInputToCents(entryAmountMask);
    if (!entryDate || amtCents <= 0 || !entryDesc.trim() || !entryCategoryId) {
      setEntryError('Preencha data, valor positivo, descrição e categoria.');
      return;
    }

    const catObj = chartOfAccounts.find((c) => String(c.id) === entryCategoryId);
    const payload = {
      bankAccountId: selectedAccount.id,
      movementDate: entryDate,
      movementType: entryType,
      amountCents: amtCents,
      description: entryDesc.trim(),
      documentNumber: entryDoc.trim(),
      status: entryStatus,
      categoryId: Number(entryCategoryId),
      categoryName: catObj ? `${catObj.code} - ${catObj.name}` : '',
      origin: editingMovement ? editingMovement.origin : 'MANUAL',
    };

    setEntryBusy(true);
    try {
      if (editingMovement) {
        await apiFetch(`/api/finance/bank-movements/${editingMovement.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        setToast('Lançamento atualizado com sucesso.');
      } else {
        await apiFetch('/api/finance/bank-movements', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setToast('Lançamento criado com sucesso.');
      }
      setEntryModalOpen(false);
      await onReload();
    } catch (err) {
      setEntryError(err instanceof Error ? err.message : 'Erro ao salvar lançamento.');
    } finally {
      setEntryBusy(false);
    }
  };

  const entryCategoriesList = entryType === 'CREDITO' ? analyticRevenues : analyticExpenses;

  return (
    <div className="space-y-4">
      {/* Cabeçalho (Seção 9) */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-4 dark:border-slate-700 dark:bg-slate-900">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 text-xs">
          <div className="lg:col-span-1">
            <label className="block font-semibold text-slate-600 mb-1 dark:text-slate-300">Conta Corrente *</label>
            <select
              value={selectedAccountId}
              onChange={(e) => setSelectedAccountId(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 font-semibold text-slate-900 dark:border-slate-700 dark:text-slate-100 dark:bg-slate-950"
            >
              <option value="">Selecione...</option>
              {bankAccounts.map((acc) => (
                <option key={acc.id} value={String(acc.id)}>
                  {formatAccountLabel(acc)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block font-semibold text-slate-600 mb-1 dark:text-slate-300">Período De</label>
            <input
              type="date"
              value={periodFrom}
              onChange={(e) => setPeriodFrom(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-2.5 py-2 font-mono dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          </div>
          <div>
            <label className="block font-semibold text-slate-600 mb-1 dark:text-slate-300">Período Até</label>
            <input
              type="date"
              value={periodTo}
              onChange={(e) => setPeriodTo(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-2.5 py-2 font-mono dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          </div>
          <div>
            <label className="block font-semibold text-slate-600 mb-1 dark:text-slate-300">Data Conciliação</label>
            <input
              type="date"
              value={reconciliationDate}
              onChange={(e) => setReconciliationDate(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-2.5 py-2 font-mono dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          </div>
          <div>
            <label className="block font-semibold text-slate-600 mb-1 dark:text-slate-300">Data Compensação</label>
            <input
              type="date"
              value={compensationDate}
              onChange={(e) => setCompensationDate(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-2.5 py-2 font-mono dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          </div>
        </div>

        {/* Barra de Operações (Seção 10) */}
        {selectedAccount && (
          <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3 dark:border-slate-800">
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept=".ofx,.xlsx,.xls"
                onChange={handleFileSelected}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-emerald-600 dark:hover:bg-emerald-500"
              >
                <Upload className="w-3.5 h-3.5 text-emerald-400" />
                Importar Extrato
              </button>
              <button
                type="button"
                onClick={openNewEntryModal}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <Plus className="w-3.5 h-3.5" />
                Novo Lançamento
              </button>

              {importedFileName && (
                <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1.5 text-[11px] font-mono text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                  <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-300" />
                  {importedFileName} · {statementRows.length} linha(s)
                </span>
              )}

              {statementRows.length > 0 && (
                <button
                  type="button"
                  onClick={handleClearStatement}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  <Eraser className="w-3.5 h-3.5" />
                  Limpar
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  setAuditTarget({
                    title: `Conciliação Bancária · ${selectedAccount.bankName}`,
                    entityType: 'bank_movements,bank_accounts',
                    entityId: 'all',
                  })
                }
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <History className="w-3.5 h-3.5" />
                Auditoria
              </button>
              <button
                type="button"
                disabled={busy || statementRows.length === 0 || filteredMovements.length === 0}
                onClick={handleAutoReconcile}
                className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3.5 py-2 text-xs font-semibold text-blue-800 hover:bg-blue-100 disabled:opacity-50 dark:border-blue-800/70 dark:bg-blue-950/50 dark:text-blue-300 dark:hover:bg-blue-900/60"
              >
                <Sparkles className="w-3.5 h-3.5" />
                Auto-Conciliar
              </button>
              <button
                type="button"
                disabled={busy || totalSelectedCount === 0}
                onClick={handleManualReconcile}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                Conciliar ({totalSelectedCount})
              </button>
            </div>
          </div>
        )}
      </div>

      {toast && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-medium text-emerald-900 flex items-center justify-between dark:border-emerald-800/70 dark:bg-emerald-950/50 dark:text-emerald-300">
          <span>{toast}</span>
          <button type="button" onClick={() => setToast('')}>
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {errorMsg && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-xs font-medium text-red-900 flex items-center justify-between dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300">
          <span>{errorMsg}</span>
          <button type="button" onClick={() => setErrorMsg('')}>
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Estado Inicial vs Duas Grades (Seções 9 & 12) */}
      {!selectedAccount ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-12 text-center dark:border-slate-600 dark:bg-slate-900">
          <FileSpreadsheet className="w-8 h-8 text-slate-400 mx-auto mb-2 dark:text-slate-400" />
          <div className="font-display text-sm font-bold text-slate-800 dark:text-slate-100">
            Selecione uma Conta Corrente
          </div>
          <p className="text-xs text-slate-500 mt-1 dark:text-slate-400">
            Escolha a conta corrente no cabeçalho acima para importar extratos OFX/XLSX e conciliar com os movimentos do sistema.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {/* LADO ESQUERDO: EXTRATO BANCÁRIO (Seção 12.1) */}
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden flex flex-col dark:border-slate-700 dark:bg-slate-900">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between bg-slate-50/70 dark:border-slate-800 dark:bg-slate-800/60">
              <div>
                <h3 className="font-display text-xs font-bold text-slate-900 dark:text-slate-100">
                  Extrato Bancário ({filteredStatement.length})
                </h3>
                <p className="text-[10px] text-slate-500 dark:text-slate-400">Linhas locais importadas (.OFX / .XLSX)</p>
              </div>
              {pendingStatementRows.length > 0 && (
                <label className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-600 cursor-pointer dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={allPendingStmtSelected}
                    onChange={toggleAllStatement}
                  />
                  Selecionar pendentes
                </label>
              )}
            </div>

            <div className="overflow-x-auto max-h-[440px] overflow-y-auto scroll-rulers flex-1">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-[11px] font-semibold text-slate-500 border-b border-slate-200 sticky top-0 dark:bg-slate-800/70 dark:text-slate-400 dark:border-slate-700">
                  <tr>
                    <th className="px-3 py-2.5 w-8">
                      <input
                        type="checkbox"
                        disabled={pendingStatementRows.length === 0}
                        checked={allPendingStmtSelected}
                        onChange={toggleAllStatement}
                      />
                    </th>
                    <th className="px-3 py-2.5">Data</th>
                    <th className="px-3 py-2.5">Descrição</th>
                    <th className="px-3 py-2.5 text-right">Valor</th>
                    <th className="px-2 py-2.5 text-center">Tipo</th>
                    <th className="px-3 py-2.5">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {statementRows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-10 text-center text-slate-500 dark:text-slate-400">
                        Importe um arquivo OFX ou XLSX clicando em <strong>Importar Extrato</strong>.
                      </td>
                    </tr>
                  ) : filteredStatement.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-10 text-center text-slate-500 dark:text-slate-400">
                        Nenhuma linha do extrato encontrada para o período informado.
                      </td>
                    </tr>
                  ) : (
                    filteredStatement.map((row) => {
                      const checked = selectedStatementIds.includes(row.localId);
                      return (
                        <tr key={row.localId} className="hover:bg-slate-50 dark:hover:bg-slate-800">
                          <td className="px-3 py-2.5">
                            {row.matched ? (
                              <button
                                type="button"
                                onClick={() => handleUnreconcileStatementRow(row.localId)}
                                title="Desconciliar linha do extrato"
                                className="text-emerald-600 hover:text-emerald-800 dark:text-emerald-400 dark:hover:text-emerald-200"
                              >
                                <CheckCircle2 className="w-4 h-4" />
                              </button>
                            ) : (
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setSelectedStatementIds((p) => [...p, row.localId]);
                                  } else {
                                    setSelectedStatementIds((p) => p.filter((id) => id !== row.localId));
                                  }
                                }}
                              />
                            )}
                          </td>
                          <td className="px-3 py-2.5 font-mono text-slate-600 whitespace-nowrap dark:text-slate-300">
                            {formatIsoDateToBR(row.date)}
                          </td>
                          <td className="px-3 py-2.5 text-slate-900 max-w-[180px] truncate dark:text-slate-100" title={row.description}>
                            {row.description}
                          </td>
                          <td
                            className={`px-3 py-2.5 font-mono font-bold text-right tabular-nums whitespace-nowrap ${
                              row.type === 'CREDITO' ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-600 dark:text-red-400'
                            }`}
                          >
                            {row.type === 'CREDITO'
                              ? formatBRL(row.amountCents)
                              : formatSignedBRL(-row.amountCents)}
                          </td>
                          <td className="px-2 py-2.5 text-center font-mono font-bold text-slate-600 dark:text-slate-300">
                            {row.type === 'CREDITO' ? 'C' : 'D'}
                          </td>
                          <td className="px-3 py-2.5 whitespace-nowrap">
                            <span
                              className={`inline-block rounded px-2 py-0.5 text-[10px] font-bold ${
                                row.matched
                                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300'
                                  : 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300'
                              }`}
                            >
                              {row.matched ? 'Conciliado' : 'Pendente'}
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Totais Extrato (Seção 12.3) */}
            <div className="bg-slate-50 border-t border-slate-200 p-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] dark:bg-slate-800/70 dark:border-slate-700">
              <div>
                <div className="text-slate-500 dark:text-slate-400">Entradas</div>
                <div className="font-mono font-bold text-emerald-700 dark:text-emerald-300">
                  {formatBRL(statementTotals.entries)}
                </div>
              </div>
              <div>
                <div className="text-slate-500 dark:text-slate-400">Saídas</div>
                <div className="font-mono font-bold text-red-600 dark:text-red-400">
                  {formatSignedBRL(-statementTotals.exits)}
                </div>
              </div>
              <div>
                <div className="text-slate-500 dark:text-slate-400">Saldo Movimentado</div>
                <div className="font-mono font-bold text-slate-900 dark:text-slate-100">
                  {formatSignedBRL(statementTotals.movedBalance)}
                </div>
              </div>
              <div>
                <div className="text-slate-500 dark:text-slate-400">Saldo Conciliado</div>
                <div className="font-mono font-bold text-emerald-800 dark:text-emerald-300">
                  {formatSignedBRL(statementTotals.reconciledBalance)}
                </div>
              </div>
            </div>
          </div>

          {/* LADO DIREITO: MOVIMENTOS DO SISTEMA (Seção 12.2) */}
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden flex flex-col dark:border-slate-700 dark:bg-slate-900">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between bg-slate-50/70 dark:border-slate-800 dark:bg-slate-800/60">
              <div>
                <h3 className="font-display text-xs font-bold text-slate-900 dark:text-slate-100">
                  Movimentos do Sistema ({filteredMovements.length})
                </h3>
                <p className="text-[10px] text-slate-500 dark:text-slate-400">
                  Duplo clique na linha para editar lançamento não vinculado
                </p>
              </div>
              {pendingSystemMovements.length > 0 && (
                <label className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-600 cursor-pointer dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={allPendingSysSelected}
                    onChange={toggleAllSystem}
                  />
                  Selecionar não conciliados
                </label>
              )}
            </div>

            <div className="overflow-x-auto max-h-[440px] overflow-y-auto scroll-rulers flex-1">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-[11px] font-semibold text-slate-500 border-b border-slate-200 sticky top-0 dark:bg-slate-800/70 dark:text-slate-400 dark:border-slate-700">
                  <tr>
                    <th className="px-3 py-2.5 w-8">
                      <input
                        type="checkbox"
                        disabled={pendingSystemMovements.length === 0}
                        checked={allPendingSysSelected}
                        onChange={toggleAllSystem}
                      />
                    </th>
                    <th className="px-3 py-2.5">Data</th>
                    <th className="px-3 py-2.5">Descrição</th>
                    <th className="px-3 py-2.5 text-right">Valor</th>
                    <th className="px-2 py-2.5 text-center">Tipo</th>
                    <th className="px-3 py-2.5">Status</th>
                    <th className="px-2 py-2.5 text-right">Aud.</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {filteredMovements.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-10 text-center text-slate-500 dark:text-slate-400">
                        Nenhum movimento registrado para esta conta/período.
                      </td>
                    </tr>
                  ) : (
                    filteredMovements.map((mov) => {
                      const checked = selectedMovementIds.includes(mov.id);
                      return (
                        <tr
                          key={mov.id}
                          onDoubleClick={() => handleRowDoubleClick(mov)}
                          className="hover:bg-slate-50 cursor-pointer dark:hover:bg-slate-800"
                        >
                          <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                            {mov.reconciled ? (
                              <button
                                type="button"
                                onClick={() => handleUnreconcileMovement(mov.id)}
                                title="Desconciliar movimento do sistema"
                                className="text-emerald-600 hover:text-emerald-800 dark:text-emerald-400 dark:hover:text-emerald-200"
                              >
                                <CheckCircle2 className="w-4 h-4" />
                              </button>
                            ) : (
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setSelectedMovementIds((p) => [...p, mov.id]);
                                  } else {
                                    setSelectedMovementIds((p) => p.filter((id) => id !== mov.id));
                                  }
                                }}
                              />
                            )}
                          </td>
                          <td className="px-3 py-2.5 font-mono text-slate-600 whitespace-nowrap dark:text-slate-300">
                            {formatIsoDateToBR(mov.isoDate)}
                          </td>
                          <td className="px-3 py-2.5 text-slate-900 max-w-[180px] truncate dark:text-slate-100" title={mov.description}>
                            {mov.description}
                          </td>
                          <td
                            className={`px-3 py-2.5 font-mono font-bold text-right tabular-nums whitespace-nowrap ${
                              mov.normType === 'CREDITO' ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-600 dark:text-red-400'
                            }`}
                          >
                            {mov.normType === 'CREDITO'
                              ? formatBRL(mov.amountCents)
                              : formatSignedBRL(-mov.amountCents)}
                          </td>
                          <td className="px-2 py-2.5 text-center font-mono font-bold text-slate-600 dark:text-slate-300">
                            {mov.normType === 'CREDITO' ? 'C' : 'D'}
                          </td>
                          <td className="px-3 py-2.5 whitespace-nowrap">
                            <span
                              className={`inline-block rounded px-2 py-0.5 text-[10px] font-bold ${
                                mov.reconciled
                                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300'
                                  : 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300'
                              }`}
                            >
                              {mov.reconciled ? 'Conciliado' : 'Pendente'}
                            </span>
                            {mov.reconciled && mov.reconciliationDate && (
                              <div className="text-[10px] font-mono text-slate-400 mt-0.5 dark:text-slate-400">
                                {formatIsoDateToBR(mov.reconciliationDate)}
                              </div>
                            )}
                          </td>
                          <td className="px-2 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              onClick={() =>
                                setAuditTarget({
                                  title: `Movimento #${mov.id} · ${mov.description}`,
                                  entityType: 'bank_movements',
                                  entityId: mov.id,
                                })
                              }
                              title="Auditoria do Movimento"
                              className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-white"
                            >
                              <History className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Totais Sistema (Seção 12.3) */}
            <div className="bg-slate-50 border-t border-slate-200 p-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] dark:bg-slate-800/70 dark:border-slate-700">
              <div>
                <div className="text-slate-500 dark:text-slate-400">Entradas</div>
                <div className="font-mono font-bold text-emerald-700 dark:text-emerald-300">
                  {formatBRL(systemTotals.entries)}
                </div>
              </div>
              <div>
                <div className="text-slate-500 dark:text-slate-400">Saídas</div>
                <div className="font-mono font-bold text-red-600 dark:text-red-400">
                  {formatSignedBRL(-systemTotals.exits)}
                </div>
              </div>
              <div>
                <div className="text-slate-500 dark:text-slate-400">Saldo Movimentado</div>
                <div className="font-mono font-bold text-slate-900 dark:text-slate-100">
                  {formatSignedBRL(systemTotals.movedBalance)}
                </div>
              </div>
              <div>
                <div className="text-slate-500 dark:text-slate-400">Saldo Conciliado</div>
                <div className="font-mono font-bold text-emerald-800 dark:text-emerald-300">
                  {formatSignedBRL(systemTotals.reconciledBalance)}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ================= MODAL NOVO / EDITAR LANÇAMENTO NA CONCILIAÇÃO (Seção 16) ================= */}
      {entryModalOpen && selectedAccount && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4 dark:bg-slate-950/80">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl space-y-4 text-xs dark:border-slate-700 dark:bg-slate-900">
            <div className="border-b border-slate-100 pb-3 dark:border-slate-800">
              <h3 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                {editingMovement ? 'Editar Lançamento' : 'Novo Lançamento'}
              </h3>
              <p className="text-[11px] text-slate-500 mt-0.5 dark:text-slate-400">{formatAccountLabel(selectedAccount)}</p>
            </div>

            {entryError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-700 font-medium dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300">
                {entryError}
              </div>
            )}

            <form onSubmit={handleSaveEntry} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Data *</label>
                  <input
                    type="date"
                    required
                    value={entryDate}
                    onChange={(e) => setEntryDate(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Tipo *</label>
                  <select
                    value={entryType}
                    onChange={(e) => {
                      setEntryType(e.target.value as 'DEBITO' | 'CREDITO');
                      setEntryCategoryId('');
                    }}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 font-semibold dark:border-slate-700"
                  >
                    <option value="DEBITO">Saída (Débito)</option>
                    <option value="CREDITO">Entrada (Crédito)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Valor *</label>
                  <input
                    type="text"
                    required
                    value={entryAmountMask}
                    onChange={(e) => setEntryAmountMask(formatCurrencyTyping(e.target.value))}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono font-bold text-right dark:border-slate-700"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Nº Documento</label>
                  <input
                    type="text"
                    value={entryDoc}
                    onChange={(e) => setEntryDoc(e.target.value)}
                    placeholder="Opcional"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Descrição *</label>
                <input
                  type="text"
                  required
                  value={entryDesc}
                  onChange={(e) => setEntryDesc(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Status</label>
                  <select
                    value={entryStatus}
                    onChange={(e) => setEntryStatus(e.target.value as 'PENDENTE' | 'CONCILIADO')}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  >
                    <option value="PENDENTE">Pendente</option>
                    <option value="CONCILIADO">Conciliado</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Categoria *</label>
                  <select
                    required
                    value={entryCategoryId}
                    onChange={(e) => setEntryCategoryId(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  >
                    <option value="">Selecione...</option>
                    {entryCategoriesList.map((cat) => (
                      <option key={cat.id} value={String(cat.id)}>
                        {cat.code} - {cat.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  disabled={entryBusy}
                  onClick={() => setEntryModalOpen(false)}
                  className="rounded-lg border border-slate-200 px-4 py-2 font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={entryBusy}
                  className="rounded-lg bg-emerald-600 px-4 py-2 font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {entryBusy ? 'Salvando...' : 'Salvar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {auditTarget && (
        <EntityAuditModal
          open={Boolean(auditTarget)}
          title={auditTarget.title}
          entityType={auditTarget.entityType}
          entityId={auditTarget.entityId}
          onClose={() => setAuditTarget(null)}
        />
      )}
    </div>
  );
};
