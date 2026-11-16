import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  Calendar,
  Check,
  Clock,
  Filter,
  History,
  MapPin,
  Search,
  User,
  UserCheck,
  Video,
  X,
} from 'lucide-react';
import { apiFetch, formatBRL, formatDateTimeBR } from '../../../lib/api.ts';
import {
  Appointment,
  ScheduleCollaboratorNode,
  ScheduleServiceItem,
  ScheduleStatusColors,
  Unit,
} from '../../../types.ts';
import {
  getStatusMeta,
  minutesToTimeKey,
  STATUS_OPTIONS,
  timeToMinutes,
  toDateKey,
  toTimeKey,
} from './appointmentsHelpers.ts';

interface SearchClientOption {
  id: number;
  fullName: string;
  cpfCnpj: string;
  phone: string;
  whatsapp: string;
  email: string;
  unitId: number;
  status: string;
}

export interface AppointmentModalDraft {
  mode: 'create' | 'edit';
  appointmentId?: number;
  clientId?: number | null;
  clientName?: string;
  clientPhone?: string;
  serviceId?: number | null;
  collaboratorId?: number | null;
  collaboratorName?: string;
  unitId: number;
  date: string;
  startTime: string;
  endTime: string;
  modality: string;
  status: string;
  notes: string;
  waitlistId?: number | null;
  useQueueRotation?: boolean;
  createdByName?: string;
  updatedByName?: string;
}

// =============================================================================
// 1. MODAL NOVO / EDITAR AGENDAMENTO
// =============================================================================
export const AppointmentFormModal: React.FC<{
  open: boolean;
  draft: AppointmentModalDraft | null;
  units: Unit[];
  services: ScheduleServiceItem[];
  collaborators: ScheduleCollaboratorNode[];
  onClose: () => void;
  onSaved: (msg: string) => Promise<void>;
  onOpenAudit: (apptId: number, label: string) => void;
}> = ({
  open,
  draft,
  units,
  services,
  collaborators,
  onClose,
  onSaved,
  onOpenAudit,
}) => {
  const [clientQuery, setClientQuery] = useState('');
  const [clientResults, setClientResults] = useState<SearchClientOption[]>([]);
  const [searchingClients, setSearchingClients] = useState(false);
  const [selectedClient, setSelectedClient] = useState<{
    id: number | null;
    fullName: string;
    phone: string;
    cpfCnpj?: string;
  } | null>(null);

  const [serviceId, setServiceId] = useState<string>('');
  const [unitId, setUnitId] = useState<number>(units[0]?.id || 1);
  const [collaboratorId, setCollaboratorId] = useState<string>('');
  const [date, setDate] = useState('');
  const [startTime, setStartTime] = useState('08:00');
  const [endTime, setEndTime] = useState('08:30');
  const [modality, setModality] = useState('');
  const [status, setStatus] = useState('agendado');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!open || !draft) return;
    setErr('');
    setClientQuery('');
    setClientResults([]);

    if (draft.clientId) {
      setSelectedClient({
        id: draft.clientId,
        fullName: draft.clientName || `Cliente #${draft.clientId}`,
        phone: draft.clientPhone || '',
      });
    } else if (draft.clientName) {
      setSelectedClient({
        id: null,
        fullName: draft.clientName,
        phone: draft.clientPhone || '',
      });
    } else {
      setSelectedClient(null);
    }

    const defaultSrv =
      services.find((s) => s.id === draft.serviceId) ||
      services.find((s) => s.active) ||
      services[0];
    setServiceId(defaultSrv ? String(defaultSrv.id) : '');
    setUnitId(draft.unitId || units[0]?.id || 1);
    setCollaboratorId(draft.collaboratorId ? String(draft.collaboratorId) : '');
    setDate(draft.date || toDateKey(new Date()));
    const st = draft.startTime || '08:00';
    setStartTime(st);
    if (draft.endTime) {
      setEndTime(draft.endTime);
    } else {
      const dur = defaultSrv?.durationMinutes || 30;
      setEndTime(minutesToTimeKey(timeToMinutes(st) + dur));
    }
    setModality(draft.modality || '');
    setStatus(draft.status || 'agendado');
    setNotes(draft.notes || '');
  }, [open, draft, services, units]);

  useEffect(() => {
    if (!open || selectedClient) return;
    const q = clientQuery.trim();
    if (q.length < 2) {
      setClientResults([]);
      return;
    }
    const timer = setTimeout(() => {
      setSearchingClients(true);
      apiFetch<{ clients: SearchClientOption[] }>(
        `/api/appointments/clients-search?q=${encodeURIComponent(q)}`
      )
        .then((res) => setClientResults(res.clients || []))
        .catch(() => setClientResults([]))
        .finally(() => setSearchingClients(false));
    }, 240);
    return () => clearTimeout(timer);
  }, [open, clientQuery, selectedClient]);

  if (!open || !draft) return null;

  const isEdit = draft.mode === 'edit' && Boolean(draft.appointmentId);

  const handleServiceChange = (nextId: string) => {
    setServiceId(nextId);
    const srv = services.find((s) => s.id === Number(nextId));
    if (srv && startTime) {
      setEndTime(minutesToTimeKey(timeToMinutes(startTime) + (srv.durationMinutes || 30)));
    }
  };

  const handleStartTimeChange = (nextStart: string) => {
    setStartTime(nextStart);
    const srv = services.find((s) => s.id === Number(serviceId));
    const dur = srv?.durationMinutes || Math.max(15, timeToMinutes(endTime) - timeToMinutes(startTime) || 30);
    setEndTime(minutesToTimeKey(timeToMinutes(nextStart) + dur));
  };

  const assignedCollabObj =
    collaborators.find((c) => c.id === Number(collaboratorId)) ||
    collaborators.find((c) => c.id === draft.collaboratorId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    if (!selectedClient?.id && !isEdit) {
      setErr('Pesquise e selecione um cliente cadastrado.');
      return;
    }
    if (!serviceId) {
      setErr('Selecione o serviço do agendamento.');
      return;
    }
    if (!date || !startTime || !endTime) {
      setErr('Preencha data, horário inicial e horário final.');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        clientId: selectedClient?.id ?? undefined,
        serviceId: Number(serviceId),
        collaboratorId: collaboratorId ? Number(collaboratorId) : null,
        unitId,
        date,
        startTime,
        endTime,
        modality,
        status,
        notes,
        waitlistId: draft.waitlistId ?? null,
        useQueueRotation: draft.useQueueRotation ?? (!collaboratorId),
      };

      const res = isEdit
        ? await apiFetch<{
            ok: boolean;
            appointment: Appointment;
            whatsappNotification?: { attempted: boolean; ok: boolean; detail: string } | null;
          }>(`/api/appointments/${draft.appointmentId}`, {
            method: 'PUT',
            body: JSON.stringify(payload),
          })
        : await apiFetch<{
            ok: boolean;
            appointment: Appointment;
            whatsappNotification?: { attempted: boolean; ok: boolean; detail: string } | null;
          }>('/api/appointments', {
            method: 'POST',
            body: JSON.stringify(payload),
          });

      let msg = isEdit
        ? 'Agendamento atualizado com sucesso.'
        : 'Agendamento registrado na agenda com sucesso.';
      if (res.whatsappNotification?.attempted) {
        msg += ` · ${res.whatsappNotification.detail}`;
      }
      await onSaved(msg);
      onClose();
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'Falha ao salvar agendamento.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 overflow-y-auto dark:bg-slate-950/80">
      <div className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden text-xs my-auto dark:border-slate-700 dark:bg-slate-900">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-2 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/70">
          <div className="min-w-0">
            <h3 className="font-display text-base font-bold text-slate-900 truncate dark:text-slate-100">
              {isEdit ? `Editar Agendamento #${draft.appointmentId}` : 'Novo Agendamento'}
            </h3>
            <p className="text-[11px] text-slate-500 truncate dark:text-slate-400">
              {assignedCollabObj
                ? `Consultor atribuído: ${assignedCollabObj.name} (${assignedCollabObj.jobTitle})`
                : 'Distribuição automática pelo próximo elegível da fila da unidade'}
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {isEdit && draft.appointmentId && (
              <button
                type="button"
                onClick={() => onOpenAudit(draft.appointmentId!, selectedClient?.fullName || `#${draft.appointmentId}`)}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <History className="w-3.5 h-3.5" /> Auditoria
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Voltar
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4 max-h-[80vh] overflow-y-auto overflow-x-auto scroll-rulers">
          {/* Cliente */}
          <div>
            <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">
              Cliente *
            </label>
            {selectedClient ? (
              <div className="flex items-center justify-between gap-2 rounded-xl border border-emerald-200 bg-emerald-50/70 px-3 py-2.5 dark:border-emerald-800/70 dark:bg-emerald-950/50">
                <div className="flex items-center gap-2.5 min-w-0">
                  <User className="w-4 h-4 text-emerald-700 shrink-0 dark:text-emerald-300" />
                  <div className="min-w-0">
                    <div className="font-bold text-slate-900 truncate dark:text-slate-100">{selectedClient.fullName}</div>
                    <div className="text-[11px] text-slate-600 font-mono dark:text-slate-300">
                      {selectedClient.phone || 'Telefone não informado'}
                      {selectedClient.cpfCnpj ? ` · ${selectedClient.cpfCnpj}` : ''}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedClient(null);
                    setClientQuery('');
                  }}
                  className="text-[11px] font-semibold text-blue-700 hover:underline shrink-0 dark:text-blue-300"
                >
                  Trocar
                </button>
              </div>
            ) : (
              <div className="space-y-1.5">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5 dark:text-slate-400" />
                  <input
                    type="text"
                    value={clientQuery}
                    onChange={(e) => setClientQuery(e.target.value)}
                    placeholder="Buscar por nome, CPF/CNPJ, telefone ou e-mail (mín. 2 letras)..."
                    className="w-full rounded-lg border border-slate-200 pl-8 pr-3 py-2 focus:border-slate-900 focus:outline-none dark:border-slate-700"
                  />
                </div>
                {searchingClients && (
                  <div className="text-[11px] text-slate-500 px-1 dark:text-slate-400">Pesquisando clientes...</div>
                )}
                {clientResults.length > 0 && (
                  <div className="max-h-40 overflow-y-auto rounded-xl border border-slate-200 divide-y divide-slate-100 bg-white dark:border-slate-700 dark:divide-slate-800 dark:bg-slate-900">
                    {clientResults.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => {
                          setSelectedClient({
                            id: c.id,
                            fullName: c.fullName,
                            phone: c.whatsapp || c.phone,
                            cpfCnpj: c.cpfCnpj,
                          });
                          if (!isEdit && c.unitId && units.some((u) => u.id === c.unitId)) {
                            setUnitId(c.unitId);
                          }
                        }}
                        className="w-full px-3 py-2 text-left hover:bg-slate-50 flex items-center justify-between gap-2 dark:hover:bg-slate-800"
                      >
                        <div className="min-w-0">
                          <div className="font-semibold text-slate-900 truncate dark:text-slate-100">{c.fullName}</div>
                          <div className="font-mono text-[10px] text-slate-500 truncate dark:text-slate-400">
                            {c.cpfCnpj || 'Sem CPF/CNPJ'} · {c.whatsapp || c.phone || 'Sem telefone'}
                          </div>
                        </div>
                        <span className="text-[11px] font-semibold text-emerald-700 shrink-0 dark:text-emerald-300">
                          Selecionar
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Serviço & Unidade */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Serviço *</label>
              <select
                required
                value={serviceId}
                onChange={(e) => handleServiceChange(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-medium text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              >
                <option value="">Selecione um serviço...</option>
                {services.map((s) => (
                  <option key={s.id} value={String(s.id)}>
                    {s.name} ({s.durationMinutes} min · {formatBRL(s.priceCents)})
                  </option>
                ))}
              </select>
            </div>

            {units.length > 1 ? (
              <div>
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Unidade</label>
                <select
                  value={unitId}
                  onChange={(e) => setUnitId(Number(e.target.value))}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-medium text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                >
                  {units.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.code} · {u.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div>
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Unidade</label>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-semibold text-slate-700 truncate dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-200">
                  {units[0]?.code || 'MTZ'} · {units[0]?.name || 'Matriz'}
                </div>
              </div>
            )}
          </div>

          {/* Consultor na Grade / Fila de Atendimento */}
          <div>
            <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">
              Consultor na Grade (Fila de Atendimento) *
            </label>
            <select
              value={collaboratorId}
              onChange={(e) => setCollaboratorId(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-medium text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              <option value="">Automático (Próximo da Fila da Unidade)</option>
              {collaborators
                .filter((c) => c.active && Boolean(c.participatesInScheduleQueue))
                .map((c) => (
                  <option key={c.id} value={String(c.id)}>
                    {c.name} ({c.jobTitle})
                  </option>
                ))}
            </select>
            <p className="text-[11px] text-slate-500 mt-1 dark:text-slate-400">
              Selecione manualmente qualquer consultor elegível na fila. Se escolher um consultor que não seja o primeiro da fila (ex: 3º), ele será alocado e posicionado ao final da fila automaticamente.
            </p>
          </div>

          {/* Data, Hora Inicial, Hora Final */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Data *</label>
              <input
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Horário Inicial *</label>
              <input
                type="time"
                required
                value={startTime}
                onChange={(e) => handleStartTimeChange(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Horário Final *</label>
              <input
                type="time"
                required
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
          </div>

          {/* Modalidade & Status */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Modalidade de Atendimento</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setModality((m) => (m === 'presencial' ? '' : 'presencial'))}
                  className={`inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 font-semibold transition-colors ${
                    modality === 'presencial'
                      ? 'border-orange-500 bg-orange-50 text-orange-800 dark:bg-orange-950/50 dark:text-orange-300'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800'
                  }`}
                >
                  <MapPin className="w-3.5 h-3.5" /> Presencial
                </button>
                <button
                  type="button"
                  onClick={() => setModality((m) => (m === 'online' ? '' : 'online'))}
                  className={`inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 font-semibold transition-colors ${
                    modality === 'online'
                      ? 'border-blue-600 bg-blue-50 text-blue-800 dark:bg-blue-950/50 dark:text-blue-300'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800'
                  }`}
                >
                  <Video className="w-3.5 h-3.5" /> OnLine
                </button>
              </div>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-semibold text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              >
                {STATUS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              {status === 'confirmado' && (
                <div className="mt-1 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
                  Ao salvar em &ldquo;Confirmado&rdquo;, enviaremos notificação automática via WhatsApp ao cliente.
                </div>
              )}
            </div>
          </div>

          {/* Observações */}
          <div>
            <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Observações</label>
            <textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Informações adicionais sobre o atendimento ou documentos solicitados..."
              className="w-full rounded-lg border border-slate-200 p-2.5 dark:border-slate-700"
            />
          </div>

          {isEdit && (draft.createdByName || draft.updatedByName) && (
            <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-[11px] text-slate-500 flex flex-wrap gap-3 dark:border-slate-800 dark:bg-slate-800/70 dark:text-slate-400">
              {draft.createdByName && (
                <span>
                  Criado por: <strong className="text-slate-700 dark:text-slate-200">{draft.createdByName}</strong>
                </span>
              )}
              {draft.updatedByName && (
                <span>
                  Última alteração: <strong className="text-slate-700 dark:text-slate-200">{draft.updatedByName}</strong>
                </span>
              )}
            </div>
          )}

          {err && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-700 font-medium dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300">
              {err}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="rounded-lg border border-slate-200 px-4 py-2 font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-emerald-600 dark:hover:bg-emerald-500"
            >
              <Check className="w-3.5 h-3.5" />
              {saving ? 'Salvando...' : isEdit ? 'Salvar Alterações' : 'Confirmar Agendamento'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// =============================================================================
// 2. MODAL GERENCIAR CONSULTORES DA AGENDA
// =============================================================================
export const ManageConsultantsModal: React.FC<{
  open: boolean;
  collaborators: ScheduleCollaboratorNode[];
  hiddenCollabIds: number[];
  onToggleVisibility: (collabId: number) => void;
  onShowAll: () => void;
  onClose: () => void;
}> = ({
  open,
  collaborators,
  hiddenCollabIds,
  onToggleVisibility,
  onShowAll,
  onClose,
}) => {
  const [search, setSearch] = useState('');

  if (!open) return null;

  const activeCollabs = collaborators.filter((c) => c.active);
  const q = search.trim().toLowerCase();
  const filtered = activeCollabs.filter(
    (c) => !q || c.name.toLowerCase().includes(q) || c.jobTitle.toLowerCase().includes(q)
  );
  const visibleCount = activeCollabs.filter((c) => !hiddenCollabIds.includes(c.id)).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 dark:bg-slate-950/80">
      <div className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden text-xs flex flex-col max-h-[85vh] dark:border-slate-700 dark:bg-slate-900">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-2 dark:border-slate-700">
          <div className="flex items-center gap-2">
            <UserCheck className="w-4 h-4 text-emerald-700 dark:text-emerald-300" />
            <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
              Gerenciar Consultores da Agenda
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Voltar
          </button>
        </div>

        <div className="p-3 border-b border-slate-100 bg-slate-50 flex items-center gap-2 dark:border-slate-800 dark:bg-slate-800/70">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5 dark:text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filtrar consultor por nome ou cargo..."
              className="w-full rounded-lg border border-slate-200 bg-white pl-8 pr-3 py-2 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
          </div>
          <button
            type="button"
            onClick={onShowAll}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Exibir Todos
          </button>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
          {filtered.length === 0 ? (
            <div className="p-8 text-center text-slate-500 dark:text-slate-400">
              Nenhum consultor/colaborador ativo encontrado.
            </div>
          ) : (
            filtered.map((c) => {
              const isVisible = !hiddenCollabIds.includes(c.id);
              const initial = (c.name || 'C').charAt(0).toUpperCase();
              return (
                <div
                  key={c.id}
                  className="px-4 py-3 flex items-center justify-between gap-3 hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {c.photoUrl ? (
                      <img
                        src={c.photoUrl}
                        alt={c.name}
                        className="w-9 h-9 rounded-full object-cover border border-slate-200 shrink-0 dark:border-slate-700"
                      />
                    ) : (
                      <div className="w-9 h-9 rounded-full bg-slate-900 text-white font-bold flex items-center justify-center shrink-0 dark:bg-emerald-600">
                        {initial}
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-900 truncate dark:text-slate-100">{c.name}</span>
                        {c.participatesInScheduleQueue && (
                          <span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-300">✓ Fila</span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-500 truncate dark:text-slate-400">{c.jobTitle}</div>
                    </div>
                  </div>

                  <button
                    type="button"
                    role="switch"
                    aria-checked={isVisible}
                    onClick={() => onToggleVisibility(c.id)}
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                      isVisible ? 'bg-emerald-600' : 'bg-slate-300'
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform dark:bg-slate-900 ${
                        isVisible ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              );
            })
          )}
        </div>

        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between dark:border-slate-700 dark:bg-slate-800/70">
          <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
            Exibindo {visibleCount} de {activeCollabs.length} consultor(es) visível(is) na grade
          </span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-slate-900 px-4 py-1.5 font-semibold text-white hover:bg-slate-800 dark:bg-emerald-600 dark:hover:bg-emerald-500"
          >
            Concluir
          </button>
        </div>
      </div>
    </div>
  );
};

// =============================================================================
// 3. GAVETA FILTROS DA AGENDA & CONSULTAR AGENDAMENTOS DO CLIENTE
// =============================================================================
interface ClientHistoryItem {
  id: number;
  scheduledFor: string;
  endAt?: string | null;
  status: string;
  modality: string;
  serviceName: string;
  collaboratorName: string;
  unitId: number;
}

export const FiltersDrawerModal: React.FC<{
  open: boolean;
  collaborators: ScheduleCollaboratorNode[];
  selectedConsultantFilter: number | null;
  statusColors: ScheduleStatusColors;
  onSelectConsultantFilter: (collabId: number | null) => void;
  onJumpToDate: (dateKey: string) => void;
  onClose: () => void;
}> = ({
  open,
  collaborators,
  selectedConsultantFilter,
  statusColors,
  onSelectConsultantFilter,
  onJumpToDate,
  onClose,
}) => {
  const [clientQuery, setClientQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [matches, setMatches] = useState<SearchClientOption[]>([]);
  const [chosenClient, setChosenClient] = useState<SearchClientOption | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyItems, setHistoryItems] = useState<ClientHistoryItem[]>([]);

  useEffect(() => {
    if (!open) return;
    const q = clientQuery.trim();
    if (q.length < 2) {
      setMatches([]);
      return;
    }
    const timer = setTimeout(() => {
      setSearching(true);
      apiFetch<{ clients: SearchClientOption[] }>(
        `/api/appointments/clients-search?q=${encodeURIComponent(q)}`
      )
        .then((res) => setMatches((res.clients || []).slice(0, 8)))
        .catch(() => setMatches([]))
        .finally(() => setSearching(false));
    }, 240);
    return () => clearTimeout(timer);
  }, [open, clientQuery]);

  const handleLoadClientHistory = async (client: SearchClientOption) => {
    setChosenClient(client);
    setHistoryLoading(true);
    try {
      const res = await apiFetch<{ total: number; items: ClientHistoryItem[] }>(
        `/api/appointments/client-history/${client.id}`
      );
      setHistoryItems(res.items || []);
    } catch {
      setHistoryItems([]);
    } finally {
      setHistoryLoading(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/50 dark:bg-slate-950/80" onClick={onClose}>
      <div
        className="w-full max-w-md bg-white h-full shadow-2xl border-l border-slate-200 flex flex-col text-xs dark:bg-slate-900 dark:border-slate-700"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between dark:border-slate-700">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-slate-700 dark:text-slate-200" />
            <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
              Filtros da Agenda &amp; Histórico
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Voltar
          </button>
        </div>

        <div className="flex-1 overflow-y-auto overflow-x-auto scroll-rulers p-5 space-y-6">
          {/* Filtro por Consultor */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="font-bold text-slate-800 uppercase tracking-wide text-[11px] dark:text-slate-100">
                Filtrar Grade por Consultor
              </label>
              {selectedConsultantFilter && (
                <button
                  type="button"
                  onClick={() => onSelectConsultantFilter(null)}
                  className="text-[11px] font-semibold text-blue-700 hover:underline dark:text-blue-300"
                >
                  Limpar filtro
                </button>
              )}
            </div>
            <select
              value={selectedConsultantFilter ? String(selectedConsultantFilter) : ''}
              onChange={(e) =>
                onSelectConsultantFilter(e.target.value ? Number(e.target.value) : null)
              }
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-medium text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              <option value="">Todos os consultores visíveis</option>
              {collaborators
                .filter((c) => c.active)
                .map((c) => (
                  <option key={c.id} value={String(c.id)}>
                    {c.name} ({c.jobTitle})
                  </option>
                ))}
            </select>
          </div>

          {/* Consultar Agendamentos do Cliente */}
          <div className="space-y-3 border-t border-slate-200 pt-5 dark:border-slate-700">
            <div>
              <h4 className="font-bold text-slate-800 uppercase tracking-wide text-[11px] dark:text-slate-100">
                Consultar Agendamentos do Cliente
              </h4>
              <p className="text-[11px] text-slate-500 mt-0.5 dark:text-slate-400">
                Digite pelo menos 2 caracteres para localizar cliente e navegar para qualquer agendamento passado ou futuro.
              </p>
            </div>

            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5 dark:text-slate-400" />
              <input
                type="text"
                value={clientQuery}
                onChange={(e) => {
                  setClientQuery(e.target.value);
                  if (chosenClient) setChosenClient(null);
                }}
                placeholder="Nome, CPF/CNPJ ou telefone do cliente..."
                className="w-full rounded-lg border border-slate-200 pl-8 pr-3 py-2 dark:border-slate-700"
              />
            </div>

            {searching && <div className="text-[11px] text-slate-500 dark:text-slate-400">Buscando clientes...</div>}

            {!chosenClient && matches.length > 0 && (
              <div className="rounded-xl border border-slate-200 divide-y divide-slate-100 dark:border-slate-700 dark:divide-slate-800">
                {matches.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => handleLoadClientHistory(c)}
                    className="w-full px-3 py-2.5 text-left hover:bg-slate-50 flex items-center justify-between gap-2 dark:hover:bg-slate-800"
                  >
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-900 truncate dark:text-slate-100">{c.fullName}</div>
                      <div className="font-mono text-[10px] text-slate-500 truncate dark:text-slate-400">
                        {c.cpfCnpj || '—'} · {c.whatsapp || c.phone || 'Sem telefone'}
                      </div>
                    </div>
                    <span className="text-[11px] font-semibold text-blue-700 shrink-0 dark:text-blue-300">
                      Consultar →
                    </span>
                  </button>
                ))}
              </div>
            )}

            {chosenClient && (
              <div className="space-y-3">
                <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800/70">
                  <div className="min-w-0">
                    <div className="font-bold text-slate-900 truncate dark:text-slate-100">{chosenClient.fullName}</div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      Total localizado: <strong>{historyItems.length}</strong> agendamento(s)
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setChosenClient(null);
                      setHistoryItems([]);
                    }}
                    className="text-[11px] font-semibold text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
                  >
                    Limpar
                  </button>
                </div>

                {historyLoading ? (
                  <div className="py-6 text-center text-slate-500 dark:text-slate-400">
                    Carregando agenda do cliente...
                  </div>
                ) : historyItems.length === 0 ? (
                  <div className="py-6 text-center text-slate-500 border border-dashed border-slate-200 rounded-xl dark:text-slate-400 dark:border-slate-700">
                    Nenhum agendamento encontrado para este cliente.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {historyItems.map((item) => {
                      const st = getStatusMeta(item.status, statusColors);
                      const dt = new Date(item.scheduledFor);
                      const dKey = toDateKey(dt);
                      const isFuture = dt.getTime() >= Date.now();
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => {
                            onJumpToDate(dKey);
                            onClose();
                          }}
                          className="w-full text-left rounded-xl border border-slate-200 p-3 hover:border-slate-400 hover:bg-slate-50 transition-colors space-y-1 dark:border-slate-700 dark:hover:bg-slate-800"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="inline-flex items-center gap-1.5 font-mono font-bold text-slate-900 dark:text-slate-100">
                              <Calendar className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
                              {formatDateTimeBR(item.scheduledFor)}
                            </span>
                            <span className="font-semibold text-[11px] text-slate-700 dark:text-slate-200">
                              {st.label}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-600 flex items-center justify-between gap-2 dark:text-slate-300">
                            <span className="truncate">
                              {item.serviceName} · {item.collaboratorName}
                            </span>
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-blue-700 shrink-0 dark:text-blue-300">
                              <Clock className="w-3 h-3" />
                              {isFuture ? 'Ir para data →' : 'Ver histórico →'}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
