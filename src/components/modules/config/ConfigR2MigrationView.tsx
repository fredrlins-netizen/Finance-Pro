import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  CloudUpload,
  Copy,
  Download,
  FileText,
  FolderOpen,
  FolderSync,
  HardDrive,
  Info,
  KeyRound,
  Link2,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Square,
  Terminal,
  Trash2,
  X,
} from 'lucide-react';
import { apiFetch, getActiveUnitHeader, getAuthToken, parseJsonResponse } from '../../../lib/api.ts';
import {
  cancelBrowserFolderSync,
  detectUnitTailFolder,
  dismissR2SyncBanner,
  getR2SyncSnapshot,
  LookupTargetUnit,
  matchUnitFromFolderName,
  MigrationBatchSummary as MigrationBatch,
  ProcessingFileStage,
  sanitizeWindowsPath,
  setR2ExternalBatchActive,
  startBrowserFolderSync,
  subscribeR2BatchUpdates,
  subscribeR2Sync,
} from '../../../services/r2BrowserSyncManager.ts';

interface MigrationItem {
  id: number;
  batchId: number;
  unitFolderName: string;
  extractedUnitCode: string;
  unitId?: number | null;
  contractFolderName: string;
  extractedContractNumber: string;
  clientId?: number | null;
  admissionId?: number | null;
  documentObjectId?: number | null;
  itemScope?: 'client' | 'unit' | 'interlinked' | string;
  unitFolderPath?: string;
  relativeSubpath: string;
  fileName: string;
  legacySourcePath: string;
  sizeBytes: number;
  action: string;
  status: string;
  integrativeCode: string;
  errorMessage: string;
  createdAt: string;
}

interface BucketStats {
  bucketName: string;
  backend?: 'cloudflare_r2' | 'local_encrypted_bucket' | string;
  activeBackend?: string;
  encryptionAlgorithm?: string;
  encryption?: string;
  r2Configured?: boolean;
  r2Endpoint: string | null;
  physicalObjectsCount?: number;
  physicalBytesUsed?: number;
  totalObjects?: number;
  totalLogicalBytes?: number;
  lastError?: string | null;
}

interface PendingFolderPick {
  files: File[];
  rootName: string;
  immediateSubfolders: string[];
  subfoldersCount: number;
  totalSubfolderFiles: number;
  skippedRootFiles: number;
  selectedUnitId: string;
}

interface IntegrativeStats {
  admissionsTotal: number;
  admissionsWithCode: number;
  documentsTotal: number;
  documentsWithCode: number;
}

interface LookupTargetAdmission {
  id: number;
  unitId: number;
  unitCode: string;
  clientId: number;
  clientName: string;
  contractNumber: string;
  protocolCode: string;
  integrativeCode: string;
}

interface ConfigR2MigrationViewProps {
  wsTick?: number;
  onToast: (msg: string) => void;
}

const DEFAULT_WINDOWS_ROOT = 'W:\\Invicta4\\Convertidos\\Invicta0910260919';

function formatBytes(bytes: number): string {
  const b = Number(bytes || 0);
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(2)} MB`;
  return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function getStageBadgeInfo(stage: ProcessingFileStage): { label: string; cls: string } {
  switch (stage) {
    case 'hashing':
      return { label: 'Lendo SHA-256', cls: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' };
    case 'verificando':
      return { label: 'Verificando cofre', cls: 'bg-blue-100 text-blue-800 dark:bg-blue-950/70 dark:text-blue-300' };
    case 'enviando':
      return { label: 'Enviando', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300' };
    case 'deduplicado':
      return { label: 'Deduplicado', cls: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' };
    case 'erro':
      return { label: 'Falha', cls: 'bg-red-100 text-red-800 dark:bg-red-950/70 dark:text-red-300' };
    default:
      return { label: 'Enviado', cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300' };
  }
}

function getBatchHumanStatus(status: string): { label: string; description: string } {
  switch (status) {
    case 'aguardando_agente':
      return {
        label: 'Etapa 2 Pendente — Aguardando execução no servidor Windows',
        description:
          'A sessão já foi criada aqui no sistema, mas o computador onde estão os arquivos ainda não iniciou o envio. Baixe o Programa (.mjs) e o Atalho (.bat) ao lado e execute lá no Windows.',
      };
    case 'em_andamento':
      return {
        label: 'Sincronização em andamento para o R2',
        description:
          'O envio está lendo suas pastas, identificando Unidade e Contrato e gravando os arquivos no cofre com atualização automática.',
      };
    case 'concluido':
      return {
        label: 'Envio 100% concluído',
        description:
          'Todos os arquivos escaneados foram separados por Unidade e Admissão e gravados com segurança no bucket Cloudflare R2.',
      };
    case 'concluido_com_pendencias':
      return {
        label: 'Concluído com pendências de vínculo',
        description:
          'O envio terminou, porém alguns arquivos ficaram sem contrato identificado. Use o botão "Vincular Pasta" na tabela abaixo.',
      };
    case 'cancelado':
      return {
        label: 'Processo cancelado pelo usuário',
        description:
          'O envio foi interrompido manualmente. Os arquivos já enviados permanecem salvos e deduplicados com segurança no cofre.',
      };
    default:
      return {
        label: status || 'Em preparação',
        description: 'Acompanhe os números e a lista de arquivos abaixo.',
      };
  }
}

export const ConfigR2MigrationView: React.FC<ConfigR2MigrationViewProps> = ({ wsTick, onToast }) => {
  const [loading, setLoading] = useState(true);
  const [batches, setBatches] = useState<MigrationBatch[]>([]);
  const [bucketStats, setBucketStats] = useState<BucketStats | null>(null);
  const [integrativeStats, setIntegrativeStats] = useState<IntegrativeStats | null>(null);
  const [selectedBatchId, setSelectedBatchId] = useState<number | null>(null);

  // Batch items & filters
  const [items, setItems] = useState<MigrationItem[]>([]);
  const [itemFilter, setItemFilter] = useState<
    'all' | 'unmatched' | 'unit' | 'interlinked' | 'updated' | 'created' | 'blocked' | 'failed'
  >('all');
  const [itemsLoading, setItemsLoading] = useState(false);

  // New batch form
  const [newTitle, setNewTitle] = useState('Sincronização Matriz & Filiais (Base 64 GB)');
  const [newSyncMode, setNewSyncMode] = useState<'incremental' | 'mirror_review'>('incremental');
  const [newSourcePath, setNewSourcePath] = useState(DEFAULT_WINDOWS_ROOT);
  const [busy, setBusy] = useState(false);
  const [copiedKey, setCopiedKey] = useState('');

  // Resolution targets for unmatched items
  const [targetUnits, setTargetUnits] = useState<LookupTargetUnit[]>([]);
  const [targetAdmissions, setTargetAdmissions] = useState<LookupTargetAdmission[]>([]);
  const [resolvingItemId, setResolvingItemId] = useState<number | null>(null);
  const [resolveUnitId, setResolveUnitId] = useState<string>('');
  const [resolveAdmissionId, setResolveAdmissionId] = useState<string>('');

  // Seal & HMAC Integrativo Tester
  const [sealUnitFilter, setSealUnitFilter] = useState<string>('all');
  const [sealOverwrite, setSealOverwrite] = useState(false);
  const [hmacQueryCode, setHmacQueryCode] = useState('');
  const [hmacResolveResult, setHmacResolveResult] = useState<Record<string, unknown> | null>(null);
  const [hmacResolveError, setHmacResolveError] = useState('');

  // Direct Browser Folder Sync (background singleton manager — survives route/screen switches)
  const dirInputRef = useRef<HTMLInputElement | null>(null);
  const [browserDryRun, setBrowserDryRun] = useState(false);
  const [browserSubfoldersOnly, setBrowserSubfoldersOnly] = useState(true);
  const [browserTargetUnitId, setBrowserTargetUnitId] = useState<string>('auto');
  const [pendingFolderPick, setPendingFolderPick] = useState<PendingFolderPick | null>(null);
  const browserSync = useSyncExternalStore(subscribeR2Sync, getR2SyncSnapshot);

  // Full Purge of R2 Bucket & Folders
  const [purgeModalOpen, setPurgeModalOpen] = useState(false);
  const [purgeConfirmText, setPurgeConfirmText] = useState('');
  const [purging, setPurging] = useState(false);

  const loadBatchesOnly = useCallback(
    async (silent = false) => {
      try {
        const migData = await apiFetch<{
          batches: MigrationBatch[];
          bucketStats: BucketStats;
          integrativeStats: IntegrativeStats;
        }>('/api/migration/batches');
        setBatches(migData.batches || []);
        setBucketStats(migData.bucketStats || null);
        setIntegrativeStats(migData.integrativeStats || null);
        if (!selectedBatchId && migData.batches?.length) {
          setSelectedBatchId(migData.batches[0].id);
        }
      } catch (err) {
        if (!silent) {
          onToast(err instanceof Error ? err.message : 'Erro ao atualizar sessões da migração R2.');
        }
      }
    },
    [onToast, selectedBatchId]
  );

  const loadBatchesAndTargets = useCallback(
    async (silent = false) => {
      try {
        const [migData, targetsData] = await Promise.all([
          apiFetch<{
            batches: MigrationBatch[];
            bucketStats: BucketStats;
            integrativeStats: IntegrativeStats;
          }>('/api/migration/batches'),
          apiFetch<{
            units: LookupTargetUnit[];
            admissions: LookupTargetAdmission[];
          }>('/api/migration/lookup-targets'),
        ]);
        setBatches(migData.batches || []);
        setBucketStats(migData.bucketStats || null);
        setIntegrativeStats(migData.integrativeStats || null);
        setTargetUnits(targetsData.units || []);
        setTargetAdmissions(targetsData.admissions || []);
        if (!selectedBatchId && migData.batches?.length) {
          setSelectedBatchId(migData.batches[0].id);
        }
      } catch (err) {
        if (!silent) {
          onToast(err instanceof Error ? err.message : 'Erro ao carregar status da migração R2.');
        }
      } finally {
        setLoading(false);
      }
    },
    [onToast, selectedBatchId]
  );

  const loadItems = useCallback(
    async (silent = false) => {
      if (!selectedBatchId) {
        setItems([]);
        return;
      }
      if (!silent) setItemsLoading(true);
      try {
        const res = await apiFetch<{ items: MigrationItem[] }>(
          `/api/migration/batches/${selectedBatchId}/items?filter=${itemFilter}&limit=150`
        );
        setItems(res.items || []);
      } finally {
        if (!silent) setItemsLoading(false);
      }
    },
    [selectedBatchId, itemFilter]
  );

  useEffect(() => {
    loadBatchesAndTargets(false);
  }, [loadBatchesAndTargets, wsTick]);

  useEffect(() => {
    loadItems(false);
  }, [loadItems, wsTick]);

  const selectedBatch = batches.find((b) => b.id === selectedBatchId) || null;
  const isAiStudioProxyHost =
    typeof window !== 'undefined' && /ais-(dev|pre)-/i.test(window.location.hostname);

  // Sincroniza lote ativo e suspende limite de inatividade durante rotina em andamento
  useEffect(() => {
    if (browserSync?.batchId && selectedBatchId !== browserSync.batchId) {
      setSelectedBatchId(browserSync.batchId);
    }
  }, [browserSync?.batchId, selectedBatchId]);

  useEffect(() => {
    return subscribeR2BatchUpdates((batchId, finished) => {
      if (batchId) setSelectedBatchId(batchId);
      if (finished) {
        void Promise.all([loadBatchesAndTargets(false), loadItems(false)]);
      } else {
        void Promise.all([loadBatchesOnly(true), loadItems(true)]);
      }
    });
  }, [loadBatchesAndTargets, loadBatchesOnly, loadItems]);

  useEffect(() => {
    const hasActiveServerBatch = Boolean(
      selectedBatch &&
        selectedBatch.status === 'em_andamento' &&
        selectedBatch.lastHeartbeatAt &&
        Date.now() - new Date(selectedBatch.lastHeartbeatAt).getTime() < 3 * 60 * 1000
    );
    setR2ExternalBatchActive(hasActiveServerBatch);
    return () => {
      setR2ExternalBatchActive(false);
    };
  }, [selectedBatch]);

  // Atualização automática a cada 3 segundos enquanto aguarda agente Windows (pausada durante envio direto pelo navegador)
  useEffect(() => {
    if (!selectedBatch || browserSync?.running) return;
    if (selectedBatch.status !== 'aguardando_agente' && selectedBatch.status !== 'em_andamento') {
      return;
    }
    const timer = window.setInterval(() => {
      loadBatchesOnly(true);
      loadItems(true);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [selectedBatch, browserSync?.running, loadBatchesOnly, loadItems]);

  const tailUnitWarning = useMemo(
    () => detectUnitTailFolder(newSourcePath, targetUnits),
    [newSourcePath, targetUnits]
  );

  const selectedBatchTailWarning = useMemo(
    () => (selectedBatch ? detectUnitTailFolder(selectedBatch.sourceRootPath, targetUnits) : null),
    [selectedBatch, targetUnits]
  );

  const progressMetrics = useMemo(() => {
    if (!selectedBatch) {
      return { pct: 0, processedCount: 0, step1Done: false, step2Done: false, step3Done: false };
    }
    const processedCount =
      Number(selectedBatch.createdCount || 0) +
      Number(selectedBatch.updatedContentCount || 0) +
      Number(selectedBatch.updatedPathCount || 0) +
      Number(selectedBatch.deduplicatedCount || 0) +
      Number(selectedBatch.unmatchedCount || 0) +
      Number(selectedBatch.blockedCount || 0) +
      Number(selectedBatch.failedCount || 0);

    const isFinished =
      selectedBatch.status === 'concluido' || selectedBatch.status === 'concluido_com_pendencias';
    const isRunning = selectedBatch.status === 'em_andamento';
    const scanned = Number(selectedBatch.totalFilesScanned || 0);

    let pct = 0;
    if (isFinished) {
      pct = 100;
    } else if (scanned > 0) {
      pct = Math.min(99, Math.max(1, Math.round((processedCount / scanned) * 100)));
    } else if (isRunning) {
      pct = 5;
    }

    return {
      pct,
      processedCount,
      step1Done: true,
      step2Done: isRunning || isFinished || scanned > 0 || Boolean(selectedBatch.lastHeartbeatAt),
      step3Done: isFinished,
    };
  }, [selectedBatch]);

  const handleCreateBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const cleanPath = sanitizeWindowsPath(newSourcePath);
    try {
      const res = await apiFetch<{ batch: MigrationBatch }>('/api/migration/batches', {
        method: 'POST',
        body: JSON.stringify({
          title: newTitle.trim(),
          syncMode: newSyncMode,
          sourceRootPath: cleanPath,
          targetUnitIds: tailUnitWarning ? [tailUnitWarning.unit.id] : [],
        }),
      });
      setSelectedBatchId(res.batch.id);
      onToast(
        isAiStudioProxyHost
          ? `Sessão ${res.batch.batchCode} criada. Nesta pré-visualização, use "Selecionar Pasta de Origem e Enviar" para envio direto sem bloqueio HTML.`
          : `Sessão ${res.batch.batchCode} criada. Use "Selecionar Pasta de Origem e Enviar" ou baixe o .mjs/.bat para Windows.`
      );
      await loadBatchesAndTargets(false);
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Erro ao criar sessão de envio.');
    } finally {
      setBusy(false);
    }
  };

  const handleDownloadAgentFile = async (batch: MigrationBatch, kind: 'mjs' | 'bat') => {
    try {
      const token = getAuthToken();
      const res = await fetch(`/api/migration/batches/${batch.id}/agent-script?kind=${kind}`, {
        headers: {
          'x-unit-id': String(getActiveUnitHeader()),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      if (!res.ok) {
        await parseJsonResponse(res, 'Falha ao baixar arquivo do servidor Windows.');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = kind === 'bat' ? `executar-${batch.batchCode}.bat` : `invicta-r2-sync-${batch.batchCode}.mjs`;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
      onToast(
        kind === 'mjs'
          ? `1º arquivo salvo: invicta-r2-sync-${batch.batchCode}.mjs. Agora baixe o Atalho (.bat) na mesma pasta.`
          : `2º arquivo salvo: executar-${batch.batchCode}.bat. Dê um duplo clique nele lá no Windows.`
      );
      await loadBatchesAndTargets(true);
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Erro no download do arquivo.');
    }
  };

  const getCleanCommandForBatch = (batch: MigrationBatch): string => {
    const dirArg = sanitizeWindowsPath(batch.sourceRootPath || newSourcePath || DEFAULT_WINDOWS_ROOT);
    return `node invicta-r2-sync-${batch.batchCode}.mjs --dir "${dirArg}" --concurrency 6`;
  };

  const handleCopyCommand = (batch: MigrationBatch) => {
    const cmd = getCleanCommandForBatch(batch);
    navigator.clipboard.writeText(cmd);
    setCopiedKey(`cmd-${batch.id}`);
    setTimeout(() => setCopiedKey(''), 2000);
    onToast('Comando copiado (já sem barra no final para não dar erro no Windows).');
  };

  const handleSealIntegrativeCodes = async () => {
    setBusy(true);
    try {
      const res = await apiFetch<{
        admissionsAssigned: number;
        documentsAssigned: number;
        totalAdmissionsProcessed: number;
        totalDocumentsProcessed: number;
      }>('/api/vault/integrative-codes/assign', {
        method: 'POST',
        body: JSON.stringify({
          unitId: sealUnitFilter === 'all' ? null : Number(sealUnitFilter),
          overwrite: sealOverwrite,
          batchId: selectedBatchId,
        }),
      });
      onToast(
        `Selagem concluída: ${res.admissionsAssigned} dossiê(s) e ${res.documentsAssigned} documento(s) receberam código único.`
      );
      await loadBatchesAndTargets(false);
      await loadItems(false);
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Erro ao gerar selos de segurança.');
    } finally {
      setBusy(false);
    }
  };

  const handleTestIntegrativeCode = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = hmacQueryCode.trim().toUpperCase();
    if (!clean) return;
    setHmacResolveError('');
    setHmacResolveResult(null);
    try {
      const res = await apiFetch<Record<string, unknown>>(
        `/api/vault/i/${encodeURIComponent(clean)}?meta=1`
      );
      setHmacResolveResult(res);
    } catch (err) {
      setHmacResolveError(err instanceof Error ? err.message : 'Código não encontrado ou inválido.');
    }
  };

  const handleDownloadByIntegrativeCode = async (code: string) => {
    try {
      const token = getAuthToken();
      const res = await fetch(`/api/vault/i/${encodeURIComponent(code)}`, {
        headers: {
          'x-unit-id': String(getActiveUnitHeader()),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      if (!res.ok) {
        await parseJsonResponse(res, 'Não foi possível baixar o arquivo por este código.');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${code}.bin`;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Não foi possível baixar o arquivo.');
    }
  };

  const handleResolveUnmatched = async (item: MigrationItem) => {
    if (!resolveAdmissionId && !resolveUnitId) return;
    setBusy(true);
    try {
      const res = await apiFetch<{ resolvedCount: number }>(
        `/api/migration/batches/${item.batchId}/resolve-unmatched`,
        {
          method: 'POST',
          body: JSON.stringify({
            itemId: item.id,
            unitId: resolveUnitId ? Number(resolveUnitId) : undefined,
            admissionId: resolveAdmissionId ? Number(resolveAdmissionId) : undefined,
            applyToFolder: true,
          }),
        }
      );
      setResolvingItemId(null);
      setResolveUnitId('');
      setResolveAdmissionId('');
      onToast(
        `${res.resolvedCount || 1} arquivo(s) da pasta vinculados com sucesso. Rode o programa no Windows mais uma vez para concluir.`
      );
      await loadBatchesAndTargets(false);
      await loadItems(false);
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Erro ao vincular pasta.');
    } finally {
      setBusy(false);
    }
  };

  const runBrowserFolderSync = async (params: {
    filesToUpload: File[];
    selectedRootName: string;
    subfoldersCount: number;
    skippedRootFiles: number;
    explicitUnitId: number | null;
  }) => {
    if (dirInputRef.current) dirInputRef.current.value = '';
    await startBrowserFolderSync({
      ...params,
      targetUnits,
      selectedBatch,
      syncMode: newSyncMode,
      fallbackSourcePath: newSourcePath,
      dryRun: browserDryRun,
      onToast,
      onBatchCreated: (created) => {
        setSelectedBatchId(created.id);
      },
    });
  };

  const handleBrowserFolderSelected = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;

    const ignoredNames = new Set(['thumbs.db', 'desktop.ini', '.ds_store']);
    const rawFiles = Array.from(fileList).filter((f) => {
      const lower = f.name.toLowerCase();
      if (lower.startsWith('.') || ignoredNames.has(lower)) return false;
      const rel = f.webkitRelativePath || f.name;
      return !rel.split('/').some((seg) => seg.startsWith('.'));
    });

    if (rawFiles.length === 0) {
      onToast('Nenhum arquivo válido encontrado na pasta selecionada.');
      if (dirInputRef.current) dirInputRef.current.value = '';
      return;
    }

    const firstRelParts = (rawFiles[0].webkitRelativePath || rawFiles[0].name).split('/').filter(Boolean);
    const selectedRootName = firstRelParts[0] || '';

    const subfolderFiles: File[] = [];
    const rootLooseFiles: File[] = [];
    const subfoldersSet = new Set<string>();
    const immediateSubfolderSet = new Set<string>();

    for (const f of rawFiles) {
      const parts = (f.webkitRelativePath || f.name).split('/').filter(Boolean);
      if (parts.length >= 3) {
        subfolderFiles.push(f);
        immediateSubfolderSet.add(parts[1]);
        let acc = '';
        for (const seg of parts.slice(1, -1)) {
          acc = acc ? `${acc}/${seg}` : seg;
          subfoldersSet.add(acc);
        }
      } else {
        rootLooseFiles.push(f);
      }
    }

    const filesToUpload = browserSubfoldersOnly ? subfolderFiles : rawFiles;
    const skippedRootFiles = browserSubfoldersOnly ? rootLooseFiles.length : 0;

    if (filesToUpload.length === 0) {
      onToast(
        rootLooseFiles.length > 0
          ? `A pasta "${selectedRootName}" possui apenas ${rootLooseFiles.length} arquivo(s) solto(s) na raiz e nenhuma subpasta. Desmarque a opção de ignorar raiz caso deseje enviá-los.`
          : 'Nenhum arquivo válido encontrado dentro das subpastas da pasta selecionada.'
      );
      if (dirInputRef.current) dirInputRef.current.value = '';
      return;
    }

    const immediateSubfolders = Array.from(immediateSubfolderSet);
    const rootUnitMatch = selectedRootName ? matchUnitFromFolderName(selectedRootName, targetUnits) : null;
    const explicitUnitId =
      browserTargetUnitId !== 'auto' && Number(browserTargetUnitId) > 0 ? Number(browserTargetUnitId) : null;

    if (!explicitUnitId && !rootUnitMatch && targetUnits.length > 1) {
      const hasUnmatchedSubfolder =
        immediateSubfolders.length === 0 ||
        immediateSubfolders.some((sub) => !matchUnitFromFolderName(sub, targetUnits));
      if (hasUnmatchedSubfolder) {
        const activeHeader = getActiveUnitHeader();
        const defaultPick =
          targetUnits.find((u) => u.id === activeHeader)?.id || targetUnits[0]?.id || 0;
        setPendingFolderPick({
          files: filesToUpload,
          rootName: selectedRootName,
          immediateSubfolders,
          subfoldersCount: subfoldersSet.size,
          totalSubfolderFiles: filesToUpload.length,
          skippedRootFiles,
          selectedUnitId: defaultPick ? String(defaultPick) : '',
        });
        if (dirInputRef.current) dirInputRef.current.value = '';
        return;
      }
    }

    setPendingFolderPick(null);
    await runBrowserFolderSync({
      filesToUpload,
      selectedRootName,
      subfoldersCount: subfoldersSet.size,
      skippedRootFiles,
      explicitUnitId,
    });
  };

  const handlePurgeBucket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (purgeConfirmText.trim().toUpperCase() !== 'APAGAR BUCKET R2') {
      onToast('Digite exatamente "APAGAR BUCKET R2" para confirmar a exclusão.');
      return;
    }
    setPurging(true);
    try {
      const res = await apiFetch<{
        ok: boolean;
        bucketName: string;
        r2DeletedCount: number;
        localDeletedCount: number;
        dbDocumentsDeleted: number;
        dbBatchesDeleted: number;
      }>('/api/migration/purge-bucket', {
        method: 'POST',
        body: JSON.stringify({ confirmPhrase: 'APAGAR BUCKET R2' }),
      });
      setPurgeModalOpen(false);
      setPurgeConfirmText('');
      setSelectedBatchId(null);
      setItems([]);
      setItemFilter('all');
      dismissR2SyncBanner();
      await loadBatchesAndTargets(false);
      onToast(
        `Limpeza do bucket "${res.bucketName}" concluída: ${res.r2DeletedCount} objeto(s) R2, ${res.localDeletedCount} arquivo(s) locais, ${res.dbDocumentsDeleted} registro(s) de pastas/documentos e ${res.dbBatchesDeleted} lote(s) apagados.`
      );
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Erro ao apagar pastas e arquivos do bucket R2.');
    } finally {
      setPurging(false);
    }
  };

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
        Carregando informações do cofre R2 e sessões de envio...
      </div>
    );
  }

  const batchStatusInfo = selectedBatch ? getBatchHumanStatus(selectedBatch.status) : null;

  return (
    <div className="space-y-4 text-xs">
      {/* Top 4 Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center justify-between text-[11px] font-semibold text-slate-600 dark:text-slate-300">
            <span>Cofre de Arquivos (Bucket R2)</span>
            <CloudUpload className="w-4 h-4 text-emerald-700 dark:text-emerald-300" />
          </div>
          <div className="mt-1.5 font-mono text-base font-bold text-slate-900 dark:text-slate-100">
            {bucketStats?.bucketName || 'bucketdainvicta'}
          </div>
          <div className="mt-1 text-[11px] text-slate-600 dark:text-slate-300">
            {bucketStats?.backend === 'cloudflare_r2' || bucketStats?.activeBackend === 'CLOUDFLARE_R2'
              ? 'Conectado ao Cloudflare R2 externo'
              : bucketStats?.r2Configured === false
              ? 'Cofre Local Criptografado AES-256 (chaves Cloudflare R2 não configuradas)'
              : 'Cofre Criptografado AES-256 (Ativo)'}
          </div>
          <div className="mt-2.5 pt-2 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              disabled={purging || Boolean(browserSync?.running)}
              onClick={() => {
                setPurgeConfirmText('');
                setPurgeModalOpen(true);
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 bg-red-50 px-2.5 py-1.5 text-[11px] font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50 whitespace-nowrap shrink-0 dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300 dark:hover:bg-red-900/60"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Apagar Pastas do Bucket R2
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center justify-between text-[11px] font-semibold text-slate-600 dark:text-slate-300">
            <span>Arquivos &amp; Espaço Guardado</span>
            <HardDrive className="w-4 h-4 text-slate-700 dark:text-slate-300" />
          </div>
          <div className="mt-1.5 font-mono text-base font-bold text-slate-900 tabular-nums dark:text-slate-100">
            {bucketStats?.totalObjects ?? integrativeStats?.documentsTotal ?? 0} arq. ·{' '}
            {formatBytes(bucketStats?.totalLogicalBytes ?? bucketStats?.physicalBytesUsed ?? 0)}
          </div>
          <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            {bucketStats?.physicalObjectsCount ?? 0} objeto(s) físico(s) · Deduplicação SHA-256
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center justify-between text-[11px] font-semibold text-slate-600 dark:text-slate-300">
            <span>Dossiês com Código Único</span>
            <ShieldCheck className="w-4 h-4 text-emerald-700 dark:text-emerald-300" />
          </div>
          <div className="mt-1.5 font-mono text-base font-bold text-slate-900 tabular-nums dark:text-slate-100">
            {integrativeStats?.admissionsWithCode || 0} / {integrativeStats?.admissionsTotal || 0}
          </div>
          <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            Identificação protegida por cliente e filial
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center justify-between text-[11px] font-semibold text-slate-600 dark:text-slate-300">
            <span>Documentos com Código Único</span>
            <KeyRound className="w-4 h-4 text-blue-700 dark:text-blue-300" />
          </div>
          <div className="mt-1.5 font-mono text-base font-bold text-slate-900 tabular-nums dark:text-slate-100">
            {integrativeStats?.documentsWithCode || 0} / {integrativeStats?.documentsTotal || 0}
          </div>
          <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            Link interno seguro sem expor pastas
          </div>
        </div>
      </div>

      {/* Plain-Language Guide: Quando usar quem? + Qual caminho usar? */}
      <div className="rounded-xl border-2 border-slate-300 bg-white p-4 text-black shadow-xs">
        <div className="flex items-center gap-2 border-b border-slate-200 pb-2 mb-3">
          <Info className="w-4 h-4 text-blue-700 shrink-0" />
          <h3 className="font-display text-sm font-bold text-black">
            Guia Rápido: Quando usar cada quadro e qual pasta informar?
          </h3>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 text-xs leading-relaxed text-black">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-1.5">
            <div className="font-bold text-black">
              1. Quadro da Esquerda — &quot;Enviar Pastas do Windows para o R2&quot;
            </div>
            <p className="text-black">
              <strong>Quando usar:</strong> Sempre que você quiser subir ou atualizar documentos das pastas do computador para o cofre R2.
            </p>
            <p className="text-black">
              <strong>Como funciona a pasta de origem:</strong> Ao selecionar a pasta de origem, o sistema ignora o invólucro externo e foca na criação das <strong>subpastas e do conteúdo delas</strong>:
            </p>
            <div className="rounded border border-emerald-300 bg-emerald-50 px-2.5 py-1.5 font-mono text-[11px] text-black space-y-0.5">
              <div>
                <strong>Multi-filiais:</strong> {DEFAULT_WINDOWS_ROOT} (cria subpastas por filial)
              </div>
              <div className="text-emerald-900">
                <strong>Filial ou pasta direta:</strong> {DEFAULT_WINDOWS_ROOT}\FOR - FORTALEZA - CE (cria subpastas ADMINISTRAÇÃO, CLIENTES...)
              </div>
            </div>
            <p className="text-[11px] text-black">
              O sistema identifica automaticamente a Unidade, percorre todas as subpastas (ADMINISTRATIVO, COMERCIAL, modelos e dossiês), separa clientes pelo contrato e preserva a árvore completa.
            </p>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-1.5">
            <div className="font-bold text-black">
              2. Quadro da Direita — &quot;Selos de Segurança e Consulta de Códigos&quot;
            </div>
            <p className="text-black">
              <strong>Quando usar:</strong> Apenas <strong>depois</strong> que os clientes já estiverem importados ou após terminar o envio das pastas, se quiser criar ou conferir um código único de rastreio (ex.: <span className="font-mono font-semibold">INV-FOR-DOSS-...</span>).
            </p>
            <p className="text-black">
              <strong>Para subir pastas agora:</strong> você <strong>não precisa mexer no quadro da direita</strong> — use apenas o quadro da esquerda e os botões do painel de progresso logo abaixo.
            </p>
          </div>
        </div>
      </div>

      {/* Left: Upload Windows Folders | Right: HMAC Seals */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <form
          onSubmit={handleCreateBatch}
          className="lg:col-span-7 rounded-xl border border-slate-200 bg-white p-4 space-y-3 dark:border-slate-700 dark:bg-slate-900"
        >
          <div className="flex items-center justify-between border-b border-slate-100 pb-2.5 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <FolderSync className="w-4 h-4 text-slate-800 dark:text-slate-100" />
              <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                1. Enviar Pastas do Windows para o Cofre R2
              </h3>
            </div>
            <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">Passo 1 de 3</span>
          </div>

          <p className="text-slate-700 leading-relaxed dark:text-slate-300">
            Informe a <strong>pasta-mãe das filiais</strong> no servidor Windows. O programa lê todas as subpastas, identifica a Unidade e o Contrato de cada cliente, evita arquivos repetidos e envia somente o que for novo ou alterado.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <div className="sm:col-span-2">
              <label className="block font-semibold text-slate-800 mb-1 dark:text-slate-200">
                Nome deste envio (para sua organização)
              </label>
              <input
                type="text"
                required
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900 dark:border-slate-700 dark:text-slate-100 dark:bg-slate-950"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-800 mb-1 dark:text-slate-200">
                O que enviar?
              </label>
              <select
                value={newSyncMode}
                onChange={(e) => setNewSyncMode(e.target.value as 'incremental' | 'mirror_review')}
                className="w-full rounded-lg border border-slate-200 px-2.5 py-2 font-semibold text-slate-800 dark:border-slate-700 dark:text-slate-100 dark:bg-slate-950"
              >
                <option value="incremental">Novos e Alterados (Recomendado)</option>
                <option value="mirror_review">Espelho Completo (Com Revisão)</option>
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex flex-col sm:flex-row sm:items-end gap-2.5">
              <div className="flex-1">
                <label className="block font-semibold text-slate-800 mb-1 dark:text-slate-200">
                  Pasta-mãe das Unidades no Windows (sem entrar na pasta da filial)
                </label>
                <input
                  type="text"
                  value={newSourcePath}
                  onChange={(e) => setNewSourcePath(e.target.value)}
                  placeholder={DEFAULT_WINDOWS_ROOT}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-slate-900 dark:border-slate-700 dark:text-slate-100 dark:bg-slate-950"
                />
              </div>
              <button
                type="submit"
                disabled={busy}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white hover:bg-slate-800 whitespace-nowrap dark:bg-emerald-600 dark:hover:bg-emerald-500"
              >
                <Plus className="w-3.5 h-3.5" />
                Criar Sessão de Envio
              </button>
            </div>

            {tailUnitWarning && (
              <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-950 dark:border-blue-800/70 dark:bg-blue-950/40 dark:text-blue-200">
                <strong>Filial identificada diretamente no caminho:</strong>{' '}
                <span className="font-mono font-bold">{tailUnitWarning.matchedUnitLabel}</span>. Ao executar o envio, o sistema focará em criar as <strong>subpastas internas</strong> (ex.: ADMINISTRAÇÃO, COMERCIAL, clientes) e o conteúdo delas nesta unidade.
              </div>
            )}
          </div>
        </form>

        {/* Integrative HMAC Standardization & Resolver */}
        <div className="lg:col-span-5 rounded-xl border border-slate-200 bg-white p-4 space-y-3 dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2.5 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-700 dark:text-emerald-300" />
              <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                2. Selos de Segurança e Consulta de Códigos
              </h3>
            </div>
            <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">Opcional / Pós-carga</span>
          </div>

          <p className="text-slate-700 leading-relaxed dark:text-slate-300">
            Use este bloco <strong>após subir arquivos ou importar planilhas/PDFs</strong> para gerar códigos únicos protegidos (sem expor caminhos de pastas) ou localizar rapidamente a quem pertence um código.
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={sealUnitFilter}
              onChange={(e) => setSealUnitFilter(e.target.value)}
              className="rounded-lg border border-slate-200 px-2.5 py-1.5 font-semibold text-slate-800 dark:border-slate-700 dark:text-slate-100 dark:bg-slate-950"
            >
              <option value="all">Todas as Unidades</option>
              {targetUnits.map((u) => (
                <option key={u.id} value={String(u.id)}>
                  {u.code} · {u.name}
                </option>
              ))}
            </select>
            <label className="inline-flex items-center gap-1.5 cursor-pointer text-slate-700 dark:text-slate-200">
              <input
                type="checkbox"
                checked={sealOverwrite}
                onChange={(e) => setSealOverwrite(e.target.checked)}
              />
              <span>Recriar códigos existentes</span>
            </label>
            <button
              type="button"
              disabled={busy}
              onClick={handleSealIntegrativeCodes}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-1.5 font-semibold text-white hover:bg-emerald-800 whitespace-nowrap ml-auto"
            >
              <KeyRound className="w-3.5 h-3.5" />
              Aplicar Selos nos Faltantes
            </button>
          </div>

          <form onSubmit={handleTestIntegrativeCode} className="pt-2 border-t border-slate-100 space-y-2 dark:border-slate-800">
            <label className="block font-semibold text-slate-800 dark:text-slate-200">
              Consultar / Conferir um Código Gerado
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={hmacQueryCode}
                onChange={(e) => setHmacQueryCode(e.target.value)}
                placeholder="Ex: INV-FOR-DOSS-000001-A1B2C3D4"
                className="flex-1 rounded-lg border border-slate-200 px-3 py-1.5 font-mono uppercase text-slate-900 dark:border-slate-700 dark:text-slate-100 dark:bg-slate-950"
              />
              <button
                type="submit"
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 font-semibold text-slate-800 hover:bg-slate-100 whitespace-nowrap dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
              >
                <Search className="w-3.5 h-3.5" />
                Consultar Código
              </button>
            </div>
            {hmacResolveError && (
              <div className="rounded border border-red-200 bg-red-50 px-2.5 py-1.5 text-[11px] text-red-700 dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300">
                {hmacResolveError}
              </div>
            )}
            {hmacResolveResult && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-2.5 text-[11px] space-y-1 dark:border-emerald-800/70 dark:bg-emerald-950/50">
                <div className="flex items-center justify-between font-semibold text-emerald-900 dark:text-emerald-300">
                  <span className="inline-flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Código Válido e Autêntico ({String(hmacResolveResult.type)})
                  </span>
                  {hmacResolveResult.type === 'DOC' && (
                    <button
                      type="button"
                      onClick={() =>
                        handleDownloadByIntegrativeCode(String(hmacResolveResult.integrativeCode))
                      }
                      className="underline font-semibold text-emerald-800 dark:text-emerald-300"
                    >
                      Baixar Arquivo
                    </button>
                  )}
                </div>
                <pre className="font-mono text-[10px] text-slate-800 overflow-x-auto max-h-24 dark:text-slate-200">
                  {JSON.stringify(hmacResolveResult, null, 2)}
                </pre>
              </div>
            )}
          </form>
        </div>
      </div>

      {/* Direct Browser Folder Sync — always available even when no batch exists yet */}
      <div className="rounded-xl border-2 border-emerald-400 bg-emerald-50/70 p-4 text-black space-y-3 dark:border-emerald-700 dark:bg-emerald-950/30 dark:text-slate-100">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div>
            <div className="font-display text-xs font-bold text-slate-900 dark:text-emerald-200">
              Envio Direto pelo Navegador — Selecionar Pasta de Origem (Foco em Subpastas e Conteúdo)
            </div>
            <p className="text-[11px] text-slate-700 mt-0.5 leading-relaxed dark:text-slate-300">
              Ao selecionar a pasta de origem no seu computador, o sistema mantém apenas a estrutura de <strong>subpastas e seus conteúdos</strong> no cofre <strong>{bucketStats?.bucketName || 'bucketdainvicta'}</strong> (sem duplicar a pasta externa selecionada), vincula clientes/admissões automaticamente e atualiza os contadores em tempo real.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <select
              value={browserTargetUnitId}
              disabled={Boolean(browserSync?.running)}
              onChange={(e) => setBrowserTargetUnitId(e.target.value)}
              title="Unidade de destino caso as subpastas não tenham prefixo de filial"
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-[11px] font-semibold text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              <option value="auto">Unidade: Detectar automaticamente</option>
              {targetUnits.map((u) => (
                <option key={u.id} value={String(u.id)}>
                  Enviar subpastas para: {u.code} · {u.name}
                </option>
              ))}
            </select>
            <input
              ref={dirInputRef}
              type="file"
              multiple
              {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
              className="hidden"
              onChange={(e) => handleBrowserFolderSelected(e.target.files)}
            />
            {browserSync?.running ? (
              <button
                type="button"
                disabled={browserSync.cancelling}
                onClick={() => void cancelBrowserFolderSync()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-red-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-red-800 disabled:opacity-60 whitespace-nowrap shrink-0"
              >
                <Square className="w-3.5 h-3.5" />
                {browserSync.cancelling ? 'Cancelando Processo...' : 'Cancelar Processo'}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => dirInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-800 whitespace-nowrap shrink-0"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                Selecionar Pasta de Origem e Enviar
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4 text-[11px] font-semibold text-slate-800 dark:text-slate-200">
          <label className="inline-flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={browserSubfoldersOnly}
              disabled={Boolean(browserSync?.running)}
              onChange={(e) => setBrowserSubfoldersOnly(e.target.checked)}
            />
            <span>Concentrar apenas nas subpastas e no conteúdo delas (ignorar arquivos soltos na raiz)</span>
          </label>
          <label className="inline-flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={browserDryRun}
              disabled={Boolean(browserSync?.running)}
              onChange={(e) => setBrowserDryRun(e.target.checked)}
            />
            <span>Apenas simular (sem gravar)</span>
          </label>
          {selectedBatch && (
            <span className="ml-auto font-mono text-[11px] text-slate-600 dark:text-slate-300">
              Sessão ativa: <strong>{selectedBatch.batchCode}</strong>
            </span>
          )}
        </div>

        {pendingFolderPick && (
          <div className="rounded-lg border-2 border-amber-400 bg-white p-3.5 text-slate-900 space-y-2.5 dark:border-amber-700 dark:bg-slate-900 dark:text-slate-100">
            <div className="font-display text-xs font-bold">
              Confirmar Unidade de Destino para as Subpastas de &quot;{pendingFolderPick.rootName}&quot;
            </div>
            <p className="text-[11px] text-slate-700 leading-relaxed dark:text-slate-300">
              Foram detectadas <strong>{pendingFolderPick.subfoldersCount} subpasta(s)</strong> (
              <strong>{pendingFolderPick.totalSubfolderFiles} arquivo(s)</strong>
              {pendingFolderPick.skippedRootFiles > 0
                ? `, mais ${pendingFolderPick.skippedRootFiles} solto(s) na raiz ignorado(s)`
                : ''}
              ) sem prefixo de filial no nome. Selecione abaixo em qual Unidade essas subpastas devem ser criadas:
            </p>
            {pendingFolderPick.immediateSubfolders.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {pendingFolderPick.immediateSubfolders.slice(0, 8).map((sub) => (
                  <span
                    key={sub}
                    className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-[10px] text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                  >
                    {sub}
                  </span>
                ))}
                {pendingFolderPick.immediateSubfolders.length > 8 && (
                  <span className="font-mono text-[10px] text-slate-500 dark:text-slate-400">
                    +{pendingFolderPick.immediateSubfolders.length - 8} subpasta(s)
                  </span>
                )}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <select
                value={pendingFolderPick.selectedUnitId}
                onChange={(e) =>
                  setPendingFolderPick((prev) => (prev ? { ...prev, selectedUnitId: e.target.value } : null))
                }
                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              >
                {targetUnits.map((u) => (
                  <option key={u.id} value={String(u.id)}>
                    {u.code} · {u.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={!pendingFolderPick.selectedUnitId}
                onClick={async () => {
                  const pick = pendingFolderPick;
                  setPendingFolderPick(null);
                  await runBrowserFolderSync({
                    filesToUpload: pick.files,
                    selectedRootName: pick.rootName,
                    subfoldersCount: pick.subfoldersCount,
                    skippedRootFiles: pick.skippedRootFiles,
                    explicitUnitId: Number(pick.selectedUnitId),
                  });
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                Criar Subpastas e Enviar Agora
              </button>
              <button
                type="button"
                onClick={() => setPendingFolderPick(null)}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Cancelar
              </button>
            </div>
          </div>
        )}

        {browserSync && (
          <div className="rounded-lg border-2 border-emerald-500/60 bg-white p-3.5 text-black space-y-2.5 dark:border-emerald-700 dark:bg-slate-900 dark:text-slate-100">
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono tabular-nums">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 font-semibold">
                  {browserSync.running && (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-700 dark:text-emerald-300" />
                  )}
                  {browserSync.running
                    ? browserSync.cancelling
                      ? 'Cancelando'
                      : browserSync.dryRun
                      ? 'Simulação em andamento'
                      : 'Enviando em 2º plano'
                    : browserSync.cancelled
                    ? 'Processo Cancelado'
                    : 'Processo Concluído'}{' '}
                  · {browserSync.rootLabel} · {browserSync.subfoldersCount} subpasta(s)
                </span>
                {browserSync.running && (
                  <span className="inline-flex items-center gap-1 rounded border border-emerald-300 bg-emerald-50 px-2 py-0.5 font-sans text-[10px] font-semibold text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
                    <ShieldCheck className="w-3 h-3" />
                    Inatividade suspensa
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                <span className="font-bold">
                  {browserSync.processedFiles} / {browserSync.totalFiles} arquivos (
                  {browserSync.totalFiles > 0
                    ? Math.round((browserSync.processedFiles / browserSync.totalFiles) * 100)
                    : 0}
                  %)
                </span>
                {browserSync.running ? (
                  <button
                    type="button"
                    disabled={browserSync.cancelling}
                    onClick={() => void cancelBrowserFolderSync()}
                    className="inline-flex items-center gap-1 rounded-md bg-red-700 px-2.5 py-1 font-sans text-[11px] font-semibold text-white hover:bg-red-800 disabled:opacity-60"
                  >
                    <Square className="w-3 h-3" />
                    {browserSync.cancelling ? 'Cancelando...' : 'Cancelar Processo'}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={dismissR2SyncBanner}
                    title="Limpar resumo desta tela"
                    className="rounded border border-slate-200 px-2 py-0.5 font-sans text-[10px] font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                  >
                    Ocultar
                  </button>
                )}
              </div>
            </div>

            <progress
              value={browserSync.processedFiles}
              max={Math.max(1, browserSync.totalFiles)}
              className="w-full h-2.5 accent-emerald-700 rounded-full overflow-hidden"
            />

            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-mono tabular-nums">
              <span>Novos: <strong>{browserSync.created}</strong></span>
              <span>Atualizados: <strong>{browserSync.updated}</strong></span>
              <span>Movidos: <strong>{browserSync.moved}</strong></span>
              <span>Deduplicados: <strong>{browserSync.deduplicated}</strong></span>
              <span>Sem Contrato: <strong>{browserSync.unmatched}</strong></span>
              <span>Ignorados: <strong>{browserSync.blocked}</strong></span>
              {browserSync.skippedRootFiles > 0 && (
                <span>Soltos na raiz ignorados: <strong>{browserSync.skippedRootFiles}</strong></span>
              )}
              <span>Falhas: <strong className={browserSync.failed > 0 ? 'text-red-700 dark:text-red-400' : ''}>{browserSync.failed}</strong></span>
            </div>

            {/* Pastas e Arquivos em Processamento Agora */}
            {(browserSync.currentFolderPath ||
              browserSync.activeFolders.length > 0 ||
              browserSync.processingEntries.length > 0) && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 space-y-2 dark:border-slate-700 dark:bg-slate-950/60">
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                  <span className="inline-flex items-center gap-1.5 font-bold text-slate-800 dark:text-slate-200">
                    <FolderOpen className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400 shrink-0" />
                    Pasta em processamento:{' '}
                    <span className="font-mono font-semibold text-emerald-800 dark:text-emerald-300">
                      {browserSync.currentFolderPath || browserSync.rootLabel}
                    </span>
                  </span>
                  {browserSync.activeFolders.length > 1 && (
                    <span className="font-mono text-[10px] text-slate-500 dark:text-slate-400">
                      {browserSync.activeFolders.length} subpasta(s) recentes
                    </span>
                  )}
                </div>

                {browserSync.activeFolders.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {browserSync.activeFolders.map((folder) => (
                      <span
                        key={folder}
                        className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-0.5 font-mono text-[10px] text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                      >
                        <FolderOpen className="w-3 h-3 text-emerald-600 dark:text-emerald-400 shrink-0" />
                        {folder}
                      </span>
                    ))}
                  </div>
                )}

                {browserSync.processingEntries.length > 0 && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5 max-h-40 overflow-y-auto pr-0.5">
                    {browserSync.processingEntries.map((entry) => {
                      const badge = getStageBadgeInfo(entry.stage);
                      return (
                        <div
                          key={entry.id}
                          className="flex items-center justify-between gap-2 rounded border border-slate-200 bg-white px-2.5 py-1.5 text-[10px] dark:border-slate-800 dark:bg-slate-900"
                        >
                          <div className="flex items-center gap-1.5 min-w-0">
                            <FileText className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            <div className="min-w-0">
                              <div className="font-mono font-semibold text-slate-900 dark:text-slate-100 truncate">
                                {entry.fileName}
                              </div>
                              <div className="font-mono text-[9px] text-slate-500 dark:text-slate-400 truncate">
                                {entry.folderPath} · {formatBytes(entry.sizeBytes)}
                              </div>
                            </div>
                          </div>
                          <span
                            className={`rounded px-1.5 py-0.5 font-mono text-[9px] font-semibold shrink-0 ${badge.cls}`}
                          >
                            {badge.label}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {browserSync.lastError && (
              <div className="text-[11px] text-red-700 font-semibold dark:text-red-400">
                Último erro registrado: {browserSync.lastError}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Selected Batch Windows Agent Runner, Progress Tracker & Live Telemetry */}
      {selectedBatch && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-4 dark:border-slate-700 dark:bg-slate-900">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-slate-100 pb-3 dark:border-slate-800">
            <div className="flex flex-wrap items-center gap-2.5">
              <Terminal className="w-4 h-4 text-slate-800 dark:text-slate-100" />
              <div>
                <div className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                  {selectedBatch.batchCode} · {selectedBatch.title}
                </div>
                <div className="text-[11px] text-slate-600 dark:text-slate-300">
                  {batchStatusInfo?.label}
                  {selectedBatch.lastHeartbeatAt
                    ? ` · Último sinal do Windows: ${new Date(selectedBatch.lastHeartbeatAt).toLocaleString('pt-BR')}`
                    : ''}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => handleDownloadAgentFile(selectedBatch, 'mjs')}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-1.5 font-semibold text-white hover:bg-emerald-800 whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5" />
                1º Baixar Programa (.mjs)
              </button>
              <button
                type="button"
                onClick={() => handleDownloadAgentFile(selectedBatch, 'bat')}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-semibold text-black hover:bg-slate-100 whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5" />
                2º Baixar Atalho (.bat)
              </button>
              <button
                type="button"
                onClick={() => handleCopyCommand(selectedBatch)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 font-semibold text-slate-800 hover:bg-slate-100 whitespace-nowrap dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
              >
                {copiedKey === `cmd-${selectedBatch.id}` ? (
                  <Check className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-300" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
                Copiar Comando
              </button>
              {(selectedBatch.status === 'aguardando_agente' || selectedBatch.status === 'em_andamento') && (
                <button
                  type="button"
                  onClick={async () => {
                    await cancelBrowserFolderSync(selectedBatch.id);
                    onToast(`Sessão ${selectedBatch.batchCode} cancelada.`);
                    await Promise.all([loadBatchesAndTargets(false), loadItems(false)]);
                  }}
                  className="inline-flex items-center gap-1 rounded-lg bg-red-700 px-2.5 py-1.5 font-semibold text-white hover:bg-red-800 whitespace-nowrap"
                >
                  <Square className="w-3.5 h-3.5" />
                  Cancelar Processo
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  loadBatchesAndTargets(false);
                  loadItems(false);
                }}
                title="Atualizar progresso agora"
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Atualizar
              </button>
            </div>
          </div>

          {/* Sinalizador Visual de Progresso */}
          <div className="rounded-lg border-2 border-slate-300 bg-white p-3.5 text-black space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-display text-xs font-bold text-black">
                Sinalizador de Progresso do Envio
              </div>
              <div className="font-mono text-xs font-bold text-black tabular-nums">
                {progressMetrics.pct}% concluído ({progressMetrics.processedCount} /{' '}
                {selectedBatch.totalFilesScanned} arquivos)
              </div>
            </div>

            <progress
              value={progressMetrics.pct}
              max={100}
              className="w-full h-3 accent-emerald-700 rounded-full overflow-hidden"
            />

            {/* 3 Etapas Visuais */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px]">
              <div
                className={`rounded-md border px-2.5 py-2 ${
                  progressMetrics.step1Done
                    ? 'border-emerald-400 bg-emerald-50 text-black'
                    : 'border-slate-200 bg-slate-50 text-black'
                }`}
              >
                <div className="font-bold text-black">
                  Etapa 1 · Sessão Criada ({progressMetrics.step1Done ? 'OK' : 'Pendente'})
                </div>
                <div className="text-black">Token e código {selectedBatch.batchCode} prontos.</div>
              </div>

              <div
                className={`rounded-md border px-2.5 py-2 ${
                  progressMetrics.step2Done
                    ? 'border-emerald-400 bg-emerald-50 text-black'
                    : 'border-amber-400 bg-amber-50 text-black'
                }`}
              >
                <div className="font-bold text-black">
                  Etapa 2 · Execução no Windows (
                  {progressMetrics.step2Done ? 'Conectado' : 'Aguardando você iniciar'})
                </div>
                <div className="text-black">
                  {progressMetrics.step2Done
                    ? 'O computador Windows já iniciou a leitura da pasta.'
                    : 'Use o botão verde acima ou execute os 2 arquivos (.mjs e .bat) no servidor Windows.'}
                </div>
              </div>

              <div
                className={`rounded-md border px-2.5 py-2 ${
                  progressMetrics.step3Done
                    ? 'border-emerald-400 bg-emerald-50 text-black'
                    : selectedBatch.status === 'em_andamento'
                    ? 'border-blue-400 bg-blue-50 text-black'
                    : 'border-slate-200 bg-slate-50 text-black'
                }`}
              >
                <div className="font-bold text-black">
                  Etapa 3 · Separação &amp; Envio R2 (
                  {progressMetrics.step3Done
                    ? 'Finalizado'
                    : selectedBatch.status === 'em_andamento'
                    ? 'Em andamento'
                    : 'Na fila'}
                  )
                </div>
                <div className="text-black">
                  Cria subpastas por Unidade, Contrato e Admissão e envia ao bucket R2.
                </div>
              </div>
            </div>

            <p className="text-xs leading-relaxed text-black">
              {batchStatusInfo?.description}
            </p>
          </div>

          {selectedBatchTailWarning && (
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-blue-950 text-xs leading-relaxed dark:border-blue-800/70 dark:bg-blue-950/40 dark:text-blue-200">
              <strong>Modo filial direta ({selectedBatchTailWarning.matchedUnitLabel}):</strong>{' '}
              ao selecionar esta pasta de origem, as subpastas internas e o conteúdo delas serão criados diretamente dentro desta unidade.
            </div>
          )}

          {/* High-Contrast Box — Windows CLI Mode (.mjs / .bat) */}
          <div className="rounded-lg border-2 border-slate-300 bg-white p-4 text-black space-y-2.5">
            <div className="font-display text-xs font-bold text-black">
              Alternativa via Prompt/CLI Windows (.mjs / .bat — Somente URL Publicada sem Proxy Google):
            </div>

            {isAiStudioProxyHost && (
              <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2.5 text-[11px] leading-relaxed text-red-950">
                <strong>Causa do erro de HTML no Windows neste endereço ({window.location.hostname}):</strong>{' '}
                os links de pré-visualização (<span className="font-mono">ais-dev-*</span> / <span className="font-mono">ais-pre-*</span>) possuem bloqueio de login Google na entrada do proxy. Quando o terminal Windows executa o <span className="font-mono">.bat/.mjs</span> sem o cookie do navegador, o Google intercepta a requisição antes de chegar no servidor e devolve uma página HTML de login.
                <br />
                <strong>Recomendação nesta tela:</strong> utilize o botão verde{' '}
                <strong>&quot;Selecionar Pasta de Origem e Enviar&quot;</strong> acima (usa sua sessão já autenticada, sem erro HTML, com reenvio automático em caso de oscilação e suporte completo a subpastas). O <span className="font-mono">.bat/.mjs</span> só deve ser usado após publicar em domínio próprio/público ou passando <span className="font-mono">--cookie</span>.
              </div>
            )}

            <p className="text-[11px] leading-relaxed text-black">
              O script Windows já inclui codificação <span className="font-mono font-semibold">UTF-8 (chcp 65001)</span> para nomes de pastas com acentos, reenvio automático por lote e diagnóstico imediato de bloqueio HTML. Caso queira usar no domínio de pré-visualização avançado, é necessário passar <span className="font-mono font-semibold">--cookie &quot;...&quot;</span> ou <span className="font-mono font-semibold">--server &lt;url_publica&gt;</span>.
            </p>
            <ol className="list-decimal list-inside space-y-1 text-xs leading-relaxed text-black">
              <li>
                Baixe os dois arquivos acima (<strong>1º Programa .mjs</strong> e <strong>2º Atalho .bat</strong>) na mesma pasta no servidor Windows.
              </li>
              <li>
                Dê duplo clique em <span className="font-mono font-semibold">executar-{selectedBatch.batchCode}.bat</span> (caminho padrão: <span className="font-mono font-semibold">{sanitizeWindowsPath(selectedBatch.sourceRootPath || DEFAULT_WINDOWS_ROOT)}</span>).
              </li>
              <li>
                Comando equivalente sem barra invertida no final:
              </li>
            </ol>

            <div className="rounded-md border border-slate-300 bg-slate-100 px-3 py-2.5 font-mono text-xs font-bold text-black select-all overflow-x-auto">
              {getCleanCommandForBatch(selectedBatch)}
            </div>

            <div className="text-[11px] leading-relaxed text-black">
              <strong>Observação sobre --dry-run:</strong> o parâmetro <span className="font-mono font-semibold">--dry-run</span> apenas simula no terminal e não grava dados nem altera a numeração na tela do sistema. Para envio definitivo, rode sem <span className="font-mono font-semibold">--dry-run</span>.
            </div>
          </div>

          {/* Live Counters */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 dark:border-slate-700 dark:bg-slate-800">
              <div className="text-[10px] text-slate-600 dark:text-slate-300">Escaneados</div>
              <div className="font-mono font-bold text-slate-900 tabular-nums dark:text-slate-100">{selectedBatch.totalFilesScanned}</div>
            </div>
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 px-2.5 py-2 dark:border-emerald-800/70 dark:bg-emerald-950/50">
              <div className="text-[10px] text-emerald-700 dark:text-emerald-300">Novos Enviados</div>
              <div className="font-mono font-bold text-emerald-800 tabular-nums dark:text-emerald-300">{selectedBatch.createdCount}</div>
            </div>
            <div className="rounded-lg border border-blue-200 bg-blue-50/60 px-2.5 py-2 dark:border-blue-800/70 dark:bg-blue-950/50">
              <div className="text-[10px] text-blue-700 dark:text-blue-300">Atualizados</div>
              <div className="font-mono font-bold text-blue-800 tabular-nums dark:text-blue-300">{selectedBatch.updatedContentCount}</div>
            </div>
            <div className="rounded-lg border border-blue-200 bg-blue-50/40 px-2.5 py-2 dark:border-blue-800/70 dark:bg-blue-950/50">
              <div className="text-[10px] text-blue-700 dark:text-blue-300">Pastas Movidas</div>
              <div className="font-mono font-bold text-blue-800 tabular-nums dark:text-blue-300">{selectedBatch.updatedPathCount}</div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 dark:border-slate-700 dark:bg-slate-800">
              <div className="text-[10px] text-slate-600 dark:text-slate-300">Já no Cofre</div>
              <div className="font-mono font-bold text-slate-900 tabular-nums dark:text-slate-100">{selectedBatch.deduplicatedCount}</div>
            </div>
            <div className="rounded-lg border border-indigo-200 bg-indigo-50/60 px-2.5 py-2 dark:border-indigo-800/70 dark:bg-indigo-950/40">
              <div className="text-[10px] text-indigo-800 dark:text-indigo-300">Gerais da Unidade</div>
              <div className="font-mono font-bold text-indigo-900 tabular-nums dark:text-indigo-200">{selectedBatch.unitFilesCount || 0}</div>
            </div>
            <div className="rounded-lg border border-teal-200 bg-teal-50/60 px-2.5 py-2 dark:border-teal-800/70 dark:bg-teal-950/40">
              <div className="text-[10px] text-teal-800 dark:text-teal-300">Interligados (Subpasta + Contrato)</div>
              <div className="font-mono font-bold text-teal-900 tabular-nums dark:text-teal-200">{selectedBatch.interlinkedCount || 0}</div>
            </div>
            <div className="rounded-lg border border-amber-200 bg-amber-50/70 px-2.5 py-2 dark:border-amber-800/70 dark:bg-amber-950/50">
              <div className="text-[10px] text-amber-800 dark:text-amber-300">Sem Contrato</div>
              <div className="font-mono font-bold text-amber-900 tabular-nums dark:text-amber-300">{selectedBatch.unmatchedCount}</div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 dark:border-slate-700 dark:bg-slate-800">
              <div className="text-[10px] text-slate-600 dark:text-slate-300">Ignorados (.bat/exe)</div>
              <div className="font-mono font-bold text-slate-700 tabular-nums dark:text-slate-200">{selectedBatch.blockedCount}</div>
            </div>
            <div className="rounded-lg border border-red-200 bg-red-50/60 px-2.5 py-2 dark:border-red-800/70 dark:bg-red-950/50">
              <div className="text-[10px] text-red-700 dark:text-red-300">Falhas</div>
              <div className="font-mono font-bold text-red-800 tabular-nums dark:text-red-300">{selectedBatch.failedCount}</div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-slate-600 dark:text-slate-300">
            <span>
              Lido no Windows: <strong>{formatBytes(selectedBatch.totalBytesScanned)}</strong> · Enviado ao R2:{' '}
              <strong>{formatBytes(selectedBatch.uploadedBytes)}</strong> · Economizado sem duplicar:{' '}
              <strong className="text-emerald-700 dark:text-emerald-300">{formatBytes(selectedBatch.savedBytesByDedup)}</strong>
            </span>
          </div>

          {/* Filter tabs for Batch Items */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  { id: 'all', label: 'Todos os Arquivos' },
                  { id: 'unit', label: `Gerais da Unidade (${selectedBatch.unitFilesCount || 0})` },
                  { id: 'interlinked', label: `Interligados (${selectedBatch.interlinkedCount || 0})` },
                  { id: 'unmatched', label: `Sem Contrato (${selectedBatch.unmatchedCount})` },
                  { id: 'updated', label: 'Atualizados / Movidos' },
                  { id: 'created', label: 'Novos' },
                  { id: 'blocked', label: 'Ignorados' },
                  { id: 'failed', label: 'Falhas' },
                ] as const
              ).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setItemFilter(f.id)}
                  className={`rounded-md border px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap shrink-0 ${
                    itemFilter === f.id
                      ? 'border-slate-900 bg-slate-900 text-white dark:border-emerald-500 dark:bg-emerald-600'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
            {batches.length > 1 && (
              <select
                value={String(selectedBatchId || '')}
                onChange={(e) => setSelectedBatchId(Number(e.target.value))}
                className="rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-800 dark:border-slate-700 dark:text-slate-100 dark:bg-slate-950"
              >
                {batches.map((b) => (
                  <option key={b.id} value={String(b.id)}>
                    {b.batchCode} · {b.title}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Batch Items Table */}
          <div className="overflow-x-auto max-h-80 overflow-y-auto rounded-lg border border-slate-200 scroll-rulers dark:border-slate-700">
            <table className="w-full min-w-[840px] text-left text-xs">
              <thead className="sticky top-0 z-10 bg-slate-100 border-b border-slate-200 text-[11px] font-semibold text-slate-700 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-200">
                <tr>
                  <th className="px-3 py-2">Filial / Pasta do Contrato</th>
                  <th className="px-3 py-2">Arquivo / Subpasta</th>
                  <th className="px-3 py-2">Resultado</th>
                  <th className="px-3 py-2">Tamanho</th>
                  <th className="px-3 py-2">Código Único / Observação</th>
                  <th className="px-3 py-2 text-right">Ação Manual</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {itemsLoading && (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-slate-500 dark:text-slate-400">
                      Carregando lista de arquivos desta sessão...
                    </td>
                  </tr>
                )}
                {!itemsLoading && items.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-slate-600 dark:text-slate-300">
                      Nenhum arquivo apareceu aqui ainda porque a execução no servidor Windows não foi iniciada. Assim que você rodar o atalho <span className="font-mono">.bat</span> no Windows, os arquivos aparecerão automaticamente nesta lista.
                    </td>
                  </tr>
                )}
                {!itemsLoading &&
                  items.map((it) => (
                    <React.Fragment key={it.id}>
                      <tr className="hover:bg-slate-50 dark:hover:bg-slate-800">
                        <td className="px-3 py-2 font-mono text-[11px]">
                          <div className="font-semibold text-slate-900 dark:text-slate-100">{it.unitFolderName || '—'}</div>
                          <div className="text-slate-500 dark:text-slate-400">
                            {it.itemScope === 'unit'
                              ? `Unidade · ${it.unitFolderPath || it.contractFolderName || 'Pasta Geral'}`
                              : it.itemScope === 'interlinked'
                              ? `Interligado · ${it.extractedContractNumber || it.contractFolderName}`
                              : it.contractFolderName || it.extractedContractNumber || '—'}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <div className="font-semibold text-slate-900 dark:text-slate-100">{it.fileName}</div>
                          <div className="font-mono text-[11px] text-slate-500 truncate max-w-xs dark:text-slate-400">
                            {it.unitFolderPath || it.relativeSubpath}
                          </div>
                        </td>
                        <td className="px-3 py-2 font-mono text-[11px] font-semibold whitespace-nowrap">
                          <span
                            className={
                              it.status === 'unmatched'
                                ? 'text-amber-700 dark:text-amber-300'
                                : it.status === 'failed' || it.status === 'blocked'
                                ? 'text-red-700 dark:text-red-300'
                                : it.action === 'update_content' || it.action === 'update_path'
                                ? 'text-blue-700 dark:text-blue-300'
                                : 'text-emerald-700 dark:text-emerald-300'
                            }
                          >
                            {it.action}
                          </span>
                        </td>
                        <td className="px-3 py-2 font-mono text-slate-600 tabular-nums whitespace-nowrap dark:text-slate-300">
                          {formatBytes(it.sizeBytes)}
                        </td>
                        <td className="px-3 py-2">
                          {it.integrativeCode ? (
                            <span className="font-mono text-[11px] font-semibold text-emerald-800 dark:text-emerald-300">
                              {it.integrativeCode}
                            </span>
                          ) : (
                            <span className="text-[11px] text-slate-600 dark:text-slate-300">{it.errorMessage || it.status}</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          {it.status === 'unmatched' && (
                            <button
                              type="button"
                              onClick={() => {
                                setResolvingItemId(resolvingItemId === it.id ? null : it.id);
                                setResolveUnitId(it.unitId ? String(it.unitId) : '');
                                setResolveAdmissionId('');
                              }}
                              className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1 font-semibold text-amber-900 hover:bg-amber-100 dark:border-amber-800/70 dark:bg-amber-950/50 dark:text-amber-300 dark:hover:bg-amber-900/60"
                            >
                              <Link2 className="w-3 h-3" />
                              Vincular Pasta
                            </button>
                          )}
                        </td>
                      </tr>
                      {resolvingItemId === it.id && (
                        <tr className="bg-amber-50/40 dark:bg-amber-950/50">
                          <td colSpan={6} className="px-4 py-3">
                            <div className="flex flex-wrap items-center gap-2.5">
                              <span className="font-semibold text-slate-800 dark:text-slate-100">
                                Vincular pasta toda (<span className="font-mono">{it.contractFolderName || it.unitFolderName}</span>):
                              </span>
                              <select
                                value={resolveUnitId}
                                onChange={(e) => setResolveUnitId(e.target.value)}
                                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                              >
                                <option value="">Selecionar Filial...</option>
                                {targetUnits.map((u) => (
                                  <option key={u.id} value={String(u.id)}>
                                    {u.code} · {u.name}
                                  </option>
                                ))}
                              </select>
                              <select
                                value={resolveAdmissionId}
                                onChange={(e) => setResolveAdmissionId(e.target.value)}
                                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-slate-800 max-w-md dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                              >
                                <option value="">Selecionar Contrato / Cliente...</option>
                                {targetAdmissions
                                  .filter((a) => (!resolveUnitId ? true : String(a.unitId) === resolveUnitId))
                                  .map((a) => (
                                    <option key={a.id} value={String(a.id)}>
                                      [{a.unitCode}] {a.contractNumber} · {a.clientName}
                                    </option>
                                  ))}
                              </select>
                              <button
                                type="button"
                                disabled={busy || (!resolveUnitId && !resolveAdmissionId)}
                                onClick={() => handleResolveUnmatched(it)}
                                className="rounded-lg bg-slate-900 px-3 py-1.5 font-semibold text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-emerald-600 dark:hover:bg-emerald-500"
                              >
                                Aplicar à Pasta
                              </button>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Batch History Table */}
      {batches.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden dark:border-slate-700 dark:bg-slate-900">
          <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 font-display text-xs font-bold text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
            Histórico de Envios e Re-Sincronizações
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-100 text-[11px] font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
                <tr>
                  <th className="px-4 py-2">Código</th>
                  <th className="px-4 py-2">Nome da Sessão</th>
                  <th className="px-4 py-2">Situação</th>
                  <th className="px-4 py-2 text-right">Escaneados</th>
                  <th className="px-4 py-2 text-right">Novos / Atualizados</th>
                  <th className="px-4 py-2 text-right">Economizado</th>
                  <th className="px-4 py-2 text-right">Pendências</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {batches.map((b) => (
                  <tr
                    key={b.id}
                    onClick={() => setSelectedBatchId(b.id)}
                    className={`cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800 ${
                      selectedBatchId === b.id ? 'bg-slate-50 dark:bg-slate-800' : ''
                    }`}
                  >
                    <td className="px-4 py-2 font-mono font-bold text-slate-900 dark:text-slate-100">{b.batchCode}</td>
                    <td className="px-4 py-2 font-medium text-slate-800 dark:text-slate-100">{b.title}</td>
                    <td className="px-4 py-2 font-mono text-[11px] text-slate-600 dark:text-slate-300">{b.status}</td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums">
                      {b.totalFilesScanned} ({formatBytes(b.totalBytesScanned)})
                    </td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums text-emerald-700 dark:text-emerald-300">
                      +{b.createdCount} / ~{b.updatedContentCount + b.updatedPathCount}
                    </td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums text-slate-700 dark:text-slate-200">
                      {formatBytes(b.savedBytesByDedup)}
                    </td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums text-amber-700 dark:text-amber-300">
                      {b.unmatchedCount + b.failedCount}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal de Confirmação para Limpeza Completa das Pastas do Bucket R2 */}
      {purgeModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-lg rounded-2xl border border-red-300 bg-white p-5 shadow-xl dark:border-red-800 dark:bg-slate-900">
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3 dark:border-slate-800">
              <div className="flex items-center gap-2 text-red-700 dark:text-red-400">
                <AlertTriangle className="w-5 h-5 shrink-0" />
                <h3 className="font-display text-sm font-bold">
                  Apagar TODAS as pastas do Bucket {bucketStats?.bucketName || 'bucketdainvicta'}
                </h3>
              </div>
              <button
                type="button"
                disabled={purging}
                onClick={() => setPurgeModalOpen(false)}
                className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handlePurgeBucket} className="mt-4 space-y-3 text-xs">
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-900 leading-relaxed dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-200">
                <strong>Ação irreversível:</strong> esta operação removerá imediatamente todos os objetos e pastas
                armazenados no bucket <strong>{bucketStats?.bucketName || 'bucketdainvicta'}</strong> (Cloudflare R2 e
                armazenamento local criptografado), além de zerar o índice de documentos em Arquivos da Unidade /
                Admissões e os lotes históricos de Migração R2.
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-[11px] text-slate-700 tabular-nums dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
                Itens atualmente indexados:{' '}
                <strong>{bucketStats?.totalObjects ?? integrativeStats?.documentsTotal ?? 0} arquivo(s)</strong> (
                {formatBytes(bucketStats?.totalLogicalBytes ?? bucketStats?.physicalBytesUsed ?? 0)}) ·{' '}
                <strong>{batches.length} sessão(ões)</strong>.
              </div>

              <p className="text-slate-600 dark:text-slate-300">
                Clientes, Admissões, Títulos Financeiros, Unidades e Grupos de Permissão permanecem intactos. Para
                prosseguir, digite <span className="font-mono font-bold text-red-700 dark:text-red-300">APAGAR BUCKET R2</span>:
              </p>

              <input
                type="text"
                autoFocus
                disabled={purging}
                value={purgeConfirmText}
                onChange={(e) => setPurgeConfirmText(e.target.value)}
                placeholder="Digite APAGAR BUCKET R2"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs uppercase text-slate-900 focus:border-red-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  disabled={purging}
                  onClick={() => setPurgeModalOpen(false)}
                  className="rounded-lg border border-slate-200 px-3.5 py-2 font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={purging || purgeConfirmText.trim().toUpperCase() !== 'APAGAR BUCKET R2'}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-red-700 px-4 py-2 font-semibold text-white hover:bg-red-800 disabled:opacity-50 whitespace-nowrap"
                >
                  {purging ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                  {purging ? 'Apagando Bucket R2...' : 'Confirmar Exclusão Total'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
