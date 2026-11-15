import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, History, X } from 'lucide-react';
import { apiFetch, formatDateTimeBR } from '../../../lib/api.ts';

interface AuditChangeEntry {
  field: string;
  from: string;
  to: string;
}

interface RawAuditLog {
  id: number;
  userName: string;
  action: string;
  entityType: string;
  entityId: string;
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
  field: string;
  from: string;
  to: string;
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
    apiFetch<{ logs: RawAuditLog[] }>(`/api/cadastros/audit/bank_movement/${movementId}`)
      .then((res) => setRawLogs(res.logs || []))
      .catch((err) => setError(err instanceof Error ? err.message : 'Erro ao carregar histórico.'))
      .finally(() => setLoading(false));
  }, [open, movementId]);

  const expandedRows = useMemo<ExpandedAuditRow[]>(() => {
    const out: ExpandedAuditRow[] = [];
    for (const log of rawLogs) {
      const changes = Array.isArray(log.details?.changes) ? log.details!.changes : [];
      if (changes.length > 0) {
        changes.forEach((ch, idx) => {
          out.push({
            rowKey: `${log.id}-${idx}`,
            createdAt: log.createdAt,
            userName: log.userName,
            action: log.action,
            field: ch.field || '-',
            from: ch.from || '-',
            to: ch.to || '-',
          });
        });
      } else {
        out.push({
          rowKey: `${log.id}-0`,
          createdAt: log.createdAt,
          userName: log.userName,
          action: log.action,
          field: 'Registro',
          from: '-',
          to: log.details ? JSON.stringify(log.details) : log.action,
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-4xl rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl space-y-4 text-xs max-h-[88vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2 min-w-0">
            <History className="w-4 h-4 text-slate-700 shrink-0" />
            <h3 className="font-display text-sm font-bold text-slate-900 truncate">
              Histórico de Movimentações · {movementDescription}
            </h3>
            {!loading && (
              <span className="font-mono text-[11px] font-bold rounded bg-slate-100 px-2 py-0.5 text-slate-700 shrink-0">
                {eventCounterText} eventos
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar histórico"
            className="rounded-lg p-1 text-slate-400 hover:text-slate-700"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-auto scroll-rulers border border-slate-200 rounded-xl">
          {loading ? (
            <div className="py-10 text-center text-slate-500">Carregando histórico de auditoria...</div>
          ) : error ? (
            <div className="m-4 rounded-lg bg-red-50 border border-red-200 p-3 text-red-700">{error}</div>
          ) : pagedRows.length === 0 ? (
            <div className="py-10 text-center text-slate-500">
              Nenhuma movimentação registrada na auditoria para este lançamento.
            </div>
          ) : (
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-[11px] font-semibold text-slate-600 border-b border-slate-200 sticky top-0">
                <tr>
                  <th className="px-3 py-2.5">Data/Hora</th>
                  <th className="px-3 py-2.5">Usuário</th>
                  <th className="px-3 py-2.5">Ação</th>
                  <th className="px-3 py-2.5">Campo</th>
                  <th className="px-3 py-2.5">De</th>
                  <th className="px-2 py-2.5 text-center">→</th>
                  <th className="px-3 py-2.5">Para</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pagedRows.map((row) => (
                  <tr key={row.rowKey} className="hover:bg-slate-50">
                    <td className="px-3 py-2 font-mono text-[11px] text-slate-600 whitespace-nowrap">
                      {formatDateTimeBR(row.createdAt)}
                    </td>
                    <td className="px-3 py-2 font-semibold text-slate-800">{row.userName}</td>
                    <td className="px-3 py-2 font-mono text-[11px] text-slate-700">{row.action}</td>
                    <td className="px-3 py-2 font-semibold text-slate-700">{row.field}</td>
                    <td className="px-3 py-2 text-slate-500 max-w-[160px] truncate" title={row.from}>
                      {row.from}
                    </td>
                    <td className="px-2 py-2 text-center text-slate-400">→</td>
                    <td className="px-3 py-2 font-medium text-slate-900 max-w-[180px] truncate" title={row.to}>
                      {row.to}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-slate-100">
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              Anterior
            </button>
            <span className="font-mono text-[11px] text-slate-600">
              Página {page} de {totalPages}
            </span>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >
              Próxima
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-slate-900 px-4 py-1.5 font-semibold text-white hover:bg-slate-800"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
};
