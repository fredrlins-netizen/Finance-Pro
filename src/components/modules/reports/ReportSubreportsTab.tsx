import React, { useMemo, useState } from 'react';
import { AlertCircle, Layers, Play, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { apiFetch } from '../../../lib/api.ts';
import type { ReportSubreportDef } from '../../../types.ts';
import {
  computeNumericAggregate,
  computeSummaryRows,
  createEmptySubreport,
  formatReportValue,
  SUBREPORT_FORMAT_OPTIONS,
  SUBREPORT_OPERATION_OPTIONS,
} from '../../../lib/reportCatalogs.ts';

interface ReportSubreportsTabProps {
  subreports: ReportSubreportDef[];
  availableColumns: string[];
  previewRows: Array<Record<string, any>>;
  onChangeSubreports: (subs: ReportSubreportDef[]) => void;
}

export const ReportSubreportsTab: React.FC<ReportSubreportsTabProps> = ({
  subreports,
  availableColumns,
  previewRows,
  onChangeSubreports,
}) => {
  const [selectedId, setSelectedId] = useState<string>(() => subreports[0]?.id || '');
  const [queryPreviewBySub, setQueryPreviewBySub] = useState<Record<string, Array<Record<string, any>>>>({});
  const [testingSubId, setTestingSubId] = useState<string | null>(null);
  const [subError, setSubError] = useState('');

  const activeSub = useMemo(
    () => subreports.find((s) => s.id === selectedId) || subreports[0] || null,
    [subreports, selectedId]
  );

  const addSubreport = () => {
    const next = createEmptySubreport();
    next.title = `Resumo ${subreports.length + 1}`;
    if (availableColumns[0]) {
      next.summary_config = {
        groupField: availableColumns[0],
        operations: [],
      };
      next.columns = [
        { field: availableColumns[0], label: availableColumns[0], width: 160, format: 'text', align: 'left' },
      ];
    }
    onChangeSubreports([...subreports, next]);
    setSelectedId(next.id);
  };

  const updateSub = (id: string, patch: Partial<ReportSubreportDef>) => {
    onChangeSubreports(subreports.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };

  const removeSub = (id: string) => {
    const remaining = subreports.filter((s) => s.id !== id);
    onChangeSubreports(remaining);
    if (selectedId === id) setSelectedId(remaining[0]?.id || '');
  };

  const testSubreportQuery = async (sub: ReportSubreportDef) => {
    if (!sub.sql_query?.trim()) {
      setSubError('Informe a consulta SQL SELECT do sub-relatório.');
      return;
    }
    setTestingSubId(sub.id);
    setSubError('');
    try {
      const res = await apiFetch<{ rows: Array<Record<string, any>>; columns: string[] }>(
        '/api/reports/preview-query',
        {
          method: 'POST',
          body: JSON.stringify({ sql: sub.sql_query, limit: 50 }),
        }
      );
      const rows = res.rows || [];
      setQueryPreviewBySub((prev) => ({ ...prev, [sub.id]: rows }));
      if (sub.columns.length === 0 && res.columns?.length) {
        updateSub(sub.id, {
          columns: res.columns.map((c) => ({
            field: c,
            label: c,
            width: 140,
            format: '',
            align: 'left',
          })),
        });
      }
    } catch (err: any) {
      setSubError(err?.message || 'Erro ao testar SQL do sub-relatório.');
    } finally {
      setTestingSubId(null);
    }
  };

  const activePreviewRows = useMemo(() => {
    if (!activeSub) return [];
    if (activeSub.type === 'summary') {
      return computeSummaryRows(previewRows, activeSub);
    }
    return queryPreviewBySub[activeSub.id] || [];
  }, [activeSub, previewRows, queryPreviewBySub]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
      {/* List */}
      <div className="lg:col-span-4 rounded-xl border border-slate-200 bg-white p-3.5 space-y-3">
        <div className="flex items-center justify-between border-b border-slate-100 pb-2">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-blue-600" />
            <h4 className="text-xs font-bold uppercase tracking-wide text-slate-800">
              Sub-relatórios ({subreports.length})
            </h4>
          </div>
          <button
            type="button"
            onClick={addSubreport}
            className="inline-flex items-center gap-1 rounded-md bg-slate-900 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-slate-800"
          >
            <Plus className="w-3.5 h-3.5" />
            Adicionar
          </button>
        </div>

        {subreports.length === 0 ? (
          <p className="text-xs text-slate-500 py-4 text-center">
            Adicione tabelas de resumo agrupado ou consultas SQL auxiliares ao final do relatório.
          </p>
        ) : (
          <div className="space-y-1.5">
            {subreports.map((s, idx) => (
              <div
                key={s.id}
                onClick={() => setSelectedId(s.id)}
                className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 cursor-pointer ${
                  activeSub?.id === s.id
                    ? 'border-blue-500 bg-blue-50/50 text-slate-900'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                <div className="min-w-0">
                  <div className="text-xs font-semibold truncate">{s.title || `Sub-relatório ${idx + 1}`}</div>
                  <div className="text-[11px] text-slate-500">
                    {s.type === 'summary' ? 'Resumo dos Dados Principais' : 'Consulta SQL Independente'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeSub(s.id);
                  }}
                  className="p-1 text-slate-400 hover:text-red-600"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Config */}
      <div className="lg:col-span-8 space-y-4">
        {!activeSub ? (
          <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-xs text-slate-500">
            Selecione ou crie um sub-relatório à esquerda.
          </div>
        ) : (
          <>
            <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    Título do Sub-relatório
                  </label>
                  <input
                    type="text"
                    value={activeSub.title}
                    onChange={(e) => updateSub(activeSub.id, { title: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">Origem</label>
                  <select
                    value={activeSub.type}
                    onChange={(e) => updateSub(activeSub.id, { type: e.target.value as any })}
                    className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs"
                  >
                    <option value="summary">Resumo Agrupado (sobre dados principais)</option>
                    <option value="query">Consulta SQL Própria</option>
                  </select>
                </div>
              </div>

              {activeSub.type === 'summary' ? (
                <div className="space-y-3 border-t border-slate-100 pt-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      Agrupar por Campo
                    </label>
                    <select
                      value={activeSub.summary_config?.groupField || ''}
                      onChange={(e) =>
                        updateSub(activeSub.id, {
                          summary_config: {
                            groupField: e.target.value,
                            operations: activeSub.summary_config?.operations || [],
                          },
                        })
                      }
                      className="w-full md:w-72 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-mono"
                    >
                      <option value="">Selecione...</option>
                      {availableColumns.map((col) => (
                        <option key={col} value={col}>
                          {col}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold uppercase tracking-wide text-slate-700">
                        Operações Agregadas
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          const currOps = activeSub.summary_config?.operations || [];
                          const f = availableColumns[1] || availableColumns[0] || '';
                          updateSub(activeSub.id, {
                            summary_config: {
                              groupField: activeSub.summary_config?.groupField || availableColumns[0] || '',
                              operations: [...currOps, { field: f, label: f, operation: 'sum', format: 'number' }],
                            },
                          });
                        }}
                        className="inline-flex items-center gap-1 rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
                      >
                        <Plus className="w-3 h-3" />
                        Operação
                      </button>
                    </div>

                    {(activeSub.summary_config?.operations || []).map((op, opIdx) => (
                      <div key={opIdx} className="grid grid-cols-1 md:grid-cols-12 gap-1.5 items-center">
                        <select
                          value={op.field}
                          onChange={(e) => {
                            const ops = (activeSub.summary_config?.operations || []).map((o, i) =>
                              i === opIdx ? { ...o, field: e.target.value } : o
                            );
                            updateSub(activeSub.id, {
                              summary_config: { ...activeSub.summary_config!, operations: ops },
                            });
                          }}
                          className="md:col-span-4 rounded border border-slate-200 px-2 py-1 text-xs font-mono"
                        >
                          <option value="">Campo...</option>
                          {availableColumns.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                        <input
                          type="text"
                          value={op.label || ''}
                          onChange={(e) => {
                            const ops = (activeSub.summary_config?.operations || []).map((o, i) =>
                              i === opIdx ? { ...o, label: e.target.value } : o
                            );
                            updateSub(activeSub.id, {
                              summary_config: { ...activeSub.summary_config!, operations: ops },
                            });
                          }}
                          placeholder="Rótulo"
                          className="md:col-span-4 rounded border border-slate-200 px-2 py-1 text-xs"
                        />
                        <select
                          value={op.operation}
                          onChange={(e) => {
                            const ops = (activeSub.summary_config?.operations || []).map((o, i) =>
                              i === opIdx ? { ...o, operation: e.target.value as any } : o
                            );
                            updateSub(activeSub.id, {
                              summary_config: { ...activeSub.summary_config!, operations: ops },
                            });
                          }}
                          className="md:col-span-3 rounded border border-slate-200 px-2 py-1 text-xs"
                        >
                          {SUBREPORT_OPERATION_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => {
                            const ops = (activeSub.summary_config?.operations || []).filter((_, i) => i !== opIdx);
                            updateSub(activeSub.id, {
                              summary_config: { ...activeSub.summary_config!, operations: ops },
                            });
                          }}
                          className="md:col-span-1 p-1 text-slate-400 hover:text-red-600"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="space-y-2 border-t border-slate-100 pt-3">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] font-semibold text-slate-600">
                      SQL SELECT do Sub-relatório
                    </label>
                    <button
                      type="button"
                      disabled={testingSubId === activeSub.id}
                      onClick={() => void testSubreportQuery(activeSub)}
                      className="inline-flex items-center gap-1 rounded-md bg-slate-900 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                    >
                      {testingSubId === activeSub.id ? (
                        <RefreshCw className="w-3 h-3 animate-spin" />
                      ) : (
                        <Play className="w-3 h-3" />
                      )}
                      Testar SQL
                    </button>
                  </div>
                  <textarea
                    rows={5}
                    value={activeSub.sql_query || ''}
                    onChange={(e) => updateSub(activeSub.id, { sql_query: e.target.value })}
                    placeholder="SELECT status, COUNT(*) AS total FROM ..."
                    className="w-full rounded-lg border border-slate-300 bg-slate-950 p-2.5 font-mono text-xs text-emerald-300"
                  />
                  {subError && (
                    <div className="flex items-center gap-1.5 text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2.5 py-1.5">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      {subError}
                    </div>
                  )}
                </div>
              )}

              {/* Columns configuration */}
              <div className="border-t border-slate-100 pt-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wide text-slate-700">
                    Colunas Exibidas no Sub-relatório
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      updateSub(activeSub.id, {
                        columns: [
                          ...activeSub.columns,
                          { field: '', label: '', width: 140, format: '', align: 'left' },
                        ],
                      })
                    }
                    className="inline-flex items-center gap-1 rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    <Plus className="w-3 h-3" />
                    Coluna
                  </button>
                </div>

                {activeSub.columns.map((sc, cIdx) => {
                  const totOp =
                    activeSub.totalizers.find((t) => t.field === sc.field)?.operation || 'none';
                  return (
                    <div key={cIdx} className="grid grid-cols-1 md:grid-cols-12 gap-1.5 items-center">
                      <input
                        type="text"
                        value={sc.field}
                        onChange={(e) => {
                          const cols = activeSub.columns.map((item, i) =>
                            i === cIdx ? { ...item, field: e.target.value } : item
                          );
                          updateSub(activeSub.id, { columns: cols });
                        }}
                        placeholder="Campo (ex: status ou total_sum)"
                        className="md:col-span-3 rounded border border-slate-200 px-2 py-1 text-xs font-mono"
                      />
                      <input
                        type="text"
                        value={sc.label}
                        onChange={(e) => {
                          const cols = activeSub.columns.map((item, i) =>
                            i === cIdx ? { ...item, label: e.target.value } : item
                          );
                          updateSub(activeSub.id, { columns: cols });
                        }}
                        placeholder="Rótulo"
                        className="md:col-span-3 rounded border border-slate-200 px-2 py-1 text-xs"
                      />
                      <select
                        value={sc.format}
                        onChange={(e) => {
                          const cols = activeSub.columns.map((item, i) =>
                            i === cIdx ? { ...item, format: e.target.value as any } : item
                          );
                          updateSub(activeSub.id, { columns: cols });
                        }}
                        className="md:col-span-2 rounded border border-slate-200 px-1.5 py-1 text-xs"
                      >
                        {SUBREPORT_FORMAT_OPTIONS.map((f) => (
                          <option key={f.value} value={f.value}>
                            {f.label}
                          </option>
                        ))}
                      </select>
                      <select
                        value={sc.align}
                        onChange={(e) => {
                          const cols = activeSub.columns.map((item, i) =>
                            i === cIdx ? { ...item, align: e.target.value as any } : item
                          );
                          updateSub(activeSub.id, { columns: cols });
                        }}
                        className="md:col-span-1 rounded border border-slate-200 px-1 py-1 text-xs"
                      >
                        <option value="left">Esq</option>
                        <option value="center">Cen</option>
                        <option value="right">Dir</option>
                      </select>
                      <select
                        value={totOp}
                        onChange={(e) => {
                          const val = e.target.value as any;
                          const rest = activeSub.totalizers.filter((t) => t.field !== sc.field);
                          updateSub(activeSub.id, {
                            totalizers: val === 'none' ? rest : [...rest, { field: sc.field, operation: val }],
                          });
                        }}
                        className="md:col-span-2 rounded border border-slate-200 px-1.5 py-1 text-xs"
                        title="Totalizador da Coluna"
                      >
                        {SUBREPORT_OPERATION_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            Tot: {o.label}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() =>
                          updateSub(activeSub.id, {
                            columns: activeSub.columns.filter((_, i) => i !== cIdx),
                          })
                        }
                        className="md:col-span-1 p-1 text-slate-400 hover:text-red-600"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Live Preview */}
            <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
              <div className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs font-bold text-slate-800">
                Preview do Sub-relatório ({activePreviewRows.length} linha(s))
              </div>
              {activePreviewRows.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-500">
                  {activeSub.type === 'summary'
                    ? 'Execute o preview principal na aba Fonte de Dados e selecione o campo de agrupamento para ver o resumo calculado.'
                    : 'Clique em Testar SQL acima para visualizar o resultado deste sub-relatório.'}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs tabular-nums">
                    <thead className="bg-slate-100 text-slate-700 border-b border-slate-200">
                      <tr>
                        {(activeSub.columns.length > 0
                          ? activeSub.columns
                          : Object.keys(activePreviewRows[0]).map((f) => ({
                              field: f,
                              label: f,
                              format: '' as const,
                              align: 'left' as const,
                            }))
                        ).map((col) => (
                          <th key={col.field} style={{ textAlign: col.align }} className="px-3 py-2 font-semibold">
                            {col.label || col.field}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {activePreviewRows.slice(0, 20).map((row, idx) => (
                        <tr key={idx}>
                          {(activeSub.columns.length > 0
                            ? activeSub.columns
                            : Object.keys(activePreviewRows[0]).map((f) => ({
                                field: f,
                                label: f,
                                format: '' as const,
                                align: 'left' as const,
                              }))
                          ).map((col) => (
                            <td key={col.field} style={{ textAlign: col.align }} className="px-3 py-1.5 text-slate-700">
                              {formatReportValue(row[col.field], col.format || 'text')}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                    {activeSub.totalizers.some((t) => t.operation !== 'none') && (
                      <tfoot className="bg-slate-50 border-t border-slate-200 font-bold">
                        <tr>
                          {(activeSub.columns.length > 0
                            ? activeSub.columns
                            : Object.keys(activePreviewRows[0]).map((f) => ({
                                field: f,
                                label: f,
                                format: '' as const,
                                align: 'left' as const,
                              }))
                          ).map((col, cIdx) => {
                            const tot = activeSub.totalizers.find(
                              (t) => t.field === col.field && t.operation !== 'none'
                            );
                            const v = tot
                              ? tot.operation === 'count'
                                ? String(computeNumericAggregate(activePreviewRows, col.field, tot.operation))
                                : formatReportValue(
                                    computeNumericAggregate(activePreviewRows, col.field, tot.operation),
                                    col.format || 'number'
                                  )
                              : cIdx === 0
                              ? 'Total'
                              : '';
                            return (
                              <td key={col.field} style={{ textAlign: col.align }} className="px-3 py-2 text-slate-900">
                                {v}
                              </td>
                            );
                          })}
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
