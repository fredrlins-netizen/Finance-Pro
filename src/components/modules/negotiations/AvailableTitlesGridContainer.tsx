import React from 'react';
import { DollarSign, Search, User } from 'lucide-react';
import { formatBRL, formatDateBR } from '../../../lib/api.ts';
import type { AvailableTitleRow } from './types.ts';

interface AvailableTitlesGridContainerProps {
  titles: AvailableTitleRow[];
  totalCount: number;
  totalAvailableBalanceCents: number;
  search: string;
  onSearchChange: (val: string) => void;
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  todayIso: string;
  onStartNegotiation: (title: AvailableTitleRow) => void;
  onOpenClientModal: (title: AvailableTitleRow) => void;
}

export const AvailableTitlesGridContainer: React.FC<AvailableTitlesGridContainerProps> = ({
  titles,
  totalCount,
  totalAvailableBalanceCents,
  search,
  onSearchChange,
  page,
  totalPages,
  onPageChange,
  todayIso,
  onStartNegotiation,
  onOpenClientModal,
}) => {
  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <DollarSign className="w-4 h-4 text-emerald-600" />
          <h2 className="font-display font-bold uppercase tracking-wider text-slate-800">
            Títulos a Receber Disponíveis para Negociação
          </h2>
          <span className="font-mono tabular-nums font-bold text-slate-700">
            · {totalCount}
          </span>
          <span className="text-[11px] text-slate-400 hidden sm:inline">
            (Duplo clique para iniciar negociação)
          </span>
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Buscar cliente ou documento..."
            className="w-full rounded-lg border border-slate-300 pl-8 pr-3 py-1.5 text-xs focus:border-blue-600 focus:outline-none"
          />
        </div>
      </div>

      {/* Desktop Table */}
      <div className="hidden lg:block overflow-x-auto max-h-96">
        <table className="w-full text-left border-collapse">
          <thead className="sticky top-0 z-10 bg-slate-50 border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-4 py-2.5">DOCUMENTO</th>
              <th className="px-4 py-2.5">PARC.</th>
              <th className="px-4 py-2.5">CLIENTE</th>
              <th className="px-4 py-2.5">VENCIMENTO</th>
              <th className="px-4 py-2.5 text-right">VALOR ORIGINAL</th>
              <th className="px-4 py-2.5 text-right">SALDO ATUAL</th>
              <th className="px-4 py-2.5 text-center">SITUAÇÃO</th>
              <th className="px-4 py-2.5 text-right">AÇÃO</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 text-xs">
            {titles.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
                  Nenhum título disponível encontrado para o filtro informado.
                </td>
              </tr>
            ) : (
              titles.map((t) => {
                const dueIso = String(t.dueDate || '').slice(0, 10);
                const isOverdue = Boolean(dueIso) && dueIso < todayIso;
                const isParcial = String(t.status).toUpperCase() === 'PARCIAL';

                return (
                  <tr
                    key={t.id}
                    onDoubleClick={() => onStartNegotiation(t)}
                    className="hover:bg-slate-50 dark:hover:bg-slate-800/70 transition-colors cursor-pointer"
                    title="Duplo clique para iniciar negociação"
                  >
                    <td className="px-4 py-2.5 font-mono tabular-nums font-semibold text-slate-700 whitespace-nowrap">
                      <span>{t.documentNumber || t.titleCode}</span>
                      {t.hasActiveNegotiation && (
                        <span className="ml-2 text-[10px] font-sans font-semibold text-amber-700">
                          · Em negociação
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 font-mono tabular-nums text-slate-500 whitespace-nowrap">
                      {t.installmentNumber}/{t.totalInstallments}
                    </td>
                    <td
                      className="px-4 py-2.5"
                      onClick={(e) => e.stopPropagation()}
                      onDoubleClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        onClick={() => onOpenClientModal(t)}
                        className="group inline-flex items-center gap-1.5 font-semibold text-slate-900 hover:text-blue-700 hover:underline text-left transition-colors"
                      >
                        <span>{t.clientName}</span>
                        <User className="w-3.5 h-3.5 text-slate-400 group-hover:text-blue-600 shrink-0" />
                      </button>
                    </td>
                    <td
                      className={`px-4 py-2.5 font-mono tabular-nums whitespace-nowrap ${
                        isOverdue ? 'font-bold text-red-600' : 'text-slate-700'
                      }`}
                    >
                      {formatDateBR(t.dueDate)}
                    </td>
                    <td className="px-4 py-2.5 font-mono tabular-nums text-right text-slate-600 whitespace-nowrap">
                      {formatBRL(t.originalValueCents || t.amountCents)}
                    </td>
                    <td className="px-4 py-2.5 font-mono tabular-nums font-bold text-right text-red-600 whitespace-nowrap">
                      {formatBRL(t.currentBalanceCents || t.amountCents)}
                    </td>
                    <td className="px-4 py-2.5 text-center whitespace-nowrap">
                      <span
                        className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-semibold ${
                          isParcial
                            ? 'bg-amber-50 text-amber-700 border-amber-200'
                            : 'bg-blue-50 text-blue-700 border-blue-200'
                        }`}
                      >
                        {isParcial ? 'Parcial' : 'Em Aberto'}
                      </span>
                    </td>
                    <td
                      className="px-4 py-2.5 text-right whitespace-nowrap"
                      onClick={(e) => e.stopPropagation()}
                      onDoubleClick={(e) => e.stopPropagation()}
                    >
                      <div className="inline-flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => onOpenClientModal(t)}
                          className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-blue-700"
                          title="Abrir Ficha do Cliente"
                        >
                          <User className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onStartNegotiation(t)}
                          className="rounded-lg bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700 whitespace-nowrap"
                        >
                          Negociar
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

      {/* Mobile Cards */}
      <div className="lg:hidden divide-y divide-slate-200">
        {titles.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-slate-500">
            Nenhum título disponível encontrado.
          </div>
        ) : (
          titles.map((t) => {
            const dueIso = String(t.dueDate || '').slice(0, 10);
            const isOverdue = Boolean(dueIso) && dueIso < todayIso;
            return (
              <div key={t.id} className="p-3.5 space-y-2 bg-white">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <button
                      type="button"
                      onClick={() => onOpenClientModal(t)}
                      className="font-semibold text-xs text-slate-900 hover:text-blue-700 hover:underline text-left"
                    >
                      {t.clientName}
                    </button>
                    <div className="text-[11px] text-slate-500 font-mono tabular-nums mt-0.5">
                      {t.documentNumber || t.titleCode} · Parc. {t.installmentNumber}/{t.totalInstallments} · Venc:{' '}
                      <span className={isOverdue ? 'text-red-600 font-bold' : ''}>{formatDateBR(t.dueDate)}</span>
                    </div>
                  </div>
                  <div className="text-right font-mono tabular-nums">
                    <div className="text-xs font-bold text-red-600">
                      {formatBRL(t.currentBalanceCents || t.amountCents)}
                    </div>
                    {t.hasActiveNegotiation && (
                      <div className="text-[10px] font-sans font-semibold text-amber-700">Em negociação</div>
                    )}
                  </div>
                </div>
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => onOpenClientModal(t)}
                    className="rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-700"
                  >
                    Cliente
                  </button>
                  <button
                    type="button"
                    onClick={() => onStartNegotiation(t)}
                    className="rounded-lg bg-emerald-600 px-3 py-1 text-[11px] font-semibold text-white"
                  >
                    Negociar
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Footer Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-4 py-2.5 text-xs text-slate-600">
        <div className="flex items-center gap-3">
          <span>
            Mostrando <strong className="font-mono tabular-nums">{titles.length}</strong> de{' '}
            <strong className="font-mono tabular-nums">{totalCount}</strong> títulos
          </span>
          {totalPages > 1 && (
            <div className="inline-flex items-center gap-1">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => onPageChange(Math.max(1, page - 1))}
                className="rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-semibold disabled:opacity-40"
              >
                Anterior
              </button>
              <span className="font-mono tabular-nums text-[11px] px-1">
                {page}/{totalPages}
              </span>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => onPageChange(Math.min(totalPages, page + 1))}
                className="rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-semibold disabled:opacity-40"
              >
                Próxima
              </button>
            </div>
          )}
        </div>

        <div className="font-semibold text-slate-700">
          Total Disponível:{' '}
          <strong className="font-mono tabular-nums text-red-600">
            {formatBRL(totalAvailableBalanceCents)}
          </strong>
        </div>
      </div>
    </div>
  );
};
