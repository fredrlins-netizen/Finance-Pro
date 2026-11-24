import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  Banknote,
  Bot,
  CheckCircle2,
  ClipboardCheck,
  Database,
  FileSearch,
  FileText,
  History,
  Loader2,
  Lock,
  MessageSquarePlus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  ShieldAlert,
  User,
  X,
} from 'lucide-react';
import { apiFetch, formatBRL, formatDateBR, formatDateTimeBR, getAuthToken } from '../../lib/api.ts';
import type { FormMergeContext } from '../../lib/formTemplateRenderer.ts';
import { FormTemplateButton } from '../FormTemplateButton.tsx';
import {
  Admission,
  AuditChecklistItem,
  AuditLogEntry,
  AuthUser,
  Client,
  DocumentObject,
  FinancialTitle,
  IviAuditAnalysisSnapshot,
  IviAuditInsightsPayload,
  LegalMovement,
  LegalProcess,
  ModuleId,
  NavigationIntent,
  RecalcScenario,
  Unit,
} from '../../types.ts';
import { CollapsibleFilterBar } from '../CollapsibleFilterBar.tsx';
import { AuditIviCopilot } from './audit/AuditIviCopilot.tsx';
import { AuditDocumentWorkspace } from './audit/AuditDocumentWorkspace.tsx';
import { AuditDossierSummaryTab } from './audit/AuditDossierSummaryTab.tsx';
import { AuditBoletosTab } from './audit/AuditBoletosTab.tsx';
import { AuditIviInsightsPanel } from './audit/AuditIviInsightsPanel.tsx';
import { EntityAuditModal } from './cadastros/CadastrosShared.tsx';

interface AuditModuleProps {
  units: Unit[];
  currentUser?: AuthUser | null;
  wsTick?: number;
  navIntent?: NavigationIntent | null;
  onClearIntent?: () => void;
  onNavigate?: (mod: ModuleId, intent?: NavigationIntent) => void;
}

interface AuditContextResponse {
  admission: Admission;
  client: Client | null;
  titular: Client | null;
  unit: Unit | null;
  documents: DocumentObject[];
  titles: FinancialTitle[];
  recalcScenarios: RecalcScenario[];
  legalProcesses: LegalProcess[];
  legalMovements: LegalMovement[];
  auditLogs: AuditLogEntry[];
  checklistItems: AuditChecklistItem[];
}

type AuditTabId = 'conferencia' | 'documentos' | 'ficha' | 'boletos';

const STATUS_DISPLAY: Record<string, { label: string; tone: string }> = {
  aguardando_auditoria: { label: 'Aguardando Auditoria', tone: 'text-amber-700 dark:text-amber-300' },
  auditada: { label: 'Em Análise (Salva)', tone: 'text-blue-700 dark:text-blue-300' },
  devolvida_admissao: { label: 'Devolvida à Admissão', tone: 'text-red-700 dark:text-red-300' },
  retorno_auditoria: { label: 'Retorno Comercial', tone: 'text-red-700 dark:text-red-300' },
  aprovada: { label: 'Aprovada', tone: 'text-emerald-700 dark:text-emerald-300' },
  em_andamento: { label: 'Em Andamento', tone: 'text-emerald-700 dark:text-emerald-300' },
  concluido: { label: 'Concluída', tone: 'text-emerald-700 dark:text-emerald-300' },
};

export const AuditModule: React.FC<AuditModuleProps> = ({
  units,
  currentUser,
  wsTick = 0,
  navIntent,
  onClearIntent,
  onNavigate,
}) => {
  const [admissions, setAdmissions] = useState<Admission[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [documents, setDocuments] = useState<DocumentObject[]>([]);
  const [checklistItems, setChecklistItems] = useState<AuditChecklistItem[]>([]);

  // Active client modal ID (when non-null, opens dedicated Audit Screen + marks activeReviewerName in Data Grid)
  const [selectedAdmissionId, setSelectedAdmissionId] = useState<number | null>(null);
  const [modalAdmissionId, setModalAdmissionId] = useState<number | null>(null);
  const modalAdmissionIdRef = useRef<number | null>(null);
  modalAdmissionIdRef.current = modalAdmissionId;

  // Active dossier deep context from GET /api/audit/:id/context
  const [contextData, setContextData] = useState<AuditContextResponse | null>(null);
  const [loadingContext, setLoadingContext] = useState(false);

  // Data Grid Filters & Pagination (default = 'all' to present ALL clients in Audit)
  const [unitFilter, setUnitFilter] = useState('all');
  const [periodFilter, setPeriodFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [pageSize, setPageSize] = useState(20);
  const [currentPage, setCurrentPage] = useState(1);

  // Batch Ivi Checklist Sweep & DB Cache Stats (minimizes AI API costs)
  const [sweepBusy, setSweepBusy] = useState(false);
  const [cacheStats, setCacheStats] = useState<{ cachedDecisions: number; totalAiCallsSaved: number }>({
    cachedDecisions: 0,
    totalAiCallsSaved: 0,
  });
  const autoSweptRef = useRef(false);

  // Workspace state inside Client Modal
  const [activeTab, setActiveTab] = useState<AuditTabId>('conferencia');
  const [checkedIds, setCheckedIds] = useState<Record<string, boolean>>({});
  const [manualNotes, setManualNotes] = useState('');
  const [isElectricVehicle, setIsElectricVehicle] = useState(false);
  const [boletoProvider, setBoletoProvider] = useState('santander');
  const [hasSearchSeizure, setHasSearchSeizure] = useState(false);
  const [notifyDepartments, setNotifyDepartments] = useState(true);

  const [feedback, setFeedback] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [busy, setBusy] = useState(false);

  // Accessible inline confirmation modals
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [confirmApproveModal, setConfirmApproveModal] = useState<{
    pendingChecklistCount: number;
    electricWarning: boolean;
  } | null>(null);

  // Painel de Insights Ivi (lateral or modal inside Client Audit Modal)
  const [selectedDocId, setSelectedDocId] = useState<number | null>(null);
  const [insightsOpen, setInsightsOpen] = useState(true);
  const [insightsMode, setInsightsMode] = useState<'lateral' | 'modal'>('lateral');
  const [insightsByKey, setInsightsByKey] = useState<Record<string, IviAuditInsightsPayload>>({});
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsError, setInsightsError] = useState('');
  const insightsSeqRef = useRef(0);
  const checkedIdsRef = useRef<Record<string, boolean>>(checkedIds);
  checkedIdsRef.current = checkedIds;

  // Quick inline considerations & Ivi re-check directly in Data Grid
  const [inlineNoteAdmissionId, setInlineNoteAdmissionId] = useState<number | null>(null);
  const [inlineNoteText, setInlineNoteText] = useState('');
  const [inlineNoteSaving, setInlineNoteSaving] = useState(false);
  const [inlineIviBusyId, setInlineIviBusyId] = useState<number | null>(null);
  const [auditModalTarget, setAuditModalTarget] = useState<{
    title: string;
    entityType: string;
    entityId: number | string;
  } | null>(null);

  const loadCacheStats = useCallback(async () => {
    try {
      const stats = await apiFetch<{ cachedDecisions: number; totalAiCallsSaved: number }>(
        '/api/audit/cache-stats'
      );
      setCacheStats(stats);
    } catch {
      // silent
    }
  }, []);

  const loadList = useCallback(async () => {
    const [data, checklistRes] = await Promise.all([
      apiFetch<{
        admissions: Admission[];
        clients: Client[];
        documents: DocumentObject[];
      }>('/api/clients'),
      apiFetch<{ items: AuditChecklistItem[] }>('/api/audit-checklist').catch(() => ({
        items: [] as AuditChecklistItem[],
      })),
    ]);
    setAdmissions(data.admissions);
    setClients(data.clients);
    setDocuments(data.documents || []);
    if (checklistRes.items?.length) setChecklistItems(checklistRes.items);
  }, []);

  const loadActiveContext = useCallback(async (admissionId: number) => {
    setLoadingContext(true);
    try {
      const ctx = await apiFetch<AuditContextResponse>(`/api/audit/${admissionId}/context`);
      setContextData(ctx);
      if (ctx.checklistItems?.length) setChecklistItems(ctx.checklistItems);
      setCheckedIds(ctx.admission.auditChecklistStateJson || {});
      setManualNotes(ctx.admission.auditManualNotes || '');
      setIsElectricVehicle(Boolean(ctx.admission.isElectricVehicle));
      setHasSearchSeizure(Boolean(ctx.admission.escavadorAlert));
    } catch {
      setContextData(null);
    } finally {
      setLoadingContext(false);
    }
  }, []);

  const runIviSweepAll = useCallback(
    async (onlyMissing: boolean, silent = false) => {
      if (!silent) setSweepBusy(true);
      try {
        const res = await apiFetch<{
          sweptCount: number;
          cacheHits: number;
          newlyEvaluated: number;
          totalAiCallsSaved: number;
        }>('/api/audit/ivi-sweep-all', {
          method: 'POST',
          body: JSON.stringify({ onlyMissing }),
        });
        await Promise.all([loadList(), loadCacheStats()]);
        if (!silent) {
          setFeedback(
            `Varredura Ivi concluída em ${res.sweptCount} ficha(s) com zero custo de IA externa: ${res.cacheHits} recuperada(s) da base de dados e ${res.newlyEvaluated} avaliada(s) e gravada(s). Total de chamadas IA economizadas: ${res.totalAiCallsSaved}.`
          );
        }
      } catch (err) {
        if (!silent) {
          setErrorMsg(
            err instanceof Error ? err.message : 'Erro ao executar varredura do checklist pela Ivi.'
          );
        }
      } finally {
        if (!silent) setSweepBusy(false);
      }
    },
    [loadList, loadCacheStats]
  );

  // Initial load
  useEffect(() => {
    loadList();
    loadCacheStats();
  }, [loadList, loadCacheStats]);

  // Automatic zero-cost background checklist sweep for admissions without DB checklist verification
  useEffect(() => {
    if (autoSweptRef.current || admissions.length === 0) return;
    autoSweptRef.current = true;
    const hasMissing = admissions.some(
      (a) => !a.iviAuditAnalysisJson?.checklistItemsChecked?.length
    );
    if (hasMissing) {
      runIviSweepAll(true, true);
    }
  }, [admissions, runIviSweepAll]);

  // Real-time WebSocket refresh (shows locks / updates across users)
  useEffect(() => {
    if (wsTick > 0) {
      loadList();
      loadCacheStats();
      if (modalAdmissionIdRef.current) {
        loadActiveContext(modalAdmissionIdRef.current);
      }
    }
  }, [wsTick, loadList, loadCacheStats, loadActiveContext]);

  // Lock & open dedicated Client Audit Modal
  const openClientAuditModal = useCallback(
    async (admissionId: number, initialTab: AuditTabId = 'conferencia') => {
      const prevOpen = modalAdmissionIdRef.current;
      if (prevOpen && prevOpen !== admissionId) {
        apiFetch(`/api/audit/${prevOpen}/unlock`, { method: 'POST' }).catch(() => {});
      }

      const reviewerLabel = currentUser?.name || currentUser?.email || 'Auditor';
      setSelectedAdmissionId(admissionId);
      setModalAdmissionId(admissionId);
      setActiveTab(initialTab);
      setErrorMsg('');

      setAdmissions((prev) =>
        prev.map((a) =>
          a.id === admissionId
            ? {
                ...a,
                activeReviewerId: currentUser?.id ?? null,
                activeReviewerName: reviewerLabel,
                activeReviewerSince: new Date().toISOString(),
              }
            : a
        )
      );

      try {
        await apiFetch(`/api/audit/${admissionId}/lock`, { method: 'POST' });
      } catch {
        // non-blocking
      }
      await loadActiveContext(admissionId);
    },
    [currentUser, loadActiveContext]
  );

  // Unlock & close Client Audit Modal
  const closeClientAuditModal = useCallback(async () => {
    const closingId = modalAdmissionIdRef.current;
    setModalAdmissionId(null);
    setConfirmApproveModal(null);
    setRejectModalOpen(false);
    if (!closingId) return;

    setAdmissions((prev) =>
      prev.map((a) =>
        a.id === closingId
          ? { ...a, activeReviewerId: null, activeReviewerName: '', activeReviewerSince: null }
          : a
      )
    );
    try {
      await apiFetch(`/api/audit/${closingId}/unlock`, { method: 'POST' });
    } catch {
      // non-blocking
    }
    await loadList();
  }, [loadList]);

  // Escape key closes inner modals first, then Client Audit Modal
  useEffect(() => {
    if (!modalAdmissionId) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (rejectModalOpen) {
        setRejectModalOpen(false);
      } else if (confirmApproveModal) {
        setConfirmApproveModal(null);
      } else if (insightsOpen && insightsMode === 'modal') {
        setInsightsMode('lateral');
      } else {
        closeClientAuditModal();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    modalAdmissionId,
    rejectModalOpen,
    confirmApproveModal,
    insightsOpen,
    insightsMode,
    closeClientAuditModal,
  ]);

  // Release lock cleanly on unmount or tab unload
  useEffect(() => {
    const sendUnlockBeacon = () => {
      const openId = modalAdmissionIdRef.current;
      if (!openId) return;
      const token = getAuthToken();
      fetch(`/api/audit/${openId}/unlock`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        keepalive: true,
      }).catch(() => {});
    };
    window.addEventListener('beforeunload', sendUnlockBeacon);
    return () => {
      window.removeEventListener('beforeunload', sendUnlockBeacon);
      sendUnlockBeacon();
    };
  }, []);

  // Navigation intent directly opens the requested client's Audit Modal
  useEffect(() => {
    if (navIntent?.admissionId) {
      setStatusFilter('all');
      openClientAuditModal(
        navIntent.admissionId,
        navIntent.tab === 'documentos' ? 'documentos' : 'conferencia'
      );
      onClearIntent?.();
    } else if (navIntent?.clientId && admissions.length > 0) {
      const match = admissions.find((a) => a.clientId === navIntent.clientId);
      if (match) {
        setStatusFilter('all');
        openClientAuditModal(
          match.id,
          navIntent.tab === 'documentos' ? 'documentos' : 'conferencia'
        );
      }
      onClearIntent?.();
    }
  }, [navIntent, admissions, onClearIntent, openClientAuditModal]);

  // Reset pagination whenever filters/search change
  useEffect(() => {
    setCurrentPage(1);
  }, [unitFilter, periodFilter, searchQuery, statusFilter, pageSize]);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return admissions.filter((a) => {
      if (unitFilter !== 'all' && String(a.unitId) !== unitFilter) return false;
      if (periodFilter === '7d' || periodFilter === '30d') {
        const days = periodFilter === '7d' ? 7 : 30;
        const diffDays = (Date.now() - new Date(a.createdAt).getTime()) / 86400000;
        if (diffDays > days) return false;
      }
      if (statusFilter === 'pendentes') {
        if (!['aguardando_auditoria', 'auditada', 'devolvida_admissao', 'retorno_auditoria'].includes(a.status)) {
          return false;
        }
      } else if (statusFilter === 'devolvidas') {
        if (!['devolvida_admissao', 'retorno_auditoria'].includes(a.status)) return false;
      } else if (statusFilter === 'aprovada') {
        if (!['aprovada', 'em_andamento', 'concluido'].includes(a.status)) return false;
      } else if (statusFilter !== 'all' && a.status !== statusFilter) {
        return false;
      }
      if (q) {
        const c = clients.find((cl) => cl.id === a.clientId);
        const match =
          a.protocolCode.toLowerCase().includes(q) ||
          a.contractNumber.toLowerCase().includes(q) ||
          a.bankName.toLowerCase().includes(q) ||
          (c?.fullName || '').toLowerCase().includes(q) ||
          (c?.cpfCnpj || '').toLowerCase().includes(q) ||
          (a.activeReviewerName || '').toLowerCase().includes(q);
        if (!match) return false;
      }
      return true;
    });
  }, [admissions, clients, unitFilter, periodFilter, statusFilter, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const pagedQueue = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, safePage, pageSize]);

  const activeAdmission = useMemo(() => {
    if (!modalAdmissionId) return null;
    if (contextData?.admission && contextData.admission.id === modalAdmissionId) {
      return contextData.admission;
    }
    return admissions.find((a) => a.id === modalAdmissionId) || null;
  }, [modalAdmissionId, contextData, admissions]);

  const activeClient = useMemo(() => {
    if (!activeAdmission) return null;
    if (contextData?.client && contextData.admission.id === activeAdmission.id) {
      return contextData.client;
    }
    return clients.find((c) => c.id === activeAdmission.clientId) || null;
  }, [contextData, activeAdmission, clients]);

  const activeTitular = useMemo(() => {
    if (!activeAdmission) return null;
    if (contextData?.titular && contextData.admission.id === activeAdmission.id) {
      return contextData.titular;
    }
    return activeAdmission.assetOwnerId
      ? clients.find((c) => c.id === activeAdmission.assetOwnerId) || null
      : null;
  }, [contextData, activeAdmission, clients]);

  const activeUnit = activeAdmission
    ? contextData?.unit || units.find((u) => u.id === activeAdmission.unitId) || null
    : null;

  const activeDocs = useMemo(() => {
    if (!activeAdmission) return [];
    if (contextData?.admission.id === activeAdmission.id) return contextData.documents;
    return documents.filter(
      (d) => d.admissionId === activeAdmission.id || d.clientId === activeAdmission.clientId
    );
  }, [activeAdmission, contextData, documents]);

  const applicableChecklist = useMemo(() => {
    if (!activeAdmission) return [];
    const modText = `${activeAdmission.modality || ''} ${activeAdmission.debtType || ''}`.toLowerCase();
    return checklistItems.filter((item) => {
      if (!item.active) return false;
      const cond = (item.modalityCondition || '').trim().toLowerCase();
      if (!cond) return true;
      return modText.includes(cond);
    });
  }, [activeAdmission, checklistItems]);

  const checkedCount = useMemo(
    () => applicableChecklist.filter((item) => Boolean(checkedIds[String(item.id)])).length,
    [applicableChecklist, checkedIds]
  );

  // Sync selectedDocId cleanly when active dossier/documents change
  useEffect(() => {
    if (!activeAdmission) {
      setSelectedDocId(null);
      return;
    }
    if (activeDocs.length === 0) {
      setSelectedDocId(null);
      return;
    }
    setSelectedDocId((prev) =>
      prev && activeDocs.some((d) => d.id === prev) ? prev : activeDocs[0].id
    );
  }, [activeAdmission?.id, activeDocs]);

  const fetchIviInsights = useCallback(
    async (admissionId: number, docId: number | null, forceAi = false) => {
      const cacheKey = `${admissionId}:${docId ?? 'none'}`;
      if (!forceAi && insightsByKey[cacheKey]) {
        setInsightsError('');
        return;
      }
      const seq = ++insightsSeqRef.current;
      setInsightsLoading(true);
      setInsightsError('');
      try {
        const res = await apiFetch<{ insights: IviAuditInsightsPayload }>(
          `/api/audit/${admissionId}/ivi-insights`,
          {
            method: 'POST',
            body: JSON.stringify({
              documentId: docId,
              checklistState: checkedIdsRef.current,
              forceAi,
            }),
          }
        );
        if (seq !== insightsSeqRef.current) return;
        setInsightsByKey((prev) => ({ ...prev, [cacheKey]: res.insights }));
        loadCacheStats();
      } catch (err) {
        if (seq !== insightsSeqRef.current) return;
        setInsightsError(
          err instanceof Error
            ? err.message
            : 'Não foi possível gerar os insights automáticos da Ivi.'
        );
      } finally {
        if (seq === insightsSeqRef.current) {
          setInsightsLoading(false);
        }
      }
    },
    [insightsByKey, loadCacheStats]
  );

  const invalidateInsightsForAdmission = useCallback((admissionId: number) => {
    setInsightsByKey((prev) => {
      const next: Record<string, IviAuditInsightsPayload> = {};
      const prefix = `${admissionId}:`;
      for (const [k, v] of Object.entries(prev)) {
        if (!k.startsWith(prefix)) next[k] = v;
      }
      return next;
    });
  }, []);

  // Automatically load DB-cached / rule-based Insights Ivi when modal is open & panel active
  useEffect(() => {
    if (!modalAdmissionId || !insightsOpen || !activeAdmission) return;
    if (contextData?.admission.id !== activeAdmission.id) return;
    const validDocId =
      selectedDocId && activeDocs.some((d) => d.id === selectedDocId)
        ? selectedDocId
        : activeDocs[0]?.id ?? null;
    fetchIviInsights(activeAdmission.id, validDocId, false);
  }, [
    modalAdmissionId,
    insightsOpen,
    activeAdmission?.id,
    contextData?.admission.id,
    selectedDocId,
    activeDocs,
    fetchIviInsights,
  ]);

  const activeInsightsKey = activeAdmission
    ? `${activeAdmission.id}:${selectedDocId ?? 'none'}`
    : '';
  const activeInsights = activeInsightsKey ? insightsByKey[activeInsightsKey] || null : null;

  // Actions inside Dedicated Modal
  const handleSaveProgress = async (nextStatus: 'aguardando_auditoria' | 'auditada' = 'auditada') => {
    if (!activeAdmission) return;
    setBusy(true);
    setErrorMsg('');
    setFeedback('');
    try {
      await apiFetch(`/api/audit/${activeAdmission.id}/progress`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: nextStatus,
          checklistState: checkedIds,
          auditManualNotes: manualNotes,
          isElectricVehicle,
          escavadorAlert: hasSearchSeizure,
        }),
      });
      setFeedback(
        `Progresso salvo no banco para ${activeAdmission.protocolCode} (${checkedCount}/${applicableChecklist.length} itens marcados, parecer preservado).`
      );
      invalidateInsightsForAdmission(activeAdmission.id);
      await Promise.all([loadList(), loadActiveContext(activeAdmission.id)]);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao salvar progresso da auditoria.');
    } finally {
      setBusy(false);
    }
  };

  const executeApprove = async (forceElectricOverride = false) => {
    if (!activeAdmission) return;
    setBusy(true);
    setErrorMsg('');
    setFeedback('');
    try {
      const res = await apiFetch<{
        legalProcess: { processNumber: string };
        generatedNow: number;
      }>(`/api/audit/${activeAdmission.id}/approve`, {
        method: 'POST',
        body: JSON.stringify({
          boletoProvider,
          hasSearchSeizure,
          checklistState: checkedIds,
          auditManualNotes: manualNotes,
          isElectricVehicle,
          forceElectricOverride,
          notifyDepartments,
        }),
      });
      setConfirmApproveModal(null);
      setFeedback(
        res.generatedNow > 0
          ? `Dossiê ${activeAdmission.protocolCode} aprovado! ${res.generatedNow} boleto(s) inicial(is) emitido(s) (${boletoProvider.toUpperCase()}) e roteado ao Jurídico (${res.legalProcess.processNumber}).`
          : `Dossiê ${activeAdmission.protocolCode} aprovado mantendo os boletos já lançados! Roteado ao Jurídico (${res.legalProcess.processNumber}).`
      );
      invalidateInsightsForAdmission(activeAdmission.id);
      await Promise.all([loadList(), loadActiveContext(activeAdmission.id)]);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao aprovar auditoria.');
    } finally {
      setBusy(false);
    }
  };

  const handleRequestApprove = () => {
    if (!activeAdmission) return;
    const pendingChecklistCount = Math.max(0, applicableChecklist.length - checkedCount);
    if (pendingChecklistCount > 0 || isElectricVehicle) {
      setConfirmApproveModal({
        pendingChecklistCount,
        electricWarning: isElectricVehicle,
      });
      return;
    }
    executeApprove(false);
  };

  const handleConfirmReject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeAdmission || !rejectReason.trim()) return;
    setBusy(true);
    setErrorMsg('');
    setFeedback('');
    try {
      await apiFetch(`/api/audit/${activeAdmission.id}/reject`, {
        method: 'POST',
        body: JSON.stringify({
          reason: rejectReason.trim(),
          checklistState: checkedIds,
          auditManualNotes: manualNotes,
        }),
      });
      setFeedback(
        `Dossiê ${activeAdmission.protocolCode} devolvido para Admissão/Comercial com crítica registrada.`
      );
      setRejectModalOpen(false);
      setRejectReason('');
      invalidateInsightsForAdmission(activeAdmission.id);
      await Promise.all([loadList(), loadActiveContext(activeAdmission.id)]);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao devolver dossiê.');
    } finally {
      setBusy(false);
    }
  };

  const handleIviAnalysisUpdated = (analysis: IviAuditAnalysisSnapshot) => {
    setContextData((prev) =>
      prev ? { ...prev, admission: { ...prev.admission, iviAuditAnalysisJson: analysis } } : prev
    );
    setAdmissions((prev) =>
      prev.map((a) =>
        a.id === activeAdmission?.id ? { ...a, iviAuditAnalysisJson: analysis } : a
      )
    );
    loadCacheStats();
  };

  const openRejectWithDraft = (draft: string) => {
    setRejectReason(draft);
    setRejectModalOpen(true);
  };

  const handleQuickSaveConsideration = async (admissionId: number) => {
    const clean = inlineNoteText.trim();
    if (!clean) return;
    setInlineNoteSaving(true);
    setErrorMsg('');
    setFeedback('');
    try {
      const res = await apiFetch<{
        admission: Admission;
        consideration: { authorName: string; createdAt: string };
      }>(`/api/audit/${admissionId}/considerations`, {
        method: 'POST',
        body: JSON.stringify({ text: clean }),
      });
      if (activeAdmission?.id === admissionId) {
        setManualNotes(clean);
      }
      setInlineNoteAdmissionId(null);
      setInlineNoteText('');
      invalidateInsightsForAdmission(admissionId);
      setFeedback(
        `Consideração registrada por ${res.consideration.authorName} em ${formatDateTimeBR(res.consideration.createdAt)}.`
      );
      await Promise.all([
        loadList(),
        activeAdmission?.id === admissionId ? loadActiveContext(admissionId) : Promise.resolve(),
      ]);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao registrar consideração.');
    } finally {
      setInlineNoteSaving(false);
    }
  };

  const handleQuickRunIvi = async (admissionId: number) => {
    setInlineIviBusyId(admissionId);
    setErrorMsg('');
    setSelectedAdmissionId(admissionId);
    try {
      await apiFetch(`/api/audit/${admissionId}/ivi-analyze`, {
        method: 'POST',
        body: JSON.stringify({ forceAi: false }),
      });
      invalidateInsightsForAdmission(admissionId);
      await Promise.all([loadList(), loadCacheStats()]);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao executar verificação da Ivi.');
    } finally {
      setInlineIviBusyId(null);
    }
  };

  // KPIs
  const pendingCount = admissions.filter(
    (a) => a.status === 'aguardando_auditoria' || a.status === 'auditada'
  ).length;
  const returnedOpenCount = admissions.filter(
    (a) => a.status === 'devolvida_admissao' || a.status === 'retorno_auditoria'
  ).length;
  const totalAudited = admissions.filter((a) =>
    ['aprovada', 'em_andamento', 'concluido'].includes(a.status)
  ).length;
  const totalInconsistencies = useMemo(
    () =>
      admissions.reduce(
        (acc, a) => acc + (a.iviAuditAnalysisJson?.inconsistenciesCount || 0),
        0
      ),
    [admissions]
  );

  const canDecide =
    activeAdmission &&
    ['aguardando_auditoria', 'auditada', 'devolvida_admissao', 'retorno_auditoria'].includes(
      activeAdmission.status
    );

  const activeStatusDisplay = activeAdmission
    ? STATUS_DISPLAY[activeAdmission.status] || { label: activeAdmission.status, tone: 'text-slate-700 dark:text-slate-200' }
    : null;

  const showLateralInsights = Boolean(
    activeAdmission && insightsOpen && insightsMode === 'lateral'
  );

  return (
    <div className="space-y-5">
      {/* Header & Queue Status Filter Tabs (default = Todos em Auditoria) */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-3 border-b border-slate-200 pb-4 dark:border-slate-700">
        <div>
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Varredura Automática de Checklist em Base · Conferência Documental em Tela Dedicada · Emissão de Boletos
          </p>
          <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Auditoria &amp; Validação de Fichas
          </h1>
        </div>

        <div
          role="tablist"
          aria-label="Filtrar Data Grid de auditoria"
          className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto dark:bg-slate-800"
        >
          {[
            { id: 'all', label: `Todos em Auditoria (${admissions.length})` },
            { id: 'pendentes', label: `Pendentes (${pendingCount + returnedOpenCount})` },
            { id: 'auditada', label: 'Em Análise' },
            { id: 'devolvidas', label: `Devolvidas (${returnedOpenCount})` },
            { id: 'aprovada', label: `Aprovadas (${totalAudited})` },
          ].map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={statusFilter === t.id}
              type="button"
              onClick={() => setStatusFilter(t.id)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md whitespace-nowrap shrink-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                statusFilter === t.id
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-slate-100'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <CollapsibleFilterBar
        units={units}
        selectedUnitId={unitFilter}
        onUnitChange={setUnitFilter}
        period={periodFilter}
        onPeriodChange={setPeriodFilter}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        extraStatuses={[
          { value: 'pendentes', label: 'Aguardando / Em Análise / Devolvidas' },
          { value: 'aguardando_auditoria', label: 'Aguardando Auditoria' },
          { value: 'auditada', label: 'Em Análise (Progresso Salvo)' },
          { value: 'devolvidas', label: 'Devolvidas à Admissão' },
          { value: 'aprovada', label: 'Aprovadas / Roteadas' },
        ]}
        selectedStatus={statusFilter}
        onStatusChange={setStatusFilter}
      />

      {feedback && (
        <div
          role="status"
          className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-medium text-emerald-900 flex items-center justify-between gap-2 dark:border-emerald-800/70 dark:bg-emerald-950/50 dark:text-emerald-300"
        >
          <span>{feedback}</span>
          <button
            type="button"
            onClick={() => setFeedback('')}
            aria-label="Dispensar aviso"
            className="text-emerald-700 hover:text-emerald-900 dark:text-emerald-300 dark:hover:text-emerald-200"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      {errorMsg && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-medium text-red-900 flex items-center justify-between gap-2 dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300"
        >
          <span>{errorMsg}</span>
          <button
            type="button"
            onClick={() => setErrorMsg('')}
            aria-label="Dispensar erro"
            className="text-red-700 hover:text-red-900 dark:text-red-300 dark:hover:text-red-200"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
          <div className="text-xs text-slate-500 font-medium dark:text-slate-400">Aguardando / Em Análise</div>
          <div className="mt-1 font-mono text-2xl font-bold text-amber-700 tabular-nums dark:text-amber-300">
            {pendingCount}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
          <div className="text-xs text-slate-500 font-medium dark:text-slate-400">Inconsistências Ivi (Base)</div>
          <div className="mt-1 font-mono text-2xl font-bold text-red-700 tabular-nums dark:text-red-300">
            {totalInconsistencies}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
          <div className="text-xs text-slate-500 font-medium dark:text-slate-400">Auditorias Aprovadas</div>
          <div className="mt-1 font-mono text-2xl font-bold text-emerald-700 tabular-nums dark:text-emerald-300">
            {totalAudited}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
          <div className="text-xs text-slate-500 font-medium dark:text-slate-400">Economia IA (Base de Dados)</div>
          <div className="mt-1 font-mono text-2xl font-bold text-slate-900 tabular-nums dark:text-slate-100">
            {cacheStats.totalAiCallsSaved}
          </div>
          <div className="text-[11px] text-slate-500 font-mono tabular-nums dark:text-slate-400">
            {cacheStats.cachedDecisions} decisão(ões) gravada(s)
          </div>
        </div>
      </div>

      {/* DATA GRID: TODOS OS CLIENTES EM AUDITORIA (3 Containers Horizontais + Ação para Modal Específico) */}
      <section
        aria-label="Data Grid de Clientes em Auditoria"
        className="rounded-xl border border-slate-200 bg-white overflow-hidden dark:border-slate-700 dark:bg-slate-900"
      >
        <div className="px-4 py-3 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2.5 text-xs dark:border-slate-700">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-bold text-slate-900 dark:text-slate-100">
              Data Grid · Clientes em Auditoria ({filtered.length})
            </span>
            <span className="text-slate-300 dark:text-slate-600">·</span>
            <span className="inline-flex items-center gap-1 text-slate-600 font-mono text-[11px] dark:text-slate-300">
              <Database className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-300" />
              Decisões salvas em base local ({cacheStats.cachedDecisions}) · Zero custo IA na varredura
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() =>
                setAuditModalTarget({
                  title: 'Auditoria & Validação de Fichas · Setor Completo',
                  entityType: 'admissions,document_objects',
                  entityId: 'all',
                })
              }
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap min-h-[36px] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <History className="w-3.5 h-3.5" />
              Auditoria do Setor
            </button>
            <button
              type="button"
              disabled={sweepBusy}
              onClick={() => runIviSweepAll(false, false)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap min-h-[36px] dark:border-slate-700 dark:bg-emerald-600 dark:hover:bg-emerald-500"
            >
              {sweepBusy ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5" />
              )}
              {sweepBusy ? 'Varrendo base...' : 'Varrer Checklist Ivi (Todos)'}
            </button>
            <select
              aria-label="Quantidade por página"
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 min-h-[36px] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            >
              <option value={10}>10 / pág</option>
              <option value={20}>20 / pág</option>
              <option value={50}>50 / pág</option>
              <option value={100}>100 / pág</option>
            </select>
          </div>
        </div>

        {/* Column Header Bar */}
        <div className="hidden md:flex items-center gap-4 px-4 py-2 bg-slate-50 border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:bg-slate-800/70 dark:border-slate-700 dark:text-slate-400">
          <div className="md:w-60 lg:w-64 shrink-0">Dados do Cliente</div>
          <div className="md:w-48 lg:w-52 shrink-0 pl-4">Situação, Valor &amp; Status</div>
          <div className="flex-1 min-w-0 pl-4">Verificação Checklist Ivi &amp; Considerações</div>
          <div className="w-36 shrink-0 text-right">Auditoria</div>
        </div>

        {pagedQueue.length === 0 ? (
          <div className="p-8 text-center space-y-2 text-xs text-slate-500 dark:text-slate-400">
            <p>Nenhum cliente encontrado no filtro atual.</p>
            {statusFilter !== 'all' && (
              <button
                type="button"
                onClick={() => {
                  setStatusFilter('all');
                  setSearchQuery('');
                }}
                className="font-semibold text-blue-700 hover:underline dark:text-blue-300"
              >
                Exibir todos os clientes em Auditoria ({admissions.length})
              </button>
            )}
          </div>
        ) : (
          <div className="divide-y divide-slate-200 dark:divide-slate-700">
            {pagedQueue.map((adm) => {
              const client = clients.find((c) => c.id === adm.clientId);
              const isOpenInModal = modalAdmissionId === adm.id;
              const isSelected = selectedAdmissionId === adm.id;
              const stDisp = STATUS_DISPLAY[adm.status] || {
                label: adm.status,
                tone: 'text-slate-700 dark:text-slate-200',
              };
              const iviSnap = adm.iviAuditAnalysisJson;
              const checkItems = iviSnap?.checklistItemsChecked || [];
              const incCount =
                iviSnap?.inconsistenciesCount ??
                checkItems.filter((i) => i.classification === 'INCONSISTENCIA').length;
              const attCount =
                iviSnap?.attentionMeasuresCount ??
                checkItems.filter((i) => i.classification === 'MEDIDA_ATENCAO').length;
              const primaryAlertItem =
                checkItems.find((i) => i.classification === 'INCONSISTENCIA') ||
                checkItems.find((i) => i.classification === 'MEDIDA_ATENCAO') ||
                null;

              const consList = Array.isArray(adm.auditConsiderationsJson)
                ? adm.auditConsiderationsJson
                : [];
              const latestCons =
                consList.length > 0
                  ? consList[consList.length - 1]
                  : adm.auditManualNotes?.trim()
                  ? {
                      id: 'legacy',
                      authorName: adm.auditManualNotesBy || 'Auditor',
                      text: adm.auditManualNotes.trim(),
                      createdAt: adm.auditManualNotesAt || adm.auditedAt || adm.createdAt,
                    }
                  : null;
              const isEditingInline = inlineNoteAdmissionId === adm.id;
              const activeReviewer = (adm.activeReviewerName || '').trim();

              return (
                <div
                  key={adm.id}
                  className={`p-4 transition-colors ${
                    isOpenInModal || isSelected
                      ? 'bg-blue-50/50 hover:bg-blue-50/80 dark:bg-blue-950/60 dark:hover:bg-blue-950/80'
                      : 'hover:bg-slate-50/80 dark:hover:bg-slate-800/75'
                  }`}
                >
                  <div className="flex flex-col md:flex-row md:items-stretch gap-4">
                    {/* Container 1 (Estreito Esquerda): Dados do Cliente */}
                    <button
                      type="button"
                      onClick={() => openClientAuditModal(adm.id)}
                      className="md:w-60 lg:w-64 shrink-0 text-left flex flex-col justify-between gap-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-bold text-slate-900 dark:text-slate-100">
                            {adm.protocolCode}
                          </span>
                          <span className="text-[10px] font-mono text-slate-400 dark:text-slate-400">
                            {adm.modality || adm.debtType}
                          </span>
                        </div>
                        <div className="mt-1 text-sm font-semibold text-slate-900 truncate dark:text-slate-100">
                          {client?.fullName || `Cliente #${adm.clientId}`}
                        </div>
                        <div className="mt-0.5 text-[11px] text-slate-500 truncate dark:text-slate-400">
                          {adm.bankName} · #{adm.contractNumber}
                        </div>
                      </div>
                      <div className="text-[11px] font-mono text-slate-400 tabular-nums dark:text-slate-400">
                        Admissão: {formatDateBR(adm.createdAt)}
                      </div>
                    </button>

                    {/* Container 2 (Estreito ao Lado): Situação, Valor, Devoluções & Aviso "Em análise por {nome}" */}
                    <div className="md:w-48 lg:w-52 shrink-0 md:border-l md:border-slate-200/80 md:pl-4 flex flex-col justify-between gap-1.5 dark:md:border-slate-700/80">
                      <div>
                        <div className={`text-xs font-semibold ${stDisp.tone}`}>
                          {stDisp.label}
                        </div>
                        <div className="mt-1 font-mono text-sm font-bold text-slate-900 tabular-nums dark:text-slate-100">
                          {formatBRL(adm.debtAmountCents)}
                        </div>
                        <div className="mt-0.5 text-[11px]">
                          {adm.returnedCount > 0 ? (
                            <span className="text-red-600 font-semibold dark:text-red-400">
                              {adm.returnedCount} devolução(ões)
                            </span>
                          ) : (
                            <span className="text-slate-400 dark:text-slate-400">Sem devoluções</span>
                          )}
                        </div>
                      </div>

                      {activeReviewer && (
                        <div
                          role="status"
                          className="rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-[11px] text-blue-900 space-y-0.5 dark:border-blue-800/70 dark:bg-blue-950/50 dark:text-blue-300"
                        >
                          <div className="font-bold flex items-center gap-1.5">
                            <Lock className="w-3 h-3 text-blue-700 shrink-0 dark:text-blue-300" />
                            <span className="truncate">Em análise por {activeReviewer}</span>
                          </div>
                          {adm.activeReviewerSince && (
                            <div className="font-mono text-[10px] text-blue-700 tabular-nums dark:text-blue-300">
                              Aberto em {formatDateTimeBR(adm.activeReviewerSince)}
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Container 3 (Maior Direita): Verificação Ivi do Checklist + Considerações do Usuário */}
                    <div className="flex-1 min-w-0 md:border-l md:border-slate-200/80 md:pl-4 flex flex-col justify-between gap-2.5 text-xs dark:md:border-slate-700/80">
                      {/* Sub-bloco Verificação Ivi do Checklist */}
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-1.5 font-semibold text-slate-900 dark:text-slate-100">
                            <Bot className="w-3.5 h-3.5 text-slate-700 shrink-0 dark:text-slate-200" />
                            <span>Checklist Ivi</span>
                            {iviSnap && (
                              <>
                                <span className="text-slate-300 dark:text-slate-600">·</span>
                                <span
                                  className={
                                    incCount > 0
                                      ? 'text-red-700 font-bold dark:text-red-300'
                                      : 'text-emerald-700 font-semibold dark:text-emerald-300'
                                  }
                                >
                                  {incCount} inconsistência(s)
                                </span>
                                <span className="text-slate-300 dark:text-slate-600">·</span>
                                <span
                                  className={
                                    attCount > 0
                                      ? 'text-amber-800 font-bold dark:text-amber-300'
                                      : 'text-slate-500 font-medium dark:text-slate-400'
                                  }
                                >
                                  {attCount} medida(s) de atenção
                                </span>
                              </>
                            )}
                          </div>

                          <div className="flex items-center gap-2">
                            {iviSnap && (
                              <span className="font-mono text-[10px] text-slate-400 tabular-nums dark:text-slate-400">
                                {iviSnap.fromDatabaseCache || iviSnap.provider === 'local_rules_db'
                                  ? 'Base DB · 0 IA'
                                  : `IA · ${iviSnap.provider}`}{' '}
                                · {formatDateTimeBR(iviSnap.analyzedAt)}
                              </span>
                            )}
                            <button
                              type="button"
                              disabled={inlineIviBusyId === adm.id}
                              onClick={() => handleQuickRunIvi(adm.id)}
                              className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                            >
                              {inlineIviBusyId === adm.id ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <RefreshCw className="w-3 h-3" />
                              )}
                              {iviSnap ? 'Reverificar' : 'Verificar Base'}
                            </button>
                          </div>
                        </div>

                        {iviSnap ? (
                          <div className="space-y-0.5">
                            <p className="text-slate-600 leading-snug line-clamp-2 dark:text-slate-300">
                              {iviSnap.executiveSummary}
                            </p>
                            {primaryAlertItem && (
                              <p
                                className={`text-[11px] font-medium line-clamp-1 ${
                                  primaryAlertItem.classification === 'INCONSISTENCIA'
                                    ? 'text-red-700 dark:text-red-300'
                                    : 'text-amber-800 dark:text-amber-300'
                                }`}
                              >
                                {primaryAlertItem.classification === 'INCONSISTENCIA'
                                  ? 'Inconsistência: '
                                  : 'Medida de atenção: '}
                                {primaryAlertItem.ruleTitle} — {primaryAlertItem.detail}
                              </p>
                            )}
                          </div>
                        ) : (
                          <p className="text-slate-400 italic dark:text-slate-400">
                            Aguardando varredura do checklist na base de dados. Clique em &quot;Verificar Base&quot; ou abra a auditoria.
                          </p>
                        )}
                      </div>

                      {/* Sub-bloco Considerações do Usuário (Nome, Data e Hora) */}
                      <div className="border-t border-slate-100 pt-2 space-y-1.5 dark:border-slate-800">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold text-slate-800 dark:text-slate-100">
                            <User className="w-3.5 h-3.5 text-slate-500 shrink-0 dark:text-slate-400" />
                            <span>Considerações do Usuário</span>
                            {latestCons && (
                              <>
                                <span className="text-slate-300 dark:text-slate-600">·</span>
                                <span className="text-slate-900 dark:text-slate-100">{latestCons.authorName}</span>
                                <span className="text-slate-300 dark:text-slate-600">·</span>
                                <span className="font-mono font-normal text-slate-500 tabular-nums dark:text-slate-400">
                                  {formatDateTimeBR(latestCons.createdAt)}
                                </span>
                              </>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedAdmissionId(adm.id);
                              if (isEditingInline) {
                                setInlineNoteAdmissionId(null);
                              } else {
                                setInlineNoteAdmissionId(adm.id);
                                setInlineNoteText('');
                              }
                            }}
                            className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-700 hover:underline dark:text-blue-300"
                          >
                            <MessageSquarePlus className="w-3 h-3" />
                            {isEditingInline ? 'Fechar' : 'Registrar consideração'}
                          </button>
                        </div>

                        {latestCons ? (
                          <p className="text-slate-700 leading-snug line-clamp-2 dark:text-slate-200">{latestCons.text}</p>
                        ) : (
                          <p className="text-slate-400 italic dark:text-slate-400">
                            Nenhuma consideração registrada nesta ficha.
                          </p>
                        )}

                        {isEditingInline && (
                          <div className="pt-1.5 space-y-2">
                            <textarea
                              rows={2}
                              value={inlineNoteText}
                              onChange={(e) => setInlineNoteText(e.target.value)}
                              placeholder="Escreva suas considerações sobre este dossiê..."
                              className="w-full rounded-lg border border-slate-200 bg-white p-2 text-xs text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                            />
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="text-[11px] text-slate-500 font-mono dark:text-slate-400">
                                Carimbo: {currentUser?.name || 'Usuário autenticado'} ·{' '}
                                {formatDateTimeBR(new Date())}
                              </span>
                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setInlineNoteAdmissionId(null);
                                    setInlineNoteText('');
                                  }}
                                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                                >
                                  Cancelar
                                </button>
                                <button
                                  type="button"
                                  disabled={inlineNoteSaving || !inlineNoteText.trim()}
                                  onClick={() => handleQuickSaveConsideration(adm.id)}
                                  className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-1 text-[11px] font-semibold text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-emerald-600 dark:hover:bg-emerald-500"
                                >
                                  {inlineNoteSaving && <Loader2 className="w-3 h-3 animate-spin" />}
                                  Salvar Consideração
                                </button>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Action Column: Abrir Modal Específico de Auditoria */}
                    <div className="md:w-36 shrink-0 md:border-l md:border-slate-200/80 md:pl-4 flex md:flex-col items-center md:items-end justify-between md:justify-center gap-2 dark:md:border-slate-700/80">
                      <button
                        type="button"
                        onClick={() => openClientAuditModal(adm.id)}
                        className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800 whitespace-nowrap w-full md:w-auto min-h-[38px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:bg-emerald-600 dark:hover:bg-emerald-500"
                      >
                        <FileSearch className="w-3.5 h-3.5" />
                        Abrir Auditoria
                      </button>
                      <button
                        type="button"
                        onClick={() => openClientAuditModal(adm.id, 'documentos')}
                        className="inline-flex items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap w-full md:w-auto min-h-[34px] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                      >
                        Ver Documentos
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {totalPages > 1 && (
          <div className="px-4 py-2.5 border-t border-slate-100 bg-slate-50 flex items-center justify-between text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-800/70 dark:text-slate-300">
            <button
              type="button"
              disabled={safePage <= 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              className="font-semibold hover:text-slate-900 disabled:opacity-40 dark:hover:text-white"
            >
              ← Anterior
            </button>
            <span className="font-mono tabular-nums">
              Página {safePage} / {totalPages}
            </span>
            <button
              type="button"
              disabled={safePage >= totalPages}
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              className="font-semibold hover:text-slate-900 disabled:opacity-40 dark:hover:text-white"
            >
              Próxima →
            </button>
          </div>
        )}
      </section>

      {/* DEDICATED FULL CLIENT AUDIT MODAL (All Audit Procedures & Document Viewer happen here) */}
      {modalAdmissionId !== null && activeAdmission && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Auditoria do Cliente ${activeAdmission.protocolCode}`}
          className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/60 p-2 sm:p-4 dark:bg-slate-950/80"
        >
          <div className="w-full max-w-[1440px] h-[94vh] rounded-2xl border border-slate-200 bg-slate-50 shadow-2xl flex flex-col overflow-hidden dark:border-slate-700 dark:bg-slate-800/70">
            {/* Top Modal Bar */}
            <header className="px-5 py-3 bg-white border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 shrink-0 dark:bg-slate-900 dark:border-slate-700">
              <div className="flex flex-wrap items-center gap-2.5 text-xs min-w-0">
                <span className="font-mono font-bold text-slate-900 dark:text-slate-100">
                  {activeAdmission.protocolCode}
                </span>
                <span className="text-slate-300">·</span>
                <span className="font-display font-bold text-sm text-slate-900 truncate dark:text-slate-100">
                  {activeClient?.fullName || `Cliente #${activeAdmission.clientId}`}
                </span>
                <span className="text-slate-300">·</span>
                <span className="inline-flex items-center gap-1 font-medium text-blue-800 dark:text-blue-300">
                  <Lock className="w-3.5 h-3.5 text-blue-700 dark:text-blue-300" />
                  Em análise por {activeAdmission.activeReviewerName || currentUser?.name || 'Auditor'}
                </span>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() =>
                    setAuditModalTarget({
                      title: `Auditoria Cumulativa · ${activeAdmission.protocolCode}`,
                      entityType: 'admission',
                      entityId: activeAdmission.id,
                    })
                  }
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap min-h-[36px] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <History className="w-3.5 h-3.5" />
                  Auditoria Completa
                </button>
                <button
                  type="button"
                  onClick={() => setInsightsOpen((prev) => !prev)}
                  aria-pressed={insightsOpen}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold whitespace-nowrap min-h-[36px] ${
                    insightsOpen
                      ? 'border-slate-900 bg-slate-900 text-white hover:bg-slate-800 dark:border-emerald-500 dark:bg-emerald-600 dark:hover:bg-emerald-500'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800'
                  }`}
                >
                  <Bot className="w-3.5 h-3.5" />
                  {insightsOpen ? 'Ocultar Insights Ivi' : 'Painel de Insights Ivi'}
                </button>
                <button
                  type="button"
                  onClick={closeClientAuditModal}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-100 min-h-[36px] dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                >
                  <X className="w-3.5 h-3.5" />
                  Fechar e Liberar Ficha
                </button>
              </div>
            </header>

            {/* Modal Scrollable Audit Workspace + Lateral Insights Ivi */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-5">
              {feedback && (
                <div
                  role="status"
                  className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-medium text-emerald-900 dark:border-emerald-800/70 dark:bg-emerald-950/50 dark:text-emerald-300"
                >
                  {feedback}
                </div>
              )}
              {errorMsg && (
                <div
                  role="alert"
                  className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-xs font-medium text-red-900 dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300"
                >
                  {errorMsg}
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
                <main
                  className={`${
                    showLateralInsights ? 'lg:col-span-7 xl:col-span-8' : 'lg:col-span-12'
                  } space-y-4`}
                >
                  {/* Active Dossier Header + Sub-Tab Navigation */}
                  <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4 dark:border-slate-700 dark:bg-slate-900">
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 border-b border-slate-100 pb-4 dark:border-slate-800">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="font-mono font-bold text-blue-700 dark:text-blue-300">
                            {activeAdmission.protocolCode}
                          </span>
                          <span className="text-slate-300">·</span>
                          <span className="text-slate-600 dark:text-slate-300">Unidade {activeUnit?.name || 'Matriz'}</span>
                          <span className="text-slate-300">·</span>
                          <span className={`font-semibold ${activeStatusDisplay?.tone || 'text-slate-700 dark:text-slate-200'}`}>
                            {activeStatusDisplay?.label}
                          </span>
                          {loadingContext && <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400 dark:text-slate-400" />}
                        </div>
                        <h2 className="mt-1 font-display text-xl font-bold text-slate-900 truncate dark:text-slate-100">
                          {activeClient?.fullName || `Cliente #${activeAdmission.clientId}`}
                        </h2>
                        <p className="text-xs text-slate-500 font-mono dark:text-slate-400">
                          CPF/CNPJ: {activeClient?.cpfCnpj || '—'} · Contrato #{activeAdmission.contractNumber} ·{' '}
                          {activeAdmission.bankName}
                          {activeTitular ? ` · Titular: ${activeTitular.fullName}` : ''}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        <FormTemplateButton
                          menuId="auditoria"
                          label="Modelos A4"
                          getContext={(): FormMergeContext => ({
                            client: activeClient,
                            titular: activeTitular || activeClient,
                            admission: activeAdmission,
                            company: activeUnit,
                            bank: { name: activeAdmission.bankName },
                            collaborator: activeAdmission.consultantName
                              ? { id: activeAdmission.consultantId, name: activeAdmission.consultantName }
                              : null,
                            currentUserName: currentUser?.name,
                          })}
                        />
                        <button
                          type="button"
                          onClick={() => setActiveTab('boletos')}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap min-h-[38px] dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                        >
                          <History className="w-3.5 h-3.5" />
                          Boletos &amp; Histórico
                        </button>
                        {onNavigate && activeClient && (
                          <button
                            type="button"
                            onClick={() => {
                              closeClientAuditModal();
                              onNavigate('admission', { clientId: activeClient.id, tab: 'clientes' });
                            }}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap min-h-[38px] dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                          >
                            Abrir Cadastro
                            <ArrowUpRight className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Compact 4-Metric Financial Bar */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                      <div className="rounded-lg border border-slate-100 bg-slate-50/70 px-3 py-2.5 dark:border-slate-800 dark:bg-slate-800/60">
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">Passivo / Modalidade</div>
                        <div className="mt-0.5 font-mono font-bold text-slate-900 tabular-nums dark:text-slate-100">
                          {formatBRL(activeAdmission.debtAmountCents)}
                        </div>
                        <div className="text-[11px] text-slate-500 truncate dark:text-slate-400">
                          {activeAdmission.modality || activeAdmission.debtType}
                        </div>
                      </div>
                      <div className="rounded-lg border border-slate-100 bg-slate-50/70 px-3 py-2.5 dark:border-slate-800 dark:bg-slate-800/60">
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">2x Boletos Iniciais</div>
                        <div className="mt-0.5 font-mono font-bold text-emerald-700 tabular-nums dark:text-emerald-300">
                          {formatBRL(activeAdmission.initialInstallmentCents)}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">
                          Honorários: {formatBRL(activeAdmission.serviceFeeCents)}
                        </div>
                      </div>
                      <div className="rounded-lg border border-slate-100 bg-slate-50/70 px-3 py-2.5 dark:border-slate-800 dark:bg-slate-800/60">
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">Documentos no Cofre</div>
                        <div className="mt-0.5 font-mono font-bold text-slate-900 tabular-nums dark:text-slate-100">
                          {activeDocs.length} arquivo(s)
                        </div>
                        <button
                          type="button"
                          onClick={() => setActiveTab('documentos')}
                          className="text-[11px] font-semibold text-blue-700 hover:underline dark:text-blue-300"
                        >
                          Visualizar documentos →
                        </button>
                      </div>
                      <div className="rounded-lg border border-slate-100 bg-slate-50/70 px-3 py-2.5 dark:border-slate-800 dark:bg-slate-800/60">
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">Checklist &amp; Boletos</div>
                        <div className="mt-0.5 font-mono font-bold text-slate-900 tabular-nums dark:text-slate-100">
                          {checkedCount}/{applicableChecklist.length} itens
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">
                          {contextData?.titles?.length || 0} título(s) gerado(s)
                        </div>
                      </div>
                    </div>

                    {/* Previous critique warning if returned */}
                    {activeAdmission.auditRejectionReason && (
                      <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-900 dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300">
                        <strong>Última devolução registrada:</strong> {activeAdmission.auditRejectionReason}
                      </div>
                    )}

                    {/* 4 Workspace Sub-Tabs inside Client Audit Modal */}
                    <div
                      role="tablist"
                      aria-label="Etapas de análise do dossiê"
                      className="flex items-center gap-1.5 border-t border-slate-100 pt-3 overflow-x-auto dark:border-slate-800"
                    >
                      {[
                        { id: 'conferencia' as const, label: 'Conferência & Checklist Ivi', icon: Bot },
                        {
                          id: 'documentos' as const,
                          label: `Documentação & Visualizador (${activeDocs.length})`,
                          icon: FileSearch,
                        },
                        { id: 'ficha' as const, label: 'Ficha, Veículo & Cenários', icon: FileText },
                        {
                          id: 'boletos' as const,
                          label: `Boletos & Histórico (${contextData?.titles?.length || 0})`,
                          icon: Banknote,
                        },
                      ].map((tab) => {
                        const Icon = tab.icon;
                        const active = activeTab === tab.id;
                        return (
                          <button
                            key={tab.id}
                            role="tab"
                            aria-selected={active}
                            type="button"
                            onClick={() => setActiveTab(tab.id)}
                            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold whitespace-nowrap shrink-0 transition-colors min-h-[38px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                              active
                                ? 'bg-slate-900 text-white dark:bg-emerald-600'
                                : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800'
                            }`}
                          >
                            <Icon className="w-3.5 h-3.5 shrink-0" />
                            {tab.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* TAB 1: CONFERÊNCIA & CHECKLIST IVI */}
                  {activeTab === 'conferencia' && (
                    <div className="space-y-4">
                      <AuditIviCopilot
                        admissionId={activeAdmission.id}
                        protocolCode={activeAdmission.protocolCode}
                        initialAnalysis={activeAdmission.iviAuditAnalysisJson}
                        onAnalysisComplete={handleIviAnalysisUpdated}
                        onApplyCritiqueDraft={openRejectWithDraft}
                        onGoToDocs={() => setActiveTab('documentos')}
                      />

                      {/* Interactive Persistent Checklist */}
                      <section
                        aria-label="Checklist de conformidade"
                        className="rounded-xl border border-slate-200 bg-white p-4 space-y-3 text-xs dark:border-slate-700 dark:bg-slate-900"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2 font-bold text-slate-900 text-sm dark:text-slate-100">
                            <ClipboardCheck className="w-4 h-4 text-emerald-600 shrink-0 dark:text-emerald-400" />
                            <span>
                              Checklist de Conferência ({checkedCount}/{applicableChecklist.length})
                            </span>
                          </div>

                          {applicableChecklist.length > 0 && (
                            <button
                              type="button"
                              onClick={() => {
                                const allMarked = checkedCount === applicableChecklist.length;
                                const next: Record<string, boolean> = {};
                                if (!allMarked) {
                                  for (const it of applicableChecklist) {
                                    next[String(it.id)] = true;
                                  }
                                }
                                setCheckedIds(next);
                              }}
                              className="text-xs font-semibold text-blue-700 hover:underline dark:text-blue-300"
                            >
                              {checkedCount === applicableChecklist.length
                                ? 'Desmarcar todos'
                                : 'Marcar todos aplicáveis'}
                            </button>
                          )}
                        </div>

                        {applicableChecklist.length === 0 ? (
                          <p className="text-slate-500 dark:text-slate-400">
                            Nenhum item ativo configurado para esta modalidade.
                          </p>
                        ) : (
                          <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-700">
                            {applicableChecklist.map((item) => {
                              const key = String(item.id);
                              const isChecked = Boolean(checkedIds[key]);
                              return (
                                <label
                                  key={item.id}
                                  className={`flex items-start gap-3 px-3.5 py-2.5 cursor-pointer transition-colors ${
                                    isChecked ? 'bg-emerald-50/50 dark:bg-emerald-950/50' : 'hover:bg-slate-50 dark:hover:bg-slate-800'
                                  }`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    onChange={(e) =>
                                      setCheckedIds((prev) => ({
                                        ...prev,
                                        [key]: e.target.checked,
                                      }))
                                    }
                                    className="mt-0.5 rounded border-slate-300 dark:border-slate-600"
                                  />
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="font-semibold text-slate-900 dark:text-slate-100">
                                        <span className="font-mono text-[11px] text-slate-400 mr-1.5 dark:text-slate-400">
                                          #{String(item.sortOrder).padStart(2, '0')}
                                        </span>
                                        {item.title}
                                      </span>
                                      {item.modalityCondition && (
                                        <span className="font-mono text-[10px] font-semibold uppercase text-blue-700 shrink-0 dark:text-blue-300">
                                          {item.modalityCondition}
                                        </span>
                                      )}
                                    </div>
                                    {item.description && (
                                      <p className="mt-0.5 text-[11px] text-slate-500 leading-snug dark:text-slate-400">
                                        {item.description}
                                      </p>
                                    )}
                                  </div>
                                </label>
                              );
                            })}
                          </div>
                        )}

                        {/* Persistent Auditor Manual Notes & Timestamped Considerations */}
                        <div className="pt-2 space-y-2">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <label
                              htmlFor={`audit-notes-${activeAdmission.id}`}
                              className="block font-semibold text-slate-800 dark:text-slate-100"
                            >
                              Considerações do Usuário / Parecer do Auditor
                            </label>
                            {activeAdmission.auditManualNotesBy && (
                              <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                                Último registro: {activeAdmission.auditManualNotesBy}
                                {activeAdmission.auditManualNotesAt
                                  ? ` · ${formatDateTimeBR(activeAdmission.auditManualNotesAt)}`
                                  : ''}
                              </span>
                            )}
                          </div>
                          <textarea
                            id={`audit-notes-${activeAdmission.id}`}
                            rows={2}
                            value={manualNotes}
                            onChange={(e) => setManualNotes(e.target.value)}
                            placeholder="Registre observações da conferência documental, pendências conversadas com o comercial ou alertas para o Jurídico..."
                            className="w-full rounded-lg border border-slate-200 bg-white p-2.5 text-xs text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                          />
                          <div className="flex items-center justify-between text-[11px] text-slate-400 dark:text-slate-400">
                            <span>
                              Ao salvar, será carimbado com {currentUser?.name || 'usuário autenticado'} e data/hora atual.
                            </span>
                          </div>

                          {Array.isArray(activeAdmission.auditConsiderationsJson) &&
                            activeAdmission.auditConsiderationsJson.length > 0 && (
                              <div className="rounded-lg border border-slate-100 bg-slate-50/70 divide-y divide-slate-100 dark:border-slate-800 dark:bg-slate-800/60 dark:divide-slate-800">
                                {activeAdmission.auditConsiderationsJson
                                  .slice(-5)
                                  .reverse()
                                  .map((entry) => (
                                    <div key={entry.id} className="px-3 py-2 space-y-0.5">
                                      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                                        <span className="font-semibold text-slate-800 dark:text-slate-100">
                                          {entry.authorName}
                                        </span>
                                        <span className="font-mono text-slate-400 tabular-nums dark:text-slate-400">
                                          {formatDateTimeBR(entry.createdAt)}
                                        </span>
                                      </div>
                                      <p className="text-slate-700 leading-snug dark:text-slate-200">{entry.text}</p>
                                    </div>
                                  ))}
                              </div>
                            )}
                        </div>
                      </section>

                      {/* Decision Bar */}
                      {canDecide ? (
                        <section
                          aria-label="Decisão de auditoria"
                          className="rounded-xl border border-slate-200 bg-white p-4 space-y-3.5 text-xs dark:border-slate-700 dark:bg-slate-900"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                              Decisão de Auditoria &amp; Emissão de Boletos
                            </h3>
                            {isElectricVehicle && (
                              <span className="inline-flex items-center gap-1 text-xs font-bold text-red-700 dark:text-red-300">
                                <AlertTriangle className="w-3.5 h-3.5" />
                                Veículo elétrico sinalizado (bloqueio padrão ativo)
                              </span>
                            )}
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
                            <div>
                              <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">
                                Banco / API dos 2 Boletos Iniciais
                              </label>
                              <select
                                value={boletoProvider}
                                onChange={(e) => setBoletoProvider(e.target.value)}
                                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium min-h-[40px] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                              >
                                <option value="santander">API Banco Santander (Padrão)</option>
                                <option value="terceiros">API de Terceiros (Cora / Inter)</option>
                              </select>
                            </div>

                            <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-medium text-slate-800 cursor-pointer min-h-[40px] dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-100">
                              <input
                                type="checkbox"
                                checked={hasSearchSeizure}
                                onChange={(e) => setHasSearchSeizure(e.target.checked)}
                              />
                              <Search className="w-3.5 h-3.5 text-blue-700 shrink-0 dark:text-blue-300" />
                              <span>Alerta Busca e Apreensão (Escavador)</span>
                            </label>

                            <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-medium text-slate-800 cursor-pointer min-h-[40px] dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-100">
                              <input
                                type="checkbox"
                                checked={notifyDepartments}
                                onChange={(e) => setNotifyDepartments(e.target.checked)}
                              />
                              <span>Notificar Jurídico &amp; Financeiro ao aprovar</span>
                            </label>
                          </div>

                          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => handleSaveProgress('auditada')}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50 min-h-[40px] dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                            >
                              <Save className="w-3.5 h-3.5" />
                              Salvar Progresso (Em Análise)
                            </button>

                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => setRejectModalOpen(true)}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3.5 py-2 text-xs font-semibold text-red-700 hover:bg-red-50 min-h-[40px] dark:border-red-800/70 dark:bg-slate-900 dark:text-red-300 dark:hover:bg-red-950/60"
                              >
                                <RotateCcw className="w-3.5 h-3.5" />
                                Devolver p/ Admissão
                              </button>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={handleRequestApprove}
                                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 min-h-[40px]"
                              >
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                Aprovar Dossiê &amp; Emitir 2 Boletos
                              </button>
                            </div>
                          </div>
                        </section>
                      ) : (
                        <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs dark:border-emerald-800/70 dark:bg-emerald-950/50">
                          <div className="flex items-center gap-2 text-emerald-900 font-semibold dark:text-emerald-300">
                            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 dark:text-emerald-400" />
                            Dossiê já aprovado e roteado para Jurídico, Negociações e Contas a Receber.
                          </div>
                          {onNavigate && activeClient && (
                            <div className="flex items-center gap-3">
                              <button
                                type="button"
                                onClick={() => {
                                  closeClientAuditModal();
                                  onNavigate('legal', { clientId: activeClient.id });
                                }}
                                className="font-semibold text-blue-700 hover:underline dark:text-blue-300"
                              >
                                Ver Jurídico →
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  closeClientAuditModal();
                                  onNavigate('finance_receber', { clientId: activeClient.id });
                                }}
                                className="font-semibold text-blue-700 hover:underline dark:text-blue-300"
                              >
                                Ver Contas a Receber →
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* TAB 2: DOCUMENTAÇÃO & VISUALIZADOR DEDICADO + IVI READER */}
                  {activeTab === 'documentos' && (
                    <AuditDocumentWorkspace
                      admissionId={activeAdmission.id}
                      clientId={activeAdmission.clientId}
                      debtType={activeAdmission.debtType}
                      modality={activeAdmission.modality}
                      documents={activeDocs}
                      selectedDocId={selectedDocId}
                      onSelectDocId={setSelectedDocId}
                      onDocumentUploaded={async () => {
                        invalidateInsightsForAdmission(activeAdmission.id);
                        await Promise.all([loadList(), loadActiveContext(activeAdmission.id)]);
                      }}
                      onUseAlertInCritique={(text) => {
                        openRejectWithDraft(text);
                      }}
                    />
                  )}

                  {/* TAB 3: FICHA COMPLETA, VEÍCULO & CENÁRIOS */}
                  {activeTab === 'ficha' && (
                    <AuditDossierSummaryTab
                      admission={activeAdmission}
                      client={activeClient}
                      titular={activeTitular}
                      unit={activeUnit}
                      recalcScenarios={contextData?.recalcScenarios || []}
                      legalProcesses={contextData?.legalProcesses || []}
                      legalMovements={contextData?.legalMovements || []}
                      isElectricVehicle={isElectricVehicle}
                      onToggleElectricVehicle={setIsElectricVehicle}
                    />
                  )}

                  {/* TAB 4: BOLETOS GERADOS, CRÍTICAS & LOGS */}
                  {activeTab === 'boletos' && (
                    <AuditBoletosTab
                      admission={activeAdmission}
                      clientName={activeClient?.fullName || 'Cliente'}
                      titles={contextData?.titles || []}
                      auditLogs={contextData?.auditLogs || []}
                      onRefreshContext={async () => {
                        await loadActiveContext(activeAdmission.id);
                      }}
                      onNavigate={onNavigate}
                    />
                  )}
                </main>

                {/* Right Lateral Column inside Client Modal: Painel de Insights Ivi */}
                {showLateralInsights && (
                  <div className="lg:col-span-5 xl:col-span-4">
                    <AuditIviInsightsPanel
                      admissionId={activeAdmission.id}
                      protocolCode={activeAdmission.protocolCode}
                      documents={activeDocs}
                      selectedDocId={selectedDocId}
                      onSelectDocId={setSelectedDocId}
                      insights={activeInsights}
                      loading={insightsLoading}
                      errorMsg={insightsError}
                      mode="lateral"
                      onToggleMode={setInsightsMode}
                      onClose={() => setInsightsOpen(false)}
                      onRefresh={(forceAi = true) =>
                        fetchIviInsights(activeAdmission.id, selectedDocId, forceAi)
                      }
                      canDecide={Boolean(canDecide)}
                      hasSearchSeizure={hasSearchSeizure}
                      onApplyChecklistSuggestions={(itemIds) => {
                        setCheckedIds((prev) => {
                          const next = { ...prev };
                          for (const id of itemIds) next[String(id)] = true;
                          return next;
                        });
                        setFeedback(
                          `Ivi marcou ${itemIds.length} item(ns) no checklist desta ficha com base nos documentos anexados. Clique em "Salvar Progresso" ou "Aprovar" quando concluir.`
                        );
                      }}
                      onEnableSearchSeizure={() => {
                        setHasSearchSeizure(true);
                        setFeedback(
                          'Alerta de Busca e Apreensão (Escavador) sinalizado conforme sugestão da Ivi.'
                        );
                      }}
                      onApproveDossier={handleRequestApprove}
                      onSaveInAnalysis={() => handleSaveProgress('auditada')}
                      onOpenRejectWithDraft={openRejectWithDraft}
                      onInspectInTab={() => setActiveTab('documentos')}
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal Mode: Painel de Insights Ivi */}
      {modalAdmissionId !== null && activeAdmission && insightsOpen && insightsMode === 'modal' && (
        <AuditIviInsightsPanel
          admissionId={activeAdmission.id}
          protocolCode={activeAdmission.protocolCode}
          documents={activeDocs}
          selectedDocId={selectedDocId}
          onSelectDocId={setSelectedDocId}
          insights={activeInsights}
          loading={insightsLoading}
          errorMsg={insightsError}
          mode="modal"
          onToggleMode={setInsightsMode}
          onClose={() => setInsightsOpen(false)}
          onRefresh={(forceAi = true) =>
            fetchIviInsights(activeAdmission.id, selectedDocId, forceAi)
          }
          canDecide={Boolean(canDecide)}
          hasSearchSeizure={hasSearchSeizure}
          onApplyChecklistSuggestions={(itemIds) => {
            setCheckedIds((prev) => {
              const next = { ...prev };
              for (const id of itemIds) next[String(id)] = true;
              return next;
            });
            setFeedback(
              `Ivi marcou ${itemIds.length} item(ns) no checklist desta ficha com base nos documentos anexados. Clique em "Salvar Progresso" ou "Aprovar" quando concluir.`
            );
          }}
          onEnableSearchSeizure={() => {
            setHasSearchSeizure(true);
            setFeedback('Alerta de Busca e Apreensão (Escavador) sinalizado conforme sugestão da Ivi.');
          }}
          onApproveDossier={handleRequestApprove}
          onSaveInAnalysis={() => handleSaveProgress('auditada')}
          onOpenRejectWithDraft={openRejectWithDraft}
          onInspectInTab={() => {
            setInsightsMode('lateral');
            setActiveTab('documentos');
          }}
        />
      )}

      {/* Reject / Return Modal */}
      {rejectModalOpen && activeAdmission && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="reject-dialog-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 dark:bg-slate-950/80"
        >
          <form
            onSubmit={handleConfirmReject}
            className="w-full max-w-lg rounded-xl bg-white p-5 border border-slate-200 shadow-xl space-y-3 dark:bg-slate-900 dark:border-slate-700"
          >
            <div id="reject-dialog-title" className="flex items-center gap-2 text-red-700 font-bold text-sm dark:text-red-300">
              <ShieldAlert className="w-4 h-4" />
              Devolver Dossiê {activeAdmission.protocolCode} para Admissão
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-300">
              Descreva de forma clara a divergência documental ou cadastral. Esta crítica abre uma nova rodada auditada com o Comercial.
            </p>
            <textarea
              rows={4}
              required
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Ex: CRLV ilegível ou procuração sem assinatura do titular..."
              className="w-full rounded-lg border border-slate-200 p-2.5 text-xs text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:border-slate-700 dark:text-slate-100"
            />
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setRejectModalOpen(false)}
                className="rounded-lg border border-slate-200 px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 min-h-[38px] dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={busy || !rejectReason.trim()}
                className="rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50 min-h-[38px]"
              >
                {busy ? 'Devolvendo...' : 'Confirmar Devolução'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Accessible Approval Warning Modal (Checklist Incomplete / Electric Vehicle Guard) */}
      {confirmApproveModal && activeAdmission && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="approve-confirm-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 dark:bg-slate-950/80"
        >
          <div className="w-full max-w-md rounded-xl bg-white p-5 border border-slate-200 shadow-xl space-y-3 text-xs dark:bg-slate-900 dark:border-slate-700">
            <div id="approve-confirm-title" className="flex items-center gap-2 font-bold text-sm text-amber-800 dark:text-amber-300">
              <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
              Confirmar Aprovação com Pendências
            </div>

            {confirmApproveModal.electricWarning && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-900 dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300">
                <strong>Veículo elétrico sinalizado:</strong> A regra padrão recomenda não concluir processos de veículos elétricos sem validação especial. Deseja prosseguir mesmo assim?
              </div>
            )}

            {confirmApproveModal.pendingChecklistCount > 0 && (
              <p className="text-slate-700 dark:text-slate-200">
                Existem <strong>{confirmApproveModal.pendingChecklistCount}</strong> item(ns) desmarcado(s) no checklist de conferência desta modalidade. Deseja concluir a auditoria e emitir os boletos?
              </p>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirmApproveModal(null)}
                className="rounded-lg border border-slate-200 px-3.5 py-2 font-semibold text-slate-700 hover:bg-slate-50 min-h-[38px] dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Voltar à Conferência
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => executeApprove(confirmApproveModal.electricWarning)}
                className="rounded-lg bg-emerald-600 px-4 py-2 font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 min-h-[38px]"
              >
                {busy ? 'Concluindo...' : 'Confirmar & Aprovar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {auditModalTarget && (
        <EntityAuditModal
          open={Boolean(auditModalTarget)}
          title={auditModalTarget.title}
          entityType={auditModalTarget.entityType}
          entityId={auditModalTarget.entityId}
          onClose={() => setAuditModalTarget(null)}
        />
      )}
    </div>
  );
};
