import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownUp,
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Download,
  Eye,
  FileSpreadsheet,
  FileText,
  GitBranch,
  Landmark,
  Layers,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Table2,
  Upload,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import { apiFetch, getActiveUnitHeader, getAuthToken, parseJsonResponse } from '../../../lib/api.ts';

const MAX_UPLOAD_BYTES = 500 * 1024 * 1024; // 500 MB
const CHUNK_SIZE_BYTES = 4 * 1024 * 1024; // 4 MB chunks (contorna limites HTTP de proxy sem timeout)

interface HubColumnSpec {
  key: string;
  header: string;
  type: string;
  required?: boolean;
  isUpsertKey?: boolean;
  isAutoCode?: boolean;
  fkTarget?: string;
  description: string;
  example: string;
}

interface HubEntityLayout {
  key: string;
  sheetName: string;
  label: string;
  tier: number;
  order: number;
  dependsOn: string[];
  naturalKeyDescription: string;
  autoCodeField?: string;
  autoCodePrefix?: string;
  unitScoped: boolean;
  columns: HubColumnSpec[];
}

interface HubPackageLayout {
  key: string;
  label: string;
  description: string;
  entityKeys: string[];
}

interface HubUnitOption {
  id: number;
  code: string;
  name: string;
  active: boolean;
}

interface ExcelImportRowEval {
  entityKey: string;
  sheetName: string;
  rowNumber: number;
  action: 'INSERT' | 'UPDATE' | 'SKIP' | 'ERROR';
  naturalKey: string;
  assignedCode: string;
  integrativeCode: string;
  message: string;
}

interface ExcelImportSheetSummary {
  entityKey: string;
  label: string;
  sheetName: string;
  tier: number;
  order: number;
  totalRows: number;
  inserts: number;
  updates: number;
  skips: number;
  errors: number;
}

interface ExcelImportResult {
  mode: 'dry_run' | 'commit';
  orderedSheets: ExcelImportSheetSummary[];
  totals: { totalRows: number; inserts: number; updates: number; skips: number; errors: number };
  rowResults: ExcelImportRowEval[];
  unrecognizedSheets: string[];
  returnWorkbookBase64?: string;
  returnFileName?: string;
}

interface FolhaRostoVariableDef {
  key: string;
  token: string;
  label: string;
  targetGroup: string;
  inVeiculoForm: boolean;
  inCartaoForm: boolean;
  exclusiveToVeiculo: boolean;
}

interface FolhaRostoFormSnapshot {
  key: 'veiculo' | 'cartao';
  id?: string;
  name: string;
  description: string;
  variables: string[];
  variableCount: number;
  previewHtml: string;
}

interface FolhaRostoReferencePayload {
  forms: {
    veiculo: FolhaRostoFormSnapshot;
    cartao: FolhaRostoFormSnapshot;
  };
  variables: FolhaRostoVariableDef[];
  entityTargets: Array<{
    group: string;
    label: string;
    tableName: string;
    description: string;
  }>;
}

interface IviColumnMappingItem {
  sheetName: string;
  sourceColumn: string;
  sampleValues: string[];
  mappedVariableKey: string;
  targetGroup: string;
  formOrigin: 'ambos' | 'veiculo' | 'cartao' | 'titular' | '';
  confidence: 'alta' | 'media' | 'ia_gemini' | 'nao_mapeada';
  reason: string;
}

interface IviRowPreview {
  sheetName: string;
  rowNumber: number;
  detectedForm: 'veiculo' | 'cartao';
  formLabel: string;
  clientName: string;
  clientCpf: string;
  titularName: string;
  titularCpf: string;
  bankName: string;
  collaboratorName: string;
  contractNumber: string;
  vehicleSummary: string;
  actions: string[];
  warnings: string[];
}

interface IviFolhaRostoAnalyzeResult {
  fileName: string;
  fileSizeBytes: number;
  uploadSessionId?: string;
  detectedFormSummary: {
    dominantForm: 'veiculo' | 'cartao' | 'misto';
    veiculoRows: number;
    cartaoRows: number;
    totalRows: number;
  };
  sheets: Array<{
    sheetName: string;
    headers: string[];
    rowCount: number;
  }>;
  mappings: IviColumnMappingItem[];
  availableVariables: FolhaRostoVariableDef[];
  estimatedOperations: {
    clientsInsert: number;
    clientsUpdate: number;
    titularesInsert: number;
    titularesUpdate: number;
    assetLinksInsert: number;
    banksInsert: number;
    banksMatched: number;
    collaboratorsInsert: number;
    collaboratorsMatched: number;
    admissionsInsert: number;
    admissionsUpdate: number;
    errors: number;
  };
  previews: IviRowPreview[];
  iviDiagnosticText: string;
  usedGemini: boolean;
  pdfMetadata?: {
    isPdf: true;
    pageCount: number;
    digitalPages: number;
    ocrPages: number;
    extractedRecords: number;
    extractionMode: 'texto_digital' | 'ocr_gemini' | 'hibrido';
  };
}

interface IviFolhaRostoCommitResult {
  totals: {
    totalRows: number;
    clientsCreated: number;
    clientsUpdated: number;
    titularesCreated: number;
    titularesUpdated: number;
    assetLinksCreated: number;
    banksCreated: number;
    banksLinked: number;
    collaboratorsCreated: number;
    collaboratorsLinked: number;
    admissionsCreated: number;
    admissionsUpdated: number;
    errors: number;
  };
  rowLogs: Array<{
    sheetName: string;
    rowNumber: number;
    formMatched: string;
    clientName: string;
    titularName: string;
    bankName: string;
    collaboratorName: string;
    contractNumber: string;
    protocolCode: string;
    integrativeCode: string;
    status: 'OK' | 'ERRO';
    detail: string;
  }>;
  returnWorkbookBase64: string;
  returnFileName: string;
}

interface StdBatchProgress {
  phase: 'uploading' | 'preparing' | 'processing' | 'finalizing';
  mode: 'dry_run' | 'commit';
  pct: number;
  uploadedBytes: number;
  totalBytes: number;
  processedChunks: number;
  totalChunks: number;
  markedReadChunks: number;
  processedRows: number;
  totalRows: number;
  currentSheetName: string;
  currentEntityLabel: string;
  currentTier: number;
  phaseLabel: string;
  cumulativeTotals?: { totalRows: number; inserts: number; updates: number; skips: number; errors: number };
}

interface IviProgressState {
  phase: 'uploading' | 'preparing' | 'analyzing' | 'committing' | 'finalizing';
  pct: number;
  processedUnits: number;
  totalUnits: number;
  processedRows: number;
  totalRows: number;
  markedReadChunks: number;
  currentLabel: string;
  phaseLabel: string;
  extractedRecords: number;
  liveTotals?: {
    clients: number;
    titulares: number;
    banks: number;
    collaborators: number;
    admissions: number;
    errors: number;
  };
}

interface ConfigDataHubViewProps {
  onToast: (msg: string) => void;
  onDataImported?: () => void;
  legacyCsvSection?: React.ReactNode;
}

function downloadBase64Xlsx(base64: string, fileName: string) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const blob = new Blob([bytes], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

async function fetchWithTransientRetry(
  url: string,
  init: RequestInit,
  maxRetries = 2
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (init.signal?.aborted) {
      throw new DOMException('Operação cancelada pelo usuário.', 'AbortError');
    }
    try {
      const res = await fetch(url, init);
      if (res.status >= 502 && res.status <= 504 && attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 700 * (attempt + 1)));
        continue;
      }
      return res;
    } catch (err) {
      if ((err as Error)?.name === 'AbortError' || init.signal?.aborted) {
        throw err;
      }
      lastError = err;
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 700 * (attempt + 1)));
        continue;
      }
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error('Falha de conexão com o servidor durante o processamento em partes.');
}

async function uploadSpreadsheetInChunks(
  file: File,
  onProgress: (pct: number, uploadedBytes: number) => void,
  signal?: AbortSignal
): Promise<string> {
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(`O arquivo "${file.name}" (${formatBytes(file.size)}) excede o limite de 500 MB.`);
  }
  const token = getAuthToken();
  const baseHeaders: Record<string, string> = {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    'x-unit-id': String(getActiveUnitHeader()),
  };

  const initRes = await fetchWithTransientRetry('/api/data-hub/upload-session/init', {
    method: 'POST',
    signal,
    headers: {
      ...baseHeaders,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      fileName: file.name,
      fileSizeBytes: file.size,
    }),
  });
  const initData = await parseJsonResponse<{ uploadId: string }>(initRes, 'Erro ao iniciar envio do arquivo.');
  const uploadId = initData.uploadId;

  let offset = 0;
  while (offset < file.size) {
    if (signal?.aborted) {
      throw new DOMException('Envio cancelado pelo usuário.', 'AbortError');
    }
    const end = Math.min(offset + CHUNK_SIZE_BYTES, file.size);
    const slice = file.slice(offset, end);
    const buf = await slice.arrayBuffer();
    const chunkRes = await fetchWithTransientRetry(`/api/data-hub/upload-session/${uploadId}/chunk`, {
      method: 'POST',
      signal,
      headers: {
        ...baseHeaders,
        'Content-Type': 'application/octet-stream',
      },
      body: buf,
    });
    if (!chunkRes.ok) {
      await parseJsonResponse(chunkRes, 'Falha ao enviar parte do arquivo.');
    }
    offset = end;
    onProgress(Math.min(100, Math.round((offset / file.size) * 100)), offset);
  }
  return uploadId;
}

const TARGET_GROUP_LABELS: Record<string, string> = {
  cliente: 'Cliente / Responsável (clients)',
  titular: 'Titular do Contrato (clients + vínculos)',
  banco: 'Banco / Financeira (banks)',
  colaborador: 'Colaborador / Consultor (collaborators)',
  admissao: 'Admissão / Veículo / Parcelas (admissions)',
  recalculo: 'Recálculo / Dívida / Economia (admissions)',
  modalidade: 'Modalidade (modalities + admissions)',
  empresa: 'Unidade / Filial (units)',
};

export const ConfigDataHubView: React.FC<ConfigDataHubViewProps> = ({
  onToast,
  onDataImported,
  legacyCsvSection,
}) => {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [tiers, setTiers] = useState<Record<number, string>>({});
  const [entities, setEntities] = useState<HubEntityLayout[]>([]);
  const [packages, setPackages] = useState<HubPackageLayout[]>([]);
  const [units, setUnits] = useState<HubUnitOption[]>([]);

  const [viewMode, setViewMode] = useState<'packages' | 'entities'>('packages');
  const [unitFilter, setUnitFilter] = useState<string>('all');
  const [tierFilter, setTierFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedEntityKey, setExpandedEntityKey] = useState<string | null>(null);

  // Standard DataHub Import state (supports up to 500 MB via chunked session)
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [pendingLayoutTarget, setPendingLayoutTarget] = useState<{
    scopeType: 'package' | 'entity';
    key: string;
    label: string;
  } | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [stdUploadSessionId, setStdUploadSessionId] = useState<string | null>(null);
  const [stdProgress, setStdProgress] = useState<StdBatchProgress | null>(null);
  const stdAbortRef = useRef<AbortController | null>(null);
  const stdPreparedInfoRef = useRef<{ totalChunks: number; totalRows: number } | null>(null);
  const [assignIntegrative, setAssignIntegrative] = useState(true);
  const [unitFallbackId, setUnitFallbackId] = useState<string>('');
  const [dryRunResult, setDryRunResult] = useState<ExcelImportResult | null>(null);
  const [commitResult, setCommitResult] = useState<ExcelImportResult | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState('');
  const [actionFilter, setActionFilter] = useState<'ALL' | 'INSERT' | 'UPDATE' | 'ERROR'>('ALL');
  const [showLegacyCsv, setShowLegacyCsv] = useState(false);

  // Ivi Folha de Rosto Comparative Reader state (up to 500 MB)
  const iviFileInputRef = useRef<HTMLInputElement | null>(null);
  const [folhaForms, setFolhaForms] = useState<FolhaRostoReferencePayload | null>(null);
  const [showFormsInspector, setShowFormsInspector] = useState(false);
  const [activeFormTab, setActiveFormTab] = useState<'veiculo' | 'cartao' | 'targets'>('veiculo');
  const [showFormHtmlPreview, setShowFormHtmlPreview] = useState(false);
  const [iviForceForm, setIviForceForm] = useState<'auto' | 'veiculo' | 'cartao'>('auto');
  const [iviSelectedFile, setIviSelectedFile] = useState<File | null>(null);
  const [iviUploadSessionId, setIviUploadSessionId] = useState<string | null>(null);
  const [iviBatchProgress, setIviBatchProgress] = useState<IviProgressState | null>(null);
  const iviAbortRef = useRef<AbortController | null>(null);
  const iviPreparedInfoRef = useRef<{ totalChunks: number; totalRows: number; isPdf: boolean } | null>(null);
  const [iviBusy, setIviBusy] = useState(false);
  const [iviError, setIviError] = useState('');
  const [iviAnalysis, setIviAnalysis] = useState<IviFolhaRostoAnalyzeResult | null>(null);
  const [iviCommitResult, setIviCommitResult] = useState<IviFolhaRostoCommitResult | null>(null);
  const [mappingOverrides, setMappingOverrides] = useState<Record<string, string>>({});

  const loadRegistry = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const [data, formsData] = await Promise.all([
        apiFetch<{
          tiers: Record<number, string>;
          entities: HubEntityLayout[];
          packages: HubPackageLayout[];
          units: HubUnitOption[];
        }>('/api/data-hub/layouts'),
        apiFetch<FolhaRostoReferencePayload>('/api/data-hub/ivi-folha-rosto/forms').catch(() => null),
      ]);
      setTiers(data.tiers || {});
      setEntities(data.entities || []);
      setPackages(data.packages || []);
      setUnits(data.units || []);
      if (formsData) setFolhaForms(formsData);
      if (data.units?.length && !unitFallbackId) {
        setUnitFallbackId(String(data.units[0].id));
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Erro ao carregar catálogo de planilhas.');
    } finally {
      setLoading(false);
    }
  }, [unitFallbackId]);

  useEffect(() => {
    loadRegistry();
  }, [loadRegistry]);

  const releaseUploadSession = async (sessionId: string | null) => {
    if (!sessionId) return;
    try {
      await apiFetch(`/api/data-hub/upload-session/${sessionId}`, { method: 'DELETE' });
    } catch {
      // non-fatal cleanup
    }
  };

  const entityMap = useMemo(() => {
    const map = new Map<string, HubEntityLayout>();
    entities.forEach((e) => map.set(e.key, e));
    return map;
  }, [entities]);

  const filteredEntities = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return entities
      .filter((e) => (tierFilter === 'all' ? true : String(e.tier) === tierFilter))
      .filter((e) => {
        if (!q) return true;
        return (
          e.label.toLowerCase().includes(q) ||
          e.sheetName.toLowerCase().includes(q) ||
          e.key.toLowerCase().includes(q) ||
          e.naturalKeyDescription.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => a.order - b.order);
  }, [entities, tierFilter, searchQuery]);

  const handleDownloadXlsx = async (params: {
    scopeType: 'package' | 'entity';
    key: string;
    mode: 'template' | 'data';
    label: string;
  }) => {
    try {
      const token = getAuthToken();
      const qs = new URLSearchParams({
        scopeType: params.scopeType,
        key: params.key,
        mode: params.mode,
        unitId: unitFilter,
      });
      const res = await fetch(`/api/data-hub/export-xlsx?${qs.toString()}`, {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          'x-unit-id': String(getActiveUnitHeader()),
        },
      });
      if (!res.ok) {
        await parseJsonResponse(res, 'Falha ao exportar Excel.');
      }
      const disp = res.headers.get('content-disposition') || '';
      const fnMatch = disp.match(/filename="([^"]+)"/);
      const fileName = fnMatch ? fnMatch[1] : `invicta_${params.key}_${params.mode}.xlsx`;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
      onToast(
        params.mode === 'template'
          ? `Modelo Excel "${params.label}" baixado com abas Dicionário & Domínio.`
          : `Exportação Excel "${params.label}" gerada com sucesso.`
      );
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Erro ao gerar arquivo .xlsx');
    }
  };

  const runDryRun = async (file: File, target?: { scopeType: 'package' | 'entity'; key: string; label: string } | null) => {
    stdAbortRef.current?.abort();
    const controller = new AbortController();
    stdAbortRef.current = controller;

    setImportBusy(true);
    setImportError('');
    setDryRunResult(null);
    setCommitResult(null);
    stdPreparedInfoRef.current = null;
    try {
      if (file.size > MAX_UPLOAD_BYTES) {
        throw new Error(`O arquivo excede o limite máximo de 500 MB (${formatBytes(file.size)}).`);
      }

      const token = getAuthToken();
      const jsonHeaders: Record<string, string> = {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        'x-unit-id': String(getActiveUnitHeader()),
        'Content-Type': 'application/json',
      };

      if (stdUploadSessionId) await releaseUploadSession(stdUploadSessionId);
      setStdProgress({
        phase: 'uploading',
        mode: 'dry_run',
        pct: 0,
        uploadedBytes: 0,
        totalBytes: file.size,
        processedChunks: 0,
        totalChunks: 0,
        markedReadChunks: 0,
        processedRows: 0,
        totalRows: 0,
        currentSheetName: '',
        currentEntityLabel: '',
        currentTier: 0,
        phaseLabel: 'Enviando arquivo em partes seguras para o servidor...',
      });

      const sessionId = await uploadSpreadsheetInChunks(
        file,
        (pct, uploadedBytes) =>
          setStdProgress((prev) =>
            prev
              ? {
                  ...prev,
                  phase: 'uploading',
                  pct,
                  uploadedBytes,
                  phaseLabel: `Enviando planilha em partes (${pct}%) · ${formatBytes(uploadedBytes)} / ${formatBytes(file.size)}`,
                }
              : prev
          ),
        controller.signal
      );
      setStdUploadSessionId(sessionId);

      setStdProgress({
        phase: 'preparing',
        mode: 'dry_run',
        pct: 5,
        uploadedBytes: file.size,
        totalBytes: file.size,
        processedChunks: 0,
        totalChunks: 0,
        markedReadChunks: 0,
        processedRows: 0,
        totalRows: 0,
        currentSheetName: '',
        currentEntityLabel: '',
        currentTier: 0,
        phaseLabel: 'Lendo abas em streaming e fatiando lotes de 250 linhas em ordem topológica (Camadas 0 → 4)...',
      });

      const prepRes = await fetchWithTransientRetry('/api/data-hub/import-xlsx/prepare', {
        method: 'POST',
        signal: controller.signal,
        headers: jsonHeaders,
        body: JSON.stringify({
          uploadSessionId: sessionId,
          expectedLayoutKey: target && target.scopeType === 'entity' ? target.key : undefined,
        }),
      });
      const prep = await parseJsonResponse<{
        totalSheets: number;
        totalChunks: number;
        totalRows: number;
        batchSizeRows: number;
      }>(prepRes, 'Falha ao preparar streaming da planilha Excel.');

      stdPreparedInfoRef.current = { totalChunks: prep.totalChunks, totalRows: prep.totalRows };
      const batchSize = 2;

      for (let startChunk = 0; startChunk < prep.totalChunks; startChunk += batchSize) {
        if (controller.signal.aborted) {
          throw new DOMException('Pré-validação cancelada pelo usuário.', 'AbortError');
        }
        const batchRes = await fetchWithTransientRetry('/api/data-hub/import-xlsx/process-batch', {
          method: 'POST',
          signal: controller.signal,
          headers: jsonHeaders,
          body: JSON.stringify({
            uploadSessionId: sessionId,
            mode: 'dry_run',
            startChunk,
            batchCount: batchSize,
            unitFallbackId: unitFallbackId || undefined,
            assignIntegrative,
          }),
        });
        const batch = await parseJsonResponse<{
          processedChunks: number;
          totalChunks: number;
          markedReadChunks: number;
          processedRows: number;
          totalRows: number;
          currentSheetName: string;
          currentEntityLabel: string;
          currentTier: number;
          cumulativeTotals: { totalRows: number; inserts: number; updates: number; skips: number; errors: number };
        }>(batchRes, 'Falha ao validar lote da planilha.');

        const pct = batch.totalChunks > 0 ? Math.min(99, Math.round((batch.processedChunks / batch.totalChunks) * 100)) : 99;
        setStdProgress({
          phase: 'processing',
          mode: 'dry_run',
          pct,
          uploadedBytes: file.size,
          totalBytes: file.size,
          processedChunks: batch.processedChunks,
          totalChunks: batch.totalChunks,
          markedReadChunks: batch.markedReadChunks,
          processedRows: batch.processedRows,
          totalRows: batch.totalRows,
          currentSheetName: batch.currentSheetName,
          currentEntityLabel: batch.currentEntityLabel,
          currentTier: batch.currentTier,
          phaseLabel: `Pré-validando lote ${batch.processedChunks}/${batch.totalChunks} · Camada ${batch.currentTier} · ${batch.currentSheetName}`,
          cumulativeTotals: batch.cumulativeTotals,
        });
      }

      setStdProgress((prev) =>
        prev
          ? {
              ...prev,
              phase: 'finalizing',
              pct: 100,
              phaseLabel: 'Consolidando resumo da pré-validação...',
            }
          : prev
      );

      const finRes = await fetchWithTransientRetry('/api/data-hub/import-xlsx/finalize', {
        method: 'POST',
        signal: controller.signal,
        headers: jsonHeaders,
        body: JSON.stringify({
          uploadSessionId: sessionId,
          mode: 'dry_run',
          unitFallbackId: unitFallbackId || undefined,
        }),
      });
      const payload = await parseJsonResponse<ExcelImportResult>(finRes, 'Falha ao consolidar pré-validação Excel.');
      setDryRunResult(payload);
      onToast(
        `Pré-validação concluída em lotes: ${payload.totals?.inserts || 0} novo(s), ${
          payload.totals?.updates || 0
        } atualização(ões).`
      );
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') {
        setImportError('Pré-validação cancelada pelo usuário.');
      } else {
        setImportError(err instanceof Error ? err.message : 'Erro ao validar planilha.');
      }
    } finally {
      setImportBusy(false);
      setStdProgress(null);
      stdAbortRef.current = null;
    }
  };

  const triggerLayoutImportPicker = (target: { scopeType: 'package' | 'entity'; key: string; label: string } | null) => {
    setPendingLayoutTarget(target);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  };

  const handleFileChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelectedFile(file);
    await runDryRun(file, pendingLayoutTarget);
  };

  const handleCommitImport = async () => {
    if (!selectedFile) return;
    stdAbortRef.current?.abort();
    const controller = new AbortController();
    stdAbortRef.current = controller;

    setImportBusy(true);
    setImportError('');
    try {
      const token = getAuthToken();
      const jsonHeaders: Record<string, string> = {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        'x-unit-id': String(getActiveUnitHeader()),
        'Content-Type': 'application/json',
      };

      let sessionId = stdUploadSessionId;
      let totalChunks = stdPreparedInfoRef.current?.totalChunks || 0;
      let totalRows = stdPreparedInfoRef.current?.totalRows || 0;

      if (!sessionId) {
        setStdProgress({
          phase: 'uploading',
          mode: 'commit',
          pct: 0,
          uploadedBytes: 0,
          totalBytes: selectedFile.size,
          processedChunks: 0,
          totalChunks: 0,
          markedReadChunks: 0,
          processedRows: 0,
          totalRows: 0,
          currentSheetName: '',
          currentEntityLabel: '',
          currentTier: 0,
          phaseLabel: 'Reenviando arquivo em partes seguras...',
        });
        sessionId = await uploadSpreadsheetInChunks(
          selectedFile,
          (pct, uploadedBytes) =>
            setStdProgress((prev) =>
              prev
                ? {
                    ...prev,
                    pct,
                    uploadedBytes,
                    phaseLabel: `Enviando arquivo (${pct}%) · ${formatBytes(uploadedBytes)} / ${formatBytes(selectedFile.size)}`,
                  }
                : prev
            ),
          controller.signal
        );
        setStdUploadSessionId(sessionId);
        totalChunks = 0;
      }

      if (totalChunks <= 0) {
        setStdProgress({
          phase: 'preparing',
          mode: 'commit',
          pct: 5,
          uploadedBytes: selectedFile.size,
          totalBytes: selectedFile.size,
          processedChunks: 0,
          totalChunks: 0,
          markedReadChunks: 0,
          processedRows: 0,
          totalRows: 0,
          currentSheetName: '',
          currentEntityLabel: '',
          currentTier: 0,
          phaseLabel: 'Preparando lotes em disco para gravação transacional...',
        });
        const prepRes = await fetchWithTransientRetry('/api/data-hub/import-xlsx/prepare', {
          method: 'POST',
          signal: controller.signal,
          headers: jsonHeaders,
          body: JSON.stringify({
            uploadSessionId: sessionId,
            expectedLayoutKey: pendingLayoutTarget?.scopeType === 'entity' ? pendingLayoutTarget.key : undefined,
          }),
        });
        const prep = await parseJsonResponse<{ totalChunks: number; totalRows: number }>(
          prepRes,
          'Falha ao preparar lotes de gravação.'
        );
        totalChunks = prep.totalChunks;
        totalRows = prep.totalRows;
        stdPreparedInfoRef.current = { totalChunks, totalRows };
      }

      for (let startChunk = 0; startChunk < totalChunks; startChunk += 1) {
        if (controller.signal.aborted) {
          throw new DOMException('Gravação cancelada pelo usuário.', 'AbortError');
        }
        const batchRes = await fetchWithTransientRetry('/api/data-hub/import-xlsx/process-batch', {
          method: 'POST',
          signal: controller.signal,
          headers: jsonHeaders,
          body: JSON.stringify({
            uploadSessionId: sessionId,
            mode: 'commit',
            startChunk,
            batchCount: 1,
            unitFallbackId: unitFallbackId || undefined,
            assignIntegrative,
          }),
        });
        const batch = await parseJsonResponse<{
          processedChunks: number;
          totalChunks: number;
          markedReadChunks: number;
          processedRows: number;
          totalRows: number;
          currentSheetName: string;
          currentEntityLabel: string;
          currentTier: number;
          cumulativeTotals: { totalRows: number; inserts: number; updates: number; skips: number; errors: number };
        }>(batchRes, 'Falha ao gravar lote no PostgreSQL.');

        const pct = batch.totalChunks > 0 ? Math.min(99, Math.round((batch.processedChunks / batch.totalChunks) * 100)) : 99;
        setStdProgress({
          phase: 'processing',
          mode: 'commit',
          pct,
          uploadedBytes: selectedFile.size,
          totalBytes: selectedFile.size,
          processedChunks: batch.processedChunks,
          totalChunks: batch.totalChunks,
          markedReadChunks: batch.markedReadChunks,
          processedRows: batch.processedRows,
          totalRows: batch.totalRows,
          currentSheetName: batch.currentSheetName,
          currentEntityLabel: batch.currentEntityLabel,
          currentTier: batch.currentTier,
          phaseLabel: `Gravando lote ${batch.processedChunks}/${batch.totalChunks} no PostgreSQL · Camada ${batch.currentTier} · ${batch.currentSheetName}`,
          cumulativeTotals: batch.cumulativeTotals,
        });
      }

      setStdProgress((prev) =>
        prev
          ? {
              ...prev,
              phase: 'finalizing',
              pct: 100,
              phaseLabel: 'Registrando auditoria e gerando planilha _Retorno_Importacao.xlsx...',
            }
          : prev
      );

      const finRes = await fetchWithTransientRetry('/api/data-hub/import-xlsx/finalize', {
        method: 'POST',
        signal: controller.signal,
        headers: jsonHeaders,
        body: JSON.stringify({
          uploadSessionId: sessionId,
          mode: 'commit',
          unitFallbackId: unitFallbackId || undefined,
        }),
      });
      const payload = await parseJsonResponse<ExcelImportResult>(
        finRes,
        'Erro ao finalizar importação no banco de dados.'
      );
      setCommitResult(payload);
      setDryRunResult(null);
      setStdUploadSessionId(null);
      stdPreparedInfoRef.current = null;
      if (payload.returnWorkbookBase64 && payload.returnFileName) {
        downloadBase64Xlsx(payload.returnWorkbookBase64, payload.returnFileName);
      }
      onToast(
        `Importação efetivada em lotes: ${payload.totals.inserts} inserção(ões) · ${payload.totals.updates} atualização(ões). Planilha de retorno baixada.`
      );
      onDataImported?.();
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') {
        setImportError('Importação cancelada pelo usuário. Os lotes já gravados permanecem íntegros.');
      } else {
        setImportError(err instanceof Error ? err.message : 'Erro ao gravar importação.');
      }
    } finally {
      setImportBusy(false);
      setStdProgress(null);
      stdAbortRef.current = null;
    }
  };

  // =========================================================================
  // IVI FOLHA DE ROSTO HANDLERS (ATÉ 500 MB · LOTES SEGUROS COM MARCAÇÃO DE LEITURA)
  // =========================================================================
  const runIviAnalyze = async (
    file: File,
    existingSessionId: string | null,
    overrides: Record<string, string>,
    forceFormMode: 'auto' | 'veiculo' | 'cartao'
  ) => {
    iviAbortRef.current?.abort();
    const controller = new AbortController();
    iviAbortRef.current = controller;

    setIviBusy(true);
    setIviError('');
    setIviCommitResult(null);
    setIviBatchProgress(null);
    try {
      if (file.size > MAX_UPLOAD_BYTES) {
        throw new Error(`O arquivo "${file.name}" (${formatBytes(file.size)}) excede o limite de 500 MB.`);
      }

      let sessionId = existingSessionId;
      if (!sessionId) {
        iviPreparedInfoRef.current = null;
        setIviBatchProgress({
          phase: 'uploading',
          pct: 0,
          processedUnits: 0,
          totalUnits: 1,
          processedRows: 0,
          totalRows: 0,
          markedReadChunks: 0,
          currentLabel: file.name,
          phaseLabel: 'Enviando arquivo em partes seguras para a Ivi (0%)...',
          extractedRecords: 0,
        });
        sessionId = await uploadSpreadsheetInChunks(
          file,
          (pct, bytes) => {
            setIviBatchProgress({
              phase: 'uploading',
              pct,
              processedUnits: bytes,
              totalUnits: file.size,
              processedRows: 0,
              totalRows: 0,
              markedReadChunks: 0,
              currentLabel: `${formatBytes(bytes)} / ${formatBytes(file.size)}`,
              phaseLabel: `Enviando arquivo em partes seguras para a Ivi (${pct}%)...`,
              extractedRecords: 0,
            });
          },
          controller.signal
        );
        setIviUploadSessionId(sessionId);
      }

      const token = getAuthToken();
      const jsonHeaders: Record<string, string> = {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        'x-unit-id': String(getActiveUnitHeader()),
        'Content-Type': 'application/json',
      };

      const isPdf = file.name.toLowerCase().endsWith('.pdf');
      let payload: IviFolhaRostoAnalyzeResult;

      if (isPdf && !existingSessionId) {
        // 1. Inspecionar quantidade total de páginas para fatiar em lotes de 5 páginas
        setIviBatchProgress({
          phase: 'preparing',
          pct: 5,
          processedUnits: 0,
          totalUnits: 1,
          processedRows: 0,
          totalRows: 0,
          markedReadChunks: 0,
          currentLabel: file.name,
          phaseLabel: 'Inspecionando estrutura e total de páginas do PDF...',
          extractedRecords: 0,
        });

        const prepRes = await fetchWithTransientRetry('/api/data-hub/ivi-folha-rosto/prepare', {
          method: 'POST',
          signal: controller.signal,
          headers: jsonHeaders,
          body: JSON.stringify({ uploadSessionId: sessionId }),
        });
        const prepInfo = await parseJsonResponse<{
          isPdf: boolean;
          pageCount: number;
          batchSize: number;
          totalBatches: number;
        }>(prepRes, 'Falha ao preparar leitura paginada do PDF.');

        const pageCount = Math.max(1, prepInfo.pageCount || 1);
        const batchSize = Math.max(1, Math.min(5, prepInfo.batchSize || 5));
        const totalBatches = Math.max(1, Math.ceil(pageCount / batchSize));
        iviPreparedInfoRef.current = { totalChunks: totalBatches, totalRows: pageCount, isPdf: true };
        let cumulativeExtracted = 0;

        for (let b = 0; b < totalBatches; b++) {
          if (controller.signal.aborted) {
            throw new DOMException('Leitura de PDF cancelada pelo usuário.', 'AbortError');
          }
          const startPage = b * batchSize + 1;
          const endPage = Math.min(pageCount, startPage + batchSize - 1);

          setIviBatchProgress({
            phase: 'analyzing',
            pct: Math.round(((b * batchSize) / pageCount) * 100),
            processedUnits: b * batchSize,
            totalUnits: pageCount,
            processedRows: cumulativeExtracted,
            totalRows: pageCount,
            markedReadChunks: b,
            currentLabel: `Páginas ${startPage}–${endPage} de ${pageCount}`,
            phaseLabel: `Lote ${b + 1}/${totalBatches} · Lendo páginas ${startPage} a ${endPage} de ${pageCount} e liberando cache...`,
            extractedRecords: cumulativeExtracted,
          });

          const batchRes = await fetchWithTransientRetry('/api/data-hub/ivi-folha-rosto/analyze-batch', {
            method: 'POST',
            signal: controller.signal,
            headers: jsonHeaders,
            body: JSON.stringify({
              uploadSessionId: sessionId,
              startPage,
              endPage,
            }),
          });
          const batchData = await parseJsonResponse<{
            startPage: number;
            endPage: number;
            extractedCount: number;
          }>(batchRes, `Falha ao processar lote de páginas ${startPage} a ${endPage}.`);

          cumulativeExtracted += batchData.extractedCount || 0;
          setIviBatchProgress({
            phase: 'analyzing',
            pct: Math.min(99, Math.round((endPage / pageCount) * 100)),
            processedUnits: endPage,
            totalUnits: pageCount,
            processedRows: cumulativeExtracted,
            totalRows: pageCount,
            markedReadChunks: b + 1,
            currentLabel: `Páginas ${startPage}–${endPage} concluídas`,
            phaseLabel: `Páginas ${startPage} a ${endPage} marcadas como lidas (${cumulativeExtracted} ficha(s))`,
            extractedRecords: cumulativeExtracted,
          });
        }

        setIviBatchProgress((prev) =>
          prev
            ? {
                ...prev,
                phase: 'finalizing',
                pct: 100,
                phaseLabel: 'Consolidando fichas extraídas e comparando com Folha de Rosto - Veículo e Cartão...',
              }
            : prev
        );

        const finRes = await fetchWithTransientRetry('/api/data-hub/ivi-folha-rosto/analyze-finalize', {
          method: 'POST',
          signal: controller.signal,
          headers: jsonHeaders,
          body: JSON.stringify({
            uploadSessionId: sessionId,
            pageCount,
            unitFallbackId: unitFallbackId || undefined,
            forceForm: forceFormMode,
            columnMappingsOverride: Object.keys(overrides).length > 0 ? overrides : undefined,
          }),
        });
        payload = await parseJsonResponse<IviFolhaRostoAnalyzeResult>(
          finRes,
          'Falha ao consolidar lotes do PDF na Ivi.'
        );
      } else if (isPdf && existingSessionId) {
        // Revalidação rápida de PDF já extraído em .parsed.json
        setIviBatchProgress({
          phase: 'finalizing',
          pct: 60,
          processedUnits: 1,
          totalUnits: 1,
          processedRows: 0,
          totalRows: 0,
          markedReadChunks: 1,
          currentLabel: file.name,
          phaseLabel: 'Revalidando mapeamentos ajustados sobre fichas já extraídas do PDF...',
          extractedRecords: 0,
        });
        const res = await fetchWithTransientRetry('/api/data-hub/ivi-folha-rosto/analyze', {
          method: 'POST',
          signal: controller.signal,
          headers: jsonHeaders,
          body: JSON.stringify({
            uploadSessionId: sessionId,
            unitFallbackId: unitFallbackId || undefined,
            forceForm: forceFormMode,
            columnMappingsOverride: Object.keys(overrides).length > 0 ? overrides : undefined,
          }),
        });
        payload = await parseJsonResponse<IviFolhaRostoAnalyzeResult>(
          res,
          'Falha na revalidação da Ivi sobre o PDF.'
        );
      } else {
        // Planilhas (.xlsx / .xlsm / .xls / .xlsb / .csv): preparação em streaming + análise em lotes com marcação de leitura
        let totalChunks = iviPreparedInfoRef.current?.totalChunks || 0;
        let totalRows = iviPreparedInfoRef.current?.totalRows || 0;
        const isRevalidation = Boolean(existingSessionId && totalChunks > 0);

        if (!isRevalidation) {
          setIviBatchProgress({
            phase: 'preparing',
            pct: 5,
            processedUnits: 0,
            totalUnits: 1,
            processedRows: 0,
            totalRows: 0,
            markedReadChunks: 0,
            currentLabel: file.name,
            phaseLabel: 'Ivi lendo planilha em streaming, fatiando em blocos de 250 linhas e mapeando colunas...',
            extractedRecords: 0,
          });
          const prepRes = await fetchWithTransientRetry('/api/data-hub/ivi-folha-rosto/prepare', {
            method: 'POST',
            signal: controller.signal,
            headers: jsonHeaders,
            body: JSON.stringify({
              uploadSessionId: sessionId,
              columnMappingsOverride: Object.keys(overrides).length > 0 ? overrides : undefined,
            }),
          });
          const prepInfo = await parseJsonResponse<{
            totalChunks: number;
            totalRows: number;
          }>(prepRes, 'Falha ao preparar streaming da planilha para a Ivi.');
          totalChunks = prepInfo.totalChunks;
          totalRows = prepInfo.totalRows;
          iviPreparedInfoRef.current = { totalChunks, totalRows, isPdf: false };
        }

        const batchStep = 2;
        for (let startChunk = 0; startChunk < totalChunks; startChunk += batchStep) {
          if (controller.signal.aborted) {
            throw new DOMException('Análise da Ivi cancelada pelo usuário.', 'AbortError');
          }
          const batchRes = await fetchWithTransientRetry('/api/data-hub/ivi-folha-rosto/analyze-batch', {
            method: 'POST',
            signal: controller.signal,
            headers: jsonHeaders,
            body: JSON.stringify({
              uploadSessionId: sessionId,
              startChunk,
              batchCount: batchStep,
              reset: isRevalidation && startChunk === 0,
              forceForm: forceFormMode,
              columnMappingsOverride: Object.keys(overrides).length > 0 ? overrides : undefined,
            }),
          });
          const batch = await parseJsonResponse<{
            processedChunks: number;
            totalChunks: number;
            markedReadChunks: number;
            processedRows: number;
            totalRows: number;
            currentSheetName: string;
            veiculoRows: number;
            cartaoRows: number;
            estimatedOperations: IviFolhaRostoAnalyzeResult['estimatedOperations'];
          }>(batchRes, 'Falha ao processar lote de análise comparativa na Ivi.');

          const pct = batch.totalChunks > 0 ? Math.min(99, Math.round((batch.processedChunks / batch.totalChunks) * 100)) : 99;
          const est = batch.estimatedOperations;
          setIviBatchProgress({
            phase: 'analyzing',
            pct,
            processedUnits: batch.processedChunks,
            totalUnits: batch.totalChunks,
            processedRows: batch.processedRows,
            totalRows: batch.totalRows,
            markedReadChunks: batch.markedReadChunks,
            currentLabel: batch.currentSheetName || file.name,
            phaseLabel: `Analisando lote ${batch.processedChunks}/${batch.totalChunks} · Aba "${batch.currentSheetName}"`,
            extractedRecords: batch.processedRows,
            liveTotals: {
              clients: est.clientsInsert + est.clientsUpdate,
              titulares: est.titularesInsert + est.titularesUpdate,
              banks: est.banksInsert + est.banksMatched,
              collaborators: est.collaboratorsInsert + est.collaboratorsMatched,
              admissions: est.admissionsInsert + est.admissionsUpdate,
              errors: est.errors,
            },
          });
        }

        setIviBatchProgress((prev) =>
          prev
            ? {
                ...prev,
                phase: 'finalizing',
                pct: 100,
                phaseLabel: 'Consolidando prévia comparativa da Ivi...',
              }
            : prev
        );

        const finRes = await fetchWithTransientRetry('/api/data-hub/ivi-folha-rosto/analyze-finalize', {
          method: 'POST',
          signal: controller.signal,
          headers: jsonHeaders,
          body: JSON.stringify({
            uploadSessionId: sessionId,
            unitFallbackId: unitFallbackId || undefined,
            forceForm: forceFormMode,
            columnMappingsOverride: Object.keys(overrides).length > 0 ? overrides : undefined,
          }),
        });
        payload = await parseJsonResponse<IviFolhaRostoAnalyzeResult>(
          finRes,
          'Falha ao consolidar análise da Ivi.'
        );
      }

      setIviAnalysis(payload);
      const nextOverrides: Record<string, string> = {};
      for (const m of payload.mappings) {
        nextOverrides[`${m.sheetName}::${m.sourceColumn}`] = m.mappedVariableKey;
      }
      setMappingOverrides(nextOverrides);
      onToast(
        `Ivi analisou ${payload.detectedFormSummary.totalRows} ficha(s)/linha(s) comparando com Folha de Rosto (${
          payload.detectedFormSummary.veiculoRows
        } Veículo · ${payload.detectedFormSummary.cartaoRows} Cartão).`
      );
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') {
        setIviError('Análise interrompida pelo usuário.');
      } else {
        setIviError(err instanceof Error ? err.message : 'Erro na leitura do PDF/arquivo pela Ivi.');
      }
    } finally {
      setIviBusy(false);
      setIviBatchProgress(null);
      iviAbortRef.current = null;
    }
  };

  const handleIviFileChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (iviUploadSessionId) {
      await releaseUploadSession(iviUploadSessionId);
      setIviUploadSessionId(null);
    }
    setIviSelectedFile(file);
    setIviAnalysis(null);
    setIviCommitResult(null);
    setMappingOverrides({});
    await runIviAnalyze(file, null, {}, iviForceForm);
  };

  const handleIviCommit = async () => {
    if (!iviSelectedFile || !iviUploadSessionId) return;
    iviAbortRef.current?.abort();
    const controller = new AbortController();
    iviAbortRef.current = controller;

    setIviBusy(true);
    setIviError('');
    try {
      const token = getAuthToken();
      const jsonHeaders: Record<string, string> = {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        'x-unit-id': String(getActiveUnitHeader()),
        'Content-Type': 'application/json',
      };

      setIviBatchProgress({
        phase: 'preparing',
        pct: 5,
        processedUnits: 0,
        totalUnits: 1,
        processedRows: 0,
        totalRows: iviAnalysis?.detectedFormSummary.totalRows || 0,
        markedReadChunks: 0,
        currentLabel: iviSelectedFile.name,
        phaseLabel: 'Preparando cadastros e transações em lotes de 250 linhas no PostgreSQL...',
        extractedRecords: 0,
      });

      const prepRes = await fetchWithTransientRetry('/api/data-hub/ivi-folha-rosto/commit-prepare', {
        method: 'POST',
        signal: controller.signal,
        headers: jsonHeaders,
        body: JSON.stringify({
          uploadSessionId: iviUploadSessionId,
          unitFallbackId: unitFallbackId || undefined,
          columnMappingsOverride: mappingOverrides,
        }),
      });
      const prep = await parseJsonResponse<{
        totalChunks: number;
        totalRows: number;
      }>(prepRes, 'Falha ao preparar gravação em lotes no PostgreSQL.');

      for (let startChunk = 0; startChunk < prep.totalChunks; startChunk += 1) {
        if (controller.signal.aborted) {
          throw new DOMException('Gravação da Ivi cancelada pelo usuário.', 'AbortError');
        }
        const batchRes = await fetchWithTransientRetry('/api/data-hub/ivi-folha-rosto/commit-batch', {
          method: 'POST',
          signal: controller.signal,
          headers: jsonHeaders,
          body: JSON.stringify({
            uploadSessionId: iviUploadSessionId,
            startChunk,
            batchCount: 1,
            unitFallbackId: unitFallbackId || undefined,
            forceForm: iviForceForm,
            columnMappingsOverride: mappingOverrides,
          }),
        });
        const batch = await parseJsonResponse<{
          processedChunks: number;
          totalChunks: number;
          markedReadChunks: number;
          processedRows: number;
          totalRows: number;
          currentSheetName: string;
          cumulativeTotals: IviFolhaRostoCommitResult['totals'];
        }>(batchRes, 'Falha ao gravar lote no banco de dados.');

        const pct = batch.totalChunks > 0 ? Math.min(99, Math.round((batch.processedChunks / batch.totalChunks) * 100)) : 99;
        const ct = batch.cumulativeTotals;
        setIviBatchProgress({
          phase: 'committing',
          pct,
          processedUnits: batch.processedChunks,
          totalUnits: batch.totalChunks,
          processedRows: batch.processedRows,
          totalRows: batch.totalRows,
          markedReadChunks: batch.markedReadChunks,
          currentLabel: batch.currentSheetName || iviSelectedFile.name,
          phaseLabel: `Gravando lote ${batch.processedChunks}/${batch.totalChunks} no PostgreSQL · Aba "${batch.currentSheetName}"`,
          extractedRecords: batch.processedRows,
          liveTotals: {
            clients: ct.clientsCreated + ct.clientsUpdated,
            titulares: ct.titularesCreated + ct.titularesUpdated,
            banks: ct.banksCreated + ct.banksLinked,
            collaborators: ct.collaboratorsCreated + ct.collaboratorsLinked,
            admissions: ct.admissionsCreated + ct.admissionsUpdated,
            errors: ct.errors,
          },
        });
      }

      setIviBatchProgress((prev) =>
        prev
          ? {
              ...prev,
              phase: 'finalizing',
              pct: 100,
              phaseLabel: 'Registrando trilha auditável e gerando planilha de retorno (.xlsx)...',
            }
          : prev
      );

      const finRes = await fetchWithTransientRetry('/api/data-hub/ivi-folha-rosto/commit-finalize', {
        method: 'POST',
        signal: controller.signal,
        headers: jsonHeaders,
        body: JSON.stringify({
          uploadSessionId: iviUploadSessionId,
          unitFallbackId: unitFallbackId || undefined,
        }),
      });
      const payload = await parseJsonResponse<IviFolhaRostoCommitResult>(
        finRes,
        'Erro ao finalizar cadastros da Ivi no PostgreSQL.'
      );
      setIviCommitResult(payload);
      setIviAnalysis(null);
      setIviUploadSessionId(null);
      iviPreparedInfoRef.current = null;
      if (payload.returnWorkbookBase64 && payload.returnFileName) {
        downloadBase64Xlsx(payload.returnWorkbookBase64, payload.returnFileName);
      }
      onToast(
        `Ivi concluiu: ${payload.totals.clientsCreated + payload.totals.clientsUpdated} Cliente(s), ${
          payload.totals.titularesCreated + payload.totals.titularesUpdated
        } Titular(es), ${payload.totals.banksCreated} Banco(s) novo(s), ${
          payload.totals.collaboratorsCreated
        } Colaborador(es) novo(s) e ${
          payload.totals.admissionsCreated + payload.totals.admissionsUpdated
        } Admissão(ões).`
      );
      onDataImported?.();
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') {
        setIviError('Gravação cancelada pelo usuário. Os lotes já confirmados permanecem salvos.');
      } else {
        setIviError(err instanceof Error ? err.message : 'Erro ao gravar cadastros da Ivi.');
      }
    } finally {
      setIviBusy(false);
      setIviBatchProgress(null);
      iviAbortRef.current = null;
    }
  };

  const closeIviPanel = async () => {
    iviAbortRef.current?.abort();
    if (iviUploadSessionId) {
      await releaseUploadSession(iviUploadSessionId);
    }
    setIviSelectedFile(null);
    setIviUploadSessionId(null);
    iviPreparedInfoRef.current = null;
    setIviAnalysis(null);
    setIviCommitResult(null);
    setIviBatchProgress(null);
    setIviError('');
    setMappingOverrides({});
  };

  const activeResult = commitResult || dryRunResult;
  const visibleRows = useMemo(() => {
    if (!activeResult) return [];
    if (actionFilter === 'ALL') return activeResult.rowResults;
    return activeResult.rowResults.filter((r) => r.action === actionFilter);
  }, [activeResult, actionFilter]);

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
        Carregando catálogo relacional de planilhas e matriz de precedência (Camadas 0 → 4)...
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-xs text-red-800 flex items-center justify-between gap-3 dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300">
        <span>{loadError}</span>
        <button
          type="button"
          onClick={loadRegistry}
          className="rounded-lg border border-red-300 bg-white px-3 py-1.5 font-semibold text-red-800 hover:bg-red-100 dark:border-red-800/70 dark:bg-slate-900 dark:text-red-300 dark:hover:bg-red-900/60"
        >
          Tentar novamente
        </button>
      </div>
    );
  }

  const activeFormSnapshot =
    activeFormTab === 'veiculo'
      ? folhaForms?.forms.veiculo
      : activeFormTab === 'cartao'
      ? folhaForms?.forms.cartao
      : undefined;

  return (
    <div className="space-y-4 text-xs">
      {/* Hidden shared file pickers */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls,.xlsm,.xlsb,.csv"
        onChange={handleFileChosen}
        className="hidden"
      />
      <input
        ref={iviFileInputRef}
        type="file"
        accept=".pdf,.xlsx,.xls,.xlsm,.xlsb,.csv"
        onChange={handleIviFileChosen}
        className="hidden"
      />

      {/* =================================================================== */}
      {/* LEITURA INTELIGENTE IVI (ATÉ 500 MB) · FOLHA DE ROSTO VEÍCULO / CARTÃO */}
      {/* =================================================================== */}
      <div
        id="ivi-folha-rosto-500mb-card"
        className="rounded-xl border-2 border-emerald-300 bg-white p-4 space-y-4 shadow-xs dark:border-emerald-700/80 dark:bg-slate-900"
      >
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-slate-100 pb-3.5 dark:border-slate-800">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 border border-emerald-200 px-2 py-0.5 font-semibold text-emerald-800 dark:bg-emerald-950/60 dark:border-emerald-800/70 dark:text-emerald-300">
                <Sparkles className="w-3.5 h-3.5" />
                Ivi Leitura Comparativa · PDF &amp; Planilhas até 500 MB
              </span>
              <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                Importação Inteligente via Formulários Folha de Rosto (Veículo &amp; Cartão de Crédito)
              </h2>
            </div>
            <p className="text-slate-600 leading-relaxed dark:text-slate-300">
              A Ivi lê arquivos <strong>PDF (.pdf)</strong> de até <strong>500 MB</strong> (texto digital ou páginas digitalizadas/escaneadas em partes seguras, além de .xlsx/.csv), compara automaticamente cada campo com as variáveis <span className="font-mono text-[11px]">{'{{...}}'}</span> dos formulários <strong>Folha de Rosto - Veículo</strong> e <strong>Folha de Rosto - Cartão de Crédito</strong>, e cadastra em transação única: <strong>Clientes e Titulares</strong>, <strong>Bancos</strong>, <strong>Colaboradores</strong> e <strong>Admissão</strong>.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <select
              value={iviForceForm}
              onChange={(e) => setIviForceForm(e.target.value as 'auto' | 'veiculo' | 'cartao')}
              aria-label="Modo de comparação dos formulários Folha de Rosto"
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 font-semibold text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              <option value="auto">Comparar Automático (Veículo / Cartão)</option>
              <option value="veiculo">Forçar Folha de Rosto - Veículo</option>
              <option value="cartao">Forçar Folha de Rosto - Cartão de Crédito</option>
            </select>

            <button
              type="button"
              onClick={() => setShowFormsInspector((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <Eye className="w-3.5 h-3.5" />
              {showFormsInspector ? 'Ocultar Variáveis Folha de Rosto' : 'Ver Variáveis Folha de Rosto'}
            </button>
          </div>
        </div>

        {/* Caixa de Destaque + Botão Principal Ivi 500 MB (Clique ou Arraste o Arquivo) */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
          }}
          onDrop={async (e) => {
            e.preventDefault();
            if (iviBusy) return;
            const dropped = e.dataTransfer.files?.[0];
            if (!dropped) return;
            if (iviUploadSessionId) {
              await releaseUploadSession(iviUploadSessionId);
              setIviUploadSessionId(null);
            }
            setIviSelectedFile(dropped);
            setIviAnalysis(null);
            setIviCommitResult(null);
            setMappingOverrides({});
            await runIviAnalyze(dropped, null, {}, iviForceForm);
          }}
          className="rounded-xl border border-dashed border-emerald-400 bg-emerald-50/60 p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 dark:border-emerald-700 dark:bg-emerald-950/30"
        >
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-emerald-700 text-white flex items-center justify-center shrink-0">
              <Sparkles className="w-5 h-5" />
            </div>
            <div className="space-y-1">
              <div className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                Botão Ivi · Ler PDF de Folhas de Rosto (até 500 MB)
              </div>
              <div className="text-slate-600 dark:text-slate-300">
                Clique no botão ao lado ou arraste seu <strong>PDF de Folhas de Rosto</strong> (.pdf até <strong>500 MB</strong>, também aceita .xlsx/.csv). A Ivi extrai os campos, compara com as variáveis de <strong>Veículo</strong> e <strong>Cartão de Crédito</strong> e prepara os cadastros.
              </div>
            </div>
          </div>

          <button
            type="button"
            disabled={iviBusy}
            onClick={() => {
              if (iviFileInputRef.current) {
                iviFileInputRef.current.value = '';
                iviFileInputRef.current.click();
              }
            }}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-700 px-5 py-3 text-sm font-bold text-white hover:bg-emerald-800 disabled:opacity-50 shadow-sm whitespace-nowrap shrink-0"
          >
            <Upload className="w-4 h-4" />
            {iviBusy ? 'Lendo PDF / Arquivo...' : 'Importar PDF 500 MB · Ivi (Folhas de Rosto)'}
          </button>
        </div>

        {/* Visualizador ao vivo das variáveis de Folha de Rosto - Veículo e Cartão de Crédito */}
        {folhaForms && (
          <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 space-y-3 dark:border-slate-700 dark:bg-slate-800/50">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                <span className="font-semibold text-slate-700 dark:text-slate-200">Formulários de Referência Carregados:</span>
                <span className="rounded border border-slate-200 bg-white px-2 py-0.5 font-mono text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                  {folhaForms.forms.veiculo.name} ({folhaForms.forms.veiculo.variableCount} variáveis)
                </span>
                <span className="rounded border border-slate-200 bg-white px-2 py-0.5 font-mono text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                  {folhaForms.forms.cartao.name} ({folhaForms.forms.cartao.variableCount} variáveis)
                </span>
              </div>
              <button
                type="button"
                onClick={() => setShowFormsInspector((v) => !v)}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 hover:underline dark:text-emerald-300"
              >
                {showFormsInspector ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                {showFormsInspector ? 'Recolher inspetor de variáveis' : 'Inspecionar todas as variáveis e layout'}
              </button>
            </div>

            {showFormsInspector && (
              <div className="space-y-3 pt-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-900">
                    <button
                      type="button"
                      onClick={() => setActiveFormTab('veiculo')}
                      className={`rounded-md px-3 py-1 font-semibold ${
                        activeFormTab === 'veiculo'
                          ? 'bg-slate-900 text-white dark:bg-emerald-600'
                          : 'text-slate-600 hover:text-slate-900 dark:text-slate-300'
                      }`}
                    >
                      Folha de Rosto - Veículo ({folhaForms.forms.veiculo.variableCount})
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveFormTab('cartao')}
                      className={`rounded-md px-3 py-1 font-semibold ${
                        activeFormTab === 'cartao'
                          ? 'bg-slate-900 text-white dark:bg-emerald-600'
                          : 'text-slate-600 hover:text-slate-900 dark:text-slate-300'
                      }`}
                    >
                      Folha de Rosto - Cartão de Crédito ({folhaForms.forms.cartao.variableCount})
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveFormTab('targets')}
                      className={`rounded-md px-3 py-1 font-semibold ${
                        activeFormTab === 'targets'
                          ? 'bg-slate-900 text-white dark:bg-emerald-600'
                          : 'text-slate-600 hover:text-slate-900 dark:text-slate-300'
                      }`}
                    >
                      Destinos Gravados no Banco ({folhaForms.entityTargets.length})
                    </button>
                  </div>

                  {activeFormSnapshot && (
                    <button
                      type="button"
                      onClick={() => setShowFormHtmlPreview((v) => !v)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      {showFormHtmlPreview ? 'Ocultar Prévia do Documento' : 'Visualizar Documento Original'}
                    </button>
                  )}
                </div>

                {activeFormTab === 'targets' ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2.5">
                    {folhaForms.entityTargets.map((t) => (
                      <div
                        key={t.group}
                        className="rounded-lg border border-slate-200 bg-white p-3 space-y-1 dark:border-slate-700 dark:bg-slate-900"
                      >
                        <div className="font-semibold text-slate-900 dark:text-slate-100">{t.label}</div>
                        <div className="font-mono text-[10px] text-emerald-700 dark:text-emerald-300">{t.tableName}</div>
                        <p className="text-[11px] text-slate-600 dark:text-slate-300">{t.description}</p>
                      </div>
                    ))}
                  </div>
                ) : activeFormSnapshot ? (
                  <div className="space-y-3">
                    {showFormHtmlPreview && (
                      <iframe
                        srcDoc={activeFormSnapshot.previewHtml}
                        sandbox=""
                        title={activeFormSnapshot.name}
                        className="w-full h-80 rounded-lg border border-slate-200 bg-white dark:border-slate-700"
                      />
                    )}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                      {folhaForms.variables
                        .filter((v) =>
                          activeFormTab === 'veiculo' ? v.inVeiculoForm : v.inCartaoForm
                        )
                        .map((v) => (
                          <div
                            key={v.key}
                            className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 flex items-start justify-between gap-2 dark:border-slate-700 dark:bg-slate-900"
                          >
                            <div className="min-w-0">
                              <div className="font-mono font-bold text-slate-900 truncate dark:text-slate-100">
                                {v.token}
                              </div>
                              <div className="text-[11px] text-slate-600 truncate dark:text-slate-300">
                                {v.label}
                              </div>
                            </div>
                            <span
                              className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] ${
                                v.exclusiveToVeiculo
                                  ? 'bg-amber-50 text-amber-800 border border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800/70'
                                  : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                              }`}
                            >
                              {v.exclusiveToVeiculo ? 'Exclusiva Veículo' : v.targetGroup}
                            </span>
                          </div>
                        ))}
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        )}

        {/* Progresso em Lotes Seguros com Marcação de Leitura (PDFs & Planilhas até 500 MB) */}
        {iviBusy && (
          <div className="rounded-lg border border-emerald-300 bg-emerald-50/70 p-3.5 space-y-2.5 dark:border-emerald-800/70 dark:bg-emerald-950/40">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-semibold text-emerald-950 dark:text-emerald-200">
                {iviBatchProgress
                  ? iviBatchProgress.phaseLabel
                  : 'Ivi processando dados comparativos da Folha de Rosto...'}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {iviBatchProgress && (
                  <span className="font-mono text-[11px] font-bold text-emerald-900 tabular-nums dark:text-emerald-200">
                    {iviBatchProgress.pct}%
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => iviAbortRef.current?.abort()}
                  className="rounded border border-red-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-red-700 hover:bg-red-50 dark:border-red-800 dark:bg-slate-900 dark:text-red-300"
                >
                  Cancelar
                </button>
              </div>
            </div>

            <progress
              value={iviBatchProgress?.pct ?? 0}
              max={100}
              className="w-full h-2.5 accent-emerald-600 rounded-full overflow-hidden"
            />

            {iviBatchProgress && (
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-slate-700 dark:text-slate-300 tabular-nums">
                <div className="flex flex-wrap items-center gap-3">
                  {iviBatchProgress.totalRows > 0 && (
                    <span>
                      Linhas/Páginas: <strong>{iviBatchProgress.processedRows}</strong> / {iviBatchProgress.totalRows}
                    </span>
                  )}
                  {iviBatchProgress.totalUnits > 0 && iviBatchProgress.phase !== 'uploading' && (
                    <span>
                      Marcação de Leitura: <strong>{iviBatchProgress.markedReadChunks}</strong> lote(s) concluído(s)
                    </span>
                  )}
                  {iviBatchProgress.currentLabel && (
                    <span>
                      Atual: <strong>{iviBatchProgress.currentLabel}</strong>
                    </span>
                  )}
                </div>
                {iviBatchProgress.liveTotals && (
                  <div className="flex flex-wrap items-center gap-2 text-[10px]">
                    <span>Clientes: {iviBatchProgress.liveTotals.clients}</span>
                    <span>· Bancos: {iviBatchProgress.liveTotals.banks}</span>
                    <span>· Admissões: {iviBatchProgress.liveTotals.admissions}</span>
                    {iviBatchProgress.liveTotals.errors > 0 && (
                      <span className="text-red-700 font-bold dark:text-red-300">
                        · Erros: {iviBatchProgress.liveTotals.errors}
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {iviError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-red-800 flex items-center justify-between gap-2 dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{iviError}</span>
            </div>
            <button
              type="button"
              onClick={closeIviPanel}
              className="rounded border border-red-300 px-2 py-1 font-semibold hover:bg-red-100"
            >
              Limpar
            </button>
          </div>
        )}

        {/* RESULTADO DA ANÁLISE COMPARATIVA DA IVI */}
        {iviAnalysis && (
          <div className="space-y-4 border-t border-slate-200 pt-4 dark:border-slate-700">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                    Diagnóstico da Ivi · {iviAnalysis.fileName} ({formatBytes(iviAnalysis.fileSizeBytes)})
                  </span>
                  <span className="rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-mono text-[11px] font-semibold text-emerald-800 dark:border-emerald-800/70 dark:bg-emerald-950/60 dark:text-emerald-300">
                    {iviAnalysis.detectedFormSummary.dominantForm === 'misto'
                      ? `Misto: ${iviAnalysis.detectedFormSummary.veiculoRows} Veículo · ${iviAnalysis.detectedFormSummary.cartaoRows} Cartão`
                      : iviAnalysis.detectedFormSummary.dominantForm === 'veiculo'
                      ? `Folha de Rosto - Veículo (${iviAnalysis.detectedFormSummary.veiculoRows} ficha(s))`
                      : `Folha de Rosto - Cartão de Crédito (${iviAnalysis.detectedFormSummary.cartaoRows} ficha(s))`}
                  </span>
                  {iviAnalysis.pdfMetadata && (
                    <span className="rounded border border-slate-200 bg-slate-100 px-2 py-0.5 font-mono text-[10px] font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
                      PDF · {iviAnalysis.pdfMetadata.pageCount} pág(s) · {iviAnalysis.pdfMetadata.digitalPages} texto / {iviAnalysis.pdfMetadata.ocrPages} OCR
                    </span>
                  )}
                  {iviAnalysis.usedGemini && (
                    <span className="rounded border border-blue-200 bg-blue-50 px-2 py-0.5 font-mono text-[10px] font-semibold text-blue-800 dark:border-blue-800/70 dark:bg-blue-950/60 dark:text-blue-300">
                      Extração Assistida Gemini
                    </span>
                  )}
                </div>
                <p className="text-slate-600 dark:text-slate-300">{iviAnalysis.iviDiagnosticText}</p>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  disabled={iviBusy || !iviSelectedFile}
                  onClick={() =>
                    iviSelectedFile &&
                    runIviAnalyze(iviSelectedFile, iviUploadSessionId, mappingOverrides, iviForceForm)
                  }
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Revalidar com Ajustes
                </button>
                <button
                  type="button"
                  disabled={iviBusy || iviAnalysis.detectedFormSummary.totalRows === 0}
                  onClick={handleIviCommit}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-4 py-1.5 font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Confirmar Cadastros &amp; Admissão ({iviAnalysis.detectedFormSummary.totalRows} linha(s))
                </button>
                <button
                  type="button"
                  onClick={closeIviPanel}
                  aria-label="Fechar análise da Ivi"
                  className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Cards com os 5 cadastros impactados */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/70">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                  <Users className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-300" />
                  Clientes
                </div>
                <div className="mt-1 font-mono text-base font-bold text-slate-900 tabular-nums dark:text-slate-100">
                  +{iviAnalysis.estimatedOperations.clientsInsert} novos · {iviAnalysis.estimatedOperations.clientsUpdate} atualiz.
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/70">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                  <UserCheck className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-300" />
                  Titulares &amp; Vínculos
                </div>
                <div className="mt-1 font-mono text-base font-bold text-slate-900 tabular-nums dark:text-slate-100">
                  +{iviAnalysis.estimatedOperations.titularesInsert} novos · {iviAnalysis.estimatedOperations.assetLinksInsert} vínculos
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/70">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                  <Landmark className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-300" />
                  Bancos
                </div>
                <div className="mt-1 font-mono text-base font-bold text-slate-900 tabular-nums dark:text-slate-100">
                  +{iviAnalysis.estimatedOperations.banksInsert} novos · {iviAnalysis.estimatedOperations.banksMatched} existentes
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/70">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                  <Building2 className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-300" />
                  Colaboradores
                </div>
                <div className="mt-1 font-mono text-base font-bold text-slate-900 tabular-nums dark:text-slate-100">
                  +{iviAnalysis.estimatedOperations.collaboratorsInsert} novos · {iviAnalysis.estimatedOperations.collaboratorsMatched} existentes
                </div>
              </div>
              <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-3 dark:border-emerald-800/70 dark:bg-emerald-950/50">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-800 dark:text-emerald-300">
                  <ClipboardCheck className="w-3.5 h-3.5" />
                  Admissões
                </div>
                <div className="mt-1 font-mono text-base font-bold text-emerald-900 tabular-nums dark:text-emerald-200">
                  +{iviAnalysis.estimatedOperations.admissionsInsert} novas · {iviAnalysis.estimatedOperations.admissionsUpdate} atualiz.
                </div>
              </div>
            </div>

            {/* Tabela editável de mapeamento Coluna <-> Variável Folha de Rosto */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-800 dark:text-slate-100">
                  Comparativo Coluna da Planilha ↔ Variável Folha de Rosto ({iviAnalysis.mappings.length} colunas)
                </span>
                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                  Ajuste qualquer associação e clique em Revalidar com Ajustes se necessário
                </span>
              </div>
              <div className="overflow-x-auto max-h-72 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700">
                <table className="w-full min-w-[820px] text-left text-xs">
                  <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-300">
                    <tr>
                      <th className="px-3 py-2">Aba / Coluna na Planilha</th>
                      <th className="px-3 py-2">Amostras Lidas</th>
                      <th className="px-3 py-2">Variável Folha de Rosto (Editável)</th>
                      <th className="px-3 py-2">Cadastro Destino</th>
                      <th className="px-3 py-2">Análise Ivi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {iviAnalysis.mappings.map((m) => {
                      const mapKey = `${m.sheetName}::${m.sourceColumn}`;
                      const currentVar = mappingOverrides[mapKey] ?? m.mappedVariableKey;
                      const varDef = iviAnalysis.availableVariables.find((v) => v.key === currentVar);
                      return (
                        <tr key={mapKey} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/50">
                          <td className="px-3 py-2">
                            <div className="font-semibold text-slate-900 dark:text-slate-100">{m.sourceColumn}</div>
                            <div className="font-mono text-[10px] text-slate-500 dark:text-slate-400">Aba: {m.sheetName}</div>
                          </td>
                          <td className="px-3 py-2 font-mono text-[11px] text-slate-600 max-w-xs truncate dark:text-slate-300">
                            {m.sampleValues.join(' · ') || '—'}
                          </td>
                          <td className="px-3 py-2">
                            <select
                              value={currentVar}
                              onChange={(e) =>
                                setMappingOverrides((prev) => ({
                                  ...prev,
                                  [mapKey]: e.target.value,
                                }))
                              }
                              aria-label={`Variável para coluna ${m.sourceColumn}`}
                              className="w-full max-w-xs rounded-md border border-slate-200 bg-white px-2 py-1 font-mono text-[11px] text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                            >
                              <option value="">— Ignorar coluna —</option>
                              {iviAnalysis.availableVariables.map((v) => (
                                <option key={v.key} value={v.key}>
                                  {v.token} · {v.label}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-3 py-2 text-[11px] text-slate-700 dark:text-slate-200">
                            {varDef ? TARGET_GROUP_LABELS[varDef.targetGroup] || varDef.targetGroup : 'Não importada'}
                          </td>
                          <td className="px-3 py-2 text-[11px]">
                            <span
                              className={`inline-block rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold mr-1.5 ${
                                m.confidence === 'alta'
                                  ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                                  : m.confidence === 'ia_gemini'
                                  ? 'bg-blue-50 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300'
                                  : m.confidence === 'media'
                                  ? 'bg-amber-50 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                                  : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                              }`}
                            >
                              {m.confidence}
                            </span>
                            <span className="text-slate-600 dark:text-slate-300">{m.reason}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Prévia das linhas extraídas */}
            {iviAnalysis.previews.length > 0 && (
              <div className="space-y-2">
                <div className="font-semibold text-slate-800 dark:text-slate-100">
                  Prévia dos Registros a Cadastrar (primeiras {iviAnalysis.previews.length} linha(s))
                </div>
                <div className="overflow-x-auto max-h-64 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700">
                  <table className="w-full min-w-[860px] text-left text-xs">
                    <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-300">
                      <tr>
                        <th className="px-3 py-2">Linha</th>
                        <th className="px-3 py-2">Formulário</th>
                        <th className="px-3 py-2">Cliente</th>
                        <th className="px-3 py-2">Titular</th>
                        <th className="px-3 py-2">Banco</th>
                        <th className="px-3 py-2">Colaborador</th>
                        <th className="px-3 py-2">Contrato / Bem</th>
                        <th className="px-3 py-2">Ações Previstas</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {iviAnalysis.previews.map((p, idx) => (
                        <tr key={`${p.sheetName}-${p.rowNumber}-${idx}`} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/50">
                          <td className="px-3 py-2 font-mono whitespace-nowrap text-slate-500 dark:text-slate-400">
                            {p.sheetName} #{p.rowNumber}
                          </td>
                          <td className="px-3 py-2 font-semibold whitespace-nowrap">
                            <span
                              className={`rounded px-1.5 py-0.5 text-[10px] ${
                                p.detectedForm === 'veiculo'
                                  ? 'bg-amber-50 text-amber-800 border border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800/70'
                                  : 'bg-blue-50 text-blue-800 border border-blue-200 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800/70'
                              }`}
                            >
                              {p.detectedForm === 'veiculo' ? 'Veículo' : 'Cartão de Crédito'}
                            </span>
                          </td>
                          <td className="px-3 py-2">
                            <div className="font-semibold text-slate-900 dark:text-slate-100">{p.clientName || '—'}</div>
                            <div className="font-mono text-[10px] text-slate-500">{p.clientCpf || ''}</div>
                          </td>
                          <td className="px-3 py-2">
                            <div className="font-medium text-slate-800 dark:text-slate-200">{p.titularName || '—'}</div>
                            <div className="font-mono text-[10px] text-slate-500">{p.titularCpf || ''}</div>
                          </td>
                          <td className="px-3 py-2 text-slate-700 dark:text-slate-200">{p.bankName || '—'}</td>
                          <td className="px-3 py-2 text-slate-700 dark:text-slate-200">{p.collaboratorName || '—'}</td>
                          <td className="px-3 py-2">
                            <div className="font-mono text-slate-800 dark:text-slate-200">{p.contractNumber || 'Auto'}</div>
                            {p.vehicleSummary && (
                              <div className="text-[10px] text-slate-500 dark:text-slate-400">{p.vehicleSummary}</div>
                            )}
                          </td>
                          <td className="px-3 py-2 text-[11px] text-slate-600 dark:text-slate-300">
                            <div>{p.actions.join(' · ')}</div>
                            {p.warnings.length > 0 && (
                              <div className="text-amber-700 dark:text-amber-300">{p.warnings.join('; ')}</div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* RESULTADO EFETIVADO NO POSTGRESQL PELA IVI */}
        {iviCommitResult && (
          <div className="space-y-3 border-t border-emerald-200 pt-4 dark:border-emerald-800/70">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 font-display text-sm font-bold text-emerald-800 dark:text-emerald-300">
                <CheckCircle2 className="w-4 h-4" />
                Cadastros &amp; Admissões Gravados com Sucesso pela Ivi ({iviCommitResult.totals.totalRows} linha(s))
              </div>
              <div className="flex items-center gap-2">
                {iviCommitResult.returnWorkbookBase64 && (
                  <button
                    type="button"
                    onClick={() =>
                      downloadBase64Xlsx(iviCommitResult.returnWorkbookBase64, iviCommitResult.returnFileName)
                    }
                    className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 font-semibold text-emerald-800 hover:bg-emerald-100 dark:border-emerald-800/70 dark:bg-emerald-950/60 dark:text-emerald-300"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Baixar Retorno (.xlsx)
                  </button>
                )}
                <button
                  type="button"
                  onClick={closeIviPanel}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300"
                >
                  Fechar
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 dark:border-slate-700 dark:bg-slate-800/70">
                <div className="text-[11px] text-slate-500">Clientes</div>
                <div className="font-mono font-bold text-slate-900 dark:text-slate-100">
                  +{iviCommitResult.totals.clientsCreated} / {iviCommitResult.totals.clientsUpdated} atualiz.
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 dark:border-slate-700 dark:bg-slate-800/70">
                <div className="text-[11px] text-slate-500">Titulares &amp; Vínculos</div>
                <div className="font-mono font-bold text-slate-900 dark:text-slate-100">
                  +{iviCommitResult.totals.titularesCreated} · {iviCommitResult.totals.assetLinksCreated} vínc.
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 dark:border-slate-700 dark:bg-slate-800/70">
                <div className="text-[11px] text-slate-500">Bancos</div>
                <div className="font-mono font-bold text-slate-900 dark:text-slate-100">
                  +{iviCommitResult.totals.banksCreated} novos · {iviCommitResult.totals.banksLinked} vinc.
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 dark:border-slate-700 dark:bg-slate-800/70">
                <div className="text-[11px] text-slate-500">Colaboradores</div>
                <div className="font-mono font-bold text-slate-900 dark:text-slate-100">
                  +{iviCommitResult.totals.collaboratorsCreated} novos · {iviCommitResult.totals.collaboratorsLinked} vinc.
                </div>
              </div>
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-2.5 dark:border-emerald-800/70 dark:bg-emerald-950/50">
                <div className="text-[11px] text-emerald-700 dark:text-emerald-300">Admissões</div>
                <div className="font-mono font-bold text-emerald-900 dark:text-emerald-200">
                  +{iviCommitResult.totals.admissionsCreated} / {iviCommitResult.totals.admissionsUpdated} atualiz.
                </div>
              </div>
              <div className="rounded-lg border border-red-200 bg-red-50 p-2.5 dark:border-red-800/70 dark:bg-red-950/50">
                <div className="text-[11px] text-red-700 dark:text-red-300">Erros</div>
                <div className="font-mono font-bold text-red-900 dark:text-red-200">
                  {iviCommitResult.totals.errors}
                </div>
              </div>
            </div>

            {iviCommitResult.rowLogs.length > 0 && (
              <div className="overflow-x-auto max-h-64 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700">
                <table className="w-full min-w-[880px] text-left text-xs">
                  <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-300">
                    <tr>
                      <th className="px-3 py-2">Linha</th>
                      <th className="px-3 py-2">Formulário</th>
                      <th className="px-3 py-2">Cliente / Titular</th>
                      <th className="px-3 py-2">Banco / Colaborador</th>
                      <th className="px-3 py-2">Protocolo / Contrato</th>
                      <th className="px-3 py-2">Selo Integrativo</th>
                      <th className="px-3 py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {iviCommitResult.rowLogs.map((l, idx) => (
                      <tr key={idx}>
                        <td className="px-3 py-2 font-mono text-slate-500">
                          {l.sheetName} #{l.rowNumber}
                        </td>
                        <td className="px-3 py-2 text-slate-700 dark:text-slate-200">{l.formMatched}</td>
                        <td className="px-3 py-2">
                          <div className="font-semibold text-slate-900 dark:text-slate-100">{l.clientName}</div>
                          {l.titularName && l.titularName !== l.clientName && (
                            <div className="text-[11px] text-slate-500">Titular: {l.titularName}</div>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <div>{l.bankName}</div>
                          <div className="text-[11px] text-slate-500">{l.collaboratorName}</div>
                        </td>
                        <td className="px-3 py-2 font-mono">
                          <div className="font-semibold">{l.protocolCode || '—'}</div>
                          <div className="text-[10px] text-slate-500">{l.contractNumber}</div>
                        </td>
                        <td className="px-3 py-2 font-mono text-emerald-700 dark:text-emerald-300">
                          {l.integrativeCode || '—'}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={`font-mono font-bold ${
                              l.status === 'OK' ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'
                            }`}
                          >
                            {l.status}
                          </span>
                          <span className="ml-1.5 text-slate-600 dark:text-slate-300">{l.detail}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Header & Global Controls */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-4 dark:border-slate-700 dark:bg-slate-900">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-slate-100 pb-3.5 dark:border-slate-800">
          <div>
            <div className="flex items-center gap-2">
              <FileSpreadsheet className="w-4 h-4 text-emerald-700 dark:text-emerald-300" />
              <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                Hub Simétrico de Planilhas Excel (.xlsx) &amp; Importação por Precedência
              </h2>
            </div>
            <p className="mt-0.5 text-slate-500 dark:text-slate-400">
              Todos os layouts possuem exportação (modelo vazio ou dados reais) e botão direto de importação (até 500 MB) com ordenação automática de dependências (Camadas 0 → 4), geração de códigos ausentes e upsert em registros existentes.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => triggerLayoutImportPicker(null)}
              disabled={importBusy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 font-semibold text-white hover:bg-slate-800 whitespace-nowrap dark:bg-emerald-600 dark:hover:bg-emerald-500"
            >
              <Upload className="w-3.5 h-3.5" />
              Importar Qualquer Planilha (até 500 MB)
            </button>
            <button
              type="button"
              onClick={loadRegistry}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Atualizar
            </button>
          </div>
        </div>

        {/* Summary Strip & Filters */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1 dark:border-slate-700 dark:bg-slate-800/70">
            <button
              type="button"
              onClick={() => setViewMode('packages')}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 font-semibold transition-colors whitespace-nowrap ${
                viewMode === 'packages'
                  ? 'bg-white text-slate-900 shadow-xs border border-slate-200 dark:bg-slate-900 dark:text-slate-100 dark:border-slate-700'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
              }`}
            >
              <GitBranch className="w-3.5 h-3.5" />
              Pacotes Relacionais ({packages.length})
            </button>
            <button
              type="button"
              onClick={() => setViewMode('entities')}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 font-semibold transition-colors whitespace-nowrap ${
                viewMode === 'entities'
                  ? 'bg-white text-slate-900 shadow-xs border border-slate-200 dark:bg-slate-900 dark:text-slate-100 dark:border-slate-700'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
              }`}
            >
              <Table2 className="w-3.5 h-3.5" />
              Tabelas Isoladas ({entities.length})
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <div className="flex items-center gap-1.5">
              <span className="text-slate-500 font-medium whitespace-nowrap dark:text-slate-400">Escopo Exportação:</span>
              <select
                value={unitFilter}
                onChange={(e) => setUnitFilter(e.target.value)}
                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-semibold text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              >
                <option value="all">Todas as Unidades</option>
                {units.map((u) => (
                  <option key={u.id} value={String(u.id)}>
                    {u.code} · {u.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-1.5">
              <span className="text-slate-500 font-medium whitespace-nowrap dark:text-slate-400">Unidade Fallback (Importação):</span>
              <select
                value={unitFallbackId}
                onChange={(e) => setUnitFallbackId(e.target.value)}
                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-semibold text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              >
                <option value="">Automático da Planilha</option>
                {units.map((u) => (
                  <option key={u.id} value={String(u.id)}>
                    {u.code} · {u.name}
                  </option>
                ))}
              </select>
            </div>

            <label className="inline-flex items-center gap-1.5 cursor-pointer text-slate-700 font-medium dark:text-slate-200">
              <input
                type="checkbox"
                checked={assignIntegrative}
                onChange={(e) => setAssignIntegrative(e.target.checked)}
                className="rounded border-slate-300 dark:border-slate-600"
              />
              <span>Selo HMAC Integrativo automático</span>
            </label>
          </div>
        </div>
      </div>

      {/* Precedence Pipeline Strip */}
      <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-700 mb-2 dark:text-slate-200">
          <Layers className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
          <span>Ordem Topológica de Leitura &amp; Gravação na Importação</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
          {[0, 1, 2, 3, 4].map((t) => {
            const countInTier = entities.filter((e) => e.tier === t).length;
            return (
              <div
                key={t}
                className="rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2 flex flex-col justify-between dark:border-slate-700 dark:bg-slate-800/60"
              >
                <div className="font-mono text-[10px] font-bold text-slate-500 uppercase dark:text-slate-400">Camada {t}</div>
                <div className="font-semibold text-slate-900 mt-0.5 leading-snug dark:text-slate-100">
                  {(tiers[t] || '').replace(/^Camada \d\s·\s/, '')}
                </div>
                <div className="mt-1 font-mono text-[11px] text-slate-500 tabular-nums dark:text-slate-400">
                  {countInTier} tabela(s)
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Validation / Import Result Panel (Visible whenever Dry-Run or Commit runs or errors) */}
      {(importBusy || importError || activeResult) && (
        <div className="rounded-xl border border-slate-300 bg-white p-4 space-y-4 dark:border-slate-600 dark:bg-slate-900">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3 dark:border-slate-800">
            <div>
              <div className="flex items-center gap-2">
                <ArrowDownUp className="w-4 h-4 text-emerald-700 dark:text-emerald-300" />
                <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                  {commitResult
                    ? 'Importação Transacional Efetivada no PostgreSQL'
                    : 'Pré-Validação por Ordem de Precedência (Dry-Run)'}
                </h3>
                {selectedFile && (
                  <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                    · {selectedFile.name} ({formatBytes(selectedFile.size)})
                  </span>
                )}
              </div>
              {pendingLayoutTarget && (
                <p className="text-[11px] text-slate-500 mt-0.5 dark:text-slate-400">
                  Layout vinculado: <strong className="text-slate-700 dark:text-slate-200">{pendingLayoutTarget.label}</strong>
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {commitResult?.returnWorkbookBase64 && commitResult?.returnFileName && (
                <button
                  type="button"
                  onClick={() =>
                    downloadBase64Xlsx(commitResult.returnWorkbookBase64!, commitResult.returnFileName!)
                  }
                  className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 font-semibold text-emerald-800 hover:bg-emerald-100 whitespace-nowrap dark:border-emerald-800/70 dark:bg-emerald-950/50 dark:text-emerald-300 dark:hover:bg-emerald-900/60"
                >
                  <Download className="w-3.5 h-3.5" />
                  Baixar Planilha de Retorno (.xlsx)
                </button>
              )}
              {dryRunResult && !importBusy && (
                <button
                  type="button"
                  onClick={handleCommitImport}
                  disabled={dryRunResult.totals.inserts + dryRunResult.totals.updates === 0}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-4 py-1.5 font-semibold text-white hover:bg-emerald-800 disabled:opacity-50 whitespace-nowrap"
                >
                  <Play className="w-3.5 h-3.5" />
                  Confirmar Importação ({dryRunResult.totals.inserts + dryRunResult.totals.updates} registro(s))
                </button>
              )}
              <button
                type="button"
                onClick={async () => {
                  stdAbortRef.current?.abort();
                  if (stdUploadSessionId) await releaseUploadSession(stdUploadSessionId);
                  setStdUploadSessionId(null);
                  stdPreparedInfoRef.current = null;
                  setStdProgress(null);
                  setDryRunResult(null);
                  setCommitResult(null);
                  setImportError('');
                  setSelectedFile(null);
                }}
                className="rounded-lg border border-slate-200 px-2.5 py-1.5 font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Fechar
              </button>
            </div>
          </div>

          {importBusy && (
            <div className="rounded-lg border border-emerald-300 bg-emerald-50/70 p-3.5 space-y-2.5 dark:border-emerald-800/70 dark:bg-emerald-950/40">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-semibold text-slate-900 dark:text-slate-100">
                  {stdProgress
                    ? stdProgress.phaseLabel
                    : 'Processando planilha em lotes topológicos seguros...'}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {stdProgress && (
                    <span className="font-mono text-[11px] font-bold text-emerald-900 tabular-nums dark:text-emerald-200">
                      {stdProgress.pct}%
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => stdAbortRef.current?.abort()}
                    className="rounded border border-red-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-red-700 hover:bg-red-50 dark:border-red-800 dark:bg-slate-900 dark:text-red-300"
                  >
                    Cancelar
                  </button>
                </div>
              </div>

              <progress
                value={stdProgress?.pct ?? 0}
                max={100}
                className="w-full h-2.5 accent-emerald-600 rounded-full overflow-hidden"
              />

              {stdProgress && (
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-slate-700 dark:text-slate-300 tabular-nums">
                  <div className="flex flex-wrap items-center gap-3">
                    {stdProgress.totalRows > 0 && (
                      <span>
                        Linhas lidas: <strong>{stdProgress.processedRows}</strong> / {stdProgress.totalRows}
                      </span>
                    )}
                    {stdProgress.totalChunks > 0 && (
                      <span>
                        Marcação de Leitura: <strong>{stdProgress.markedReadChunks}</strong> / {stdProgress.totalChunks} lotes
                      </span>
                    )}
                    {stdProgress.currentSheetName && (
                      <span>
                        Camada {stdProgress.currentTier} · <strong>{stdProgress.currentSheetName}</strong>
                      </span>
                    )}
                  </div>
                  {stdProgress.cumulativeTotals && (
                    <div className="flex flex-wrap items-center gap-2.5 text-[11px]">
                      <span className="text-emerald-800 font-semibold dark:text-emerald-300">
                        +{stdProgress.cumulativeTotals.inserts} inserir
                      </span>
                      <span className="text-blue-800 font-semibold dark:text-blue-300">
                        ~{stdProgress.cumulativeTotals.updates} atualizar
                      </span>
                      <span>{stdProgress.cumulativeTotals.skips} ignoradas</span>
                      {stdProgress.cumulativeTotals.errors > 0 && (
                        <span className="text-red-700 font-bold dark:text-red-300">
                          {stdProgress.cumulativeTotals.errors} erro(s)
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {importError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-red-800 flex items-center gap-2 dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{importError}</span>
            </div>
          )}

          {activeResult && (
            <div className="space-y-3">
              {/* Totals Strip */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800/70">
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">Linhas Lidas</div>
                  <div className="font-mono text-base font-bold text-slate-900 tabular-nums dark:text-slate-100">
                    {activeResult.totals.totalRows}
                  </div>
                </div>
                <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2 dark:border-emerald-800/70 dark:bg-emerald-950/50">
                  <div className="text-[11px] text-emerald-700 dark:text-emerald-300">Novas Inserções</div>
                  <div className="font-mono text-base font-bold text-emerald-800 tabular-nums dark:text-emerald-300">
                    {activeResult.totals.inserts}
                  </div>
                </div>
                <div className="rounded-lg border border-blue-200 bg-blue-50/60 px-3 py-2 dark:border-blue-800/70 dark:bg-blue-950/50">
                  <div className="text-[11px] text-blue-700 dark:text-blue-300">Atualizações (Upsert)</div>
                  <div className="font-mono text-base font-bold text-blue-800 tabular-nums dark:text-blue-300">
                    {activeResult.totals.updates}
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800/70">
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">Ignoradas</div>
                  <div className="font-mono text-base font-bold text-slate-700 tabular-nums dark:text-slate-200">
                    {activeResult.totals.skips}
                  </div>
                </div>
                <div className="rounded-lg border border-red-200 bg-red-50/60 px-3 py-2 dark:border-red-800/70 dark:bg-red-950/50">
                  <div className="text-[11px] text-red-700 dark:text-red-300">Erros / Pendências</div>
                  <div className="font-mono text-base font-bold text-red-800 tabular-nums dark:text-red-300">
                    {activeResult.totals.errors}
                  </div>
                </div>
              </div>

              {activeResult.unrecognizedSheets.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900 dark:border-amber-800/70 dark:bg-amber-950/50 dark:text-amber-300">
                  Abas ignoradas por não corresponderem a uma entidade conhecida:{' '}
                  <span className="font-mono font-semibold">{activeResult.unrecognizedSheets.join(', ')}</span>
                </div>
              )}

              {/* Sheet Precedence Execution Order */}
              {activeResult.orderedSheets.length > 0 && (
                <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600 dark:bg-slate-800/70 dark:border-slate-700 dark:text-slate-300">
                      <tr>
                        <th className="px-3 py-2">Ordem</th>
                        <th className="px-3 py-2">Camada</th>
                        <th className="px-3 py-2">Aba / Entidade</th>
                        <th className="px-3 py-2 text-right">Linhas</th>
                        <th className="px-3 py-2 text-right">Inserir</th>
                        <th className="px-3 py-2 text-right">Atualizar</th>
                        <th className="px-3 py-2 text-right">Erros</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {activeResult.orderedSheets.map((s, idx) => (
                        <tr key={`${s.entityKey}-${idx}`} className="hover:bg-slate-50 dark:hover:bg-slate-800">
                          <td className="px-3 py-2 font-mono font-bold text-slate-700 tabular-nums dark:text-slate-200">#{idx + 1}</td>
                          <td className="px-3 py-2 font-mono text-slate-500 dark:text-slate-400">Camada {s.tier}</td>
                          <td className="px-3 py-2 font-semibold text-slate-900 dark:text-slate-100">
                            {s.sheetName} <span className="font-normal text-slate-500 dark:text-slate-400">· {s.label}</span>
                          </td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums">{s.totalRows}</td>
                          <td className="px-3 py-2 text-right font-mono text-emerald-700 font-semibold tabular-nums dark:text-emerald-300">
                            {s.inserts}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-blue-700 font-semibold tabular-nums dark:text-blue-300">
                            {s.updates}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-red-700 font-semibold tabular-nums dark:text-red-300">
                            {s.errors}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Row-level Inspection */}
              {activeResult.rowResults.length > 0 && (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-slate-800 dark:text-slate-100">
                      Detalhamento Linha a Linha (Códigos Atribuídos &amp; Upsert)
                    </span>
                    <div className="flex items-center gap-1">
                      {(['ALL', 'INSERT', 'UPDATE', 'ERROR'] as const).map((f) => (
                        <button
                          key={f}
                          type="button"
                          onClick={() => setActionFilter(f)}
                          className={`rounded-md border px-2.5 py-1 text-[11px] font-semibold ${
                            actionFilter === f
                              ? 'border-slate-900 bg-slate-900 text-white dark:border-emerald-500 dark:bg-emerald-600'
                              : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
                          }`}
                        >
                          {f === 'ALL' ? 'Todas' : f === 'INSERT' ? 'Inserções' : f === 'UPDATE' ? 'Atualizações' : 'Erros'}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="overflow-x-auto max-h-72 overflow-y-auto rounded-lg border border-slate-200 scroll-rulers dark:border-slate-700">
                    <table className="w-full min-w-[780px] text-left text-xs">
                      <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600 dark:bg-slate-800/70 dark:border-slate-700 dark:text-slate-300">
                        <tr>
                          <th className="px-3 py-2">Aba · Linha</th>
                          <th className="px-3 py-2">Ação</th>
                          <th className="px-3 py-2">Chave Natural</th>
                          <th className="px-3 py-2">Código Atribuído</th>
                          <th className="px-3 py-2">Código Seguro Integrativo</th>
                          <th className="px-3 py-2">Resultado</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {visibleRows.map((rr, idx) => (
                          <tr key={idx} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/70">
                            <td className="px-3 py-2 font-mono text-slate-600 whitespace-nowrap dark:text-slate-300">
                              {rr.sheetName} #{rr.rowNumber}
                            </td>
                            <td className="px-3 py-2 font-mono font-bold whitespace-nowrap">
                              <span
                                className={
                                  rr.action === 'INSERT'
                                    ? 'text-emerald-700 dark:text-emerald-300'
                                    : rr.action === 'UPDATE'
                                    ? 'text-blue-700 dark:text-blue-300'
                                    : rr.action === 'ERROR'
                                    ? 'text-red-700 dark:text-red-300'
                                    : 'text-slate-500 dark:text-slate-400'
                                }
                              >
                                {rr.action}
                              </span>
                            </td>
                            <td className="px-3 py-2 font-mono text-slate-800 dark:text-slate-100">{rr.naturalKey || '—'}</td>
                            <td className="px-3 py-2 font-mono font-semibold text-slate-900 dark:text-slate-100">
                              {rr.assignedCode || '—'}
                            </td>
                            <td className="px-3 py-2 font-mono text-emerald-800 dark:text-emerald-300">
                              {rr.integrativeCode || '—'}
                            </td>
                            <td className="px-3 py-2 text-slate-600 dark:text-slate-300">{rr.message}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* VIEW 1: PACOTES RELACIONAIS (PRINCIPAL + VÍNCULOS) */}
      {viewMode === 'packages' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {packages.map((pkg) => {
            const includedEntities = pkg.entityKeys
              .map((k) => entityMap.get(k))
              .filter((e): e is HubEntityLayout => Boolean(e))
              .sort((a, b) => a.order - b.order);

            return (
              <div
                key={pkg.key}
                className="rounded-xl border border-slate-200 bg-white p-4 flex flex-col justify-between gap-4 dark:border-slate-700 dark:bg-slate-900"
              >
                <div className="space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">{pkg.label}</div>
                      <p className="mt-0.5 text-slate-500 leading-relaxed dark:text-slate-400">{pkg.description}</p>
                    </div>
                    <span className="font-mono text-[11px] font-semibold text-slate-500 whitespace-nowrap tabular-nums dark:text-slate-400">
                      {includedEntities.length} abas
                    </span>
                  </div>

                  {/* Precedence Chain Inside Package */}
                  <div className="rounded-lg border border-slate-100 bg-slate-50 p-2.5 dark:border-slate-800 dark:bg-slate-800/70">
                    <div className="text-[11px] font-semibold text-slate-600 mb-1.5 dark:text-slate-300">
                      Abas do Workbook em Ordem de Precedência:
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 font-mono text-[11px] text-slate-700 dark:text-slate-200">
                      {includedEntities.slice(0, 10).map((ent, idx) => (
                        <React.Fragment key={ent.key}>
                          <span className="rounded border border-slate-200 bg-white px-2 py-0.5 dark:border-slate-700 dark:bg-slate-900">
                            C{ent.tier} · {ent.sheetName}
                          </span>
                          {idx < Math.min(includedEntities.length, 10) - 1 && (
                            <span className="text-slate-400 dark:text-slate-400">→</span>
                          )}
                        </React.Fragment>
                      ))}
                      {includedEntities.length > 10 && (
                        <span className="text-slate-500 font-semibold dark:text-slate-400">
                          +{includedEntities.length - 10} tabelas
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Mandatory Symmetric Round-Trip Actions: Template, Export Data, AND Import from this Layout */}
                <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={() =>
                      handleDownloadXlsx({
                        scopeType: 'package',
                        key: pkg.key,
                        mode: 'template',
                        label: pkg.label,
                      })
                    }
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Baixar Modelo (.xlsx)
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      handleDownloadXlsx({
                        scopeType: 'package',
                        key: pkg.key,
                        mode: 'data',
                        label: pkg.label,
                      })
                    }
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-slate-900 px-3 py-1.5 font-semibold text-white hover:bg-slate-800 whitespace-nowrap dark:border-slate-600 dark:bg-emerald-600 dark:hover:bg-emerald-500"
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5" />
                    Exportar Dados (.xlsx)
                  </button>
                  <button
                    type="button"
                    disabled={importBusy}
                    onClick={() =>
                      triggerLayoutImportPicker({
                        scopeType: 'package',
                        key: pkg.key,
                        label: pkg.label,
                      })
                    }
                    className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 font-semibold text-emerald-800 hover:bg-emerald-100 whitespace-nowrap ml-auto dark:border-emerald-800/70 dark:bg-emerald-950/50 dark:text-emerald-300 dark:hover:bg-emerald-900/60"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    Importar deste Layout (.xlsx)
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* VIEW 2: TABELAS ISOLADAS (32 ENTIDADES COM EXPORTAÇÃO + IMPORTAÇÃO EM CADA UMA) */}
      {viewMode === 'entities' && (
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden dark:border-slate-700 dark:bg-slate-900">
          <div className="p-3.5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 bg-slate-50/70 dark:border-slate-700 dark:bg-slate-800/60">
            <div className="relative flex-1 max-w-md">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 dark:text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar tabela, aba Excel ou chave natural..."
                className="w-full rounded-lg border border-slate-200 bg-white pl-8 pr-3 py-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-slate-500 font-medium dark:text-slate-400">Camada:</span>
              <select
                value={tierFilter}
                onChange={(e) => setTierFilter(e.target.value)}
                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-semibold text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              >
                <option value="all">Todas (0 → 4)</option>
                {[0, 1, 2, 3, 4].map((t) => (
                  <option key={t} value={String(t)}>
                    {tiers[t] || `Camada ${t}`}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-300">
                <tr>
                  <th className="px-4 py-2.5">Precedência</th>
                  <th className="px-4 py-2.5">Tabela / Aba Excel</th>
                  <th className="px-4 py-2.5">Chave Natural (Upsert) &amp; Auto-Código</th>
                  <th className="px-4 py-2.5">Dependências (Pais)</th>
                  <th className="px-4 py-2.5 text-right">Ações Simétricas (Exportar ↔ Importar)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredEntities.map((ent) => {
                  const isExpanded = expandedEntityKey === ent.key;
                  return (
                    <React.Fragment key={ent.key}>
                      <tr className="hover:bg-slate-50/70 dark:hover:bg-slate-800">
                        <td className="px-4 py-2.5 font-mono text-slate-600 whitespace-nowrap tabular-nums dark:text-slate-300">
                          C{ent.tier} · #{ent.order}
                        </td>
                        <td className="px-4 py-2.5">
                          <button
                            type="button"
                            onClick={() => setExpandedEntityKey(isExpanded ? null : ent.key)}
                            className="inline-flex items-center gap-1.5 font-semibold text-slate-900 hover:text-emerald-700 text-left dark:text-slate-100"
                          >
                            {isExpanded ? (
                              <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0 dark:text-slate-400" />
                            ) : (
                              <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0 dark:text-slate-400" />
                            )}
                            <span>{ent.label}</span>
                          </button>
                          <div className="pl-5 font-mono text-[11px] text-slate-500 dark:text-slate-400">
                            Aba: {ent.sheetName} · {ent.columns.length} coluna(s)
                          </div>
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="font-mono text-[11px] text-slate-800 dark:text-slate-100">{ent.naturalKeyDescription}</div>
                          {ent.autoCodeField && (
                            <div className="font-mono text-[11px] text-emerald-700 dark:text-emerald-300">
                              Auto-código: {ent.autoCodePrefix}-xxxx (se vazio)
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-[11px] text-slate-500 dark:text-slate-400">
                          {ent.dependsOn.length === 0 ? 'Raiz (nenhuma)' : ent.dependsOn.join(', ')}
                        </td>
                        <td className="px-4 py-2.5 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() =>
                                handleDownloadXlsx({
                                  scopeType: 'entity',
                                  key: ent.key,
                                  mode: 'template',
                                  label: ent.label,
                                })
                              }
                              className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                            >
                              <Download className="w-3 h-3" />
                              Modelo
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                handleDownloadXlsx({
                                  scopeType: 'entity',
                                  key: ent.key,
                                  mode: 'data',
                                  label: ent.label,
                                })
                              }
                              className="inline-flex items-center gap-1 rounded-md bg-slate-900 px-2.5 py-1.5 font-semibold text-white hover:bg-slate-800 dark:bg-emerald-600 dark:hover:bg-emerald-500"
                            >
                              <FileSpreadsheet className="w-3 h-3" />
                              Exportar
                            </button>
                            <button
                              type="button"
                              disabled={importBusy}
                              onClick={() =>
                                triggerLayoutImportPicker({
                                  scopeType: 'entity',
                                  key: ent.key,
                                  label: ent.label,
                                })
                              }
                              className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50 px-2.5 py-1.5 font-semibold text-emerald-800 hover:bg-emerald-100 dark:border-emerald-800/70 dark:bg-emerald-950/50 dark:text-emerald-300 dark:hover:bg-emerald-900/60"
                            >
                              <Upload className="w-3 h-3" />
                              Importar
                            </button>
                          </div>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="bg-slate-50/80 dark:bg-slate-800/60">
                          <td colSpan={5} className="px-6 py-3">
                            <div className="text-[11px] font-semibold text-slate-700 mb-2 dark:text-slate-200">
                              Dicionário de Colunas do Layout "{ent.sheetName}"
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                              {ent.columns.map((c) => (
                                <div
                                  key={c.key}
                                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 space-y-0.5 dark:border-slate-700 dark:bg-slate-900"
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="font-mono font-bold text-slate-900 dark:text-slate-100">{c.header}</span>
                                    <span className="font-mono text-[10px] text-slate-500 dark:text-slate-400">
                                      {c.type}
                                      {c.required ? ' · Obrig.' : ''}
                                      {c.isUpsertKey ? ' · Upsert' : ''}
                                      {c.isAutoCode ? ' · Auto' : ''}
                                    </span>
                                  </div>
                                  <div className="text-[11px] text-slate-600 dark:text-slate-300">{c.description}</div>
                                  <div className="font-mono text-[10px] text-slate-400 dark:text-slate-400">Ex: {c.example}</div>
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Integrity Notice */}
      <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 flex items-center gap-2.5 text-[11px] text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
        <ShieldCheck className="w-4 h-4 text-emerald-700 shrink-0 dark:text-emerald-300" />
        <span>
          Cada importação confirmada processa por streaming em lotes transacionais de 250 linhas no PostgreSQL com marcação de leitura por bloco, trilha em <span className="font-mono">audit_logs</span> e geração imediata da planilha <span className="font-mono">retorno_importacao_*.xlsx</span> com todos os códigos gerados e chaves HMAC integrativas.
        </span>
      </div>

      {/* Collapsible Legacy CSV Utility */}
      {legacyCsvSection && (
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden dark:border-slate-700 dark:bg-slate-900">
          <button
            type="button"
            onClick={() => setShowLegacyCsv((v) => !v)}
            className="w-full px-4 py-3 flex items-center justify-between text-left font-semibold text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <span className="flex items-center gap-2">
              {showLegacyCsv ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              Utilitário Legado de Carga &amp; Exportação Rápida CSV (Ponto-e-Vírgula)
            </span>
            <span className="text-[11px] font-normal text-slate-500 dark:text-slate-400">Compatibilidade Retroativa</span>
          </button>
          {showLegacyCsv && <div className="border-t border-slate-100 p-4 space-y-4 dark:border-slate-800">{legacyCsvSection}</div>}
        </div>
      )}
    </div>
  );
};
