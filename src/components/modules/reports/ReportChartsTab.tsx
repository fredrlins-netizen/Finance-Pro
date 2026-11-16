import React, { useMemo, useState } from 'react';
import { BarChart3, Plus, Trash2 } from 'lucide-react';
import type { ReportChartDef, ReportChartSeriesDef } from '../../../types.ts';
import {
  CHART_SUBTYPES,
  CHART_TYPES,
  COLOR_PALETTES,
  createEmptyChart,
  Y_OPERATIONS,
} from '../../../lib/reportCatalogs.ts';
import { ReportChartView } from './ReportChartView.tsx';

interface ReportChartsTabProps {
  charts: ReportChartDef[];
  availableColumns: string[];
  previewRows: Array<Record<string, any>>;
  onChangeCharts: (charts: ReportChartDef[]) => void;
}

export const ReportChartsTab: React.FC<ReportChartsTabProps> = ({
  charts,
  availableColumns,
  previewRows,
  onChangeCharts,
}) => {
  const [selectedId, setSelectedId] = useState<string>(() => charts[0]?.id || '');

  const activeChart = useMemo(
    () => charts.find((c) => c.id === selectedId) || charts[0] || null,
    [charts, selectedId]
  );

  const addChart = () => {
    const next = createEmptyChart();
    next.title = `Gráfico ${charts.length + 1}`;
    if (availableColumns[0]) next.xField = availableColumns[0];
    if (availableColumns[1] || availableColumns[0]) {
      next.yFields = [
        {
          field: availableColumns[1] || availableColumns[0],
          label: availableColumns[1] || availableColumns[0],
          operation: 'contagem',
          color: COLOR_PALETTES.padrao[0],
          seriesType: 'bar',
          secondaryAxis: false,
        },
      ];
    }
    onChangeCharts([...charts, next]);
    setSelectedId(next.id);
  };

  const updateChart = (id: string, patch: Partial<ReportChartDef>) => {
    onChangeCharts(charts.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  };

  const removeChart = (id: string) => {
    const remaining = charts.filter((c) => c.id !== id);
    onChangeCharts(remaining);
    if (selectedId === id) {
      setSelectedId(remaining[0]?.id || '');
    }
  };

  const samplePreviewRows = useMemo(() => {
    if (previewRows.length > 0 || !activeChart?.xField || activeChart.yFields.length === 0) {
      return [];
    }
    return ['Categoria A', 'Categoria B', 'Categoria C', 'Categoria D'].map((cat, idx) => {
      const row: Record<string, any> = { [activeChart.xField]: cat };
      activeChart.yFields.forEach((y, yIdx) => {
        row[y.field] = (idx + 1) * (yIdx + 2) * 150;
      });
      return row;
    });
  }, [previewRows.length, activeChart]);

  const effectivePreviewRows = previewRows.length > 0 ? previewRows : samplePreviewRows;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
      {/* Left list */}
      <div className="lg:col-span-4 rounded-xl border border-slate-200 bg-white p-3.5 space-y-3">
        <div className="flex items-center justify-between border-b border-slate-100 pb-2">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-blue-600" />
            <h4 className="text-xs font-bold uppercase tracking-wide text-slate-800">
              Gráficos ({charts.length})
            </h4>
          </div>
          <button
            type="button"
            onClick={addChart}
            className="inline-flex items-center gap-1 rounded-md bg-slate-900 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-slate-800"
          >
            <Plus className="w-3.5 h-3.5" />
            Adicionar
          </button>
        </div>

        {charts.length === 0 ? (
          <p className="text-xs text-slate-500 py-4 text-center">
            Nenhum gráfico configurado. Clique em <strong>Adicionar</strong> para criar visualizações.
          </p>
        ) : (
          <div className="space-y-1.5">
            {charts.map((c, idx) => {
              const isSelected = activeChart?.id === c.id;
              return (
                <div
                  key={c.id}
                  onClick={() => setSelectedId(c.id)}
                  className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 cursor-pointer transition-colors ${
                    isSelected
                      ? 'border-blue-500 bg-blue-50/50 text-slate-900'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="text-xs font-semibold truncate">
                      {c.title || `Gráfico ${idx + 1}`}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {CHART_TYPES.find((t) => t.value === c.type)?.label || c.type} · Posição:{' '}
                      {c.position === 'before' ? 'Antes' : c.position === 'between' ? 'Entre' : 'Depois'}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeChart(c.id);
                    }}
                    className="p-1 text-slate-400 hover:text-red-600"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Right editor + preview */}
      <div className="lg:col-span-8 space-y-4">
        {!activeChart ? (
          <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-xs text-slate-500">
            Selecione ou adicione um gráfico à esquerda para configurar suas séries e cores.
          </div>
        ) : (
          <>
            <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="md:col-span-2">
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    Título do Gráfico
                  </label>
                  <input
                    type="text"
                    value={activeChart.title}
                    onChange={(e) => updateChart(activeChart.id, { title: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">Paleta</label>
                  <select
                    value={activeChart.palette}
                    onChange={(e) => {
                      const pal = e.target.value as keyof typeof COLOR_PALETTES;
                      const colors = [...COLOR_PALETTES[pal]];
                      updateChart(activeChart.id, {
                        palette: pal,
                        colors,
                        yFields: activeChart.yFields.map((y, idx) => ({
                          ...y,
                          color: colors[idx % colors.length],
                        })),
                      });
                    }}
                    className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs"
                  >
                    <option value="padrao">Padrão</option>
                    <option value="pastel">Pastel</option>
                    <option value="escuro">Escuro</option>
                    <option value="monocromatico">Monocromático</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">Tipo</label>
                  <select
                    value={activeChart.type}
                    onChange={(e) => {
                      const nextType = e.target.value as ReportChartDef['type'];
                      const defaultSub = CHART_SUBTYPES[nextType][0]?.value || '';
                      updateChart(activeChart.id, { type: nextType, subType: defaultSub });
                    }}
                    className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs"
                  >
                    {CHART_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">Subtipo</label>
                  <select
                    disabled={CHART_SUBTYPES[activeChart.type].length === 0}
                    value={activeChart.subType}
                    onChange={(e) => updateChart(activeChart.id, { subType: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs disabled:bg-slate-50"
                  >
                    {CHART_SUBTYPES[activeChart.type].length === 0 ? (
                      <option value="">Padrão Misto</option>
                    ) : (
                      CHART_SUBTYPES[activeChart.type].map((st) => (
                        <option key={st.value} value={st.value}>
                          {st.label}
                        </option>
                      ))
                    )}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    Eixo X (Categoria)
                  </label>
                  <select
                    value={activeChart.xField}
                    onChange={(e) => updateChart(activeChart.id, { xField: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-mono"
                  >
                    <option value="">Selecione...</option>
                    {availableColumns.map((col) => (
                      <option key={col} value={col}>
                        {col}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">Posição</label>
                  <select
                    value={activeChart.position}
                    onChange={(e) => updateChart(activeChart.id, { position: e.target.value as any })}
                    className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs"
                  >
                    <option value="before">Antes da tabela</option>
                    <option value="between">Entre grupos / subrelatórios</option>
                    <option value="after">Depois da tabela</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">Largura</label>
                  <select
                    value={activeChart.width}
                    onChange={(e) => updateChart(activeChart.id, { width: e.target.value as any })}
                    className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs"
                  >
                    <option value="100%">100% (Linha inteira)</option>
                    <option value="50%">50% (Lado a lado)</option>
                  </select>
                </div>
                <div className="flex flex-wrap items-center gap-3 pt-4">
                  <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={activeChart.showLegend}
                      onChange={(e) => updateChart(activeChart.id, { showLegend: e.target.checked })}
                      className="rounded border-slate-300 text-blue-600"
                    />
                    Legenda
                  </label>
                  <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={activeChart.showDataLabels}
                      onChange={(e) => updateChart(activeChart.id, { showDataLabels: e.target.checked })}
                      className="rounded border-slate-300 text-blue-600"
                    />
                    Rótulos
                  </label>
                  <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={activeChart.showGrid}
                      onChange={(e) => updateChart(activeChart.id, { showGrid: e.target.checked })}
                      className="rounded border-slate-300 text-blue-600"
                    />
                    Grade
                  </label>
                </div>
              </div>

              {/* Séries Y */}
              <div className="border-t border-slate-100 pt-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wide text-slate-700">
                    Séries do Eixo Y ({activeChart.yFields.length})
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      const nextIdx = activeChart.yFields.length;
                      const colors = activeChart.colors.length ? activeChart.colors : COLOR_PALETTES.padrao;
                      const defField = availableColumns[1] || availableColumns[0] || '';
                      const nextSeries: ReportChartSeriesDef = {
                        field: defField,
                        label: defField || `Série ${nextIdx + 1}`,
                        operation: 'soma',
                        color: colors[nextIdx % colors.length],
                        seriesType: 'bar',
                        secondaryAxis: false,
                      };
                      updateChart(activeChart.id, { yFields: [...activeChart.yFields, nextSeries] });
                    }}
                    className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    <Plus className="w-3 h-3" />
                    Adicionar Série
                  </button>
                </div>

                {activeChart.yFields.map((y, yIdx) => (
                  <div key={yIdx} className="grid grid-cols-1 md:grid-cols-12 gap-1.5 items-center rounded-lg border border-slate-200 p-2">
                    <div className="md:col-span-3">
                      <select
                        value={y.field}
                        onChange={(e) => {
                          const next = activeChart.yFields.map((item, i) =>
                            i === yIdx ? { ...item, field: e.target.value, label: item.label || e.target.value } : item
                          );
                          updateChart(activeChart.id, { yFields: next });
                        }}
                        className="w-full rounded border border-slate-200 px-2 py-1 text-xs font-mono"
                      >
                        <option value="">Campo...</option>
                        {availableColumns.map((col) => (
                          <option key={col} value={col}>
                            {col}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="md:col-span-3">
                      <input
                        type="text"
                        value={y.label || ''}
                        onChange={(e) => {
                          const next = activeChart.yFields.map((item, i) =>
                            i === yIdx ? { ...item, label: e.target.value } : item
                          );
                          updateChart(activeChart.id, { yFields: next });
                        }}
                        placeholder="Rótulo"
                        className="w-full rounded border border-slate-200 px-2 py-1 text-xs"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <select
                        value={y.operation}
                        onChange={(e) => {
                          const next = activeChart.yFields.map((item, i) =>
                            i === yIdx ? { ...item, operation: e.target.value as any } : item
                          );
                          updateChart(activeChart.id, { yFields: next });
                        }}
                        className="w-full rounded border border-slate-200 px-2 py-1 text-xs"
                      >
                        {Y_OPERATIONS.map((op) => (
                          <option key={op.value} value={op.value}>
                            {op.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    {activeChart.type === 'mixed' && (
                      <>
                        <div className="md:col-span-1">
                          <select
                            value={y.seriesType || 'bar'}
                            onChange={(e) => {
                              const next = activeChart.yFields.map((item, i) =>
                                i === yIdx ? { ...item, seriesType: e.target.value as any } : item
                              );
                              updateChart(activeChart.id, { yFields: next });
                            }}
                            className="w-full rounded border border-slate-200 px-1 py-1 text-[11px]"
                          >
                            <option value="bar">Barra</option>
                            <option value="line">Linha</option>
                          </select>
                        </div>
                        <div className="md:col-span-1 flex justify-center">
                          <label className="inline-flex items-center gap-1 text-[10px] text-slate-600" title="Eixo Y Secundário (Direita)">
                            <input
                              type="checkbox"
                              checked={Boolean(y.secondaryAxis)}
                              onChange={(e) => {
                                const next = activeChart.yFields.map((item, i) =>
                                  i === yIdx ? { ...item, secondaryAxis: e.target.checked } : item
                                );
                                updateChart(activeChart.id, { yFields: next });
                              }}
                            />
                            2º
                          </label>
                        </div>
                      </>
                    )}
                    <div className={activeChart.type === 'mixed' ? 'md:col-span-1' : 'md:col-span-3 flex items-center gap-2'}>
                      <input
                        type="color"
                        value={y.color}
                        onChange={(e) => {
                          const next = activeChart.yFields.map((item, i) =>
                            i === yIdx ? { ...item, color: e.target.value } : item
                          );
                          updateChart(activeChart.id, { yFields: next });
                        }}
                        className="h-7 w-9 cursor-pointer rounded border border-slate-200"
                      />
                    </div>
                    <div className="md:col-span-1 flex justify-end">
                      <button
                        type="button"
                        onClick={() =>
                          updateChart(activeChart.id, {
                            yFields: activeChart.yFields.filter((_, i) => i !== yIdx),
                          })
                        }
                        className="p-1 text-slate-400 hover:text-red-600"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <ReportChartView
              chart={activeChart}
              rows={effectivePreviewRows}
              height={260}
              isSample={previewRows.length === 0}
            />
          </>
        )}
      </div>
    </div>
  );
};
