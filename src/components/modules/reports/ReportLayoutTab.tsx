import React, { useMemo } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Eye,
  EyeOff,
  FileText,
  Image as ImageIcon,
  Layers,
  Layout,
  RefreshCw,
  Sliders,
} from 'lucide-react';
import type {
  ReportAggregationOp,
  ReportColumnDef,
  ReportColumnFormat,
  ReportLayoutConfig,
  ReportTemplateItem,
  ReportTotalizerDef,
} from '../../../types.ts';
import {
  AGGREGATION_OPTIONS,
  COLUMN_FORMATS,
  normalizeLayoutConfig,
} from '../../../lib/reportCatalogs.ts';

interface ReportLayoutTabProps {
  template: ReportTemplateItem;
  previewColumns: string[];
  onChangeTemplate: (patch: Partial<ReportTemplateItem>) => void;
  onSyncColumnsFromPreview: () => void;
}

export const ReportLayoutTab: React.FC<ReportLayoutTabProps> = ({
  template,
  previewColumns,
  onChangeTemplate,
  onSyncColumnsFromPreview,
}) => {
  const layout = useMemo(() => normalizeLayoutConfig(template.layout), [template.layout]);

  const updateLayout = (updater: (curr: ReportLayoutConfig) => ReportLayoutConfig) => {
    onChangeTemplate({ layout: updater(layout) });
  };

  const availableFields = useMemo(() => {
    const set = new Set<string>([
      ...layout.columns.map((c) => c.field),
      ...previewColumns,
    ]);
    return Array.from(set).filter(Boolean);
  }, [layout.columns, previewColumns]);

  const handleLogoFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        updateLayout((curr) => ({
          ...curr,
          header: { ...curr.header, logo: reader.result as string, showLogo: true },
        }));
      }
    };
    reader.readAsDataURL(file);
  };

  const moveColumn = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= layout.columns.length) return;
    const next = [...layout.columns];
    const [item] = next.splice(idx, 1);
    next.splice(target, 0, item);
    updateLayout((curr) => ({ ...curr, columns: next }));
  };

  const updateColumn = (idx: number, patch: Partial<ReportColumnDef>) => {
    const next = layout.columns.map((c, i) => (i === idx ? { ...c, ...patch } : c));
    updateLayout((curr) => ({ ...curr, columns: next }));
  };

  const setTotalizer = (
    list: ReportTotalizerDef[],
    field: string,
    operation: ReportAggregationOp
  ): ReportTotalizerDef[] => {
    const filtered = list.filter((t) => t.field !== field);
    if (operation === 'nenhum') return filtered;
    return [...filtered, { field, operation }];
  };

  const groupingEnabled = Boolean(layout.grouping && layout.grouping.fields.length >= 0 && layout.grouping !== null);

  return (
    <div className="space-y-4">
      {/* 1. Configurações de Página e Modo */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-4 dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-center gap-2 border-b border-slate-100 pb-2.5 dark:border-slate-800">
          <Sliders className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          <h4 className="text-xs font-bold uppercase tracking-wide text-slate-800 dark:text-slate-100">
            Página, Destino e Tipografia
          </h4>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1 dark:text-slate-300">Layout Alvo</label>
            <select
              value={template.target_layout}
              onChange={(e) => onChangeTemplate({ target_layout: e.target.value as any })}
              className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            >
              <option value="responsive">Responsivo</option>
              <option value="web">Web / Impressão</option>
              <option value="mobile">Mobile</option>
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1 dark:text-slate-300">Conteúdo</label>
            <select
              value={template.content_mode}
              onChange={(e) => onChangeTemplate({ content_mode: e.target.value as any })}
              className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            >
              <option value="both">Dados + Gráficos</option>
              <option value="data">Somente Dados</option>
              <option value="charts">Somente Gráficos</option>
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1 dark:text-slate-300">Papel</label>
            <select
              value={layout.general.pageSize}
              onChange={(e) =>
                updateLayout((c) => ({
                  ...c,
                  general: { ...c.general, pageSize: e.target.value as any },
                }))
              }
              className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs dark:border-slate-700"
            >
              <option value="A4">A4</option>
              <option value="Letter">Carta (Letter)</option>
              <option value="Legal">Ofício (Legal)</option>
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1 dark:text-slate-300">Orientação</label>
            <select
              value={layout.general.orientation}
              onChange={(e) =>
                updateLayout((c) => ({
                  ...c,
                  general: { ...c.general, orientation: e.target.value as any },
                }))
              }
              className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs dark:border-slate-700"
            >
              <option value="portrait">Retrato</option>
              <option value="landscape">Paisagem</option>
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1 dark:text-slate-300">Fonte</label>
            <select
              value={layout.general.fontFamily}
              onChange={(e) =>
                updateLayout((c) => ({
                  ...c,
                  general: { ...c.general, fontFamily: e.target.value },
                }))
              }
              className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs dark:border-slate-700"
            >
              <option value="Arial">Arial</option>
              <option value="Helvetica">Helvetica</option>
              <option value="Inter">Inter</option>
              <option value="Times New Roman">Times New Roman</option>
              <option value="Courier New">Courier New</option>
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1 dark:text-slate-300">Tamanho (px)</label>
            <input
              type="number"
              min={9}
              max={18}
              value={layout.general.fontSize}
              onChange={(e) =>
                updateLayout((c) => ({
                  ...c,
                  general: { ...c.general, fontSize: Number(e.target.value) || 12 },
                }))
              }
              className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs dark:border-slate-700"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4 pt-1">
          <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer dark:text-slate-200">
            <input
              type="checkbox"
              checked={layout.general.zebra}
              onChange={(e) =>
                updateLayout((c) => ({
                  ...c,
                  general: { ...c.general, zebra: e.target.checked },
                }))
              }
              className="rounded border-slate-300 text-blue-600 dark:border-slate-600 dark:text-blue-400"
            />
            Linhas zebradas na tabela
          </label>

          <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
            <span className="font-semibold">Margens (mm):</span>
            {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
              <label key={side} className="inline-flex items-center gap-1">
                <span className="uppercase text-[10px] text-slate-400 dark:text-slate-400">{side[0]}</span>
                <input
                  type="number"
                  min={5}
                  max={50}
                  value={layout.general.margins[side]}
                  onChange={(e) =>
                    updateLayout((c) => ({
                      ...c,
                      general: {
                        ...c.general,
                        margins: { ...c.general.margins, [side]: Number(e.target.value) || 15 },
                      },
                    }))
                  }
                  className="w-12 rounded border border-slate-200 px-1.5 py-1 text-xs text-center dark:border-slate-700"
                />
              </label>
            ))}
          </div>
        </div>
      </div>

      {/* 2. Cabeçalho */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3 dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-100 pb-2.5 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <Layout className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            <h4 className="text-xs font-bold uppercase tracking-wide text-slate-800 dark:text-slate-100">Cabeçalho</h4>
          </div>
          <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer dark:text-slate-200">
            <input
              type="checkbox"
              checked={layout.header.show}
              onChange={(e) =>
                updateLayout((c) => ({ ...c, header: { ...c.header, show: e.target.checked } }))
              }
              className="rounded border-slate-300 text-blue-600 dark:border-slate-600 dark:text-blue-400"
            />
            Exibir Cabeçalho
          </label>
        </div>

        {layout.header.show && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1 dark:text-slate-300">Título</label>
              <input
                type="text"
                value={layout.header.title}
                onChange={(e) =>
                  updateLayout((c) => ({ ...c, header: { ...c.header, title: e.target.value } }))
                }
                placeholder={template.name || 'Título do relatório'}
                className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs dark:border-slate-700"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1 dark:text-slate-300">Subtítulo</label>
              <input
                type="text"
                value={layout.header.subtitle}
                onChange={(e) =>
                  updateLayout((c) => ({ ...c, header: { ...c.header, subtitle: e.target.value } }))
                }
                placeholder="Subtítulo opcional"
                className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs dark:border-slate-700"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1 dark:text-slate-300">Alinhamento</label>
              <select
                value={layout.header.alignment}
                onChange={(e) =>
                  updateLayout((c) => ({
                    ...c,
                    header: { ...c.header, alignment: e.target.value as any },
                  }))
                }
                className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs dark:border-slate-700"
              >
                <option value="left">Esquerda</option>
                <option value="center">Centro</option>
                <option value="right">Direita</option>
              </select>
            </div>
            <div className="md:col-span-2 flex flex-wrap items-center gap-3">
              <div className="flex-1 min-w-[200px]">
                <label className="block text-[11px] font-semibold text-slate-600 mb-1 dark:text-slate-300">
                  URL ou Base64 do Logo
                </label>
                <input
                  type="text"
                  value={layout.header.logo}
                  onChange={(e) =>
                    updateLayout((c) => ({ ...c, header: { ...c.header, logo: e.target.value } }))
                  }
                  placeholder="Em branco = Logotipo Institucional automático (Portal & Identidade)"
                  className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs dark:border-slate-700"
                />
                <p className="mt-1 text-[10px] text-slate-500 dark:text-slate-400">
                  Se vazio, utiliza automaticamente o Logotipo Institucional de Configurações &amp; SQL → Portal &amp; Identidade.
                </p>
              </div>
              <label className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 cursor-pointer mt-4 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-200 dark:hover:bg-slate-800">
                <ImageIcon className="w-3.5 h-3.5" />
                Upload Logo
                <input type="file" accept="image/*" onChange={handleLogoFile} className="hidden" />
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-4 pt-4">
              <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer dark:text-slate-200">
                <input
                  type="checkbox"
                  checked={layout.header.showLogo}
                  onChange={(e) =>
                    updateLayout((c) => ({ ...c, header: { ...c.header, showLogo: e.target.checked } }))
                  }
                  className="rounded border-slate-300 text-blue-600 dark:border-slate-600 dark:text-blue-400"
                />
                Mostrar Logo
              </label>
              <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer dark:text-slate-200">
                <input
                  type="checkbox"
                  checked={layout.header.showDate}
                  onChange={(e) =>
                    updateLayout((c) => ({ ...c, header: { ...c.header, showDate: e.target.checked } }))
                  }
                  className="rounded border-slate-300 text-blue-600 dark:border-slate-600 dark:text-blue-400"
                />
                Data de Geração
              </label>
            </div>
          </div>
        )}
      </div>

      {/* 3. Colunas */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3 dark:border-slate-700 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2.5 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            <h4 className="text-xs font-bold uppercase tracking-wide text-slate-800 dark:text-slate-100">
              Colunas da Tabela ({layout.columns.length})
            </h4>
          </div>
          {previewColumns.length > 0 && (
            <button
              type="button"
              onClick={onSyncColumnsFromPreview}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Sincronizar Colunas do Preview ({previewColumns.length})
            </button>
          )}
        </div>

        {layout.columns.length === 0 ? (
          <p className="text-xs text-slate-500 py-3 dark:text-slate-400">
            Execute o preview na aba <strong>Fonte de Dados</strong> para detectar e configurar as colunas automaticamente.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-[11px] text-slate-500 uppercase dark:border-slate-700 dark:text-slate-400">
                  <th className="py-2 pr-2">Ordem</th>
                  <th className="py-2 pr-2">Visível</th>
                  <th className="py-2 pr-2">Campo SQL</th>
                  <th className="py-2 pr-2">Rótulo</th>
                  <th className="py-2 pr-2">Largura</th>
                  <th className="py-2 pr-2">Alinhamento</th>
                  <th className="py-2">Formatação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {layout.columns.map((col, idx) => (
                  <tr key={col.field} className={col.visible ? '' : 'opacity-50'}>
                    <td className="py-1.5 pr-2 whitespace-nowrap">
                      <button
                        type="button"
                        disabled={idx === 0}
                        onClick={() => moveColumn(idx, -1)}
                        className="p-1 text-slate-500 hover:text-slate-900 disabled:opacity-30 dark:text-slate-400 dark:hover:text-white"
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={idx === layout.columns.length - 1}
                        onClick={() => moveColumn(idx, 1)}
                        className="p-1 text-slate-500 hover:text-slate-900 disabled:opacity-30 dark:text-slate-400 dark:hover:text-white"
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>
                    </td>
                    <td className="py-1.5 pr-2">
                      <button
                        type="button"
                        onClick={() => updateColumn(idx, { visible: !col.visible })}
                        className="inline-flex items-center gap-1 rounded border border-slate-200 px-2 py-1 text-[11px] dark:border-slate-700"
                      >
                        {col.visible ? (
                          <>
                            <Eye className="w-3 h-3 text-emerald-600 dark:text-emerald-400" /> Sim
                          </>
                        ) : (
                          <>
                            <EyeOff className="w-3 h-3 text-slate-400 dark:text-slate-400" /> Não
                          </>
                        )}
                      </button>
                    </td>
                    <td className="py-1.5 pr-2 font-mono text-[11px] text-slate-600 dark:text-slate-300">{col.field}</td>
                    <td className="py-1.5 pr-2">
                      <input
                        type="text"
                        value={col.label}
                        onChange={(e) => updateColumn(idx, { label: e.target.value })}
                        className="w-40 rounded border border-slate-200 px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                      />
                    </td>
                    <td className="py-1.5 pr-2">
                      <input
                        type="text"
                        value={col.width}
                        onChange={(e) => updateColumn(idx, { width: e.target.value })}
                        placeholder="auto"
                        className="w-20 rounded border border-slate-200 px-2 py-1 text-xs dark:border-slate-700"
                      />
                    </td>
                    <td className="py-1.5 pr-2">
                      <select
                        value={col.align}
                        onChange={(e) => updateColumn(idx, { align: e.target.value as any })}
                        className="rounded border border-slate-200 px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                      >
                        <option value="left">Esquerda</option>
                        <option value="center">Centro</option>
                        <option value="right">Direita</option>
                      </select>
                    </td>
                    <td className="py-1.5">
                      <select
                        value={col.format}
                        onChange={(e) =>
                          updateColumn(idx, { format: e.target.value as ReportColumnFormat })
                        }
                        className="rounded border border-slate-200 px-2 py-1 text-xs dark:border-slate-700"
                      >
                        {COLUMN_FORMATS.map((fmt) => (
                          <option key={fmt.value} value={fmt.value}>
                            {fmt.label}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 4. Agrupamento Visual */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3 dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-100 pb-2.5 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            <h4 className="text-xs font-bold uppercase tracking-wide text-slate-800 dark:text-slate-100">
              Agrupamento e Subtotais
            </h4>
          </div>
          <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer dark:text-slate-200">
            <input
              type="checkbox"
              checked={groupingEnabled}
              onChange={(e) =>
                updateLayout((c) => ({
                  ...c,
                  grouping: e.target.checked
                    ? { fields: availableFields[0] ? [availableFields[0]] : [], headerTemplate: 'Grupo: {{grupo}}', showSubtotals: true, totalizers: [] }
                    : null,
                }))
              }
              className="rounded border-slate-300 text-blue-600 dark:border-slate-600 dark:text-blue-400"
            />
            Ativar Agrupamento
          </label>
        </div>

        {layout.grouping && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1 dark:text-slate-300">
                  Campos de Agrupamento
                </label>
                <div className="flex flex-wrap gap-1.5 p-2 rounded-lg border border-slate-200 bg-slate-50 min-h-[38px] dark:border-slate-700 dark:bg-slate-800/70">
                  {availableFields.map((f) => {
                    const active = layout.grouping?.fields.includes(f);
                    return (
                      <button
                        key={f}
                        type="button"
                        onClick={() =>
                          updateLayout((c) => {
                            if (!c.grouping) return c;
                            const fields = active
                              ? c.grouping.fields.filter((x) => x !== f)
                              : [...c.grouping.fields, f];
                            return { ...c, grouping: { ...c.grouping, fields } };
                          })
                        }
                        className={`rounded px-2 py-0.5 text-[11px] font-mono border ${
                          active
                            ? 'bg-slate-900 text-white border-slate-900 dark:bg-emerald-600 dark:border-emerald-500'
                            : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300 dark:bg-slate-900 dark:text-slate-300 dark:border-slate-700'
                        }`}
                      >
                        {f}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1 dark:text-slate-300">
                  Template do Cabeçalho do Grupo
                </label>
                <input
                  type="text"
                  value={layout.grouping.headerTemplate}
                  onChange={(e) =>
                    updateLayout((c) =>
                      c.grouping ? { ...c, grouping: { ...c.grouping, headerTemplate: e.target.value } } : c
                    )
                  }
                  placeholder="Ex: Unidade: {{grupo}}"
                  className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs dark:border-slate-700"
                />
                <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 mt-2 cursor-pointer dark:text-slate-200">
                  <input
                    type="checkbox"
                    checked={layout.grouping.showSubtotals}
                    onChange={(e) =>
                      updateLayout((c) =>
                        c.grouping ? { ...c, grouping: { ...c.grouping, showSubtotals: e.target.checked } } : c
                      )
                    }
                    className="rounded border-slate-300 text-blue-600 dark:border-slate-600 dark:text-blue-400"
                  />
                  Exibir linha de subtotal por grupo
                </label>
              </div>
            </div>

            {layout.grouping.showSubtotals && layout.columns.length > 0 && (
              <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                <span className="block text-[11px] font-semibold text-slate-600 mb-1.5 dark:text-slate-300">
                  Totalizadores do Subtotal:
                </span>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {layout.columns.map((col) => {
                    const currentOp =
                      layout.grouping?.totalizers.find((t) => t.field === col.field)?.operation || 'nenhum';
                    return (
                      <div key={col.field} className="flex items-center justify-between gap-2 rounded border border-slate-200 px-2 py-1 text-xs dark:border-slate-700">
                        <span className="truncate font-medium text-slate-700 dark:text-slate-200">{col.label || col.field}</span>
                        <select
                          value={currentOp}
                          onChange={(e) =>
                            updateLayout((c) =>
                              c.grouping
                                ? {
                                    ...c,
                                    grouping: {
                                      ...c.grouping,
                                      totalizers: setTotalizer(
                                        c.grouping.totalizers,
                                        col.field,
                                        e.target.value as ReportAggregationOp
                                      ),
                                    },
                                  }
                                : c
                            )
                          }
                          className="rounded border border-slate-200 px-1 py-0.5 text-[11px] dark:border-slate-700"
                        >
                          {AGGREGATION_OPTIONS.map((op) => (
                            <option key={op.value} value={op.value}>
                              {op.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 5. Rodapé & Totalizadores Gerais */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3 dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-100 pb-2.5 dark:border-slate-800">
          <h4 className="text-xs font-bold uppercase tracking-wide text-slate-800 dark:text-slate-100">
            Rodapé e Totalizadores Gerais
          </h4>
          <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer dark:text-slate-200">
            <input
              type="checkbox"
              checked={layout.footer.show}
              onChange={(e) =>
                updateLayout((c) => ({ ...c, footer: { ...c.footer, show: e.target.checked } }))
              }
              className="rounded border-slate-300 text-blue-600 dark:border-slate-600 dark:text-blue-400"
            />
            Exibir Rodapé
          </label>
        </div>

        {layout.footer.show && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1 dark:text-slate-300">
                  Texto Personalizado do Rodapé
                </label>
                <input
                  type="text"
                  value={layout.footer.customText}
                  onChange={(e) =>
                    updateLayout((c) => ({
                      ...c,
                      footer: { ...c.footer, customText: e.target.value },
                    }))
                  }
                  placeholder="Ex: Documento interno · FinancePro Assessoria"
                  className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs dark:border-slate-700"
                />
              </div>
              <div className="flex flex-wrap items-center gap-4 pt-4">
                <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer dark:text-slate-200">
                  <input
                    type="checkbox"
                    checked={layout.footer.showTotals}
                    onChange={(e) =>
                      updateLayout((c) => ({
                        ...c,
                        footer: { ...c.footer, showTotals: e.target.checked },
                      }))
                    }
                    className="rounded border-slate-300 text-blue-600 dark:border-slate-600 dark:text-blue-400"
                  />
                  Mostrar Total Geral
                </label>
                <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer dark:text-slate-200">
                  <input
                    type="checkbox"
                    checked={layout.footer.showPageNumbers}
                    onChange={(e) =>
                      updateLayout((c) => ({
                        ...c,
                        footer: { ...c.footer, showPageNumbers: e.target.checked },
                      }))
                    }
                    className="rounded border-slate-300 text-blue-600 dark:border-slate-600 dark:text-blue-400"
                  />
                  Numeração de Páginas
                </label>
                <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer dark:text-slate-200">
                  <input
                    type="checkbox"
                    checked={layout.footer.showDateTime}
                    onChange={(e) =>
                      updateLayout((c) => ({
                        ...c,
                        footer: { ...c.footer, showDateTime: e.target.checked },
                      }))
                    }
                    className="rounded border-slate-300 text-blue-600 dark:border-slate-600 dark:text-blue-400"
                  />
                  Data/Hora
                </label>
              </div>
            </div>

            {layout.footer.showTotals && layout.columns.length > 0 && (
              <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                <span className="block text-[11px] font-semibold text-slate-600 mb-1.5 dark:text-slate-300">
                  Totalizadores Gerais por Coluna:
                </span>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {layout.columns.map((col) => {
                    const currentOp =
                      layout.footer.totalizers.find((t) => t.field === col.field)?.operation || 'nenhum';
                    return (
                      <div key={col.field} className="flex items-center justify-between gap-2 rounded border border-slate-200 px-2 py-1 text-xs dark:border-slate-700">
                        <span className="truncate font-medium text-slate-700 dark:text-slate-200">{col.label || col.field}</span>
                        <select
                          value={currentOp}
                          onChange={(e) =>
                            updateLayout((c) => ({
                              ...c,
                              footer: {
                                ...c.footer,
                                totalizers: setTotalizer(
                                  c.footer.totalizers,
                                  col.field,
                                  e.target.value as ReportAggregationOp
                                ),
                              },
                            }))
                          }
                          className="rounded border border-slate-200 px-1 py-0.5 text-[11px] dark:border-slate-700"
                        >
                          {AGGREGATION_OPTIONS.map((op) => (
                            <option key={op.value} value={op.value}>
                              {op.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
