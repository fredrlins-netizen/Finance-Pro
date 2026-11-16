import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  FileText,
  Landmark,
  Pencil,
  Save,
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
import {
  centsToMaskInput,
  formatCurrencyTyping,
  formatIsoDateToBR,
  parseMaskInputToCents,
  toIsoDateOnly,
} from './currencyAndParsers.ts';

interface FinancialTitleFormViewProps {
  scope: 'RECEBER' | 'PAGAR';
  editingTitle: FinancialTitle | null;
  allLoadedTitles: FinancialTitle[];
  clients: Client[];
  units: Unit[];
  documentTypes: DocumentTypeItem[];
  bearers: BearerItem[];
  chartOfAccounts: ChartAccountItem[];
  bankAccounts: BankAccount[];
  departments: DepartmentItem[];
  collaborators: CollaboratorItem[];
  onClose: () => void;
  onSaved: (savedTitle: FinancialTitle, isNew: boolean) => Promise<void>;
  onOpenEditPartner: (client: Client) => void;
  onOpenAdmissionViewer: (admissionId: number, contractRef: string) => void;
  onSelectRelatedTitle: (title: FinancialTitle) => void;
  onNavigate?: (mod: ModuleId, intent?: NavigationIntent) => void;
}

export const FinancialTitleFormView: React.FC<FinancialTitleFormViewProps> = ({
  scope,
  editingTitle,
  allLoadedTitles,
  clients,
  units,
  documentTypes,
  bearers,
  chartOfAccounts,
  bankAccounts,
  departments,
  collaborators,
  onClose,
  onSaved,
  onOpenEditPartner,
  onOpenAdmissionViewer,
  onSelectRelatedTitle,
  onNavigate,
}) => {
  const isReceber = scope === 'RECEBER';
  const personLabel = isReceber ? 'Parceiro / Cliente' : 'Fornecedor';
  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const [activeTab, setActiveTab] = useState<'dados' | 'classificacao' | 'baixas'>('dados');
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Tab 1: Dados do Título
  const [documentNumber, setDocumentNumber] = useState('');
  const [titleType, setTitleType] = useState<'PADRAO' | 'ADIANTAMENTO' | 'DEVOLUCAO'>('PADRAO');
  const [clientId, setClientId] = useState<string>('');
  const [collectionStatus, setCollectionStatus] = useState<'EM_DIA' | 'COBRAR' | 'NAO_COBRAR'>('COBRAR');
  const [documentTypeId, setDocumentTypeId] = useState<string>('');
  const [bearerId, setBearerId] = useState<string>('');
  const [description, setDescription] = useState('');
  const [issueDate, setIssueDate] = useState(todayIso);
  const [dueDate, setDueDate] = useState(todayIso);
  const [forecastDate, setForecastDate] = useState(todayIso);
  const [amountMask, setAmountMask] = useState('0,00');
  const [interestMask, setInterestMask] = useState('0,00');
  const [discountMask, setDiscountMask] = useState('0,00');
  const [fineMask, setFineMask] = useState('0,00');
  const [discountValidUntil, setDiscountValidUntil] = useState('');

  // Tab 2: Classificação e Origem
  const [departmentId, setDepartmentId] = useState<string>('');
  const [unitId, setUnitId] = useState<string>(String(units[0]?.id || '1'));
  const [chartAccountId, setChartAccountId] = useState<string>('');
  const [bankAccountId, setBankAccountId] = useState<string>('');
  const [sellerId, setSellerId] = useState<string>('');
  const [assignedCollaboratorId, setAssignedCollaboratorId] = useState<string>('');
  const [accountingType, setAccountingType] = useState<'NAO_CONTABIL' | 'CONTABIL'>('NAO_CONTABIL');
  const [installmentNumber, setInstallmentNumber] = useState('1');
  const [totalInstallments, setTotalInstallments] = useState('1');
  const [isProtested, setIsProtested] = useState(false);
  const [isProvision, setIsProvision] = useState(false);

  // Tab 3: Baixas do Título
  const [settlements, setSettlements] = useState<TitleSettlement[]>([]);
  const [loadingSettlements, setLoadingSettlements] = useState(false);

  useEffect(() => {
    setErrorMsg('');
    if (editingTitle) {
      setDocumentNumber(editingTitle.documentNumber || editingTitle.titleCode || '');
      const tType = String(editingTitle.titleType || 'PADRAO').toUpperCase();
      setTitleType(
        tType === 'ADIANTAMENTO' || tType === 'DEVOLUCAO' ? tType : 'PADRAO'
      );
      setClientId(editingTitle.clientId ? String(editingTitle.clientId) : '');
      setCollectionStatus(
        (editingTitle.collectionStatus as 'EM_DIA' | 'COBRAR' | 'NAO_COBRAR') || 'COBRAR'
      );
      setDocumentTypeId(editingTitle.documentTypeId ? String(editingTitle.documentTypeId) : '');
      setBearerId(editingTitle.bearerId ? String(editingTitle.bearerId) : '');
      setDescription(editingTitle.description || '');
      setIssueDate(toIsoDateOnly(editingTitle.issueDate) || todayIso);
      const dd = toIsoDateOnly(editingTitle.dueDate) || todayIso;
      setDueDate(dd);
      setForecastDate(toIsoDateOnly(editingTitle.forecastDate) || dd);
      setAmountMask(centsToMaskInput(editingTitle.amountCents || 0));
      setInterestMask(centsToMaskInput(editingTitle.interestCents || 0));
      setDiscountMask(centsToMaskInput(editingTitle.discountCents || 0));
      setFineMask(centsToMaskInput(editingTitle.fineCents || 0));
      setDiscountValidUntil(toIsoDateOnly(editingTitle.discountValidUntil));

      setDepartmentId(editingTitle.departmentId ? String(editingTitle.departmentId) : '');
      setUnitId(editingTitle.unitId ? String(editingTitle.unitId) : String(units[0]?.id || '1'));
      setChartAccountId(editingTitle.chartAccountId ? String(editingTitle.chartAccountId) : '');
      setBankAccountId(editingTitle.bankAccountId ? String(editingTitle.bankAccountId) : '');
      setSellerId(editingTitle.sellerId ? String(editingTitle.sellerId) : '');
      setAssignedCollaboratorId(
        editingTitle.assignedCollaboratorId ? String(editingTitle.assignedCollaboratorId) : ''
      );
      setAccountingType(
        editingTitle.accountingType === 'CONTABIL' ? 'CONTABIL' : 'NAO_CONTABIL'
      );
      setInstallmentNumber(String(editingTitle.installmentNumber || 1));
      setTotalInstallments(String(editingTitle.totalInstallments || 1));
      setIsProtested(Boolean(editingTitle.isProtested));
      setIsProvision(Boolean(editingTitle.isProvision));
    } else {
      setDocumentNumber('');
      setTitleType('PADRAO');
      setClientId('');
      setCollectionStatus('COBRAR');
      setDocumentTypeId('');
      setBearerId('');
      setDescription('');
      setIssueDate(todayIso);
      setDueDate(todayIso);
      setForecastDate(todayIso);
      setAmountMask('0,00');
      setInterestMask('0,00');
      setDiscountMask('0,00');
      setFineMask('0,00');
      setDiscountValidUntil('');
      setDepartmentId('');
      setUnitId(String(units[0]?.id || '1'));
      setChartAccountId('');
      setBankAccountId('');
      setSellerId('');
      setAssignedCollaboratorId('');
      setAccountingType('NAO_CONTABIL');
      setInstallmentNumber('1');
      setTotalInstallments('1');
      setIsProtested(false);
      setIsProvision(false);
      setActiveTab('dados');
    }
  }, [editingTitle, todayIso, units]);

  useEffect(() => {
    if (!editingTitle?.id) {
      setSettlements([]);
      return;
    }
    setLoadingSettlements(true);
    apiFetch<{ settlements: TitleSettlement[] }>(`/api/financial-titles/${editingTitle.id}/settlements`)
      .then((res) => setSettlements(res.settlements || []))
      .catch(() => setSettlements([]))
      .finally(() => setLoadingSettlements(false));
  }, [editingTitle?.id, activeTab]);

  const selectedPerson = useMemo(
    () => clients.find((c) => String(c.id) === clientId) || null,
    [clients, clientId]
  );

  const isPersonBlocked =
    selectedPerson?.status === 'suspenso' || selectedPerson?.status === 'cancelado';

  const analyticAccounts = useMemo(
    () => chartOfAccounts.filter((c) => c.active !== false && c.isAnalytic),
    [chartOfAccounts]
  );

  const activeCollaborators = useMemo(
    () => collaborators.filter((c) => c.active !== false),
    [collaborators]
  );

  const sortedPeople = useMemo(() => {
    const copy = [...clients];
    if (!isReceber) {
      // Suppliers first in Contas a Pagar for convenience, while still showing shared registry
      copy.sort((a, b) => {
        const aSup = (a as any).natureza === 'F' ? 0 : 1;
        const bSup = (b as any).natureza === 'F' ? 0 : 1;
        if (aSup !== bSup) return aSup - bSup;
        return a.fullName.localeCompare(b.fullName);
      });
    } else {
      copy.sort((a, b) => a.fullName.localeCompare(b.fullName));
    }
    return copy;
  }, [clients, isReceber]);

  const stUpper = String(editingTitle?.status || 'ABERTO').toUpperCase();
  const isFinalOrGrouped = ['PAGO', 'CANCELADO', 'AGRUPADO', 'PARCIAL', 'FATURA_GERADA'].includes(
    stUpper
  );
  const disableInstallmentEdit = Boolean(editingTitle?.parentId || editingTitle?.recurrenceId);

  const invoiceGroupInfo = useMemo(() => {
    if (!editingTitle?.invoiceGroupId) return null;
    const groupRows = allLoadedTitles.filter((t) => t.invoiceGroupId === editingTitle.invoiceGroupId);
    const isOrigin = stUpper === 'AGRUPADO';
    const relatedInvoices = groupRows.filter((t) => String(t.titleType).toUpperCase() === 'FATURA');
    const relatedOrigins = groupRows.filter((t) => String(t.titleType).toUpperCase() !== 'FATURA');
    return { isOrigin, relatedInvoices, relatedOrigins };
  }, [editingTitle?.invoiceGroupId, allLoadedTitles, stUpper]);

  const submitSave = async () => {
    setErrorMsg('');
    if (isPersonBlocked) {
      setErrorMsg(`Operação bloqueada: ${selectedPerson?.fullName} está com status "${selectedPerson?.status.toUpperCase()}".`);
      return;
    }
    if (!documentNumber.trim()) return setErrorMsg('Informe o Nº Documento.');
    if (!clientId) return setErrorMsg(`Selecione o ${personLabel}.`);
    if (!documentTypeId) return setErrorMsg('Selecione o Tipo de Documento.');
    if (!bearerId) return setErrorMsg('Selecione o Portador.');
    if (!description.trim()) return setErrorMsg('Informe o Histórico do lançamento.');
    const amountCents = parseMaskInputToCents(amountMask);
    if (amountCents <= 0) return setErrorMsg('O Valor Total deve ser maior que zero.');

    setBusy(true);
    try {
      const payload = {
        scope,
        titleType,
        documentNumber: documentNumber.trim(),
        clientId: Number(clientId),
        collectionStatus: isReceber ? collectionStatus : 'EM_DIA',
        documentTypeId: Number(documentTypeId),
        bearerId: Number(bearerId),
        description: description.trim(),
        issueDate,
        dueDate,
        forecastDate: forecastDate || dueDate,
        amountCents,
        interestCents: parseMaskInputToCents(interestMask),
        discountCents: parseMaskInputToCents(discountMask),
        fineCents: parseMaskInputToCents(fineMask),
        discountValidUntil: discountValidUntil || null,
        departmentId: departmentId ? Number(departmentId) : null,
        unitId: Number(unitId || units[0]?.id || 1),
        chartAccountId: chartAccountId ? Number(chartAccountId) : null,
        bankAccountId: bankAccountId ? Number(bankAccountId) : null,
        sellerId: sellerId ? Number(sellerId) : null,
        assignedCollaboratorId: assignedCollaboratorId ? Number(assignedCollaboratorId) : null,
        accountingType,
        installmentNumber: Math.max(1, Number(installmentNumber || 1)),
        totalInstallments: Math.max(1, Number(totalInstallments || 1)),
        isProtested: titleType === 'PADRAO' && !isFinalOrGrouped ? isProtested : false,
        isProvision: titleType === 'PADRAO' && !isFinalOrGrouped && !isProtested ? isProvision : false,
      };

      const res = editingTitle
        ? await apiFetch<{ title: FinancialTitle }>(`/api/financial-titles/${editingTitle.id}`, {
            method: 'PUT',
            body: JSON.stringify(payload),
          })
        : await apiFetch<{ title: FinancialTitle }>('/api/financial-titles', {
            method: 'POST',
            body: JSON.stringify(payload),
          });

      await onSaved(res.title, !editingTitle);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao salvar título.');
    } finally {
      setBusy(false);
    }
  };

  // Ctrl+Enter / Command+Enter shortcut
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        submitSave();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const settlementTotals = useMemo(() => {
    const settledSum = settlements.reduce((a, s) => a + Number(s.amountCents || 0), 0);
    const interestSum = settlements.reduce((a, s) => a + Number(s.interestCents || 0), 0);
    const fineSum = settlements.reduce((a, s) => a + Number(s.fineCents || 0), 0);
    const discountSum = settlements.reduce((a, s) => a + Number(s.discountCents || 0), 0);
    const orig = editingTitle?.originalValueCents || editingTitle?.amountCents || 0;
    const bal =
      editingTitle?.currentBalanceCents !== undefined
        ? editingTitle.currentBalanceCents
        : Math.max(0, orig - settledSum);
    return { count: settlements.length, settledSum, interestSum, fineSum, discountSum, orig, bal };
  }, [settlements, editingTitle]);

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden dark:border-slate-700 dark:bg-slate-900">
      {/* Header */}
      <div className="px-5 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50/70 dark:border-slate-700 dark:bg-slate-800/60">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 min-h-[36px] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Voltar
          </button>
          <div>
            <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
              {editingTitle
                ? `Editar Título · ${editingTitle.documentNumber || editingTitle.titleCode}`
                : `Novo Lançamento · Contas a ${isReceber ? 'Receber' : 'Pagar'}`}
            </h2>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              {editingTitle
                ? `Status atual: ${stUpper} · Preencha e pressione Ctrl+Enter para salvar`
                : 'Preencha os campos obrigatórios (*) e salve (Ctrl+Enter)'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={busy || isPersonBlocked}
            onClick={submitSave}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            <Save className="w-3.5 h-3.5" />
            {busy ? 'Salvando...' : 'Salvar Título'}
          </button>
        </div>
      </div>

      {/* Conditional Banners */}
      <div className="px-5 pt-4 space-y-3">
        {isPersonBlocked && (
          <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-xs text-red-900 flex items-center gap-2 dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300">
            <AlertTriangle className="w-4 h-4 text-red-700 shrink-0 dark:text-red-300" />
            <div>
              <strong>Pessoa bloqueada (Somente Consulta):</strong> {selectedPerson?.fullName} está com status{' '}
              <strong>{selectedPerson?.status.toUpperCase()}</strong>. Salvamento desabilitado para proteção operacional.
            </div>
          </div>
        )}

        {isReceber && editingTitle && (editingTitle.origin === 'AUDITORIA' || editingTitle.admissionId) && (
          <div className="rounded-lg border border-blue-200 bg-blue-50/70 px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs dark:border-blue-800/70 dark:bg-blue-950/50">
            <div className="flex items-center gap-2 text-blue-950 dark:text-blue-300">
              <FileText className="w-4 h-4 text-blue-700 shrink-0 dark:text-blue-300" />
              <span>
                <strong>Auditoria:</strong> Lançamento gerado pela Auditoria · Contrato ref.{' '}
                <span className="font-mono font-semibold">
                  {editingTitle.contractNumber || editingTitle.documentNumber || editingTitle.titleCode}
                </span>
              </span>
            </div>
            {editingTitle.admissionId && (
              <button
                type="button"
                onClick={() =>
                  onOpenAdmissionViewer(
                    editingTitle.admissionId!,
                    editingTitle.documentNumber || editingTitle.titleCode
                  )
                }
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-800"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Visualizar Ficha / Contrato
              </button>
            )}
          </div>
        )}

        {errorMsg && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-800 flex items-center justify-between dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300">
            <span>{errorMsg}</span>
            <button type="button" onClick={() => setErrorMsg('')}>
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* 3 Tabs */}
      <div className="px-5 pt-4 border-b border-slate-200 flex items-center gap-1 dark:border-slate-700">
        {[
          { id: 'dados' as const, label: 'Dados do Título' },
          { id: 'classificacao' as const, label: 'Classificação e Origem' },
          {
            id: 'baixas' as const,
            label: `Baixas do Título${editingTitle ? ` (${settlements.length})` : ''}`,
          },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap ${
              activeTab === tab.id
                ? 'border-slate-900 text-slate-900 dark:border-emerald-500 dark:text-slate-100'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Form Content */}
      <div className="p-5 text-xs">
        {activeTab === 'dados' && (
          <div className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
              <div className="md:col-span-3">
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Nº Documento *</label>
                <input
                  type="text"
                  value={documentNumber}
                  onChange={(e) => setDocumentNumber(e.target.value)}
                  placeholder="Ex: BOL-10023"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>

              <div className="md:col-span-3">
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Tipo do Título</label>
                <select
                  value={titleType}
                  onChange={(e) => setTitleType(e.target.value as any)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 bg-white font-semibold dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                >
                  <option value="PADRAO">Padrão</option>
                  <option value="ADIANTAMENTO">Adiantamento</option>
                  <option value="DEVOLUCAO">Devolução</option>
                </select>
              </div>

              <div className={isReceber ? 'md:col-span-4' : 'md:col-span-6'}>
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">{personLabel} *</label>
                <div className="flex items-center gap-2">
                  <select
                    value={clientId}
                    onChange={(e) => setClientId(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 bg-white dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  >
                    <option value="">Selecione...</option>
                    {sortedPeople.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.fullName} {p.cpfCnpj ? `(${p.cpfCnpj})` : ''}
                        {p.status === 'suspenso' || p.status === 'cancelado' ? ` [${p.status.toUpperCase()}]` : ''}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={!selectedPerson}
                    onClick={() => selectedPerson && onOpenEditPartner(selectedPerson)}
                    title={`Editar cadastro de ${personLabel}`}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-40 whitespace-nowrap dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    Editar
                  </button>
                </div>
              </div>

              {isReceber && (
                <div className="md:col-span-2">
                  <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Situação Cobrança</label>
                  <select
                    value={collectionStatus}
                    onChange={(e) => setCollectionStatus(e.target.value as any)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 bg-white dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  >
                    <option value="COBRAR">Cobrar (Régua)</option>
                    <option value="EM_DIA">Em dia</option>
                    <option value="NAO_COBRAR">Não Cobrar</option>
                  </select>
                </div>
              )}

              <div className="md:col-span-6">
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Tipo de Documento *</label>
                <select
                  value={documentTypeId}
                  onChange={(e) => setDocumentTypeId(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 bg-white dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                >
                  <option value="">Selecione...</option>
                  {documentTypes
                    .filter((d) => d.active !== false)
                    .map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.description}
                      </option>
                    ))}
                </select>
              </div>

              <div className="md:col-span-6">
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Portador *</label>
                <select
                  value={bearerId}
                  onChange={(e) => setBearerId(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 bg-white dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                >
                  <option value="">Selecione...</option>
                  {bearers
                    .filter((b) => b.active !== false)
                    .map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.code ? `${b.code} - ` : ''}{b.name}
                      </option>
                    ))}
                </select>
              </div>

              <div className="md:col-span-12">
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Histórico / Descrição *</label>
                <textarea
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Descreva claramente do que se trata este lançamento..."
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700"
                />
              </div>
            </div>

            <div className="border-t border-slate-200 pt-4 dark:border-slate-700">
              <h3 className="font-bold text-slate-900 mb-3 dark:text-slate-100">Valores e Prazos</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Data de Emissão</label>
                  <input
                    type="date"
                    value={issueDate}
                    onChange={(e) => setIssueDate(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Data de Vencimento *</label>
                  <input
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Data de Previsão</label>
                  <input
                    type="date"
                    value={forecastDate}
                    onChange={(e) => setForecastDate(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Validade Desconto</label>
                  <input
                    type="date"
                    value={discountValidUntil}
                    onChange={(e) => setDiscountValidUntil(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Valor Total (R$) *</label>
                  <input
                    type="text"
                    value={amountMask}
                    onChange={(e) => setAmountMask(formatCurrencyTyping(e.target.value))}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono font-bold text-slate-900 text-right tabular-nums dark:border-slate-700 dark:text-slate-100 dark:bg-slate-950"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Juros Previstos (R$)</label>
                  <input
                    type="text"
                    value={interestMask}
                    onChange={(e) => setInterestMask(formatCurrencyTyping(e.target.value))}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-right tabular-nums dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Multa Prevista (R$)</label>
                  <input
                    type="text"
                    value={fineMask}
                    onChange={(e) => setFineMask(formatCurrencyTyping(e.target.value))}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-right tabular-nums dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Desconto (R$)</label>
                  <input
                    type="text"
                    value={discountMask}
                    onChange={(e) => setDiscountMask(formatCurrencyTyping(e.target.value))}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-right tabular-nums dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'classificacao' && (
          <div className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <div>
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Unidade</label>
                <select
                  value={unitId}
                  onChange={(e) => setUnitId(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 bg-white dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                >
                  {units.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.code} · {u.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Departamento</label>
                <select
                  value={departmentId}
                  onChange={(e) => setDepartmentId(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 bg-white dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                >
                  <option value="">Sem departamento</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.code ? `${d.code} - ` : ''}{d.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Categoria Contábil (Analítica)</label>
                <select
                  value={chartAccountId}
                  onChange={(e) => setChartAccountId(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 bg-white dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                >
                  <option value="">Selecione...</option>
                  {analyticAccounts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code} - {c.name} ({c.type})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Conta Bancária Sugerida</label>
                <select
                  value={bankAccountId}
                  onChange={(e) => setBankAccountId(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 bg-white dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                >
                  <option value="">Nenhuma</option>
                  {bankAccounts.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.bankName} {b.agency ? `· Ag ${b.agency}` : ''} {b.accountNumber ? `/ CC ${b.accountNumber}` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Vendedor</label>
                <select
                  value={sellerId}
                  onChange={(e) => setSellerId(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 bg-white dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                >
                  <option value="">Nenhum</option>
                  {activeCollaborators.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Colaborador Responsável</label>
                <select
                  value={assignedCollaboratorId}
                  onChange={(e) => setAssignedCollaboratorId(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 bg-white dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                >
                  <option value="">Nenhum</option>
                  {activeCollaborators.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Tipo Contábil</label>
                <select
                  value={accountingType}
                  onChange={(e) => setAccountingType(e.target.value as any)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 bg-white dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                >
                  <option value="NAO_CONTABIL">Não Contábil</option>
                  <option value="CONTABIL">Contábil</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Parcela</label>
                <input
                  type="number"
                  min={1}
                  disabled={disableInstallmentEdit}
                  value={installmentNumber}
                  onChange={(e) => setInstallmentNumber(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono disabled:bg-slate-50 dark:border-slate-700"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Total Parcelas</label>
                <input
                  type="number"
                  min={1}
                  disabled={disableInstallmentEdit}
                  value={totalInstallments}
                  onChange={(e) => setTotalInstallments(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono disabled:bg-slate-50 dark:border-slate-700"
                />
              </div>
            </div>

            {titleType === 'PADRAO' && !isFinalOrGrouped && (
              <div className="border-t border-slate-200 pt-4 flex flex-wrap items-center gap-6 dark:border-slate-700">
                <label className="inline-flex items-center gap-2 cursor-pointer font-semibold text-slate-700 dark:text-slate-200">
                  <input
                    type="checkbox"
                    checked={isProtested}
                    onChange={(e) => {
                      setIsProtested(e.target.checked);
                      if (e.target.checked) setIsProvision(false);
                    }}
                  />
                  <span>Protestar título (bloqueia baixa sem liberação)</span>
                </label>

                <label className="inline-flex items-center gap-2 cursor-pointer font-semibold text-slate-700 dark:text-slate-200">
                  <input
                    type="checkbox"
                    checked={isProvision}
                    disabled={isProtested}
                    onChange={(e) => setIsProvision(e.target.checked)}
                  />
                  <span>Marcar como provisão (previsão interna)</span>
                </label>
              </div>
            )}
          </div>
        )}

        {activeTab === 'baixas' && (
          <div className="space-y-4">
            {!editingTitle ? (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-6 text-center text-slate-500 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-400">
                Salve o título primeiro para consultar baixas e vínculos financeiros.
              </div>
            ) : (
              <>
                {invoiceGroupInfo && (
                  <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-4 space-y-3 dark:border-blue-800/70 dark:bg-blue-950/50">
                    <div className="flex items-center justify-between text-xs font-bold text-blue-950 dark:text-blue-300">
                      <span>
                        Rastreabilidade de Faturamento · Grupo{' '}
                        <span className="font-mono">{editingTitle.invoiceGroupId?.slice(0, 8)}</span>
                      </span>
                      <span>
                        {invoiceGroupInfo.isOrigin ? 'Baixada Por Fatura' : 'Fatura Gerada'}
                      </span>
                    </div>

                    {invoiceGroupInfo.isOrigin && invoiceGroupInfo.relatedInvoices.length > 0 && (
                      <div className="bg-white rounded-lg border border-blue-200 overflow-hidden dark:bg-slate-900 dark:border-blue-800/70">
                        <div className="px-3 py-2 bg-blue-50 text-[11px] font-bold text-blue-900 dark:bg-blue-950/50 dark:text-blue-300">
                          Faturas Geradas (clique para abrir)
                        </div>
                        <table className="w-full text-left text-[11px]">
                          <thead className="border-b border-slate-100 text-slate-500 dark:border-slate-800 dark:text-slate-400">
                            <tr>
                              <th className="px-3 py-1.5">Documento</th>
                              <th className="px-3 py-1.5">Parcela</th>
                              <th className="px-3 py-1.5">Vencimento</th>
                              <th className="px-3 py-1.5 text-right">Valor</th>
                              <th className="px-3 py-1.5">Status</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                            {invoiceGroupInfo.relatedInvoices.map((inv) => (
                              <tr
                                key={inv.id}
                                onClick={() => onSelectRelatedTitle(inv)}
                                className="hover:bg-blue-50/40 cursor-pointer"
                              >
                                <td className="px-3 py-1.5 font-mono font-semibold text-blue-700 dark:text-blue-300">
                                  {inv.documentNumber || inv.titleCode}
                                </td>
                                <td className="px-3 py-1.5 font-mono">
                                  {inv.installmentNumber}/{inv.totalInstallments}
                                </td>
                                <td className="px-3 py-1.5 font-mono">{formatIsoDateToBR(inv.dueDate)}</td>
                                <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                                  {formatBRL(inv.amountCents)}
                                </td>
                                <td className="px-3 py-1.5 font-semibold">{inv.status.toUpperCase()}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {!invoiceGroupInfo.isOrigin && invoiceGroupInfo.relatedOrigins.length > 0 && (
                      <div className="bg-white rounded-lg border border-blue-200 overflow-hidden dark:bg-slate-900 dark:border-blue-800/70">
                        <div className="px-3 py-2 bg-blue-50 text-[11px] font-bold text-blue-900 dark:bg-blue-950/50 dark:text-blue-300">
                          Títulos de Origem Agrupados (clique para abrir)
                        </div>
                        <table className="w-full text-left text-[11px]">
                          <thead className="border-b border-slate-100 text-slate-500 dark:border-slate-800 dark:text-slate-400">
                            <tr>
                              <th className="px-3 py-1.5">Documento</th>
                              <th className="px-3 py-1.5">Descrição</th>
                              <th className="px-3 py-1.5">Vencimento</th>
                              <th className="px-3 py-1.5 text-right">Valor Original</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                            {invoiceGroupInfo.relatedOrigins.map((orig) => (
                              <tr
                                key={orig.id}
                                onClick={() => onSelectRelatedTitle(orig)}
                                className="hover:bg-blue-50/40 cursor-pointer"
                              >
                                <td className="px-3 py-1.5 font-mono font-semibold text-blue-700 dark:text-blue-300">
                                  {orig.documentNumber || orig.titleCode}
                                </td>
                                <td className="px-3 py-1.5">{orig.description}</td>
                                <td className="px-3 py-1.5 font-mono">{formatIsoDateToBR(orig.dueDate)}</td>
                                <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                                  {formatBRL(orig.originalValueCents || orig.amountCents)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5">
                  <div className="rounded-lg border border-slate-200 p-2.5 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/70">
                    <div className="text-[10px] text-slate-500 dark:text-slate-400">Baixas</div>
                    <div className="font-mono font-bold text-slate-900 tabular-nums dark:text-slate-100">{settlementTotals.count}</div>
                  </div>
                  <div className="rounded-lg border border-slate-200 p-2.5 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/70">
                    <div className="text-[10px] text-slate-500 dark:text-slate-400">Valor Original</div>
                    <div className="font-mono font-bold text-slate-900 tabular-nums dark:text-slate-100">
                      {formatBRL(settlementTotals.orig)}
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-200 p-2.5 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/70">
                    <div className="text-[10px] text-slate-500 dark:text-slate-400">Total Baixado</div>
                    <div className="font-mono font-bold text-emerald-700 tabular-nums dark:text-emerald-300">
                      {formatBRL(settlementTotals.settledSum)}
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-200 p-2.5 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/70">
                    <div className="text-[10px] text-slate-500 dark:text-slate-400">Saldo Aberto</div>
                    <div className="font-mono font-bold text-blue-700 tabular-nums dark:text-blue-300">
                      {formatBRL(settlementTotals.bal)}
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-200 p-2.5 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/70">
                    <div className="text-[10px] text-slate-500 dark:text-slate-400">Juros</div>
                    <div className="font-mono font-bold text-slate-700 tabular-nums dark:text-slate-200">
                      {formatBRL(settlementTotals.interestSum)}
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-200 p-2.5 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/70">
                    <div className="text-[10px] text-slate-500 dark:text-slate-400">Multas</div>
                    <div className="font-mono font-bold text-slate-700 tabular-nums dark:text-slate-200">
                      {formatBRL(settlementTotals.fineSum)}
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-200 p-2.5 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/70">
                    <div className="text-[10px] text-slate-500 dark:text-slate-400">Descontos</div>
                    <div className="font-mono font-bold text-slate-700 tabular-nums dark:text-slate-200">
                      {formatBRL(settlementTotals.discountSum)}
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 overflow-hidden dark:border-slate-700">
                  <div className="overflow-x-auto scroll-rulers">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 text-[11px] font-semibold text-slate-500 border-b border-slate-200 dark:bg-slate-800/70 dark:text-slate-400 dark:border-slate-700">
                        <tr>
                          <th className="px-3 py-2">Seq</th>
                          <th className="px-3 py-2">Data</th>
                          <th className="px-3 py-2 text-right">Juros</th>
                          <th className="px-3 py-2 text-right">Multa</th>
                          <th className="px-3 py-2 text-right">Desconto</th>
                          <th className="px-3 py-2 text-right">Valor Pago</th>
                          <th className="px-3 py-2">Origem</th>
                          <th className="px-3 py-2">Histórico</th>
                          <th className="px-3 py-2 text-right">Movimento</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {loadingSettlements ? (
                          <tr>
                            <td colSpan={9} className="py-6 text-center text-slate-500 dark:text-slate-400">
                              Carregando histórico de baixas...
                            </td>
                          </tr>
                        ) : settlements.length === 0 ? (
                          <tr>
                            <td colSpan={9} className="py-8 text-center text-slate-500 dark:text-slate-400">
                              Nenhuma baixa registrada para este título. Use o botão <strong>Baixar</strong> ou{' '}
                              <strong>Ações</strong> na listagem para liquidar.
                            </td>
                          </tr>
                        ) : (
                          settlements.map((s, idx) => (
                            <tr key={s.id} className="hover:bg-slate-50 dark:hover:bg-slate-800">
                              <td className="px-3 py-2 font-mono text-slate-500 dark:text-slate-400">
                                {String(idx + 1).padStart(2, '0')}
                              </td>
                              <td className="px-3 py-2 font-mono tabular-nums text-slate-700 dark:text-slate-200">
                                {formatIsoDateToBR(s.settlementDate)}
                              </td>
                              <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300">
                                {formatBRL(s.interestCents)}
                              </td>
                              <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300">
                                {formatBRL(s.fineCents)}
                              </td>
                              <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300">
                                {formatBRL(s.discountCents)}
                              </td>
                              <td className="px-3 py-2 text-right font-mono font-bold tabular-nums text-emerald-700 dark:text-emerald-300">
                                {formatBRL(s.amountCents)}
                              </td>
                              <td className="px-3 py-2 font-mono text-[11px] text-slate-700 dark:text-slate-200">
                                {s.origin}
                                {s.paymentMethod ? ` · ${s.paymentMethod}` : ''}
                              </td>
                              <td className="px-3 py-2 text-slate-700 dark:text-slate-200">{s.history || '—'}</td>
                              <td className="px-3 py-2 text-right">
                                {s.movementId && onNavigate ? (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      onNavigate('finance_movimento', { highlightMovementId: s.movementId! })
                                    }
                                    className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-blue-700 hover:bg-blue-50 dark:border-slate-700 dark:bg-slate-900 dark:text-blue-300 dark:hover:bg-blue-950/60"
                                  >
                                    <Landmark className="w-3 h-3" />
                                    Ver
                                  </button>
                                ) : (
                                  <span className="text-slate-400 dark:text-slate-400">—</span>
                                )}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Bottom Sticky Footer Helper */}
      <div className="px-5 py-3 border-t border-slate-100 bg-slate-50 flex items-center justify-between text-[11px] text-slate-500 dark:border-slate-800 dark:bg-slate-800/70 dark:text-slate-400">
        <span>
          <CheckCircle2 className="w-3.5 h-3.5 inline text-emerald-600 mr-1 dark:text-emerald-400" />
          Atalho rápido: pressione <kbd className="font-mono bg-white border border-slate-200 px-1 rounded dark:bg-slate-900 dark:border-slate-700">Ctrl+Enter</kbd> para salvar
        </span>
        <span>Origem do título: {editingTitle?.origin || 'MANUAL'}</span>
      </div>
    </div>
  );
};
