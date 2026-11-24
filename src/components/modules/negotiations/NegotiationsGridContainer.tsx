import React from 'react';
import {
  ArrowUpDown,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Plus,
  Search,
  Trash2,
  User,
} from 'lucide-react';
import { formatBRL, formatDateBR } from '../../../lib/api.ts';
import type { BankItem, CollaboratorItem, Negotiation } from '../../../types.ts';
import { NEGOTIATION_STATUS_CONFIG } from './types.ts';

export type NegotiationSortField =
  | 'openDate'
  | 'clientName'
  | 'contractNumber'
  | 'bankName'
  | 'originalDebtCents'
  | 'collaboratorName'
  | 'negotiationStatus'
  | 'nextContactDate';

interface NegotiationsGridContainerProps {
  negotiations: Negotiation[];
  banks: BankItem[];
  collaborators: CollaboratorItem[];
  todayIso: string;
  showSummaryAndFilters: boolean;
  onToggleSummaryAndFilters: () => void;
  searchTerm: string;
  onSearchTermChange: (val: string) => void;
  statusFilter: string;
  onStatusFilterChange: (val: string) => void;
  bankFilter: string;
  onBankFilterChange: (val: string) => void;
  collaboratorFilter: string;
  onCollaboratorFilterChange: (val: string) => void;
  dateFromFilter: string;
  onDateFromFilterChange: (val: string) => void;
  onClearFilters: () => void;
  sortField: NegotiationSortField;
  onToggleSort: (field: NegotiationSortField) => void;
  summaryKpis: {
    total: number;
    inProgress: number;
    closed: number;
    conversionRate: number;
    totalDebtCents: number;
    totalSavingsCents: number;
    avgDiscount: number;
  };
  onNewNegotiation: () => void;
  onSelectNegotiation: (id: number) => void;
  onOpenClientModal: (neg: Negotiation) => void;
  onRequestDelete: (neg: Negotiation) => void;
}

export const NegotiationsGridContainer: React.FC<NegotiationsGridContainerProps> = ({
  negotiations,
  banks,
  collaborators,
  todayIso,
  showSummaryAndFilters,
  onToggleSummaryAndFilters,
  searchTerm,
  onSearchTermChange,
  statusFilter,
  onStatusFilterChange,
  bankFilter,
  onBankFilterChange,
  collaboratorFilter,
  onCollaboratorFilterChange,
  dateFromFilter,
  onDateFromFilterChange,
  onClearFilters,
  onToggleSort,
  summaryKpis,
  onNewNegotiation,
  onSelectNegotiation,
  onOpenClientModal,
  onRequestDelete,
}) => {
  const hasActiveFilter =
    Boolean(searchTerm) ||
    statusFilter !== 'TODOS' ||
    bankFilter !== 'TODOS' ||
    collaboratorFilter !== 'TODOS' ||
    Boolean(dateFromFilter);

  return (
    <div className="space-y-3">
      {/* Toolbar: Collapsible Summary & Filters + Primary CTA */}
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <button
          type="button"
          onClick={onToggleSummaryAndFilters}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          {showSummaryAndFilters ? (
            <ChevronDown className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
          )}
          {showSummaryAndFilters ? 'Ocultar Resumo e Filtros' : 'Exibir Resumo e Filtros'}
        </button>

        <button
          type="button"
          onClick={onNewNegotiation}
          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 transition-colors whitespace-nowrap"
        >
          <Plus className="w-4 h-4" />
          Nova Negociação
        </button>
      </div>

      {/* Collapsible KPI Strip & Filters */}
      {showSummaryAndFilters && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-4 dark:border-slate-700 dark:bg-slate-900">
          <div className="grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-slate-200 rounded-lg border border-slate-200 bg-slate-50/70 dark:divide-slate-700 dark:border-slate-700 dark:bg-slate-800/60">
            <div className="p-3.5">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Total em Negociação
              </div>
              <div className="font-mono tabular-nums text-xl font-bold text-slate-900 mt-1 dark:text-slate-100">
                {summaryKpis.total}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5 font-mono tabular-nums dark:text-slate-400">
                {summaryKpis.inProgress} ativa(s)
              </div>
            </div>

            <div className="p-3.5">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
                Acordos Fechados
              </div>
              <div className="font-mono tabular-nums text-xl font-bold text-emerald-800 mt-1 dark:text-emerald-300">
                {summaryKpis.closed}
              </div>
              <div className="text-[11px] text-emerald-700 mt-0.5 font-mono tabular-nums dark:text-emerald-300">
                Conversão: {summaryKpis.conversionRate}%
              </div>
            </div>

            <div className="p-3.5">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Volume de Dívida
              </div>
              <div className="font-mono tabular-nums text-xl font-bold text-slate-900 mt-1 dark:text-slate-100">
                {formatBRL(summaryKpis.totalDebtCents)}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5 dark:text-slate-400">Saldo original em carteira</div>
            </div>

            <div className="p-3.5">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-blue-700 dark:text-blue-300">
                Economia Projetada
              </div>
              <div className="font-mono tabular-nums text-xl font-bold text-blue-900 mt-1 dark:text-blue-300">
                {formatBRL(summaryKpis.totalSavingsCents)}
              </div>
              <div className="text-[11px] text-blue-700 mt-0.5 font-mono tabular-nums dark:text-blue-300">
                Deságio médio: {summaryKpis.avgDiscount}%
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2.5">
            <div className="lg:col-span-2 relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 dark:text-slate-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => onSearchTermChange(e.target.value)}
                placeholder="Buscar cliente, contrato ou banco..."
                className="w-full rounded-lg border border-slate-300 pl-8 pr-3 py-1.5 text-xs focus:border-blue-600 focus:outline-none dark:border-slate-600"
              />
            </div>

            <select
              value={statusFilter}
              onChange={(e) => onStatusFilterChange(e.target.value)}
              className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs text-slate-700 bg-white dark:border-slate-600 dark:text-slate-200 dark:bg-slate-900"
            >
              <option value="TODOS">Status: Todos</option>
              {Object.entries(NEGOTIATION_STATUS_CONFIG).map(([k, cfg]) => (
                <option key={k} value={k}>
                  {cfg.label}
                </option>
              ))}
            </select>

            <select
              value={bankFilter}
              onChange={(e) => onBankFilterChange(e.target.value)}
              className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs text-slate-700 bg-white dark:border-slate-600 dark:text-slate-200 dark:bg-slate-900"
            >
              <option value="TODOS">Banco: Todos</option>
              {banks.map((b) => (
                <option key={b.id} value={String(b.id)}>
                  {b.name}
                </option>
              ))}
            </select>

            <select
              value={collaboratorFilter}
              onChange={(e) => onCollaboratorFilterChange(e.target.value)}
              className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs text-slate-700 bg-white dark:border-slate-600 dark:text-slate-200 dark:bg-slate-900"
            >
              <option value="TODOS">Negociador: Todos</option>
              {collaborators.map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.name}
                </option>
              ))}
            </select>

            <div className="flex items-center gap-1.5">
              <input
                type="date"
                value={dateFromFilter}
                onChange={(e) => onDateFromFilterChange(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-[11px] font-mono bg-white dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                title="Abertura a partir de"
              />
              {hasActiveFilter && (
                <button
                  type="button"
                  onClick={onClearFilters}
                  className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-100 shrink-0 whitespace-nowrap dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Limpar
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Main Responsive Data Grid */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden dark:border-slate-700 dark:bg-slate-900">
        {/* Desktop High-Density Table */}
        <div className="hidden lg:block overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-400">
                <th onClick={() => onToggleSort('openDate')} className="px-4 py-3 cursor-pointer hover:text-slate-900 select-none dark:hover:text-white">
                  <span className="inline-flex items-center gap-1">DATA <ArrowUpDown className="w-3 h-3" /></span>
                </th>
                <th onClick={() => onToggleSort('clientName')} className="px-4 py-3 cursor-pointer hover:text-slate-900 select-none dark:hover:text-white">
                  <span className="inline-flex items-center gap-1">CLIENTE <ArrowUpDown className="w-3 h-3" /></span>
                </th>
                <th onClick={() => onToggleSort('contractNumber')} className="px-4 py-3 cursor-pointer hover:text-slate-900 select-none dark:hover:text-white">
                  <span className="inline-flex items-center gap-1">CONTRATO <ArrowUpDown className="w-3 h-3" /></span>
                </th>
                <th onClick={() => onToggleSort('bankName')} className="px-4 py-3 cursor-pointer hover:text-slate-900 select-none dark:hover:text-white">
                  <span className="inline-flex items-center gap-1">BANCO <ArrowUpDown className="w-3 h-3" /></span>
                </th>
                <th onClick={() => onToggleSort('originalDebtCents')} className="px-4 py-3 cursor-pointer hover:text-slate-900 select-none text-right dark:hover:text-white">
                  <span className="inline-flex items-center justify-end gap-1">VALOR DÍVIDA <ArrowUpDown className="w-3 h-3" /></span>
                </th>
                <th onClick={() => onToggleSort('collaboratorName')} className="px-4 py-3 cursor-pointer hover:text-slate-900 select-none dark:hover:text-white">
                  <span className="inline-flex items-center gap-1">NEGOCIADOR <ArrowUpDown className="w-3 h-3" /></span>
                </th>
                <th onClick={() => onToggleSort('negotiationStatus')} className="px-4 py-3 cursor-pointer hover:text-slate-900 select-none dark:hover:text-white">
                  <span className="inline-flex items-center gap-1">STATUS <ArrowUpDown className="w-3 h-3" /></span>
                </th>
                <th onClick={() => onToggleSort('nextContactDate')} className="px-4 py-3 cursor-pointer hover:text-slate-900 select-none dark:hover:text-white">
                  <span className="inline-flex items-center gap-1">PRÓXIMO CONTATO <ArrowUpDown className="w-3 h-3" /></span>
                </th>
                <th className="px-4 py-3 text-right">AÇÕES</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-xs dark:divide-slate-700">
              {negotiations.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-slate-500 dark:text-slate-400">
                    Nenhuma negociação encontrada. Clique em &ldquo;+ Nova Negociação&rdquo; ou selecione um título abaixo.
                  </td>
                </tr>
              ) : (
                negotiations.map((neg) => {
                  const stKey = neg.negotiationStatus || 'EM_ANDAMENTO';
                  const stCfg = NEGOTIATION_STATUS_CONFIG[stKey] || NEGOTIATION_STATUS_CONFIG.EM_ANDAMENTO;
                  const isOverdueNextContact =
                    Boolean(neg.nextContactDate) &&
                    neg.nextContactDate! < todayIso &&
                    stKey !== 'ACORDO_FECHADO' &&
                    stKey !== 'CANCELADA' &&
                    stKey !== 'ENCERRADA';

                  return (
                    <tr
                      key={neg.id}
                      onDoubleClick={() => onSelectNegotiation(neg.id)}
                      className="hover:bg-slate-50 transition-colors cursor-pointer dark:hover:bg-slate-800"
                      title="Duplo clique para abrir a Ficha Detalhada da Negociação"
                    >
                      <td className="px-4 py-3 font-mono tabular-nums text-slate-600 whitespace-nowrap dark:text-slate-300">
                        {formatDateBR(neg.openDate || neg.createdAt || '')}
                      </td>
                      <td
                        className="px-4 py-3"
                        onClick={(e) => e.stopPropagation()}
                        onDoubleClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          onClick={() => onOpenClientModal(neg)}
                          className="group inline-flex items-center gap-1.5 font-semibold text-slate-900 hover:text-blue-700 hover:underline text-left transition-colors dark:text-slate-100"
                          title="Abrir Ficha Completa do Cliente (Dados, Contratos & WhatsApp)"
                        >
                          <span>{neg.clientName}</span>
                          <User className="w-3.5 h-3.5 text-slate-400 group-hover:text-blue-600 shrink-0 dark:text-slate-400" />
                        </button>
                      </td>
                      <td className="px-4 py-3 font-mono tabular-nums text-slate-600 whitespace-nowrap dark:text-slate-300">
                        {neg.contractNumber || `CTR-${neg.id}`}
                      </td>
                      <td className="px-4 py-3 text-slate-700 whitespace-nowrap dark:text-slate-200">
                        {neg.bankName}
                      </td>
                      <td className="px-4 py-3 font-mono tabular-nums font-bold text-slate-900 text-right whitespace-nowrap dark:text-slate-100">
                        {formatBRL(neg.originalDebtCents)}
                      </td>
                      <td className="px-4 py-3 text-slate-600 whitespace-nowrap dark:text-slate-300">
                        {neg.collaboratorName}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-semibold ${stCfg.badgeClass}`}
                        >
                          <span className={`h-1.5 w-1.5 rounded-full ${stCfg.dotClass}`} />
                          {stCfg.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono tabular-nums whitespace-nowrap">
                        {neg.nextContactDate ? (
                          <span className={isOverdueNextContact ? 'font-bold text-red-600 dark:text-red-400' : 'text-slate-700 dark:text-slate-200'}>
                            {formatDateBR(neg.nextContactDate)}
                          </span>
                        ) : (
                          <span className="text-slate-400 dark:text-slate-400">—</span>
                        )}
                      </td>
                      <td
                        className="px-4 py-3 text-right whitespace-nowrap"
                        onClick={(e) => e.stopPropagation()}
                        onDoubleClick={(e) => e.stopPropagation()}
                      >
                        <div className="inline-flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => onOpenClientModal(neg)}
                            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-blue-700 dark:text-slate-400 dark:hover:bg-slate-800"
                            title="Ficha do Cliente"
                          >
                            <User className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onSelectNegotiation(neg.id)}
                            className="rounded-md p-1.5 text-blue-600 hover:bg-blue-50 hover:text-blue-800 dark:text-blue-400 dark:hover:bg-blue-950/60 dark:hover:text-blue-200"
                            title="Abrir Negociação & WhatsApp"
                          >
                            <ExternalLink className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onRequestDelete(neg)}
                            className="rounded-md p-1.5 text-red-500 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/60"
                            title="Excluir Negociação"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile & Tablet Responsive Cards */}
        <div className="lg:hidden divide-y divide-slate-200 dark:divide-slate-700">
          {negotiations.length === 0 ? (
            <div className="px-4 py-10 text-center text-xs text-slate-500 dark:text-slate-400">
              Nenhuma negociação encontrada.
            </div>
          ) : (
            negotiations.map((neg) => {
              const stKey = neg.negotiationStatus || 'EM_ANDAMENTO';
              const stCfg = NEGOTIATION_STATUS_CONFIG[stKey] || NEGOTIATION_STATUS_CONFIG.EM_ANDAMENTO;
              const isOverdueNextContact =
                Boolean(neg.nextContactDate) &&
                neg.nextContactDate! < todayIso &&
                stKey !== 'ACORDO_FECHADO' &&
                stKey !== 'CANCELADA' &&
                stKey !== 'ENCERRADA';

              return (
                <div key={neg.id} className="p-4 space-y-2.5 bg-white hover:bg-slate-50/60 dark:bg-slate-900 dark:hover:bg-slate-800/70">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <button
                        type="button"
                        onClick={() => onOpenClientModal(neg)}
                        className="font-semibold text-sm text-slate-900 hover:text-blue-700 hover:underline text-left truncate block max-w-full dark:text-slate-100"
                      >
                        {neg.clientName}
                      </button>
                      <div className="text-[11px] text-slate-500 font-mono tabular-nums mt-0.5 dark:text-slate-400">
                        {neg.bankName} · {neg.contractNumber || `CTR-${neg.id}`} · {formatDateBR(neg.openDate || neg.createdAt || '')}
                      </div>
                    </div>
                    <span
                      className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-semibold shrink-0 ${stCfg.badgeClass}`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${stCfg.dotClass}`} />
                      {stCfg.label}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs pt-1">
                    <div className="space-y-0.5">
                      <div className="font-mono tabular-nums font-bold text-slate-900 dark:text-slate-100">
                        {formatBRL(neg.originalDebtCents)}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        Negociador: {neg.collaboratorName}
                        {neg.nextContactDate && (
                          <span className={isOverdueNextContact ? ' text-red-600 font-semibold dark:text-red-400' : ''}>
                            {' '}· Retorno: {formatDateBR(neg.nextContactDate)}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => onOpenClientModal(neg)}
                        className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                      >
                        Cliente
                      </button>
                      <button
                        type="button"
                        onClick={() => onSelectNegotiation(neg.id)}
                        className="rounded-lg bg-slate-900 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-slate-800 dark:bg-emerald-600 dark:hover:bg-emerald-500"
                      >
                        Abrir Ficha
                      </button>
                      <button
                        type="button"
                        onClick={() => onRequestDelete(neg)}
                        className="rounded-lg border border-red-200 p-1.5 text-red-600 hover:bg-red-50 dark:border-red-800/70 dark:text-red-400 dark:hover:bg-red-950/60"
                        title="Excluir"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
