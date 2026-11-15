import React, { useState } from 'react';
import { Filter, X } from 'lucide-react';
import { Unit } from '../types.ts';

interface CollapsibleFilterBarProps {
  units: Unit[];
  selectedUnitId: string;
  onUnitChange: (unitId: string) => void;
  period: string;
  onPeriodChange: (period: string) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  extraStatuses?: Array<{ value: string; label: string }>;
  selectedStatus?: string;
  onStatusChange?: (status: string) => void;
}

export const CollapsibleFilterBar: React.FC<CollapsibleFilterBarProps> = ({
  units,
  selectedUnitId,
  onUnitChange,
  period,
  onPeriodChange,
  searchQuery,
  onSearchChange,
  extraStatuses,
  selectedStatus,
  onStatusChange,
}) => {
  const [open, setOpen] = useState(false);

  const hasActiveFilters =
    selectedUnitId !== 'all' || period !== '30d' || searchQuery.trim() !== '' || (selectedStatus && selectedStatus !== 'all');

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className={`inline-flex items-center gap-2 rounded-lg border px-3.5 py-2 text-xs font-semibold transition-colors min-h-[38px] whitespace-nowrap ${
            open || hasActiveFilters
              ? 'border-blue-600 bg-blue-50 text-blue-800'
              : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
          }`}
        >
          <Filter className="w-3.5 h-3.5" />
          {open ? 'Ocultar Filtros' : 'Filtros Dinâmicos'}
          {hasActiveFilters && !open && <span className="font-mono text-[11px]">· Ativo</span>}
        </button>

        {hasActiveFilters && (
          <button
            type="button"
            onClick={() => {
              onUnitChange('all');
              onPeriodChange('30d');
              onSearchChange('');
              if (onStatusChange) onStatusChange('all');
            }}
            className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-900"
          >
            <X className="w-3.5 h-3.5" />
            Limpar filtros
          </button>
        )}
      </div>

      {open && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 rounded-xl border border-slate-200 bg-white p-3.5">
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">Unidade</label>
            <select
              value={selectedUnitId}
              onChange={(e) => onUnitChange(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-800 focus:border-blue-600 focus:outline-none"
            >
              <option value="all">Todas as 7 Unidades</option>
              {units.map((u) => (
                <option key={u.id} value={String(u.id)}>
                  {u.code} · {u.name} ({u.state})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">Período</label>
            <select
              value={period}
              onChange={(e) => onPeriodChange(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-800 focus:border-blue-600 focus:outline-none"
            >
              <option value="7d">Últimos 7 dias</option>
              <option value="30d">Últimos 30 dias</option>
              <option value="90d">Últimos 90 dias</option>
              <option value="365d">Últimos 12 meses</option>
            </select>
          </div>

          {extraStatuses && onStatusChange && (
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 mb-1">Status</label>
              <select
                value={selectedStatus || 'all'}
                onChange={(e) => onStatusChange(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-800 focus:border-blue-600 focus:outline-none"
              >
                <option value="all">Todos</option>
                {extraStatuses.map((st) => (
                  <option key={st.value} value={st.value}>
                    {st.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">Busca rápida</label>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Cliente, banco, processo..."
              className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-800 focus:border-blue-600 focus:outline-none"
            />
          </div>
        </div>
      )}
    </div>
  );
};
