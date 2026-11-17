import React, { useEffect, useMemo, useState } from 'react';
import { History, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { apiFetch, formatDateTimeBR } from '../../../lib/api.ts';

interface AuditHistoryEvent {
  id: number;
  userId: number | null;
  userName: string;
  action: string;
  entityType: string;
  entityId: string;
  changes?: Array<{
    field: string;
    label?: string;
    previousLabel?: string;
    newLabel?: string;
    previousValue?: string;
    newValue?: string;
    from?: string;
    to?: string;
  }>;
  details: {
    description?: string;
    changes?: Array<{
      field: string;
      label?: string;
      previousLabel?: string;
      newLabel?: string;
      previousValue?: string;
      newValue?: string;
      from?: string;
      to?: string;
    }>;
  };
  createdAt: string;
}

interface FlatAuditRow {
  rowKey: string;
  createdAt: string;
  userName: string;
  action: string;
  newLabel: string;
  newValue: string;
  previousLabel: string;
  previousValue: string;
}

interface CompanyLegalAuditHistoryModalProps {
  open: boolean;
  processId: number | null;
  processNumber: string;
  onClose: () => void;
}

const ACTION_LABELS: Record<string, { label: string; cls: string }> = {
  PROCESS_CREATED: { label: 'Inclusão', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800/70' },
  PROCESS_UPDATED: { label: 'Alteração', cls: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800/70' },
  PROCESS_DELETED: { label: 'Exclusão', cls: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/60 dark:text-red-300 dark:border-red-800/70' },
};

const PAGE_SIZE = 20;

export const CompanyLegalAuditHistoryModal: React.FC<CompanyLegalAuditHistoryModalProps> = ({
  open,
  processId,
  processNumber,
  onClose,
}) => {
  const [events, setEvents] = useState<AuditHistoryEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);

  useEffect(() => {
    if (!open || !processId) return;
    let active = true;
    setEvents([]);
    setPage(1);
    setLoading(true);
    apiFetch<{ logs: AuditHistoryEvent[] }>(`/api/company-legal/processes/${processId}/audit-history?limit=2000`)
      .then((res) => {
        if (active) setEvents(Array.isArray(res.logs) ? res.logs : []);
      })
      .catch(() => {
        if (active) setEvents([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, processId]);

  const flatRows = useMemo<FlatAuditRow[]>(() => {
    const sorted = [...events].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    const out: FlatAuditRow[] = [];
    for (const ev of sorted) {
      const changes =
        Array.isArray(ev.changes) && ev.changes.length > 0
          ? ev.changes
          : Array.isArray(ev.details?.changes)
          ? ev.details.changes
          : [];
      const isInsert = String(ev.action || '').toUpperCase().includes('INSERT') || String(ev.action || '').toUpperCase().includes('CREATED');
      const isDelete = String(ev.action || '').toUpperCase().includes('DELETE');
      if (changes.length > 0) {
        changes.forEach((ch, idx) => {
          const lbl = ch.label || ch.field || 'Campo';
          const prevV = String(ch.previousValue ?? ch.from ?? '—');
          const nextV = String(ch.newValue ?? ch.to ?? '—');
          out.push({
            rowKey: `${ev.id}-${idx}`,
            createdAt: ev.createdAt,
            userName: ev.userName || 'Sistema',
            action: ev.action,
            newLabel: ch.newLabel || (isDelete ? '— (Removido)' : lbl),
            newValue: nextV,
            previousLabel: ch.previousLabel || (isInsert ? '— (Novo registro)' : lbl),
            previousValue: prevV,
          });
        });
      } else {
        out.push({
          rowKey: `${ev.id}-summary`,
          createdAt: ev.createdAt,
          userName: ev.userName || 'Sistema',
          action: ev.action,
          newLabel: 'Registro',
          newValue: ev.details?.description || ev.action,
          previousLabel: isInsert ? '— (Novo registro)' : 'Registro',
          previousValue: '—',
        });
      }
    }
    return out;
  }, [events]);

  if (!open) return null;

  const totalPages = Math.max(1, Math.ceil(flatRows.length / PAGE_SIZE));
  const paged = flatRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Histórico de Movimentações"
    >
      <div
        className="w-full max-w-6xl max-h-[90vh] rounded-2xl border border-slate-200 bg-white shadow-2xl flex flex-col overflow-hidden dark:border-slate-700 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between gap-3 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/70">
          <div className="flex items-center gap-2 min-w-0">
            <History className="w-4 h-4 text-slate-600 shrink-0 dark:text-slate-300" />
            <h3 className="font-display text-sm font-bold text-slate-900 truncate dark:text-slate-100">
              Auditoria Acumulativa · <span className="font-mono">{processNumber}</span>
            </h3>
            <span className="rounded border border-slate-300 bg-white px-2 py-0.5 text-[10px] font-bold uppercase text-slate-600 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300">
              Somente Leitura
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-slate-700"
            aria-label="Fechar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-4">
          {loading ? (
            <div className="py-12 text-center text-xs text-slate-500 dark:text-slate-400">Carregando histórico...</div>
          ) : flatRows.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-400 dark:text-slate-400">
              Nenhuma movimentação registrada para este item
            </div>
          ) : (
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-300">
                  <th className="px-3 py-2 whitespace-nowrap">Usuário</th>
                  <th className="px-3 py-2 whitespace-nowrap">Data e Horário</th>
                  <th className="px-3 py-2 whitespace-nowrap">Campo Alterado (Label)</th>
                  <th className="px-3 py-2">Conteúdo da Alteração</th>
                  <th className="px-3 py-2 whitespace-nowrap">Campo Anterior (Label)</th>
                  <th className="px-3 py-2">Valor Campo Anterior</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {paged.map((r) => {
                  const act = ACTION_LABELS[r.action] || {
                    label: r.action,
                    cls: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700',
                  };
                  return (
                    <tr key={r.rowKey} className="hover:bg-slate-50/70 dark:hover:bg-slate-800">
                      <td className="px-3 py-2 align-top whitespace-nowrap">
                        <div className="font-semibold text-slate-800 dark:text-slate-100">{r.userName}</div>
                        <span className={`mt-0.5 inline-block rounded border px-1.5 py-0.5 text-[10px] font-semibold ${act.cls}`}>
                          {act.label}
                        </span>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap tabular-nums text-slate-600 align-top dark:text-slate-300">
                        {formatDateTimeBR(r.createdAt)}
                      </td>
                      <td className="px-3 py-2 font-semibold text-slate-900 align-top dark:text-slate-100">{r.newLabel}</td>
                      <td className="px-3 py-2 text-emerald-700 bg-emerald-50/40 max-w-[220px] break-words font-medium align-top dark:bg-emerald-950/20 dark:text-emerald-300" title={r.newValue}>
                        {r.newValue}
                      </td>
                      <td className="px-3 py-2 font-medium text-slate-700 align-top dark:text-slate-300">{r.previousLabel}</td>
                      <td className="px-3 py-2 text-red-700 bg-red-50/40 max-w-[220px] break-words align-top dark:bg-red-950/20 dark:text-red-300" title={r.previousValue}>
                        {r.previousValue}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-2 text-xs dark:border-slate-700 dark:bg-slate-800/70">
          <div className="text-slate-500 dark:text-slate-400">
            {events.length} evento(s) de auditoria · {flatRows.length} linha(s) detalhada(s)
          </div>
          <div className="flex items-center gap-2">
            {totalPages > 1 && (
              <div className="flex items-center gap-1 mr-2">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2.5 py-1 text-slate-700 hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <ChevronLeft className="w-3.5 h-3.5" /> Anterior
                </button>
                <span className="px-2 tabular-nums font-medium text-slate-600 dark:text-slate-300">
                  {page} / {totalPages}
                </span>
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2.5 py-1 text-slate-700 hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  Próxima <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-300 bg-white px-4 py-1.5 font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Fechar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
