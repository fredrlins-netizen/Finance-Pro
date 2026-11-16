import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight, ClipboardCheck, FileStack, Scale, Search, User, X } from 'lucide-react';
import { apiFetch, formatBRL } from '../lib/api.ts';
import { Admission, Client, LegalProcess, ModuleId, NavigationIntent } from '../types.ts';

interface GlobalSearchModalProps {
  open: boolean;
  onClose: () => void;
  onNavigate: (mod: ModuleId, intent?: NavigationIntent) => void;
}

export const GlobalSearchModal: React.FC<GlobalSearchModalProps> = ({
  open,
  onClose,
  onNavigate,
}) => {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [clients, setClients] = useState<Client[]>([]);
  const [admissions, setAdmissions] = useState<Admission[]>([]);
  const [processes, setProcesses] = useState<LegalProcess[]>([]);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    Promise.all([
      apiFetch<{ clients: Client[]; admissions: Admission[] }>('/api/clients').catch(() => ({
        clients: [],
        admissions: [],
      })),
      apiFetch<{ processes: LegalProcess[] }>('/api/legal').catch(() => ({ processes: [] })),
    ])
      .then(([cData, lData]) => {
        setClients(cData.clients || []);
        setAdmissions(cData.admissions || []);
        setProcesses(lData.processes || []);
      })
      .finally(() => setLoading(false));
  }, [open]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matchedClients = clients
      .filter(
        (c) =>
          !q ||
          c.fullName.toLowerCase().includes(q) ||
          c.cpfCnpj.toLowerCase().includes(q) ||
          (c.phone || '').toLowerCase().includes(q)
      )
      .slice(0, 6);

    const matchedAdmissions = admissions
      .filter((a) => {
        if (!q) return true;
        const cl = clients.find((c) => c.id === a.clientId);
        return (
          a.protocolCode.toLowerCase().includes(q) ||
          a.bankName.toLowerCase().includes(q) ||
          a.contractNumber.toLowerCase().includes(q) ||
          (cl?.fullName || '').toLowerCase().includes(q)
        );
      })
      .slice(0, 5);

    const matchedProcesses = processes
      .filter((p) => {
        if (!q) return true;
        const cl = clients.find((c) => c.id === p.clientId);
        return (
          p.processNumber.toLowerCase().includes(q) ||
          (cl?.fullName || '').toLowerCase().includes(q)
        );
      })
      .slice(0, 4);

    return { matchedClients, matchedAdmissions, matchedProcesses };
  }, [query, clients, admissions, processes]);

  if (!open) return null;

  const jump = (mod: ModuleId, intent?: NavigationIntent) => {
    onNavigate(mod, intent);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/50 dark:bg-slate-950/75 backdrop-blur-xs p-4 pt-[8vh]">
      <div className="w-full max-w-2xl rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-200 dark:border-slate-700">
          <Search className="w-4 h-4 text-slate-400 shrink-0 dark:text-slate-400" />
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar cliente, CPF/CNPJ, protocolo (FP-...), banco ou processo judicial..."
            className="flex-1 bg-transparent text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar busca"
            className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200 dark:text-slate-400"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="max-h-[65vh] overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
          {loading ? (
            <div className="p-6 text-center text-xs text-slate-500 dark:text-slate-400">
              Indexando clientes, protocolos e processos...
            </div>
          ) : (
            <>
              {/* Clients */}
              <div className="p-3">
                <div className="px-2 pb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                  Clientes & Titulares ({results.matchedClients.length})
                </div>
                {results.matchedClients.length === 0 ? (
                  <p className="px-2 py-2 text-xs text-slate-400 dark:text-slate-500">Nenhum cliente encontrado.</p>
                ) : (
                  <div className="space-y-1">
                    {results.matchedClients.map((c) => (
                      <div
                        key={c.id}
                        className="flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs"
                      >
                        <button
                          type="button"
                          onClick={() => jump('admission', { clientId: c.id, tab: 'clientes' })}
                          className="flex items-center gap-2.5 text-left min-w-0 flex-1"
                        >
                          <User className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
                          <div className="min-w-0">
                            <div className="font-semibold text-slate-900 dark:text-slate-100 truncate">{c.fullName}</div>
                            <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400 truncate">
                              {c.cpfCnpj} · {c.city}/{c.state} · {c.status}
                            </div>
                          </div>
                        </button>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => jump('appointments', { clientId: c.id, triggerNew: true })}
                            className="rounded-md border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/60 px-2 py-1 text-[11px] font-semibold text-emerald-800 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/70"
                          >
                            Agendar
                          </button>
                          <button
                            type="button"
                            onClick={() => jump('admission', { clientId: c.id, tab: 'clientes' })}
                            className="rounded-md border border-slate-200 dark:border-slate-700 px-2 py-1 text-[11px] font-semibold text-slate-700 dark:text-slate-200 hover:bg-white dark:hover:bg-slate-700"
                          >
                            Dossiê
                          </button>
                          <button
                            type="button"
                            onClick={() => jump('finance', { clientId: c.id })}
                            className="rounded-md border border-slate-200 dark:border-slate-700 px-2 py-1 text-[11px] font-semibold text-slate-700 dark:text-slate-200 hover:bg-white dark:hover:bg-slate-700"
                          >
                            Boletos
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Admissions */}
              <div className="p-3">
                <div className="px-2 pb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                  Fichas de Admissão & Auditoria ({results.matchedAdmissions.length})
                </div>
                <div className="space-y-1">
                  {results.matchedAdmissions.map((a) => {
                    const cl = clients.find((c) => c.id === a.clientId);
                    const isPendingAudit =
                      a.status === 'aguardando_auditoria' || a.status === 'devolvida_admissao';
                    return (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() =>
                          jump(isPendingAudit ? 'audit' : 'admission', {
                            clientId: a.clientId,
                            admissionId: a.id,
                          })
                        }
                        className="w-full flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 hover:bg-slate-50 dark:hover:bg-slate-800 text-left text-xs"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          {isPendingAudit ? (
                            <ClipboardCheck className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                          ) : (
                            <FileStack className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                          )}
                          <div className="min-w-0">
                            <div className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                              <span className="font-mono">{a.protocolCode}</span> · {cl?.fullName || a.bankName}
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                              {a.bankName} · {formatBRL(a.debtAmountCents)} · {a.status.replace(/_/g, ' ')}
                            </div>
                          </div>
                        </div>
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-700 dark:text-blue-400 shrink-0">
                          {isPendingAudit ? 'Auditar' : 'Abrir'}
                          <ArrowRight className="w-3 h-3" />
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Processes */}
              <div className="p-3">
                <div className="px-2 pb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                  Processos Jurídicos ({results.matchedProcesses.length})
                </div>
                <div className="space-y-1">
                  {results.matchedProcesses.map((p) => {
                    const cl = clients.find((c) => c.id === p.clientId);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => jump('legal', { processId: p.id, clientId: p.clientId })}
                        className="w-full flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 hover:bg-slate-50 dark:hover:bg-slate-800 text-left text-xs"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <Scale className="w-4 h-4 text-slate-700 dark:text-slate-300 shrink-0" />
                          <div className="min-w-0">
                            <div className="font-mono font-semibold text-slate-900 dark:text-slate-100 truncate">
                              {p.processNumber}
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                              {cl?.fullName || 'Cliente'} · {p.courtName}
                            </div>
                          </div>
                        </div>
                        <span className="text-[11px] font-semibold text-blue-700 dark:text-blue-400 shrink-0">
                          {p.hasUnreadMovement ? 'Nova mov.' : 'Abrir'} →
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
