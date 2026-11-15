import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownUp,
  BellRing,
  Building2,
  CheckCircle2,
  FileSpreadsheet,
  FileText,
  FolderTree,
  History,
  Layers,
  Pencil,
  Plus,
  ScanSearch,
  Search,
  Sparkles,
  Trash2,
  X,
  Landmark,
  Banknote,
  FolderKanban,
} from 'lucide-react';
import { apiFetch, formatBRL, formatDateBR } from '../../lib/api.ts';
import {
  Admission,
  Client,
  CollaboratorItem,
  DepartmentItem,
  FinancialTitle,
  ModuleId,
  NavigationIntent,
  Unit,
} from '../../types.ts';
import { CollapsibleFilterBar } from '../CollapsibleFilterBar.tsx';
import { BRAZILIAN_UFS, ConfirmDeleteModal, EntityAuditModal } from './cadastros/CadastrosShared.tsx';
import { BankMovementManager } from './finance/BankMovementManager.tsx';
import { BankReconciliationManager } from './finance/BankReconciliationManager.tsx';
import { FinancialTitlesManager } from './finance/FinancialTitlesManager.tsx';
import { ReguaCobrancaIviView } from './finance/ReguaCobrancaIviView.tsx';

interface FinanceModuleProps {
  units: Unit[];
  wsTick: number;
  activeModule: ModuleId;
  navIntent?: NavigationIntent | null;
  onClearIntent?: () => void;
  onNavigate?: (mod: ModuleId, intent?: NavigationIntent) => void;
}

interface CoverSheetCandidate {
  admissionId: number;
  protocolCode: string;
  clientName: string;
  bankName: string;
  remainingInstallments: number;
  installmentAmountCents: number;
}

export const FinanceModule: React.FC<FinanceModuleProps> = ({
  units,
  wsTick,
  activeModule,
  navIntent,
  onClearIntent,
  onNavigate,
}) => {
  const [cadSubTab, setCadSubTab] = useState<'fornecedores' | 'document_types' | 'bearers' | 'chart_of_accounts'>('fornecedores');

  const isCadastrosView = activeModule === 'finance_cadastros' || activeModule.startsWith('finance_cad_');
  const activeCadTab: 'fornecedores' | 'document_types' | 'bearers' | 'chart_of_accounts' =
    activeModule === 'finance_cad_documentos'
      ? 'document_types'
      : activeModule === 'finance_cad_portadores'
      ? 'bearers'
      : activeModule === 'finance_cad_plano_contas'
      ? 'chart_of_accounts'
      : activeModule === 'finance_cad_fornecedores'
      ? 'fornecedores'
      : cadSubTab;

  const activeCadLabel =
    activeCadTab === 'fornecedores'
      ? 'Fornecedores'
      : activeCadTab === 'document_types'
      ? 'Tipos de Documento'
      : activeCadTab === 'bearers'
      ? 'Portadores'
      : 'Plano de Contas';

  const [titles, setTitles] = useState<FinancialTitle[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [admissions, setAdmissions] = useState<Admission[]>([]);
  const [settings, setSettings] = useState<Record<string, Record<string, unknown>>>({});

  // Cadastros state
  const [suppliers, setSuppliers] = useState<Client[]>([]);
  const [documentTypes, setDocumentTypes] = useState<any[]>([]);
  const [bearers, setBearers] = useState<any[]>([]);
  const [chartOfAccounts, setChartOfAccounts] = useState<any[]>([]);
  const [departments, setDepartments] = useState<DepartmentItem[]>([]);
  const [collaborators, setCollaborators] = useState<CollaboratorItem[]>([]);

  // Bank accounts & movements state
  const [bankAccountsList, setBankAccountsList] = useState<any[]>([]);
  const [bankMovementsList, setBankMovementsList] = useState<any[]>([]);
  const [bankAccModalOpen, setBankAccModalOpen] = useState(false);
  const [editingBankAccId, setEditingBankAccId] = useState<number | null>(null);
  const [bankNameInput, setBankNameInput] = useState('');
  const [bankAgencyInput, setBankAgencyInput] = useState('');
  const [bankAccountNumberInput, setBankAccountNumberInput] = useState('');
  const [bankAccountTypeInput, setBankAccountTypeInput] = useState('corrente');
  const [bankInitialBalanceReais, setBankInitialBalanceReais] = useState('0.00');

  const [bankMovModalOpen, setBankMovModalOpen] = useState(false);
  const [movBankAccountId, setMovBankAccountId] = useState<number>(0);
  const [movType, setMovType] = useState<'entrada' | 'saida'>('entrada');
  const [movAmountReais, setMovAmountReais] = useState('');
  const [movDesc, setMovDesc] = useState('');
  const [movDoc, setMovDoc] = useState('');

  // Cadastros form / modal state
  const [cadMode, setCadMode] = useState<'list' | 'form'>('list');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [auditTarget, setAuditTarget] = useState<{ entityType: string; entityId: number | string; label: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ type: string; id: number; name: string } | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteErr, setDeleteErr] = useState('');

  // Supplier form fields
  const [suppName, setSuppName] = useState('');
  const [suppCnpj, setSuppCnpj] = useState('');
  const [suppNature, setSuppNature] = useState('PJ');
  const [suppPhone, setSuppPhone] = useState('');
  const [suppEmail, setSuppEmail] = useState('');
  const [suppCep, setSuppCep] = useState('');
  const [suppAddress, setSuppAddress] = useState('');
  const [suppCity, setSuppCity] = useState('');
  const [suppState, setSuppState] = useState('');
  const [suppNotes, setSuppNotes] = useState('');

  // Document Type form fields
  const [docDesc, setDocDesc] = useState('');
  const [docCategory, setDocCategory] = useState('ambos');
  const [docFiscal, setDocFiscal] = useState(false);
  const [docRequiresNum, setDocRequiresNum] = useState(false);

  // Bearer form fields
  const [bearCode, setBearCode] = useState('');
  const [bearName, setBearName] = useState('');
  const [bearType, setBearType] = useState('banco');

  // Chart of Accounts form fields
  const [acctCode, setAcctCode] = useState('');
  const [acctName, setAcctName] = useState('');
  const [acctType, setAcctType] = useState('despesa');
  const [acctParentId, setAcctParentId] = useState('');
  const [acctAnalytic, setAcctAnalytic] = useState(true);

  const [unitFilter, setUnitFilter] = useState('all');
  const [periodFilter, setPeriodFilter] = useState('30d');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const [scanResults, setScanResults] = useState<CoverSheetCandidate[] | null>(null);
  const [coverSheetTarget, setCoverSheetTarget] = useState<CoverSheetCandidate | null>(null);
  const [firstDueDate, setFirstDueDate] = useState('');
  const [customAmountReais, setCustomAmountReais] = useState('');
  const [reguaPreview, setReguaPreview] = useState<{
    titleCode: string;
    clientName: string;
    message: string;
    provider: string;
    stageTag: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const [selectedTitleIds, setSelectedTitleIds] = useState<number[]>([]);

  const load = async () => {
    try {
      const [finData, suppData, docData, bearData, chartData, bankAccData, bankMovData, cadBootstrap] = await Promise.all([
        apiFetch<{
          titles: FinancialTitle[];
          clients: Client[];
          admissions: Admission[];
          settings: Record<string, Record<string, unknown>>;
        }>('/api/finance'),
        apiFetch<{ suppliers: Client[] }>('/api/finance/suppliers'),
        apiFetch<{ documentTypes: any[] }>('/api/finance/document-types'),
        apiFetch<{ bearers: any[] }>('/api/finance/bearers'),
        apiFetch<{ chartOfAccounts: any[] }>('/api/finance/chart-of-accounts'),
        apiFetch<{ bankAccounts: any[] }>('/api/finance/bank-accounts'),
        apiFetch<{ bankMovements: any[] }>('/api/finance/bank-movements'),
        apiFetch<{ departments?: DepartmentItem[]; collaborators?: CollaboratorItem[] }>('/api/cadastros/bootstrap').catch(
          () => ({ departments: [], collaborators: [] })
        ),
      ]);
      setTitles(finData.titles);
      setClients(finData.clients);
      setAdmissions(finData.admissions);
      setSettings(finData.settings);
      setSuppliers(suppData.suppliers || []);
      setDocumentTypes(docData.documentTypes || []);
      setBearers(bearData.bearers || []);
      setChartOfAccounts(chartData.chartOfAccounts || []);
      setBankAccountsList(bankAccData.bankAccounts || []);
      setBankMovementsList(bankMovData.bankMovements || []);
      setDepartments(cadBootstrap.departments || []);
      setCollaborators(cadBootstrap.collaborators || []);
    } catch (e) {
      console.error('Finance load error:', e);
    }
  };

  const mergedPeople = useMemo(() => {
    const map = new Map<number, Client>();
    for (const c of clients) map.set(c.id, c);
    for (const s of suppliers) {
      map.set(s.id, { ...s, ...(map.get(s.id) || {}), natureza: 'F' } as Client);
    }
    return Array.from(map.values());
  }, [clients, suppliers]);

  useEffect(() => {
    load();
  }, [wsTick]);

  useEffect(() => {
    setCadMode('list');
    if (activeModule === 'finance_cad_fornecedores') setCadSubTab('fornecedores');
    else if (activeModule === 'finance_cad_documentos') setCadSubTab('document_types');
    else if (activeModule === 'finance_cad_portadores') setCadSubTab('bearers');
    else if (activeModule === 'finance_cad_plano_contas') setCadSubTab('chart_of_accounts');
  }, [activeModule]);

  useEffect(() => {
    if (!navIntent) return;
    if (
      activeModule === 'finance_receber' ||
      activeModule === 'finance_pagar' ||
      activeModule === 'finance_movimento' ||
      activeModule === 'finance_operacao' ||
      activeModule === 'finance'
    ) {
      return;
    }
    if (navIntent.clientId && clients.length > 0) {
      const cl = clients.find((c) => c.id === navIntent.clientId);
      if (cl) setSearchQuery(cl.fullName);
    }
    onClearIntent?.();
  }, [navIntent, clients, activeModule, onClearIntent]);

  const filteredTitles = useMemo(() => {
    return titles.filter((t) => {
      if (unitFilter !== 'all' && String(t.unitId) !== unitFilter) return false;
      if (statusFilter !== 'all' && t.status !== statusFilter) return false;
      if (searchQuery.trim()) {
        const c = clients.find((cl) => cl.id === t.clientId);
        const q = searchQuery.toLowerCase();
        if (!t.titleCode.toLowerCase().includes(q) && !(c?.fullName || '').toLowerCase().includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [titles, clients, unitFilter, statusFilter, searchQuery]);

  const handleRunIvi07hScan = async () => {
    setBusy(true);
    setToast('');
    try {
      const res = await apiFetch<{
        scannedAt: string;
        paidTitlesTotal: number;
        readyForCoverSheet: CoverSheetCandidate[];
      }>('/api/finance/ivi-07h-scan', { method: 'POST' });
      setScanResults(res.readyForCoverSheet);
      if (res.readyForCoverSheet.length === 0) {
        setToast('Varredura 07:00h concluída: nenhuma ficha pendente de Folha de Rosto no momento.');
      }
    } finally {
      setBusy(false);
    }
  };

  const openCoverSheet = (cand: CoverSheetCandidate) => {
    setCoverSheetTarget(cand);
    const nextMonth = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    setFirstDueDate(nextMonth);
    setCustomAmountReais((cand.installmentAmountCents / 100).toFixed(2));
  };

  const handleApproveCoverSheet = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!coverSheetTarget) return;
    setBusy(true);
    try {
      const customAmountCents = Math.round(Number(customAmountReais) * 100);
      const res = await apiFetch<{ generatedCount: number }>(
        `/api/finance/generate-remaining/${coverSheetTarget.admissionId}`,
        {
          method: 'POST',
          body: JSON.stringify({ firstDueDate, customAmountCents }),
        }
      );
      setToast(
        `Folha de Rosto aprovada! ${res.generatedCount} boletos restantes emitidos no Santander e lançados no Contas a Receber.`
      );
      setCoverSheetTarget(null);
      setScanResults((prev) =>
        prev ? prev.filter((item) => item.admissionId !== coverSheetTarget.admissionId) : null
      );
      await load();
    } finally {
      setBusy(false);
    }
  };

  const handleRunRegua = async (titleId?: number) => {
    setBusy(true);
    try {
      const res = await apiFetch<{
        titleCode: string;
        clientName: string;
        message: string;
        provider: string;
        stageTag: string;
      }>('/api/finance/run-regua', {
        method: 'POST',
        body: JSON.stringify(titleId ? { titleId } : {}),
      });
      setReguaPreview(res);
      await load();
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'Erro ao acionar régua Ivi.');
    } finally {
      setBusy(false);
    }
  };

  const handleSettleIds = async (ids: number[]) => {
    if (!ids.length) return;
    setBusy(true);
    try {
      const res = await apiFetch<{ settledCount: number }>('/api/finance/batch-settle', {
        method: 'POST',
        body: JSON.stringify({ titleIds: ids }),
      });
      setSelectedTitleIds((prev) => prev.filter((id) => !ids.includes(id)));
      setToast(`${res.settledCount} título(s) baixado(s) com sucesso.`);
      await load();
    } finally {
      setBusy(false);
    }
  };

  // Cadastros CRUD handlers
  const openCadForm = (item?: any, type?: string) => {
    setEditingId(item?.id || null);
    if (activeCadTab === 'fornecedores') {
      setSuppName(item?.fullName || '');
      setSuppCnpj(item?.cpfCnpj || '');
      setSuppNature(item?.personNature || 'PJ');
      setSuppPhone(item?.phone || '');
      setSuppEmail(item?.email || '');
      setSuppCep(item?.zipCode || '');
      setSuppAddress(item?.address || '');
      setSuppCity(item?.city || '');
      setSuppState(item?.state || '');
      setSuppNotes(item?.notes || '');
    } else if (activeCadTab === 'document_types') {
      setDocDesc(item?.description || '');
      setDocCategory(item?.category || 'ambos');
      setDocFiscal(Boolean(item?.isFiscal));
      setDocRequiresNum(Boolean(item?.requiresNumber));
    } else if (activeCadTab === 'bearers') {
      setBearCode(item?.code || '');
      setBearName(item?.name || '');
      setBearType(item?.type || 'banco');
    } else if (activeCadTab === 'chart_of_accounts') {
      setAcctCode(item?.code || '');
      setAcctName(item?.name || '');
      setAcctType(item?.type || 'despesa');
      setAcctParentId(item?.parentId ? String(item.parentId) : '');
      setAcctAnalytic(item?.isAnalytic !== false);
    }
    setCadMode('form');
  };

  const handleSaveCadastros = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (activeCadTab === 'fornecedores') {
        const payload = {
          fullName: suppName,
          cpfCnpj: suppCnpj,
          personNature: suppNature,
          phone: suppPhone,
          email: suppEmail,
          zipCode: suppCep,
          address: suppAddress,
          city: suppCity,
          state: suppState.toUpperCase(),
          notes: suppNotes,
        };
        if (editingId) {
          await apiFetch(`/api/finance/suppliers/${editingId}`, { method: 'PUT', body: JSON.stringify(payload) });
          setToast('Fornecedor atualizado com sucesso.');
        } else {
          await apiFetch('/api/finance/suppliers', { method: 'POST', body: JSON.stringify(payload) });
          setToast('Fornecedor cadastrado com sucesso.');
        }
      } else if (activeCadTab === 'document_types') {
        const payload = {
          description: docDesc,
          category: docCategory,
          isFiscal: docFiscal,
          requiresNumber: docRequiresNum,
        };
        if (editingId) {
          await apiFetch(`/api/finance/document-types/${editingId}`, { method: 'PUT', body: JSON.stringify(payload) });
          setToast('Tipo de documento atualizado.');
        } else {
          await apiFetch('/api/finance/document-types', { method: 'POST', body: JSON.stringify(payload) });
          setToast('Tipo de documento cadastrado.');
        }
      } else if (activeCadTab === 'bearers') {
        const payload = {
          code: bearCode,
          name: bearName,
          type: bearType,
        };
        if (editingId) {
          await apiFetch(`/api/finance/bearers/${editingId}`, { method: 'PUT', body: JSON.stringify(payload) });
          setToast('Portador atualizado.');
        } else {
          await apiFetch('/api/finance/bearers', { method: 'POST', body: JSON.stringify(payload) });
          setToast('Portador cadastrado.');
        }
      } else if (activeCadTab === 'chart_of_accounts') {
        const payload = {
          code: acctCode,
          name: acctName,
          type: acctType,
          parentId: acctParentId ? Number(acctParentId) : null,
          isAnalytic: acctAnalytic,
        };
        if (editingId) {
          await apiFetch(`/api/finance/chart-of-accounts/${editingId}`, { method: 'PUT', body: JSON.stringify(payload) });
          setToast('Conta atualizada no plano de contas.');
        } else {
          await apiFetch('/api/finance/chart-of-accounts', { method: 'POST', body: JSON.stringify(payload) });
          setToast('Conta cadastrada no plano de contas.');
        }
      }
      setCadMode('list');
      await load();
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'Erro ao salvar cadastro.');
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    setDeleteErr('');
    try {
      const route =
        deleteTarget.type === 'fornecedores'
          ? `/api/finance/suppliers/${deleteTarget.id}`
          : deleteTarget.type === 'document_types'
          ? `/api/finance/document-types/${deleteTarget.id}`
          : deleteTarget.type === 'bearers'
          ? `/api/finance/bearers/${deleteTarget.id}`
          : deleteTarget.type === 'bank_accounts'
          ? `/api/finance/bank-accounts/${deleteTarget.id}`
          : `/api/finance/chart-of-accounts/${deleteTarget.id}`;

      await apiFetch(route, { method: 'DELETE' });
      setDeleteTarget(null);
      setToast('Registro excluído com sucesso.');
      await load();
    } catch (err) {
      setDeleteErr(err instanceof Error ? err.message : 'Erro ao excluir registro.');
    } finally {
      setDeleteBusy(false);
    }
  };

  const openBankAccModal = (acc?: any) => {
    setEditingBankAccId(acc?.id || null);
    setBankNameInput(acc?.bankName || '');
    setBankAgencyInput(acc?.agency || '');
    setBankAccountNumberInput(acc?.accountNumber || '');
    setBankAccountTypeInput(acc?.accountType || 'corrente');
    setBankInitialBalanceReais(acc ? (acc.initialBalanceCents / 100).toFixed(2) : '0.00');
    setBankAccModalOpen(true);
  };

  const handleSaveBankAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const initialBalanceCents = Math.round(Number(bankInitialBalanceReais) * 100);
      const payload = {
        bankName: bankNameInput,
        agency: bankAgencyInput,
        accountNumber: bankAccountNumberInput,
        accountType: bankAccountTypeInput,
        initialBalanceCents,
      };
      if (editingBankAccId) {
        await apiFetch(`/api/finance/bank-accounts/${editingBankAccId}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        setToast('Conta bancária atualizada.');
      } else {
        await apiFetch('/api/finance/bank-accounts', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setToast('Conta bancária cadastrada.');
      }
      setBankAccModalOpen(false);
      await load();
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'Erro ao salvar conta bancária.');
    } finally {
      setBusy(false);
    }
  };

  const handleSaveBankMovement = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const amountCents = Math.round(Number(movAmountReais) * 100);
      const payload = {
        bankAccountId: movBankAccountId || bankAccountsList[0]?.id,
        movementType: movType,
        amountCents,
        description: movDesc,
        documentNumber: movDoc,
      };
      await apiFetch('/api/finance/bank-movements', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setToast('Movimentação bancária registrada com sucesso.');
      setBankMovModalOpen(false);
      setMovAmountReais('');
      setMovDesc('');
      setMovDoc('');
      await load();
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'Erro ao registrar movimentação.');
    } finally {
      setBusy(false);
    }
  };

  const stats = useMemo(() => {
    const paid = filteredTitles.filter((t) => t.status === 'pago');
    const open = filteredTitles.filter((t) => t.status === 'aberto');
    const overdue = filteredTitles.filter((t) => t.status === 'vencido');

    const receivedCents = paid.reduce((a, b) => a + b.amountCents, 0);
    const openCents = open.reduce((a, b) => a + b.amountCents, 0);
    const overdueCents = overdue.reduce((a, b) => a + b.amountCents, 0);

    const monthlyGoalCents = Number(
      (settings.goals as Record<string, unknown>)?.monthlyRevenueGoalCents || 45000000
    );
    const goalPct = Math.min(
      100,
      Math.round((receivedCents / Math.max(monthlyGoalCents, 1)) * 100)
    );

    const daysList = paid
      .filter((p) => p.paidAt)
      .map(
        (p) =>
          Math.max(
            1,
            Math.round(
              (new Date(p.paidAt!).getTime() - new Date(p.dueDate).getTime()) / 86400000
            ) + 15
          )
      );
    const avgReceiptDays = daysList.length
      ? Math.round(daysList.reduce((a, b) => a + b, 0) / daysList.length)
      : 18;

    const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    const currentMonthIdx = new Date().getMonth();
    const cumulativeSeries = months.map((label, idx) => {
      const base =
        idx <= currentMonthIdx
          ? 28000000 + idx * 3800000 + (idx === currentMonthIdx ? receivedCents : 0)
          : 0;
      return { label, valueCents: base };
    });

    return {
      receivedCents,
      openCents,
      overdueCents,
      monthlyGoalCents,
      goalPct,
      avgReceiptDays,
      cumulativeSeries,
    };
  }, [filteredTitles, settings]);

  const maxSeries = Math.max(...stats.cumulativeSeries.map((s) => s.valueCents), 1);

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 border-b border-slate-200 pb-4">
        <div>
          <p className="text-xs font-medium text-slate-500">
            {activeModule === 'finance_movimento'
              ? 'Administração Financeira · Conta Corrente · Cadastro · Movimento'
              : activeModule === 'finance_conciliacao'
              ? 'Administração Financeira · Conta Corrente · Cadastro · Conciliação Bancária'
              : activeModule === 'finance_regua'
              ? 'Administração Financeira · Régua Automática Ivi (-15/-5/+7d) · Confirmação de Lotes & Varredura 07:00h'
              : activeModule === 'finance_pagar'
              ? 'Administração Financeira · Contas a Pagar · Lançamentos, Fornecedores, Baixas & Recorrência'
              : activeModule === 'finance_conta_corrente'
              ? 'Administração Financeira · Conta Corrente · Cadastro · Contas Correntes'
              : isCadastrosView
              ? `Administração Financeira · Cadastros · ${activeCadLabel}`
              : 'Administração Financeira · Contas a Receber · Títulos, Baixas em Lote, Faturas & Recorrência'}
          </p>
          <h1 className="mt-1 font-display text-2xl font-bold text-slate-900">
            {isCadastrosView
              ? `Cadastros · ${activeCadLabel}`
              : activeModule === 'finance_conta_corrente'
              ? 'Contas Correntes'
              : activeModule === 'finance_movimento'
              ? 'Movimentação Bancária'
              : activeModule === 'finance_conciliacao'
              ? 'Conciliação Bancária'
              : activeModule === 'finance_regua'
              ? 'Régua de Cobrança (Ivi)'
              : activeModule === 'finance_pagar'
              ? 'Contas a Pagar'
              : 'Contas a Receber'}
          </h1>
        </div>
      </div>

      {toast && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-medium text-emerald-900 flex items-center justify-between">
          <span>{toast}</span>
          <button type="button" onClick={() => setToast('')}><X className="w-3.5 h-3.5" /></button>
        </div>
      )}

      {/* ================= 1. CONTAS A RECEBER ================= */}
      {(activeModule === 'finance_receber' || activeModule === 'finance_operacao' || activeModule === 'finance') && (
        <FinancialTitlesManager
          scope="RECEBER"
          units={units}
          clients={mergedPeople}
          documentTypes={documentTypes}
          bearers={bearers}
          chartOfAccounts={chartOfAccounts}
          bankAccounts={bankAccountsList}
          departments={departments}
          collaborators={collaborators}
          wsTick={wsTick}
          navIntent={navIntent}
          onClearIntent={onClearIntent}
          onNavigate={onNavigate}
          onReloadFinance={load}
        />
      )}

      {/* ================= 1B. RÉGUA DE COBRANÇA IVI (SEPARADA DO DIA A DIA) ================= */}
      {activeModule === 'finance_regua' && (
        <ReguaCobrancaIviView onReloadFinance={load} />
      )}

      {/* ================= 1C. CONTAS A PAGAR ================= */}
      {activeModule === 'finance_pagar' && (
        <FinancialTitlesManager
          scope="PAGAR"
          units={units}
          clients={mergedPeople}
          documentTypes={documentTypes}
          bearers={bearers}
          chartOfAccounts={chartOfAccounts}
          bankAccounts={bankAccountsList}
          departments={departments}
          collaborators={collaborators}
          wsTick={wsTick}
          navIntent={navIntent}
          onClearIntent={onClearIntent}
          onNavigate={onNavigate}
          onReloadFinance={load}
        />
      )}

      {/* ================= 2. CONTA CORRENTE ================= */}
      {activeModule === 'finance_conta_corrente' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-lg font-bold text-slate-900">
                Conta Corrente &amp; Movimentações Bancárias
              </h2>
              <p className="text-xs text-slate-500">
                Saldos em tempo real, extratos de caixas, contas correntes e transferências
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => openBankAccModal()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800"
              >
                <Plus className="w-3.5 h-3.5 text-emerald-400" />
                Nova Conta Bancária
              </button>
              <button
                type="button"
                onClick={() => setBankMovModalOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
              >
                <ArrowDownUp className="w-3.5 h-3.5" />
                Registrar Movimentação
              </button>
            </div>
          </div>

          {/* KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="text-[11px] font-medium text-slate-500">Saldo Consolidado Total</div>
              <div className="mt-1 font-mono text-xl font-bold text-emerald-700 tabular-nums">
                {formatBRL(bankAccountsList.reduce((acc, b) => acc + (b.currentBalanceCents || 0), 0))}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="text-[11px] font-medium text-slate-500">Contas Ativas</div>
              <div className="mt-1 font-mono text-xl font-bold text-slate-900 tabular-nums">
                {bankAccountsList.filter((b) => b.active).length} contas
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="text-[11px] font-medium text-slate-500">Movimentações no Período</div>
              <div className="mt-1 font-mono text-xl font-bold text-blue-700 tabular-nums">
                {bankMovementsList.length} registros
              </div>
            </div>
          </div>

          {/* Bank Accounts List Table */}
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 font-bold text-xs text-slate-900">
              Contas Cadastradas
            </div>
            <div className="overflow-x-auto scroll-rulers">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-[11px] font-semibold text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-3">Banco</th>
                    <th className="px-4 py-3">Agência</th>
                    <th className="px-4 py-3">Número da Conta</th>
                    <th className="px-4 py-3">Tipo</th>
                    <th className="px-4 py-3">Saldo Atual</th>
                    <th className="px-4 py-3 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {bankAccountsList.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-slate-500">
                        Nenhuma conta bancária cadastrada.
                      </td>
                    </tr>
                  ) : (
                    bankAccountsList.map((acc) => (
                      <tr key={acc.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-semibold text-slate-900">{acc.bankName}</td>
                        <td className="px-4 py-3 font-mono text-slate-600">{acc.agency || '—'}</td>
                        <td className="px-4 py-3 font-mono text-slate-600">{acc.accountNumber || '—'}</td>
                        <td className="px-4 py-3 uppercase font-mono text-slate-600">{acc.accountType}</td>
                        <td className="px-4 py-3 font-mono font-bold text-slate-900">
                          {formatBRL(acc.currentBalanceCents)}
                        </td>
                        <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => openBankAccModal(acc)}
                            className="text-blue-700 font-semibold hover:underline"
                          >
                            Editar
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setDeleteTarget({ type: 'bank_accounts', id: acc.id, name: acc.bankName })
                            }
                            className="text-red-600 font-semibold hover:underline"
                          >
                            Excluir
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Statement Ledger / Recent Movements */}
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 font-bold text-xs text-slate-900">
              Extrato de Movimentações Recentes
            </div>
            <div className="overflow-x-auto scroll-rulers">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-[11px] font-semibold text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-3">Data</th>
                    <th className="px-4 py-3">Banco / Conta</th>
                    <th className="px-4 py-3">Tipo</th>
                    <th className="px-4 py-3">Descrição</th>
                    <th className="px-4 py-3">Documento</th>
                    <th className="px-4 py-3 text-right">Valor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {bankMovementsList.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-slate-500">
                        Nenhuma movimentação registrada.
                      </td>
                    </tr>
                  ) : (
                    bankMovementsList.map((mov) => {
                      const acc = bankAccountsList.find((b) => b.id === mov.bankAccountId);
                      return (
                        <tr key={mov.id} className="hover:bg-slate-50">
                          <td className="px-4 py-3 font-mono text-slate-600">
                            {formatDateBR(mov.movementDate)}
                          </td>
                          <td className="px-4 py-3 font-semibold text-slate-900">
                            {acc?.bankName || 'Conta'}
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`uppercase font-mono font-semibold ${
                                mov.movementType === 'entrada' ? 'text-emerald-700' : 'text-red-600'
                              }`}
                            >
                              {mov.movementType}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-slate-800">{mov.description}</td>
                          <td className="px-4 py-3 font-mono text-slate-600">
                            {mov.documentNumber || '—'}
                          </td>
                          <td
                            className={`px-4 py-3 font-mono font-bold text-right tabular-nums ${
                              mov.movementType === 'entrada' ? 'text-emerald-700' : 'text-red-600'
                            }`}
                          >
                            {mov.movementType === 'entrada' ? '+' : '-'}
                            {formatBRL(mov.amountCents)}
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

      {/* ================= 2B. MOVIMENTO BANCÁRIO ================= */}
      {activeModule === 'finance_movimento' && (
        <BankMovementManager
          bankAccounts={bankAccountsList}
          bankMovements={bankMovementsList}
          chartOfAccounts={chartOfAccounts}
          highlightMovementId={navIntent?.highlightMovementId}
          onClearIntent={onClearIntent}
          onReload={load}
          onNavigate={onNavigate}
        />
      )}

      {/* ================= 2C. CONCILIAÇÃO BANCÁRIA ================= */}
      {activeModule === 'finance_conciliacao' && (
        <BankReconciliationManager
          bankAccounts={bankAccountsList}
          bankMovements={bankMovementsList}
          chartOfAccounts={chartOfAccounts}
          onReload={load}
        />
      )}

      {/* ================= 3. CADASTROS ================= */}
      {isCadastrosView && (
        <div className="space-y-4">
          {cadMode === 'list' ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="font-display text-lg font-bold text-slate-900">
                    Cadastros · {activeCadLabel}
                  </h2>
                  <p className="text-xs text-slate-500">
                    Gerenciamento corporativo e relacional integrado ao fluxo financeiro
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => openCadForm()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Novo Registro
                </button>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                <div className="overflow-x-auto scroll-rulers">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 text-[11px] font-semibold text-slate-500 border-b border-slate-200">
                      {activeCadTab === 'fornecedores' && (
                        <tr>
                          <th className="px-4 py-3">Nome / Razão Social</th>
                          <th className="px-4 py-3">CPF / CNPJ</th>
                          <th className="px-4 py-3">Telefone</th>
                          <th className="px-4 py-3">Cidade / UF</th>
                          <th className="px-4 py-3 text-right">Ações</th>
                        </tr>
                      )}
                      {activeCadTab === 'document_types' && (
                        <tr>
                          <th className="px-4 py-3">Descrição</th>
                          <th className="px-4 py-3">Categoria</th>
                          <th className="px-4 py-3">Fiscal</th>
                          <th className="px-4 py-3">Exige Número</th>
                          <th className="px-4 py-3 text-right">Ações</th>
                        </tr>
                      )}
                      {activeCadTab === 'bearers' && (
                        <tr>
                          <th className="px-4 py-3">Código</th>
                          <th className="px-4 py-3">Nome do Portador</th>
                          <th className="px-4 py-3">Tipo</th>
                          <th className="px-4 py-3 text-right">Ações</th>
                        </tr>
                      )}
                      {activeCadTab === 'chart_of_accounts' && (
                        <tr>
                          <th className="px-4 py-3">Código</th>
                          <th className="px-4 py-3">Nome da Conta</th>
                          <th className="px-4 py-3">Tipo</th>
                          <th className="px-4 py-3">Analítica</th>
                          <th className="px-4 py-3 text-right">Ações</th>
                        </tr>
                      )}
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {activeCadTab === 'fornecedores' && (
                        suppliers.length === 0 ? (
                          <tr><td colSpan={5} className="py-8 text-center text-slate-500">Nenhum fornecedor cadastrado.</td></tr>
                        ) : (
                          suppliers.map((s) => (
                            <tr key={s.id} className="hover:bg-slate-50">
                              <td className="px-4 py-3 font-semibold text-slate-900">{s.fullName}</td>
                              <td className="px-4 py-3 font-mono text-slate-600">{s.cpfCnpj}</td>
                              <td className="px-4 py-3 font-mono text-slate-600">{s.phone || '—'}</td>
                              <td className="px-4 py-3 text-slate-600">{s.city ? `${s.city}/${s.state}` : '—'}</td>
                              <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                                <button type="button" onClick={() => setAuditTarget({ entityType: 'supplier', entityId: s.id, label: s.fullName })} className="text-slate-500 hover:text-slate-800" title="Auditoria"><History className="w-3.5 h-3.5 inline" /></button>
                                <button type="button" onClick={() => openCadForm(s)} className="text-blue-700 font-semibold hover:underline">Editar</button>
                                <button type="button" onClick={() => setDeleteTarget({ type: 'fornecedores', id: s.id, name: s.fullName })} className="text-red-600 font-semibold hover:underline">Excluir</button>
                              </td>
                            </tr>
                          ))
                        )
                      )}

                      {activeCadTab === 'document_types' && (
                        documentTypes.length === 0 ? (
                          <tr><td colSpan={5} className="py-8 text-center text-slate-500">Nenhum tipo de documento cadastrado.</td></tr>
                        ) : (
                          documentTypes.map((d) => (
                            <tr key={d.id} className="hover:bg-slate-50">
                              <td className="px-4 py-3 font-semibold text-slate-900">{d.description}</td>
                              <td className="px-4 py-3 font-mono uppercase text-slate-600">{d.category}</td>
                              <td className="px-4 py-3 font-semibold text-slate-700">{d.isFiscal ? 'Sim' : 'Não'}</td>
                              <td className="px-4 py-3 font-semibold text-slate-700">{d.requiresNumber ? 'Sim' : 'Não'}</td>
                              <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                                <button type="button" onClick={() => setAuditTarget({ entityType: 'document_type', entityId: d.id, label: d.description })} className="text-slate-500 hover:text-slate-800" title="Auditoria"><History className="w-3.5 h-3.5 inline" /></button>
                                <button type="button" onClick={() => openCadForm(d)} className="text-blue-700 font-semibold hover:underline">Editar</button>
                                <button type="button" onClick={() => setDeleteTarget({ type: 'document_types', id: d.id, name: d.description })} className="text-red-600 font-semibold hover:underline">Excluir</button>
                              </td>
                            </tr>
                          ))
                        )
                      )}

                      {activeCadTab === 'bearers' && (
                        bearers.length === 0 ? (
                          <tr><td colSpan={4} className="py-8 text-center text-slate-500">Nenhum portador cadastrado.</td></tr>
                        ) : (
                          bearers.map((b) => (
                            <tr key={b.id} className="hover:bg-slate-50">
                              <td className="px-4 py-3 font-mono font-semibold text-slate-900">{b.code || '—'}</td>
                              <td className="px-4 py-3 font-semibold text-slate-900">{b.name}</td>
                              <td className="px-4 py-3 uppercase font-mono text-slate-600">{b.type}</td>
                              <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                                <button type="button" onClick={() => setAuditTarget({ entityType: 'bearer', entityId: b.id, label: b.name })} className="text-slate-500 hover:text-slate-800" title="Auditoria"><History className="w-3.5 h-3.5 inline" /></button>
                                <button type="button" onClick={() => openCadForm(b)} className="text-blue-700 font-semibold hover:underline">Editar</button>
                                <button type="button" onClick={() => setDeleteTarget({ type: 'bearers', id: b.id, name: b.name })} className="text-red-600 font-semibold hover:underline">Excluir</button>
                              </td>
                            </tr>
                          ))
                        )
                      )}

                      {activeCadTab === 'chart_of_accounts' && (
                        chartOfAccounts.length === 0 ? (
                          <tr><td colSpan={5} className="py-8 text-center text-slate-500">Nenhuma conta cadastrada no plano.</td></tr>
                        ) : (
                          chartOfAccounts.map((a) => (
                            <tr key={a.id} className="hover:bg-slate-50">
                              <td className="px-4 py-3 font-mono font-bold text-slate-900">{a.code}</td>
                              <td className="px-4 py-3 font-semibold text-slate-900">{a.name}</td>
                              <td className="px-4 py-3 uppercase font-mono text-slate-600">{a.type}</td>
                              <td className="px-4 py-3 font-semibold text-slate-700">{a.isAnalytic ? 'Sim (Analítica)' : 'Não (Sintética)'}</td>
                              <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                                <button type="button" onClick={() => setAuditTarget({ entityType: 'chart_of_accounts', entityId: a.id, label: `${a.code} - ${a.name}` })} className="text-slate-500 hover:text-slate-800" title="Auditoria"><History className="w-3.5 h-3.5 inline" /></button>
                                <button type="button" onClick={() => openCadForm(a)} className="text-blue-700 font-semibold hover:underline">Editar</button>
                                <button type="button" onClick={() => setDeleteTarget({ type: 'chart_of_accounts', id: a.id, name: `${a.code} - ${a.name}` })} className="text-red-600 font-semibold hover:underline">Excluir</button>
                              </td>
                            </tr>
                          ))
                        )
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : (
            /* CADASTROS FORM */
            <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h3 className="font-display text-base font-bold text-slate-900">
                  {editingId ? 'Editar Registro' : 'Novo Registro'} · {activeCadLabel}
                </h3>
                <button type="button" onClick={() => setCadMode('list')} className="text-slate-400 hover:text-slate-700">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleSaveCadastros} className="space-y-4 text-xs">
                {activeCadTab === 'fornecedores' && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    <div className="sm:col-span-2">
                      <label className="block font-semibold text-slate-700 mb-1">Razão Social / Nome Completo *</label>
                      <input type="text" required value={suppName} onChange={(e) => setSuppName(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2" />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">CPF / CNPJ *</label>
                      <input type="text" required value={suppCnpj} onChange={(e) => setSuppCnpj(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono" />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">Natureza</label>
                      <select value={suppNature} onChange={(e) => setSuppNature(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2">
                        <option value="PJ">Pessoa Jurídica (PJ)</option>
                        <option value="PF">Pessoa Física (PF)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">Telefone / WhatsApp</label>
                      <input type="text" value={suppPhone} onChange={(e) => setSuppPhone(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono" />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">E-mail</label>
                      <input type="email" value={suppEmail} onChange={(e) => setSuppEmail(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2" />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">CEP</label>
                      <input type="text" value={suppCep} onChange={(e) => setSuppCep(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono" />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">Cidade</label>
                      <input type="text" value={suppCity} onChange={(e) => setSuppCity(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2" />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">Estado (UF)</label>
                      <select value={suppState} onChange={(e) => setSuppState(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2">
                        <option value="">Selecione...</option>
                        {BRAZILIAN_UFS.map((uf) => <option key={uf} value={uf}>{uf}</option>)}
                      </select>
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block font-semibold text-slate-700 mb-1">Endereço</label>
                      <input type="text" value={suppAddress} onChange={(e) => setSuppAddress(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2" />
                    </div>
                  </div>
                )}

                {activeCadTab === 'document_types' && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    <div className="sm:col-span-2">
                      <label className="block font-semibold text-slate-700 mb-1">Descrição do Documento *</label>
                      <input type="text" required value={docDesc} onChange={(e) => setDocDesc(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2" />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">Categoria</label>
                      <select value={docCategory} onChange={(e) => setDocCategory(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2">
                        <option value="ambos">Ambos (Entrada e Saída)</option>
                        <option value="pagar">Contas a Pagar</option>
                        <option value="receber">Contas a Receber</option>
                      </select>
                    </div>
                    <div className="flex items-center gap-6 pt-6">
                      <label className="flex items-center gap-2 cursor-pointer font-semibold">
                        <input type="checkbox" checked={docFiscal} onChange={(e) => setDocFiscal(e.target.checked)} />
                        Documento Fiscal
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer font-semibold">
                        <input type="checkbox" checked={docRequiresNum} onChange={(e) => setDocRequiresNum(e.target.checked)} />
                        Exige Número
                      </label>
                    </div>
                  </div>
                )}

                {activeCadTab === 'bearers' && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">Código</label>
                      <input type="text" value={bearCode} onChange={(e) => setBearCode(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono" />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">Nome do Portador *</label>
                      <input type="text" required value={bearName} onChange={(e) => setBearName(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2" />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">Tipo</label>
                      <select value={bearType} onChange={(e) => setBearType(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2">
                        <option value="banco">Banco / Conta</option>
                        <option value="caixa">Caixa Físico</option>
                        <option value="cartao">Cartão Corporativo</option>
                      </select>
                    </div>
                  </div>
                )}

                {activeCadTab === 'chart_of_accounts' && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">Código da Conta *</label>
                      <input type="text" required value={acctCode} onChange={(e) => setAcctCode(e.target.value)} placeholder="Ex: 1.1.01" className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono" />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">Nome da Conta *</label>
                      <input type="text" required value={acctName} onChange={(e) => setAcctName(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2" />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">Tipo</label>
                      <select value={acctType} onChange={(e) => setAcctType(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2">
                        <option value="receita">Receita</option>
                        <option value="despesa">Despesa</option>
                        <option value="ativo">Ativo</option>
                        <option value="passivo">Passivo</option>
                      </select>
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">Classificação</label>
                      <select value={acctAnalytic ? 'analytic' : 'synthetic'} onChange={(e) => setAcctAnalytic(e.target.value === 'analytic')} className="w-full rounded-lg border border-slate-200 px-3 py-2">
                        <option value="analytic">Analítica (Lança movimentos)</option>
                        <option value="synthetic">Sintética (Conta pai)</option>
                      </select>
                    </div>
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-3">
                  <button type="button" onClick={() => setCadMode('list')} className="rounded-lg border border-slate-200 px-4 py-2 font-semibold text-slate-700">Cancelar</button>
                  <button type="submit" disabled={busy} className="rounded-lg bg-emerald-600 px-4 py-2 font-semibold text-white hover:bg-emerald-700">Salvar Registro</button>
                </div>
              </form>
            </div>
          )}
        </div>
      )}

      {/* Cover Sheet Modal */}
      {coverSheetTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="font-display text-base font-bold text-slate-900">
                  Folha de Rosto · Emissão de Boletos Restantes
                </h3>
                <p className="text-xs text-slate-500">
                  {coverSheetTarget.protocolCode} · {coverSheetTarget.clientName}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCoverSheetTarget(null)}
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleApproveCoverSheet} className="space-y-3.5 text-xs">
              <div className="rounded-lg bg-slate-50 border border-slate-100 p-3 space-y-1">
                <div>
                  <strong>Credor:</strong> {coverSheetTarget.bankName}
                </div>
                <div>
                  <strong>Parcelas iniciais:</strong> Liquidadas
                </div>
                <div>
                  <strong>Parcelas a gerar:</strong> {coverSheetTarget.remainingInstallments}{' '}
                  boletos Santander
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  1º Vencimento das demais parcelas
                </label>
                <input
                  type="date"
                  required
                  value={firstDueDate}
                  onChange={(e) => setFirstDueDate(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Valor unitário (R$)
                </label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={customAmountReais}
                  onChange={(e) => setCustomAmountReais(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setCoverSheetTarget(null)}
                  className="rounded-lg border border-slate-200 px-4 py-2 font-semibold text-slate-700"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 font-semibold text-white hover:bg-emerald-700"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Aprovar &amp; Emitir Boletos
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Bank Account Modal */}
      {bankAccModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-display text-base font-bold text-slate-900">
                {editingBankAccId ? 'Editar Conta Bancária' : 'Nova Conta Bancária'}
              </h3>
              <button type="button" onClick={() => setBankAccModalOpen(false)}>
                <X className="w-4 h-4 text-slate-400" />
              </button>
            </div>
            <form onSubmit={handleSaveBankAccount} className="space-y-3.5 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Nome do Banco *</label>
                <input
                  type="text"
                  required
                  value={bankNameInput}
                  onChange={(e) => setBankNameInput(e.target.value)}
                  placeholder="Ex: Santander, Itaú, Banco do Brasil..."
                  className="w-full rounded-lg border border-slate-200 px-3 py-2"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Agência</label>
                  <input
                    type="text"
                    value={bankAgencyInput}
                    onChange={(e) => setBankAgencyInput(e.target.value)}
                    placeholder="Ex: 0001"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Conta</label>
                  <input
                    type="text"
                    value={bankAccountNumberInput}
                    onChange={(e) => setBankAccountNumberInput(e.target.value)}
                    placeholder="Ex: 12345-6"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Tipo de Conta</label>
                  <select
                    value={bankAccountTypeInput}
                    onChange={(e) => setBankAccountTypeInput(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2"
                  >
                    <option value="corrente">Conta Corrente</option>
                    <option value="poupanca">Poupança</option>
                    <option value="caixa">Caixa / Tesouraria</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Saldo Inicial (R$)</label>
                  <input
                    type="number"
                    step="0.01"
                    disabled={Boolean(editingBankAccId)}
                    value={bankInitialBalanceReais}
                    onChange={(e) => setBankInitialBalanceReais(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setBankAccModalOpen(false)}
                  className="rounded-lg border border-slate-200 px-4 py-2 font-semibold text-slate-700"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-lg bg-emerald-600 px-4 py-2 font-semibold text-white hover:bg-emerald-700"
                >
                  Salvar Conta
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Bank Movement Modal */}
      {bankMovModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-display text-base font-bold text-slate-900">
                Registrar Movimentação Bancária
              </h3>
              <button type="button" onClick={() => setBankMovModalOpen(false)}>
                <X className="w-4 h-4 text-slate-400" />
              </button>
            </div>
            <form onSubmit={handleSaveBankMovement} className="space-y-3.5 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Conta Bancária *</label>
                <select
                  required
                  value={movBankAccountId}
                  onChange={(e) => setMovBankAccountId(Number(e.target.value))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2"
                >
                  <option value="">Selecione a conta...</option>
                  {bankAccountsList.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.bankName} - Ag: {acc.agency || '—'} / CC: {acc.accountNumber || '—'} ({formatBRL(acc.currentBalanceCents)})
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Tipo de Movimento *</label>
                  <select
                    value={movType}
                    onChange={(e) => setMovType(e.target.value as any)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 font-semibold"
                  >
                    <option value="entrada">Entrada (Crédito)</option>
                    <option value="saida">Saída (Débito)</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Valor (R$) *</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={movAmountReais}
                    onChange={(e) => setMovAmountReais(e.target.value)}
                    placeholder="0.00"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono"
                  />
                </div>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Descrição / Histórico *</label>
                <input
                  type="text"
                  required
                  value={movDesc}
                  onChange={(e) => setMovDesc(e.target.value)}
                  placeholder="Ex: Recebimento de honorários, Pagamento fornecedor..."
                  className="w-full rounded-lg border border-slate-200 px-3 py-2"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Nº Documento / Comprovante</label>
                <input
                  type="text"
                  value={movDoc}
                  onChange={(e) => setMovDoc(e.target.value)}
                  placeholder="Ex: DOC-99281"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setBankMovModalOpen(false)}
                  className="rounded-lg border border-slate-200 px-4 py-2 font-semibold text-slate-700"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-lg bg-emerald-600 px-4 py-2 font-semibold text-white hover:bg-emerald-700"
                >
                  Registrar Movimento
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Entity Audit Modal */}
      {auditTarget && (
        <EntityAuditModal
          open={Boolean(auditTarget)}
          title={auditTarget.label}
          entityType={auditTarget.entityType}
          entityId={auditTarget.entityId}
          onClose={() => setAuditTarget(null)}
        />
      )}

      {/* Confirm Delete Modal */}
      <ConfirmDeleteModal
        open={Boolean(deleteTarget)}
        title="Confirmar Exclusão"
        description={`Deseja realmente excluir "${deleteTarget?.name}"? Esta ação removerá o registro e verificará dependências em títulos financeiros e contas.`}
        busy={deleteBusy}
        error={deleteErr}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
};
