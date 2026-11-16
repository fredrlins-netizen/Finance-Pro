import React, { useMemo } from 'react';
import { ArrowDown, ArrowUp, Filter, Plus, Sparkles, Trash2 } from 'lucide-react';
import type { ReportFilterDef } from '../../../types.ts';
import { createEmptyFilter } from '../../../lib/reportCatalogs.ts';

interface ReportFiltersTabProps {
  filters: ReportFilterDef[];
  sqlQuery: string;
  availableColumns: string[];
  onChangeFilters: (filters: ReportFilterDef[]) => void;
}

export const ReportFiltersTab: React.FC<ReportFiltersTabProps> = ({
  filters,
  sqlQuery,
  availableColumns,
  onChangeFilters,
}) => {
  const detectedPlaceholders = useMemo(() => {
    const found = new Set<string>();
    const regex = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_.]*)\s*\}\}/g;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(sqlQuery || '')) !== null) {
      found.add(m[1]);
    }
    const configured = new Set(filters.map((f) => f.placeholder));
    return Array.from(found).filter((ph) => !configured.has(ph));
  }, [sqlQuery, filters]);

  const addFilter = (placeholder = '') => {
    const next = createEmptyFilter(placeholder || availableColumns[0] || `filtro_${filters.length + 1}`);
    next.label = placeholder
      ? placeholder.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())
      : '';
    onChangeFilters([...filters, next]);
  };

  const updateFilter = (id: string, patch: Partial<ReportFilterDef>) => {
    onChangeFilters(filters.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  };

  const moveFilter = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= filters.length) return;
    const next = [...filters];
    const [item] = next.splice(idx, 1);
    next.splice(target, 0, item);
    onChangeFilters(next);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3 dark:border-slate-700 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2.5 dark:border-slate-800">
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wide text-slate-800 flex items-center gap-2 dark:text-slate-100">
              <Filter className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              Filtros Dinâmicos ({filters.length})
            </h4>
            <p className="text-xs text-slate-500 mt-0.5 dark:text-slate-400">
              Quando o placeholder existir no SQL como <code className="bg-slate-100 px-1 rounded dark:bg-slate-800">{'{{placeholder}}'}</code>, o parâmetro é injetado com segurança no PostgreSQL. Caso contrário, filtra em memória pelo nome da coluna.
            </p>
          </div>
          <button
            type="button"
            onClick={() => addFilter()}
            className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-emerald-600 dark:hover:bg-emerald-500"
          >
            <Plus className="w-3.5 h-3.5" />
            Adicionar Filtro
          </button>
        </div>

        {detectedPlaceholders.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-blue-200 bg-blue-50/70 px-3 py-2 text-xs dark:border-blue-800/70 dark:bg-blue-950/50">
            <Sparkles className="w-3.5 h-3.5 text-blue-600 shrink-0 dark:text-blue-400" />
            <span className="font-medium text-blue-900 dark:text-blue-300">
              Placeholders detectados no SQL sem filtro configurado:
            </span>
            {detectedPlaceholders.map((ph) => (
              <button
                key={ph}
                type="button"
                onClick={() => addFilter(ph)}
                className="inline-flex items-center gap-1 rounded border border-blue-300 bg-white px-2 py-0.5 font-mono text-[11px] font-semibold text-blue-700 hover:bg-blue-100 dark:border-blue-800/70 dark:bg-slate-900 dark:text-blue-300 dark:hover:bg-blue-900/60"
              >
                <Plus className="w-3 h-3" />
                {ph}
              </button>
            ))}
          </div>
        )}

        {filters.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">
            Nenhum filtro configurado para este relatório.
          </div>
        ) : (
          <div className="space-y-3">
            {filters.map((flt, idx) => (
              <div
                key={flt.id}
                className="rounded-lg border border-slate-200 bg-slate-50/40 p-3 space-y-2.5 dark:border-slate-700"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[11px] font-bold text-slate-700 dark:text-slate-200">
                    Filtro #{idx + 1}{' '}
                    <code className="ml-1 bg-slate-200/70 px-1.5 py-0.5 rounded font-mono text-[10px]">
                      {`{{${flt.placeholder}}}`}
                    </code>
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={idx === 0}
                      onClick={() => moveFilter(idx, -1)}
                      className="p-1 text-slate-500 hover:text-slate-900 disabled:opacity-30 dark:text-slate-400 dark:hover:text-white"
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={idx === filters.length - 1}
                      onClick={() => moveFilter(idx, 1)}
                      className="p-1 text-slate-500 hover:text-slate-900 disabled:opacity-30 dark:text-slate-400 dark:hover:text-white"
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onChangeFilters(filters.filter((f) => f.id !== flt.id))}
                      className="p-1 text-slate-400 hover:text-red-600 dark:text-slate-400"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-2.5">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1 dark:text-slate-300">
                      Placeholder / Coluna
                    </label>
                    <input
                      type="text"
                      list={`cols-list-${flt.id}`}
                      value={flt.placeholder}
                      onChange={(e) =>
                        updateFilter(flt.id, {
                          placeholder: e.target.value.replace(/[^a-zA-Z0-9_.]/g, ''),
                        })
                      }
                      className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-mono dark:border-slate-700 dark:bg-slate-900"
                    />
                    <datalist id={`cols-list-${flt.id}`}>
                      {availableColumns.map((col) => (
                        <option key={col} value={col} />
                      ))}
                    </datalist>
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1 dark:text-slate-300">
                      Rótulo Exibido
                    </label>
                    <input
                      type="text"
                      value={flt.label}
                      onChange={(e) => updateFilter(flt.id, { label: e.target.value })}
                      placeholder="Ex: Data Inicial"
                      className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1 dark:text-slate-300">
                      Tipo de Campo
                    </label>
                    <select
                      value={flt.type}
                      onChange={(e) => updateFilter(flt.id, { type: e.target.value as any })}
                      className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    >
                      <option value="text">Texto</option>
                      <option value="date">Data</option>
                      <option value="number">Número</option>
                      <option value="select">Lista (Select)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1 dark:text-slate-300">
                      Valor Padrão
                    </label>
                    <input
                      type={flt.type === 'date' ? 'date' : flt.type === 'number' ? 'number' : 'text'}
                      value={flt.defaultValue}
                      onChange={(e) => updateFilter(flt.id, { defaultValue: e.target.value })}
                      className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900"
                    />
                  </div>
                </div>

                {flt.type === 'select' && (
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1 dark:text-slate-300">
                      Opções da Lista (uma por linha)
                    </label>
                    <textarea
                      rows={3}
                      value={(flt.options || []).join('\n')}
                      onChange={(e) =>
                        updateFilter(flt.id, {
                          options: e.target.value
                            .split('\n')
                            .map((s) => s.trim())
                            .filter(Boolean),
                        })
                      }
                      placeholder={'PAGO\nPENDENTE\nATRASADO'}
                      className="w-full rounded-lg border border-slate-200 bg-white p-2 text-xs font-mono dark:border-slate-700 dark:bg-slate-900"
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
