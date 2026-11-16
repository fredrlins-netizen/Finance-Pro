import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  CloudUpload,
  Copy,
  Download,
  FolderSync,
  HardDrive,
  KeyRound,
  Link2,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Terminal,
} from 'lucide-react';
import { apiFetch, getActiveUnitHeader, getAuthToken, parseJsonResponse } from '../../../lib/api.ts';

interface MigrationBatch {
  id: number;
  batchCode: string;
  title: string;
  sourceRootPath: string;
  syncMode: string;
  status: string;
  hasActiveToken?: boolean;
  totalFilesScanned: number;
  totalBytesScanned: number;
  uploadedBytes: number;
  savedBytesByDedup: number;
  createdCount: number;
  updatedContentCount: number;
  updatedPathCount: number;
  deduplicatedCount: number;
  unmatchedCount: number;
  blockedCount: number;
  failedCount: number;
  lastHeartbeatAt?: string | null;
  integrativeSealedAt?: string | null;
  createdAt: string;
}

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
  activeBackend: string;
  encryptionAlgorithm: string;
  r2Endpoint: string;
  totalObjects: number;
  totalLogicalBytes: number;
}

interface IntegrativeStats {
  admissionsTotal: number;
  admissionsWithCode: number;
  documentsTotal: number;
  documentsWithCode: number;
}

interface LookupTargetUnit {
  id: number;
  code: string;
  name: string;
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

function formatBytes(bytes: number): string {
  const b = Number(bytes || 0);
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(2)} MB`;
  return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export const ConfigR2MigrationView: React.FC<ConfigR2MigrationViewProps> = ({ wsTick, onToast }) => {
  const [loading, setLoading] = useState(true);
  const [batches, setBatches] = useState<MigrationBatch[]>([]);
  const [bucketStats, setBucketStats] = useState<BucketStats | null>(null);
  const [integrativeStats, setIntegrativeStats] = useState<IntegrativeStats | null>(null);
  const [selectedBatchId, setSelectedBatchId] = useState<number | null>(null);

  // Batch items & filters
  const [items, setItems] = useState<MigrationItem[]>([]);
  const [itemFilter, setItemFilter] = useState<'all' | 'unmatched' | 'updated' | 'created' | 'blocked' | 'failed'>('all');
  const [itemsLoading, setItemsLoading] = useState(false);

  // New batch form
  const [newTitle, setNewTitle] = useState('Sincronização Matriz & Filiais (Base 64 GB)');
  const [newSyncMode, setNewSyncMode] = useState<'incremental' | 'mirror_review'>('incremental');
  const [newSourcePath, setNewSourcePath] = useState('D:\\BaseDocumentosInvicta');
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

  const loadBatchesAndTargets = useCallback(async () => {
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
      onToast(err instanceof Error ? err.message : 'Erro ao carregar status da migração R2.');
    } finally {
      setLoading(false);
    }
  }, [onToast, selectedBatchId]);

  const loadItems = useCallback(async () => {
    if (!selectedBatchId) {
      setItems([]);
      return;
    }
    setItemsLoading(true);
    try {
      const res = await apiFetch<{ items: MigrationItem[] }>(
        `/api/migration/batches/${selectedBatchId}/items?filter=${itemFilter}&limit=150`
      );
      setItems(res.items || []);
    } finally {
      setItemsLoading(false);
    }
  }, [selectedBatchId, itemFilter]);

  useEffect(() => {
    loadBatchesAndTargets();
  }, [loadBatchesAndTargets, wsTick]);

  useEffect(() => {
    loadItems();
  }, [loadItems, wsTick]);

  const selectedBatch = batches.find((b) => b.id === selectedBatchId) || null;

  const handleCreateBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await apiFetch<{ batch: MigrationBatch }>('/api/migration/batches', {
        method: 'POST',
        body: JSON.stringify({
          title: newTitle.trim(),
          syncMode: newSyncMode,
          sourceRootPath: newSourcePath.trim(),
        }),
      });
      setSelectedBatchId(res.batch.id);
      onToast(`Sessão de migração ${res.batch.batchCode} criada. Baixe o script .mjs para executar no Windows.`);
      await loadBatchesAndTargets();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Erro ao criar sessão de migração.');
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
        await parseJsonResponse(res, 'Falha ao baixar arquivo do agente Windows.');
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
          ? `Agente CLI ${batch.batchCode}.mjs baixado com token criptográfico ativo.`
          : `Atalho executar-${batch.batchCode}.bat baixado.`
      );
      await loadBatchesAndTargets();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Erro no download do agente.');
    }
  };

  const handleCopyCommand = (batch: MigrationBatch) => {
    const dirArg = batch.sourceRootPath || newSourcePath || 'D:\\BaseDocumentosInvicta';
    const cmd = `node invicta-r2-sync-${batch.batchCode}.mjs --dir "${dirArg}" --concurrency 6`;
    navigator.clipboard.writeText(cmd);
    setCopiedKey(`cmd-${batch.id}`);
    setTimeout(() => setCopiedKey(''), 2000);
    onToast('Comando PowerShell copiado para a área de transferência.');
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
        `Selagem HMAC concluída: ${res.admissionsAssigned} dossiê(s) e ${res.documentsAssigned} documento(s) padronizados.`
      );
      await loadBatchesAndTargets();
      await loadItems();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Erro ao atribuir códigos seguros integrativos.');
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
      setHmacResolveError(err instanceof Error ? err.message : 'Código integrativo não validado.');
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
        await parseJsonResponse(res, 'Não foi possível baixar o documento pelo código integrativo.');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${code}.bin`;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Não foi possível baixar o documento pelo código integrativo.');
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
        `${res.resolvedCount || 1} arquivo(s) da pasta vinculados com sucesso. Execute o agente novamente para concluir o sync incremental.`
      );
      await loadBatchesAndTargets();
      await loadItems();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Erro ao resolver vínculo da pasta.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
        Carregando telemetria do bucket Cloudflare R2 e sessões de sincronização...
      </div>
    );
  }

  return (
    <div className="space-y-4 text-xs">
      {/* Top Architecture & Bucket Status Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center justify-between text-[11px] font-semibold text-slate-500 dark:text-slate-400">
            <span>Armazenamento Ativo R2 / S3</span>
            <CloudUpload className="w-4 h-4 text-emerald-700 dark:text-emerald-300" />
          </div>
          <div className="mt-1.5 font-mono text-base font-bold text-slate-900 dark:text-slate-100">
            {bucketStats?.bucketName || 'bucketdainvicta'}
          </div>
          <div className="mt-1 text-[11px] text-slate-500 font-mono dark:text-slate-400">
            {bucketStats?.activeBackend === 'CLOUDFLARE_R2'
              ? 'Cloudflare R2 S3 Presigned + Multipart'
              : 'Vault Local AES-256-GCM (Preview)'}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center justify-between text-[11px] font-semibold text-slate-500 dark:text-slate-400">
            <span>Objetos &amp; Volume no Cofre</span>
            <HardDrive className="w-4 h-4 text-slate-600 dark:text-slate-300" />
          </div>
          <div className="mt-1.5 font-mono text-base font-bold text-slate-900 tabular-nums dark:text-slate-100">
            {bucketStats?.totalObjects || 0} arq. · {formatBytes(bucketStats?.totalLogicalBytes || 0)}
          </div>
          <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            Criptografia {bucketStats?.encryptionAlgorithm || 'AES-256-GCM'} + SHA-256 CAS
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center justify-between text-[11px] font-semibold text-slate-500 dark:text-slate-400">
            <span>Dossiês com Selo HMAC</span>
            <ShieldCheck className="w-4 h-4 text-emerald-700 dark:text-emerald-300" />
          </div>
          <div className="mt-1.5 font-mono text-base font-bold text-slate-900 tabular-nums dark:text-slate-100">
            {integrativeStats?.admissionsWithCode || 0} / {integrativeStats?.admissionsTotal || 0}
          </div>
          <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            Formato INV-&#123;UNIDADE&#125;-DOSS-&#123;ID6&#125;-&#123;HMAC8&#125;
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center justify-between text-[11px] font-semibold text-slate-500 dark:text-slate-400">
            <span>Documentos com Selo HMAC</span>
            <KeyRound className="w-4 h-4 text-blue-700 dark:text-blue-300" />
          </div>
          <div className="mt-1.5 font-mono text-base font-bold text-slate-900 tabular-nums dark:text-slate-100">
            {integrativeStats?.documentsWithCode || 0} / {integrativeStats?.documentsTotal || 0}
          </div>
          <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            Resolução segura via /api/vault/i/:codigo
          </div>
        </div>
      </div>

      {/* Create New Batch / Incremental Re-Upload Launcher + HMAC Seal Bar */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <form
          onSubmit={handleCreateBatch}
          className="lg:col-span-7 rounded-xl border border-slate-200 bg-white p-4 space-y-3 dark:border-slate-700 dark:bg-slate-900"
        >
          <div className="flex items-center justify-between border-b border-slate-100 pb-2.5 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <FolderSync className="w-4 h-4 text-slate-800 dark:text-slate-100" />
              <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                Nova Sessão de Carga / Atualização Incremental (Base 64 GB)
              </h3>
            </div>
            <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">Node 18+ CLI</span>
          </div>

          <p className="text-slate-500 leading-relaxed dark:text-slate-400">
            O agente local varre as pastas por <strong className="text-slate-700 dark:text-slate-200">Código da Unidade</strong> no topo e <strong className="text-slate-700 dark:text-slate-200">Número do Contrato</strong> nas subpastas. Novos uploads da base de 64 GB comparam o hash SHA-256 e <strong className="text-slate-700 dark:text-slate-200">alteram/atualizam arquivos modificados ou movidos</strong> sem duplicar o que não mudou.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <div className="sm:col-span-2">
              <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Identificação da Sessão</label>
              <input
                type="text"
                required
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900 dark:border-slate-700 dark:text-slate-100 dark:bg-slate-950"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Modo de Sincronização</label>
              <select
                value={newSyncMode}
                onChange={(e) => setNewSyncMode(e.target.value as 'incremental' | 'mirror_review')}
                className="w-full rounded-lg border border-slate-200 px-2.5 py-2 font-semibold text-slate-800 dark:border-slate-700 dark:text-slate-100 dark:bg-slate-950"
              >
                <option value="incremental">Incremental (Cria + Atualiza)</option>
                <option value="mirror_review">Espelho com Revisão</option>
              </select>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-end gap-2.5">
            <div className="flex-1">
              <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">
                Caminho Raiz no Servidor Windows (Opcional)
              </label>
              <input
                type="text"
                value={newSourcePath}
                onChange={(e) => setNewSourcePath(e.target.value)}
                placeholder="D:\BaseDocumentosInvicta"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-slate-900 dark:border-slate-700 dark:text-slate-100 dark:bg-slate-950"
              />
            </div>
            <button
              type="submit"
              disabled={busy}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white hover:bg-slate-800 whitespace-nowrap dark:bg-emerald-600 dark:hover:bg-emerald-500"
            >
              <Plus className="w-3.5 h-3.5" />
              Gerar Sessão &amp; Token CLI
            </button>
          </div>
        </form>

        {/* Integrative HMAC Standardization & Resolver */}
        <div className="lg:col-span-5 rounded-xl border border-slate-200 bg-white p-4 space-y-3 dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-2.5 dark:border-slate-800">
            <ShieldCheck className="w-4 h-4 text-emerald-700 dark:text-emerald-300" />
            <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
              Código Seguro Integrativo (HMAC-SHA256)
            </h3>
          </div>

          <p className="text-slate-500 leading-relaxed dark:text-slate-400">
            Substitui chaves de pastas e URLs expostas por protocolo criptográfico único mantendo o número do contrato e protocolo legado indexados.
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
              <span>Regenerar existentes</span>
            </label>
            <button
              type="button"
              disabled={busy}
              onClick={handleSealIntegrativeCodes}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-1.5 font-semibold text-white hover:bg-emerald-800 whitespace-nowrap ml-auto"
            >
              <KeyRound className="w-3.5 h-3.5" />
              Gerar &amp; Aplicar Selos
            </button>
          </div>

          <form onSubmit={handleTestIntegrativeCode} className="pt-2 border-t border-slate-100 space-y-2 dark:border-slate-800">
            <label className="block font-semibold text-slate-700 dark:text-slate-200">
              Testar / Resolver Código Integrativo
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={hmacQueryCode}
                onChange={(e) => setHmacQueryCode(e.target.value)}
                placeholder="Ex: INV-MTZ-DOSS-000001-A1B2C3D4"
                className="flex-1 rounded-lg border border-slate-200 px-3 py-1.5 font-mono uppercase text-slate-900 dark:border-slate-700 dark:text-slate-100 dark:bg-slate-950"
              />
              <button
                type="submit"
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 font-semibold text-slate-800 hover:bg-slate-100 whitespace-nowrap dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-100 dark:hover:bg-slate-800"
              >
                <Search className="w-3.5 h-3.5" />
                Validar HMAC
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
                    Assinatura HMAC Autêntica ({String(hmacResolveResult.type)})
                  </span>
                  {hmacResolveResult.type === 'DOC' && (
                    <button
                      type="button"
                      onClick={() =>
                        handleDownloadByIntegrativeCode(String(hmacResolveResult.integrativeCode))
                      }
                      className="underline font-semibold text-emerald-800 dark:text-emerald-300"
                    >
                      Baixar Binário
                    </button>
                  )}
                </div>
                <pre className="font-mono text-[10px] text-slate-700 overflow-x-auto max-h-24 dark:text-slate-200">
                  {JSON.stringify(hmacResolveResult, null, 2)}
                </pre>
              </div>
            )}
          </form>
        </div>
      </div>

      {/* Selected Batch Windows Agent Runner & Live Telemetry */}
      {selectedBatch && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-4 dark:border-slate-700 dark:bg-slate-900">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-slate-100 pb-3 dark:border-slate-800">
            <div className="flex flex-wrap items-center gap-2.5">
              <Terminal className="w-4 h-4 text-slate-800 dark:text-slate-100" />
              <div>
                <div className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                  {selectedBatch.batchCode} · {selectedBatch.title}
                </div>
                <div className="text-[11px] text-slate-500 font-mono dark:text-slate-400">
                  Status: {selectedBatch.status} · Modo: {selectedBatch.syncMode}
                  {selectedBatch.lastHeartbeatAt
                    ? ` · Último pulso: ${new Date(selectedBatch.lastHeartbeatAt).toLocaleString('pt-BR')}`
                    : ''}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => handleDownloadAgentFile(selectedBatch, 'mjs')}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 font-semibold text-white hover:bg-slate-800 whitespace-nowrap dark:bg-emerald-600 dark:hover:bg-emerald-500"
              >
                <Download className="w-3.5 h-3.5" />
                Baixar Agente Windows (.mjs)
              </button>
              <button
                type="button"
                onClick={() => handleDownloadAgentFile(selectedBatch, 'bat')}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <Download className="w-3.5 h-3.5" />
                Launcher (.bat)
              </button>
              <button
                type="button"
                onClick={() => handleCopyCommand(selectedBatch)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-100 whitespace-nowrap dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                {copiedKey === `cmd-${selectedBatch.id}` ? (
                  <Check className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-300" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
                Copiar Comando
              </button>
              <button
                type="button"
                onClick={() => {
                  loadBatchesAndTargets();
                  loadItems();
                }}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* CLI Instructions */}
          <div className="rounded-lg border border-slate-200 bg-slate-900 text-slate-100 p-3 font-mono text-[11px] space-y-1 dark:border-slate-700 dark:bg-emerald-600">
            <div className="text-slate-400 dark:text-slate-400">
              # Execute no servidor Windows onde está a pasta de 64 GB (retomada automática via checkpoint JSON):
            </div>
            <div className="text-emerald-300 select-all">
              node invicta-r2-sync-{selectedBatch.batchCode}.mjs --dir &quot;{selectedBatch.sourceRootPath || newSourcePath}&quot; --concurrency 6
            </div>
            <div className="text-slate-400 dark:text-slate-400">
              # Opções: --dry-run (simular sem enviar bytes) · --force-rescan (revalidar árvore inteira para nova atualização)
            </div>
          </div>

          {/* Live Counters */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 dark:border-slate-700 dark:bg-slate-800/70">
              <div className="text-[10px] text-slate-500 dark:text-slate-400">Escaneados</div>
              <div className="font-mono font-bold text-slate-900 tabular-nums dark:text-slate-100">{selectedBatch.totalFilesScanned}</div>
            </div>
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 px-2.5 py-2 dark:border-emerald-800/70 dark:bg-emerald-950/50">
              <div className="text-[10px] text-emerald-700 dark:text-emerald-300">Novos Criados</div>
              <div className="font-mono font-bold text-emerald-800 tabular-nums dark:text-emerald-300">{selectedBatch.createdCount}</div>
            </div>
            <div className="rounded-lg border border-blue-200 bg-blue-50/60 px-2.5 py-2 dark:border-blue-800/70 dark:bg-blue-950/50">
              <div className="text-[10px] text-blue-700 dark:text-blue-300">Arq. Atualizados</div>
              <div className="font-mono font-bold text-blue-800 tabular-nums dark:text-blue-300">{selectedBatch.updatedContentCount}</div>
            </div>
            <div className="rounded-lg border border-blue-200 bg-blue-50/40 px-2.5 py-2 dark:border-blue-800/70 dark:bg-blue-950/50">
              <div className="text-[10px] text-blue-700 dark:text-blue-300">Pastas Movidas</div>
              <div className="font-mono font-bold text-blue-800 tabular-nums dark:text-blue-300">{selectedBatch.updatedPathCount}</div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 dark:border-slate-700 dark:bg-slate-800/70">
              <div className="text-[10px] text-slate-500 dark:text-slate-400">Deduplicados 0B</div>
              <div className="font-mono font-bold text-slate-800 tabular-nums dark:text-slate-100">{selectedBatch.deduplicatedCount}</div>
            </div>
            <div className="rounded-lg border border-amber-200 bg-amber-50/70 px-2.5 py-2 dark:border-amber-800/70 dark:bg-amber-950/50">
              <div className="text-[10px] text-amber-800 dark:text-amber-300">Pend. Vínculo</div>
              <div className="font-mono font-bold text-amber-900 tabular-nums dark:text-amber-300">{selectedBatch.unmatchedCount}</div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 dark:border-slate-700 dark:bg-slate-800/70">
              <div className="text-[10px] text-slate-500 dark:text-slate-400">Bloq. Scripts</div>
              <div className="font-mono font-bold text-slate-700 tabular-nums dark:text-slate-200">{selectedBatch.blockedCount}</div>
            </div>
            <div className="rounded-lg border border-red-200 bg-red-50/60 px-2.5 py-2 dark:border-red-800/70 dark:bg-red-950/50">
              <div className="text-[10px] text-red-700 dark:text-red-300">Falhas</div>
              <div className="font-mono font-bold text-red-800 tabular-nums dark:text-red-300">{selectedBatch.failedCount}</div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-slate-600 dark:text-slate-300">
            <span>
              Volume varrido: <strong>{formatBytes(selectedBatch.totalBytesScanned)}</strong> · Enviado ao R2:{' '}
              <strong>{formatBytes(selectedBatch.uploadedBytes)}</strong> · Economizado por deduplicação SHA-256:{' '}
              <strong className="text-emerald-700 dark:text-emerald-300">{formatBytes(selectedBatch.savedBytesByDedup)}</strong>
            </span>
          </div>

          {/* Filter tabs for Batch Items */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  { id: 'all', label: 'Todos os Itens' },
                  { id: 'unmatched', label: `Pendências de Vínculo (${selectedBatch.unmatchedCount})` },
                  { id: 'updated', label: 'Atualizados / Movidos' },
                  { id: 'created', label: 'Novos' },
                  { id: 'blocked', label: 'Bloqueados' },
                  { id: 'failed', label: 'Falhas' },
                ] as const
              ).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setItemFilter(f.id)}
                  className={`rounded-md border px-2.5 py-1 text-[11px] font-semibold ${
                    itemFilter === f.id
                      ? 'border-slate-900 bg-slate-900 text-white dark:border-emerald-500 dark:bg-emerald-600'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
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
              <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600 dark:bg-slate-800/70 dark:border-slate-700 dark:text-slate-300">
                <tr>
                  <th className="px-3 py-2">Pasta Unidade / Contrato</th>
                  <th className="px-3 py-2">Arquivo / Subpasta</th>
                  <th className="px-3 py-2">Ação Sync</th>
                  <th className="px-3 py-2">Tamanho</th>
                  <th className="px-3 py-2">Selo Integrativo / Diagnóstico</th>
                  <th className="px-3 py-2 text-right">Resolução</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {itemsLoading && (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-slate-500 dark:text-slate-400">
                      Carregando itens da sessão...
                    </td>
                  </tr>
                )}
                {!itemsLoading && items.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-slate-500 dark:text-slate-400">
                      Nenhum arquivo registrado nesta visão ainda. Execute o agente CLI no servidor Windows para iniciar a sincronização.
                    </td>
                  </tr>
                )}
                {!itemsLoading &&
                  items.map((it) => (
                    <React.Fragment key={it.id}>
                      <tr className="hover:bg-slate-50/70 dark:hover:bg-slate-800">
                        <td className="px-3 py-2 font-mono text-[11px]">
                          <div className="font-semibold text-slate-900 dark:text-slate-100">{it.unitFolderName || '—'}</div>
                          <div className="text-slate-500 dark:text-slate-400">{it.contractFolderName || it.extractedContractNumber || '—'}</div>
                        </td>
                        <td className="px-3 py-2">
                          <div className="font-semibold text-slate-900 dark:text-slate-100">{it.fileName}</div>
                          <div className="font-mono text-[11px] text-slate-500 truncate max-w-xs dark:text-slate-400">
                            {it.relativeSubpath}
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
                                <option value="">Selecionar Unidade...</option>
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
                                <option value="">Selecionar Contrato / Admissão...</option>
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
          <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 font-display text-xs font-bold text-slate-800 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-100">
            Histórico de Lotes &amp; Re-Sincronizações Incrementais
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300">
                <tr>
                  <th className="px-4 py-2">Código</th>
                  <th className="px-4 py-2">Sessão</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2 text-right">Escaneados</th>
                  <th className="px-4 py-2 text-right">Novos / Atualizados</th>
                  <th className="px-4 py-2 text-right">Economizado CAS</th>
                  <th className="px-4 py-2 text-right">Pendências</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {batches.map((b) => (
                  <tr
                    key={b.id}
                    onClick={() => setSelectedBatchId(b.id)}
                    className={`cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800 ${
                      selectedBatchId === b.id ? 'bg-slate-50 dark:bg-slate-800/70' : ''
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
    </div>
  );
};
