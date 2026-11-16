import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownUp,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
  FileSpreadsheet,
  GitBranch,
  Layers,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
  Table2,
  Upload,
} from 'lucide-react';
import { apiFetch, getAuthToken } from '../../../lib/api.ts';

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

  // Import state
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [pendingLayoutTarget, setPendingLayoutTarget] = useState<{
    scopeType: 'package' | 'entity';
    key: string;
    label: string;
  } | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [assignIntegrative, setAssignIntegrative] = useState(true);
  const [unitFallbackId, setUnitFallbackId] = useState<string>('');
  const [dryRunResult, setDryRunResult] = useState<ExcelImportResult | null>(null);
  const [commitResult, setCommitResult] = useState<ExcelImportResult | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState('');
  const [actionFilter, setActionFilter] = useState<'ALL' | 'INSERT' | 'UPDATE' | 'ERROR'>('ALL');
  const [showLegacyCsv, setShowLegacyCsv] = useState(false);

  const loadRegistry = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const data = await apiFetch<{
        tiers: Record<number, string>;
        entities: HubEntityLayout[];
        packages: HubPackageLayout[];
        units: HubUnitOption[];
      }>('/api/data-hub/layouts');
      setTiers(data.tiers || {});
      setEntities(data.entities || []);
      setPackages(data.packages || []);
      setUnits(data.units || []);
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
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({ error: 'Falha ao exportar Excel.' }));
        throw new Error(errJson.error || 'Falha ao exportar Excel.');
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
    setImportBusy(true);
    setImportError('');
    setDryRunResult(null);
    setCommitResult(null);
    try {
      const form = new FormData();
      form.append('file', file);
      if (target && target.scopeType === 'entity') {
        form.append('expectedLayoutKey', target.key);
      }
      if (unitFallbackId) {
        form.append('unitFallbackId', unitFallbackId);
      }
      form.append('assignIntegrative', String(assignIntegrative));

      const token = getAuthToken();
      const res = await fetch('/api/data-hub/import-xlsx/dry-run', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload.error || 'Falha na leitura da planilha Excel.');
      }
      setDryRunResult(payload as ExcelImportResult);
      onToast(
        `Pré-validação por precedência concluída: ${payload.totals?.inserts || 0} novo(s), ${
          payload.totals?.updates || 0
        } atualização(ões).`
      );
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Erro ao validar planilha .xlsx.');
    } finally {
      setImportBusy(false);
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
    setImportBusy(true);
    setImportError('');
    try {
      const form = new FormData();
      form.append('file', selectedFile);
      if (pendingLayoutTarget && pendingLayoutTarget.scopeType === 'entity') {
        form.append('expectedLayoutKey', pendingLayoutTarget.key);
      }
      if (unitFallbackId) {
        form.append('unitFallbackId', unitFallbackId);
      }
      form.append('assignIntegrative', String(assignIntegrative));

      const token = getAuthToken();
      const res = await fetch('/api/data-hub/import-xlsx/commit', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const payload = (await res.json()) as ExcelImportResult & { error?: string };
      if (!res.ok) {
        throw new Error(payload.error || 'Erro ao efetivar importação no Cloud SQL.');
      }
      setCommitResult(payload);
      setDryRunResult(null);
      if (payload.returnWorkbookBase64 && payload.returnFileName) {
        downloadBase64Xlsx(payload.returnWorkbookBase64, payload.returnFileName);
      }
      onToast(
        `Importação transacional efetivada: ${payload.totals.inserts} inserção(ões) · ${payload.totals.updates} atualização(ões). Planilha de retorno baixada.`
      );
      onDataImported?.();
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Erro ao gravar importação.');
    } finally {
      setImportBusy(false);
    }
  };

  const activeResult = commitResult || dryRunResult;
  const visibleRows = useMemo(() => {
    if (!activeResult) return [];
    if (actionFilter === 'ALL') return activeResult.rowResults;
    return activeResult.rowResults.filter((r) => r.action === actionFilter);
  }, [activeResult, actionFilter]);

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-xs text-slate-500">
        Carregando catálogo relacional de planilhas e matriz de precedência (Camadas 0 → 4)...
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-xs text-red-800 flex items-center justify-between gap-3">
        <span>{loadError}</span>
        <button
          type="button"
          onClick={loadRegistry}
          className="rounded-lg border border-red-300 bg-white px-3 py-1.5 font-semibold text-red-800 hover:bg-red-100"
        >
          Tentar novamente
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4 text-xs">
      {/* Hidden shared file picker */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls"
        onChange={handleFileChosen}
        className="hidden"
      />

      {/* Header & Global Controls */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-slate-100 pb-3.5">
          <div>
            <div className="flex items-center gap-2">
              <FileSpreadsheet className="w-4 h-4 text-emerald-700" />
              <h2 className="font-display text-base font-bold text-slate-900">
                Hub Simétrico de Planilhas Excel (.xlsx) &amp; Importação por Precedência
              </h2>
            </div>
            <p className="mt-0.5 text-slate-500">
              Todos os layouts possuem exportação (modelo vazio ou dados reais) e botão direto de importação com ordenação automática de dependências (Camadas 0 → 4), geração de códigos ausentes e upsert em registros existentes.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => triggerLayoutImportPicker(null)}
              disabled={importBusy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 font-semibold text-white hover:bg-slate-800 whitespace-nowrap"
            >
              <Upload className="w-3.5 h-3.5" />
              Importar Qualquer Planilha (.xlsx)
            </button>
            <button
              type="button"
              onClick={loadRegistry}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Atualizar
            </button>
          </div>
        </div>

        {/* Summary Strip & Filters */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1">
            <button
              type="button"
              onClick={() => setViewMode('packages')}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 font-semibold transition-colors whitespace-nowrap ${
                viewMode === 'packages'
                  ? 'bg-white text-slate-900 shadow-xs border border-slate-200'
                  : 'text-slate-600 hover:text-slate-900'
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
                  ? 'bg-white text-slate-900 shadow-xs border border-slate-200'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Table2 className="w-3.5 h-3.5" />
              Tabelas Isoladas ({entities.length})
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <div className="flex items-center gap-1.5">
              <span className="text-slate-500 font-medium whitespace-nowrap">Escopo Exportação:</span>
              <select
                value={unitFilter}
                onChange={(e) => setUnitFilter(e.target.value)}
                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-semibold text-slate-800"
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
              <span className="text-slate-500 font-medium whitespace-nowrap">Unidade Fallback (Importação):</span>
              <select
                value={unitFallbackId}
                onChange={(e) => setUnitFallbackId(e.target.value)}
                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-semibold text-slate-800"
              >
                <option value="">Automático da Planilha</option>
                {units.map((u) => (
                  <option key={u.id} value={String(u.id)}>
                    {u.code} · {u.name}
                  </option>
                ))}
              </select>
            </div>

            <label className="inline-flex items-center gap-1.5 cursor-pointer text-slate-700 font-medium">
              <input
                type="checkbox"
                checked={assignIntegrative}
                onChange={(e) => setAssignIntegrative(e.target.checked)}
                className="rounded border-slate-300"
              />
              <span>Selo HMAC Integrativo automático</span>
            </label>
          </div>
        </div>
      </div>

      {/* Precedence Pipeline Strip */}
      <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-700 mb-2">
          <Layers className="w-3.5 h-3.5 text-slate-500" />
          <span>Ordem Topológica de Leitura &amp; Gravação na Importação</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
          {[0, 1, 2, 3, 4].map((t) => {
            const countInTier = entities.filter((e) => e.tier === t).length;
            return (
              <div
                key={t}
                className="rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2 flex flex-col justify-between"
              >
                <div className="font-mono text-[10px] font-bold text-slate-500 uppercase">Camada {t}</div>
                <div className="font-semibold text-slate-900 mt-0.5 leading-snug">
                  {(tiers[t] || '').replace(/^Camada \d\s·\s/, '')}
                </div>
                <div className="mt-1 font-mono text-[11px] text-slate-500 tabular-nums">
                  {countInTier} tabela(s)
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Validation / Import Result Panel (Visible whenever Dry-Run or Commit runs or errors) */}
      {(importBusy || importError || activeResult) && (
        <div className="rounded-xl border border-slate-300 bg-white p-4 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
            <div>
              <div className="flex items-center gap-2">
                <ArrowDownUp className="w-4 h-4 text-emerald-700" />
                <h3 className="font-display text-sm font-bold text-slate-900">
                  {commitResult
                    ? 'Importação Transacional Efetivada no PostgreSQL'
                    : 'Pré-Validação por Ordem de Precedência (Dry-Run)'}
                </h3>
                {selectedFile && (
                  <span className="font-mono text-[11px] text-slate-500">· {selectedFile.name}</span>
                )}
              </div>
              {pendingLayoutTarget && (
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Layout vinculado: <strong className="text-slate-700">{pendingLayoutTarget.label}</strong>
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
                  className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 font-semibold text-emerald-800 hover:bg-emerald-100 whitespace-nowrap"
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
                onClick={() => {
                  setDryRunResult(null);
                  setCommitResult(null);
                  setImportError('');
                  setSelectedFile(null);
                }}
                className="rounded-lg border border-slate-200 px-2.5 py-1.5 font-semibold text-slate-600 hover:bg-slate-50"
              >
                Fechar
              </button>
            </div>
          </div>

          {importBusy && (
            <div className="py-4 text-center font-medium text-slate-600">
              Processando abas em ordem topológica, resolvendo chaves naturais e atribuindo códigos...
            </div>
          )}

          {importError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-red-800 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{importError}</span>
            </div>
          )}

          {activeResult && (
            <div className="space-y-3">
              {/* Totals Strip */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <div className="text-[11px] text-slate-500">Linhas Lidas</div>
                  <div className="font-mono text-base font-bold text-slate-900 tabular-nums">
                    {activeResult.totals.totalRows}
                  </div>
                </div>
                <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2">
                  <div className="text-[11px] text-emerald-700">Novas Inserções</div>
                  <div className="font-mono text-base font-bold text-emerald-800 tabular-nums">
                    {activeResult.totals.inserts}
                  </div>
                </div>
                <div className="rounded-lg border border-blue-200 bg-blue-50/60 px-3 py-2">
                  <div className="text-[11px] text-blue-700">Atualizações (Upsert)</div>
                  <div className="font-mono text-base font-bold text-blue-800 tabular-nums">
                    {activeResult.totals.updates}
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <div className="text-[11px] text-slate-500">Ignoradas</div>
                  <div className="font-mono text-base font-bold text-slate-700 tabular-nums">
                    {activeResult.totals.skips}
                  </div>
                </div>
                <div className="rounded-lg border border-red-200 bg-red-50/60 px-3 py-2">
                  <div className="text-[11px] text-red-700">Erros / Pendências</div>
                  <div className="font-mono text-base font-bold text-red-800 tabular-nums">
                    {activeResult.totals.errors}
                  </div>
                </div>
              </div>

              {activeResult.unrecognizedSheets.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
                  Abas ignoradas por não corresponderem a uma entidade conhecida:{' '}
                  <span className="font-mono font-semibold">{activeResult.unrecognizedSheets.join(', ')}</span>
                </div>
              )}

              {/* Sheet Precedence Execution Order */}
              {activeResult.orderedSheets.length > 0 && (
                <div className="overflow-x-auto rounded-lg border border-slate-200">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600">
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
                    <tbody className="divide-y divide-slate-100">
                      {activeResult.orderedSheets.map((s, idx) => (
                        <tr key={`${s.entityKey}-${idx}`} className="hover:bg-slate-50">
                          <td className="px-3 py-2 font-mono font-bold text-slate-700 tabular-nums">#{idx + 1}</td>
                          <td className="px-3 py-2 font-mono text-slate-500">Camada {s.tier}</td>
                          <td className="px-3 py-2 font-semibold text-slate-900">
                            {s.sheetName} <span className="font-normal text-slate-500">· {s.label}</span>
                          </td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums">{s.totalRows}</td>
                          <td className="px-3 py-2 text-right font-mono text-emerald-700 font-semibold tabular-nums">
                            {s.inserts}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-blue-700 font-semibold tabular-nums">
                            {s.updates}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-red-700 font-semibold tabular-nums">
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
                    <span className="font-semibold text-slate-800">
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
                              ? 'border-slate-900 bg-slate-900 text-white'
                              : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                          }`}
                        >
                          {f === 'ALL' ? 'Todas' : f === 'INSERT' ? 'Inserções' : f === 'UPDATE' ? 'Atualizações' : 'Erros'}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="overflow-x-auto max-h-72 overflow-y-auto rounded-lg border border-slate-200 scroll-rulers">
                    <table className="w-full min-w-[780px] text-left text-xs">
                      <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600">
                        <tr>
                          <th className="px-3 py-2">Aba · Linha</th>
                          <th className="px-3 py-2">Ação</th>
                          <th className="px-3 py-2">Chave Natural</th>
                          <th className="px-3 py-2">Código Atribuído</th>
                          <th className="px-3 py-2">Código Seguro Integrativo</th>
                          <th className="px-3 py-2">Resultado</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {visibleRows.map((rr, idx) => (
                          <tr key={idx} className="hover:bg-slate-50/80">
                            <td className="px-3 py-2 font-mono text-slate-600 whitespace-nowrap">
                              {rr.sheetName} #{rr.rowNumber}
                            </td>
                            <td className="px-3 py-2 font-mono font-bold whitespace-nowrap">
                              <span
                                className={
                                  rr.action === 'INSERT'
                                    ? 'text-emerald-700'
                                    : rr.action === 'UPDATE'
                                    ? 'text-blue-700'
                                    : rr.action === 'ERROR'
                                    ? 'text-red-700'
                                    : 'text-slate-500'
                                }
                              >
                                {rr.action}
                              </span>
                            </td>
                            <td className="px-3 py-2 font-mono text-slate-800">{rr.naturalKey || '—'}</td>
                            <td className="px-3 py-2 font-mono font-semibold text-slate-900">
                              {rr.assignedCode || '—'}
                            </td>
                            <td className="px-3 py-2 font-mono text-emerald-800">
                              {rr.integrativeCode || '—'}
                            </td>
                            <td className="px-3 py-2 text-slate-600">{rr.message}</td>
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
                className="rounded-xl border border-slate-200 bg-white p-4 flex flex-col justify-between gap-4"
              >
                <div className="space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-display text-sm font-bold text-slate-900">{pkg.label}</div>
                      <p className="mt-0.5 text-slate-500 leading-relaxed">{pkg.description}</p>
                    </div>
                    <span className="font-mono text-[11px] font-semibold text-slate-500 whitespace-nowrap tabular-nums">
                      {includedEntities.length} abas
                    </span>
                  </div>

                  {/* Precedence Chain Inside Package */}
                  <div className="rounded-lg border border-slate-100 bg-slate-50 p-2.5">
                    <div className="text-[11px] font-semibold text-slate-600 mb-1.5">
                      Abas do Workbook em Ordem de Precedência:
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 font-mono text-[11px] text-slate-700">
                      {includedEntities.slice(0, 10).map((ent, idx) => (
                        <React.Fragment key={ent.key}>
                          <span className="rounded border border-slate-200 bg-white px-2 py-0.5">
                            C{ent.tier} · {ent.sheetName}
                          </span>
                          {idx < Math.min(includedEntities.length, 10) - 1 && (
                            <span className="text-slate-400">→</span>
                          )}
                        </React.Fragment>
                      ))}
                      {includedEntities.length > 10 && (
                        <span className="text-slate-500 font-semibold">
                          +{includedEntities.length - 10} tabelas
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Mandatory Symmetric Round-Trip Actions: Template, Export Data, AND Import from this Layout */}
                <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
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
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap"
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
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-slate-900 px-3 py-1.5 font-semibold text-white hover:bg-slate-800 whitespace-nowrap"
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
                    className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 font-semibold text-emerald-800 hover:bg-emerald-100 whitespace-nowrap ml-auto"
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
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <div className="p-3.5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 bg-slate-50/70">
            <div className="relative flex-1 max-w-md">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar tabela, aba Excel ou chave natural..."
                className="w-full rounded-lg border border-slate-200 bg-white pl-8 pr-3 py-1.5 text-xs text-slate-900"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-slate-500 font-medium">Camada:</span>
              <select
                value={tierFilter}
                onChange={(e) => setTierFilter(e.target.value)}
                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-semibold text-slate-800"
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
              <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600">
                <tr>
                  <th className="px-4 py-2.5">Precedência</th>
                  <th className="px-4 py-2.5">Tabela / Aba Excel</th>
                  <th className="px-4 py-2.5">Chave Natural (Upsert) &amp; Auto-Código</th>
                  <th className="px-4 py-2.5">Dependências (Pais)</th>
                  <th className="px-4 py-2.5 text-right">Ações Simétricas (Exportar ↔ Importar)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredEntities.map((ent) => {
                  const isExpanded = expandedEntityKey === ent.key;
                  return (
                    <React.Fragment key={ent.key}>
                      <tr className="hover:bg-slate-50/70">
                        <td className="px-4 py-2.5 font-mono text-slate-600 whitespace-nowrap tabular-nums">
                          C{ent.tier} · #{ent.order}
                        </td>
                        <td className="px-4 py-2.5">
                          <button
                            type="button"
                            onClick={() => setExpandedEntityKey(isExpanded ? null : ent.key)}
                            className="inline-flex items-center gap-1.5 font-semibold text-slate-900 hover:text-emerald-700 text-left"
                          >
                            {isExpanded ? (
                              <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            ) : (
                              <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            )}
                            <span>{ent.label}</span>
                          </button>
                          <div className="pl-5 font-mono text-[11px] text-slate-500">
                            Aba: {ent.sheetName} · {ent.columns.length} coluna(s)
                          </div>
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="font-mono text-[11px] text-slate-800">{ent.naturalKeyDescription}</div>
                          {ent.autoCodeField && (
                            <div className="font-mono text-[11px] text-emerald-700">
                              Auto-código: {ent.autoCodePrefix}-xxxx (se vazio)
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-[11px] text-slate-500">
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
                              className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 font-semibold text-slate-700 hover:bg-slate-50"
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
                              className="inline-flex items-center gap-1 rounded-md bg-slate-900 px-2.5 py-1.5 font-semibold text-white hover:bg-slate-800"
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
                              className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50 px-2.5 py-1.5 font-semibold text-emerald-800 hover:bg-emerald-100"
                            >
                              <Upload className="w-3 h-3" />
                              Importar
                            </button>
                          </div>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="bg-slate-50/80">
                          <td colSpan={5} className="px-6 py-3">
                            <div className="text-[11px] font-semibold text-slate-700 mb-2">
                              Dicionário de Colunas do Layout "{ent.sheetName}"
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                              {ent.columns.map((c) => (
                                <div
                                  key={c.key}
                                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 space-y-0.5"
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="font-mono font-bold text-slate-900">{c.header}</span>
                                    <span className="font-mono text-[10px] text-slate-500">
                                      {c.type}
                                      {c.required ? ' · Obrig.' : ''}
                                      {c.isUpsertKey ? ' · Upsert' : ''}
                                      {c.isAutoCode ? ' · Auto' : ''}
                                    </span>
                                  </div>
                                  <div className="text-[11px] text-slate-600">{c.description}</div>
                                  <div className="font-mono text-[10px] text-slate-400">Ex: {c.example}</div>
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
      <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 flex items-center gap-2.5 text-[11px] text-slate-600">
        <ShieldCheck className="w-4 h-4 text-emerald-700 shrink-0" />
        <span>
          Cada importação confirmada executa em transação única PostgreSQL com trilha em <span className="font-mono">audit_logs</span> e gera imediatamente o arquivo <span className="font-mono">retorno_importacao_*.xlsx</span> com todos os códigos gerados e chaves HMAC integrativas.
        </span>
      </div>

      {/* Collapsible Legacy CSV Utility */}
      {legacyCsvSection && (
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <button
            type="button"
            onClick={() => setShowLegacyCsv((v) => !v)}
            className="w-full px-4 py-3 flex items-center justify-between text-left font-semibold text-slate-700 hover:bg-slate-50"
          >
            <span className="flex items-center gap-2">
              {showLegacyCsv ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              Utilitário Legado de Carga &amp; Exportação Rápida CSV (Ponto-e-Vírgula)
            </span>
            <span className="text-[11px] font-normal text-slate-500">Compatibilidade Retroativa</span>
          </button>
          {showLegacyCsv && <div className="border-t border-slate-100 p-4 space-y-4">{legacyCsvSection}</div>}
        </div>
      )}
    </div>
  );
};
