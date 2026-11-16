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
  details: {
    description?: string;
    changes?: Array<{ field: string; label?: string; from?: string; to?: string }>;
  };
  createdAt: string;
}

interface FlatAuditRow {
  rowKey: string;
  createdAt: string;
  userName: string;
  action: string;
  fieldLabel: string;
  fromVal: string;
  toVal: string;
}

interface CompanyLegalAuditHistoryModalProps {
  open: boolean;
  processId: number | null;
  processNumber: string;
  onClose: () => void;
}

const ACTION_LABELS: Record<string, { label: string; cls: string }> = {
  PROCESS_CREATED: { label: 'Inclusão', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  PROCESS_UPDATED: { label: 'Alteração', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  PROCESS_DELETED: { label: 'Exclusão', cls: 'bg-red-50 text-red-700 border-red-200' },
};

const PAGE_SIZE = 15;

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
    apiFetch<{ logs: AuditHistoryEvent[] }>(`/api/company-legal/processes/${processId}/audit-history?limit=500`)
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
      const changes = Array.isArray(ev.details?.changes) ? ev.details.changes : [];
      if (changes.length > 0) {
        changes.forEach((ch, idx) => {
          out.push({
            rowKey: `${ev.id}-${idx}`,
            createdAt: ev.createdAt,
            userName: ev.userName || 'Sistema',
            action: ev.action,
            fieldLabel: ch.label || ch.field,
            fromVal: ch.from ?? '—',
            toVal: ch.to ?? '—',
          });
        });
      } else {
        out.push({
          rowKey: `${ev.id}-summary`,
          createdAt: ev.createdAt,
          userName: ev.userName || 'Sistema',
          action: ev.action,
          fieldLabel: 'Registro',
          fromVal: '—',
          toVal: ev.details?.description || ev.action,
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
        className="w-full max-w-5xl max-h-[90vh] rounded-2xl border border-slate-200 bg-white shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between gap-3 bg-slate-50">
          <div className="flex items-center gap-2 min-w-0">
            <History className="w-4 h-4 text-slate-600 shrink-0" />
            <h3 className="font-display text-sm font-bold text-slate-900 truncate">
              Histórico de Movimentações · <span className="font-mono">{processNumber}</span>
            </h3>
            <span className="rounded border border-slate-300 bg-white px-2 py-0.5 text-[10px] font-bold uppercase text-slate-600">
              Somente Leitura
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200"
            aria-label="Fechar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-4">
          {loading ? (
            <div className="py-12 text-center text-xs text-slate-500">Carregando histórico...</div>
          ) : flatRows.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-400">
              Nenhuma movimentação registrada para este item
            </div>
          ) : (
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] font-semibold text-slate-500">
                  <th className="px-3 py-2">Data/Hora</th>
                  <th className="px-3 py-2">Usuário</th>
                  <th className="px-3 py-2">Ação</th>
                  <th className="px-3 py-2">Campo</th>
                  <th className="px-3 py-2">De</th>
                  <th className="px-2 py-2 text-center">→</th>
                  <th className="px-3 py-2">Para</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {paged.map((r) => {
                  const act = ACTION_LABELS[r.action] || {
                    label: r.action,
                    cls: 'bg-slate-100 text-slate-700 border-slate-200',
                  };
                  return (
                    <tr key={r.rowKey} className="hover:bg-slate-50/70">
                      <td className="px-3 py-2 whitespace-nowrap tabular-nums text-slate-600">
                        {formatDateTimeBR(r.createdAt)}
                      </td>
                      <td className="px-3 py-2 font-medium text-slate-800 whitespace-nowrap">
                        {r.userName}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-semibold ${act.cls}`}>
                          {act.label}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-semibold text-slate-700">{r.fieldLabel}</td>
                      <td className="px-3 py-2 text-red-700 max-w-[200px] truncate" title={r.fromVal}>
                        {r.fromVal}
                      </td>
                      <td className="px-2 py-2 text-center text-slate-400">→</td>
                      <td className="px-3 py-2 text-emerald-700 max-w-[220px] truncate font-medium" title={r.toVal}>
                        {r.toVal}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="text-slate-500">
            {events.length} evento(s) de auditoria · {flatRows.length} linha(s) detalhada(s)
          </div>
          <div className="flex items-center gap-2">
            {totalPages > 1 && (
              <div className="flex items-center gap-1 mr-2">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2.5 py-1 text-slate-700 hover:bg-slate-100 disabled:opacity-40"
                >
                  <ChevronLeft className="w-3.5 h-3.5" /> Anterior
                </button>
                <span className="px-2 tabular-nums font-medium text-slate-600">
                  {page} / {totalPages}
                </span>
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2.5 py-1 text-slate-700 hover:bg-slate-100 disabled:opacity-40"
                >
                  Próxima <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-300 bg-white px-4 py-1.5 font-semibold text-slate-700 hover:bg-slate-100"
            >
              Fechar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
