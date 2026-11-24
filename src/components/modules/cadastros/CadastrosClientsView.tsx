import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowDownUp,
  ArrowLeft,
  Ban,
  CalendarPlus,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Eye,
  Filter,
  FolderOpen,
  History,
  Lock,
  MessageSquare,
  Pencil,
  PhoneCall,
  Plus,
  RefreshCw,
  Save,
  Search,
  Send,
  Settings2,
  ShieldAlert,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  apiFetch,
  formatBytes,
  formatDateBR,
  formatDateTimeBR,
  getActiveUnitHeader,
  getAuthToken,
  parseJsonResponse,
} from '../../../lib/api.ts';
import { ProtectedDocumentViewerModal } from '../../common/ProtectedDocumentViewerModal.tsx';
import { Admission, AuthUser, Client, DocumentObject, ModuleId, NavigationIntent, Unit } from '../../../types.ts';
import {
  AdmissionQuickViewerModal,
  BlockClientModal,
  BRAZILIAN_UFS,
  DeleteClientModal,
  EntityAuditModal,
  formatCepMask,
  formatCpfCnpjMask,
  formatPhoneMask,
  isValidCpfOrCnpj,
  MaritalStatusModal,
} from './CadastrosShared.tsx';

type ClientRow = Client & { docsCount?: number; docsSampleNames?: string[]; admissionsCount?: number };

interface WaThread {
  id: number;
  provider: string;
  contactName: string;
  contactPhone: string;
  lastMessagePreview: string;
  updatedAt: string;
  instanceLabel?: string | null;
}

interface WaMsg {
  id: number;
  threadId: number;
  provider?: string;
  direction: string;
  senderName: string;
  body: string;
  contentType: string;
  attachmentUrl?: string | null;
  attachmentName?: string | null;
  createdAt: string;
}

interface CadastrosClientsViewProps {
  units: Unit[];
  activeUnitId: number;
  currentUser: AuthUser;
  maritalStatuses: string[];
  onMaritalStatusesChange: (next: string[]) => void;
  onCatalogUpdated?: () => void;
  navIntent?: NavigationIntent | null;
  onClearIntent?: () => void;
  onNavigate: (mod: ModuleId, intent?: NavigationIntent) => void;
}

export const CadastrosClientsView: React.FC<CadastrosClientsViewProps> = ({
  units,
  activeUnitId,
  currentUser,
  maritalStatuses,
  onMaritalStatusesChange,
  onCatalogUpdated,
  navIntent,
  onClearIntent,
  onNavigate,
}) => {
  const [mode, setMode] = useState<'list' | 'form'>('list');
  const [formTab, setFormTab] = useState<'dados' | 'whatsapp' | 'documentos'>('dados');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingClientObj, setEditingClientObj] = useState<ClientRow | null>(null);

  // List state (50/page server-side pagination)
  const [rows, setRows] = useState<ClientRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);

  // Filters & sorting
  const [qInput, setQInput] = useState('');
  const [qDebounced, setQDebounced] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [filterNature, setFilterNature] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterCpf, setFilterCpf] = useState('');
  const [filterCity, setFilterCity] = useState('');
  const [filterState, setFilterState] = useState('');
  const [filterDocStatus, setFilterDocStatus] = useState<'' | 'with_docs' | 'without_docs'>('');
  const [filterDocQuery, setFilterDocQuery] = useState('');
  const [filterDocQueryDebounced, setFilterDocQueryDebounced] = useState('');
  const [sortKey, setSortKey] = useState<'fullName' | 'cpfCnpj' | 'phone' | 'city'>('fullName');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  // Form fields
  const [personNature, setPersonNature] = useState<'PF' | 'PJ'>('PF');
  const [fullName, setFullName] = useState('');
  const [cpfCnpj, setCpfCnpj] = useState('');
  const [rg, setRg] = useState('');
  const [phone, setPhone] = useState('');
  const [isWhatsapp, setIsWhatsapp] = useState(true);
  const [secondaryPhone, setSecondaryPhone] = useState('');
  const [secondaryIsWhatsapp, setSecondaryIsWhatsapp] = useState(false);
  const [maritalStatus, setMaritalStatus] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [email, setEmail] = useState('');
  const [profession, setProfession] = useState('');
  const [zipCode, setZipCode] = useState('');
  const [address, setAddress] = useState('');
  const [addressNumber, setAddressNumber] = useState('');
  const [complement, setComplement] = useState('');
  const [neighborhood, setNeighborhood] = useState('');
  const [city, setCity] = useState('');
  const [stateUf, setStateUf] = useState('');
  const [unitId, setUnitId] = useState(activeUnitId || 1);
  const [notes, setNotes] = useState('');
  const [cepLoading, setCepLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Global admissions & documents reference for links & tabs
  const [allClients, setAllClients] = useState<Client[]>([]);
  const [allAdmissions, setAllAdmissions] = useState<Admission[]>([]);
  const [allDocs, setAllDocs] = useState<DocumentObject[]>([]);
  const [refsLoaded, setRefsLoaded] = useState(false);

  // WhatsApp & Docs inside form
  const [waLoading, setWaLoading] = useState(false);
  const [waSyncing, setWaSyncing] = useState(false);
  const [waThreads, setWaThreads] = useState<WaThread[]>([]);
  const [waMsgs, setWaMsgs] = useState<WaMsg[]>([]);
  const [waSelectedThread, setWaSelectedThread] = useState<number | 'all'>('all');
  const [waDraft, setWaDraft] = useState('');
  const [waSending, setWaSending] = useState(false);
  const [docCategory, setDocCategory] = useState('pessoal');
  const [docUploading, setDocUploading] = useState(false);
  const [viewerDoc, setViewerDoc] = useState<DocumentObject | null>(null);
  const [renameDocTarget, setRenameDocTarget] = useState<DocumentObject | null>(null);
  const [renameDocValue, setRenameDocValue] = useState('');
  const [renamingDoc, setRenamingDoc] = useState(false);

  // Modals & notifications
  const [feedback, setFeedback] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [auditTarget, setAuditTarget] = useState<{ id: number; label: string } | null>(null);
  const [blockTarget, setBlockTarget] = useState<ClientRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ClientRow | null>(null);
  const [maritalModalOpen, setMaritalModalOpen] = useState(false);
  const [viewerAdmission, setViewerAdmission] = useState<Admission | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setQDebounced(qInput.trim());
      setPage(1);
    }, 280);
    return () => clearTimeout(t);
  }, [qInput]);

  useEffect(() => {
    const t = setTimeout(() => {
      setFilterDocQueryDebounced(filterDocQuery.trim());
      setPage(1);
    }, 280);
    return () => clearTimeout(t);
  }, [filterDocQuery]);

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({
        page: String(page),
        limit: '50',
        sortKey,
        sortDir,
      });
      if (qDebounced) qs.set('q', qDebounced);
      if (filterNature) qs.set('personNature', filterNature);
      if (filterStatus) qs.set('status', filterStatus);
      if (filterCpf) qs.set('cpfCnpj', filterCpf);
      if (filterCity) qs.set('city', filterCity);
      if (filterState) qs.set('state', filterState);
      if (filterDocStatus) qs.set('docFilter', filterDocStatus);
      if (filterDocQueryDebounced) qs.set('docQuery', filterDocQueryDebounced);

      const [res, refs] = await Promise.all([
        apiFetch<{ data: ClientRow[]; total: number; page: number; totalPages: number }>(
          `/api/cadastros/clients?${qs.toString()}`
        ),
        apiFetch<{ clients: Client[]; admissions: Admission[]; documents: DocumentObject[] }>('/api/clients'),
      ]);
      setRows(res.data || []);
      setTotal(res.total || 0);
      setTotalPages(res.totalPages || 1);
      setAllClients(refs.clients || []);
      setAllAdmissions(refs.admissions || []);
      setAllDocs(refs.documents || []);
      setRefsLoaded(true);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Erro ao carregar clientes.');
    } finally {
      setLoading(false);
    }
  }, [page, sortKey, sortDir, qDebounced, filterNature, filterStatus, filterCpf, filterCity, filterState, filterDocStatus, filterDocQueryDebounced]);

  useEffect(() => {
    loadList();
  }, [loadList]);

  const clientAdmissions = useMemo(() => {
    if (!editingId) return [];
    return allAdmissions.filter((a) => a.clientId === editingId || a.assetOwnerId === editingId);
  }, [allAdmissions, editingId]);

  const clientDocs = useMemo(() => {
    if (!editingId) return [];
    return allDocs.filter((d) => d.clientId === editingId);
  }, [allDocs, editingId]);

  const resetForm = useCallback(
    (source?: ClientRow, isDuplicate = false, initialTab: 'dados' | 'whatsapp' | 'documentos' = 'dados') => {
      setErrorMsg('');
      setFeedback('');
      setFormTab(initialTab);
      if (source) {
        setEditingId(isDuplicate ? null : source.id);
        setEditingClientObj(isDuplicate ? null : source);
      const nat = source.personNature === 'PJ' ? 'PJ' : 'PF';
      setPersonNature(nat);
      setFullName(isDuplicate ? `${source.fullName} (Cópia)` : source.fullName);
      setCpfCnpj(isDuplicate ? '' : source.cpfCnpj || '');
      setRg(isDuplicate ? '' : source.rg || '');
      setPhone(source.phone || '');
      setIsWhatsapp(Boolean(source.whatsapp || source.phone));
      setSecondaryPhone(source.secondaryPhone || '');
      setSecondaryIsWhatsapp(Boolean(source.secondaryIsWhatsapp));
      setMaritalStatus(source.maritalStatus || '');
      setBirthDate(source.birthDate || '');
      setEmail(source.email || '');
      setProfession(source.profession || '');
      setZipCode(source.zipCode || '');
      setAddress(source.address || '');
      setAddressNumber(source.addressNumber || '');
      setComplement(source.complement || '');
      setNeighborhood(source.neighborhood || '');
      setCity(source.city || '');
      setStateUf(source.state || '');
      setUnitId(source.unitId || activeUnitId || 1);
      setNotes(source.notes || '');
    } else {
      setEditingId(null);
      setEditingClientObj(null);
      setPersonNature('PF');
      setFullName('');
      setCpfCnpj('');
      setRg('');
      setPhone('');
      setIsWhatsapp(true);
      setSecondaryPhone('');
      setSecondaryIsWhatsapp(false);
      setMaritalStatus('');
      setBirthDate('');
      setEmail('');
      setProfession('');
      setZipCode('');
      setAddress('');
      setAddressNumber('');
      setComplement('');
      setNeighborhood('');
      setCity('');
      setStateUf('');
      setUnitId(activeUnitId || 1);
      setNotes('');
    }
    setMode('form');
  },
  [activeUnitId]
  );

  useEffect(() => {
    if (!navIntent?.clientId) return;
    const target =
      allClients.find((c) => c.id === navIntent.clientId) ||
      rows.find((c) => c.id === navIntent.clientId);
    if (target) {
      const requestedTab =
        navIntent.tab === 'whatsapp' || navIntent.tab === 'documentos' ? navIntent.tab : 'dados';
      resetForm(target, false, requestedTab);
      onClearIntent?.();
    } else if (refsLoaded) {
      onClearIntent?.();
    }
  }, [navIntent, allClients, rows, refsLoaded, resetForm, onClearIntent]);

  const handleLookupCep = async () => {
    const clean = zipCode.replace(/\D/g, '');
    if (clean.length !== 8) {
      setErrorMsg('Informe um CEP válido com 8 dígitos.');
      return;
    }
    setCepLoading(true);
    setErrorMsg('');
    try {
      const data = await apiFetch<{
        zipCode: string;
        address: string;
        complement?: string;
        neighborhood: string;
        city: string;
        state: string;
      }>(`/api/cadastros/cep/${clean}`);
      if (data.address) setAddress(data.address);
      if (data.complement && !complement) setComplement(data.complement);
      if (data.neighborhood) setNeighborhood(data.neighborhood);
      if (data.city) setCity(data.city);
      if (data.state) setStateUf(data.state);
      setFeedback('Endereço preenchido via ViaCEP.');
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'CEP não localizado.');
    } finally {
      setCepLoading(false);
    }
  };

  const handleSaveClient = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setFeedback('');
    if (!fullName.trim()) {
      setErrorMsg('Nome / Razão social é obrigatório.');
      return;
    }
    if (!isValidCpfOrCnpj(cpfCnpj, personNature)) {
      setErrorMsg(personNature === 'PJ' ? 'CNPJ inválido (deve conter 14 dígitos).' : 'CPF/CNPJ inválido (11 ou 14 dígitos).');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        personNature,
        fullName: fullName.trim(),
        cpfCnpj: cpfCnpj.trim(),
        rg: personNature === 'PJ' ? '' : rg.trim(),
        birthDate: personNature === 'PJ' ? '' : birthDate.trim(),
        profession: profession.trim(),
        maritalStatus: personNature === 'PJ' ? '' : maritalStatus.trim(),
        phone: phone.trim(),
        isWhatsapp,
        secondaryPhone: secondaryPhone.trim(),
        secondaryIsWhatsapp,
        email: email.trim(),
        zipCode: zipCode.trim(),
        address: address.trim(),
        addressNumber: addressNumber.trim(),
        complement: complement.trim(),
        neighborhood: neighborhood.trim(),
        city: city.trim(),
        state: stateUf.trim().toUpperCase(),
        unitId,
        notes: notes.trim(),
      };

      if (editingId) {
        const res = await apiFetch<{ client: ClientRow }>(`/api/clients/${editingId}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        setEditingClientObj(res.client);
        setFeedback(`Cliente "${res.client.fullName}" atualizado com sucesso.`);
      } else {
        const res = await apiFetch<{ client: ClientRow }>('/api/clients', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setEditingId(res.client.id);
        setEditingClientObj(res.client);
        setFeedback(`Cliente "${res.client.fullName}" cadastrado com sucesso. Guias WhatsApp e Documentos liberadas!`);
      }
      await loadList();
      onCatalogUpdated?.();
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Erro ao salvar cliente.');
    } finally {
      setSaving(false);
    }
  };

  // Load client WhatsApp conversations (GoTalk + UaZapi)
  const loadClientWhatsapp = useCallback(async (cid: number) => {
    setWaLoading(true);
    try {
      const res = await apiFetch<{ threads: WaThread[]; messages: WaMsg[] }>(`/api/clients/${cid}/interactions`);
      setWaThreads(res.threads || []);
      setWaMsgs(res.messages || []);
    } catch {
      // ignore empty history error
    } finally {
      setWaLoading(false);
    }
  }, []);

  useEffect(() => {
    if (mode === 'form' && formTab === 'whatsapp' && editingId) {
      loadClientWhatsapp(editingId);
    }
  }, [mode, formTab, editingId, loadClientWhatsapp]);

  const handleSyncWhatsapp = async () => {
    if (!editingId) return;
    setWaSyncing(true);
    setErrorMsg('');
    try {
      const res = await apiFetch<{ threads: WaThread[]; messages: WaMsg[]; syncedMessages?: number }>(
        `/api/clients/${editingId}/sync-whatsapp`,
        { method: 'POST', body: JSON.stringify({ unitId }) }
      );
      setWaThreads(res.threads || []);
      setWaMsgs(res.messages || []);
      setFeedback(`Sincronização concluída (${res.threads?.length || 0} conversa(s), ${res.syncedMessages || 0} novas mensagens).`);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Erro ao sincronizar conversas.');
    } finally {
      setWaSyncing(false);
    }
  };

  const handleStartWhatsapp = async (provider: 'gotalk' | 'uazapi') => {
    if (!editingId) return;
    setErrorMsg('');
    try {
      const res = await apiFetch<{ thread: WaThread }>(`/api/clients/${editingId}/whatsapp/start`, {
        method: 'POST',
        body: JSON.stringify({ provider, unitId }),
      });
      await loadClientWhatsapp(editingId);
      setWaSelectedThread(res.thread.id);
      setFeedback(`Conversa ${provider.toUpperCase()} aberta para ${res.thread.contactPhone}.`);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Não foi possível iniciar conversa.');
    }
  };

  const handleSendWaMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!waDraft.trim() || waSelectedThread === 'all' || !editingId) return;
    setWaSending(true);
    setErrorMsg('');
    try {
      await apiFetch(`/api/whatsapp/threads/${waSelectedThread}/messages`, {
        method: 'POST',
        body: JSON.stringify({ body: waDraft.trim(), contentType: 'text', direction: 'outbound' }),
      });
      setWaDraft('');
      await loadClientWhatsapp(editingId);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Erro ao enviar mensagem.');
    } finally {
      setWaSending(false);
    }
  };

  const handleUploadClientDoc = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !editingId) return;
    setDocUploading(true);
    setErrorMsg('');
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('clientId', String(editingId));
      form.append('docCategory', docCategory);
      const token = getAuthToken();
      const resp = await fetch('/api/documents/upload', {
        method: 'POST',
        headers: {
          'x-unit-id': String(getActiveUnitHeader()),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: form,
      });
      await parseJsonResponse(resp, 'Falha no upload para Cloudflare R2.');
      setFeedback(`Documento "${file.name}" armazenado com criptografia AES-256-GCM no bucketdainvicta.`);
      await loadList();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao enviar documento.');
    } finally {
      setDocUploading(false);
    }
  };

  const handlePreviewDoc = (doc: DocumentObject) => {
    setViewerDoc(doc);
  };

  const handleRenameDocSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!renameDocTarget || !renameDocValue.trim()) return;
    setRenamingDoc(true);
    setErrorMsg('');
    try {
      await apiFetch(`/api/documents/${renameDocTarget.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ fileName: renameDocValue.trim() }),
      });
      setFeedback(`Documento renomeado para "${renameDocValue.trim()}".`);
      setRenameDocTarget(null);
      await loadList();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao renomear documento.');
    } finally {
      setRenamingDoc(false);
    }
  };

  const handleDownloadDoc = async (doc: DocumentObject) => {
    try {
      const resp = await fetch(`/api/documents/${doc.id}/download`, {
        headers: { Authorization: `Bearer ${getAuthToken()}` },
      });
      if (!resp.ok) throw new Error('Falha ao baixar documento.');
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = doc.fileName;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Erro ao baixar documento.');
    }
  };

  const toggleSort = (k: typeof sortKey) => {
    if (sortKey === k) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(k);
      setSortDir('asc');
    }
    setPage(1);
  };

  return (
    <div className="space-y-4">
      {feedback && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-medium text-emerald-900 flex items-center justify-between gap-2 dark:border-emerald-800/70 dark:bg-emerald-950/50 dark:text-emerald-300">
          <span>{feedback}</span>
          <button type="button" onClick={() => setFeedback('')} className="text-emerald-700 hover:text-emerald-950 dark:text-emerald-300">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      {errorMsg && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-xs font-medium text-red-800 flex items-center justify-between gap-2 dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300">
          <span>{errorMsg}</span>
          <button type="button" onClick={() => setErrorMsg('')} className="text-red-700 hover:text-red-950 dark:text-red-300">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* ===================================================================
          GRADE PRINCIPAL (LISTAGEM PAGINADA 50/PÁG)
         =================================================================== */}
      {mode === 'list' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h1 className="font-display text-xl font-bold text-slate-900 dark:text-slate-100">Cadastros Comuns · Clientes</h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Pessoas Físicas e Jurídicas utilizadas em Admissões, Atendimentos GoTalk/UaZapi e Cofre R2 ({total} registros)
              </p>
            </div>
            <button
              type="button"
              onClick={() => resetForm()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 whitespace-nowrap dark:bg-emerald-600 dark:hover:bg-emerald-500"
            >
              <Plus className="w-3.5 h-3.5" /> Novo Cliente
            </button>
          </div>

          {/* Barra de Busca + Filtros */}
          <div className="rounded-xl border border-slate-200 bg-white p-3.5 space-y-3 dark:border-slate-700 dark:bg-slate-900">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[220px]">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 dark:text-slate-400" />
                <input
                  type="text"
                  value={qInput}
                  onChange={(e) => setQInput(e.target.value)}
                  placeholder="Buscar por nome, código, CPF/CNPJ, telefone ou arquivo no R2..."
                  className="w-full rounded-lg border border-slate-200 pl-8 pr-3 py-2 text-xs text-slate-800 dark:border-slate-700 dark:text-slate-100"
                />
              </div>
              <select
                value={filterDocStatus}
                onChange={(e) => {
                  setFilterDocStatus(e.target.value as '' | 'with_docs' | 'without_docs');
                  setPage(1);
                }}
                aria-label="Filtrar clientes por documentos no bucket"
                className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              >
                <option value="">Docs Bucket: Todos</option>
                <option value="with_docs">Com documentos no R2</option>
                <option value="without_docs">Sem documentos no R2</option>
              </select>
              <button
                type="button"
                onClick={() => setShowFilters((s) => !s)}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold ${
                  showFilters ? 'border-slate-900 bg-slate-900 text-white dark:border-emerald-500 dark:bg-emerald-600' : 'border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800'
                }`}
              >
                <Filter className="w-3.5 h-3.5" />
                Filtros Avançados
              </button>
              <button
                type="button"
                onClick={loadList}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                Atualizar
              </button>
            </div>

            {showFilters && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2.5 pt-2 border-t border-slate-100 text-xs dark:border-slate-800">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">Natureza</label>
                  <select
                    value={filterNature}
                    onChange={(e) => {
                      setFilterNature(e.target.value);
                      setPage(1);
                    }}
                    className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  >
                    <option value="">Todas</option>
                    <option value="PF">Pessoa Física (PF)</option>
                    <option value="PJ">Pessoa Jurídica (PJ)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">Status</label>
                  <select
                    value={filterStatus}
                    onChange={(e) => {
                      setFilterStatus(e.target.value);
                      setPage(1);
                    }}
                    className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  >
                    <option value="">Todos</option>
                    <option value="ativo">Ativo</option>
                    <option value="suspenso">Suspenso</option>
                    <option value="cancelado">Bloqueado/Cancelado</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">CPF / CNPJ</label>
                  <input
                    type="text"
                    value={filterCpf}
                    onChange={(e) => {
                      setFilterCpf(e.target.value);
                      setPage(1);
                    }}
                    placeholder="Somente dígitos ou máscara"
                    className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 font-mono dark:border-slate-700"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">Cidade</label>
                  <input
                    type="text"
                    value={filterCity}
                    onChange={(e) => {
                      setFilterCity(e.target.value);
                      setPage(1);
                    }}
                    placeholder="Recife..."
                    className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 dark:border-slate-700"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">UF</label>
                  <select
                    value={filterState}
                    onChange={(e) => {
                      setFilterState(e.target.value);
                      setPage(1);
                    }}
                    className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  >
                    <option value="">Todas</option>
                    {BRAZILIAN_UFS.map((uf) => (
                      <option key={uf} value={uf}>
                        {uf}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">
                    Pesquisar Documentos no Bucket
                  </label>
                  <input
                    type="text"
                    value={filterDocQuery}
                    onChange={(e) => setFilterDocQuery(e.target.value)}
                    placeholder="Arquivo, pasta ou selo INV-..."
                    className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Tabela */}
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden dark:border-slate-700 dark:bg-slate-900">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-300">
                    <th className="py-3 px-4">
                      <button type="button" onClick={() => toggleSort('fullName')} className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white">
                        Descrição <ArrowDownUp className="w-3 h-3" />
                      </button>
                    </th>
                    <th className="py-3 px-4">Natureza</th>
                    <th className="py-3 px-4">
                      <button type="button" onClick={() => toggleSort('cpfCnpj')} className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white">
                        CPF / CNPJ <ArrowDownUp className="w-3 h-3" />
                      </button>
                    </th>
                    <th className="py-3 px-4">
                      <button type="button" onClick={() => toggleSort('phone')} className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white">
                        Telefone (GoTalk) <ArrowDownUp className="w-3 h-3" />
                      </button>
                    </th>
                    <th className="py-3 px-4">Cidade/UF</th>
                    <th className="py-3 px-4">Bucket R2</th>
                    <th className="py-3 px-4 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-slate-500 dark:text-slate-400">
                        {loading ? 'Consultando clientes...' : 'Nenhum cliente localizado para os filtros selecionados.'}
                      </td>
                    </tr>
                  ) : (
                    rows.map((c) => {
                      const isBlocked = c.status === 'suspenso' || c.status === 'cancelado';
                      const docsTotal = Number(c.docsCount || 0);
                      const hasDocs = docsTotal > 0;
                      return (
                        <tr key={c.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800">
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-[10px] text-slate-400 dark:text-slate-400">#{c.id}</span>
                              <span className="font-semibold text-slate-900 dark:text-slate-100">{c.fullName}</span>
                              {hasDocs && (
                                <span
                                  title={
                                    c.docsSampleNames && c.docsSampleNames.length > 0
                                      ? `Documentos no bucket: ${c.docsSampleNames.join(', ')}`
                                      : `${docsTotal} documento(s) no bucket R2`
                                  }
                                  className="text-emerald-600 dark:text-emerald-400 shrink-0"
                                >
                                  <FolderOpen className="w-3.5 h-3.5" />
                                </span>
                              )}
                              {isBlocked && (
                                <span
                                  title={c.suspensionReason || c.cancelledReason || 'Cliente com restrição'}
                                  className="inline-flex items-center gap-1 text-[10px] font-bold text-red-700 uppercase dark:text-red-300"
                                >
                                  <Ban className="w-3 h-3" /> {c.status}
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-slate-500 mt-0.5 dark:text-slate-400">
                              {c.admissionsCount ? `${c.admissionsCount} admissão(ões)` : 'Sem admissão'}
                            </div>
                          </td>
                          <td className="py-3 px-4 font-mono font-semibold text-slate-700 dark:text-slate-200">
                            {c.personNature === 'PJ' ? 'Jurídica (PJ)' : 'Física (PF)'}
                          </td>
                          <td className="py-3 px-4 font-mono text-slate-700 whitespace-nowrap dark:text-slate-200">{c.cpfCnpj || '—'}</td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            {c.phone ? (
                              <button
                                type="button"
                                onClick={() => resetForm(c, false, 'whatsapp')}
                                title="Abrir conversas GoTalk / UaZapi do cliente"
                                className="inline-flex items-center gap-1.5 font-mono font-semibold text-emerald-700 hover:underline dark:text-emerald-300"
                              >
                                <MessageSquare className="w-3.5 h-3.5" />
                                {c.phone}
                              </button>
                            ) : (
                              <span className="text-slate-400 dark:text-slate-400">—</span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-slate-700 whitespace-nowrap dark:text-slate-200">
                            {c.city ? `${c.city}/${c.state || '—'}` : '—'}
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            {hasDocs ? (
                              <button
                                type="button"
                                onClick={() => resetForm(c, false, 'documentos')}
                                title={
                                  c.docsSampleNames && c.docsSampleNames.length > 0
                                    ? `Abrir Documentos R2 (${c.docsSampleNames.join(', ')})`
                                    : 'Abrir aba Documentos R2 do cliente'
                                }
                                className="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 dark:border-emerald-800/70 bg-emerald-50/70 dark:bg-emerald-950/40 px-2 py-1 text-[11px] font-semibold text-emerald-800 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/50"
                              >
                                <FolderOpen className="w-3.5 h-3.5 shrink-0" />
                                <span className="font-mono font-bold tabular-nums">{docsTotal}</span>
                                <span>{docsTotal === 1 ? 'doc R2' : 'docs R2'}</span>
                              </button>
                            ) : (
                              <span className="text-[11px] text-slate-400 dark:text-slate-500">Sem docs</span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-1">
                              <button
                                type="button"
                                title="Novo Agendamento para este Cliente"
                                onClick={() => onNavigate('appointments', { clientId: c.id, triggerNew: true })}
                                className="rounded-md border border-emerald-200 p-1.5 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800/70 dark:text-emerald-300 dark:hover:bg-emerald-950/60"
                              >
                                <CalendarPlus className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                title="Histórico de Auditoria"
                                onClick={() => setAuditTarget({ id: c.id, label: c.fullName })}
                                className="rounded-md border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                              >
                                <History className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                title="Editar Cliente"
                                onClick={() => resetForm(c, false)}
                                className="rounded-md border border-slate-200 p-1.5 text-blue-700 hover:bg-blue-50 dark:border-slate-700 dark:text-blue-300 dark:hover:bg-blue-950/60"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                title="Duplicar Cadastro"
                                onClick={() => resetForm(c, true)}
                                className="rounded-md border border-slate-200 p-1.5 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                              >
                                <Copy className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                title={isBlocked ? 'Administrar Bloqueio/Restrição' : 'Bloquear / Suspender Cliente'}
                                onClick={() => setBlockTarget(c)}
                                className={`rounded-md border p-1.5 ${
                                  isBlocked
                                    ? 'border-red-300 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300 dark:hover:bg-red-900/60'
                                    : 'border-slate-200 text-amber-700 hover:bg-amber-50 dark:border-slate-700 dark:text-amber-300 dark:hover:bg-amber-950/60'
                                }`}
                              >
                                <Lock className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                title="Excluir Cliente"
                                onClick={() => setDeleteTarget(c)}
                                className="rounded-md border border-red-200 p-1.5 text-red-600 hover:bg-red-50 dark:border-red-800/70 dark:text-red-400 dark:hover:bg-red-950/60"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <div className="px-4 py-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-600 dark:border-slate-800 dark:text-slate-300">
              <span>
                Exibindo {rows.length} de {total} clientes (página {page} de {totalPages})
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
          FORMULÁRIO INLINE NA PÁGINA COM 3 ABAS (DADOS | WHATSAPP | DOCUMENTOS)
         =================================================================== */}
      {mode === 'form' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={() => setMode('list')}
                className="rounded-lg border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <div>
                <h1 className="font-display text-xl font-bold text-slate-900 dark:text-slate-100">
                  {editingId ? `Editar Cliente #${editingId}` : 'Novo Cliente'}
                </h1>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {editingClientObj?.fullName || 'Preencha os dados cadastrais. ViaCEP e bloqueios administrativos integrados.'}
                </p>
              </div>
            </div>

            {editingClientObj && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setAuditTarget({ id: editingClientObj.id, label: editingClientObj.fullName })}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <History className="w-3.5 h-3.5" /> Auditoria
                </button>
                <button
                  type="button"
                  onClick={() => setBlockTarget(editingClientObj)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900 hover:bg-amber-100 dark:border-amber-800/70 dark:bg-amber-950/50 dark:text-amber-300 dark:hover:bg-amber-900/60"
                >
                  <ShieldAlert className="w-3.5 h-3.5" />
                  {editingClientObj.status === 'ativo' ? 'Suspender / Bloquear' : `Restrição (${editingClientObj.status})`}
                </button>
              </div>
            )}
          </div>

          {editingClientObj && (editingClientObj.status === 'suspenso' || editingClientObj.status === 'cancelado') && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-900 flex items-center justify-between gap-3 dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300">
              <div>
                <strong className="uppercase">Cliente com restrição ({editingClientObj.status}):</strong>{' '}
                {editingClientObj.suspensionReason || editingClientObj.cancelledReason || 'Sem motivo registrado.'}
              </div>
              <button
                type="button"
                onClick={() => setBlockTarget(editingClientObj)}
                className="font-bold underline shrink-0"
              >
                Administrar Restrição
              </button>
            </div>
          )}

          {/* Abas do Cliente */}
          <div className="flex flex-wrap items-center gap-1 border-b border-slate-200 bg-white rounded-t-xl px-4 pt-2 dark:border-slate-700 dark:bg-slate-900">
            {[
              { id: 'dados', label: 'Dados do Cliente', icon: Pencil, disabled: false },
              {
                id: 'whatsapp',
                label: `Conversas WhatsApp (${waThreads.length})`,
                icon: MessageSquare,
                disabled: !editingId,
              },
              {
                id: 'documentos',
                label: `Documentos R2 (${clientDocs.length})`,
                icon: FolderOpen,
                disabled: !editingId,
              },
            ].map((t) => {
              const Icon = t.icon;
              const active = formTab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  disabled={t.disabled}
                  onClick={() => setFormTab(t.id as typeof formTab)}
                  className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors disabled:opacity-40 ${
                    active ? 'border-slate-900 text-slate-900 dark:border-emerald-500 dark:text-slate-100' : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {t.label}
                </button>
              );
            })}
            {!editingId && (
              <span className="ml-auto text-[11px] text-slate-400 px-2 dark:text-slate-400">
                Salve o cliente para liberar Conversas WhatsApp e Documentos R2
              </span>
            )}
          </div>

          {/* ABA 1: DADOS DO CLIENTE */}
          {formTab === 'dados' && (
            <form onSubmit={handleSaveClient} className="space-y-4">
              <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4 text-xs dark:border-slate-700 dark:bg-slate-900">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3.5">
                  <div className="lg:col-span-2">
                    <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">Código</label>
                    <input
                      type="text"
                      readOnly
                      value={editingId ? `#${editingId}` : 'Automático'}
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-slate-600 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-300"
                    />
                  </div>
                  <div className="lg:col-span-2">
                    <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">Natureza *</label>
                    <select
                      value={personNature}
                      onChange={(e) => {
                        const next = e.target.value as 'PF' | 'PJ';
                        setPersonNature(next);
                        if (cpfCnpj) setCpfCnpj(formatCpfCnpjMask(cpfCnpj, next));
                      }}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 font-semibold dark:border-slate-700"
                    >
                      <option value="PF">Pessoa Física (PF)</option>
                      <option value="PJ">Pessoa Jurídica (PJ)</option>
                    </select>
                  </div>
                  <div className="lg:col-span-5">
                    <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">
                      {personNature === 'PJ' ? 'Razão Social *' : 'Nome Completo *'}
                    </label>
                    <input
                      type="text"
                      required
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 font-semibold text-slate-900 dark:border-slate-700 dark:text-slate-100 dark:bg-slate-950"
                    />
                  </div>
                  <div className="lg:col-span-3">
                    <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">
                      {personNature === 'PJ' ? 'CNPJ' : 'CPF / CNPJ'}
                    </label>
                    <input
                      type="text"
                      value={cpfCnpj}
                      onChange={(e) => setCpfCnpj(formatCpfCnpjMask(e.target.value, personNature))}
                      placeholder={personNature === 'PJ' ? '00.000.000/0001-00' : '000.000.000-00'}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono dark:border-slate-700"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3.5">
                  <div className="lg:col-span-2">
                    <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">RG</label>
                    <input
                      type="text"
                      disabled={personNature === 'PJ'}
                      value={personNature === 'PJ' ? '' : rg}
                      onChange={(e) => setRg(e.target.value)}
                      placeholder={personNature === 'PJ' ? 'Não aplicável (PJ)' : ''}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono disabled:bg-slate-50 dark:border-slate-700"
                    />
                  </div>
                  <div className="lg:col-span-3">
                    <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">Telefone Principal</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={phone}
                        onChange={(e) => setPhone(formatPhoneMask(e.target.value))}
                        placeholder="(81) 99999-0000"
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono dark:border-slate-700"
                      />
                      <label className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 whitespace-nowrap cursor-pointer dark:text-emerald-300">
                        <input
                          type="checkbox"
                          checked={isWhatsapp}
                          onChange={(e) => setIsWhatsapp(e.target.checked)}
                        />
                        Zap
                      </label>
                    </div>
                  </div>
                  <div className="lg:col-span-3">
                    <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">Telefone Secundário</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={secondaryPhone}
                        onChange={(e) => setSecondaryPhone(formatPhoneMask(e.target.value))}
                        placeholder="(81) 3333-0000"
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono dark:border-slate-700"
                      />
                      <label className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 whitespace-nowrap cursor-pointer dark:text-emerald-300">
                        <input
                          type="checkbox"
                          checked={secondaryIsWhatsapp}
                          onChange={(e) => setSecondaryIsWhatsapp(e.target.checked)}
                        />
                        Zap
                      </label>
                    </div>
                  </div>
                  <div className="lg:col-span-2">
                    <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">Data de Nascimento</label>
                    <input
                      type="date"
                      disabled={personNature === 'PJ'}
                      value={personNature === 'PJ' ? '' : birthDate}
                      onChange={(e) => setBirthDate(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono disabled:bg-slate-50 dark:border-slate-700"
                    />
                  </div>
                  <div className="lg:col-span-2">
                    <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">Unidade</label>
                    <select
                      value={unitId}
                      onChange={(e) => setUnitId(Number(e.target.value))}
                      className="w-full rounded-lg border border-slate-200 px-2.5 py-2 font-semibold dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    >
                      {units.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.code} · {u.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3.5">
                  <div className="lg:col-span-4">
                    <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">E-mail</label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    />
                  </div>
                  <div className="lg:col-span-4">
                    <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">Profissão / Ramo</label>
                    <input
                      type="text"
                      value={profession}
                      onChange={(e) => setProfession(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    />
                  </div>
                  <div className="lg:col-span-4">
                    <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">Estado Civil</label>
                    <div className="flex gap-1.5">
                      <select
                        disabled={personNature === 'PJ'}
                        value={personNature === 'PJ' ? '' : maritalStatus}
                        onChange={(e) => setMaritalStatus(e.target.value)}
                        className="flex-1 rounded-lg border border-slate-200 px-3 py-2 disabled:bg-slate-50 dark:border-slate-700"
                      >
                        <option value="">Selecione...</option>
                        {maritalStatuses.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => setMaritalModalOpen(true)}
                        title="Gerenciar opções de Estado Civil"
                        className="rounded-lg border border-slate-200 px-2.5 py-2 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                      >
                        <Settings2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Endereço & ViaCEP */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3.5 pt-2 border-t border-slate-100 dark:border-slate-800">
                  <div className="lg:col-span-3">
                    <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">CEP (ViaCEP)</label>
                    <div className="flex gap-1.5">
                      <input
                        type="text"
                        value={zipCode}
                        onChange={(e) => setZipCode(formatCepMask(e.target.value))}
                        placeholder="50000-000"
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono dark:border-slate-700"
                      />
                      <button
                        type="button"
                        disabled={cepLoading}
                        onClick={handleLookupCep}
                        className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-semibold text-slate-700 hover:bg-slate-100 whitespace-nowrap dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-200 dark:hover:bg-slate-800"
                      >
                        {cepLoading ? '...' : 'Buscar'}
                      </button>
                    </div>
                  </div>
                  <div className="lg:col-span-5">
                    <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">Endereço / Logradouro</label>
                    <input
                      type="text"
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    />
                  </div>
                  <div className="lg:col-span-2">
                    <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">Número</label>
                    <input
                      type="text"
                      value={addressNumber}
                      onChange={(e) => setAddressNumber(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    />
                  </div>
                  <div className="lg:col-span-2">
                    <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">Complemento</label>
                    <input
                      type="text"
                      value={complement}
                      onChange={(e) => setComplement(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    />
                  </div>
                  <div className="lg:col-span-4">
                    <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">Bairro</label>
                    <input
                      type="text"
                      value={neighborhood}
                      onChange={(e) => setNeighborhood(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    />
                  </div>
                  <div className="lg:col-span-6">
                    <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">Cidade</label>
                    <input
                      type="text"
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    />
                  </div>
                  <div className="lg:col-span-2">
                    <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">UF</label>
                    <select
                      value={stateUf}
                      onChange={(e) => setStateUf(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    >
                      <option value="">UF</option>
                      {BRAZILIAN_UFS.map((uf) => (
                        <option key={uf} value={uf}>
                          {uf}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">Anotações Internas</label>
                  <textarea
                    rows={3}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Observações de atendimento, preferências de horário ou referências..."
                    className="w-full rounded-lg border border-slate-200 p-3 dark:border-slate-700"
                  />
                </div>

                <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={() => setMode('list')}
                    className="rounded-lg border border-slate-200 px-4 py-2 font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    Voltar para Grade
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-5 py-2 font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    <Save className="w-3.5 h-3.5" />
                    {saving ? 'Salvando...' : editingId ? 'Salvar Alterações' : 'Cadastrar Cliente'}
                  </button>
                </div>
              </div>

              {/* Vínculos de Admissão */}
              {editingId && (
                <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3 text-xs dark:border-slate-700 dark:bg-slate-900">
                  <div className="flex items-center justify-between">
                    <h2 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                      Vínculos em Admissão &amp; Dossiês ({clientAdmissions.length})
                    </h2>
                    <button
                      type="button"
                      onClick={() =>
                        onNavigate('admission', {
                          triggerNew: true,
                          clientId: editingId || undefined,
                          returnToModule: 'cad_clientes',
                          returnClientId: editingId || undefined,
                        })
                      }
                      className="text-xs font-semibold text-blue-700 hover:underline dark:text-blue-300"
                    >
                      + Nova Admissão
                    </button>
                  </div>
                  {clientAdmissions.length === 0 ? (
                    <p className="text-slate-500 py-2 dark:text-slate-400">Este cliente ainda não possui fichas de admissão vinculadas.</p>
                  ) : (
                    <div className="overflow-x-auto border border-slate-200 rounded-xl dark:border-slate-700">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600 dark:bg-slate-800/70 dark:border-slate-700 dark:text-slate-300">
                            <th className="py-2.5 px-3">Contrato</th>
                            <th className="py-2.5 px-3">Data</th>
                            <th className="py-2.5 px-3">Papel</th>
                            <th className="py-2.5 px-3">Outro Cliente Vinculado</th>
                            <th className="py-2.5 px-3">Status</th>
                            <th className="py-2.5 px-3 text-right">Ações</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                          {clientAdmissions.map((adm) => {
                            const isResp = adm.clientId === editingId;
                            const otherId = isResp ? adm.assetOwnerId : adm.clientId;
                            const otherClient = otherId ? allClients.find((x) => x.id === otherId) : undefined;
                            const admDocsCount = allDocs.filter((d) => d.admissionId === adm.id).length;
                            return (
                              <tr key={adm.id} className="hover:bg-slate-50 dark:hover:bg-slate-800">
                                <td className="py-2.5 px-3 font-mono font-bold text-slate-900 dark:text-slate-100">
                                  <div className="flex items-center gap-1.5">
                                    <span>{adm.series || 'ADM'} · {adm.contractNumber}</span>
                                    {admDocsCount > 0 && (
                                      <span
                                        title={`${admDocsCount} documento(s) na admissão`}
                                        className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300"
                                      >
                                        <FolderOpen className="w-3 h-3" /> {admDocsCount}
                                      </span>
                                    )}
                                  </div>
                                </td>
                                <td className="py-2.5 px-3 font-mono text-slate-500 dark:text-slate-400">{formatDateBR(adm.createdAt)}</td>
                                <td className="py-2.5 px-3 font-semibold text-slate-700 dark:text-slate-200">
                                  {isResp ? 'Responsável' : 'Titular'}
                                </td>
                                <td className="py-2.5 px-3 text-slate-600 dark:text-slate-300">{otherClient?.fullName || '—'}</td>
                                <td className="py-2.5 px-3 uppercase font-semibold text-slate-700 dark:text-slate-200">{adm.status}</td>
                                <td className="py-2.5 px-3 text-right whitespace-nowrap">
                                  <div className="inline-flex items-center gap-1.5">
                                    <button
                                      type="button"
                                      onClick={() => setViewerAdmission(adm)}
                                      className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1 font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                                    >
                                      <Eye className="w-3 h-3" /> Resumo
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        onNavigate('admission', {
                                          admissionId: adm.id,
                                          returnToModule: 'cad_clientes',
                                          returnClientId: editingId || adm.clientId,
                                        })
                                      }
                                      className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50/70 px-2.5 py-1 font-semibold text-blue-700 hover:bg-blue-100 dark:border-blue-800/70 dark:bg-blue-950/50 dark:text-blue-300 dark:hover:bg-blue-900/60"
                                    >
                                      <Pencil className="w-3 h-3" /> Abrir Admissão
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </form>
          )}

          {/* ABA 2: CONVERSAS WHATSAPP (GOTALK + UAZAPI UNIFICADAS) */}
          {formTab === 'whatsapp' && editingId && (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4 text-xs dark:border-slate-700 dark:bg-slate-900">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3 dark:border-slate-800">
                <div>
                  <h2 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                    Conversas WhatsApp · GoTalk &amp; UaZapi
                  </h2>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Atendimentos associados aos telefones do cliente neste workspace
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={waSyncing}
                    onClick={handleSyncWhatsapp}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${waSyncing ? 'animate-spin' : ''}`} />
                    Sincronizar
                  </button>
                  <button
                    type="button"
                    onClick={() => handleStartWhatsapp('gotalk')}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 font-semibold text-white hover:bg-emerald-700"
                  >
                    <PhoneCall className="w-3.5 h-3.5" /> Iniciar GoTalk
                  </button>
                  <button
                    type="button"
                    onClick={() => handleStartWhatsapp('uazapi')}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 font-semibold text-white hover:bg-slate-800 dark:bg-emerald-600 dark:hover:bg-emerald-500"
                  >
                    <MessageSquare className="w-3.5 h-3.5" /> Iniciar UaZapi
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                <div className="lg:col-span-4 border border-slate-200 rounded-xl divide-y divide-slate-100 max-h-96 overflow-y-auto dark:border-slate-700 dark:divide-slate-800">
                  {waLoading ? (
                    <div className="p-4 text-center text-slate-500 dark:text-slate-400">Buscando atendimentos...</div>
                  ) : waThreads.length === 0 ? (
                    <div className="p-4 text-center text-slate-500 dark:text-slate-400">
                      Nenhuma conversa vinculada ainda. Clique em Sincronizar ou inicie um canal acima.
                    </div>
                  ) : (
                    waThreads.map((th) => (
                      <button
                        key={th.id}
                        type="button"
                        onClick={() => setWaSelectedThread(th.id)}
                        className={`w-full text-left p-3 space-y-1 transition-colors ${
                          waSelectedThread === th.id ? 'bg-slate-900 text-white dark:bg-emerald-600' : 'hover:bg-slate-50 dark:hover:bg-slate-800'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold uppercase text-[10px]">
                            {th.provider} {th.instanceLabel ? `· ${th.instanceLabel}` : ''}
                          </span>
                          <span className="font-mono text-[10px] opacity-75">{formatDateBR(th.updatedAt)}</span>
                        </div>
                        <div className="font-semibold truncate">{th.contactName || th.contactPhone}</div>
                        <div className="text-[11px] opacity-80 truncate">{th.lastMessagePreview}</div>
                      </button>
                    ))
                  )}
                </div>

                <div className="lg:col-span-8 border border-slate-200 rounded-xl flex flex-col h-96 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/70">
                  <div className="flex-1 overflow-y-auto p-3 space-y-2">
                    {waMsgs
                      .filter((m) => waSelectedThread === 'all' || m.threadId === waSelectedThread)
                      .map((m) => {
                        const out = m.direction === 'outbound';
                        return (
                          <div key={m.id} className={`flex ${out ? 'justify-end' : 'justify-start'}`}>
                            <div
                              className={`max-w-[80%] rounded-xl px-3 py-2 space-y-1 ${
                                out ? 'bg-emerald-600 text-white' : 'bg-white border border-slate-200 text-slate-800 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-100'
                              }`}
                            >
                              <div className="flex items-center justify-between gap-3 text-[10px] opacity-80">
                                <span className="font-bold">{m.senderName}</span>
                                <span className="font-mono">{formatDateTimeBR(m.createdAt)}</span>
                              </div>
                              <p className="whitespace-pre-wrap leading-relaxed">{m.body}</p>
                            </div>
                          </div>
                        );
                      })}
                    {waMsgs.length === 0 && (
                      <div className="h-full flex items-center justify-center text-slate-400 dark:text-slate-400">
                        Nenhuma mensagem carregada.
                      </div>
                    )}
                  </div>
                  <form onSubmit={handleSendWaMessage} className="p-2.5 bg-white border-t border-slate-200 flex gap-2 dark:bg-slate-900 dark:border-slate-700">
                    <input
                      type="text"
                      disabled={waSelectedThread === 'all' || waSending}
                      value={waDraft}
                      onChange={(e) => setWaDraft(e.target.value)}
                      placeholder={
                        waSelectedThread === 'all'
                          ? 'Selecione uma conversa à esquerda para responder...'
                          : 'Escreva sua mensagem WhatsApp...'
                      }
                      className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-xs disabled:bg-slate-50 dark:border-slate-700"
                    />
                    <button
                      type="submit"
                      disabled={waSelectedThread === 'all' || waSending || !waDraft.trim()}
                      className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-4 py-2 font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
                    >
                      <Send className="w-3.5 h-3.5" /> Enviar
                    </button>
                  </form>
                </div>
              </div>
            </div>
          )}

          {/* ABA 3: DOCUMENTOS (BUCKET CLOUDFLARE R2 BUCKETDAINVICTA) */}
          {formTab === 'documentos' && editingId && (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4 text-xs dark:border-slate-700 dark:bg-slate-900">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3 dark:border-slate-800">
                <div>
                  <h2 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                    Cofre de Documentos do Cliente · bucketdainvicta
                  </h2>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Todos os anexos ficam armazenados exclusivamente no bucket privado criptografado (AES-256-GCM).
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={docCategory}
                    onChange={(e) => setDocCategory(e.target.value)}
                    className="rounded-lg border border-slate-200 px-2.5 py-2 font-semibold dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  >
                    <option value="pessoal">CNH / RG / CPF</option>
                    <option value="comprovante_residencia">Comprovante Residência</option>
                    <option value="contrato">Contrato / Financiamento</option>
                    <option value="procuracao">Procuração</option>
                    <option value="crlv">CRLV / Veículo</option>
                    <option value="outros">Outros Anexos</option>
                  </select>
                  <label className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white hover:bg-slate-800 cursor-pointer dark:bg-emerald-600 dark:hover:bg-emerald-500">
                    <Upload className="w-3.5 h-3.5" />
                    {docUploading ? 'Enviando...' : 'Anexar no Bucket R2'}
                    <input type="file" className="hidden" disabled={docUploading} onChange={handleUploadClientDoc} />
                  </label>
                </div>
              </div>

              <div className="overflow-x-auto border border-slate-200 rounded-xl dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600 dark:bg-slate-800/70 dark:border-slate-700 dark:text-slate-300">
                      <th className="py-2.5 px-3">Arquivo</th>
                      <th className="py-2.5 px-3">Categoria</th>
                      <th className="py-2.5 px-3">Tamanho</th>
                      <th className="py-2.5 px-3">Data</th>
                      <th className="py-2.5 px-3 text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {clientDocs.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-6 text-center text-slate-500 dark:text-slate-400">
                          Nenhum documento anexado para este cliente no bucketdainvicta.
                        </td>
                      </tr>
                    ) : (
                      clientDocs.map((doc) => {
                        const eff = doc.effectivePermissions || {
                          view: true,
                          print: true,
                          download: true,
                          edit: true,
                          delete: true,
                        };
                        return (
                          <tr key={doc.id} className="hover:bg-slate-50 dark:hover:bg-slate-800">
                            <td className="py-2.5 px-3">
                              <div className="font-semibold text-slate-900 dark:text-slate-100">{doc.fileName}</div>
                              <div className="font-mono text-[10px] text-slate-400 dark:text-slate-400">
                                {doc.isInterlinked || doc.unitFolderPath
                                  ? `Subpasta: ${doc.unitFolderPath || doc.folderPath}`
                                  : doc.folderPath}
                              </div>
                            </td>
                            <td className="py-2.5 px-3 font-medium text-slate-700 dark:text-slate-200">{doc.docCategory}</td>
                            <td className="py-2.5 px-3 font-mono tabular-nums">{formatBytes(doc.sizeBytes)}</td>
                            <td className="py-2.5 px-3 font-mono text-slate-500 dark:text-slate-400">{formatDateBR(doc.createdAt)}</td>
                            <td className="py-2.5 px-3 text-right whitespace-nowrap">
                              <div className="inline-flex items-center gap-1">
                                {eff.view && (
                                  <button
                                    type="button"
                                    onClick={() => handlePreviewDoc(doc)}
                                    className="rounded border border-slate-200 p-1.5 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                                    title="Pré-visualizar"
                                  >
                                    <Eye className="w-3.5 h-3.5" />
                                  </button>
                                )}
                                {eff.download && (
                                  <button
                                    type="button"
                                    onClick={() => handleDownloadDoc(doc)}
                                    className="rounded border border-slate-200 p-1.5 text-blue-700 hover:bg-blue-50 dark:border-slate-700 dark:text-blue-300 dark:hover:bg-blue-950/60"
                                    title="Baixar"
                                  >
                                    <Download className="w-3.5 h-3.5" />
                                  </button>
                                )}
                                {eff.edit && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setRenameDocTarget(doc);
                                      setRenameDocValue(doc.fileName);
                                    }}
                                    className="rounded border border-slate-200 p-1.5 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                                    title="Renomear documento"
                                  >
                                    <Pencil className="w-3.5 h-3.5" />
                                  </button>
                                )}
                                {eff.delete && (
                                  <button
                                    type="button"
                                    onClick={async () => {
                                      await apiFetch(`/api/documents/${doc.id}`, { method: 'DELETE' });
                                      setFeedback(`Arquivo "${doc.fileName}" movido para a Lixeira do bucket.`);
                                      await loadList();
                                    }}
                                    className="rounded border border-red-200 p-1.5 text-red-600 hover:bg-red-50 dark:border-red-800/70 dark:text-red-400 dark:hover:bg-red-950/60"
                                    title="Mover para lixeira"
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
            </div>
          )}
        </div>
      )}

      {/* MODAIS DE APOIO */}
      <EntityAuditModal
        open={Boolean(auditTarget)}
        title={auditTarget?.label || ''}
        entityType="client"
        entityId={auditTarget?.id || 0}
        onClose={() => setAuditTarget(null)}
      />

      <BlockClientModal
        open={Boolean(blockTarget)}
        client={blockTarget}
        isAdmin={currentUser.role === 'admin'}
        onClose={() => setBlockTarget(null)}
        onUpdated={(updated) => {
          setFeedback(`Status de "${updated.fullName}" alterado para ${updated.status.toUpperCase()}.`);
          if (editingId === updated.id) {
            setEditingClientObj({ ...editingClientObj, ...updated });
          }
          loadList();
          onCatalogUpdated?.();
        }}
      />

      <MaritalStatusModal
        open={maritalModalOpen}
        options={maritalStatuses}
        onClose={() => setMaritalModalOpen(false)}
        onUpdated={(next) => {
          onMaritalStatusesChange(next);
          onCatalogUpdated?.();
        }}
      />

      <DeleteClientModal
        open={Boolean(deleteTarget)}
        client={deleteTarget}
        clientDocs={deleteTarget ? allDocs.filter((d) => d.clientId === deleteTarget.id) : []}
        onClose={() => setDeleteTarget(null)}
        onGoToDocs={() => {
          if (deleteTarget) {
            resetForm(deleteTarget, false);
            setFormTab('documentos');
          }
        }}
        onDeleted={() => {
          setFeedback('Cliente excluído com sucesso.');
          loadList();
          onCatalogUpdated?.();
        }}
      />

      <AdmissionQuickViewerModal
        open={Boolean(viewerAdmission)}
        admission={viewerAdmission}
        units={units}
        clients={allClients}
        onClose={() => setViewerAdmission(null)}
        onOpenInAdmissionModule={(admissionId) =>
          onNavigate('admission', {
            admissionId,
            returnToModule: 'cad_clientes',
            returnClientId: editingId || viewerAdmission?.clientId,
          })
        }
      />

      <ProtectedDocumentViewerModal
        open={Boolean(viewerDoc)}
        documentId={viewerDoc?.id || null}
        fileName={viewerDoc?.fileName || ''}
        mimeType={viewerDoc?.mimeType || ''}
        subtitle={
          viewerDoc
            ? `${viewerDoc.unitFolderPath || viewerDoc.folderPath || 'bucketdainvicta'} · ${formatBytes(viewerDoc.sizeBytes)}`
            : ''
        }
        context="client_dossier"
        canPrint={viewerDoc ? viewerDoc.effectivePermissions?.print !== false : false}
        canDownload={viewerDoc ? viewerDoc.effectivePermissions?.download !== false : false}
        onClose={() => setViewerDoc(null)}
      />

      {renameDocTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 dark:bg-slate-950/80">
          <form
            onSubmit={handleRenameDocSubmit}
            className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 shadow-2xl space-y-4 text-xs"
          >
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                Renomear Documento do Cliente
              </div>
              <button
                type="button"
                onClick={() => setRenameDocTarget(null)}
                className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-200 mb-1">
                Nome do Arquivo *
              </label>
              <input
                type="text"
                required
                value={renameDocValue}
                onChange={(e) => setRenameDocValue(e.target.value)}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-slate-900 dark:text-slate-100"
              />
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 dark:border-slate-800 pt-3">
              <button
                type="button"
                onClick={() => setRenameDocTarget(null)}
                className="rounded-lg border border-slate-200 dark:border-slate-700 px-3.5 py-2 font-semibold text-slate-700 dark:text-slate-200"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={renamingDoc || !renameDocValue.trim()}
                className="rounded-lg bg-slate-900 dark:bg-emerald-600 px-4 py-2 font-semibold text-white hover:bg-slate-800 dark:hover:bg-emerald-500 disabled:opacity-50"
              >
                {renamingDoc ? 'Salvando...' : 'Salvar Nome'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
