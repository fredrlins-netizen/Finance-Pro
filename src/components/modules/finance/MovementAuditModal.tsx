import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, History, X } from 'lucide-react';
import { apiFetch, formatDateTimeBR } from '../../../lib/api.ts';

interface AuditChangeEntry {
  field: string;
  label?: string;
  previousLabel?: string;
  newLabel?: string;
  previousValue?: string;
  newValue?: string;
  from: string;
  to: string;
}

interface RawAuditLog {
  id: number;
  userName: string;
  action: string;
  entityType: string;
  entityId: string;
  changes?: AuditChangeEntry[];
  details?: {
    changes?: AuditChangeEntry[];
    [key: string]: unknown;
  };
  createdAt: string;
}

interface ExpandedAuditRow {
  rowKey: string;
  createdAt: string;
  userName: string;
  action: string;
  newLabel: string;
  newValue: string;
  previousLabel: string;
  previousValue: string;
}

interface MovementAuditModalProps {
  open: boolean;
  movementId: number | null;
  movementDescription: string;
  onClose: () => void;
}

const PAGE_SIZE = 15;

export const MovementAuditModal: React.FC<MovementAuditModalProps> = ({
  open,
  movementId,
  movementDescription,
  onClose,
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [rawLogs, setRawLogs] = useState<RawAuditLog[]>([]);
  const [page, setPage] = useState(1);

  useEffect(() => {
    if (!open || !movementId) return;
    setLoading(true);
    setError('');
    setPage(1);
    apiFetch<{ logs: RawAuditLog[] }>(`/api/cadastros/audit/bank_movement/${movementId}?limit=2000`)
      .then((res) => setRawLogs(res.logs || []))
      .catch((err) => setError(err instanceof Error ? err.message : 'Erro ao carregar histórico.'))
      .finally(() => setLoading(false));
  }, [open, movementId]);

  const expandedRows = useMemo<ExpandedAuditRow[]>(() => {
    const out: ExpandedAuditRow[] = [];
    for (const log of rawLogs) {
      const changes =
        Array.isArray(log.changes) && log.changes.length > 0
          ? log.changes
          : Array.isArray(log.details?.changes)
          ? log.details!.changes
          : [];
      const isInsert = String(log.action || '').toUpperCase().includes('INSERT');
      const isDelete = String(log.action || '').toUpperCase().includes('DELETE');
      if (changes.length > 0) {
        changes.forEach((ch, idx) => {
          const lbl = ch.label || ch.field || '-';
          const prevVal = String(ch.previousValue ?? ch.from ?? '—');
          const nextVal = String(ch.newValue ?? ch.to ?? '—');
          out.push({
            rowKey: `${log.id}-${idx}`,
            createdAt: log.createdAt,
            userName: log.userName || 'Sistema',
            action: log.action,
            newLabel: ch.newLabel || (isDelete ? '— (Removido)' : lbl),
            newValue: nextVal,
            previousLabel: ch.previousLabel || (isInsert ? '— (Novo registro)' : lbl),
            previousValue: prevVal,
          });
        });
      } else {
        out.push({
          rowKey: `${log.id}-0`,
          createdAt: log.createdAt,
          userName: log.userName || 'Sistema',
          action: log.action,
          newLabel: 'Registro',
          newValue: log.details ? JSON.stringify(log.details) : log.action,
          previousLabel: isInsert ? '— (Novo registro)' : 'Registro',
          previousValue: '—',
        });
      }
    }
    return out;
  }, [rawLogs]);

  if (!open) return null;

  const totalPages = Math.max(1, Math.ceil(expandedRows.length / PAGE_SIZE));
  const pagedRows = expandedRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const eventCounterText = rawLogs.length > 99 ? '99+' : String(rawLogs.length);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 dark:bg-slate-950/80"
      onClick={onClose}
    >
      <div
        className="w-full max-w-6xl rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl space-y-4 text-xs max-h-[88vh] flex flex-col dark:border-slate-700 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
          <div className="flex items-center gap-2 min-w-0">
            <History className="w-4 h-4 text-slate-700 shrink-0 dark:text-slate-200" />
            <h3 className="font-display text-sm font-bold text-slate-900 truncate dark:text-slate-100">
              Auditoria Acumulativa · {movementDescription}
            </h3>
            {!loading && (
              <span className="font-mono text-[11px] font-bold rounded bg-slate-100 px-2 py-0.5 text-slate-700 shrink-0 dark:bg-slate-800 dark:text-slate-200">
                {eventCounterText} eventos
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar histórico"
            className="rounded-lg p-1 text-slate-400 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-auto scroll-rulers border border-slate-200 rounded-xl dark:border-slate-700">
          {loading ? (
            <div className="py-10 text-center text-slate-500 dark:text-slate-400">Carregando histórico de auditoria...</div>
          ) : error ? (
            <div className="m-4 rounded-lg bg-red-50 border border-red-200 p-3 text-red-700 dark:bg-red-950/50 dark:border-red-800/70 dark:text-red-300">{error}</div>
          ) : pagedRows.length === 0 ? (
            <div className="py-10 text-center text-slate-500 dark:text-slate-400">
              Nenhuma movimentação registrada na auditoria para este lançamento.
            </div>
          ) : (
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-[11px] font-semibold text-slate-600 border-b border-slate-200 sticky top-0 dark:bg-slate-800/70 dark:text-slate-300 dark:border-slate-700">
                <tr>
                  <th className="px-3 py-2.5 whitespace-nowrap">Usuário</th>
                  <th className="px-3 py-2.5 whitespace-nowrap">Data e Horário</th>
                  <th className="px-3 py-2.5 whitespace-nowrap">Campo Alterado (Label)</th>
                  <th className="px-3 py-2.5">Conteúdo da Alteração</th>
                  <th className="px-3 py-2.5 whitespace-nowrap">Campo Anterior (Label)</th>
                  <th className="px-3 py-2.5">Valor Campo Anterior</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {pagedRows.map((row) => (
                  <tr key={row.rowKey} className="hover:bg-slate-50 dark:hover:bg-slate-800">
                    <td className="px-3 py-2 align-top">
                      <div className="font-semibold text-slate-800 dark:text-slate-100">{row.userName}</div>
                      <div className="font-mono text-[10px] text-slate-500 dark:text-slate-400">{row.action}</div>
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px] text-slate-600 whitespace-nowrap align-top dark:text-slate-300">
                      {formatDateTimeBR(row.createdAt)}
                    </td>
                    <td className="px-3 py-2 font-semibold text-slate-900 align-top dark:text-slate-100">{row.newLabel}</td>
                    <td className="px-3 py-2 font-mono font-semibold text-emerald-800 bg-emerald-50/40 max-w-[220px] break-words align-top dark:bg-emerald-950/20 dark:text-emerald-300" title={row.newValue}>
                      {row.newValue}
                    </td>
                    <td className="px-3 py-2 font-medium text-slate-700 align-top dark:text-slate-300">{row.previousLabel}</td>
                    <td className="px-3 py-2 font-mono text-red-700 bg-red-50/40 max-w-[220px] break-words align-top dark:bg-red-950/20 dark:text-red-300" title={row.previousValue}>
                      {row.previousValue}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              Anterior
            </button>
            <span className="font-mono text-[11px] text-slate-600 dark:text-slate-300">
              Página {page} de {totalPages}
            </span>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Próxima
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-slate-900 px-4 py-1.5 font-semibold text-white hover:bg-slate-800 dark:bg-emerald-600 dark:hover:bg-emerald-500"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
};
