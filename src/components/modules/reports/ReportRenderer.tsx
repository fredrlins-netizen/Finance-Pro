import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Code2,
  Download,
  FileSpreadsheet,
  FileText,
  Filter,
  Printer,
  RefreshCw,
  RotateCcw,
  X,
} from 'lucide-react';
import { apiFetch } from '../../../lib/api.ts';
import {
  ensurePortalBrandingLoaded,
  getCachedLogoNeedsDarkBackdrop,
  getCachedPortalBranding,
  setCachedPortalBranding,
  subscribePortalBranding,
} from '../../../lib/portalBrandingCache.ts';
import type {
  PortalBrandingConfig,
  ReportChartDef,
  ReportSubreportDef,
  ReportTemplateItem,
} from '../../../types.ts';
import {
  applyClientFilters,
  buildParameterizedQueryClient,
  computeNumericAggregate,
  computeSummaryRows,
  formatReportValue,
  normalizeLayoutConfig,
} from '../../../lib/reportCatalogs.ts';
import {
  exportReportToCsv,
  exportReportToExcel,
  exportReportToHtml,
  exportReportToPdf,
  exportReportToWord,
  formatGroupHeaderText,
  getVisibleColumns,
  groupReportRows,
  preparePrintHtmlDocument,
} from '../../../lib/reportExporters.ts';
import { ReportChartView } from './ReportChartView.tsx';

interface ReportRendererProps {
  template: ReportTemplateItem;
  isAdmin: boolean;
  isDirtyDraft?: boolean;
  branding?: PortalBrandingConfig | null;
  onRowsLoaded?: (rows: Array<Record<string, any>>, columns: string[]) => void;
  onNotify?: (msg: string) => void;
}

export const ReportRenderer: React.FC<ReportRendererProps> = ({
  template,
  isAdmin,
  isDirtyDraft = false,
  branding,
  onRowsLoaded,
  onNotify,
}) => {
  const [cachedBranding, setCachedBrandingState] = useState<PortalBrandingConfig | null>(() =>
    getCachedPortalBranding()
  );
  const [darkBackdrop, setDarkBackdrop] = useState<boolean>(() =>
    getCachedLogoNeedsDarkBackdrop()
  );

  useEffect(() => {
    if (branding) {
      setCachedPortalBranding(branding);
    } else {
      void ensurePortalBrandingLoaded();
    }
    return subscribePortalBranding((nextB, nextDark) => {
      setCachedBrandingState(nextB);
      setDarkBackdrop(nextDark);
    });
  }, [branding]);

  const activeBranding = branding || cachedBranding;
  const layout = useMemo(() => normalizeLayoutConfig(template.layout), [template.layout]);
  const customLogo = String(layout.header.logo || '').trim();
  const effectiveLogo = (customLogo || activeBranding?.logoDataUrl || '').trim();
  const useDarkBadgeForSheet = !customLogo && darkBackdrop;
  const [filterValues, setFilterValues] = useState<Record<string, string>>({});
  const [rows, setRows] = useState<Array<Record<string, any>>>([]);
  const [appliedFilterIds, setAppliedFilterIds] = useState<string[]>([]);
  const [subQueryRows, setSubQueryRows] = useState<Record<string, Array<Record<string, any>>>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [truncated, setTruncated] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(50);
  const [exporting, setExporting] = useState<string>('');
  const [printHtml, setPrintHtml] = useState<string | null>(null);

  const chartsRootRef = useRef<HTMLDivElement | null>(null);
  const printIframeRef = useRef<HTMLIFrameElement | null>(null);

  // Initialize filter defaults when template changes
  useEffect(() => {
    const defaults: Record<string, string> = {};
    for (const f of template.filters || []) {
      defaults[f.id] = f.defaultValue ?? '';
    }
    setFilterValues(defaults);
    setPage(1);
  }, [template.id, template.filters]);

  const executeReport = useCallback(
    async (activeFilters: Record<string, string>) => {
      if (!template.sql_query?.trim() && !template.id) return;
      setLoading(true);
      setError('');
      try {
        const useSavedId = Boolean(template.id) && !isDirtyDraft;
        const payload = useSavedId
          ? { templateId: template.id, filterValues: activeFilters }
          : {
              sql: template.sql_query,
              filters: template.filters || [],
              filterValues: activeFilters,
            };

        const res = await apiFetch<{
          rows: Array<Record<string, any>>;
          columns: string[];
          truncated: boolean;
          appliedFilterIds?: string[];
        }>('/api/reports/execute-query', {
          method: 'POST',
          body: JSON.stringify(payload),
        });

        const loadedRows = res.rows || [];
        const loadedCols =
          res.columns && res.columns.length > 0
            ? res.columns
            : loadedRows[0]
            ? Object.keys(loadedRows[0])
            : [];

        const clientApplied =
          res.appliedFilterIds ??
          buildParameterizedQueryClient(
            template.sql_query,
            template.filters || [],
            activeFilters
          ).appliedFilterIds;

        setRows(loadedRows);
        setAppliedFilterIds(clientApplied);
        setTruncated(Boolean(res.truncated));
        setPage(1);
        onRowsLoaded?.(loadedRows, loadedCols);

        // Execute query-type subreports
        const querySubs = (template.subreports || []).filter((s) => s.type === 'query');
        if (querySubs.length > 0) {
          const entries = await Promise.all(
            querySubs.map(async (sub) => {
              try {
                const subPayload = useSavedId
                  ? { templateId: template.id, subreportId: sub.id, filterValues: activeFilters }
                  : {
                      sql: sub.sql_query || '',
                      filters: template.filters || [],
                      filterValues: activeFilters,
                    };
                const subRes = await apiFetch<{ rows: Array<Record<string, any>> }>(
                  '/api/reports/execute-query',
                  {
                    method: 'POST',
                    body: JSON.stringify(subPayload),
                  }
                );
                return [sub.id, subRes.rows || []] as const;
              } catch {
                return [sub.id, []] as const;
              }
            })
          );
          setSubQueryRows(Object.fromEntries(entries));
        } else {
          setSubQueryRows({});
        }
      } catch (err: any) {
        setError(err?.message || 'Erro ao executar relatório.');
        setRows([]);
      } finally {
        setLoading(false);
      }
    },
    [template.id, template.sql_query, template.filters, template.subreports, isDirtyDraft, onRowsLoaded]
  );

  // Auto-run when template loads
  useEffect(() => {
    const defaults: Record<string, string> = {};
    for (const f of template.filters || []) {
      defaults[f.id] = f.defaultValue ?? '';
    }
    void executeReport(defaults);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template.id]);

  const filteredRows = useMemo(
    () => applyClientFilters(rows, template.filters || [], filterValues, appliedFilterIds),
    [rows, template.filters, filterValues, appliedFilterIds]
  );

  const visibleColumns = useMemo(
    () => getVisibleColumns(layout, filteredRows),
    [layout, filteredRows]
  );

  const totalPages = pageSize <= 0 ? 1 : Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pagedRows = useMemo(() => {
    if (pageSize <= 0) return filteredRows;
    const start = (safePage - 1) * pageSize;
    return filteredRows.slice(start, start + pageSize);
  }, [filteredRows, safePage, pageSize]);

  const groupedBlocks = useMemo(() => {
    const fields = layout.grouping?.fields || [];
    return groupReportRows(pagedRows, fields);
  }, [pagedRows, layout.grouping]);

  const resolvedSubreports = useMemo(() => {
    return (template.subreports || []).map((sub: ReportSubreportDef) => ({
      subreport: sub,
      rows:
        sub.type === 'summary'
          ? computeSummaryRows(filteredRows, sub)
          : subQueryRows[sub.id] || [],
    }));
  }, [template.subreports, filteredRows, subQueryRows]);

  const chartsBefore = (template.charts || []).filter((c) => c.position === 'before');
  const chartsBetween = (template.charts || []).filter((c) => c.position === 'between');
  const chartsAfter = (template.charts || []).filter(
    (c) => c.position !== 'before' && c.position !== 'between'
  );

  const renderChartsBlock = (chartsList: ReportChartDef[]) => {
    if (template.content_mode === 'data' || chartsList.length === 0) return null;
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 my-4">
        {chartsList.map((chart) => (
          <div key={chart.id} className={chart.width === '50%' ? 'col-span-1' : 'md:col-span-2'}>
            <ReportChartView chart={chart} rows={filteredRows} height={270} />
          </div>
        ))}
      </div>
    );
  };

  const runExport = async (kind: 'print' | 'pdf' | 'excel' | 'word' | 'csv' | 'html') => {
    setExporting(kind);
    try {
      const exportParams = {
        template,
        rows: filteredRows,
        subreportsData: resolvedSubreports,
        chartsContainer: chartsRootRef.current,
        companyLogoDataUrl: activeBranding?.logoDataUrl,
        companyName: activeBranding?.companyName,
        logoDarkBackdrop: useDarkBadgeForSheet,
      };
      if (kind === 'pdf') {
        await exportReportToPdf(exportParams);
        onNotify?.('PDF gerado com sucesso.');
      } else if (kind === 'excel') {
        exportReportToExcel(exportParams);
        onNotify?.('Arquivo Excel (.xlsx) gerado com sucesso.');
      } else if (kind === 'csv') {
        exportReportToCsv(exportParams);
        onNotify?.('Arquivo CSV gerado com sucesso.');
      } else if (kind === 'word') {
        await exportReportToWord(exportParams);
        onNotify?.('Documento Word (.doc) gerado com sucesso.');
      } else if (kind === 'html') {
        await exportReportToHtml(exportParams);
        onNotify?.('Arquivo HTML standalone gerado com sucesso.');
      } else if (kind === 'print') {
        const html = await preparePrintHtmlDocument(exportParams);
        setPrintHtml(html);
      }
    } catch (err: any) {
      setError(err?.message || 'Erro ao exportar relatório.');
    } finally {
      setExporting('');
    }
  };

  const sheetWidthClass =
    template.target_layout === 'mobile'
      ? 'max-w-[430px] mx-auto'
      : layout.general.orientation === 'landscape'
      ? 'max-w-[1120px] mx-auto'
      : 'max-w-[860px] mx-auto';

  const groupingFields = layout.grouping?.fields || [];

  return (
    <div className="space-y-4">
      {/* Toolbar & Export Actions */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={loading}
            onClick={() => void executeReport(filterValues)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Atualizar Dados
          </button>
          <span className="text-xs text-slate-500 tabular-nums">
            {filteredRows.length} registro(s)
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            disabled={!!exporting}
            onClick={() => void runExport('print')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <Printer className="w-3.5 h-3.5 text-slate-600" />
            Imprimir
          </button>
          <button
            type="button"
            disabled={!!exporting}
            onClick={() => void runExport('pdf')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" />
            PDF
          </button>
          <button
            type="button"
            disabled={!!exporting}
            onClick={() => void runExport('excel')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            Excel
          </button>
          <button
            type="button"
            disabled={!!exporting}
            onClick={() => void runExport('word')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-50"
          >
            <FileText className="w-3.5 h-3.5" />
            Word
          </button>
          <button
            type="button"
            disabled={!!exporting}
            onClick={() => void runExport('csv')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            CSV
          </button>
          <button
            type="button"
            disabled={!!exporting}
            onClick={() => void runExport('html')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <Code2 className="w-3.5 h-3.5" />
            HTML
          </button>
        </div>
      </div>

      {/* Filters Bar */}
      {(template.filters || []).length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-3.5 space-y-3">
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-700">
              <Filter className="w-3.5 h-3.5 text-blue-600" />
              Filtros do Relatório
            </span>
            <button
              type="button"
              onClick={() => {
                const cleared: Record<string, string> = {};
                for (const f of template.filters || []) cleared[f.id] = '';
                setFilterValues(cleared);
                void executeReport(cleared);
              }}
              className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-900"
            >
              <RotateCcw className="w-3 h-3" />
              Limpar Filtros
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {template.filters.map((f) => (
              <div key={f.id}>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  {f.label || f.placeholder}
                </label>
                {f.type === 'select' ? (
                  <select
                    value={filterValues[f.id] ?? ''}
                    onChange={(e) =>
                      setFilterValues((prev) => ({ ...prev, [f.id]: e.target.value }))
                    }
                    className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
                  >
                    <option value="">Todos</option>
                    {(f.options || []).map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type={f.type === 'date' ? 'date' : f.type === 'number' ? 'number' : 'text'}
                    value={filterValues[f.id] ?? ''}
                    onChange={(e) =>
                      setFilterValues((prev) => ({ ...prev, [f.id]: e.target.value }))
                    }
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void executeReport(filterValues);
                    }}
                    placeholder={`Filtrar ${f.label || f.placeholder}...`}
                    className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs"
                  />
                )}
              </div>
            ))}
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              disabled={loading}
              onClick={() => void executeReport(filterValues)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              Aplicar Filtros
            </button>
          </div>
        </div>
      )}

      {/* Alerts */}
      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3.5 text-xs text-red-700">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <div className="font-bold">Falha na execução do relatório</div>
            <div className="mt-0.5">{error}</div>
          </div>
        </div>
      )}

      {truncated && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800">
          Aviso: A consulta retornou mais de 500 registros e foi limitada por segurança aos primeiros 500 resultados. Refine os filtros para visualizar um recorte específico.
        </div>
      )}

      {isDirtyDraft && isAdmin && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-2 text-xs text-blue-800">
          Visualizando rascunho não salvo. Clique em <strong>Salvar</strong> para persistir alterações e atualizar o acesso de usuários.
        </div>
      )}

      {/* Report Sheet */}
      <div
        ref={chartsRootRef}
        className={`${sheetWidthClass} rounded-xl border border-slate-200 bg-white shadow-sm p-6 md:p-8 transition-all`}
        style={{
          fontFamily: layout.general.fontFamily || 'Arial',
          fontSize: `${Math.max(10, Math.min(16, Number(layout.general.fontSize || 12)))}px`,
        }}
      >
        {/* Header */}
        {layout.header.show && (
          <header
            className="border-b border-slate-200 pb-4 mb-5"
            style={{ textAlign: layout.header.alignment || 'left' }}
          >
            {layout.header.showLogo !== false && effectiveLogo && (
              <div className="flex justify-center mb-3">
                <div
                  className={`inline-flex items-center justify-center rounded-xl ${
                    useDarkBadgeForSheet ? 'bg-slate-900 px-3.5 py-1.5' : ''
                  }`}
                >
                  <img
                    src={effectiveLogo}
                    alt={activeBranding?.companyName || 'Logomarca da Empresa'}
                    className="max-h-14 max-w-[200px] w-auto object-contain"
                  />
                </div>
              </div>
            )}
            <h2 className="text-lg font-bold text-slate-900">
              {layout.header.title || template.name || 'Relatório Geral'}
            </h2>
            {layout.header.subtitle && (
              <p className="text-xs text-slate-500 mt-0.5">{layout.header.subtitle}</p>
            )}
            {layout.header.showDate && (
              <p className="text-[11px] text-slate-400 mt-1">
                Gerado em {new Date().toLocaleString('pt-BR')} · {filteredRows.length} registro(s)
              </p>
            )}
          </header>
        )}

        {/* Charts BEFORE */}
        {renderChartsBlock(chartsBefore)}

        {/* Main Data Table */}
        {template.content_mode !== 'charts' && (
          <>
            {loading ? (
              <div className="py-12 text-center text-xs text-slate-500">
                Executando consulta no PostgreSQL...
              </div>
            ) : filteredRows.length === 0 ? (
              <div className="py-12 text-center text-xs text-slate-500">
                Nenhum registro encontrado para os filtros selecionados.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full text-left border-collapse tabular-nums">
                  <thead className="bg-slate-900 text-white text-[11px] uppercase tracking-wider">
                    <tr>
                      {visibleColumns.map((col) => (
                        <th
                          key={col.field}
                          style={{
                            textAlign: col.align || 'left',
                            width: col.width && col.width !== 'auto' ? col.width : undefined,
                          }}
                          className="px-3 py-2.5 font-semibold whitespace-nowrap border-r border-slate-700/60 last:border-r-0"
                        >
                          {col.label || col.field}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {groupedBlocks.map((grp, gIdx) => (
                      <React.Fragment key={gIdx}>
                        {groupingFields.length > 0 && (
                          <tr className="bg-slate-100 font-bold text-slate-900">
                            <td colSpan={visibleColumns.length} className="px-3 py-2">
                              {formatGroupHeaderText(
                                layout.grouping?.headerTemplate || '',
                                grp.groupKey,
                                groupingFields,
                                grp.rows[0] || {}
                              )}{' '}
                              <span className="font-normal text-slate-500">
                                ({grp.rows.length} registro{grp.rows.length === 1 ? '' : 's'})
                              </span>
                            </td>
                          </tr>
                        )}

                        {grp.rows.map((row, rIdx) => (
                          <tr
                            key={rIdx}
                            className={
                              layout.general.zebra && rIdx % 2 === 1
                                ? 'bg-slate-50/70 hover:bg-blue-50/30'
                                : 'bg-white hover:bg-blue-50/30'
                            }
                          >
                            {visibleColumns.map((col) => (
                              <td
                                key={col.field}
                                style={{ textAlign: col.align || 'left' }}
                                className="px-3 py-2 text-slate-700"
                              >
                                {formatReportValue(row[col.field], col.format)}
                              </td>
                            ))}
                          </tr>
                        ))}

                        {groupingFields.length > 0 && layout.grouping?.showSubtotals && (
                          <tr className="bg-slate-50 font-bold text-slate-900 border-t border-slate-300">
                            {visibleColumns.map((col, cIdx) => {
                              const tot = (layout.grouping?.totalizers || []).find(
                                (t) => t.field === col.field && t.operation !== 'nenhum'
                              );
                              let txt = '';
                              if (tot) {
                                const val = computeNumericAggregate(grp.rows, col.field, tot.operation);
                                txt =
                                  tot.operation === 'contagem'
                                    ? `${val.toLocaleString('pt-BR')} reg.`
                                    : formatReportValue(val, col.format);
                              } else if (cIdx === 0) {
                                txt = 'Subtotal';
                              }
                              return (
                                <td
                                  key={col.field}
                                  style={{ textAlign: col.align || 'left' }}
                                  className="px-3 py-2"
                                >
                                  {txt}
                                </td>
                              );
                            })}
                          </tr>
                        )}
                      </React.Fragment>
                    ))}
                  </tbody>
                  {layout.footer.showTotals &&
                    (layout.footer.totalizers || []).some((t) => t.operation !== 'nenhum') && (
                      <tfoot className="bg-slate-100 border-t-2 border-slate-300 font-bold text-xs text-slate-900">
                        <tr>
                          {visibleColumns.map((col, cIdx) => {
                            const tot = (layout.footer.totalizers || []).find(
                              (t) => t.field === col.field && t.operation !== 'nenhum'
                            );
                            let txt = '';
                            if (tot) {
                              const val = computeNumericAggregate(filteredRows, col.field, tot.operation);
                              txt =
                                tot.operation === 'contagem'
                                  ? `${val.toLocaleString('pt-BR')} reg.`
                                  : formatReportValue(val, col.format);
                            } else if (cIdx === 0) {
                              txt = `Total Geral (${filteredRows.length})`;
                            }
                            return (
                              <td
                                key={col.field}
                                style={{ textAlign: col.align || 'left' }}
                                className="px-3 py-2.5"
                              >
                                {txt}
                              </td>
                            );
                          })}
                        </tr>
                      </tfoot>
                    )}
                </table>
              </div>
            )}
          </>
        )}

        {/* Charts BETWEEN */}
        {renderChartsBlock(chartsBetween)}

        {/* Subreports */}
        {resolvedSubreports.map(({ subreport, rows: subRows }) => {
          const subCols =
            subreport.columns && subreport.columns.length > 0
              ? subreport.columns
              : subRows[0]
              ? Object.keys(subRows[0]).map((f) => ({
                  field: f,
                  label: f,
                  width: 140,
                  format: '' as const,
                  align: 'left' as const,
                }))
              : [];
          if (subCols.length === 0) return null;

          return (
            <section key={subreport.id} className="mt-6 space-y-2">
              <h4 className="text-xs font-bold uppercase tracking-wide text-slate-800">
                {subreport.title || 'Sub-relatório'}
              </h4>
              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full text-left border-collapse text-xs tabular-nums">
                  <thead className="bg-slate-700 text-white text-[11px]">
                    <tr>
                      {subCols.map((sc) => (
                        <th key={sc.field} style={{ textAlign: sc.align }} className="px-3 py-2 font-semibold">
                          {sc.label || sc.field}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {subRows.length === 0 ? (
                      <tr>
                        <td colSpan={subCols.length} className="px-3 py-4 text-center text-slate-400">
                          Sem dados no sub-relatório.
                        </td>
                      </tr>
                    ) : (
                      subRows.map((sr, rIdx) => (
                        <tr key={rIdx} className={rIdx % 2 === 1 ? 'bg-slate-50/70' : ''}>
                          {subCols.map((sc) => (
                            <td key={sc.field} style={{ textAlign: sc.align }} className="px-3 py-1.5 text-slate-700">
                              {formatReportValue(sr[sc.field], sc.format || 'text')}
                            </td>
                          ))}
                        </tr>
                      ))
                    )}
                  </tbody>
                  {subreport.totalizers.some((t) => t.operation !== 'none') && (
                    <tfoot className="bg-slate-100 border-t border-slate-300 font-bold">
                      <tr>
                        {subCols.map((sc, cIdx) => {
                          const tot = subreport.totalizers.find(
                            (t) => t.field === sc.field && t.operation !== 'none'
                          );
                          const val = tot
                            ? tot.operation === 'count'
                              ? String(computeNumericAggregate(subRows, sc.field, tot.operation))
                              : formatReportValue(
                                  computeNumericAggregate(subRows, sc.field, tot.operation),
                                  sc.format || 'number'
                                )
                            : cIdx === 0
                            ? 'Total'
                            : '';
                          return (
                            <td key={sc.field} style={{ textAlign: sc.align }} className="px-3 py-2 text-slate-900">
                              {val}
                            </td>
                          );
                        })}
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </section>
          );
        })}

        {/* Charts AFTER */}
        {renderChartsBlock(chartsAfter)}

        {/* Footer */}
        {layout.footer.show && (
          <footer className="mt-6 pt-3 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
            <span>
              {[
                layout.footer.customText,
                layout.footer.showDateTime ? `Emitido em ${new Date().toLocaleString('pt-BR')}` : '',
              ]
                .filter(Boolean)
                .join(' · ') || 'FinancePro Assessoria'}
            </span>
            {layout.footer.showPageNumbers && (
              <span>
                Página {safePage} de {totalPages}
              </span>
            )}
          </footer>
        )}
      </div>

      {/* Pagination Footer */}
      {filteredRows.length > 0 && template.content_mode !== 'charts' && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs">
          <div className="flex items-center gap-2 text-slate-600">
            <span>Exibir:</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
              className="rounded border border-slate-200 px-2 py-1 text-xs"
            >
              <option value={25}>25 linhas</option>
              <option value={50}>50 linhas</option>
              <option value={100}>100 linhas</option>
              <option value={0}>Todas ({filteredRows.length})</option>
            </select>
          </div>
          <div className="flex items-center gap-2 tabular-nums">
            <button
              type="button"
              disabled={safePage <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="inline-flex items-center gap-1 rounded border border-slate-200 px-2.5 py-1 text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              Anterior
            </button>
            <span className="text-slate-600">
              Página <strong>{safePage}</strong> de <strong>{totalPages}</strong>
            </span>
            <button
              type="button"
              disabled={safePage >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="inline-flex items-center gap-1 rounded border border-slate-200 px-2.5 py-1 text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >
              Próxima
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Inline A4 Print Preview Modal (Popup-free for iFrame compatibility) */}
      {printHtml && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4"
          onClick={() => setPrintHtml(null)}
        >
          <div
            className="w-full max-w-5xl h-[88vh] rounded-xl border border-slate-200 bg-white shadow-2xl flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900">Visualização de Impressão</h3>
                <p className="text-xs text-slate-500">
                  Confira a diagramação antes de imprimir ou baixe o HTML standalone.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => printIframeRef.current?.contentWindow?.print()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
                >
                  <Printer className="w-3.5 h-3.5" />
                  Imprimir Agora
                </button>
                <button
                  type="button"
                  onClick={() => void runExport('html')}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <Download className="w-3.5 h-3.5" />
                  Baixar HTML
                </button>
                <button
                  type="button"
                  onClick={() => setPrintHtml(null)}
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <iframe
              ref={printIframeRef}
              title="Visualização de Impressão"
              srcDoc={printHtml}
              className="flex-1 w-full border-0 bg-slate-100"
            />
          </div>
        </div>
      )}
    </div>
  );
};
