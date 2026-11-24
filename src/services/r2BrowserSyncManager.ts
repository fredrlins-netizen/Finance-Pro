import { apiFetch, getActiveUnitHeader, getAuthToken } from '../lib/api.ts';

export interface LookupTargetUnit {
  id: number;
  code: string;
  name: string;
  city?: string;
  state?: string;
  active?: boolean;
}

export interface MigrationBatchSummary {
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
  unitFilesCount?: number;
  interlinkedCount?: number;
  lastHeartbeatAt?: string | null;
  integrativeSealedAt?: string | null;
  createdAt: string;
}

export type ProcessingFileStage =
  | 'hashing'
  | 'verificando'
  | 'enviando'
  | 'concluido'
  | 'deduplicado'
  | 'erro';

export interface ProcessingFileEntry {
  id: string;
  folderPath: string;
  fileName: string;
  stage: ProcessingFileStage;
  sizeBytes: number;
}

export interface BrowserSyncProgress {
  running: boolean;
  cancelling: boolean;
  cancelled: boolean;
  completed: boolean;
  dryRun: boolean;
  batchId: number | null;
  batchCode: string;
  rootLabel: string;
  subfoldersCount: number;
  skippedRootFiles: number;
  totalFiles: number;
  processedFiles: number;
  created: number;
  updated: number;
  moved: number;
  deduplicated: number;
  unmatched: number;
  blocked: number;
  failed: number;
  currentFolderPath: string;
  currentFileName: string;
  activeFolders: string[];
  processingEntries: ProcessingFileEntry[];
  lastError: string;
  startedAt: number;
  finishedAt: number | null;
  lastUpdatedAt: number;
}

export function sanitizeWindowsPath(rawPath: string): string {
  const trimmed = String(rawPath || '').trim();
  if (!trimmed) return '';
  if (/^[A-Za-z]:\\?$/.test(trimmed)) {
    return `${trimmed.slice(0, 2)}\\`;
  }
  return trimmed.replace(/[\\/]+$/, '');
}

function normalizeToken(text: string): string {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim();
}

function normalizeAlphaNum(text: string): string {
  return normalizeToken(text).replace(/[^A-Z0-9]/g, '');
}

export function matchUnitFromFolderName(
  folderName: string,
  units: LookupTargetUnit[]
): LookupTargetUnit | null {
  const raw = String(folderName || '').trim();
  const fullNorm = normalizeAlphaNum(raw);
  if (!fullNorm || units.length === 0) return null;

  const splitTokens = normalizeToken(raw)
    .split(/[-–—_:/\\[\]()\s]+/)
    .map((t) => normalizeAlphaNum(t))
    .filter(Boolean);

  for (const unit of units) {
    const codeNorm = normalizeAlphaNum(unit.code);
    if (codeNorm && (fullNorm === codeNorm || splitTokens.includes(codeNorm))) {
      return unit;
    }
  }

  for (const unit of units) {
    const cityNorm = normalizeAlphaNum(unit.city || '');
    const nameNorm = normalizeAlphaNum(unit.name || '');
    if (
      (cityNorm.length >= 4 && fullNorm.includes(cityNorm)) ||
      (nameNorm.length >= 4 && fullNorm.includes(nameNorm))
    ) {
      return unit;
    }
  }

  return null;
}

export function detectUnitTailFolder(
  rawPath: string,
  units: LookupTargetUnit[]
): { matchedUnitLabel: string; suggestedParent: string; unit: LookupTargetUnit } | null {
  const clean = sanitizeWindowsPath(rawPath);
  if (!clean) return null;
  const parts = clean.split(/[\\/]+/).filter(Boolean);
  if (parts.length < 1) return null;

  const tail = parts[parts.length - 1];
  const matched = matchUnitFromFolderName(tail, units);
  if (!matched) return null;
  const parent = parts.length > 1 ? parts.slice(0, -1).join('\\') : '';
  return {
    matchedUnitLabel: `${matched.code} · ${matched.name}`,
    suggestedParent: parent,
    unit: matched,
  };
}

const MIME_BY_EXT_BROWSER: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.txt': 'text/plain',
  '.csv': 'text/csv',
  '.zip': 'application/zip',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4',
};

function guessBrowserMime(file: File): string {
  if (file.type && file.type.trim()) return file.type.trim();
  const idx = file.name.lastIndexOf('.');
  const ext = idx >= 0 ? file.name.slice(idx).toLowerCase() : '';
  return MIME_BY_EXT_BROWSER[ext] || 'application/octet-stream';
}

async function computeBrowserSha256(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

const RETRYABLE_HTTP_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

function isNetworkOrCorsTypeError(err: unknown): boolean {
  return (
    err instanceof TypeError ||
    (err instanceof Error && /failed to fetch|networkerror|load failed/i.test(err.message))
  );
}

function isAbortError(err: unknown): boolean {
  return (
    (err instanceof DOMException && err.name === 'AbortError') ||
    (err instanceof Error && (err.name === 'AbortError' || /cancelada pelo usuário/i.test(err.message)))
  );
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  options?: { maxAttempts?: number; shouldCancel?: () => boolean; signal?: AbortSignal }
): Promise<Response> {
  const maxAttempts = options?.maxAttempts ?? 4;
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (options?.shouldCancel?.() || options?.signal?.aborted) {
      throw new DOMException('Operação cancelada pelo usuário.', 'AbortError');
    }
    try {
      const resp = await fetch(url, { ...init, signal: options?.signal ?? init.signal });
      if (RETRYABLE_HTTP_STATUS.has(resp.status) && attempt < maxAttempts) {
        const waitMs = Math.min(8000, 600 * Math.pow(2, attempt - 1));
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }
      return resp;
    } catch (err) {
      if (isAbortError(err) || options?.shouldCancel?.() || options?.signal?.aborted) {
        throw err;
      }
      lastErr = err;
      if (attempt >= maxAttempts) throw err;
      const waitMs = Math.min(8000, 600 * Math.pow(2, attempt - 1));
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Falha de rede após múltiplas tentativas.');
}

async function apiFetchWithRetry<T>(
  path: string,
  init: RequestInit = {},
  options?: { maxAttempts?: number; shouldCancel?: () => boolean; signal?: AbortSignal }
): Promise<T> {
  const maxAttempts = options?.maxAttempts ?? 4;
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (options?.shouldCancel?.() || options?.signal?.aborted) {
      throw new DOMException('Operação cancelada pelo usuário.', 'AbortError');
    }
    try {
      return await apiFetch<T>(path, { ...init, signal: options?.signal ?? init.signal });
    } catch (err) {
      if (isAbortError(err) || options?.shouldCancel?.() || options?.signal?.aborted) {
        throw err;
      }
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      const retryable =
        isNetworkOrCorsTypeError(err) ||
        /\b(408|425|429|500|502|503|504)\b|timeout|econnreset|socket|temporariamente/i.test(msg);
      if (!retryable || attempt >= maxAttempts) {
        throw err;
      }
      const waitMs = Math.min(8000, 650 * Math.pow(2, attempt - 1));
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Falha na comunicação com o servidor.');
}

// =========================================================================
// Singleton Background State & Subscribers (persists across route changes)
// =========================================================================

let currentSyncState: BrowserSyncProgress | null = null;
let externalBatchActive = false;
let cancelRequested = false;
let activeAbortController: AbortController | null = null;

const syncListeners = new Set<() => void>();
const externalActiveListeners = new Set<() => void>();
const batchUpdateCallbacks = new Set<(batchId: number | null, finished: boolean) => void>();

function emitSync() {
  syncListeners.forEach((l) => l());
}

function notifyActivityStamp() {
  try {
    localStorage.setItem('fp_last_activity_at', String(Date.now()));
  } catch {
    // ignore
  }
}

export function subscribeR2Sync(listener: () => void): () => void {
  syncListeners.add(listener);
  return () => {
    syncListeners.delete(listener);
  };
}

export function getR2SyncSnapshot(): BrowserSyncProgress | null {
  return currentSyncState;
}

export function subscribeR2ExternalActive(listener: () => void): () => void {
  externalActiveListeners.add(listener);
  return () => {
    externalActiveListeners.delete(listener);
  };
}

export function getR2ExternalActiveSnapshot(): boolean {
  return externalBatchActive;
}

export function setR2ExternalBatchActive(active: boolean): void {
  if (externalBatchActive === active) return;
  externalBatchActive = active;
  if (active) notifyActivityStamp();
  externalActiveListeners.forEach((l) => l());
}

export function isR2MigrationIdleSuspended(): boolean {
  return Boolean(currentSyncState?.running || externalBatchActive);
}

export function subscribeR2BatchUpdates(cb: (batchId: number | null, finished: boolean) => void): () => void {
  batchUpdateCallbacks.add(cb);
  return () => {
    batchUpdateCallbacks.delete(cb);
  };
}

function emitBatchUpdate(batchId: number | null, finished: boolean) {
  batchUpdateCallbacks.forEach((cb) => {
    try {
      cb(batchId, finished);
    } catch {
      // ignore listener errors
    }
  });
}

export function dismissR2SyncBanner(): void {
  if (currentSyncState?.running) return;
  currentSyncState = null;
  emitSync();
}

export async function cancelBrowserFolderSync(explicitBatchId?: number | null): Promise<void> {
  const batchIdToCancel = explicitBatchId ?? currentSyncState?.batchId ?? null;

  if (currentSyncState?.running) {
    cancelRequested = true;
    currentSyncState = {
      ...currentSyncState,
      cancelling: true,
      lastUpdatedAt: Date.now(),
    };
    emitSync();
    try {
      activeAbortController?.abort();
    } catch {
      // ignore
    }
  }

  if (batchIdToCancel) {
    try {
      await apiFetch(`/api/migration/batches/${batchIdToCancel}/cancel`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      emitBatchUpdate(batchIdToCancel, true);
    } catch {
      // best effort backend status mark
    }
  }
}

export interface StartBrowserFolderSyncParams {
  filesToUpload: File[];
  selectedRootName: string;
  subfoldersCount: number;
  skippedRootFiles: number;
  explicitUnitId: number | null;
  targetUnits: LookupTargetUnit[];
  selectedBatch: MigrationBatchSummary | null;
  syncMode: 'incremental' | 'mirror_review';
  fallbackSourcePath: string;
  dryRun: boolean;
  onToast?: (msg: string) => void;
  onBatchCreated?: (batch: MigrationBatchSummary) => void;
}

export async function startBrowserFolderSync(params: StartBrowserFolderSyncParams): Promise<void> {
  const {
    filesToUpload,
    selectedRootName,
    subfoldersCount,
    skippedRootFiles,
    explicitUnitId,
    targetUnits,
    selectedBatch,
    syncMode,
    fallbackSourcePath,
    dryRun,
    onToast,
    onBatchCreated,
  } = params;

  if (filesToUpload.length === 0) return;
  if (currentSyncState?.running) {
    onToast?.('Já existe um envio R2 em andamento em segundo plano.');
    return;
  }

  let targetBatch =
    selectedBatch && selectedBatch.status !== 'cancelado' ? selectedBatch : null;
  if (!targetBatch) {
    try {
      const createdRes = await apiFetch<{ batch: MigrationBatchSummary }>('/api/migration/batches', {
        method: 'POST',
        body: JSON.stringify({
          title: selectedRootName ? `Subpastas: ${selectedRootName}` : 'Sincronização de Subpastas',
          syncMode,
          sourceRootPath: selectedRootName || sanitizeWindowsPath(fallbackSourcePath),
          targetUnitIds: explicitUnitId ? [explicitUnitId] : [],
        }),
      });
      targetBatch = createdRes.batch;
      onBatchCreated?.(targetBatch);
    } catch (err) {
      onToast?.(err instanceof Error ? err.message : 'Erro ao criar sessão automática de envio.');
      return;
    }
  }

  const explicitUnit = explicitUnitId
    ? targetUnits.find((u) => u.id === explicitUnitId) || null
    : null;
  const rootUnitMatch = selectedRootName ? matchUnitFromFolderName(selectedRootName, targetUnits) : null;
  const soleUnit = targetUnits.length === 1 ? targetUnits[0] : null;
  const fallbackUnit = explicitUnit || rootUnitMatch || soleUnit;

  cancelRequested = false;
  activeAbortController = new AbortController();
  const signal = activeAbortController.signal;
  const shouldCancel = () => cancelRequested || signal.aborted;

  const counters: BrowserSyncProgress = {
    running: true,
    cancelling: false,
    cancelled: false,
    completed: false,
    dryRun,
    batchId: targetBatch.id,
    batchCode: targetBatch.batchCode,
    rootLabel: selectedRootName || 'Pasta selecionada',
    subfoldersCount,
    skippedRootFiles,
    totalFiles: filesToUpload.length,
    processedFiles: 0,
    created: 0,
    updated: 0,
    moved: 0,
    deduplicated: 0,
    unmatched: 0,
    blocked: 0,
    failed: 0,
    currentFolderPath: selectedRootName || '',
    currentFileName: '',
    activeFolders: [],
    processingEntries: [],
    lastError: '',
    startedAt: Date.now(),
    finishedAt: null,
    lastUpdatedAt: Date.now(),
  };

  const commitState = () => {
    counters.lastUpdatedAt = Date.now();
    currentSyncState = {
      ...counters,
      activeFolders: [...counters.activeFolders],
      processingEntries: counters.processingEntries.map((e) => ({ ...e })),
    };
    emitSync();
  };

  const pushActiveFolder = (folderPath: string) => {
    const clean = folderPath || '(raiz)';
    counters.currentFolderPath = clean;
    const deduped = [clean, ...counters.activeFolders.filter((f) => f !== clean)];
    counters.activeFolders = deduped.slice(0, 6);
  };

  const upsertProcessingEntry = (
    id: string,
    folderPath: string,
    fileName: string,
    stage: ProcessingFileStage,
    sizeBytes: number
  ) => {
    const cleanFolder = folderPath || '(raiz)';
    counters.currentFolderPath = cleanFolder;
    counters.currentFileName = fileName;
    pushActiveFolder(cleanFolder);
    const filtered = counters.processingEntries.filter((e) => e.id !== id);
    counters.processingEntries = [
      { id, folderPath: cleanFolder, fileName, stage, sizeBytes },
      ...filtered,
    ].slice(0, 8);
    commitState();
  };

  commitState();
  notifyActivityStamp();

  // Keep backend session alive while migration runs even without mouse/keyboard input
  const keepAliveTimer = window.setInterval(() => {
    notifyActivityStamp();
    apiFetch('/api/auth/activity', { method: 'POST' }).catch(() => {});
  }, 90_000);

  const CHUNK_SIZE = 25;
  const PART_SIZE = 8 * 1024 * 1024;
  const token = getAuthToken();
  let r2CorsBlocked = false;
  let chunkIndex = 0;
  let lastUiRefreshAt = Date.now();

  try {
    for (let offset = 0; offset < filesToUpload.length; offset += CHUNK_SIZE) {
      if (shouldCancel()) break;
      chunkIndex++;
      const slice = filesToUpload.slice(offset, offset + CHUNK_SIZE);

      try {
        const manifest: Array<{
          unitFolderName: string;
          pathSegmentsFromUnit: string[];
          fileName: string;
          legacySourcePath: string;
          displayFolderPath: string;
          mimeType: string;
          sizeBytes: number;
          sha256Hash: string;
          _file: File;
        }> = [];

        for (const f of slice) {
          if (shouldCancel()) break;
          const rel = f.webkitRelativePath || f.name;
          const parts = rel.split('/').filter(Boolean);
          const childUnitMatch =
            parts.length >= 3 ? matchUnitFromFolderName(parts[1], targetUnits) : null;

          let unitFolderName = selectedRootName;
          let pathSegmentsFromUnit: string[] = parts.length >= 2 ? parts.slice(1) : [f.name];

          if (childUnitMatch && parts.length >= 3) {
            unitFolderName = parts[1];
            pathSegmentsFromUnit = parts.slice(2);
          } else if (fallbackUnit) {
            unitFolderName = fallbackUnit.code;
            pathSegmentsFromUnit = parts.length >= 2 ? parts.slice(1) : [f.name];
          }

          if (pathSegmentsFromUnit.length === 0) pathSegmentsFromUnit = [f.name];

          const folderParts = parts.slice(1, -1);
          const displayFolderPath = folderParts.length > 0 ? folderParts.join('/') : selectedRootName;
          upsertProcessingEntry(rel, displayFolderPath, f.name, 'hashing', f.size);

          const sha256Hash = await computeBrowserSha256(f);
          manifest.push({
            unitFolderName,
            pathSegmentsFromUnit,
            fileName: f.name,
            legacySourcePath: rel,
            displayFolderPath,
            mimeType: guessBrowserMime(f),
            sizeBytes: f.size,
            sha256Hash,
            _file: f,
          });
        }

        if (shouldCancel() || manifest.length === 0) break;

        for (const item of manifest) {
          upsertProcessingEntry(
            item.legacySourcePath,
            item.displayFolderPath,
            item.fileName,
            'verificando',
            item.sizeBytes
          );
        }

        const diffRes = await apiFetchWithRetry<{
          decisions: Array<{
            legacySourcePath: string;
            action: string;
            itemId?: number;
            uploadMode?: 'r2_multipart' | 'r2_presigned' | 'server_fallback';
            presignedPutUrl?: string;
            objectKey?: string;
            uploadId?: string;
            storageUri?: string;
            deduplicatedInstant?: boolean;
          }>;
        }>(
          `/api/migration/batches/${targetBatch.id}/manifest-diff`,
          {
            method: 'POST',
            body: JSON.stringify({
              sourceRootPath: selectedRootName || targetBatch.sourceRootPath,
              dryRun,
              fallbackUnitId: fallbackUnit?.id,
              preferServerFallback: r2CorsBlocked,
              files: manifest.map(({ _file, displayFolderPath: _dfp, ...rest }) => rest),
            }),
          },
          { maxAttempts: 4, shouldCancel, signal }
        );

        const uploadQueue: Array<{
          decision: (typeof diffRes.decisions)[number];
          source: (typeof manifest)[number];
        }> = [];

        for (const d of diffRes.decisions || []) {
          const source = manifest.find((m) => m.legacySourcePath === d.legacySourcePath);
          if (d.action === 'unchanged') {
            counters.deduplicated++;
            if (source) {
              upsertProcessingEntry(
                source.legacySourcePath,
                source.displayFolderPath,
                source.fileName,
                'deduplicado',
                source.sizeBytes
              );
            }
          } else if (d.action === 'update_path') {
            counters.moved++;
            if (source) {
              upsertProcessingEntry(
                source.legacySourcePath,
                source.displayFolderPath,
                source.fileName,
                'concluido',
                source.sizeBytes
              );
            }
          } else if (d.action === 'blocked_ext') {
            counters.blocked++;
          } else if (d.action === 'unmatched_unit' || d.action === 'unmatched_contract') {
            counters.unmatched++;
          } else if (d.action === 'create' || d.action === 'update_content') {
            if (dryRun || d.deduplicatedInstant) {
              if (d.action === 'update_content') counters.updated++;
              else counters.created++;
              if (source) {
                upsertProcessingEntry(
                  source.legacySourcePath,
                  source.displayFolderPath,
                  source.fileName,
                  d.deduplicatedInstant ? 'deduplicado' : 'concluido',
                  source.sizeBytes
                );
              }
            } else if (source) {
              uploadQueue.push({ decision: d, source });
            }
          }
        }

        if (!dryRun && uploadQueue.length > 0) {
          const committedItems: Array<{
            itemId: number;
            storageUri?: string;
            success: boolean;
            errorMessage?: string;
          }> = [];
          let cursor = 0;
          const workerCount = Math.min(3, uploadQueue.length);
          await Promise.all(
            Array.from({ length: workerCount }, async () => {
              while (cursor < uploadQueue.length && !shouldCancel()) {
                const entry = uploadQueue[cursor++];
                const { decision, source } = entry;
                const itemId = Number(decision.itemId || 0);
                upsertProcessingEntry(
                  source.legacySourcePath,
                  source.displayFolderPath,
                  source.fileName,
                  'enviando',
                  source.sizeBytes
                );
                try {
                  if (
                    decision.uploadMode === 'r2_multipart' &&
                    decision.objectKey &&
                    decision.uploadId
                  ) {
                    const totalParts = Math.ceil(source._file.size / PART_SIZE);
                    const completedParts: Array<{ partNumber: number; etag: string }> = [];
                    let signedUrls: Record<string, string> | null = null;

                    if (!r2CorsBlocked) {
                      const signedRes = await apiFetchWithRetry<{ partUrls: Record<string, string> }>(
                        `/api/migration/batches/${targetBatch!.id}/multipart/sign-parts`,
                        {
                          method: 'POST',
                          body: JSON.stringify({
                            itemId,
                            objectKey: decision.objectKey,
                            uploadId: decision.uploadId,
                            partNumbers: Array.from({ length: totalParts }, (_, i) => i + 1),
                          }),
                        },
                        { maxAttempts: 4, shouldCancel, signal }
                      );
                      signedUrls = signedRes.partUrls;
                    }

                    for (let p = 1; p <= totalParts; p++) {
                      if (shouldCancel()) {
                        throw new DOMException('Operação cancelada pelo usuário.', 'AbortError');
                      }
                      const start = (p - 1) * PART_SIZE;
                      const end = Math.min(start + PART_SIZE, source._file.size);
                      const partSlice = source._file.slice(start, end);
                      let partEtag = '';

                      if (!r2CorsBlocked && signedUrls?.[String(p)]) {
                        try {
                          const putResp = await fetchWithRetry(
                            signedUrls[String(p)],
                            { method: 'PUT', body: partSlice },
                            { maxAttempts: 3, shouldCancel, signal }
                          );
                          if (!putResp.ok) {
                            throw new Error(`R2 UploadPart #${p} HTTP ${putResp.status}`);
                          }
                          partEtag = putResp.headers.get('etag') || putResp.headers.get('ETag') || '';
                        } catch (directPartErr) {
                          if (isAbortError(directPartErr)) throw directPartErr;
                          if (isNetworkOrCorsTypeError(directPartErr)) {
                            r2CorsBlocked = true;
                          } else {
                            throw directPartErr;
                          }
                        }
                      }

                      if (!partEtag) {
                        const proxyResp = await fetchWithRetry(
                          `/api/migration/batches/${targetBatch!.id}/multipart/proxy-part?objectKey=${encodeURIComponent(
                            decision.objectKey
                          )}&uploadId=${encodeURIComponent(decision.uploadId)}&partNumber=${p}`,
                          {
                            method: 'PUT',
                            headers: {
                              'x-unit-id': String(getActiveUnitHeader()),
                              ...(token ? { Authorization: `Bearer ${token}` } : {}),
                              'content-type': 'application/octet-stream',
                            },
                            body: partSlice,
                          },
                          { maxAttempts: 4, shouldCancel, signal }
                        );
                        if (!proxyResp.ok) {
                          const errData = await proxyResp.json().catch(() => ({}));
                          throw new Error(
                            (errData as { error?: string }).error ||
                              `Proxy UploadPart #${p} HTTP ${proxyResp.status}`
                          );
                        }
                        const proxyJson = (await proxyResp.json().catch(() => ({}))) as { etag?: string };
                        partEtag = proxyJson.etag || '';
                      }

                      completedParts.push({ partNumber: p, etag: partEtag });
                    }

                    await apiFetchWithRetry(
                      `/api/migration/batches/${targetBatch!.id}/multipart/complete`,
                      {
                        method: 'POST',
                        body: JSON.stringify({
                          itemId,
                          objectKey: decision.objectKey,
                          uploadId: decision.uploadId,
                          parts: completedParts,
                        }),
                      },
                      { maxAttempts: 4, shouldCancel, signal }
                    );
                    committedItems.push({ itemId, storageUri: decision.storageUri, success: true });
                  } else if (
                    decision.uploadMode === 'r2_presigned' &&
                    decision.presignedPutUrl &&
                    !r2CorsBlocked
                  ) {
                    let directOk = false;
                    try {
                      const putResp = await fetchWithRetry(
                        decision.presignedPutUrl,
                        {
                          method: 'PUT',
                          headers: { 'content-type': source.mimeType || 'application/octet-stream' },
                          body: source._file,
                        },
                        { maxAttempts: 3, shouldCancel, signal }
                      );
                      if (!putResp.ok) throw new Error(`R2 PutObject HTTP ${putResp.status}`);
                      committedItems.push({ itemId, storageUri: decision.storageUri, success: true });
                      directOk = true;
                    } catch (directErr) {
                      if (isAbortError(directErr)) throw directErr;
                      if (isNetworkOrCorsTypeError(directErr)) {
                        r2CorsBlocked = true;
                      }
                      if (source._file.size <= 28 * 1024 * 1024) {
                        const fbResp = await fetchWithRetry(
                          `/api/migration/batches/${targetBatch!.id}/upload-fallback/${itemId}`,
                          {
                            method: 'PUT',
                            headers: {
                              'x-unit-id': String(getActiveUnitHeader()),
                              ...(token ? { Authorization: `Bearer ${token}` } : {}),
                              'content-type': source.mimeType || 'application/octet-stream',
                            },
                            body: source._file,
                          },
                          { maxAttempts: 4, shouldCancel, signal }
                        );
                        if (!fbResp.ok) {
                          const errData = await fbResp.json().catch(() => ({}));
                          throw new Error(
                            (errData as { error?: string }).error || `Upload HTTP ${fbResp.status}`
                          );
                        }
                        directOk = true;
                      } else {
                        throw directErr;
                      }
                    }
                    if (!directOk) throw new Error('Falha no envio do arquivo.');
                  } else {
                    const fbResp = await fetchWithRetry(
                      `/api/migration/batches/${targetBatch!.id}/upload-fallback/${itemId}`,
                      {
                        method: 'PUT',
                        headers: {
                          'x-unit-id': String(getActiveUnitHeader()),
                          ...(token ? { Authorization: `Bearer ${token}` } : {}),
                          'content-type': source.mimeType || 'application/octet-stream',
                        },
                        body: source._file,
                      },
                      { maxAttempts: 4, shouldCancel, signal }
                    );
                    if (!fbResp.ok) {
                      const errData = await fbResp.json().catch(() => ({}));
                      throw new Error(
                        (errData as { error?: string }).error || `Upload HTTP ${fbResp.status}`
                      );
                    }
                  }

                  if (decision.action === 'update_content') counters.updated++;
                  else counters.created++;

                  upsertProcessingEntry(
                    source.legacySourcePath,
                    source.displayFolderPath,
                    source.fileName,
                    'concluido',
                    source.sizeBytes
                  );
                } catch (err) {
                  if (isAbortError(err) || shouldCancel()) {
                    return;
                  }
                  counters.failed++;
                  counters.lastError = err instanceof Error ? err.message : String(err);
                  committedItems.push({
                    itemId,
                    success: false,
                    errorMessage: counters.lastError,
                  });
                  upsertProcessingEntry(
                    source.legacySourcePath,
                    source.displayFolderPath,
                    source.fileName,
                    'erro',
                    source.sizeBytes
                  );
                }
              }
            })
          );

          const needCommit = committedItems.filter((c) => c.storageUri || !c.success);
          if (needCommit.length > 0 && !shouldCancel()) {
            await apiFetchWithRetry(
              `/api/migration/batches/${targetBatch.id}/commit-items`,
              {
                method: 'POST',
                body: JSON.stringify({ items: needCommit }),
              },
              { maxAttempts: 4, shouldCancel, signal }
            );
          }
        }
      } catch (chunkErr) {
        if (isAbortError(chunkErr) || shouldCancel()) break;
        counters.failed += slice.length;
        counters.lastError = chunkErr instanceof Error ? chunkErr.message : String(chunkErr);
      }

      if (shouldCancel()) break;

      counters.processedFiles = Math.min(offset + slice.length, filesToUpload.length);
      commitState();
      notifyActivityStamp();

      const now = Date.now();
      if (
        chunkIndex % 4 === 0 ||
        now - lastUiRefreshAt >= 3500 ||
        counters.processedFiles >= filesToUpload.length
      ) {
        lastUiRefreshAt = now;
        emitBatchUpdate(targetBatch.id, false);
      }
    }

    if (shouldCancel()) {
      counters.cancelled = true;
      counters.cancelling = false;
      try {
        await apiFetch(`/api/migration/batches/${targetBatch.id}/cancel`, {
          method: 'POST',
          body: JSON.stringify({}),
        });
      } catch {
        // best effort
      }
      emitBatchUpdate(targetBatch.id, true);
      onToast?.('Processo de envio cancelado pelo usuário.');
    } else if (!dryRun) {
      await apiFetchWithRetry(
        `/api/migration/batches/${targetBatch.id}/finalize`,
        {
          method: 'POST',
          body: JSON.stringify({}),
        },
        { maxAttempts: 4 }
      );
      counters.completed = true;
      emitBatchUpdate(targetBatch.id, true);
      onToast?.(
        counters.failed > 0
          ? `Subpastas processadas: ${counters.created} novos, ${counters.updated} atualizados, ${counters.deduplicated} deduplicados e ${counters.failed} falha(s).`
          : `Subpastas criadas e envio concluído: ${counters.created} novos, ${counters.updated} atualizados, ${counters.deduplicated} deduplicados.`
      );
    } else {
      counters.completed = true;
      emitBatchUpdate(targetBatch.id, true);
      onToast?.(
        `Simulação concluída: ${counters.created} seriam criados, ${counters.unmatched} sem contrato identificado.`
      );
    }
  } catch (err) {
    if (shouldCancel() || isAbortError(err)) {
      counters.cancelled = true;
      onToast?.('Processo de envio cancelado pelo usuário.');
    } else {
      counters.lastError = err instanceof Error ? err.message : 'Falha no envio pelo navegador.';
      onToast?.(counters.lastError);
    }
  } finally {
    window.clearInterval(keepAliveTimer);
    activeAbortController = null;
    counters.running = false;
    counters.cancelling = false;
    counters.finishedAt = Date.now();
    commitState();
    notifyActivityStamp();
    apiFetch('/api/auth/activity', { method: 'POST' }).catch(() => {});
  }
}
