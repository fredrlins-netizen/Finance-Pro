import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownUp,
  ArrowLeft,
  Calculator,
  Check,
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Download,
  Eye,
  FileSpreadsheet,
  FileText,
  Filter,
  FolderOpen,
  HardDrive,
  Headphones,
  History,
  Link2,
  Lock,
  MessageSquare,
  Paperclip,
  Pencil,
  PhoneCall,
  Plus,
  Printer,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Send,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  apiFetch,
  formatBRL,
  formatBytes,
  formatDateBR,
  formatDateTimeBR,
  getActiveUnitHeader,
  getAuthToken,
  parseJsonResponse,
} from '../../lib/api.ts';
import type { FormMergeContext } from '../../lib/formTemplateRenderer.ts';
import { FormTemplateButton } from '../FormTemplateButton.tsx';
import {
  DossierDocumentPreviewModal,
  FullFreeAreaDocumentShell,
} from '../DossierDocumentViewer.tsx';
import {
  Admission,
  AdmissionScenarioCol,
  AuditCritiqueRound,
  CadastrosBootstrapPayload,
  Client,
  ClientAssetLink,
  DocumentObject,
  ModuleId,
  NavigationIntent,
  Unit,
} from '../../types.ts';
import { EntityAuditModal } from './cadastros/CadastrosShared.tsx';

interface AdmissionVaultModuleProps {
  units: Unit[];
  activeUnitId: number;
  navIntent?: NavigationIntent | null;
  onClearIntent?: () => void;
  onNavigate?: (mod: ModuleId, intent?: NavigationIntent) => void;
  onGoBack?: () => void;
  cadastrosRefreshKey?: number;
}

interface ConsultantOption {
  id: number;
  name: string;
  role: string;
  allowedUnitIds: number[];
}

interface WhatsappInteractionThread {
  id: number;
  clientId: number | null;
  unitId: number;
  contactName: string;
  contactPhone: string;
  provider: 'gotalk' | 'uazapi' | string;
  uazapiInstanceId?: string | null;
  instanceLabel?: string | null;
  ownerRole?: 'responsavel' | 'titular';
  operatorName?: string | null;
  department?: string | null;
  unreadCount: number;
  lastMessagePreview: string;
  updatedAt: string;
}

interface WhatsappInteractionMsg {
  id: number;
  threadId: number;
  provider?: string;
  contactPhone?: string;
  contactName?: string;
  direction: string;
  senderName: string;
  operatorName?: string | null;
  body: string;
  contentType: string;
  attachmentUrl?: string | null;
  attachmentName?: string | null;
  attachmentMimeType?: string | null;
  iviAudioTranscript?: string | null;
  ackStatus?: number | null;
  deletedInOrigin?: boolean;
  createdAt: string;
}

interface AtendimentosLeadRow {
  id: number;
  name: string;
  phone: string;
  channel: string;
  stage: string;
  lastMessageAt: string;
}

interface BucketRuntimeStats {
  bucketName: string;
  backend: 'cloudflare_r2' | 'local_encrypted_bucket';
  encryption: string;
  deduplication: string;
  physicalObjectsCount: number;
  physicalBytesUsed: number;
  r2Configured?: boolean;
}

const DEFAULT_MODALITIES = [
  { value: 'CDC Veículo', label: 'CDC Veículo (Ativa Veículo)' },
  { value: 'Leasing Veículo', label: 'Leasing Veículo (Ativa Veículo)' },
  { value: 'Consórcio de Veículos', label: 'Consórcio de Veículos (Ativa Veículo)' },
  { value: 'Refinanciamento de Veículo', label: 'Refinanciamento de Veículo (Ativa Veículo)' },
  { value: 'Crédito Pessoal', label: 'Crédito Pessoal' },
  { value: 'Cartão de Crédito', label: 'Cartão de Crédito' },
  { value: 'Empréstimo Consignado', label: 'Empréstimo Consignado' },
  { value: 'Cheque Especial', label: 'Cheque Especial' },
];

const SERIES_OPTIONS = ['ADM', 'REC', 'SAL', 'FOR', 'MAC', 'JOP', 'NAT'];

const BANK_SERVICE_TEMPLATES: Record<string, Array<{ name: string; percent: number; installments: number }>> = {
  default: [
    { name: 'Quitação à Vista 30%', percent: 30, installments: 1 },
    { name: 'Revisão Bancária 45%', percent: 45, installments: 12 },
    { name: 'Acordo Parcelado 55%', percent: 55, installments: 24 },
  ],
  santander: [
    { name: 'Quitação Santander 35%', percent: 35, installments: 1 },
    { name: 'Repactuação Santander 48%', percent: 48, installments: 18 },
    { name: 'Parcelamento CDC 60%', percent: 60, installments: 30 },
  ],
  bv: [
    { name: 'Quitação BV 32%', percent: 32, installments: 1 },
    { name: 'Revisão BV Veicular 45%', percent: 45, installments: 12 },
    { name: 'Acordo BV Estendido 58%', percent: 58, installments: 24 },
  ],
  itau: [
    { name: 'Quitação Itaú 30%', percent: 30, installments: 1 },
    { name: 'Revisão Itaú 42%', percent: 42, installments: 12 },
    { name: 'Acordo Itaú 52%', percent: 52, installments: 24 },
  ],
  bradesco: [
    { name: 'Quitação Bradesco 33%', percent: 33, installments: 1 },
    { name: 'Revisão Bradesco 46%', percent: 46, installments: 12 },
    { name: 'Acordo Bradesco 55%', percent: 55, installments: 24 },
  ],
};

const FORM_STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'pendente', label: 'PENDENTE' },
  { value: 'negociacao', label: 'NEGOCIAÇÃO' },
  { value: 'aguardando_auditoria', label: 'AGUARDANDO AUDITORIA' },
  { value: 'aprovada', label: 'APROVADA' },
  { value: 'analise_cliente', label: 'ANÁLISE CLIENTE' },
  { value: 'reprovada', label: 'REPROVADA' },
  { value: 'devolvida_admissao', label: 'RETORNO AUDITORIA' },
];

const LIST_STATUS_LABELS: Record<string, { label: string; tone: string }> = {
  pendente: { label: 'Pendente', tone: 'text-amber-700' },
  negociacao: { label: 'Negociação', tone: 'text-blue-700' },
  aguardando_auditoria: { label: 'Aguardando Auditoria', tone: 'text-amber-700' },
  aprovada: { label: 'Aprovada', tone: 'text-emerald-700 font-semibold' },
  analise_cliente: { label: 'Análise Cliente', tone: 'text-indigo-700' },
  reprovada: { label: 'Reprovada', tone: 'text-red-700 font-semibold' },
  devolvida_admissao: { label: 'Retorno Auditoria', tone: 'text-red-600 font-semibold' },
  retorno_auditoria: { label: 'Retorno Auditoria', tone: 'text-red-600 font-semibold' },
  em_andamento: { label: 'Em Andamento', tone: 'text-emerald-700' },
  auditada: { label: 'Auditada', tone: 'text-emerald-800 font-semibold' },
  finalizada: { label: 'Finalizada', tone: 'text-slate-800 font-semibold' },
  concluido: { label: 'Concluído', tone: 'text-emerald-800 font-semibold' },
};

const ESSENTIAL_DOCS: Array<{ key: string; label: string }> = [
  { key: 'ficha_admissao', label: 'Ficha' },
  { key: 'contrato', label: 'Contrato' },
  { key: 'procuracao', label: 'Procuração' },
  { key: 'pessoal', label: 'CNH/RG' },
  { key: 'crlv', label: 'CRLV' },
];

const SERIES_DEFAULT_STORAGE_KEY = 'financepro_admission_default_series';

function buildBankServices(bankName: string): Array<{ name: string; percent: number; installments: number }> {
  const lower = bankName.toLowerCase();
  if (lower.includes('santander')) return BANK_SERVICE_TEMPLATES.santander;
  if (lower.includes('bv') || lower.includes('votorantim')) return BANK_SERVICE_TEMPLATES.bv;
  if (lower.includes('ita')) return BANK_SERVICE_TEMPLATES.itau;
  if (lower.includes('bradesco')) return BANK_SERVICE_TEMPLATES.bradesco;
  return BANK_SERVICE_TEMPLATES.default;
}

function buildInitialScenarios(bankName: string, baseDebtCents = 0, dueDay = 10): AdmissionScenarioCol[] {
  const templates = buildBankServices(bankName);
  return templates.map((srv, idx) => {
    const recalcDebtCents = baseDebtCents > 0 ? Math.round((baseDebtCents * srv.percent) / 100) : 0;
    const installmentsToPay = srv.installments;
    const recalcInstallmentCents =
      recalcDebtCents > 0 && installmentsToPay > 0 ? Math.round(recalcDebtCents / installmentsToPay) : 0;
    const savingsCents = baseDebtCents > 0 ? Math.max(0, baseDebtCents - recalcDebtCents) : 0;
    return {
      id: `sc-${idx + 1}-${Date.now()}`,
      name: srv.name,
      servicePercent: srv.percent,
      installmentsToPay,
      originalDebtCents: baseDebtCents,
      recalcInstallmentCents,
      recalcDebtCents,
      savingsCents,
      dueDay,
    };
  });
}

function formatCentsInput(cents: number): string {
  return (Number(cents || 0) / 100).toFixed(2);
}

function parseReaisToCents(val: string): number {
  const normalized = String(val || '0').replace(/\./g, '').replace(',', '.');
  const num = Number(normalized);
  if (!Number.isFinite(num) || num < 0) return 0;
  return Math.round(num * 100);
}

function combineProfileValues(a?: string | null, b?: string | null): string {
  const va = (a || '').trim();
  const vb = (b || '').trim();
  if (va && vb) return `${va} / ${vb}`;
  return va || vb || '—';
}

function formatClientAddress(c?: Client): string {
  if (!c) return '';
  return [
    c.address,
    c.addressNumber ? `Nº ${c.addressNumber}` : '',
    c.neighborhood,
    c.city ? `${c.city}${c.state ? ` (${c.state})` : ''}` : '',
    c.zipCode ? `CEP: ${c.zipCode}` : '',
  ]
    .filter(Boolean)
    .join(', ');
}

export const AdmissionVaultModule: React.FC<AdmissionVaultModuleProps> = ({
  units,
  activeUnitId,
  navIntent,
  onClearIntent,
  onNavigate,
  onGoBack,
  cadastrosRefreshKey,
}) => {
  // Core datasets
  const [clients, setClients] = useState<Client[]>([]);
  const [links, setLinks] = useState<ClientAssetLink[]>([]);
  const [admissions, setAdmissions] = useState<Admission[]>([]);
  const [documents, setDocuments] = useState<DocumentObject[]>([]);
  const [trashedDocuments, setTrashedDocuments] = useState<DocumentObject[]>([]);
  const [consultants, setConsultants] = useState<ConsultantOption[]>([]);
  const [threadPhones, setThreadPhones] = useState<string[]>([]);
  const [banksCatalog, setBanksCatalog] = useState<Array<{ code: number; name: string }>>([]);
  const [cadastrosData, setCadastrosData] = useState<CadastrosBootstrapPayload | null>(null);

  // View Navigation: Lista | Formulário | Cofre Global (com pilha para retornar à tela exata)
  const [viewMode, setViewMode] = useState<'list' | 'form' | 'vault'>('list');
  const [viewHistory, setViewHistory] = useState<Array<'list' | 'form' | 'vault'>>([]);
  const viewModeRef = useRef<'list' | 'form' | 'vault'>('list');
  const enteredViaIntentRef = useRef(false);
  const [formTab, setFormTab] = useState<'formulario' | 'whatsapp' | 'atendimentos' | 'documentos'>('formulario');
  const [editingAdmissionId, setEditingAdmissionId] = useState<number | null>(null);

  const navigateViewMode = (nextMode: 'list' | 'form' | 'vault', pushHistory = true) => {
    const curr = viewModeRef.current;
    if (pushHistory && curr !== nextMode) {
      setViewHistory((prev) => [...prev.slice(-10), curr]);
    }
    viewModeRef.current = nextMode;
    setViewMode(nextMode);
  };

  const handleBackFromSubView = () => {
    if (viewHistory.length > 0) {
      const prevMode = viewHistory[viewHistory.length - 1];
      setViewHistory((prev) => prev.slice(0, -1));
      viewModeRef.current = prevMode;
      setViewMode(prevMode);
      return;
    }
    if (enteredViaIntentRef.current && onGoBack) {
      enteredViaIntentRef.current = false;
      onGoBack();
      return;
    }
    viewModeRef.current = 'list';
    setViewMode('list');
  };

  // List Search, Filters, Sorting, Pagination (50 rows/page per Guide Sec 2)
  const [quickSearchInput, setQuickSearchInput] = useState('');
  const [quickSearchDebounced, setQuickSearchDebounced] = useState('');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [filterClientName, setFilterClientName] = useState('');
  const [filterBank, setFilterBank] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterConsultant, setFilterConsultant] = useState('all');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [sortBy, setSortBy] = useState<'date' | 'contract' | 'client'>('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [sectorAuditOpen, setSectorAuditOpen] = useState(false);

  // Form State (Sections 01..06)
  const [clientRoleSelected, setClientRoleSelected] = useState<'responsavel' | 'titular'>('responsavel');
  const [unitId, setUnitId] = useState<number>(activeUnitId || 1);
  const [status, setStatus] = useState<string>('pendente');
  const [origin, setOrigin] = useState<string>('');
  const [responsibleClientId, setResponsibleClientId] = useState<number | null>(null);
  const [titularClientId, setTitularClientId] = useState<number | null>(null);

  // Section 02 - Negociação
  const [bankName, setBankName] = useState('');
  const [consultantId, setConsultantId] = useState<number | null>(null);
  const [consultantName, setConsultantName] = useState('');
  const [modality, setModality] = useState('CDC Veículo');
  const [series, setSeries] = useState<string>(() => localStorage.getItem(SERIES_DEFAULT_STORAGE_KEY) || 'ADM');
  const [isSeriesDefault, setIsSeriesDefault] = useState<boolean>(
    () => (localStorage.getItem(SERIES_DEFAULT_STORAGE_KEY) || 'ADM') === 'ADM'
  );
  const [contractNumber, setContractNumber] = useState('');
  const [indicationSource, setIndicationSource] = useState('');
  const [indicationOther, setIndicationOther] = useState('');

  // Section 03 - Veículo (conditional on "veículo"/"veiculo" in modality)
  const [vehicleBrand, setVehicleBrand] = useState('');
  const [vehicleModel, setVehicleModel] = useState('');
  const [vehicleColor, setVehicleColor] = useState('');
  const [vehicleYear, setVehicleYear] = useState('');
  const [vehiclePlate, setVehiclePlate] = useState('');
  const [vehicleChassis, setVehicleChassis] = useState('');
  const [vehicleRenavam, setVehicleRenavam] = useState('');

  // Section 04 - Dívida Atual
  const [debtTotalInstallments, setDebtTotalInstallments] = useState('48');
  const [debtPaidInstallments, setDebtPaidInstallments] = useState('0');
  const [debtOverdueInstallments, setDebtOverdueInstallments] = useState('0');
  const [financedAmountReais, setFinancedAmountReais] = useState('0.00');
  const [currentInstallmentReais, setCurrentInstallmentReais] = useState('0.00');
  const [debtDueDay, setDebtDueDay] = useState('10');
  const [paymentType, setPaymentType] = useState('boleto');

  // Section 05 - Recálculo & Planejamento de Quitação
  const [scenarios, setScenarios] = useState<AdmissionScenarioCol[]>(() => buildInitialScenarios(''));

  // Section 06 - Tabela de Serviços & Outras Informações
  const [serviceMgmtReais, setServiceMgmtReais] = useState('0.00');
  const [serviceInitialReais, setServiceInitialReais] = useState('0.00');
  const [serviceDiscountReais, setServiceDiscountReais] = useState('0.00');
  const [serviceAdditionReais, setServiceAdditionReais] = useState('0.00');
  const [billingFeeReais, setBillingFeeReais] = useState('0.00');
  const [notes, setNotes] = useState('');

  // Audit critiques
  const [auditCritiques, setAuditCritiques] = useState<AuditCritiqueRound[]>([]);
  const [commercialCritiqueReply, setCommercialCritiqueReply] = useState('');

  // Header preview / docx / docs / interactions / modals
  const [previewTemplate, setPreviewTemplate] = useState<'padrao' | 'procuracao' | 'completo'>('padrao');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [wordModalOpen, setWordModalOpen] = useState(false);
  const [historyAdmission, setHistoryAdmission] = useState<Admission | null>(null);
  const [interactions, setInteractions] = useState<{
    loading: boolean;
    syncing: boolean;
    threads: WhatsappInteractionThread[];
    messages: WhatsappInteractionMsg[];
    atendimentos: AtendimentosLeadRow[];
    matchedPhones: string[];
  }>({ loading: false, syncing: false, threads: [], messages: [], atendimentos: [], matchedPhones: [] });
  const [waProviderFilter, setWaProviderFilter] = useState<'all' | 'gotalk' | 'uazapi'>('all');
  const [waSelectedThreadId, setWaSelectedThreadId] = useState<number | 'all'>('all');
  const [waDraft, setWaDraft] = useState('');
  const [waSending, setWaSending] = useState(false);

  // SmartSelect states for Responsible & Titular & Bank
  const [respSearch, setRespSearch] = useState('');
  const [respDropdownOpen, setRespDropdownOpen] = useState(false);
  const [respRemoteResults, setRespRemoteResults] = useState<Client[]>([]);
  const [respHasMore, setRespHasMore] = useState(false);
  const [respSearchErr, setRespSearchErr] = useState('');

  const [titSearch, setTitSearch] = useState('');
  const [titDropdownOpen, setTitDropdownOpen] = useState(false);
  const [titRemoteResults, setTitRemoteResults] = useState<Client[]>([]);
  const [titHasMore, setTitHasMore] = useState(false);

  // Person Create/Edit Modal (14 fields from Guide Sec 11)
  const [personModal, setPersonModal] = useState<{
    open: boolean;
    targetRole: 'responsavel' | 'titular';
    mode: 'create' | 'edit';
    clientId?: number;
  } | null>(null);
  const [pName, setPName] = useState('');
  const [pCpf, setPCpf] = useState('');
  const [pRg, setPRg] = useState('');
  const [pPhone, setPPhone] = useState('');
  const [pEmail, setPEmail] = useState('');
  const [pProfession, setPProfession] = useState('');
  const [pMaritalStatus, setPMaritalStatus] = useState('');
  const [pBirthDate, setPBirthDate] = useState('');
  const [pZipCode, setPZipCode] = useState('');
  const [pAddress, setPAddress] = useState('');
  const [pNumber, setPNumber] = useState('');
  const [pNeighborhood, setPNeighborhood] = useState('');
  const [pCity, setPCity] = useState('');
  const [pState, setPState] = useState('');

  // Documents / Dossiê & Bucket
  const [docCategory, setDocCategory] = useState('ficha_admissao');
  const [docOwnerTarget, setDocOwnerTarget] = useState<'responsavel' | 'titular'>('responsavel');
  const [docScopeTab, setDocScopeTab] = useState<'todos' | 'ficha' | 'cliente' | 'lixeira'>('todos');
  const [docSearchFilter, setDocSearchFilter] = useState('');
  const [docCategoryFilter, setDocCategoryFilter] = useState('all');
  const [bucketStats, setBucketStats] = useState<BucketRuntimeStats | null>(null);
  const [previewDocModal, setPreviewDocModal] = useState<{
    doc: DocumentObject;
    blobUrl: string;
    loading: boolean;
  } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [showTrash, setShowTrash] = useState(false);

  // Global status / feedback
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const formRef = useRef<HTMLFormElement>(null);

  const load = async () => {
    const [data, bankData, cadBoot] = await Promise.all([
      apiFetch<{
        clients: Client[];
        assetLinks: ClientAssetLink[];
        admissions: Admission[];
        documents: DocumentObject[];
        trashedDocuments?: DocumentObject[];
        consultants?: ConsultantOption[];
        threadPhones?: string[];
        bucketStats?: BucketRuntimeStats;
      }>('/api/clients'),
      apiFetch<{ banks: Array<{ code: number; name: string }> }>('/api/lookup/banks').catch(() => ({
        banks: [],
      })),
      apiFetch<CadastrosBootstrapPayload>('/api/cadastros/bootstrap').catch(() => null),
    ]);
    setClients(data.clients || []);
    setLinks(data.assetLinks || []);
    setAdmissions(data.admissions || []);
    setDocuments(data.documents || []);
    setTrashedDocuments(data.trashedDocuments || []);
    setConsultants(data.consultants || []);
    setThreadPhones(data.threadPhones || []);
    if (data.bucketStats) setBucketStats(data.bucketStats);
    if (bankData.banks.length) setBanksCatalog(bankData.banks);
    if (cadBoot) setCadastrosData(cadBoot);
  };

  useEffect(() => {
    load();
  }, [activeUnitId, cadastrosRefreshKey]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setQuickSearchDebounced(quickSearchInput.trim().toLowerCase());
      setPage(1);
    }, 280);
    return () => clearTimeout(timer);
  }, [quickSearchInput]);

  useEffect(() => {
    if (!navIntent) return;
    enteredViaIntentRef.current = true;
    if (navIntent.triggerNew) {
      openNewForm();
    } else if (navIntent.admissionId) {
      const target = admissions.find((a) => a.id === navIntent.admissionId);
      if (target) openEditForm(target);
    } else if (navIntent.clientId) {
      const target = admissions.find((a) => a.clientId === navIntent.clientId);
      if (target) openEditForm(target);
    }
    if (navIntent.tab === 'vault') navigateViewMode('vault', false);
    onClearIntent?.();
  }, [navIntent, admissions.length]);

  // Remote SmartSelect search >= 3 characters (Guide Sec 3)
  useEffect(() => {
    if (!respDropdownOpen) return;
    const q = respSearch.trim();
    if (q.length < 3) {
      setRespRemoteResults(clients.slice(0, 15));
      setRespHasMore(false);
      setRespSearchErr('');
      return;
    }
    let cancelled = false;
    apiFetch<{ clients: Client[]; hasMore: boolean }>(`/api/clients/search?q=${encodeURIComponent(q)}&limit=15`)
      .then((res) => {
        if (cancelled) return;
        setRespRemoteResults(res.clients);
        setRespHasMore(res.hasMore);
        setRespSearchErr('');
      })
      .catch((err) => {
        if (!cancelled) setRespSearchErr(err instanceof Error ? err.message : 'Erro na pesquisa de clientes.');
      });
    return () => {
      cancelled = true;
    };
  }, [respSearch, respDropdownOpen, clients]);

  useEffect(() => {
    if (!titDropdownOpen) return;
    const q = titSearch.trim();
    if (q.length < 3) {
      setTitRemoteResults(clients.slice(0, 15));
      setTitHasMore(false);
      return;
    }
    let cancelled = false;
    apiFetch<{ clients: Client[]; hasMore: boolean }>(`/api/clients/search?q=${encodeURIComponent(q)}&limit=15`)
      .then((res) => {
        if (cancelled) return;
        setTitRemoteResults(res.clients);
        setTitHasMore(res.hasMore);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [titSearch, titDropdownOpen, clients]);

  // Derived objects
  const respClient = useMemo(
    () => clients.find((c) => c.id === responsibleClientId),
    [clients, responsibleClientId]
  );
  const titClient = useMemo(
    () => clients.find((c) => c.id === titularClientId),
    [clients, titularClientId]
  );
  const showTitularField = clientRoleSelected === 'titular' || Boolean(titularClientId);
  const dynamicModalities = useMemo(() => {
    const activeMods = (cadastrosData?.modalities || []).filter((m) => m.active);
    if (activeMods.length > 0) {
      return activeMods.map((m) => ({
        value: m.description,
        label: m.hasVehicleSection ? `${m.description} (Ativa Veículo)` : m.description,
        hasVehicleSection: m.hasVehicleSection,
      }));
    }
    return DEFAULT_MODALITIES.map((m) => ({
      ...m,
      hasVehicleSection: /ve[ií]culo/i.test(m.value),
    }));
  }, [cadastrosData]);

  const showVehicleSection = useMemo(() => {
    const matched = dynamicModalities.find((m) => m.value.toLowerCase() === modality.toLowerCase());
    if (matched) return matched.hasVehicleSection;
    return /ve[ií]culo/i.test(modality);
  }, [dynamicModalities, modality]);

  const dynamicSeriesOptions = useMemo(() => {
    const sList = cadastrosData?.series || [];
    if (sList.length > 0) return sList;
    return SERIES_OPTIONS.map((sigla, idx) => ({
      id: idx + 1,
      sigla,
      description: `Série ${sigla}`,
      generalNumber: 1,
      isDefault: sigla === 'ADM',
      unitNumbering: [],
    }));
  }, [cadastrosData]);

  const dynamicBankNames = useMemo(() => {
    const registered = (cadastrosData?.banks || [])
      .filter((b) => b.status === 'ATIVO')
      .map((b) => b.name);
    const febraban = (cadastrosData?.febrabanBanks || []).map((b) => b.name);
    const legacy = banksCatalog.map((b) => b.name);
    return Array.from(new Set([...registered, ...febraban, ...legacy])).filter(Boolean);
  }, [cadastrosData, banksCatalog]);

  const dynamicConsultantOptions = useMemo(() => {
    const list: Array<{ key: string; userId: number | null; name: string; subtitle?: string }> = [];
    const seenNames = new Set<string>();
    for (const col of cadastrosData?.collaborators || []) {
      if (!col.active) continue;
      const roleMeta = (cadastrosData?.roles || []).find(
        (r) => r.id === col.roleId || r.name.toLowerCase() === (col.jobTitle || '').toLowerCase()
      );
      if (roleMeta && roleMeta.participatesInScheduleQueue === false && col.jobTitle && !/consultor|gestor|diretor/i.test(col.jobTitle)) {
        continue;
      }
      seenNames.add(col.name.toLowerCase());
      list.push({
        key: col.userId ? `u-${col.userId}` : `c-${col.id}`,
        userId: col.userId || null,
        name: col.name,
        subtitle: col.jobTitle || undefined,
      });
    }
    for (const u of consultants) {
      if (seenNames.has(u.name.toLowerCase())) continue;
      list.push({
        key: `u-${u.id}`,
        userId: u.id,
        name: u.name,
      });
    }
    return list;
  }, [cadastrosData, consultants]);

  const selectedUnit = units.find((u) => u.id === unitId) || units[0];
  const isApprovedLocked = Boolean(
    editingAdmissionId && (status === 'aprovada' || status === 'auditada')
  );

  // Predicted contract number in top-right box (respects Série + Numeração por Unidade de Cadastros Comuns)
  const displayContractNumber = useMemo(() => {
    if (contractNumber.trim()) return contractNumber.trim();
    const countForSeries = admissions.filter((a) => (a.series || 'ADM') === series).length;
    const seriesObj = dynamicSeriesOptions.find((s) => s.sigla === series);
    const unitCounter = seriesObj?.unitNumbering?.find((n) => n.unitId === unitId)?.currentNumber;
    const nextSeq = Math.max(countForSeries + 1, unitCounter || seriesObj?.generalNumber || 1);
    return `${series}-${String(nextSeq).padStart(4, '0')}`;
  }, [contractNumber, admissions, series, dynamicSeriesOptions, unitId]);

  // Auto sync Unit min fee -> Valor Parcela 01 / Gestão if empty
  const handleSelectUnit = (newUnitId: number) => {
    setUnitId(newUnitId);
    const u = units.find((x) => x.id === newUnitId);
    if (u && parseReaisToCents(serviceMgmtReais) === 0) {
      setServiceMgmtReais(formatCentsInput(u.minAdmissionCostCents));
    }
  };

  const resolveBankServices = (targetBankName: string): Array<{ name: string; percent: number; installments: number }> => {
    const clean = targetBankName.trim().toLowerCase();
    const cadBank = (cadastrosData?.banks || []).find(
      (b) => b.name.toLowerCase() === clean || (b.febrabanCode && `${b.febrabanCode} - ${b.name}`.toLowerCase() === clean)
    );
    if (cadBank && cadBank.services && cadBank.services.length > 0) {
      return cadBank.services.map((s) => ({
        name: s.name,
        percent: Math.max(1, Number(String(s.negotiationPercent || '45').replace(',', '.')) || 45),
        installments: Math.max(1, Number(s.defaultInstallments || 12)),
      }));
    }
    return buildBankServices(targetBankName);
  };

  // Bank services limit and scenario auto-adjustment (Guide Sec 7 + Cadastros Comuns)
  const bankServices = useMemo(() => resolveBankServices(bankName), [bankName, cadastrosData]);
  const maxBankScenarios = bankServices.length;

  const handleSelectBank = (newBank: string) => {
    setBankName(newBank);
    const services = resolveBankServices(newBank);
    const baseDebt = parseReaisToCents(financedAmountReais) ||
      Math.max(0, Number(debtTotalInstallments || 0) * parseReaisToCents(currentInstallmentReais));
    const dueDayNum = Math.min(31, Math.max(1, Number(debtDueDay || 10)));
    setScenarios((prev) =>
      services.map((srv, idx) => {
        const existing = prev[idx];
        const recalcDebtCents = baseDebt > 0 ? Math.round((baseDebt * srv.percent) / 100) : existing?.recalcDebtCents || 0;
        const inst = existing?.installmentsToPay || srv.installments;
        const recalcInst = recalcDebtCents > 0 && inst > 0 ? Math.round(recalcDebtCents / inst) : 0;
        return {
          id: existing?.id || `sc-${idx + 1}-${Date.now()}`,
          name: srv.name,
          servicePercent: srv.percent,
          installmentsToPay: inst,
          originalDebtCents: baseDebt || existing?.originalDebtCents || 0,
          recalcInstallmentCents: recalcInst,
          recalcDebtCents,
          savingsCents: (baseDebt || existing?.originalDebtCents || 0) > recalcDebtCents ? (baseDebt || existing?.originalDebtCents || 0) - recalcDebtCents : 0,
          dueDay: existing?.dueDay || dueDayNum,
        };
      })
    );
  };

  const calculateAllScenarios = (sourceScenarios: AdmissionScenarioCol[]): AdmissionScenarioCol[] => {
    return sourceScenarios.map((sc) => {
      if (sc.originalDebtCents > 0 && sc.installmentsToPay > 0) {
        const pct = sc.servicePercent > 0 ? sc.servicePercent : 45;
        const newDebt = Math.round((sc.originalDebtCents * pct) / 100);
        const newInst = Math.round(newDebt / sc.installmentsToPay);
        const savings = Math.max(0, sc.originalDebtCents - newDebt);
        return {
          ...sc,
          recalcDebtCents: newDebt,
          recalcInstallmentCents: newInst,
          savingsCents: savings,
        };
      }
      return sc;
    });
  };

  const updateScenarioAt = (idx: number, patch: Partial<AdmissionScenarioCol>) => {
    setScenarios((prev) =>
      prev.map((sc, i) => {
        if (i !== idx) return sc;
        const next = { ...sc, ...patch };
        if (
          patch.originalDebtCents !== undefined ||
          patch.servicePercent !== undefined ||
          patch.installmentsToPay !== undefined
        ) {
          if (next.originalDebtCents > 0 && next.installmentsToPay > 0) {
            const newDebt = Math.round((next.originalDebtCents * (next.servicePercent || 45)) / 100);
            next.recalcDebtCents = newDebt;
            next.recalcInstallmentCents = Math.round(newDebt / next.installmentsToPay);
            next.savingsCents = Math.max(0, next.originalDebtCents - newDebt);
          }
        } else if (patch.recalcDebtCents !== undefined) {
          next.recalcInstallmentCents =
            next.installmentsToPay > 0 ? Math.round(next.recalcDebtCents / next.installmentsToPay) : 0;
          next.savingsCents = Math.max(0, next.originalDebtCents - next.recalcDebtCents);
        }
        return next;
      })
    );
  };

  // Service Fee Table Calculations (Guide Sec 8)
  const mgmtCents = parseReaisToCents(serviceMgmtReais);
  const initialCostCents = parseReaisToCents(serviceInitialReais);
  const discountCents = parseReaisToCents(serviceDiscountReais);
  const additionCents = parseReaisToCents(serviceAdditionReais);
  const firstScenarioSavingsCents = scenarios[0]?.savingsCents || 0;
  const finalEconomyFeeCents = firstScenarioSavingsCents > 0 ? Math.round(firstScenarioSavingsCents * 0.2) : 0;
  const servicesSubtotalCents = mgmtCents + initialCostCents;
  const servicesTotalCents = Math.max(0, servicesSubtotalCents - discountCents + additionCents);

  // Open New / Edit Form Helpers
  const openNewForm = () => {
    const savedDefaultSeries = localStorage.getItem(SERIES_DEFAULT_STORAGE_KEY) || 'ADM';
    const targetUnit = units.find((u) => u.id === activeUnitId) || units[0];
    setEditingAdmissionId(null);
    navigateViewMode('form');
    setFormTab('formulario');
    setClientRoleSelected('responsavel');
    setUnitId(targetUnit?.id || 1);
    setStatus('pendente');
    setOrigin('');
    setResponsibleClientId(null);
    setTitularClientId(null);
    setRespSearch('');
    setTitSearch('');
    setBankName('');
    setConsultantId(consultants[0]?.id || null);
    setConsultantName(consultants[0]?.name || '');
    setModality('CDC Veículo');
    setSeries(savedDefaultSeries);
    setIsSeriesDefault(true);
    setContractNumber('');
    setIndicationSource('');
    setIndicationOther('');
    setVehicleBrand('');
    setVehicleModel('');
    setVehicleColor('');
    setVehicleYear('');
    setVehiclePlate('');
    setVehicleChassis('');
    setVehicleRenavam('');
    setDebtTotalInstallments('48');
    setDebtPaidInstallments('0');
    setDebtOverdueInstallments('0');
    setFinancedAmountReais('0.00');
    setCurrentInstallmentReais('0.00');
    setDebtDueDay('10');
    setPaymentType('boleto');
    setScenarios(buildInitialScenarios(''));
    setServiceMgmtReais(formatCentsInput(targetUnit?.minAdmissionCostCents || 0));
    setServiceInitialReais('0.00');
    setServiceDiscountReais('0.00');
    setServiceAdditionReais('0.00');
    setBillingFeeReais('0.00');
    setNotes('');
    setAuditCritiques([]);
    setCommercialCritiqueReply('');
    setErrorMsg('');
    setFeedback('');
  };

  const openEditForm = (adm: Admission, initialTab: typeof formTab = 'formulario') => {
    setEditingAdmissionId(adm.id);
    navigateViewMode('form');
    setFormTab(initialTab);
    setClientRoleSelected(
      adm.clientRoleSelected === 'titular' || Boolean(adm.assetOwnerId) ? 'titular' : 'responsavel'
    );
    setUnitId(adm.unitId);
    setStatus(adm.status);
    setOrigin(adm.origin || '');
    setResponsibleClientId(adm.clientId);
    setTitularClientId(adm.assetOwnerId || null);
    const resp = clients.find((c) => c.id === adm.clientId);
    const tit = adm.assetOwnerId ? clients.find((c) => c.id === adm.assetOwnerId) : undefined;
    setRespSearch(resp?.fullName || '');
    setTitSearch(tit?.fullName || '');
    setBankName(adm.bankName || '');
    setConsultantId(adm.consultantId || null);
    setConsultantName(adm.consultantName || '');
    setModality(adm.modality || (adm.debtType === 'veicular' ? 'CDC Veículo' : 'Crédito Pessoal'));
    const admSeries = adm.series || 'ADM';
    setSeries(admSeries);
    setIsSeriesDefault((localStorage.getItem(SERIES_DEFAULT_STORAGE_KEY) || 'ADM') === admSeries);
    setContractNumber(adm.contractNumber || '');
    setIndicationSource(adm.indicationSource || '');
    setIndicationOther(adm.indicationOther || '');
    setVehicleBrand(adm.vehicleBrand || '');
    setVehicleModel(adm.vehicleModel || '');
    setVehicleColor(adm.vehicleColor || '');
    setVehicleYear(adm.vehicleYear || '');
    setVehiclePlate(adm.vehiclePlate || '');
    setVehicleChassis(adm.vehicleChassis || '');
    setVehicleRenavam(adm.vehicleRenavam || '');
    setDebtTotalInstallments(String(adm.debtTotalInstallments ?? 48));
    setDebtPaidInstallments(String(adm.debtPaidInstallments ?? 0));
    setDebtOverdueInstallments(String(adm.debtOverdueInstallments ?? 0));
    const finCents = adm.financedAmountCents || adm.debtAmountCents || 0;
    setFinancedAmountReais(formatCentsInput(finCents));
    setCurrentInstallmentReais(formatCentsInput(adm.currentInstallmentCents || 0));
    setDebtDueDay(String(adm.debtDueDay ?? 10));
    setPaymentType(adm.paymentType || 'boleto');
    setScenarios(
      adm.scenariosJson && adm.scenariosJson.length > 0
        ? adm.scenariosJson
        : buildInitialScenarios(adm.bankName, adm.debtAmountCents, adm.debtDueDay || 10)
    );
    const mgmt = adm.serviceMgmtCents || adm.initialInstallmentCents || adm.serviceFeeCents || 0;
    setServiceMgmtReais(formatCentsInput(mgmt));
    setServiceInitialReais(formatCentsInput(adm.serviceInitialCents || 0));
    setServiceDiscountReais(formatCentsInput(adm.serviceDiscountCents || 0));
    setServiceAdditionReais(formatCentsInput(adm.serviceAdditionCents || 0));
    setBillingFeeReais(formatCentsInput(adm.billingFeeCents || 0));
    setNotes(adm.notes || '');
    const critiques = Array.isArray(adm.auditCritiquesJson) ? [...adm.auditCritiquesJson] : [];
    if (critiques.length === 0 && adm.auditRejectionReason) {
      critiques.push({
        id: 'legacy-crit',
        round: 1,
        author: 'Auditoria',
        reason: adm.auditRejectionReason,
        createdAt: adm.createdAt,
      });
    }
    setAuditCritiques(critiques);
    setCommercialCritiqueReply('');
    setErrorMsg('');
    setFeedback('');
  };

  // Load WhatsApp (GoTalk + UaZapi) & Atendimentos when switching to those tabs
  const loadClientInteractions = async () => {
    if (!editingAdmissionId && !responsibleClientId) return;
    setInteractions((prev) => ({ ...prev, loading: true }));
    try {
      const endpoint = editingAdmissionId
        ? `/api/admissions/${editingAdmissionId}/interactions`
        : `/api/clients/${responsibleClientId}/interactions${titularClientId ? `?titularId=${titularClientId}` : ''}`;
      const res = await apiFetch<{
        threads: WhatsappInteractionThread[];
        messages: WhatsappInteractionMsg[];
        atendimentos: AtendimentosLeadRow[];
        matchedPhones?: string[];
      }>(endpoint);
      setInteractions({
        loading: false,
        syncing: false,
        threads: res.threads || [],
        messages: res.messages || [],
        atendimentos: res.atendimentos || [],
        matchedPhones: res.matchedPhones || [],
      });
    } catch {
      setInteractions((prev) => ({ ...prev, loading: false }));
    }
  };

  useEffect(() => {
    if (viewMode !== 'form') return;
    if (formTab !== 'whatsapp' && formTab !== 'atendimentos') return;
    if (!editingAdmissionId && !responsibleClientId) {
      setInteractions({ loading: false, syncing: false, threads: [], messages: [], atendimentos: [], matchedPhones: [] });
      return;
    }
    loadClientInteractions();
  }, [viewMode, formTab, editingAdmissionId, responsibleClientId, titularClientId]);

  const handleSyncClientWhatsapp = async () => {
    if (!editingAdmissionId && !responsibleClientId) return;
    setInteractions((prev) => ({ ...prev, syncing: true }));
    setErrorMsg('');
    try {
      const endpoint = editingAdmissionId
        ? `/api/admissions/${editingAdmissionId}/sync-whatsapp`
        : `/api/clients/${responsibleClientId}/sync-whatsapp`;
      const res = await apiFetch<{
        threads: WhatsappInteractionThread[];
        messages: WhatsappInteractionMsg[];
        atendimentos: AtendimentosLeadRow[];
        matchedPhones?: string[];
        syncedThreads?: number;
        syncedMessages?: number;
      }>(endpoint, {
        method: 'POST',
        body: JSON.stringify({ titularId: titularClientId, unitId }),
      });
      setInteractions({
        loading: false,
        syncing: false,
        threads: res.threads || [],
        messages: res.messages || [],
        atendimentos: res.atendimentos || [],
        matchedPhones: res.matchedPhones || [],
      });
      setFeedback(
        `Conversas sincronizadas (${res.threads?.length || 0} conversa(s) GoTalk/UaZapi · ${res.syncedMessages || 0} novas mensagens importadas).`
      );
    } catch (err) {
      setInteractions((prev) => ({ ...prev, syncing: false }));
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao sincronizar conversas WhatsApp.');
    }
  };

  const handleStartWhatsappThread = async (provider: 'gotalk' | 'uazapi') => {
    if (!responsibleClientId) return;
    setErrorMsg('');
    try {
      const res = await apiFetch<{ thread: WhatsappInteractionThread }>(`/api/clients/${responsibleClientId}/whatsapp/start`, {
        method: 'POST',
        body: JSON.stringify({ provider, unitId }),
      });
      await loadClientInteractions();
      setWaSelectedThreadId(res.thread.id);
      setWaProviderFilter('all');
      setFeedback(`Canal ${provider.toUpperCase()} aberto para ${res.thread.contactPhone}.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Não foi possível abrir conversa.');
    }
  };

  const handleSendWhatsappReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!waDraft.trim() || waSelectedThreadId === 'all') return;
    setWaSending(true);
    setErrorMsg('');
    try {
      const res = await apiFetch<{ delivery?: { detail?: string } }>(
        `/api/whatsapp/threads/${waSelectedThreadId}/messages`,
        {
          method: 'POST',
          body: JSON.stringify({ body: waDraft.trim(), contentType: 'text', direction: 'outbound' }),
        }
      );
      setWaDraft('');
      if (res.delivery?.detail) setFeedback(res.delivery.detail);
      await loadClientInteractions();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao enviar mensagem.');
    } finally {
      setWaSending(false);
    }
  };

  const handleSendWhatsappFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || waSelectedThreadId === 'all') return;
    setWaSending(true);
    setErrorMsg('');
    try {
      const form = new FormData();
      form.append('file', file);
      if (waDraft.trim()) form.append('caption', waDraft.trim());
      const token = getAuthToken();
      const resp = await fetch(`/api/whatsapp/threads/${waSelectedThreadId}/send-file`, {
        method: 'POST',
        headers: {
          'x-unit-id': String(getActiveUnitHeader()),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: form,
      });
      const data = await parseJsonResponse<{ error?: string; delivery?: { detail?: string } }>(
        resp,
        'Falha ao enviar anexo.'
      );
      setWaDraft('');
      setFeedback(data.delivery?.detail || `Anexo "${file.name}" armazenado no bucket e enviado.`);
      await Promise.all([loadClientInteractions(), load()]);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao enviar arquivo.');
    } finally {
      setWaSending(false);
    }
  };

  const handleTranscribeWhatsappAudio = async (msgId: number) => {
    try {
      await apiFetch(`/api/whatsapp/messages/${msgId}/transcribe`, { method: 'POST' });
      await loadClientInteractions();
      setFeedback('Áudio transcrito pela Ivi.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao transcrever áudio.');
    }
  };

  const activeAdmissionOnlyDocs = useMemo(() => {
    if (!editingAdmissionId) return [];
    return documents.filter((d) => d.admissionId === editingAdmissionId);
  }, [documents, editingAdmissionId]);

  const activeClientAcervoDocs = useMemo(() => {
    if (!responsibleClientId && !titularClientId) return [];
    return documents.filter((d) => {
      const belongsToClient =
        (responsibleClientId && d.clientId === responsibleClientId) ||
        (titularClientId && d.clientId === titularClientId);
      if (!belongsToClient) return false;
      return !editingAdmissionId || d.admissionId !== editingAdmissionId;
    });
  }, [documents, editingAdmissionId, responsibleClientId, titularClientId]);

  const activeAdmissionDocs = useMemo(() => {
    if (!editingAdmissionId && !responsibleClientId && !titularClientId) return [];
    return documents.filter(
      (d) =>
        (editingAdmissionId && d.admissionId === editingAdmissionId) ||
        (responsibleClientId && d.clientId === responsibleClientId) ||
        (titularClientId && d.clientId === titularClientId)
    );
  }, [documents, editingAdmissionId, responsibleClientId, titularClientId]);

  const activeTrashedDossierDocs = useMemo(() => {
    if (!editingAdmissionId && !responsibleClientId && !titularClientId) return [];
    return trashedDocuments.filter(
      (d) =>
        (editingAdmissionId && d.admissionId === editingAdmissionId) ||
        (responsibleClientId && d.clientId === responsibleClientId) ||
        (titularClientId && d.clientId === titularClientId)
    );
  }, [trashedDocuments, editingAdmissionId, responsibleClientId, titularClientId]);

  const activeClientAssetLinks = useMemo(() => {
    if (!responsibleClientId && !titularClientId) return [];
    return links.filter(
      (l) =>
        l.titularClientId === responsibleClientId ||
        l.assetOwnerClientId === responsibleClientId ||
        (titularClientId && (l.titularClientId === titularClientId || l.assetOwnerClientId === titularClientId))
    );
  }, [links, responsibleClientId, titularClientId]);

  // Save Process (stayOpenForDocs = "Salvar admissão e continuar", targetStatusOverride = e.g. Send to Audit)
  const handleSaveProcess = async (opts?: { stayOpenForDocs?: boolean; stayOpen?: boolean; statusOverride?: string }) => {
    setErrorMsg('');
    setFeedback('');

    if (!responsibleClientId) {
      setErrorMsg('Selecione ou cadastre o Cliente Responsável (Nome ou Razão Social) antes de salvar.');
      return null;
    }
    if (!bankName.trim()) {
      setErrorMsg('Selecione o Banco credor na Seção 02 antes de salvar.');
      return null;
    }
    if (!series.trim()) {
      setErrorMsg('Informe a Série do contrato antes de salvar.');
      return null;
    }
    if (!unitId) {
      setErrorMsg('Selecione a Unidade antes de salvar.');
      return null;
    }

    const nextStatus = opts?.statusOverride || status;
    if (nextStatus === 'aprovada') {
      if (activeAdmissionDocs.length === 0) {
        setErrorMsg('Para aprovar a ficha, salve ao menos um documento na aba Documentos.');
        return null;
      }
      const hasOpenUnanswered = auditCritiques.some((c) => !c.commercialResponse?.trim());
      if (hasOpenUnanswered) {
        setErrorMsg('Responda à crítica aberta da Auditoria antes de aprovar.');
        return null;
      }
    }

    const firstScenarioOrig = scenarios[0]?.originalDebtCents || 0;
    const debtBaseCents = parseReaisToCents(financedAmountReais) || firstScenarioOrig;

    setSaving(true);
    try {
      const payload = {
        clientId: responsibleClientId,
        assetOwnerId: titularClientId || null,
        clientRoleSelected,
        unitId,
        origin,
        consultantId: consultantId || undefined,
        consultantName,
        modality,
        series,
        contractNumber: contractNumber || displayContractNumber,
        indicationSource,
        indicationOther: indicationSource === 'outro' ? indicationOther.toUpperCase() : '',
        bankName: bankName.trim(),
        vehicleBrand: vehicleBrand.toUpperCase(),
        vehicleModel: vehicleModel.toUpperCase(),
        vehicleColor: vehicleColor.toUpperCase(),
        vehicleYear,
        vehiclePlate: vehiclePlate.toUpperCase(),
        vehicleChassis: vehicleChassis.toUpperCase(),
        vehicleRenavam,
        debtTotalInstallments: Number(debtTotalInstallments || 48),
        debtPaidInstallments: Number(debtPaidInstallments || 0),
        debtOverdueInstallments: Number(debtOverdueInstallments || 0),
        financedAmountCents: parseReaisToCents(financedAmountReais),
        currentInstallmentCents: parseReaisToCents(currentInstallmentReais),
        debtDueDay: Math.min(31, Math.max(1, Number(debtDueDay || 10))),
        paymentType,
        debtAmountCents: debtBaseCents,
        serviceMgmtCents: mgmtCents,
        serviceInitialCents: initialCostCents,
        serviceDiscountCents: discountCents,
        serviceAdditionCents: additionCents,
        serviceFeeCents: servicesTotalCents,
        billingFeeCents: parseReaisToCents(billingFeeReais),
        notes,
        scenariosJson: scenarios,
        status: nextStatus,
      };

      let savedAdm: Admission;
      if (editingAdmissionId) {
        const res = await apiFetch<{ admission: Admission }>(`/api/admissions/${editingAdmissionId}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        savedAdm = res.admission;
      } else {
        const res = await apiFetch<{ admission: Admission }>('/api/admissions', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        savedAdm = res.admission;
        setEditingAdmissionId(savedAdm.id);
        setContractNumber(savedAdm.contractNumber);
      }

      setStatus(savedAdm.status);
      await load();

      if (opts?.stayOpenForDocs) {
        setFormTab('documentos');
        setFeedback(`Ficha ${savedAdm.contractNumber} salva! Aba Documentos liberada para anexos.`);
      } else if (opts?.stayOpen) {
        setFeedback(`Ficha ${savedAdm.contractNumber} salva com sucesso.`);
      } else {
        setFeedback(`Processo ${savedAdm.contractNumber} salvo com sucesso (${LIST_STATUS_LABELS[savedAdm.status]?.label || savedAdm.status}).`);
        navigateViewMode('list', false);
      }
      return savedAdm;
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao salvar processo.');
      return null;
    } finally {
      setSaving(false);
    }
  };

  // Print behavior (Guide Sec 10: recalculates scenarios, opens print, transitions Pendente -> Negociação)
  const handlePrintAction = async () => {
    const calculated = calculateAllScenarios(scenarios);
    setScenarios(calculated);
    if (editingAdmissionId && status === 'pendente') {
      try {
        const res = await apiFetch<{ admission: Admission }>(`/api/admissions/${editingAdmissionId}`, {
          method: 'PATCH',
          body: JSON.stringify({ printAutoTransition: true }),
        });
        setStatus(res.admission.status);
        setFeedback('Status atualizado automaticamente de Pendente para Negociação ao imprimir.');
        await load();
      } catch {
        // non-blocking
      }
    }
    setPreviewOpen(true);
    setTimeout(() => window.print(), 250);
  };

  const getAdmissionFormContext = (): FormMergeContext => {
    const unitObj = units.find((u) => u.id === unitId) || units[0] || null;
    const colOpt = consultants.find((c) => c.id === consultantId) || null;
    const cadCol =
      cadastrosData?.collaborators?.find(
        (c) => (colOpt && c.name.toLowerCase() === colOpt.name.toLowerCase()) || (consultantName && c.name.toLowerCase() === consultantName.toLowerCase())
      ) || null;
    const bankObj =
      banksCatalog.find((b) => b.name.toLowerCase() === bankName.trim().toLowerCase()) ||
      cadastrosData?.banks?.find((b) => b.name.toLowerCase() === bankName.trim().toLowerCase()) ||
      null;
    const sc0 = scenarios[0] || null;
    return {
      client: respClient || null,
      titular: titClient || respClient || null,
      collaborator: cadCol
        ? { ...cadCol }
        : colOpt
        ? { id: colOpt.id, name: colOpt.name, role: colOpt.role }
        : consultantName
        ? { name: consultantName }
        : null,
      bank: bankObj ? { ...bankObj } : { name: bankName },
      company: unitObj,
      admission: {
        id: editingAdmissionId || 0,
        contractNumber: displayContractNumber,
        protocolCode: displayContractNumber,
        bankName,
        modality,
        series,
        origin,
        indicationSource,
        status,
        clientRoleSelected,
        debtTotalInstallments: Number(debtTotalInstallments) || 0,
        debtPaidInstallments: Number(debtPaidInstallments) || 0,
        debtOverdueInstallments: Number(debtOverdueInstallments) || 0,
        financedAmountCents: parseReaisToCents(financedAmountReais),
        currentInstallmentCents: parseReaisToCents(currentInstallmentReais),
        debtDueDay: Number(debtDueDay) || 10,
        paymentType,
        serviceFeeCents: parseReaisToCents(serviceMgmtReais),
        serviceInitialCents: parseReaisToCents(serviceInitialReais),
        serviceAdditionCents: parseReaisToCents(serviceAdditionReais),
        billingFeeCents: parseReaisToCents(billingFeeReais),
        notes,
        vehicleBrand,
        vehicleModel,
        vehicleColor,
        vehicleYear,
        vehiclePlate,
        vehicleChassis,
        vehicleRenavam,
        scenariosJson: scenarios,
      },
      recalc: sc0 || undefined,
      modality: { description: modality, type: showVehicleSection ? 'Veículo' : 'Financeiro' },
      series: { acronym: series, description: series },
    };
  };

  // Export Word .docx (direct or custom .docx template)
  const handleExportDocx = async (templateFile?: File) => {
    setErrorMsg('');
    if (templateFile) {
      const lower = templateFile.name.toLowerCase();
      if (lower.endsWith('.doc') && !lower.endsWith('.docx')) {
        setErrorMsg('Arquivos .doc antigos não são suportados. Envie um arquivo .docx.');
        return;
      }
    }

    let admId = editingAdmissionId;
    if (!admId) {
      const saved = await handleSaveProcess({ stayOpen: true });
      if (!saved) return;
      admId = saved.id;
    }

    try {
      const token = getAuthToken();
      const baseHeaders = {
        'x-unit-id': String(getActiveUnitHeader()),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      };
      let resp: Response;
      if (templateFile) {
        const form = new FormData();
        form.append('template', templateFile);
        resp = await fetch(`/api/admissions/${admId}/export-docx`, {
          method: 'POST',
          headers: baseHeaders,
          body: form,
        });
      } else {
        resp = await fetch(`/api/admissions/${admId}/export-docx`, {
          method: 'POST',
          headers: baseHeaders,
        });
      }
      if (!resp.ok) {
        await parseJsonResponse(resp, 'Falha ao gerar arquivo .docx.');
      }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Admissao_${displayContractNumber.replace(/[^a-zA-Z0-9_-]/g, '_')}.docx`;
      a.click();
      URL.revokeObjectURL(url);
      setWordModalOpen(false);
      setFeedback('Documento Word (.docx) exportado com sucesso.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao exportar Word (.docx).');
    }
  };

  // Person Modal handlers (Subflow Criar/Editar Titular ou Responsável no PostgreSQL)
  const openPersonModal = (targetRole: 'responsavel' | 'titular', mode: 'create' | 'edit', client?: Client) => {
    setPersonModal({ open: true, targetRole, mode, clientId: client?.id });
    if (mode === 'edit' && client) {
      setPName(client.fullName || '');
      setPCpf(client.cpfCnpj || '');
      setPRg(client.rg || '');
      setPPhone(client.phone || '');
      setPEmail(client.email || '');
      setPProfession(client.profession || '');
      setPMaritalStatus(client.maritalStatus || '');
      setPBirthDate(client.birthDate || '');
      setPZipCode(client.zipCode || '');
      setPAddress(client.address || '');
      setPNumber(client.addressNumber || '');
      setPNeighborhood(client.neighborhood || '');
      setPCity(client.city || '');
      setPState(client.state || '');
    } else {
      setPName('');
      setPCpf('');
      setPRg('');
      setPPhone('');
      setPEmail('');
      setPProfession('');
      setPMaritalStatus('');
      setPBirthDate('');
      setPZipCode('');
      setPAddress('');
      setPNumber('');
      setPNeighborhood('');
      setPCity('');
      setPState('');
    }
  };

  const handleSavePersonModal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!personModal || !pName.trim()) {
      setErrorMsg('Nome / Razão social é obrigatório.');
      return;
    }
    try {
      const body = {
        fullName: pName.trim(),
        cpfCnpj: pCpf.trim(),
        rg: pRg.trim(),
        phone: pPhone.trim(),
        email: pEmail.trim(),
        profession: pProfession.trim(),
        maritalStatus: pMaritalStatus.trim(),
        birthDate: pBirthDate.trim(),
        zipCode: pZipCode.trim(),
        address: pAddress.trim(),
        addressNumber: pNumber.trim(),
        neighborhood: pNeighborhood.trim(),
        city: pCity.trim(),
        state: pState.trim(),
        clientType: personModal.targetRole === 'titular' ? 'titular' : 'responsavel_bem',
        unitId,
      };
      let savedClient: Client;
      if (personModal.mode === 'edit' && personModal.clientId) {
        const res = await apiFetch<{ client: Client }>(`/api/clients/${personModal.clientId}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        });
        savedClient = res.client;
      } else {
        const res = await apiFetch<{ client: Client }>('/api/clients', {
          method: 'POST',
          body: JSON.stringify(body),
        });
        savedClient = res.client;
      }
      await load();
      if (personModal.targetRole === 'responsavel') {
        setResponsibleClientId(savedClient.id);
        setRespSearch(savedClient.fullName);
      } else {
        setTitularClientId(savedClient.id);
        setTitSearch(savedClient.fullName);
      }
      setPersonModal(null);
      setFeedback(`Cadastro de ${savedClient.fullName} salvo no banco e vinculado à ficha.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao salvar cadastro de pessoa.');
    }
  };

  // Document Upload (Multi-file to bucketdainvicta), Preview & Download
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);
    e.target.value = '';
    const targetClientId =
      docOwnerTarget === 'titular' && titularClientId ? titularClientId : responsibleClientId;
    if (!targetClientId) {
      setErrorMsg('Selecione o Cliente Responsável antes de enviar anexos ao bucket.');
      return;
    }
    setUploading(true);
    setErrorMsg('');
    try {
      let dedupCount = 0;
      for (const file of files) {
        const form = new FormData();
        form.append('file', file);
        form.append('clientId', String(targetClientId));
        if (editingAdmissionId) form.append('admissionId', String(editingAdmissionId));
        form.append('docCategory', docCategory);
        const res = await apiFetch<{ deduplicated?: boolean }>('/api/documents/upload', {
          method: 'POST',
          body: form,
        });
        if (res.deduplicated) dedupCount++;
      }
      setFeedback(
        `${files.length} arquivo(s) gravado(s) com criptografia AES-256-GCM no bucket bucketdainvicta${
          dedupCount > 0 ? ` (${dedupCount} deduplicado(s) via SHA-256)` : ''
        }.`
      );
      await load();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Falha no upload.');
    } finally {
      setUploading(false);
    }
  };

  const handleDownloadDoc = async (doc: DocumentObject) => {
    const token = getAuthToken();
    const res = await fetch(`/api/documents/${doc.id}/download`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      setErrorMsg('Não foi possível baixar o arquivo do bucket.');
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = doc.fileName;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handlePreviewDoc = async (doc: DocumentObject) => {
    setPreviewDocModal({ doc, blobUrl: '', loading: true });
    try {
      const token = getAuthToken();
      const res = await fetch(`/api/documents/${doc.id}/download?preview=1`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Falha ao carregar visualização segura do bucket.');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      setPreviewDocModal({ doc, blobUrl: url, loading: false });
    } catch (err) {
      setPreviewDocModal(null);
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao visualizar documento.');
    }
  };

  const handleLinkExistingDocToAdmission = async (doc: DocumentObject) => {
    if (!editingAdmissionId) return;
    setErrorMsg('');
    try {
      await apiFetch(`/api/admissions/${editingAdmissionId}/link-document`, {
        method: 'POST',
        body: JSON.stringify({ documentId: doc.id }),
      });
      setFeedback(`Documento "${doc.fileName}" vinculado ao dossiê desta ficha (sem duplicar binário no bucket).`);
      await load();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao vincular documento.');
    }
  };

  const handleDownloadUrl = async (urlPath: string, fileName: string) => {
    const token = getAuthToken();
    const res = await fetch(urlPath, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      setErrorMsg('Falha ao baixar anexo do bucket.');
      return;
    }
    const blob = await res.blob();
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objUrl;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(objUrl);
  };

  // Keyboard Navigation (Guide Sec 10: Enter advances focus, Space toggles option labels)
  const handleFormKeyDown = (e: React.KeyboardEvent<HTMLFormElement>) => {
    const target = e.target as HTMLElement;
    if (e.key === 'Enter' && target.tagName !== 'TEXTAREA' && target.tagName !== 'BUTTON') {
      e.preventDefault();
      const focusables = Array.from(
        formRef.current?.querySelectorAll<HTMLElement>(
          'input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled])'
        ) || []
      );
      const idx = focusables.indexOf(target);
      if (idx >= 0 && idx < focusables.length - 1) {
        focusables[idx + 1].focus();
      }
    }
  };

  // List Filtering, Sorting & 50-row Pagination (Guide Sec 2)
  const uniqueBanksInList = useMemo(
    () => Array.from(new Set(admissions.map((a) => a.bankName).filter(Boolean))).sort(),
    [admissions]
  );

  const filteredAndSortedList = useMemo(() => {
    const filtered = admissions.filter((adm) => {
      const cl = clients.find((c) => c.id === adm.clientId);
      const clName = (cl?.fullName || '').toLowerCase();
      if (quickSearchDebounced) {
        const digits = quickSearchDebounced.replace(/\D/g, '');
        const matchQuick =
          clName.includes(quickSearchDebounced) ||
          adm.contractNumber.toLowerCase().includes(quickSearchDebounced) ||
          adm.protocolCode.toLowerCase().includes(quickSearchDebounced) ||
          (cl?.cpfCnpj || '').toLowerCase().includes(quickSearchDebounced) ||
          (cl?.phone || '').toLowerCase().includes(quickSearchDebounced) ||
          (digits.length >= 3 &&
            ((cl?.cpfCnpj || '').replace(/\D/g, '').includes(digits) ||
              (cl?.phone || '').replace(/\D/g, '').includes(digits)));
        if (!matchQuick) return false;
      }
      if (filterClientName.trim() && !clName.includes(filterClientName.trim().toLowerCase())) {
        return false;
      }
      if (filterBank !== 'all' && adm.bankName !== filterBank) return false;
      if (filterStatus !== 'all' && adm.status !== filterStatus) return false;
      if (filterConsultant !== 'all' && String(adm.consultantId || '') !== filterConsultant) return false;
      if (filterDateFrom) {
        const d = new Date(adm.createdAt).toISOString().slice(0, 10);
        if (d < filterDateFrom) return false;
      }
      if (filterDateTo) {
        const d = new Date(adm.createdAt).toISOString().slice(0, 10);
        if (d > filterDateTo) return false;
      }
      return true;
    });

    return filtered.sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'date') {
        cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      } else if (sortBy === 'contract') {
        cmp = `${a.series || 'ADM'}-${a.contractNumber}`.localeCompare(`${b.series || 'ADM'}-${b.contractNumber}`);
      } else {
        const na = clients.find((c) => c.id === a.clientId)?.fullName || '';
        const nb = clients.find((c) => c.id === b.clientId)?.fullName || '';
        cmp = na.localeCompare(nb);
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [
    admissions,
    clients,
    quickSearchDebounced,
    filterClientName,
    filterBank,
    filterStatus,
    filterConsultant,
    filterDateFrom,
    filterDateTo,
    sortBy,
    sortDir,
  ]);

  const pageSize = 50;
  const totalPages = Math.max(1, Math.ceil(filteredAndSortedList.length / pageSize));
  const pagedList = filteredAndSortedList.slice((page - 1) * pageSize, page * pageSize);

  const toggleSort = (col: 'date' | 'contract' | 'client') => {
    if (sortBy === col) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(col);
      setSortDir(col === 'date' ? 'desc' : 'asc');
    }
  };

  return (
    <div className="space-y-4">
      {/* Feedback & Errors */}
      {feedback && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-medium text-emerald-900 flex items-center justify-between dark:border-emerald-800/70 dark:bg-emerald-950/50 dark:text-emerald-300">
          <span>{feedback}</span>
          <button type="button" onClick={() => setFeedback('')} className="text-emerald-700 hover:text-emerald-900 dark:text-emerald-300 dark:hover:text-emerald-200">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      {errorMsg && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-xs font-medium text-red-700 flex items-center justify-between dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300">
          <span>{errorMsg}</span>
          <button type="button" onClick={() => setErrorMsg('')} className="text-red-700 hover:text-red-900 dark:text-red-300 dark:hover:text-red-200">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* ===================================================================
          MODO 1: LISTAGEM DE ADMISSÕES (Atendimento > Comercial > Admissão)
         =================================================================== */}
      {viewMode === 'list' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 pb-4 dark:border-slate-700">
            <div>
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Atendimento &gt; Comercial &gt; Admissão
              </p>
              <h1 className="mt-1 font-display text-2xl font-bold text-slate-900 dark:text-slate-100">
                Admissão · Fichas de Processo
              </h1>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setSectorAuditOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-700 whitespace-nowrap"
              >
                <History className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
                Auditoria
              </button>
              <button
                type="button"
                onClick={() => navigateViewMode('vault')}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-700 whitespace-nowrap"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                Cofre bucketdainvicta ({documents.length})
              </button>
              <button
                type="button"
                onClick={openNewForm}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                Nova Ficha
              </button>
            </div>
          </div>

          {/* Search & Collapsible Advanced Filters */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3 dark:border-slate-700 dark:bg-slate-900">
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5 dark:text-slate-400" />
                <input
                  type="text"
                  value={quickSearchInput}
                  onChange={(e) => setQuickSearchInput(e.target.value)}
                  placeholder="Pesquisa rápida por cliente, nº contrato, CPF/CNPJ ou telefone..."
                  className="w-full rounded-lg border border-slate-200 pl-8 pr-3 py-2 text-xs dark:border-slate-700"
                />
              </div>
              <button
                type="button"
                onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <Filter className="w-3.5 h-3.5" />
                Filtros Avançados
                {showAdvancedFilters ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>
            </div>

            {showAdvancedFilters && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2.5 pt-2 border-t border-slate-100 text-xs dark:border-slate-800">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">Filtrar Cliente</label>
                  <input
                    type="text"
                    value={filterClientName}
                    onChange={(e) => {
                      setFilterClientName(e.target.value);
                      setPage(1);
                    }}
                    placeholder="Nome do cliente..."
                    className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs dark:border-slate-700"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">Banco Credor</label>
                  <select
                    value={filterBank}
                    onChange={(e) => {
                      setFilterBank(e.target.value);
                      setPage(1);
                    }}
                    className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  >
                    <option value="all">Todos</option>
                    {uniqueBanksInList.map((b) => (
                      <option key={b} value={b}>{b}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">Status do Processo</label>
                  <select
                    value={filterStatus}
                    onChange={(e) => {
                      setFilterStatus(e.target.value);
                      setPage(1);
                    }}
                    className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  >
                    <option value="all">Todos</option>
                    <option value="pendente">Pendente</option>
                    <option value="negociacao">Negociação</option>
                    <option value="aguardando_auditoria">Aguardando Auditoria</option>
                    <option value="aprovada">Aprovada</option>
                    <option value="analise_cliente">Análise Cliente</option>
                    <option value="reprovada">Reprovada</option>
                    <option value="devolvida_admissao">Retorno Auditoria</option>
                    <option value="auditada">Auditada</option>
                    <option value="finalizada">Finalizada</option>
                    <option value="concluido">Concluído</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">Consultor</label>
                  <select
                    value={filterConsultant}
                    onChange={(e) => {
                      setFilterConsultant(e.target.value);
                      setPage(1);
                    }}
                    className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs dark:border-slate-700"
                  >
                    <option value="all">Todos</option>
                    {consultants.map((c) => (
                      <option key={c.id} value={String(c.id)}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">Data Inicial</label>
                  <input
                    type="date"
                    value={filterDateFrom}
                    onChange={(e) => {
                      setFilterDateFrom(e.target.value);
                      setPage(1);
                    }}
                    className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-mono dark:border-slate-700"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">Data Final</label>
                  <input
                    type="date"
                    value={filterDateTo}
                    onChange={(e) => {
                      setFilterDateTo(e.target.value);
                      setPage(1);
                    }}
                    className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-mono dark:border-slate-700"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Admissions List Table (Columns matching Guide Sec 2) */}
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden dark:border-slate-700 dark:bg-slate-900">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-300">
                    <th className="py-3 px-4">
                      <button
                        type="button"
                        onClick={() => toggleSort('date')}
                        className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white"
                      >
                        Data <ArrowDownUp className="w-3 h-3" />
                      </button>
                    </th>
                    <th className="py-3 px-4">
                      <button
                        type="button"
                        onClick={() => toggleSort('contract')}
                        className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white"
                      >
                        Contrato <ArrowDownUp className="w-3 h-3" />
                      </button>
                    </th>
                    <th className="py-3 px-4">
                      <button
                        type="button"
                        onClick={() => toggleSort('client')}
                        className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white"
                      >
                        Cliente <ArrowDownUp className="w-3 h-3" />
                      </button>
                    </th>
                    <th className="py-3 px-4">Origem</th>
                    <th className="py-3 px-4">Unidade</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {pagedList.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-slate-500 dark:text-slate-400">
                        Nenhuma ficha de admissão localizada nos critérios atuais.
                      </td>
                    </tr>
                  ) : (
                    pagedList.map((adm) => {
                      const cl = clients.find((c) => c.id === adm.clientId);
                      const un = units.find((u) => u.id === adm.unitId);
                      const phoneTail = String(cl?.phone || cl?.whatsapp || '').replace(/\D/g, '').slice(-8);
                      const hasGoTalk = Boolean(phoneTail && threadPhones.includes(phoneTail));
                      const stInfo = LIST_STATUS_LABELS[adm.status] || {
                        label: adm.status.replace(/_/g, ' '),
                        tone: 'text-slate-700',
                      };
                      const canDelete = !['aprovada', 'auditada', 'em_andamento', 'finalizada', 'concluido'].includes(adm.status);
                      return (
                        <tr key={adm.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800">
                          <td className="py-3 px-4 font-mono text-slate-600 tabular-nums whitespace-nowrap dark:text-slate-300">
                            {formatDateBR(adm.createdAt)}
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            <div className="font-mono font-bold text-slate-900 dark:text-slate-100">
                              {adm.series || 'ADM'} · {adm.contractNumber}
                            </div>
                            <div className="text-[11px] text-slate-500 truncate max-w-[180px] dark:text-slate-400">
                              {adm.bankName}
                            </div>
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-1.5 font-semibold text-slate-900 dark:text-slate-100">
                              <span>{cl?.fullName || 'Cliente'}</span>
                              {hasGoTalk && (
                                <span title="Possui histórico WhatsApp / GoTalk" className="text-emerald-600 dark:text-emerald-400">
                                  <MessageSquare className="w-3.5 h-3.5" />
                                </span>
                              )}
                            </div>
                            <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400">{cl?.cpfCnpj || '—'}</div>
                          </td>
                          <td className="py-3 px-4 text-slate-600 capitalize dark:text-slate-300">
                            {adm.origin || '—'}
                          </td>
                          <td className="py-3 px-4 text-slate-700 whitespace-nowrap dark:text-slate-200">
                            {un?.name || `Unidade ${adm.unitId}`}
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            <span className={stInfo.tone}>{stInfo.label}</span>
                          </td>
                          <td className="py-3 px-4 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-1">
                              <button
                                type="button"
                                title="Histórico de Auditoria"
                                onClick={() => setHistoryAdmission(adm)}
                                className="rounded-md border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                              >
                                <History className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                title="Editar Ficha"
                                onClick={() => openEditForm(adm)}
                                className="rounded-md border border-slate-200 p-1.5 text-blue-700 hover:bg-blue-50 dark:border-slate-700 dark:text-blue-300 dark:hover:bg-blue-950/60"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                title="Visualizar Prévia"
                                onClick={() => {
                                  openEditForm(adm);
                                  setPreviewOpen(true);
                                }}
                                className="rounded-md border border-slate-200 p-1.5 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                              >
                                <Eye className="w-3.5 h-3.5" />
                              </button>
                              {canDelete && (
                                <button
                                  type="button"
                                  title="Excluir Ficha"
                                  onClick={async () => {
                                    try {
                                      await apiFetch(`/api/admissions/${adm.id}`, { method: 'DELETE' });
                                      setFeedback(`Ficha ${adm.contractNumber} excluída com sucesso.`);
                                      await load();
                                    } catch (err) {
                                      setErrorMsg(err instanceof Error ? err.message : 'Erro ao excluir ficha.');
                                    }
                                  }}
                                  className="rounded-md border border-red-200 p-1.5 text-red-600 hover:bg-red-50 dark:border-red-800/70 dark:text-red-400 dark:hover:bg-red-950/60"
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

            {/* 50-row Pagination */}
            <div className="px-4 py-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-600 dark:border-slate-800 dark:text-slate-300">
              <span>
                Exibindo {pagedList.length} de {filteredAndSortedList.length} admissões (página {page} de {totalPages})
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1 disabled:opacity-40 dark:border-slate-700"
                >
                  <ChevronLeft className="w-3.5 h-3.5" /> Anterior
                </button>
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1 disabled:opacity-40 dark:border-slate-700"
                >
                  Próxima <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================
          MODO 2: FORMULÁRIO DA FICHA (Fiel ao PNG + Guia de Admissão)
         =================================================================== */}
      {viewMode === 'form' && (
        <div className="space-y-4">
          {/* Sub-abas da Ficha (PNG: Formulário | WhatsApp | Atendimentos | Documentos (n)) */}
          <div className="flex flex-wrap items-center gap-1 border-b border-slate-200 bg-white rounded-t-xl px-4 pt-2 dark:border-slate-700 dark:bg-slate-900">
            {[
              { id: 'formulario', label: 'Formulário', icon: FileText },
              { id: 'whatsapp', label: 'WhatsApp', icon: MessageSquare },
              { id: 'atendimentos', label: 'Atendimentos', icon: PhoneCall },
              { id: 'documentos', label: `Documentos (${activeAdmissionDocs.length})`, icon: FolderOpen },
            ].map((t) => {
              const Icon = t.icon;
              const active = formTab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setFormTab(t.id as typeof formTab)}
                  className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap ${
                    active
                      ? 'border-slate-900 text-slate-900 dark:border-emerald-500 dark:text-slate-100'
                      : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {t.label}
                </button>
              );
            })}
          </div>

          {/* Cabeçalho da Ficha (PNG: NOVA/EDITAR ADMISSÃO | Voltar para Lista | Toolbar Template/Visualizar/Imprimir/Exportar Word | Box Nº Contrato) */}
          <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 px-1">
            <div>
              <h1 className="font-display text-2xl font-extrabold italic tracking-tight text-slate-900 dark:text-slate-100">
                {editingAdmissionId ? 'EDITAR ADMISSÃO' : 'NOVA ADMISSÃO'}
              </h1>
              <p className="text-xs text-slate-500 mt-0.5 dark:text-slate-400">
                Preencha os dados do processo financeiro.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleBackFromSubView}
                className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white whitespace-nowrap"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                {viewHistory.length > 0 && viewHistory[viewHistory.length - 1] === 'vault'
                  ? 'Voltar ao Cofre'
                  : 'Voltar para Lista'}
              </button>

              <div className="inline-flex flex-wrap items-center rounded-xl border border-slate-200 bg-white shadow-xs divide-x divide-slate-200 dark:border-slate-700 dark:bg-slate-900 dark:divide-slate-700">
                <select
                  value={previewTemplate}
                  onChange={(e) => setPreviewTemplate(e.target.value as typeof previewTemplate)}
                  className="bg-transparent px-3 py-2 text-xs font-medium text-slate-700 focus:outline-none dark:text-slate-200"
                >
                  <option value="padrao">Ficha Padrão</option>
                  <option value="procuracao">Procuração Ad Judicia</option>
                  <option value="completo">Dossiê Completo</option>
                </select>
                <button
                  type="button"
                  onClick={() => setPreviewOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-slate-800 hover:bg-slate-50 whitespace-nowrap dark:text-slate-100 dark:hover:bg-slate-800"
                >
                  <Eye className="w-3.5 h-3.5" />
                  VISUALIZAR
                </button>
                <button
                  type="button"
                  onClick={handlePrintAction}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-slate-800 hover:bg-slate-50 whitespace-nowrap dark:text-slate-100 dark:hover:bg-slate-800"
                >
                  <Printer className="w-3.5 h-3.5" />
                  IMPRIMIR
                </button>
                <button
                  type="button"
                  onClick={() => setWordModalOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-blue-700 hover:bg-blue-50 whitespace-nowrap dark:text-blue-300 dark:hover:bg-blue-950/60"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  EXPORTAR WORD
                </button>
              </div>

              <FormTemplateButton
                menuId="com_admissao"
                label="Modelos A4"
                getContext={getAdmissionFormContext}
                onError={(msg) => setErrorMsg(msg)}
              />

              <div className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-right shadow-xs min-w-[140px] dark:border-slate-700 dark:bg-slate-900">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-400">
                  Nº CONTRATO
                </div>
                <div className="font-mono text-sm font-extrabold text-slate-900 dark:text-slate-100">
                  {displayContractNumber}
                </div>
              </div>
            </div>
          </div>

          {/* Somente leitura aviso quando Aprovada */}
          {isApprovedLocked && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-900 flex items-center justify-between gap-2 dark:border-emerald-800/70 dark:bg-emerald-950/50 dark:text-emerald-300">
              <div className="flex items-center gap-2 font-semibold">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 dark:text-emerald-400" />
                Ficha aprovada em modo somente leitura. Para corrigir dados, a Auditoria deve devolvê-la.
              </div>
              {onNavigate && (
                <button
                  type="button"
                  onClick={() => onNavigate('audit', { admissionId: editingAdmissionId || undefined })}
                  className="font-bold text-blue-700 hover:underline whitespace-nowrap dark:text-blue-300"
                >
                  Abrir na Auditoria →
                </button>
              )}
            </div>
          )}

          {/* Críticas da Auditoria (Histórico de Rodadas + Resposta Obrigatória do Comercial) */}
          {auditCritiques.length > 0 && formTab === 'formulario' && (
            <div className="rounded-xl border border-red-200 bg-red-50/70 p-4 space-y-3 text-xs dark:border-red-800/70 dark:bg-red-950/50">
              <div className="flex items-center gap-2 font-bold text-red-800 dark:text-red-300">
                <ShieldAlert className="w-4 h-4" />
                Críticas da Auditoria ({auditCritiques.length} rodada{auditCritiques.length > 1 ? 's' : ''})
              </div>
              <div className="space-y-2">
                {auditCritiques.map((c) => (
                  <div key={c.id} className="rounded-lg border border-red-200 bg-white p-3 space-y-1 dark:border-red-800/70 dark:bg-slate-900">
                    <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                      <span>Rodada #{c.round} · Auditor: <strong className="text-slate-800 dark:text-slate-100">{c.author}</strong></span>
                      <span className="font-mono">{formatDateBR(c.createdAt)}</span>
                    </div>
                    <div className="text-red-700 font-medium dark:text-red-300">{c.reason}</div>
                    {c.commercialResponse && (
                      <div className="mt-1 rounded bg-emerald-50 px-2.5 py-1.5 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300">
                        <strong>Resposta Comercial ({c.respondedBy}):</strong> {c.commercialResponse}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              {auditCritiques.some((c) => !c.commercialResponse?.trim()) && editingAdmissionId && (
                <div className="flex flex-col sm:flex-row gap-2 pt-1">
                  <input
                    type="text"
                    value={commercialCritiqueReply}
                    onChange={(e) => setCommercialCritiqueReply(e.target.value)}
                    placeholder="Escreva a resposta do Comercial para a crítica aberta..."
                    className="flex-1 rounded-lg border border-red-300 bg-white px-3 py-2 text-xs dark:border-red-800/70 dark:bg-slate-900"
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      if (!commercialCritiqueReply.trim()) return;
                      try {
                        const res = await apiFetch<{ admission: Admission }>(
                          `/api/admissions/${editingAdmissionId}/respond-critique`,
                          {
                            method: 'POST',
                            body: JSON.stringify({ responseText: commercialCritiqueReply, resubmitToAudit: true }),
                          }
                        );
                        setAuditCritiques(res.admission.auditCritiquesJson || []);
                        setStatus(res.admission.status);
                        setCommercialCritiqueReply('');
                        setFeedback('Resposta registrada e ficha reenviada à Auditoria.');
                        await load();
                      } catch (err) {
                        setErrorMsg(err instanceof Error ? err.message : 'Erro ao responder crítica.');
                      }
                    }}
                    className="rounded-lg bg-red-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-red-700 whitespace-nowrap"
                  >
                    Responder Crítica & Reenviar
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ABA 1: FORMULÁRIO PRINCIPAL */}
          {formTab === 'formulario' && (
            <form
              ref={formRef}
              onKeyDown={handleFormKeyDown}
              onSubmit={(e) => {
                e.preventDefault();
                handleSaveProcess();
              }}
              className="space-y-5"
            >
              {/* SEÇÃO 01. DADOS DO CLIENTE (Idêntico ao PNG) */}
              <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-5 dark:border-slate-700 dark:bg-slate-900">
                <h2 className="text-xs font-extrabold tracking-widest text-slate-900 dark:text-slate-100">
                  01. DADOS DO CLIENTE
                </h2>

                {/* Tipo do Cliente: Responsável / Titular */}
                <div className="flex items-center gap-6 text-xs font-medium text-slate-800 dark:text-slate-100">
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="clientRole"
                      disabled={isApprovedLocked}
                      checked={clientRoleSelected === 'responsavel'}
                      onChange={() => setClientRoleSelected('responsavel')}
                    />
                    Responsável
                  </label>
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="clientRole"
                      disabled={isApprovedLocked}
                      checked={clientRoleSelected === 'titular'}
                      onChange={() => setClientRoleSelected('titular')}
                    />
                    Titular
                  </label>
                </div>

                {/* Linha 1: UNIDADE * | STATUS | ORIGEM | NOME OU RAZÃO SOCIAL */}
                <div className="grid grid-cols-1 md:grid-cols-12 gap-3.5 items-start">
                  <div className="md:col-span-3">
                    <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">
                      UNIDADE <span className="text-red-500">*</span>
                    </label>
                    <select
                      disabled={isApprovedLocked}
                      value={unitId}
                      onChange={(e) => handleSelectUnit(Number(e.target.value))}
                      className="w-full rounded-lg border border-emerald-400 bg-emerald-50/40 px-3 py-2 text-xs font-bold text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300 dark:text-slate-100"
                    >
                      {units.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">STATUS</label>
                    <select
                      disabled={isApprovedLocked}
                      value={status}
                      onChange={(e) => setStatus(e.target.value)}
                      className="w-full rounded-lg border border-sky-300 bg-sky-50/50 px-3 py-2 text-xs font-bold text-blue-700 dark:border-sky-800/70 dark:bg-sky-950/50 dark:text-blue-300"
                    >
                      {FORM_STATUS_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                    <div className="mt-1 text-[10px] font-bold text-blue-600 dark:text-blue-400">* MUDA APÓS IMPRIMIR.</div>
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">ORIGEM</label>
                    <select
                      disabled={isApprovedLocked}
                      value={origin}
                      onChange={(e) => setOrigin(e.target.value)}
                      className="w-full rounded-lg border border-purple-300 bg-purple-50/40 px-3 py-2 text-xs font-bold text-purple-700 dark:border-purple-800/70 dark:bg-purple-950/50 dark:text-purple-300"
                    >
                      <option value="">SELECIONE...</option>
                      <option value="prospeccao">PROSPECÇÃO</option>
                      <option value="propaganda">PROPAGANDA</option>
                      <option value="recuperacao">RECUPERAÇÃO</option>
                    </select>
                  </div>

                  <div className="md:col-span-5 relative">
                    <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">
                      NOME OU RAZÃO SOCIAL <span className="text-red-500">*</span>
                    </label>
                    <div className="flex items-center gap-1.5">
                      <div className="relative flex-1">
                        <input
                          type="text"
                          disabled={isApprovedLocked}
                          value={respDropdownOpen ? respSearch : respClient?.fullName || respSearch}
                          onFocus={() => {
                            if (!isApprovedLocked) {
                              setRespDropdownOpen(true);
                              setRespSearch(respClient?.fullName || '');
                            }
                          }}
                          onChange={(e) => {
                            setRespDropdownOpen(true);
                            setRespSearch(e.target.value);
                          }}
                          placeholder="Pesquisar cliente (mín. 3 letras)..."
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-900 dark:border-slate-700 dark:text-slate-100"
                        />
                        {respDropdownOpen && !isApprovedLocked && (
                          <div className="absolute z-30 left-0 right-0 mt-1 max-h-56 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg text-xs dark:border-slate-700 dark:bg-slate-900">
                            {respSearchErr ? (
                              <div className="p-3 text-red-600 dark:text-red-400">{respSearchErr}</div>
                            ) : respRemoteResults.length === 0 ? (
                              <div className="p-3 text-slate-500 dark:text-slate-400">Nenhum cliente encontrado.</div>
                            ) : (
                              <>
                                {respRemoteResults.map((c) => (
                                  <button
                                    key={c.id}
                                    type="button"
                                    onClick={() => {
                                      setResponsibleClientId(c.id);
                                      setRespSearch(c.fullName);
                                      setRespDropdownOpen(false);
                                    }}
                                    className="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center justify-between border-b border-slate-50 dark:hover:bg-slate-800"
                                  >
                                    <span className="font-semibold text-slate-900 truncate dark:text-slate-100">{c.fullName}</span>
                                    <span className="font-mono text-[11px] text-slate-500 shrink-0 dark:text-slate-400">{c.cpfCnpj}</span>
                                  </button>
                                ))}
                                {respHasMore && (
                                  <button
                                    type="button"
                                    onClick={async () => {
                                      const res = await apiFetch<{ clients: Client[]; hasMore: boolean }>(
                                        `/api/clients/search?q=${encodeURIComponent(respSearch)}&offset=${respRemoteResults.length}&limit=15`
                                      );
                                      setRespRemoteResults((prev) => [...prev, ...res.clients]);
                                      setRespHasMore(res.hasMore);
                                    }}
                                    className="w-full py-2 text-center font-semibold text-blue-700 hover:bg-blue-50 dark:text-blue-300 dark:hover:bg-blue-950/60"
                                  >
                                    Próximos resultados
                                  </button>
                                )}
                              </>
                            )}
                            <button
                              type="button"
                              onClick={() => setRespDropdownOpen(false)}
                              className="w-full py-1.5 text-center text-[11px] text-slate-400 border-t border-slate-100 dark:text-slate-400 dark:border-slate-800"
                            >
                              Fechar lista
                            </button>
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        disabled={isApprovedLocked || !respClient}
                        title="Editar cadastro do cliente"
                        onClick={() => respClient && openPersonModal('responsavel', 'edit', respClient)}
                        className="rounded-lg border border-slate-200 p-2 text-amber-600 hover:bg-amber-50 disabled:opacity-40 dark:border-slate-700 dark:text-amber-400 dark:hover:bg-amber-950/60"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={isApprovedLocked}
                        title="Cadastrar novo cliente"
                        onClick={() => openPersonModal('responsavel', 'create')}
                        className="rounded-lg border border-slate-200 p-2 text-slate-700 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Linha condicional: TITULAR */}
                {showTitularField && (
                  <div className="max-w-lg relative">
                    <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">TITULAR</label>
                    <div className="flex items-center gap-1.5">
                      <div className="relative flex-1">
                        <input
                          type="text"
                          disabled={isApprovedLocked}
                          value={titDropdownOpen ? titSearch : titClient?.fullName || titSearch}
                          onFocus={() => {
                            if (!isApprovedLocked) {
                              setTitDropdownOpen(true);
                              setTitSearch(titClient?.fullName || '');
                            }
                          }}
                          onChange={(e) => {
                            setTitDropdownOpen(true);
                            setTitSearch(e.target.value);
                          }}
                          placeholder="Buscar titular (mín. 3 letras)..."
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-900 dark:border-slate-700 dark:text-slate-100"
                        />
                        {titDropdownOpen && !isApprovedLocked && (
                          <div className="absolute z-30 left-0 right-0 mt-1 max-h-56 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg text-xs dark:border-slate-700 dark:bg-slate-900">
                            {titRemoteResults.map((c) => (
                              <button
                                key={c.id}
                                type="button"
                                onClick={() => {
                                  setTitularClientId(c.id);
                                  setTitSearch(c.fullName);
                                  setTitDropdownOpen(false);
                                }}
                                className="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center justify-between border-b border-slate-50 dark:hover:bg-slate-800"
                              >
                                <span className="font-semibold text-slate-900 truncate dark:text-slate-100">{c.fullName}</span>
                                <span className="font-mono text-[11px] text-slate-500 shrink-0 dark:text-slate-400">{c.cpfCnpj}</span>
                              </button>
                            ))}
                            {titHasMore && (
                              <button
                                type="button"
                                onClick={async () => {
                                  const res = await apiFetch<{ clients: Client[]; hasMore: boolean }>(
                                    `/api/clients/search?q=${encodeURIComponent(titSearch)}&offset=${titRemoteResults.length}&limit=15`
                                  );
                                  setTitRemoteResults((prev) => [...prev, ...res.clients]);
                                  setTitHasMore(res.hasMore);
                                }}
                                className="w-full py-2 text-center font-semibold text-blue-700 hover:bg-blue-50 dark:text-blue-300 dark:hover:bg-blue-950/60"
                              >
                                Próximos resultados
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => setTitDropdownOpen(false)}
                              className="w-full py-1.5 text-center text-[11px] text-slate-400 border-t border-slate-100 dark:text-slate-400 dark:border-slate-800"
                            >
                              Fechar lista
                            </button>
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        disabled={isApprovedLocked || !titClient}
                        title="Editar cadastro do titular"
                        onClick={() => titClient && openPersonModal('titular', 'edit', titClient)}
                        className="rounded-lg border border-slate-200 p-2 text-amber-600 hover:bg-amber-50 disabled:opacity-40 dark:border-slate-700 dark:text-amber-400 dark:hover:bg-amber-950/60"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={isApprovedLocked}
                        title="Cadastrar novo titular"
                        onClick={() => openPersonModal('titular', 'create')}
                        className="rounded-lg border border-slate-200 p-2 text-slate-700 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )}

                {/* Resumo Somente Leitura Responsável / Titular (exibido somente com Titular vinculado, igual ao PNG) */}
                {respClient && titClient && (
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">
                      NOME (RESPONSÁVEL / TITULAR)
                    </label>
                    <input
                      type="text"
                      readOnly
                      value={`${respClient.fullName.toUpperCase()} / ${titClient.fullName.toUpperCase()}`}
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-800 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-100"
                    />
                  </div>
                )}

                {/* Campos Cadastrais Somente Leitura (corrigíveis via Editar cliente) */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">CPF / CNPJ</label>
                    <input
                      type="text"
                      readOnly
                      value={combineProfileValues(respClient?.cpfCnpj, titClient?.cpfCnpj)}
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-mono font-bold text-slate-800 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-100"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">RG</label>
                    <input
                      type="text"
                      readOnly
                      value={combineProfileValues(respClient?.rg, titClient?.rg)}
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-mono font-bold text-slate-800 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-100"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">TELEFONE</label>
                    <input
                      type="text"
                      readOnly
                      value={combineProfileValues(respClient?.phone, titClient?.phone)}
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-800 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-100"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">PROFISSÃO</label>
                    <input
                      type="text"
                      readOnly
                      value={combineProfileValues(respClient?.profession, titClient?.profession).toUpperCase()}
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-800 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-100"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3.5">
                  <div className="lg:col-span-3">
                    <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">ESTADO CIVIL</label>
                    <input
                      type="text"
                      readOnly
                      value={combineProfileValues(respClient?.maritalStatus, titClient?.maritalStatus).toUpperCase()}
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-800 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-100"
                    />
                  </div>
                  <div className="lg:col-span-2">
                    <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">DATA DE NASC.</label>
                    <input
                      type="text"
                      readOnly
                      value={respClient?.birthDate || '—'}
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-mono font-bold text-slate-800 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-100"
                    />
                  </div>
                  <div className="lg:col-span-7">
                    <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">ENDEREÇO</label>
                    <input
                      type="text"
                      readOnly
                      value={combineProfileValues(formatClientAddress(respClient), formatClientAddress(titClient)).toUpperCase()}
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-800 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-100"
                    />
                  </div>
                </div>

                <div className="max-w-lg">
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">E-MAIL</label>
                  <input
                    type="text"
                    readOnly
                    value={combineProfileValues(respClient?.email, titClient?.email)}
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-800 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-100"
                  />
                </div>
              </div>

              {/* SEÇÃO 02. INFORMAÇÕES DA NEGOCIAÇÃO */}
              <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-4 dark:border-slate-700 dark:bg-slate-900">
                <h2 className="text-xs font-extrabold tracking-widest text-slate-900 dark:text-slate-100">
                  02. INFORMAÇÕES DA NEGOCIAÇÃO
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-12 gap-3.5">
                  <div className="md:col-span-4">
                    <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">
                      BANCO <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      list="febraban-banks-catalog"
                      disabled={isApprovedLocked}
                      value={bankName}
                      onChange={(e) => handleSelectBank(e.target.value)}
                      placeholder="Buscar banco credor (Cadastros Comuns / FEBRABAN)..."
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-900 dark:border-slate-700 dark:text-slate-100"
                    />
                    <datalist id="febraban-banks-catalog">
                      {dynamicBankNames.map((bName) => (
                        <option key={bName} value={bName} />
                      ))}
                    </datalist>
                  </div>

                  <div className="md:col-span-3">
                    <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">CONSULTOR</label>
                    <select
                      disabled={isApprovedLocked}
                      value={consultantName || ''}
                      onChange={(e) => {
                        const chosenName = e.target.value;
                        const opt = dynamicConsultantOptions.find((u) => u.name === chosenName);
                        setConsultantName(chosenName);
                        setConsultantId(opt?.userId || null);
                      }}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-800 dark:border-slate-700 dark:text-slate-100"
                    >
                      <option value="">Selecione...</option>
                      {dynamicConsultantOptions.map((c) => (
                        <option key={c.key} value={c.name}>
                          {c.name}{c.subtitle ? ` (${c.subtitle})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="md:col-span-3">
                    <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">MODALIDADE</label>
                    <select
                      disabled={isApprovedLocked}
                      value={modality}
                      onChange={(e) => setModality(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-800 dark:border-slate-700 dark:text-slate-100 dark:bg-slate-950"
                    >
                      {dynamicModalities.map((m) => (
                        <option key={m.value} value={m.value}>
                          {m.label}
                        </option>
                      ))}
                      {modality && !dynamicModalities.some((m) => m.value === modality) && (
                        <option value={modality}>{modality}</option>
                      )}
                    </select>
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">
                      SÉRIE <span className="text-red-500">*</span>
                    </label>
                    <div className="flex items-center gap-2">
                      <select
                        disabled={isApprovedLocked}
                        value={series}
                        onChange={(e) => {
                          const s = e.target.value;
                          setSeries(s);
                          setIsSeriesDefault((localStorage.getItem(SERIES_DEFAULT_STORAGE_KEY) || 'ADM') === s);
                        }}
                        className="w-full rounded-lg border border-slate-200 px-2.5 py-2 text-xs font-mono font-bold text-slate-900 dark:border-slate-700 dark:text-slate-100"
                      >
                        {dynamicSeriesOptions.map((s) => (
                          <option key={s.sigla} value={s.sigla}>
                            {s.sigla}
                          </option>
                        ))}
                      </select>
                      <label className="inline-flex items-center gap-1 text-[11px] text-slate-600 whitespace-nowrap cursor-pointer dark:text-slate-300">
                        <input
                          type="checkbox"
                          checked={isSeriesDefault}
                          onChange={(e) => {
                            setIsSeriesDefault(e.target.checked);
                            if (e.target.checked) {
                              localStorage.setItem(SERIES_DEFAULT_STORAGE_KEY, series);
                              setFeedback(`Série "${series}" marcada como padrão neste navegador.`);
                            }
                          }}
                        />
                        Padrão
                      </label>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-12 gap-3.5">
                  <div className="md:col-span-4">
                    <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">
                      INDICAÇÃO / CAPTAÇÃO
                    </label>
                    <select
                      disabled={isApprovedLocked}
                      value={indicationSource}
                      onChange={(e) => setIndicationSource(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-800 dark:border-slate-700 dark:text-slate-100 dark:bg-slate-950"
                    >
                      <option value="">Selecione...</option>
                      <option value="indicacao">Indicação</option>
                      <option value="radio">Rádio</option>
                      <option value="outro">Outro</option>
                    </select>
                  </div>
                  {indicationSource === 'outro' && (
                    <div className="md:col-span-4">
                      <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">QUAL?</label>
                      <input
                        type="text"
                        disabled={isApprovedLocked}
                        value={indicationOther}
                        onChange={(e) => setIndicationOther(e.target.value.toUpperCase())}
                        placeholder="ESPECIFIQUE A CAPTAÇÃO..."
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs uppercase font-semibold dark:border-slate-700"
                      />
                    </div>
                  )}
                </div>
              </div>

              {/* SEÇÃO 03. INFORMAÇÕES DO VEÍCULO (Condicional por "veículo"/"veiculo" na Modalidade — Guide Sec 5) */}
              {showVehicleSection && (
                <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-4 dark:border-slate-700 dark:bg-slate-900">
                  <h2 className="text-xs font-extrabold tracking-widest text-slate-900 dark:text-slate-100">
                    03. INFORMAÇÕES DO VEÍCULO
                  </h2>
                  <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">MARCA</label>
                      <input
                        type="text"
                        disabled={isApprovedLocked}
                        value={vehicleBrand}
                        onChange={(e) => setVehicleBrand(e.target.value.toUpperCase())}
                        placeholder="FIAT"
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs uppercase font-semibold dark:border-slate-700"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">MODELO</label>
                      <input
                        type="text"
                        disabled={isApprovedLocked}
                        value={vehicleModel}
                        onChange={(e) => setVehicleModel(e.target.value.toUpperCase())}
                        placeholder="ARGO"
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs uppercase font-semibold dark:border-slate-700"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">COR</label>
                      <input
                        type="text"
                        disabled={isApprovedLocked}
                        value={vehicleColor}
                        onChange={(e) => setVehicleColor(e.target.value.toUpperCase())}
                        placeholder="BRANCA"
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs uppercase font-semibold dark:border-slate-700"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">ANO</label>
                      <input
                        type="text"
                        disabled={isApprovedLocked}
                        value={vehicleYear}
                        onChange={(e) => setVehicleYear(e.target.value)}
                        placeholder="2023"
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-mono dark:border-slate-700"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">PLACA</label>
                      <input
                        type="text"
                        disabled={isApprovedLocked}
                        value={vehiclePlate}
                        onChange={(e) => setVehiclePlate(e.target.value.toUpperCase())}
                        placeholder="ABC1D23"
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs uppercase font-mono font-bold dark:border-slate-700"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">CHASSI</label>
                      <input
                        type="text"
                        disabled={isApprovedLocked}
                        value={vehicleChassis}
                        onChange={(e) => setVehicleChassis(e.target.value.toUpperCase())}
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs uppercase font-mono dark:border-slate-700"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">RENAVAM</label>
                      <input
                        type="text"
                        disabled={isApprovedLocked}
                        value={vehicleRenavam}
                        onChange={(e) => setVehicleRenavam(e.target.value)}
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-mono dark:border-slate-700"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* SEÇÃO 04. DÍVIDA ATUAL (Guide Sec 6) */}
              <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-4 dark:border-slate-700 dark:bg-slate-900">
                <h2 className="text-xs font-extrabold tracking-widest text-slate-900 dark:text-slate-100">
                  04. DÍVIDA ATUAL
                </h2>
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">PARCELAS TOTAIS</label>
                    <input
                      type="number"
                      disabled={isApprovedLocked}
                      value={debtTotalInstallments}
                      onChange={(e) => setDebtTotalInstallments(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-mono dark:border-slate-700"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">PARCELAS PAGAS</label>
                    <input
                      type="number"
                      disabled={isApprovedLocked}
                      value={debtPaidInstallments}
                      onChange={(e) => setDebtPaidInstallments(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-mono dark:border-slate-700"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">EM ATRASO</label>
                    <input
                      type="number"
                      disabled={isApprovedLocked}
                      value={debtOverdueInstallments}
                      onChange={(e) => setDebtOverdueInstallments(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-mono dark:border-slate-700"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">VALOR FINANCIADO (R$)</label>
                    <input
                      type="text"
                      disabled={isApprovedLocked}
                      value={financedAmountReais}
                      onChange={(e) => setFinancedAmountReais(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-mono font-bold dark:border-slate-700"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">VALOR DA PARCELA (R$)</label>
                    <input
                      type="text"
                      disabled={isApprovedLocked}
                      value={currentInstallmentReais}
                      onChange={(e) => setCurrentInstallmentReais(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-mono font-bold dark:border-slate-700"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">DIA VENCIMENTO</label>
                    <input
                      type="number"
                      min={1}
                      max={31}
                      disabled={isApprovedLocked}
                      value={debtDueDay}
                      onChange={(e) => setDebtDueDay(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-mono dark:border-slate-700"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">TIPO PAGAMENTO</label>
                    <select
                      disabled={isApprovedLocked}
                      value={paymentType}
                      onChange={(e) => setPaymentType(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    >
                      <option value="boleto">Boleto</option>
                      <option value="debito">Débito Automático</option>
                      <option value="carne">Carnê</option>
                      <option value="cartao">Cartão</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* SEÇÃO 05. INFORMAÇÕES DO RECÁLCULO & PLANEJAMENTO DE QUITAÇÃO (Guide Sec 7) */}
              <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-5 dark:border-slate-700 dark:bg-slate-900">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-xs font-extrabold tracking-widest text-slate-900 dark:text-slate-100">
                    05. INFORMAÇÕES DO RECÁLCULO &amp; PLANEJAMENTO DE QUITAÇÃO
                  </h2>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={isApprovedLocked}
                      onClick={() => {
                        const baseDebt = parseReaisToCents(financedAmountReais) ||
                          Math.max(0, Number(debtTotalInstallments || 0) * parseReaisToCents(currentInstallmentReais));
                        const synced = scenarios.map((sc) => ({
                          ...sc,
                          originalDebtCents: sc.originalDebtCents > 0 ? sc.originalDebtCents : baseDebt,
                        }));
                        setScenarios(calculateAllScenarios(synced));
                        setFeedback('Cenários recalculados com base na dívida original e percentuais.');
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                    >
                      <Calculator className="w-3.5 h-3.5" />
                      Calcular Cenários
                    </button>
                    <button
                      type="button"
                      disabled={isApprovedLocked || !bankName.trim() || scenarios.length >= maxBankScenarios}
                      onClick={() => {
                        const srv = bankServices[scenarios.length] || {
                          name: `Cenário ${scenarios.length + 1}`,
                          percent: 50,
                          installments: 12,
                        };
                        const orig = scenarios[0]?.originalDebtCents || parseReaisToCents(financedAmountReais);
                        const newDebt = Math.round((orig * srv.percent) / 100);
                        setScenarios((prev) => [
                          ...prev,
                          {
                            id: `sc-add-${Date.now()}`,
                            name: srv.name,
                            servicePercent: srv.percent,
                            installmentsToPay: srv.installments,
                            originalDebtCents: orig,
                            recalcDebtCents: newDebt,
                            recalcInstallmentCents: Math.round(newDebt / Math.max(1, srv.installments)),
                            savingsCents: Math.max(0, orig - newDebt),
                            dueDay: Number(debtDueDay || 10),
                          },
                        ]);
                      }}
                      className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-40 dark:bg-emerald-600 dark:hover:bg-emerald-500"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Adicionar Cenário
                    </button>
                  </div>
                </div>

                {/* Painel Informações do Recálculo (espelha 1º cenário bidirecionalmente) */}
                {scenarios[0] && (
                  <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-2 dark:border-slate-700 dark:bg-slate-800/60">
                    <div className="text-[11px] font-bold text-slate-600 uppercase dark:text-slate-300">
                      Informações do Recálculo (Espelho do 1º Cenário: {scenarios[0].name})
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-6 gap-2.5 text-xs">
                      <div>
                        <label className="block text-[10px] font-semibold text-slate-500 mb-0.5 dark:text-slate-400">Parcelas a Pagar</label>
                        <input
                          type="number"
                          min={1}
                          disabled={isApprovedLocked}
                          value={scenarios[0].installmentsToPay}
                          onChange={(e) => updateScenarioAt(0, { installmentsToPay: Math.max(1, Number(e.target.value || 1)) })}
                          className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 font-mono dark:border-slate-700 dark:bg-slate-900"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-semibold text-slate-500 mb-0.5 dark:text-slate-400">Dívida Original (R$)</label>
                        <input
                          type="text"
                          disabled={isApprovedLocked}
                          value={formatCentsInput(scenarios[0].originalDebtCents)}
                          onChange={(e) => updateScenarioAt(0, { originalDebtCents: parseReaisToCents(e.target.value) })}
                          className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 font-mono dark:border-slate-700 dark:bg-slate-900"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-semibold text-slate-500 mb-0.5 dark:text-slate-400">Parc. Recalculada</label>
                        <div className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 font-mono font-semibold text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
                          {formatBRL(scenarios[0].recalcInstallmentCents)}
                        </div>
                      </div>
                      <div>
                        <label className="block text-[10px] font-semibold text-slate-500 mb-0.5 dark:text-slate-400">Dívida Recalculada</label>
                        <div className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 font-mono font-bold text-blue-700 dark:border-slate-700 dark:bg-slate-900 dark:text-blue-300">
                          {formatBRL(scenarios[0].recalcDebtCents)}
                        </div>
                      </div>
                      <div>
                        <label className="block text-[10px] font-semibold text-slate-500 mb-0.5 dark:text-slate-400">Economia (R$)</label>
                        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 font-mono font-bold text-emerald-700 dark:border-emerald-800/70 dark:bg-emerald-950/50 dark:text-emerald-300">
                          {formatBRL(scenarios[0].savingsCents)}
                        </div>
                      </div>
                      <div>
                        <label className="block text-[10px] font-semibold text-slate-500 mb-0.5 dark:text-slate-400">Dia Vencimento</label>
                        <input
                          type="number"
                          min={1}
                          max={31}
                          disabled={isApprovedLocked}
                          value={scenarios[0].dueDay}
                          onChange={(e) => updateScenarioAt(0, { dueDay: Math.min(31, Math.max(1, Number(e.target.value || 10))) })}
                          className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 font-mono dark:border-slate-700 dark:bg-slate-900"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* Tabela Planejamento de Quitação (colunas por cenário) */}
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs border border-slate-200 dark:border-slate-700">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 dark:bg-slate-800/70 dark:border-slate-700">
                        <th className="py-2.5 px-3 font-semibold text-slate-600 w-44 dark:text-slate-300">Planejamento de Quitação</th>
                        {scenarios.map((sc, idx) => (
                          <th key={sc.id} className="py-2 px-3 border-l border-slate-200 min-w-[190px] dark:border-slate-700">
                            <div className="flex items-center justify-between gap-1">
                              <input
                                type="text"
                                disabled={isApprovedLocked}
                                value={sc.name}
                                onChange={(e) => updateScenarioAt(idx, { name: e.target.value })}
                                className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-bold text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                              />
                              {scenarios.length > 1 && !isApprovedLocked && (
                                <button
                                  type="button"
                                  onClick={() => setScenarios((prev) => prev.filter((_, i) => i !== idx))}
                                  className="text-slate-400 hover:text-red-600 px-1 dark:text-slate-400"
                                  title="Remover cenário"
                                >
                                  ✕
                                </button>
                              )}
                            </div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      <tr>
                        <td className="py-2 px-3 font-medium text-slate-600 dark:text-slate-300">Percentual Serviço (%)</td>
                        {scenarios.map((sc, idx) => (
                          <td key={sc.id} className="py-2 px-3 border-l border-slate-200 dark:border-slate-700">
                            <input
                              type="number"
                              disabled={isApprovedLocked}
                              value={sc.servicePercent}
                              onChange={(e) => updateScenarioAt(idx, { servicePercent: Number(e.target.value || 0) })}
                              className="w-full rounded border border-slate-200 px-2 py-1 font-mono dark:border-slate-700"
                            />
                          </td>
                        ))}
                      </tr>
                      <tr>
                        <td className="py-2 px-3 font-medium text-slate-600 dark:text-slate-300">Parcelas a Pagar</td>
                        {scenarios.map((sc, idx) => (
                          <td key={sc.id} className="py-2 px-3 border-l border-slate-200 dark:border-slate-700">
                            <input
                              type="number"
                              min={1}
                              disabled={isApprovedLocked}
                              value={sc.installmentsToPay}
                              onChange={(e) => updateScenarioAt(idx, { installmentsToPay: Math.max(1, Number(e.target.value || 1)) })}
                              className="w-full rounded border border-slate-200 px-2 py-1 font-mono dark:border-slate-700"
                            />
                          </td>
                        ))}
                      </tr>
                      <tr>
                        <td className="py-2 px-3 font-medium text-slate-600 dark:text-slate-300">Dívida Original (R$)</td>
                        {scenarios.map((sc, idx) => (
                          <td key={sc.id} className="py-2 px-3 border-l border-slate-200 dark:border-slate-700">
                            <input
                              type="text"
                              disabled={isApprovedLocked}
                              value={formatCentsInput(sc.originalDebtCents)}
                              onChange={(e) => updateScenarioAt(idx, { originalDebtCents: parseReaisToCents(e.target.value) })}
                              className="w-full rounded border border-slate-200 px-2 py-1 font-mono dark:border-slate-700"
                            />
                          </td>
                        ))}
                      </tr>
                      <tr>
                        <td className="py-2 px-3 font-medium text-slate-600 dark:text-slate-300">Parc. Recalculada (R$)</td>
                        {scenarios.map((sc) => (
                          <td key={sc.id} className="py-2 px-3 border-l border-slate-200 font-mono font-semibold text-slate-800 tabular-nums dark:border-slate-700 dark:text-slate-100">
                            {formatBRL(sc.recalcInstallmentCents)}
                          </td>
                        ))}
                      </tr>
                      <tr>
                        <td className="py-2 px-3 font-medium text-slate-600 dark:text-slate-300">Dívida Recalculada (R$)</td>
                        {scenarios.map((sc, idx) => (
                          <td key={sc.id} className="py-2 px-3 border-l border-slate-200 dark:border-slate-700">
                            <input
                              type="text"
                              disabled={isApprovedLocked}
                              value={formatCentsInput(sc.recalcDebtCents)}
                              onChange={(e) => updateScenarioAt(idx, { recalcDebtCents: parseReaisToCents(e.target.value) })}
                              className="w-full rounded border border-slate-200 px-2 py-1 font-mono font-bold text-blue-700 dark:border-slate-700 dark:text-blue-300"
                            />
                          </td>
                        ))}
                      </tr>
                      <tr>
                        <td className="py-2 px-3 font-medium text-slate-600 dark:text-slate-300">Economia (R$)</td>
                        {scenarios.map((sc) => (
                          <td key={sc.id} className="py-2 px-3 border-l border-slate-200 font-mono font-bold text-emerald-700 tabular-nums dark:border-slate-700 dark:text-emerald-300">
                            {formatBRL(sc.savingsCents)}
                          </td>
                        ))}
                      </tr>
                      <tr>
                        <td className="py-2 px-3 font-medium text-slate-600 dark:text-slate-300">Dia Vencimento</td>
                        {scenarios.map((sc, idx) => (
                          <td key={sc.id} className="py-2 px-3 border-l border-slate-200 dark:border-slate-700">
                            <input
                              type="number"
                              min={1}
                              max={31}
                              disabled={isApprovedLocked}
                              value={sc.dueDay}
                              onChange={(e) => updateScenarioAt(idx, { dueDay: Math.min(31, Math.max(1, Number(e.target.value || 10))) })}
                              className="w-full rounded border border-slate-200 px-2 py-1 font-mono dark:border-slate-700"
                            />
                          </td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* SEÇÃO 06. TABELA DE SERVIÇOS E OUTRAS INFORMAÇÕES (Guide Sec 8) */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                <div className="lg:col-span-7 rounded-2xl border border-slate-200 bg-white p-6 space-y-4 dark:border-slate-700 dark:bg-slate-900">
                  <h2 className="text-xs font-extrabold tracking-widest text-slate-900 dark:text-slate-100">
                    06. TABELA DE SERVIÇOS
                  </h2>
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 text-[11px] font-semibold text-slate-500 dark:border-slate-700 dark:text-slate-400">
                        <th className="py-2">Und</th>
                        <th className="py-2">Serviço / Descrição</th>
                        <th className="py-2 text-right">Valor Unitário (R$)</th>
                        <th className="py-2 text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      <tr>
                        <td className="py-2.5 font-mono text-slate-500 dark:text-slate-400">UN</td>
                        <td className="py-2.5 font-semibold text-slate-900 dark:text-slate-100">Gestão (Parcela 01)</td>
                        <td className="py-2.5 text-right">
                          <input
                            type="text"
                            disabled={isApprovedLocked}
                            value={serviceMgmtReais}
                            onChange={(e) => setServiceMgmtReais(e.target.value)}
                            className="w-28 text-right rounded-md border border-slate-200 px-2 py-1 font-mono font-bold dark:border-slate-700"
                          />
                        </td>
                        <td className="py-2.5 text-right font-mono font-bold text-slate-900 tabular-nums dark:text-slate-100">
                          {formatBRL(mgmtCents)}
                        </td>
                      </tr>
                      <tr>
                        <td className="py-2.5 font-mono text-slate-500 dark:text-slate-400">UN</td>
                        <td className="py-2.5 font-semibold text-slate-900 dark:text-slate-100">Custos Finais da Economia (20%)</td>
                        <td className="py-2.5 text-right font-mono text-slate-600 dark:text-slate-300">20%</td>
                        <td className="py-2.5 text-right font-mono font-bold text-emerald-700 tabular-nums dark:text-emerald-300">
                          {firstScenarioSavingsCents > 0 ? formatBRL(finalEconomyFeeCents) : 'Variável'}
                        </td>
                      </tr>
                      <tr>
                        <td className="py-2.5 font-mono text-slate-500 dark:text-slate-400">UN</td>
                        <td className="py-2.5 font-semibold text-slate-900 dark:text-slate-100">Custos Iniciais (Parcela 02)</td>
                        <td className="py-2.5 text-right">
                          <input
                            type="text"
                            disabled={isApprovedLocked}
                            value={serviceInitialReais}
                            onChange={(e) => setServiceInitialReais(e.target.value)}
                            className="w-28 text-right rounded-md border border-slate-200 px-2 py-1 font-mono font-bold dark:border-slate-700"
                          />
                        </td>
                        <td className="py-2.5 text-right font-mono font-bold text-slate-900 tabular-nums dark:text-slate-100">
                          {formatBRL(initialCostCents)}
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3 border-t border-slate-200 text-xs dark:border-slate-700">
                    <div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">Subtotal</div>
                      <div className="font-mono font-bold text-slate-900 tabular-nums mt-1 dark:text-slate-100">
                        {formatBRL(servicesSubtotalCents)}
                      </div>
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-500 dark:text-slate-400">Desc. R$</label>
                      <input
                        type="text"
                        disabled={isApprovedLocked}
                        value={serviceDiscountReais}
                        onChange={(e) => setServiceDiscountReais(e.target.value)}
                        className="w-full rounded-md border border-slate-200 px-2 py-1 font-mono mt-0.5 dark:border-slate-700"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-500 dark:text-slate-400">Acres. R$</label>
                      <input
                        type="text"
                        disabled={isApprovedLocked}
                        value={serviceAdditionReais}
                        onChange={(e) => setServiceAdditionReais(e.target.value)}
                        className="w-full rounded-md border border-slate-200 px-2 py-1 font-mono mt-0.5 dark:border-slate-700"
                      />
                    </div>
                    <div className="text-right">
                      <div className="text-[11px] font-bold text-slate-600 dark:text-slate-300">TOTAL</div>
                      <div className="font-mono text-base font-extrabold text-emerald-700 tabular-nums mt-0.5 dark:text-emerald-300">
                        {formatBRL(servicesTotalCents)}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Outras Informações */}
                <div className="lg:col-span-5 rounded-2xl border border-slate-200 bg-white p-6 space-y-3.5 text-xs dark:border-slate-700 dark:bg-slate-900">
                  <h2 className="text-xs font-extrabold tracking-widest text-slate-900 dark:text-slate-100">
                    OUTRAS INFORMAÇÕES
                  </h2>
                  <div className="grid grid-cols-3 gap-2.5">
                    <div>
                      <label className="block text-[10px] font-semibold text-slate-500 mb-1 dark:text-slate-400">
                        TAXA ADMINISTRATIVA (R$)
                      </label>
                      <input
                        type="text"
                        readOnly
                        value={formatBRL(selectedUnit?.minAdmissionCostCents || 0)}
                        className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 font-mono font-bold text-slate-700 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-200"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-semibold text-slate-500 mb-1 dark:text-slate-400">
                        VALOR PARCELA 01 (R$)
                      </label>
                      <input
                        type="text"
                        disabled={isApprovedLocked}
                        value={serviceMgmtReais}
                        onChange={(e) => setServiceMgmtReais(e.target.value)}
                        className="w-full rounded-lg border border-slate-200 px-2.5 py-2 font-mono font-bold text-slate-900 dark:border-slate-700 dark:text-slate-100"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-semibold text-slate-500 mb-1 dark:text-slate-400">
                        VALOR BOLETOS (R$)
                      </label>
                      <input
                        type="text"
                        disabled={isApprovedLocked}
                        value={billingFeeReais}
                        onChange={(e) => setBillingFeeReais(e.target.value)}
                        className="w-full rounded-lg border border-slate-200 px-2.5 py-2 font-mono font-bold text-slate-900 dark:border-slate-700 dark:text-slate-100"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">ANOTAÇÕES</label>
                    <textarea
                      rows={4}
                      disabled={isApprovedLocked}
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Observações operacionais relevantes da admissão..."
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs dark:border-slate-700"
                    />
                  </div>
                </div>
              </div>

              {/* Barra Final de Ações da Ficha */}
              <div className="rounded-2xl border border-slate-200 bg-white px-6 py-4 flex flex-wrap items-center justify-between gap-3 dark:border-slate-700 dark:bg-slate-900">
                <button
                  type="button"
                  onClick={handleBackFromSubView}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  {viewHistory.length > 0 && viewHistory[viewHistory.length - 1] === 'vault'
                    ? 'Voltar ao Cofre / Cancelar'
                    : 'Voltar para Lista / Cancelar'}
                </button>

                {!isApprovedLocked && (
                  <div className="flex flex-wrap items-center gap-2.5">
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => handleSaveProcess({ stayOpenForDocs: true })}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                    >
                      <Save className="w-3.5 h-3.5" />
                      Salvar admissão e continuar
                    </button>
                    <button
                      type="submit"
                      disabled={saving}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-emerald-600 dark:hover:bg-emerald-500"
                    >
                      <Save className="w-3.5 h-3.5" />
                      {saving ? 'Salvando...' : 'Salvar Processo'}
                    </button>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => handleSaveProcess({ statusOverride: 'aguardando_auditoria' })}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                    >
                      <Send className="w-3.5 h-3.5" />
                      Enviar p/ Auditoria
                    </button>
                  </div>
                )}
              </div>
            </form>
          )}

          {/* ABA 2: WHATSAPP (Todas as conversas GoTalk e UaZapi tratadas com o cliente/titular) */}
          {formTab === 'whatsapp' && (() => {
            const visibleThreads = interactions.threads.filter(
              (t) => waProviderFilter === 'all' || t.provider === waProviderFilter
            );
            const activeThreadObj =
              waSelectedThreadId === 'all'
                ? null
                : interactions.threads.find((t) => t.id === waSelectedThreadId) || null;
            const visibleMessages = interactions.messages.filter((m) => {
              if (waSelectedThreadId !== 'all') return m.threadId === waSelectedThreadId;
              if (waProviderFilter !== 'all') return m.provider === waProviderFilter;
              return true;
            });
            const gotalkCount = interactions.threads.filter((t) => t.provider === 'gotalk').length;
            const uazapiCount = interactions.threads.filter((t) => t.provider === 'uazapi').length;

            return (
              <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-4 text-xs dark:border-slate-700 dark:bg-slate-900">
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-slate-100 pb-3 dark:border-slate-800">
                  <div>
                    <h2 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                      Conversas WhatsApp · GoTalk &amp; UaZapi ({respClient?.fullName || 'Cliente'})
                    </h2>
                    <p className="text-slate-500 mt-0.5 dark:text-slate-400">
                      Todas as conversas tratadas com este cliente e titular pelos canais GoTalk ({gotalkCount}) e UaZapi ({uazapiCount}).
                      {interactions.matchedPhones.length > 0 && (
                        <span className="ml-1 font-mono text-[11px] text-slate-600 dark:text-slate-300">
                          Tel(s): {interactions.matchedPhones.join(' · ')}
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 dark:border-slate-700 dark:bg-slate-800/70">
                      {[
                        { id: 'all', label: `Todos (${interactions.threads.length})` },
                        { id: 'gotalk', label: `GoTalk (${gotalkCount})` },
                        { id: 'uazapi', label: `UaZapi (${uazapiCount})` },
                      ].map((pf) => (
                        <button
                          key={pf.id}
                          type="button"
                          onClick={() => {
                            setWaProviderFilter(pf.id as typeof waProviderFilter);
                            setWaSelectedThreadId('all');
                          }}
                          className={`px-2.5 py-1 rounded-md font-semibold text-[11px] transition-colors ${
                            waProviderFilter === pf.id
                              ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-slate-100'
                              : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
                          }`}
                        >
                          {pf.label}
                        </button>
                      ))}
                    </div>
                    {(editingAdmissionId || responsibleClientId) && (
                      <button
                        type="button"
                        disabled={interactions.syncing}
                        onClick={handleSyncClientWhatsapp}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${interactions.syncing ? 'animate-spin' : ''}`} />
                        {interactions.syncing ? 'Sincronizando...' : 'Sincronizar GoTalk / UaZapi'}
                      </button>
                    )}
                  </div>
                </div>

                {!editingAdmissionId && !responsibleClientId ? (
                  <div className="py-8 text-center text-slate-500 dark:text-slate-400">
                    Selecione o Cliente Responsável na aba Formulário para visualizar todas as conversas do GoTalk e UaZapi.
                  </div>
                ) : interactions.loading ? (
                  <div className="py-8 text-center text-slate-500 dark:text-slate-400">Carregando conversas GoTalk e UaZapi...</div>
                ) : (
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                    {/* Coluna Esquerda: Lista de Conversas (GoTalk & UaZapi) */}
                    <div className="lg:col-span-4 space-y-2 border-r border-slate-100 pr-0 lg:pr-3 max-h-[500px] overflow-y-auto dark:border-slate-800">
                      <button
                        type="button"
                        onClick={() => setWaSelectedThreadId('all')}
                        className={`w-full text-left rounded-xl border p-3 transition-colors ${
                          waSelectedThreadId === 'all'
                            ? 'border-slate-900 bg-slate-900 text-white dark:border-emerald-500 dark:bg-emerald-600'
                            : 'border-slate-200 bg-slate-50 text-slate-800 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-100 dark:hover:bg-slate-800'
                        }`}
                      >
                        <div className="font-bold flex items-center justify-between">
                          <span>Todas as Conversas (Unificado)</span>
                          <span className="font-mono text-[11px]">{visibleThreads.length}</span>
                        </div>
                        <div className={`text-[11px] mt-0.5 ${waSelectedThreadId === 'all' ? 'text-slate-300' : 'text-slate-500 dark:text-slate-400'}`}>
                          Linha do tempo consolidada GoTalk + UaZapi
                        </div>
                      </button>

                      {visibleThreads.map((th) => {
                        const isSelected = waSelectedThreadId === th.id;
                        const isUa = th.provider === 'uazapi';
                        return (
                          <button
                            key={th.id}
                            type="button"
                            onClick={() => setWaSelectedThreadId(th.id)}
                            className={`w-full text-left rounded-xl border p-3 transition-colors space-y-1 ${
                              isSelected
                                ? 'border-emerald-600 bg-emerald-50 dark:bg-emerald-950/50'
                                : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span
                                className={`inline-flex items-center rounded px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase ${
                                  isUa
                                    ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300'
                                    : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300'
                                }`}
                              >
                                {isUa ? `UaZapi${th.instanceLabel ? ` · ${th.instanceLabel}` : ''}` : 'GoTalk'}
                              </span>
                              <span className="font-mono text-[10px] text-slate-500 dark:text-slate-400">{formatDateBR(th.updatedAt)}</span>
                            </div>
                            <div className="font-semibold text-slate-900 truncate flex items-center justify-between dark:text-slate-100">
                              <span className="truncate">{th.contactName}</span>
                              {th.ownerRole === 'titular' && (
                                <span className="text-[10px] font-mono bg-amber-100 text-amber-800 px-1.5 rounded dark:bg-amber-900/50 dark:text-amber-300">Titular</span>
                              )}
                            </div>
                            <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                              {th.contactPhone} {th.operatorName ? `· Op: ${th.operatorName}` : ''}
                            </div>
                            <div className="text-[11px] text-slate-600 truncate dark:text-slate-300">{th.lastMessagePreview}</div>
                          </button>
                        );
                      })}

                      {responsibleClientId && (
                        <div className="pt-2 border-t border-slate-100 flex flex-wrap gap-1.5 dark:border-slate-800">
                          {gotalkCount === 0 && (
                            <button
                              type="button"
                              onClick={() => handleStartWhatsappThread('gotalk')}
                              className="flex-1 rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-800 hover:bg-emerald-100 dark:border-emerald-800/70 dark:bg-emerald-950/50 dark:text-emerald-300 dark:hover:bg-emerald-900/60"
                            >
                              + Abrir GoTalk
                            </button>
                          )}
                          {uazapiCount === 0 && (
                            <button
                              type="button"
                              onClick={() => handleStartWhatsappThread('uazapi')}
                              className="flex-1 rounded-lg border border-blue-300 bg-blue-50 px-2.5 py-1.5 text-[11px] font-semibold text-blue-800 hover:bg-blue-100 dark:border-blue-800/70 dark:bg-blue-950/50 dark:text-blue-300 dark:hover:bg-blue-900/60"
                            >
                              + Abrir UaZapi
                            </button>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Coluna Direita: Mensagens e Resposta Rápida */}
                    <div className="lg:col-span-8 flex flex-col justify-between space-y-3">
                      <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1 bg-slate-50/60 rounded-xl border border-slate-100 p-3 dark:bg-slate-800/60 dark:border-slate-800">
                        {visibleMessages.length === 0 ? (
                          <div className="py-10 text-center text-slate-500 space-y-2 dark:text-slate-400">
                            <p>Nenhuma mensagem registrada ainda para os telefones deste cliente no GoTalk ou UaZapi.</p>
                            <p className="text-[11px]">
                              Clique em <strong>Sincronizar GoTalk / UaZapi</strong> acima para importar o histórico ao vivo ou abra um canal à esquerda.
                            </p>
                          </div>
                        ) : (
                          visibleMessages.map((m) => {
                            const isOutbound = m.direction === 'outbound' || m.direction === 'out';
                            const isUa = m.provider === 'uazapi';
                            return (
                              <div
                                key={m.id}
                                className={`rounded-xl border p-3 ${
                                  isOutbound
                                    ? 'border-emerald-200 bg-emerald-50/80 ml-8 dark:border-emerald-800/70 dark:bg-emerald-950/50'
                                    : 'border-slate-200 bg-white mr-8 dark:border-slate-700 dark:bg-slate-900'
                                }`}
                              >
                                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 mb-1 dark:text-slate-400">
                                  <div className="flex items-center gap-1.5">
                                    <span
                                      className={`rounded px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase ${
                                        isUa ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300' : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300'
                                      }`}
                                    >
                                      {isUa ? 'UaZapi' : 'GoTalk'}
                                    </span>
                                    <span className="font-semibold text-slate-800 dark:text-slate-100">{m.senderName}</span>
                                    {m.operatorName && m.operatorName !== m.senderName && (
                                      <span className="text-slate-400 dark:text-slate-400">({m.operatorName})</span>
                                    )}
                                  </div>
                                  <span className="font-mono flex items-center gap-1">
                                    {formatDateTimeBR(m.createdAt)}
                                    {isOutbound && m.ackStatus === 1 && <Check className="w-3 h-3 text-slate-400 dark:text-slate-400" />}
                                    {isOutbound && m.ackStatus === 2 && <CheckCheck className="w-3 h-3 text-slate-500 dark:text-slate-400" />}
                                    {isOutbound && m.ackStatus === 3 && <CheckCheck className="w-3 h-3 text-blue-600 dark:text-blue-400" />}
                                  </span>
                                </div>

                                {m.deletedInOrigin && (
                                  <div className="mb-1 text-[10px] font-semibold text-amber-700 dark:text-amber-300">
                                    Apagada na origem (preservada no histórico de auditoria)
                                  </div>
                                )}

                                <div className="text-slate-800 whitespace-pre-wrap leading-relaxed dark:text-slate-100">{m.body}</div>

                                {m.attachmentName && (
                                  <div className="mt-2 flex items-center justify-between rounded-lg border border-slate-200 bg-white/80 px-2.5 py-1.5 text-[11px] dark:border-slate-700 dark:bg-slate-900/95">
                                    <span className="flex items-center gap-1.5 font-medium text-slate-700 truncate dark:text-slate-200">
                                      <FileText className="w-3.5 h-3.5 text-blue-600 shrink-0 dark:text-blue-400" />
                                      <span className="truncate">{m.attachmentName}</span>
                                    </span>
                                    {m.attachmentUrl && (
                                      <button
                                        type="button"
                                        onClick={() => handleDownloadUrl(m.attachmentUrl!, m.attachmentName!)}
                                        className="inline-flex items-center gap-1 font-semibold text-blue-700 hover:underline shrink-0 ml-2 dark:text-blue-300"
                                      >
                                        <Download className="w-3 h-3" /> Baixar (Bucket)
                                      </button>
                                    )}
                                  </div>
                                )}

                                {m.contentType === 'audio' && (
                                  <div className="mt-2 pt-2 border-t border-slate-200/70">
                                    {m.iviAudioTranscript ? (
                                      <div className="rounded-lg bg-blue-50 border border-blue-100 p-2 text-[11px] text-blue-950 dark:bg-blue-950/50 dark:border-blue-800/70 dark:text-blue-300">
                                        <div className="flex items-center gap-1 font-semibold text-blue-800 mb-0.5 dark:text-blue-300">
                                          <Sparkles className="w-3 h-3" /> Transcrição Ivi
                                        </div>
                                        {m.iviAudioTranscript}
                                      </div>
                                    ) : (
                                      <button
                                        type="button"
                                        onClick={() => handleTranscribeWhatsappAudio(m.id)}
                                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-700 hover:underline dark:text-blue-300"
                                      >
                                        <Headphones className="w-3 h-3" /> Transcrever áudio com Ivi
                                      </button>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })
                        )}
                      </div>

                      {activeThreadObj ? (
                        <form onSubmit={handleSendWhatsappReply} className="flex items-center gap-2">
                          <label
                            title="Enviar anexo (salvo no bucket bucketdainvicta)"
                            className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-slate-700 hover:bg-slate-100 cursor-pointer dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-200 dark:hover:bg-slate-800"
                          >
                            <Paperclip className="w-4 h-4" />
                            <input type="file" className="hidden" disabled={waSending} onChange={handleSendWhatsappFile} />
                          </label>
                          <input
                            type="text"
                            value={waDraft}
                            onChange={(e) => setWaDraft(e.target.value)}
                            placeholder={`Responder via ${activeThreadObj.provider.toUpperCase()} para ${activeThreadObj.contactPhone}...`}
                            className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-xs dark:border-slate-700"
                          />
                          <button
                            type="submit"
                            disabled={waSending || !waDraft.trim()}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                          >
                            <Send className="w-3.5 h-3.5" />
                            Enviar
                          </button>
                        </form>
                      ) : (
                        interactions.threads.length > 0 && (
                          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-500 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-400">
                            Selecione uma conversa específica à esquerda (GoTalk ou UaZapi) para responder ou enviar anexos.
                          </div>
                        )
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {/* ABA 3: ATENDIMENTOS (Histórico GoTalk / Prospecção do Cliente) */}
          {formTab === 'atendimentos' && (
            <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-4 text-xs dark:border-slate-700 dark:bg-slate-900">
              <div className="border-b border-slate-100 pb-3 dark:border-slate-800">
                <h2 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                  Histórico de Atendimentos Comerciais ({respClient?.fullName || 'Cliente'})
                </h2>
                <p className="text-slate-500 dark:text-slate-400">
                  Registros reais de pré-atendimento e prospecção vinculados ao contato do cliente.
                </p>
              </div>
              {!editingAdmissionId && !responsibleClientId ? (
                <div className="py-6 text-center text-slate-500 dark:text-slate-400">Selecione o cliente para consultar atendimentos vinculados.</div>
              ) : interactions.loading ? (
                <div className="py-6 text-center text-slate-500 dark:text-slate-400">Consultando atendimentos...</div>
              ) : interactions.atendimentos.length === 0 ? (
                <div className="py-6 text-center text-slate-500 dark:text-slate-400">Nenhum atendimento prévio localizado para este telefone.</div>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {interactions.atendimentos.map((at) => (
                    <div key={at.id} className="py-3 flex items-center justify-between gap-2">
                      <div>
                        <div className="font-semibold text-slate-900 dark:text-slate-100">{at.name}</div>
                        <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                          Canal: {at.channel} · Tel: {at.phone} · Etapa: {at.stage}
                        </div>
                      </div>
                      <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">{formatDateBR(at.lastMessageAt)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ABA 4: DOCUMENTOS & DOSSIÊ DA FICHA (Documentos da Ficha + Acervo do Cliente em Bucket Criptografado) */}
          {formTab === 'documentos' && (() => {
            const dossierChecklist = [
              { key: 'ficha_admissao', label: 'Ficha de Admissão' },
              { key: 'contrato', label: 'Contrato Assinado' },
              { key: 'procuracao', label: 'Procuração' },
              { key: 'pessoal', label: 'CNH / RG' },
              { key: 'residencia', label: 'Comprovante Residência' },
              ...(showVehicleSection ? [{ key: 'crlv', label: 'CRLV Veículo' }] : []),
              { key: 'comprovante', label: 'Comprovante Pagto' },
            ];

            const baseList =
              docScopeTab === 'ficha'
                ? activeAdmissionOnlyDocs
                : docScopeTab === 'cliente'
                ? activeClientAcervoDocs
                : docScopeTab === 'lixeira'
                ? activeTrashedDossierDocs
                : activeAdmissionDocs;

            const filteredDocs = baseList.filter((d) => {
              if (docCategoryFilter !== 'all' && d.docCategory !== docCategoryFilter) return false;
              if (docSearchFilter.trim()) {
                const q = docSearchFilter.trim().toLowerCase();
                if (
                  !d.fileName.toLowerCase().includes(q) &&
                  !d.docCategory.toLowerCase().includes(q) &&
                  !d.folderPath.toLowerCase().includes(q)
                ) {
                  return false;
                }
              }
              return true;
            });

            const totalBytes = activeAdmissionDocs.reduce((acc, d) => acc + Number(d.sizeBytes || 0), 0);
            const isR2 = bucketStats?.backend === 'cloudflare_r2';

            return (
              <div className="space-y-4 text-xs">
                {/* Cabeçalho do Dossiê + Segurança do Bucket */}
                <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4 dark:border-slate-700 dark:bg-slate-900">
                  <div className="flex flex-col xl:flex-row xl:items-start justify-between gap-4 border-b border-slate-100 pb-4 dark:border-slate-800">
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                          Dossiê Digital da Ficha &amp; Acervo do Cliente
                        </h2>
                        <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 border border-emerald-200 px-2 py-0.5 font-mono text-[10px] font-bold text-emerald-800 dark:bg-emerald-950/50 dark:border-emerald-800/70 dark:text-emerald-300">
                          <ShieldCheck className="w-3 h-3" />
                          {isR2
                            ? `Cloudflare R2: ${bucketStats?.bucketName}`
                            : `Bucket Criptografado: ${bucketStats?.bucketName || 'bucketdainvicta'}`}
                        </span>
                        <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 font-mono text-[10px] text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                          <Lock className="w-3 h-3" /> AES-256-GCM · SHA-256 CAS
                        </span>
                      </div>
                      <p className="text-slate-600 dark:text-slate-300">
                        <strong>Contrato:</strong> {displayContractNumber} · <strong>Banco:</strong> {bankName || '—'} ·{' '}
                        <strong>Responsável:</strong> {respClient?.fullName || 'Não selecionado'}{' '}
                        {respClient?.cpfCnpj ? `(${respClient.cpfCnpj})` : ''}
                        {titClient && (
                          <>
                            {' '}· <strong>Titular:</strong> {titClient.fullName} ({titClient.cpfCnpj || '—'})
                          </>
                        )}
                      </p>
                      <p className="text-[11px] text-slate-500 flex items-center gap-1.5 dark:text-slate-400">
                        <HardDrive className="w-3.5 h-3.5 text-slate-400 shrink-0 dark:text-slate-400" />
                        Todos os anexos ficam armazenados exclusivamente no bucket (fora das tabelas SQL); o PostgreSQL mantém apenas índices SHA-256 e ACL ({activeAdmissionDocs.length} anexo(s) · {formatBytes(totalBytes)}).
                      </p>
                    </div>

                    {!editingAdmissionId && responsibleClientId && (
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => handleSaveProcess({ stayOpenForDocs: true })}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-700 shrink-0"
                      >
                        <Save className="w-3.5 h-3.5" />
                        Salvar admissão para pasta ADM
                      </button>
                    )}
                  </div>

                  {/* Vínculos de Bens / Titular do Dossiê (quando houver) */}
                  {activeClientAssetLinks.length > 0 && (
                    <div className="rounded-xl border border-amber-200 bg-amber-50/60 px-3.5 py-2.5 flex flex-wrap items-center gap-3 text-[11px] text-amber-900 dark:border-amber-800/70 dark:bg-amber-950/50 dark:text-amber-300">
                      <span className="font-bold">Vínculo de Bem no Dossiê:</span>
                      {activeClientAssetLinks.map((lk) => (
                        <span key={lk.id} className="font-mono">
                          {lk.relationshipLabel}: {lk.vehicleModel || 'Veículo'} · Placa {lk.vehiclePlate || '—'} · Renavam {lk.renavam || '—'}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Checklist Completa do Dossiê */}
                  <div>
                    <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2 dark:text-slate-400">
                      Checklist Obrigatória do Dossiê (Auditoria)
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {dossierChecklist.map((item) => {
                        const inThisFicha = activeAdmissionOnlyDocs.some((d) => d.docCategory === item.key);
                        const inClientBucket = !inThisFicha && activeClientAcervoDocs.some((d) => d.docCategory === item.key);
                        return (
                          <span
                            key={item.key}
                            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-semibold ${
                              inThisFicha
                                ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800/70 dark:bg-emerald-950/50 dark:text-emerald-300'
                                : inClientBucket
                                ? 'border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-800/70 dark:bg-blue-950/50 dark:text-blue-300'
                                : 'border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-400'
                            }`}
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            {item.label}
                            {inClientBucket && <span className="text-[10px] font-normal">(no acervo do cliente)</span>}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Área Principal: Escopo + Upload + Lista do Dossiê */}
                <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4 dark:border-slate-700 dark:bg-slate-900">
                  {!responsibleClientId ? (
                    <div className="py-8 text-center text-slate-500 space-y-2 dark:text-slate-400">
                      <p>Selecione ou cadastre o Cliente Responsável na aba Formulário para acessar o Dossiê e enviar anexos ao bucket.</p>
                    </div>
                  ) : (
                    <>
                      {/* Barra de Escopo + Upload Direto para Bucket */}
                      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3 border-b border-slate-100 pb-3 dark:border-slate-800">
                        <div className="inline-flex flex-wrap rounded-lg border border-slate-200 bg-slate-50 p-0.5 dark:border-slate-700 dark:bg-slate-800/70">
                          {[
                            { id: 'todos', label: `Todos (${activeAdmissionDocs.length})` },
                            { id: 'ficha', label: `Desta Ficha (${activeAdmissionOnlyDocs.length})` },
                            { id: 'cliente', label: `Acervo Cliente/Titular (${activeClientAcervoDocs.length})` },
                            { id: 'lixeira', label: `Lixeira (${activeTrashedDossierDocs.length})` },
                          ].map((tab) => (
                            <button
                              key={tab.id}
                              type="button"
                              onClick={() => setDocScopeTab(tab.id as typeof docScopeTab)}
                              className={`px-3 py-1.5 rounded-md font-semibold text-[11px] transition-colors ${
                                docScopeTab === tab.id
                                  ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-slate-100'
                                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
                              }`}
                            >
                              {tab.label}
                            </button>
                          ))}
                        </div>

                        {!isApprovedLocked && (
                          <div className="flex flex-wrap items-center gap-2">
                            {titClient && (
                              <select
                                value={docOwnerTarget}
                                onChange={(e) => setDocOwnerTarget(e.target.value as 'responsavel' | 'titular')}
                                className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                              >
                                <option value="responsavel">Pertence ao Responsável</option>
                                <option value="titular">Pertence ao Titular</option>
                              </select>
                            )}
                            <select
                              value={docCategory}
                              onChange={(e) => setDocCategory(e.target.value)}
                              className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                            >
                              <option value="ficha_admissao">Ficha de Admissão</option>
                              <option value="contrato">Contrato Assinado</option>
                              <option value="procuracao">Procuração</option>
                              <option value="pessoal">Doc. Pessoal (CNH/RG)</option>
                              <option value="residencia">Comprovante Residência</option>
                              <option value="crlv">CRLV do Veículo</option>
                              <option value="aditivo">Aditivo Contratual</option>
                              <option value="termo_cancelamento">Termo de Cancelamento</option>
                              <option value="comprovante">Comprovante / Boleto</option>
                              <option value="audio_whatsapp">Áudio / Print WhatsApp</option>
                            </select>
                            <label className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 cursor-pointer whitespace-nowrap">
                              <Upload className="w-3.5 h-3.5" />
                              {uploading ? 'Cifrando & Enviando...' : 'Anexar ao Bucket'}
                              <input
                                type="file"
                                multiple
                                className="hidden"
                                onChange={handleFileUpload}
                                disabled={uploading}
                              />
                            </label>
                          </div>
                        )}
                      </div>

                      {/* Filtros da Lista de Documentos */}
                      <div className="flex flex-col sm:flex-row gap-2">
                        <div className="relative flex-1">
                          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5 dark:text-slate-400" />
                          <input
                            type="text"
                            value={docSearchFilter}
                            onChange={(e) => setDocSearchFilter(e.target.value)}
                            placeholder="Filtrar documentos por nome, categoria ou caminho no bucket..."
                            className="w-full rounded-lg border border-slate-200 pl-8 pr-3 py-1.5 text-xs dark:border-slate-700"
                          />
                        </div>
                        <select
                          value={docCategoryFilter}
                          onChange={(e) => setDocCategoryFilter(e.target.value)}
                          className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                        >
                          <option value="all">Todas as categorias</option>
                          <option value="ficha_admissao">Ficha de Admissão</option>
                          <option value="contrato">Contrato Assinado</option>
                          <option value="procuracao">Procuração</option>
                          <option value="pessoal">Doc. Pessoal (CNH/RG)</option>
                          <option value="residencia">Comprovante Residência</option>
                          <option value="crlv">CRLV do Veículo</option>
                          <option value="aditivo">Aditivo</option>
                          <option value="termo_cancelamento">Termo Cancelamento</option>
                          <option value="comprovante">Comprovante</option>
                          <option value="audio_whatsapp">WhatsApp / Áudio</option>
                        </select>
                      </div>

                      {/* Lista de Documentos */}
                      <div className="divide-y divide-slate-100 dark:divide-slate-800">
                        {filteredDocs.length === 0 ? (
                          <p className="py-6 text-center text-slate-500 dark:text-slate-400">
                            {docScopeTab === 'lixeira'
                              ? 'Nenhum documento na lixeira deste cliente/ficha.'
                              : 'Nenhum documento encontrado neste filtro. Use "Anexar ao Bucket" para enviar arquivos.'}
                          </p>
                        ) : (
                          filteredDocs.map((doc) => {
                            const isFromThisFicha = Boolean(editingAdmissionId && doc.admissionId === editingAdmissionId);
                            const ownerClient = clients.find((c) => c.id === doc.clientId);
                            const isTitularDoc = Boolean(titularClientId && doc.clientId === titularClientId);
                            const isTrashItem = docScopeTab === 'lixeira';

                            return (
                              <div key={doc.id} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                <div className="min-w-0 space-y-1">
                                  <div className="flex flex-wrap items-center gap-2 font-semibold text-slate-900 dark:text-slate-100">
                                    <FileText className="w-4 h-4 text-blue-700 shrink-0 dark:text-blue-300" />
                                    <span className="truncate">{doc.fileName}</span>
                                    <span
                                      className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-bold ${
                                        isFromThisFicha
                                          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300'
                                          : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200'
                                      }`}
                                    >
                                      {isFromThisFicha
                                        ? 'Desta Ficha'
                                        : doc.admissionId
                                        ? `Acervo · Ficha #${doc.admissionId}`
                                        : 'Acervo Geral do Cliente'}
                                    </span>
                                    {ownerClient && (
                                      <span
                                        className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                                          isTitularDoc
                                            ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300'
                                            : 'bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300'
                                        }`}
                                      >
                                        {isTitularDoc ? 'Titular' : 'Responsável'}: {ownerClient.fullName.split(' ')[0]}
                                      </span>
                                    )}
                                  </div>
                                  <div className="font-mono text-[11px] text-slate-500 truncate dark:text-slate-400">
                                    {doc.docCategory} · {formatBytes(doc.sizeBytes)} · SHA256:{doc.sha256Hash.slice(0, 12)} ·{' '}
                                    {doc.folderPath} · {formatDateBR(doc.createdAt)} · Por {doc.uploadedBy}
                                  </div>
                                </div>

                                <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                                  {isTrashItem ? (
                                    <>
                                      <button
                                        type="button"
                                        onClick={async () => {
                                          await apiFetch(`/api/documents/${doc.id}/restore`, { method: 'POST' });
                                          setFeedback(`Arquivo "${doc.fileName}" restaurado para o dossiê.`);
                                          await load();
                                        }}
                                        className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800/70 dark:bg-emerald-950/50 dark:text-emerald-300 dark:hover:bg-emerald-900/60"
                                      >
                                        <RotateCcw className="w-3.5 h-3.5" /> Restaurar
                                      </button>
                                      {!isApprovedLocked && (
                                        <button
                                          type="button"
                                          onClick={async () => {
                                            await apiFetch(`/api/documents/${doc.id}/purge`, { method: 'DELETE' });
                                            setFeedback(`Referência "${doc.fileName}" removida permanentemente.`);
                                            await load();
                                          }}
                                          className="inline-flex items-center gap-1 rounded-md border border-red-200 px-2.5 py-1 font-semibold text-red-600 hover:bg-red-50 dark:border-red-800/70 dark:text-red-400 dark:hover:bg-red-950/60"
                                        >
                                          <Trash2 className="w-3.5 h-3.5" /> Excluir
                                        </button>
                                      )}
                                    </>
                                  ) : (
                                    <>
                                      <button
                                        type="button"
                                        onClick={() => handlePreviewDoc(doc)}
                                        className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                                      >
                                        <Eye className="w-3.5 h-3.5" /> Visualizar
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleDownloadDoc(doc)}
                                        className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                                      >
                                        <Download className="w-3.5 h-3.5" /> Baixar
                                      </button>
                                      {editingAdmissionId && !isFromThisFicha && !isApprovedLocked && (
                                        <button
                                          type="button"
                                          title="Vincular ao dossiê desta ficha sem duplicar arquivo no bucket"
                                          onClick={() => handleLinkExistingDocToAdmission(doc)}
                                          className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1 font-semibold text-blue-700 hover:bg-blue-100 dark:border-blue-800/70 dark:bg-blue-950/50 dark:text-blue-300 dark:hover:bg-blue-900/60"
                                        >
                                          <Link2 className="w-3.5 h-3.5" /> Vincular à Ficha
                                        </button>
                                      )}
                                      {!isApprovedLocked && (
                                        <button
                                          type="button"
                                          title="Mover para a lixeira segura"
                                          onClick={async () => {
                                            await apiFetch(`/api/documents/${doc.id}`, { method: 'DELETE' });
                                            setFeedback(`Arquivo "${doc.fileName}" movido para a lixeira segura.`);
                                            await load();
                                          }}
                                          className="inline-flex items-center rounded-md border border-red-200 px-2 py-1 text-red-600 hover:bg-red-50 dark:border-red-800/70 dark:text-red-400 dark:hover:bg-red-950/60"
                                        >
                                          <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                      )}
                                    </>
                                  )}
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* ===================================================================
          MODO 3: COFRE GLOBAL BUCKETDAINVICTA & LIXEIRA
         =================================================================== */}
      {viewMode === 'vault' && (
        <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4 dark:border-slate-700 dark:bg-slate-900">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleBackFromSubView}
                title="Voltar para a tela anterior"
                className="rounded-lg border border-slate-200 dark:border-slate-700 p-1.5 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <FolderOpen className="w-4 h-4 text-blue-700 dark:text-blue-300" />
              <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                {showTrash ? 'Lixeira Segura bucketdainvicta' : 'Índice Global bucketdainvicta (ACL por Unidade)'}
              </h2>
            </div>
            <button
              type="button"
              onClick={() => setShowTrash(!showTrash)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <Trash2 className="w-3.5 h-3.5" />
              {showTrash ? `Ativos (${documents.length})` : `Lixeira (${trashedDocuments.length})`}
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-500 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-400">
                  <th className="py-2.5 px-3">Caminho do Bucket</th>
                  <th className="py-2.5 px-3">Arquivo</th>
                  <th className="py-2.5 px-3">Categoria</th>
                  <th className="py-2.5 px-3">Tamanho</th>
                  <th className="py-2.5 px-3">Data</th>
                  <th className="py-2.5 px-3 text-right">Acesso</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {(showTrash ? trashedDocuments : documents).map((doc) => (
                  <tr key={doc.id} className="hover:bg-slate-50 dark:hover:bg-slate-800">
                    <td className="py-2.5 px-3 font-mono text-[11px] text-slate-600 dark:text-slate-300">{doc.folderPath}</td>
                    <td className="py-2.5 px-3 font-semibold text-slate-900 dark:text-slate-100">{doc.fileName}</td>
                    <td className="py-2.5 px-3 text-slate-700 dark:text-slate-200">{doc.docCategory}</td>
                    <td className="py-2.5 px-3 font-mono tabular-nums">{formatBytes(doc.sizeBytes)}</td>
                    <td className="py-2.5 px-3 font-mono text-slate-500 dark:text-slate-400">{formatDateBR(doc.createdAt)}</td>
                    <td className="py-2.5 px-3 text-right">
                      {showTrash ? (
                        <button
                          type="button"
                          onClick={async () => {
                            await apiFetch(`/api/documents/${doc.id}/restore`, { method: 'POST' });
                            setFeedback(`Arquivo "${doc.fileName}" restaurado com sucesso.`);
                            await load();
                          }}
                          className="inline-flex items-center gap-1 text-emerald-700 font-semibold hover:underline dark:text-emerald-300"
                        >
                          <RotateCcw className="w-3 h-3" /> Restaurar
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleDownloadDoc(doc)}
                          className="text-blue-700 font-semibold hover:underline dark:text-blue-300"
                        >
                          Baixar
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ===================================================================
          MODAL: CADASTRO / EDIÇÃO DE CLIENTE & TITULAR (14 campos do Guia Sec 11)
         =================================================================== */}
      {personModal?.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 dark:bg-slate-950/80">
          <form
            onSubmit={handleSavePersonModal}
            className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-2xl space-y-4 text-xs max-h-[90vh] overflow-y-auto dark:bg-slate-900"
          >
            <div className="flex items-center justify-between border-b border-slate-200 pb-3 dark:border-slate-700">
              <h3 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                {personModal.mode === 'create' ? 'Novo cadastro' : 'Editar cadastro'} ·{' '}
                {personModal.targetRole === 'titular' ? 'Titular' : 'Cliente Responsável'}
              </h3>
              <button
                type="button"
                onClick={() => setPersonModal(null)}
                className="text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Nome / Razão social *</label>
                <input
                  type="text"
                  required
                  value={pName}
                  onChange={(e) => setPName(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">CPF / CNPJ</label>
                <input
                  type="text"
                  value={pCpf}
                  onChange={(e) => setPCpf(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">RG</label>
                <input
                  type="text"
                  value={pRg}
                  onChange={(e) => setPRg(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Telefone</label>
                <input
                  type="text"
                  value={pPhone}
                  onChange={(e) => setPPhone(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">E-mail</label>
                <input
                  type="email"
                  value={pEmail}
                  onChange={(e) => setPEmail(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Profissão</label>
                <input
                  type="text"
                  value={pProfession}
                  onChange={(e) => setPProfession(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Estado civil</label>
                <select
                  value={pMaritalStatus}
                  onChange={(e) => setPMaritalStatus(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                >
                  <option value="">Selecione...</option>
                  {(cadastrosData?.maritalStatuses || ['Solteiro(a)', 'Casado(a)', 'Divorciado(a)', 'Viúvo(a)', 'União Estável']).map((ms) => (
                    <option key={ms} value={ms}>
                      {ms}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Data de nascimento</label>
                <input
                  type="date"
                  value={pBirthDate}
                  onChange={(e) => setPBirthDate(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">CEP</label>
                <div className="flex gap-1">
                  <input
                    type="text"
                    value={pZipCode}
                    onChange={(e) => setPZipCode(e.target.value)}
                    placeholder="50000-000"
                    className="w-full rounded-lg border border-slate-200 px-2.5 py-2 font-mono dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const res = await apiFetch<{ address: string; neighborhood?: string; city: string; state: string }>(
                          `/api/cadastros/cep/${pZipCode.replace(/\D/g, '')}`
                        );
                        setPAddress(res.address || '');
                        if (res.neighborhood) setPNeighborhood(res.neighborhood);
                        setPCity(res.city || '');
                        setPState(res.state || '');
                      } catch (err) {
                        setErrorMsg(err instanceof Error ? err.message : 'CEP não encontrado.');
                      }
                    }}
                    className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 font-semibold text-slate-700 hover:bg-slate-100 whitespace-nowrap dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    Buscar
                  </button>
                </div>
              </div>
              <div className="sm:col-span-2">
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Logradouro</label>
                <input
                  type="text"
                  value={pAddress}
                  onChange={(e) => setPAddress(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Número</label>
                <input
                  type="text"
                  value={pNumber}
                  onChange={(e) => setPNumber(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Bairro</label>
                <input
                  type="text"
                  value={pNeighborhood}
                  onChange={(e) => setPNeighborhood(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Cidade</label>
                  <input
                    type="text"
                    value={pCity}
                    onChange={(e) => setPCity(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 px-2.5 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">UF</label>
                  <input
                    type="text"
                    maxLength={2}
                    value={pState}
                    onChange={(e) => setPState(e.target.value.toUpperCase())}
                    className="w-full rounded-lg border border-slate-200 px-2.5 py-2 uppercase font-mono dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setPersonModal(null)}
                className="rounded-lg border border-slate-200 px-4 py-2 font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="rounded-lg bg-emerald-600 px-4 py-2 font-semibold text-white hover:bg-emerald-700"
              >
                Salvar Pessoa
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ===================================================================
          VISUALIZAÇÃO EM TELA LIVRE: DOCUMENTO / FICHA / DOSSIÊ COMPLETO
         =================================================================== */}
      <FullFreeAreaDocumentShell
        open={previewOpen}
        title={`Visualização (${previewTemplate.toUpperCase()}) · ${displayContractNumber}`}
        subtitle={`Unidade: ${selectedUnit?.name || 'Matriz'} · Status: ${(LIST_STATUS_LABELS[status]?.label || status).toUpperCase()}`}
        onClose={() => setPreviewOpen(false)}
        toolbarExtras={
          <button
            type="button"
            onClick={handlePrintAction}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 dark:bg-emerald-600 px-3.5 py-1.5 text-[11px] font-semibold text-white hover:bg-slate-800 dark:hover:bg-emerald-500"
          >
            <Printer className="w-3.5 h-3.5" />
            Imprimir / PDF
          </button>
        }
      >
        <div className="w-full h-full overflow-y-auto p-4 sm:p-8 bg-slate-100 dark:bg-slate-950 flex justify-center items-start">
          <div className="w-full max-w-4xl rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 sm:p-10 shadow-sm space-y-4 text-xs leading-relaxed text-slate-800 dark:text-slate-100">
            <div className="text-center font-bold text-sm uppercase text-slate-900 dark:text-white border-b border-slate-200 dark:border-slate-700 pb-3">
              FINANCEPRO ASSESSORIA ·{' '}
              {previewTemplate === 'procuracao'
                ? 'PROCURAÇÃO AD JUDICIA ET EXTRA'
                : previewTemplate === 'completo'
                ? 'DOSSIÊ COMPLETO DE ADMISSÃO E PLANEJAMENTO'
                : 'FICHA PADRÃO DE ADMISSÃO COMERCIAL'}
            </div>
            <p>
              <strong>CONTRATO / SÉRIE:</strong> {displayContractNumber} · <strong>UNIDADE:</strong>{' '}
              {selectedUnit?.name || 'Matriz'} · <strong>STATUS:</strong>{' '}
              {(LIST_STATUS_LABELS[status]?.label || status).toUpperCase()}
            </p>
            <p>
              <strong>CLIENTE RESPONSÁVEL:</strong> {respClient?.fullName || '—'}, CPF/CNPJ{' '}
              <span className="font-mono">{respClient?.cpfCnpj || '—'}</span>, RG{' '}
              <span className="font-mono">{respClient?.rg || '—'}</span>, Tel. {respClient?.phone || '—'}, Endereço:{' '}
              {formatClientAddress(respClient) || '—'}.
            </p>
            {titClient && (
              <p>
                <strong>TITULAR VINCULADO:</strong> {titClient.fullName}, CPF/CNPJ{' '}
                <span className="font-mono">{titClient.cpfCnpj}</span>, Tel. {titClient.phone || '—'}.
              </p>
            )}
            <p>
              <strong>NEGOCIAÇÃO:</strong> Banco Credor {bankName || '—'} · Modalidade {modality} · Consultor{' '}
              {consultantName || '—'}.
            </p>
            {showVehicleSection && (
              <p>
                <strong>VEÍCULO OBJETO:</strong> {vehicleBrand} {vehicleModel} · Cor {vehicleColor || '—'} · Ano{' '}
                {vehicleYear || '—'} · Placa <span className="font-mono">{vehiclePlate || '—'}</span> · Chassi{' '}
                <span className="font-mono">{vehicleChassis || '—'}</span> · Renavam{' '}
                <span className="font-mono">{vehicleRenavam || '—'}</span>.
              </p>
            )}
            <p>
              <strong>DÍVIDA ATUAL &amp; RECÁLCULO:</strong> Valor Financiado {formatBRL(parseReaisToCents(financedAmountReais))} · Parcela Atual{' '}
              {formatBRL(parseReaisToCents(currentInstallmentReais))} · {debtTotalInstallments}x ({debtPaidInstallments} pagas / {debtOverdueInstallments} em atraso).
              {scenarios[0] && (
                <>
                  {' '}Cenário 1 ({scenarios[0].name}): Nova dívida {formatBRL(scenarios[0].recalcDebtCents)} com economia estimada de{' '}
                  <strong>{formatBRL(scenarios[0].savingsCents)}</strong>.
                </>
              )}
            </p>
            <p>
              <strong>SERVIÇOS:</strong> Gestão (Parcela 01) {formatBRL(mgmtCents)} · Custos Iniciais (Parcela 02){' '}
              {formatBRL(initialCostCents)} · Total dos Serviços <strong>{formatBRL(servicesTotalCents)}</strong>.
            </p>
            {notes && (
              <p>
                <strong>ANOTAÇÕES:</strong> {notes}
              </p>
            )}
            <div className="pt-10 grid grid-cols-2 gap-8 text-center">
              <div className="border-t border-slate-400 dark:border-slate-600 pt-1">Assinatura do Cliente / Titular</div>
              <div className="border-t border-slate-400 dark:border-slate-600 pt-1">Conferência FinancePro Assessoria</div>
            </div>
          </div>
        </div>
      </FullFreeAreaDocumentShell>

      {/* ===================================================================
          MODAL: EXPORTAR WORD (.docx) COM TEMPLATE OPCIONAL
         =================================================================== */}
      {wordModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 dark:bg-slate-950/80 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 shadow-2xl space-y-4 text-xs">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-3">
              <h3 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                Exportar Documento Word (.docx)
              </h3>
              <button
                type="button"
                onClick={() => setWordModalOpen(false)}
                className="text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
              Gere o arquivo <strong>.docx</strong> padrão preenchido com os dados desta ficha ou envie um template <strong>.docx</strong> com variáveis (<span className="font-mono">{'{cliente_nome}'}, {'{cliente_cpf}'}, {'{contrato}'}, {'{banco}'}, {'{economia}'}</span>). Arquivos <span className="font-mono">.doc</span> não são suportados.
            </p>
            <div className="space-y-2.5">
              <button
                type="button"
                onClick={() => handleExportDocx()}
                className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-blue-700 px-4 py-2.5 font-semibold text-white hover:bg-blue-800"
              >
                <Download className="w-4 h-4" />
                Baixar Ficha Padrão (.docx)
              </button>
              <label className="w-full inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-4 py-2.5 font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer">
                <Upload className="w-4 h-4" />
                Enviar Template .docx e Preencher
                <input
                  type="file"
                  accept=".docx,.doc"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleExportDocx(f);
                  }}
                />
              </label>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================
          MODAL: AUDITORIA COMPLETA DA ADMISSÃO (CAMPO ANTERIOR -> ATUALIZADO)
         =================================================================== */}
      <EntityAuditModal
        open={Boolean(historyAdmission)}
        title={historyAdmission ? `Admissão · ${historyAdmission.contractNumber}` : 'Admissão'}
        entityType="admissions"
        entityId={historyAdmission?.id || 0}
        onClose={() => setHistoryAdmission(null)}
      />
      <EntityAuditModal
        open={sectorAuditOpen}
        title="Comercial · Admissão & Cofre de Documentos · Auditoria Cumulativa"
        entityType="admissions,document_objects"
        entityId="all"
        onClose={() => setSectorAuditOpen(false)}
      />

      {/* ===================================================================
          MODAL: PRÉ-VISUALIZAÇÃO SEGURA DE DOCUMENTO DO BUCKET (TEMA DARK/WHITE)
         =================================================================== */}
      <DossierDocumentPreviewModal
        open={Boolean(previewDocModal)}
        title={previewDocModal?.doc.fileName || ''}
        subtitle={
          previewDocModal
            ? `${previewDocModal.doc.storageUri} · SHA256:${previewDocModal.doc.sha256Hash}`
            : ''
        }
        mimeType={previewDocModal?.doc.mimeType || ''}
        blobUrl={previewDocModal?.blobUrl || ''}
        loading={Boolean(previewDocModal?.loading)}
        onDownload={
          previewDocModal ? () => handleDownloadDoc(previewDocModal.doc) : undefined
        }
        onClose={() => {
          if (previewDocModal?.blobUrl) URL.revokeObjectURL(previewDocModal.blobUrl);
          setPreviewDocModal(null);
        }}
      />
    </div>
  );
};
