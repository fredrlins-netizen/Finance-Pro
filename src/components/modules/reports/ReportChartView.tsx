import React, { useMemo } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  LabelList,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { ReportChartDef } from '../../../types.ts';
import { aggregateChartSeries, COLOR_PALETTES } from '../../../lib/reportCatalogs.ts';

interface ReportChartViewProps {
  chart: ReportChartDef;
  rows: Array<Record<string, any>>;
  height?: number;
  isSample?: boolean;
}

function formatShortNumber(v: unknown): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v ?? '');
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 10_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
}

export const ReportChartView: React.FC<ReportChartViewProps> = ({
  chart,
  rows,
  height = 280,
  isSample = false,
}) => {
  const paletteColors =
    chart.colors && chart.colors.length > 0
      ? chart.colors
      : COLOR_PALETTES[chart.palette || 'padrao'] || COLOR_PALETTES.padrao;

  const { data, seriesKeys } = useMemo(() => {
    if (rows.length > 0 && chart.xField && chart.yFields.length > 0) {
      return aggregateChartSeries(rows, chart);
    }
    return { data: [], seriesKeys: [] };
  }, [rows, chart]);

  if (!chart.xField || chart.yFields.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/70 p-6 text-center text-xs text-slate-500">
        Selecione o campo do Eixo X e ao menos uma série Y para visualizar o gráfico.
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6 text-center text-xs text-slate-500">
        Sem dados disponíveis para gerar o gráfico &ldquo;{chart.title || 'Sem título'}&rdquo;.
      </div>
    );
  }

  const hasSecondaryAxis = seriesKeys.some((s) => s.secondaryAxis);

  return (
    <div
      data-report-chart-card="true"
      data-chart-title={chart.title || 'Gráfico'}
      className="rounded-xl border border-slate-200 bg-white p-4"
    >
      <div className="flex items-center justify-between gap-2 mb-3">
        <h5 className="text-xs font-bold text-slate-800">{chart.title || 'Gráfico'}</h5>
        {isSample && (
          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            Dados de demonstração
          </span>
        )}
      </div>

      <div style={{ width: '100%', height }}>
        <ResponsiveContainer width="100%" height="100%">
          {chart.type === 'pie' ? (
            <PieChart>
              <Tooltip formatter={(value: any) => Number(value || 0).toLocaleString('pt-BR')} />
              {chart.showLegend && <Legend wrapperStyle={{ fontSize: 11 }} />}
              <Pie
                data={data}
                dataKey={seriesKeys[0].key}
                nameKey="__x"
                cx="50%"
                cy="50%"
                innerRadius={chart.subType === 'donut' ? 40 : 0}
                outerRadius={72}
                paddingAngle={2}
                label={
                  chart.showDataLabels
                    ? ({ name, value }) => `${String(name).slice(0, 12)}: ${formatShortNumber(value)}`
                    : false
                }
              >
                {data.map((_, idx) => (
                  <Cell key={idx} fill={paletteColors[idx % paletteColors.length]} />
                ))}
              </Pie>
            </PieChart>
          ) : chart.type === 'line' && chart.subType === 'area' ? (
            <AreaChart data={data} margin={{ top: 16, right: 20, left: 8, bottom: 8 }}>
              {chart.showGrid && <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />}
              <XAxis dataKey="__x" tick={{ fontSize: 11, fill: '#475569' }} />
              <YAxis tick={{ fontSize: 11, fill: '#475569' }} tickFormatter={formatShortNumber} />
              <Tooltip formatter={(v: any) => Number(v || 0).toLocaleString('pt-BR')} />
              {chart.showLegend && <Legend wrapperStyle={{ fontSize: 11 }} />}
              {seriesKeys.map((s) => (
                <Area
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  name={s.label}
                  stroke={s.color}
                  fill={s.color}
                  fillOpacity={0.2}
                  strokeWidth={2}
                >
                  {chart.showDataLabels && (
                    <LabelList
                      dataKey={s.key}
                      position="top"
                      formatter={(val: any) => formatShortNumber(val)}
                      style={{ fontSize: 10, fill: '#334155' }}
                    />
                  )}
                </Area>
              ))}
            </AreaChart>
          ) : chart.type === 'line' ? (
            <LineChart data={data} margin={{ top: 16, right: 20, left: 8, bottom: 8 }}>
              {chart.showGrid && <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />}
              <XAxis dataKey="__x" tick={{ fontSize: 11, fill: '#475569' }} />
              <YAxis tick={{ fontSize: 11, fill: '#475569' }} tickFormatter={formatShortNumber} />
              <Tooltip formatter={(v: any) => Number(v || 0).toLocaleString('pt-BR')} />
              {chart.showLegend && <Legend wrapperStyle={{ fontSize: 11 }} />}
              {seriesKeys.map((s) => (
                <Line
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  name={s.label}
                  stroke={s.color}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                >
                  {chart.showDataLabels && (
                    <LabelList
                      dataKey={s.key}
                      position="top"
                      formatter={(val: any) => formatShortNumber(val)}
                      style={{ fontSize: 10, fill: '#334155' }}
                    />
                  )}
                </Line>
              ))}
            </LineChart>
          ) : chart.type === 'mixed' ? (
            <ComposedChart data={data} margin={{ top: 16, right: 20, left: 8, bottom: 8 }}>
              {chart.showGrid && <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />}
              <XAxis dataKey="__x" tick={{ fontSize: 11, fill: '#475569' }} />
              <YAxis yAxisId="left" tick={{ fontSize: 11, fill: '#475569' }} tickFormatter={formatShortNumber} />
              {hasSecondaryAxis && (
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tick={{ fontSize: 11, fill: '#475569' }}
                  tickFormatter={formatShortNumber}
                />
              )}
              <Tooltip formatter={(v: any) => Number(v || 0).toLocaleString('pt-BR')} />
              {chart.showLegend && <Legend wrapperStyle={{ fontSize: 11 }} />}
              {seriesKeys.map((s) =>
                s.seriesType === 'line' ? (
                  <Line
                    key={s.key}
                    yAxisId={s.secondaryAxis ? 'right' : 'left'}
                    type="monotone"
                    dataKey={s.key}
                    name={s.label}
                    stroke={s.color}
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  >
                    {chart.showDataLabels && (
                      <LabelList
                        dataKey={s.key}
                        position="top"
                        formatter={(val: any) => formatShortNumber(val)}
                        style={{ fontSize: 10, fill: '#334155' }}
                      />
                    )}
                  </Line>
                ) : (
                  <Bar
                    key={s.key}
                    yAxisId={s.secondaryAxis ? 'right' : 'left'}
                    dataKey={s.key}
                    name={s.label}
                    fill={s.color}
                    radius={[3, 3, 0, 0]}
                  >
                    {chart.showDataLabels && (
                      <LabelList
                        dataKey={s.key}
                        position="top"
                        formatter={(val: any) => formatShortNumber(val)}
                        style={{ fontSize: 10, fill: '#334155' }}
                      />
                    )}
                  </Bar>
                )
              )}
            </ComposedChart>
          ) : chart.subType === 'horizontal' ? (
            <BarChart data={data} layout="vertical" margin={{ top: 12, right: 28, left: 24, bottom: 8 }}>
              {chart.showGrid && <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />}
              <XAxis type="number" tick={{ fontSize: 11, fill: '#475569' }} tickFormatter={formatShortNumber} />
              <YAxis type="category" dataKey="__x" width={110} tick={{ fontSize: 11, fill: '#475569' }} />
              <Tooltip formatter={(v: any) => Number(v || 0).toLocaleString('pt-BR')} />
              {chart.showLegend && <Legend wrapperStyle={{ fontSize: 11 }} />}
              {seriesKeys.map((s) => (
                <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} radius={[0, 3, 3, 0]}>
                  {chart.showDataLabels && (
                    <LabelList
                      dataKey={s.key}
                      position="right"
                      formatter={(val: any) => formatShortNumber(val)}
                      style={{ fontSize: 10, fill: '#334155' }}
                    />
                  )}
                </Bar>
              ))}
            </BarChart>
          ) : (
            <BarChart data={data} margin={{ top: 16, right: 20, left: 8, bottom: 8 }}>
              {chart.showGrid && <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />}
              <XAxis dataKey="__x" tick={{ fontSize: 11, fill: '#475569' }} />
              <YAxis tick={{ fontSize: 11, fill: '#475569' }} tickFormatter={formatShortNumber} />
              <Tooltip formatter={(v: any) => Number(v || 0).toLocaleString('pt-BR')} />
              {chart.showLegend && <Legend wrapperStyle={{ fontSize: 11 }} />}
              {seriesKeys.map((s) => (
                <Bar
                  key={s.key}
                  dataKey={s.key}
                  name={s.label}
                  fill={s.color}
                  stackId={chart.subType === 'stacked' ? 'stack' : undefined}
                  radius={[3, 3, 0, 0]}
                >
                  {chart.showDataLabels && (
                    <LabelList
                      dataKey={s.key}
                      position="top"
                      formatter={(val: any) => formatShortNumber(val)}
                      style={{ fontSize: 10, fill: '#334155' }}
                    />
                  )}
                </Bar>
              ))}
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
};
