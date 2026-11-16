import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarClock,
  Check,
  Clock,
  Edit3,
  Gavel,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { apiFetch } from '../../../lib/api.ts';
import type {
  CollaboratorItem,
  CompanyLegalProcess,
  CompanyProcessDeadline,
  CompanyProcessHearing,
} from '../../../types.ts';
import {
  DEADLINE_TYPES,
  formatDateBR,
  HEARING_TYPES,
} from './shared.ts';

interface CompanyLegalDeadlinesPanelProps {
  processes: CompanyLegalProcess[];
  collaborators: CollaboratorItem[];
  onUpdateProcess: (updated: CompanyLegalProcess) => Promise<void>;
}

const DEADLINE_STATUS_META: Record<string, { label: string; cls: string }> = {
  PENDENTE: { label: 'Pendente', cls: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/60 dark:text-amber-200 dark:border-amber-800/70' },
  CUMPRIDO: { label: 'Cumprido', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800/70' },
  VENCIDO: { label: 'Vencido', cls: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/60 dark:text-red-300 dark:border-red-800/70' },
};

const HEARING_STATUS_META: Record<string, { label: string; cls: string }> = {
  AGENDADA: { label: 'Agendada', cls: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800/70' },
  REALIZADA: { label: 'Realizada', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800/70' },
  ADIADA: { label: 'Adiada', cls: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/60 dark:text-amber-200 dark:border-amber-800/70' },
  CANCELADA: { label: 'Cancelada', cls: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/60 dark:text-red-300 dark:border-red-800/70' },
};

const PAGE_SIZE = 10;

export const CompanyLegalDeadlinesPanel: React.FC<CompanyLegalDeadlinesPanelProps> = ({
  processes,
  collaborators,
  onUpdateProcess,
}) => {
  const [activeTab, setActiveTab] = useState<'DEADLINES' | 'HEARINGS'>('DEADLINES');

  // Deadline filters
  const [dlFilterStatus, setDlFilterStatus] = useState('');
  const [dlFilterType, setDlFilterType] = useState('');
  const [dlFilterFrom, setDlFilterFrom] = useState('');
  const [dlFilterTo, setDlFilterTo] = useState('');
  const [dlPage, setDlPage] = useState(1);

  // Hearing filters
  const [hrFilterStatus, setHrFilterStatus] = useState('');
  const [hrFilterType, setHrFilterType] = useState('');
  const [hrFilterFrom, setHrFilterFrom] = useState('');
  const [hrFilterTo, setHrFilterTo] = useState('');
  const [hrPage, setHrPage] = useState(1);

  // Deadline Modal
  const [showDeadlineModal, setShowDeadlineModal] = useState(false);
  const [editingDeadline, setEditingDeadline] = useState<{
    processId: number;
    item: CompanyProcessDeadline;
  } | null>(null);
  const [dlFormProcessId, setDlFormProcessId] = useState<string>('');
  const [dlFormDesc, setDlFormDesc] = useState('');
  const [dlFormDueDate, setDlFormDueDate] = useState('');
  const [dlFormType, setDlFormType] = useState<CompanyProcessDeadline['type']>('OUTRO');
  const [dlFormStatus, setDlFormStatus] = useState<CompanyProcessDeadline['status']>('PENDENTE');
  const [dlFormRespId, setDlFormRespId] = useState<string>('');
  const [dlFormNotes, setDlFormNotes] = useState('');

  // Hearing Modal
  const [showHearingModal, setShowHearingModal] = useState(false);
  const [editingHearing, setEditingHearing] = useState<{
    processId: number;
    item: CompanyProcessHearing;
  } | null>(null);
  const [hrFormProcessId, setHrFormProcessId] = useState<string>('');
  const [hrFormDate, setHrFormDate] = useState('');
  const [hrFormTime, setHrFormTime] = useState('');
  const [hrFormType, setHrFormType] = useState<CompanyProcessHearing['type']>('INICIAL');
  const [hrFormStatus, setHrFormStatus] = useState<CompanyProcessHearing['status']>('AGENDADA');
  const [hrFormLocation, setHrFormLocation] = useState('');
  const [hrFormNotes, setHrFormNotes] = useState('');

  const [confirmDelete, setConfirmDelete] = useState<{
    kind: 'dl' | 'hr';
    processId: number;
    id: string | number;
    label: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const sentAlertsRef = useRef<Set<string>>(new Set());

  const allDeadlines = useMemo(() => {
    const out: Array<{ process: CompanyLegalProcess; deadline: CompanyProcessDeadline }> = [];
    for (const p of processes) {
      for (const dl of p.deadlines || []) {
        out.push({ process: p, deadline: dl });
      }
    }
    return out.sort((a, b) => a.deadline.dueDate.localeCompare(b.deadline.dueDate));
  }, [processes]);

  const allHearings = useMemo(() => {
    const out: Array<{ process: CompanyLegalProcess; hearing: CompanyProcessHearing }> = [];
    for (const p of processes) {
      for (const hr of p.hearings || []) {
        out.push({ process: p, hearing: hr });
      }
    }
    return out.sort((a, b) => {
      const cmp = a.hearing.date.localeCompare(b.hearing.date);
      return cmp !== 0 ? cmp : (a.hearing.time || '').localeCompare(b.hearing.time || '');
    });
  }, [processes]);

  // Automated 7 / 5 / 3 day alerts to internal messages
  useEffect(() => {
    if (processes.length === 0) return;
    const todayUtc = new Date().toISOString().slice(0, 10);
    const todayMs = new Date(`${todayUtc}T00:00:00Z`).getTime();
    const lines: string[] = [];
    const newKeys: string[] = [];

    for (const { process, deadline } of allDeadlines) {
      if (deadline.status !== 'PENDENTE' || !deadline.dueDate) continue;
      const targetMs = new Date(`${deadline.dueDate.slice(0, 10)}T00:00:00Z`).getTime();
      const diffDays = Math.round((targetMs - todayMs) / 86_400_000);
      if (diffDays === 7 || diffDays === 5 || diffDays === 3) {
        const k = `dl-${deadline.id}-${diffDays}`;
        if (!sentAlertsRef.current.has(k)) {
          newKeys.push(k);
          lines.push(
            `• Prazo (${deadline.type}) no proc. ${process.processNumber}: "${deadline.description}" vence em ${diffDays} dia(s) (${formatDateBR(deadline.dueDate)}).`
          );
        }
      }
    }

    for (const { process, hearing } of allHearings) {
      if (hearing.status !== 'AGENDADA' || !hearing.date) continue;
      const targetMs = new Date(`${hearing.date.slice(0, 10)}T00:00:00Z`).getTime();
      const diffDays = Math.round((targetMs - todayMs) / 86_400_000);
      if (diffDays === 7 || diffDays === 5 || diffDays === 3) {
        const k = `hr-${hearing.id}-${diffDays}`;
        if (!sentAlertsRef.current.has(k)) {
          newKeys.push(k);
          lines.push(
            `• Audiência (${hearing.type}) no proc. ${process.processNumber} ocorre em ${diffDays} dia(s) (${formatDateBR(hearing.date)} às ${hearing.time}).`
          );
        }
      }
    }

    if (lines.length > 0) {
      newKeys.forEach((k) => sentAlertsRef.current.add(k));
      void apiFetch('/api/company-legal/deadline-alerts', {
        method: 'POST',
        body: JSON.stringify({ summaryText: lines.join('\n') }),
      }).catch(() => {});
    }
  }, [allDeadlines, allHearings, processes.length]);

  const filteredDeadlines = useMemo(() => {
    return allDeadlines.filter(({ deadline }) => {
      if (dlFilterStatus && deadline.status !== dlFilterStatus) return false;
      if (dlFilterType && deadline.type !== dlFilterType) return false;
      if (dlFilterFrom && deadline.dueDate < dlFilterFrom) return false;
      if (dlFilterTo && deadline.dueDate > dlFilterTo) return false;
      return true;
    });
  }, [allDeadlines, dlFilterStatus, dlFilterType, dlFilterFrom, dlFilterTo]);

  const filteredHearings = useMemo(() => {
    return allHearings.filter(({ hearing }) => {
      if (hrFilterStatus && hearing.status !== hrFilterStatus) return false;
      if (hrFilterType && hearing.type !== hrFilterType) return false;
      if (hrFilterFrom && hearing.date < hrFilterFrom) return false;
      if (hrFilterTo && hearing.date > hrFilterTo) return false;
      return true;
    });
  }, [allHearings, hrFilterStatus, hrFilterType, hrFilterFrom, hrFilterTo]);

  const openNewDeadline = () => {
    setEditingDeadline(null);
    setDlFormProcessId(processes[0] ? String(processes[0].id) : '');
    setDlFormDesc('');
    setDlFormDueDate('');
    setDlFormType('OUTRO');
    setDlFormStatus('PENDENTE');
    setDlFormRespId('');
    setDlFormNotes('');
    setShowDeadlineModal(true);
  };

  const openEditDeadline = (proc: CompanyLegalProcess, dl: CompanyProcessDeadline) => {
    setEditingDeadline({ processId: proc.id, item: dl });
    setDlFormProcessId(String(proc.id));
    setDlFormDesc(dl.description);
    setDlFormDueDate(dl.dueDate);
    setDlFormType(dl.type);
    setDlFormStatus(dl.status);
    setDlFormRespId(dl.responsibleId ? String(dl.responsibleId) : '');
    setDlFormNotes(dl.notes || '');
    setShowDeadlineModal(true);
  };

  const handleSaveDeadlineModal = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetProc = processes.find((p) => String(p.id) === dlFormProcessId);
    if (!targetProc || !dlFormDesc || !dlFormDueDate) return;
    setBusy(true);
    try {
      const nextDeadlines = editingDeadline
        ? (targetProc.deadlines || []).map((d) =>
            d.id === editingDeadline.item.id
              ? {
                  ...d,
                  description: dlFormDesc,
                  dueDate: dlFormDueDate,
                  type: dlFormType,
                  status: dlFormStatus,
                  responsibleId: dlFormRespId ? Number(dlFormRespId) : null,
                  notes: dlFormNotes || undefined,
                }
              : d
          )
        : [
            ...(targetProc.deadlines || []),
            {
              id: `dl-${Date.now()}`,
              processId: targetProc.id,
              description: dlFormDesc,
              dueDate: dlFormDueDate,
              type: dlFormType,
              status: dlFormStatus,
              responsibleId: dlFormRespId ? Number(dlFormRespId) : null,
              notes: dlFormNotes || undefined,
            },
          ];
      await onUpdateProcess({ ...targetProc, deadlines: nextDeadlines });
      setShowDeadlineModal(false);
    } finally {
      setBusy(false);
    }
  };

  const handleMarkDeadlineCompleted = async (proc: CompanyLegalProcess, dlId: string | number) => {
    setBusy(true);
    try {
      const next = (proc.deadlines || []).map((d) =>
        d.id === dlId ? { ...d, status: 'CUMPRIDO' as const } : d
      );
      await onUpdateProcess({ ...proc, deadlines: next });
    } finally {
      setBusy(false);
    }
  };

  const openNewHearing = () => {
    setEditingHearing(null);
    setHrFormProcessId(processes[0] ? String(processes[0].id) : '');
    setHrFormDate('');
    setHrFormTime('');
    setHrFormType('INICIAL');
    setHrFormStatus('AGENDADA');
    setHrFormLocation('');
    setHrFormNotes('');
    setShowHearingModal(true);
  };

  const openEditHearing = (proc: CompanyLegalProcess, hr: CompanyProcessHearing) => {
    setEditingHearing({ processId: proc.id, item: hr });
    setHrFormProcessId(String(proc.id));
    setHrFormDate(hr.date);
    setHrFormTime(hr.time);
    setHrFormType(hr.type);
    setHrFormStatus(hr.status);
    setHrFormLocation(hr.location || '');
    setHrFormNotes(hr.notes || '');
    setShowHearingModal(true);
  };

  const handleSaveHearingModal = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetProc = processes.find((p) => String(p.id) === hrFormProcessId);
    if (!targetProc || !hrFormDate || !hrFormTime) return;
    setBusy(true);
    try {
      const nextHearings = editingHearing
        ? (targetProc.hearings || []).map((h) =>
            h.id === editingHearing.item.id
              ? {
                  ...h,
                  date: hrFormDate,
                  time: hrFormTime,
                  type: hrFormType,
                  status: hrFormStatus,
                  location: hrFormLocation || undefined,
                  notes: hrFormNotes || undefined,
                }
              : h
          )
        : [
            ...(targetProc.hearings || []),
            {
              id: `hr-${Date.now()}`,
              processId: targetProc.id,
              date: hrFormDate,
              time: hrFormTime,
              type: hrFormType,
              status: hrFormStatus,
              location: hrFormLocation || undefined,
              notes: hrFormNotes || undefined,
            },
          ];
      await onUpdateProcess({ ...targetProc, hearings: nextHearings });
      setShowHearingModal(false);
    } finally {
      setBusy(false);
    }
  };

  const handleQuickHearingStatus = async (
    proc: CompanyLegalProcess,
    hrId: string | number,
    nextStatus: 'REALIZADA' | 'ADIADA'
  ) => {
    setBusy(true);
    try {
      const next = (proc.hearings || []).map((h) =>
        h.id === hrId ? { ...h, status: nextStatus } : h
      );
      await onUpdateProcess({ ...proc, hearings: next });
    } finally {
      setBusy(false);
    }
  };

  const executeConfirmDelete = async () => {
    if (!confirmDelete) return;
    const proc = processes.find((p) => p.id === confirmDelete.processId);
    if (!proc) return;
    setBusy(true);
    try {
      if (confirmDelete.kind === 'dl') {
        const next = (proc.deadlines || []).filter((d) => d.id !== confirmDelete.id);
        await onUpdateProcess({ ...proc, deadlines: next });
      } else {
        const next = (proc.hearings || []).filter((h) => h.id !== confirmDelete.id);
        await onUpdateProcess({ ...proc, hearings: next });
      }
      setConfirmDelete(null);
    } finally {
      setBusy(false);
    }
  };

  const dlTotalPages = Math.max(1, Math.ceil(filteredDeadlines.length / PAGE_SIZE));
  const dlPaged = filteredDeadlines.slice((dlPage - 1) * PAGE_SIZE, dlPage * PAGE_SIZE);

  const hrTotalPages = Math.max(1, Math.ceil(filteredHearings.length / PAGE_SIZE));
  const hrPaged = filteredHearings.slice((hrPage - 1) * PAGE_SIZE, hrPage * PAGE_SIZE);

  const todayIso = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-4">
      {/* Header & Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('DEADLINES')}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-xs font-semibold ${
              activeTab === 'DEADLINES'
                ? 'border-slate-900 bg-slate-900 text-white dark:border-emerald-500 dark:bg-emerald-600'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800'
            }`}
          >
            <CalendarClock className="w-3.5 h-3.5" />
            Prazos ({allDeadlines.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('HEARINGS')}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-xs font-semibold ${
              activeTab === 'HEARINGS'
                ? 'border-slate-900 bg-slate-900 text-white dark:border-emerald-500 dark:bg-emerald-600'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800'
            }`}
          >
            <Gavel className="w-3.5 h-3.5" />
            Audiências ({allHearings.length})
          </button>
        </div>

        <div>
          {activeTab === 'DEADLINES' ? (
            <button
              type="button"
              onClick={openNewDeadline}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-emerald-600 dark:hover:bg-emerald-500"
            >
              <Plus className="w-4 h-4 text-emerald-400" /> Novo Prazo
            </button>
          ) : (
            <button
              type="button"
              onClick={openNewHearing}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-emerald-600 dark:hover:bg-emerald-500"
            >
              <Plus className="w-4 h-4 text-emerald-400" /> Nova Audiência
            </button>
          )}
        </div>
      </div>

      {confirmDelete && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-3 flex flex-wrap items-center justify-between gap-2 text-xs dark:border-red-800/70 dark:bg-red-950/50">
          <span className="font-semibold text-red-800 dark:text-red-300">{confirmDelete.label}</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void executeConfirmDelete()}
              className="rounded-lg bg-red-600 px-3 py-1 font-semibold text-white hover:bg-red-700"
            >
              Confirmar exclusão
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(null)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1 font-semibold text-slate-700 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* TAB: PRAZOS */}
      {activeTab === 'DEADLINES' && (
        <div className="space-y-3">
          <div className="rounded-xl border border-slate-200 bg-white p-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 text-xs dark:border-slate-700 dark:bg-slate-900">
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">Status</label>
              <select
                value={dlFilterStatus}
                onChange={(e) => {
                  setDlFilterStatus(e.target.value);
                  setDlPage(1);
                }}
                className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              >
                <option value="">Todos</option>
                <option value="PENDENTE">Pendente</option>
                <option value="CUMPRIDO">Cumprido</option>
                <option value="VENCIDO">Vencido</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">Tipo</label>
              <select
                value={dlFilterType}
                onChange={(e) => {
                  setDlFilterType(e.target.value);
                  setDlPage(1);
                }}
                className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              >
                <option value="">Todos</option>
                {DEADLINE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">De</label>
              <input
                type="date"
                value={dlFilterFrom}
                onChange={(e) => {
                  setDlFilterFrom(e.target.value);
                  setDlPage(1);
                }}
                className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 dark:border-slate-700"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">Até</label>
              <input
                type="date"
                value={dlFilterTo}
                onChange={(e) => {
                  setDlFilterTo(e.target.value);
                  setDlPage(1);
                }}
                className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden dark:border-slate-700 dark:bg-slate-900">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-300">
                    <th className="px-3 py-2.5">Processo</th>
                    <th className="px-3 py-2.5">Descrição</th>
                    <th className="px-3 py-2.5">Tipo</th>
                    <th className="px-3 py-2.5">Data Limite</th>
                    <th className="px-3 py-2.5">Responsável</th>
                    <th className="px-3 py-2.5">Status</th>
                    <th className="px-3 py-2.5 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {dlPaged.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-slate-400 dark:text-slate-400">
                        Nenhum prazo encontrado
                      </td>
                    </tr>
                  ) : (
                    dlPaged.map(({ process, deadline }) => {
                      const isVisualOverdue =
                        deadline.status === 'PENDENTE' && deadline.dueDate && deadline.dueDate < todayIso;
                      const stMeta = isVisualOverdue
                        ? DEADLINE_STATUS_META.VENCIDO
                        : DEADLINE_STATUS_META[deadline.status] || DEADLINE_STATUS_META.PENDENTE;
                      const respName = deadline.responsibleId
                        ? collaborators.find((c) => c.id === deadline.responsibleId)?.name || '—'
                        : '—';

                      return (
                        <tr key={`${process.id}-${deadline.id}`} className="hover:bg-slate-50/70 dark:hover:bg-slate-800">
                          <td className="px-3 py-2.5 font-mono text-[11px] font-semibold text-slate-900 whitespace-nowrap dark:text-slate-100">
                            {process.processNumber}
                          </td>
                          <td className="px-3 py-2.5 text-slate-800 max-w-[240px] dark:text-slate-100">
                            <div className="font-medium truncate" title={deadline.description}>
                              {deadline.description}
                            </div>
                          </td>
                          <td className="px-3 py-2.5 whitespace-nowrap text-slate-600 dark:text-slate-300">{deadline.type}</td>
                          <td className="px-3 py-2.5 whitespace-nowrap tabular-nums text-slate-700 dark:text-slate-200">
                            {formatDateBR(deadline.dueDate)}
                          </td>
                          <td className="px-3 py-2.5 text-slate-600 dark:text-slate-300">{respName}</td>
                          <td className="px-3 py-2.5 whitespace-nowrap">
                            <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${stMeta.cls}`}>
                              {stMeta.label}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-right whitespace-nowrap space-x-1">
                            {deadline.status === 'PENDENTE' && (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void handleMarkDeadlineCompleted(process, deadline.id)}
                                title="Marcar como Cumprido"
                                className="inline-flex items-center gap-1 rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800/70 dark:bg-emerald-950/50 dark:text-emerald-300 dark:hover:bg-emerald-900/60"
                              >
                                <Check className="w-3 h-3" /> Cumprido
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => openEditDeadline(process, deadline)}
                              title="Editar"
                              className="p-1.5 rounded border border-slate-200 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                            >
                              <Edit3 className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setConfirmDelete({
                                  kind: 'dl',
                                  processId: process.id,
                                  id: deadline.id,
                                  label: 'Excluir este prazo?',
                                })
                              }
                              title="Excluir"
                              className="p-1.5 rounded border border-red-200 text-red-700 hover:bg-red-50 dark:border-red-800/70 dark:text-red-300 dark:hover:bg-red-950/60"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {filteredDeadlines.length > PAGE_SIZE && (
              <div className="px-4 py-2.5 border-t border-slate-200 bg-slate-50 flex items-center justify-between text-xs dark:border-slate-700 dark:bg-slate-800/70">
                <span className="text-slate-500 dark:text-slate-400">
                  Página {dlPage} de {dlTotalPages}
                </span>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    disabled={dlPage <= 1}
                    onClick={() => setDlPage((p) => Math.max(1, p - 1))}
                    className="rounded border border-slate-200 bg-white px-2.5 py-1 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900"
                  >
                    Anterior
                  </button>
                  <button
                    type="button"
                    disabled={dlPage >= dlTotalPages}
                    onClick={() => setDlPage((p) => Math.min(dlTotalPages, p + 1))}
                    className="rounded border border-slate-200 bg-white px-2.5 py-1 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900"
                  >
                    Próxima
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB: AUDIÊNCIAS */}
      {activeTab === 'HEARINGS' && (
        <div className="space-y-3">
          <div className="rounded-xl border border-slate-200 bg-white p-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 text-xs dark:border-slate-700 dark:bg-slate-900">
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">Status</label>
              <select
                value={hrFilterStatus}
                onChange={(e) => {
                  setHrFilterStatus(e.target.value);
                  setHrPage(1);
                }}
                className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              >
                <option value="">Todos</option>
                <option value="AGENDADA">Agendada</option>
                <option value="REALIZADA">Realizada</option>
                <option value="ADIADA">Adiada</option>
                <option value="CANCELADA">Cancelada</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">Tipo</label>
              <select
                value={hrFilterType}
                onChange={(e) => {
                  setHrFilterType(e.target.value);
                  setHrPage(1);
                }}
                className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              >
                <option value="">Todos</option>
                {HEARING_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">De</label>
              <input
                type="date"
                value={hrFilterFrom}
                onChange={(e) => {
                  setHrFilterFrom(e.target.value);
                  setHrPage(1);
                }}
                className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 dark:border-slate-700"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">Até</label>
              <input
                type="date"
                value={hrFilterTo}
                onChange={(e) => {
                  setHrFilterTo(e.target.value);
                  setHrPage(1);
                }}
                className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden dark:border-slate-700 dark:bg-slate-900">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-300">
                    <th className="px-3 py-2.5">Processo</th>
                    <th className="px-3 py-2.5">Data/Hora</th>
                    <th className="px-3 py-2.5">Tipo</th>
                    <th className="px-3 py-2.5">Local</th>
                    <th className="px-3 py-2.5">Status</th>
                    <th className="px-3 py-2.5 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {hrPaged.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-slate-400 dark:text-slate-400">
                        Nenhuma audiência encontrada
                      </td>
                    </tr>
                  ) : (
                    hrPaged.map(({ process, hearing }) => {
                      const stMeta =
                        HEARING_STATUS_META[hearing.status] || HEARING_STATUS_META.AGENDADA;
                      return (
                        <tr key={`${process.id}-${hearing.id}`} className="hover:bg-slate-50/70 dark:hover:bg-slate-800">
                          <td className="px-3 py-2.5 font-mono text-[11px] font-semibold text-slate-900 whitespace-nowrap dark:text-slate-100">
                            {process.processNumber}
                          </td>
                          <td className="px-3 py-2.5 whitespace-nowrap tabular-nums text-slate-800 dark:text-slate-100">
                            {formatDateBR(hearing.date)} às {hearing.time}
                          </td>
                          <td className="px-3 py-2.5 text-slate-700 dark:text-slate-200">{hearing.type}</td>
                          <td className="px-3 py-2.5 text-slate-600 max-w-[200px] truncate dark:text-slate-300">
                            {hearing.location || '—'}
                          </td>
                          <td className="px-3 py-2.5 whitespace-nowrap">
                            <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${stMeta.cls}`}>
                              {stMeta.label}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-right whitespace-nowrap space-x-1">
                            {hearing.status === 'AGENDADA' && (
                              <>
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => void handleQuickHearingStatus(process, hearing.id, 'REALIZADA')}
                                  title="Marcar como Realizada"
                                  className="inline-flex items-center gap-1 rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800/70 dark:bg-emerald-950/50 dark:text-emerald-300 dark:hover:bg-emerald-900/60"
                                >
                                  <Check className="w-3 h-3" /> Realizada
                                </button>
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => void handleQuickHearingStatus(process, hearing.id, 'ADIADA')}
                                  title="Marcar como Adiada"
                                  className="inline-flex items-center gap-1 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] font-bold text-amber-800 hover:bg-amber-100 dark:border-amber-800/70 dark:bg-amber-950/50 dark:text-amber-300 dark:hover:bg-amber-900/60"
                                >
                                  <Clock className="w-3 h-3" /> Adiada
                                </button>
                              </>
                            )}
                            <button
                              type="button"
                              onClick={() => openEditHearing(process, hearing)}
                              title="Editar"
                              className="p-1.5 rounded border border-slate-200 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                            >
                              <Edit3 className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setConfirmDelete({
                                  kind: 'hr',
                                  processId: process.id,
                                  id: hearing.id,
                                  label: 'Excluir esta audiência?',
                                })
                              }
                              title="Excluir"
                              className="p-1.5 rounded border border-red-200 text-red-700 hover:bg-red-50 dark:border-red-800/70 dark:text-red-300 dark:hover:bg-red-950/60"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {filteredHearings.length > PAGE_SIZE && (
              <div className="px-4 py-2.5 border-t border-slate-200 bg-slate-50 flex items-center justify-between text-xs dark:border-slate-700 dark:bg-slate-800/70">
                <span className="text-slate-500 dark:text-slate-400">
                  Página {hrPage} de {hrTotalPages}
                </span>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    disabled={hrPage <= 1}
                    onClick={() => setHrPage((p) => Math.max(1, p - 1))}
                    className="rounded border border-slate-200 bg-white px-2.5 py-1 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900"
                  >
                    Anterior
                  </button>
                  <button
                    type="button"
                    disabled={hrPage >= hrTotalPages}
                    onClick={() => setHrPage((p) => Math.min(hrTotalPages, p + 1))}
                    className="rounded border border-slate-200 bg-white px-2.5 py-1 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900"
                  >
                    Próxima
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal Novo / Editar Prazo */}
      {showDeadlineModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 dark:bg-slate-950/80" role="dialog" aria-modal="true">
          <form
            onSubmit={handleSaveDeadlineModal}
            className="w-full max-w-lg max-h-[90vh] rounded-2xl border border-slate-200 bg-white shadow-2xl flex flex-col overflow-hidden dark:border-slate-700 dark:bg-slate-900"
          >
            <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between bg-slate-50 dark:border-slate-700 dark:bg-slate-800/70">
              <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                {editingDeadline ? 'Editar Prazo' : 'Novo Prazo'}
              </h4>
              <button type="button" onClick={() => setShowDeadlineModal(false)} className="p-1 text-slate-400 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 overflow-y-auto space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Processo *</label>
                <select
                  disabled={Boolean(editingDeadline)}
                  value={dlFormProcessId}
                  onChange={(e) => setDlFormProcessId(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 disabled:bg-slate-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                >
                  <option value="">Selecione...</option>
                  {processes.map((p) => (
                    <option key={p.id} value={String(p.id)}>
                      {p.processNumber} — {p.opposingParty || 'Sem parte adversa'}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Descrição *</label>
                <input
                  type="text"
                  required
                  value={dlFormDesc}
                  onChange={(e) => setDlFormDesc(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Data Limite *</label>
                  <input
                    type="date"
                    required
                    value={dlFormDueDate}
                    onChange={(e) => setDlFormDueDate(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Tipo</label>
                  <select
                    value={dlFormType}
                    onChange={(e) => setDlFormType(e.target.value as CompanyProcessDeadline['type'])}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                  >
                    {DEADLINE_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Status</label>
                  <select
                    value={dlFormStatus}
                    onChange={(e) => setDlFormStatus(e.target.value as CompanyProcessDeadline['status'])}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                  >
                    <option value="PENDENTE">Pendente</option>
                    <option value="CUMPRIDO">Cumprido</option>
                    <option value="VENCIDO">Vencido</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Responsável</label>
                <select
                  value={dlFormRespId}
                  onChange={(e) => setDlFormRespId(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                >
                  <option value="">Nenhum</option>
                  {collaborators.map((c) => (
                    <option key={c.id} value={String(c.id)}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Observações</label>
                <textarea
                  rows={3}
                  value={dlFormNotes}
                  onChange={(e) => setDlFormNotes(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
            </div>
            <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex justify-end gap-2 text-xs dark:border-slate-700 dark:bg-slate-800/70">
              <button
                type="button"
                onClick={() => setShowDeadlineModal(false)}
                className="rounded-lg border border-slate-300 bg-white px-4 py-1.5 font-semibold text-slate-700 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={busy || !dlFormProcessId || !dlFormDesc || !dlFormDueDate}
                className="rounded-lg bg-slate-900 px-4 py-1.5 font-semibold text-white hover:bg-slate-800 disabled:opacity-40 dark:bg-emerald-600 dark:hover:bg-emerald-500"
              >
                {busy ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal Nova / Editar Audiência */}
      {showHearingModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 dark:bg-slate-950/80" role="dialog" aria-modal="true">
          <form
            onSubmit={handleSaveHearingModal}
            className="w-full max-w-lg max-h-[90vh] rounded-2xl border border-slate-200 bg-white shadow-2xl flex flex-col overflow-hidden dark:border-slate-700 dark:bg-slate-900"
          >
            <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between bg-slate-50 dark:border-slate-700 dark:bg-slate-800/70">
              <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                {editingHearing ? 'Editar Audiência' : 'Nova Audiência'}
              </h4>
              <button type="button" onClick={() => setShowHearingModal(false)} className="p-1 text-slate-400 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 overflow-y-auto space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Processo *</label>
                <select
                  disabled={Boolean(editingHearing)}
                  value={hrFormProcessId}
                  onChange={(e) => setHrFormProcessId(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 disabled:bg-slate-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                >
                  <option value="">Selecione...</option>
                  {processes.map((p) => (
                    <option key={p.id} value={String(p.id)}>
                      {p.processNumber} — {p.opposingParty || 'Sem parte adversa'}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Data *</label>
                  <input
                    type="date"
                    required
                    value={hrFormDate}
                    onChange={(e) => setHrFormDate(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Hora *</label>
                  <input
                    type="time"
                    required
                    value={hrFormTime}
                    onChange={(e) => setHrFormTime(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Tipo</label>
                  <select
                    value={hrFormType}
                    onChange={(e) => setHrFormType(e.target.value as CompanyProcessHearing['type'])}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                  >
                    {HEARING_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Status</label>
                  <select
                    value={hrFormStatus}
                    onChange={(e) => setHrFormStatus(e.target.value as CompanyProcessHearing['status'])}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                  >
                    <option value="AGENDADA">Agendada</option>
                    <option value="REALIZADA">Realizada</option>
                    <option value="ADIADA">Adiada</option>
                    <option value="CANCELADA">Cancelada</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Local</label>
                <input
                  type="text"
                  value={hrFormLocation}
                  onChange={(e) => setHrFormLocation(e.target.value)}
                  placeholder="Ex: Fórum Central, Sala 301"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-600"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Observações</label>
                <textarea
                  rows={3}
                  value={hrFormNotes}
                  onChange={(e) => setHrFormNotes(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
            </div>
            <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex justify-end gap-2 text-xs dark:border-slate-700 dark:bg-slate-800/70">
              <button
                type="button"
                onClick={() => setShowHearingModal(false)}
                className="rounded-lg border border-slate-300 bg-white px-4 py-1.5 font-semibold text-slate-700 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={busy || !hrFormProcessId || !hrFormDate || !hrFormTime}
                className="rounded-lg bg-slate-900 px-4 py-1.5 font-semibold text-white hover:bg-slate-800 disabled:opacity-40 dark:bg-emerald-600 dark:hover:bg-emerald-500"
              >
                {busy ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
