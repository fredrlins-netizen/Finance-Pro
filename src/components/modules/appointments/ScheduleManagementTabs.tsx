import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  Ban,
  CalendarPlus,
  Check,
  Clock,
  Edit3,
  History,
  ListChecks,
  Plus,
  Search,
  Settings,
  Trash2,
  User,
  X,
} from 'lucide-react';
import { apiFetch, formatBRL } from '../../../lib/api.ts';
import {
  ScheduleBlock,
  ScheduleCollaboratorNode,
  ScheduleConfig,
  ScheduleServiceItem,
  ScheduleStatusColors,
  ScheduleWaitlistItem,
  Unit,
} from '../../../types.ts';
import { ConfirmDeleteModal } from '../cadastros/CadastrosShared.tsx';
import {
  DEFAULT_STATUS_COLORS,
  formatShortDateBR,
  HexColorSwatch,
  STATUS_OPTIONS,
  toDateKey,
  toTimeKey,
  WEEKDAY_LABELS,
} from './appointmentsHelpers.ts';

interface SearchClientOption {
  id: number;
  fullName: string;
  cpfCnpj: string;
  phone: string;
  whatsapp: string;
  email: string;
  unitId: number;
}

// =============================================================================
// 2. BLOQUEAR AGENDA
// =============================================================================
export const BlocksTabView: React.FC<{
  collaborators: ScheduleCollaboratorNode[];
  blocks: ScheduleBlock[];
  onBack: () => void;
  onRefresh: () => Promise<void>;
  onToast: (msg: string) => void;
  onOpenAudit: (entityType: string, entityId: string | number, title: string) => void;
}> = ({ collaborators, blocks, onBack, onRefresh, onToast, onOpenAudit }) => {
  const activeCollabs = collaborators.filter((c) => c.active);
  const todayStr = toDateKey(new Date());

  const [collabId, setCollabId] = useState<string>(activeCollabs[0] ? String(activeCollabs[0].id) : '');
  const [allDay, setAllDay] = useState(true);
  const [startDate, setStartDate] = useState(todayStr);
  const [endDate, setEndDate] = useState(todayStr);
  const [startTime, setStartTime] = useState('08:00');
  const [endTime, setEndTime] = useState('18:00');
  const [weekdays, setWeekdays] = useState<number[]>([0, 1, 2, 3, 4, 5, 6]);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const [deleteTarget, setDeleteTarget] = useState<ScheduleBlock | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteErr, setDeleteErr] = useState('');

  useEffect(() => {
    if (!collabId && activeCollabs[0]) {
      setCollabId(String(activeCollabs[0].id));
    }
  }, [activeCollabs, collabId]);

  const toggleWeekday = (dayVal: number) => {
    setWeekdays((prev) =>
      prev.includes(dayVal) ? prev.filter((d) => d !== dayVal) : [...prev, dayVal].sort((a, b) => a - b)
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    if (!collabId) {
      setErr('Selecione o consultor responsável.');
      return;
    }
    if (!reason.trim()) {
      setErr('Informe o motivo do bloqueio.');
      return;
    }
    if (weekdays.length === 0) {
      setErr('Selecione pelo menos um dia da semana para repetir o bloqueio.');
      return;
    }

    setSaving(true);
    try {
      await apiFetch('/api/appointments/blocks', {
        method: 'POST',
        body: JSON.stringify({
          collaboratorId: Number(collabId),
          allDay,
          startDate,
          endDate: endDate || startDate,
          startTime: allDay ? '00:00' : startTime,
          endTime: allDay ? '23:59' : endTime,
          weekdays,
          reason: reason.trim(),
        }),
      });
      setReason('');
      onToast('Bloqueio de agenda registrado com sucesso.');
      await onRefresh();
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'Erro ao registrar bloqueio.');
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    setDeleteErr('');
    try {
      await apiFetch(`/api/appointments/blocks/${deleteTarget.id}`, { method: 'DELETE' });
      setDeleteTarget(null);
      onToast('Bloqueio removido da agenda.');
      await onRefresh();
    } catch (error) {
      setDeleteErr(error instanceof Error ? error.message : 'Falha ao remover bloqueio.');
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Formulário Bloquear Agenda de Profissional */}
      <form
        onSubmit={handleSubmit}
        className="rounded-xl border border-slate-200 bg-white p-5 space-y-4 text-xs overflow-x-auto scroll-rulers"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <Ban className="w-4 h-4 text-amber-700" />
            <div>
              <h3 className="font-display text-sm font-bold text-slate-900">
                Bloquear Agenda de Profissional
              </h3>
              <p className="text-[11px] text-slate-500">
                Slots bloqueados aparecem hachurados na grade e impedem criação ou movimentação de horários.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-50"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Voltar
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
          <div className="sm:col-span-2">
            <label className="block font-semibold text-slate-700 mb-1">
              Consultor Responsável *
            </label>
            <select
              required
              value={collabId}
              onChange={(e) => setCollabId(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-medium text-slate-900"
            >
              <option value="">Selecione...</option>
              {activeCollabs.map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.name} · {c.jobTitle}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">Data Início *</label>
            <input
              type="date"
              required
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                if (endDate < e.target.value) setEndDate(e.target.value);
              }}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono"
            />
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">Data Fim *</label>
            <input
              type="date"
              required
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <label className="inline-flex items-center gap-2 font-semibold text-slate-800 cursor-pointer">
            <input
              type="checkbox"
              checked={allDay}
              onChange={(e) => setAllDay(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-slate-900"
            />
            Bloquear dia inteiro
          </label>

          {!allDay && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-slate-600">Hora Início:</span>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="rounded-lg border border-slate-200 px-2.5 py-1.5 font-mono"
              />
              <span className="font-semibold text-slate-600">Hora Fim:</span>
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="rounded-lg border border-slate-200 px-2.5 py-1.5 font-mono"
              />
            </div>
          )}
        </div>

        <div>
          <label className="block font-semibold text-slate-700 mb-1.5">
            Repetir nos dias da semana
          </label>
          <div className="flex flex-wrap gap-1.5">
            {WEEKDAY_LABELS.map((d) => {
              const checked = weekdays.includes(d.value);
              return (
                <button
                  key={d.value}
                  type="button"
                  onClick={() => toggleWeekday(d.value)}
                  className={`rounded-lg border px-3 py-1.5 font-semibold transition-colors ${
                    checked
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {d.short}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
          <div className="sm:col-span-9">
            <label className="block font-semibold text-slate-700 mb-1">Motivo *</label>
            <input
              type="text"
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ex: Visita externa, Reunião de alinhamento, Férias, Atestado..."
              className="w-full rounded-lg border border-slate-200 px-3 py-2"
            />
          </div>
          <div className="sm:col-span-3 flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2.5 font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              <Ban className="w-3.5 h-3.5" />
              {saving ? 'Salvando...' : 'Registrar Bloqueio'}
            </button>
          </div>
        </div>

        {err && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-700 font-medium">
            {err}
          </div>
        )}
      </form>

      {/* Grade de Dados: Lista de Bloqueios Ativos com réguas horizontal e vertical */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden text-xs">
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
          <h4 className="font-display text-sm font-bold text-slate-900">
            Lista de Bloqueios Ativos ({blocks.length})
          </h4>
        </div>
        <div className="overflow-x-auto overflow-y-auto max-h-[55vh] scroll-rulers">
          <table className="w-full min-w-[680px] text-left border-collapse">
            <thead className="sticky top-0 z-10 bg-slate-50">
              <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-500">
                <th className="py-2.5 px-4">Consultor</th>
                <th className="py-2.5 px-4">Período</th>
                <th className="py-2.5 px-4">Horário</th>
                <th className="py-2.5 px-4">Dias Repetidos</th>
                <th className="py-2.5 px-4">Motivo</th>
                <th className="py-2.5 px-4">Criado por</th>
                <th className="py-2.5 px-4 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {blocks.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-500">
                    Nenhum bloqueio cadastrado no momento.
                  </td>
                </tr>
              ) : (
                blocks.map((b) => {
                  const sKey = toDateKey(new Date(b.startAt));
                  const eKey = toDateKey(new Date(b.endAt));
                  const wDays =
                    Array.isArray(b.weekdays) && b.weekdays.length > 0
                      ? b.weekdays
                          .map((d) => WEEKDAY_LABELS.find((x) => x.value === d)?.short)
                          .filter(Boolean)
                          .join(', ')
                      : 'Todos os dias';
                  const timeLabel =
                    b.allDay !== false
                      ? 'Dia Inteiro'
                      : `${b.startTime || toTimeKey(new Date(b.startAt))} - ${b.endTime || toTimeKey(new Date(b.endAt))}`;

                  return (
                    <tr key={b.id} className="hover:bg-slate-50/70">
                      <td className="py-3 px-4 font-semibold text-slate-900">
                        {b.collaboratorName || 'Consultor'}
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-700 whitespace-nowrap">
                        {formatShortDateBR(sKey)}
                        {eKey !== sKey ? ` → ${formatShortDateBR(eKey)}` : ''}
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-700 whitespace-nowrap">
                        {timeLabel}
                      </td>
                      <td className="py-3 px-4 text-slate-600">{wDays}</td>
                      <td className="py-3 px-4 text-slate-800">{b.reason}</td>
                      <td className="py-3 px-4 text-slate-500">{b.createdBy}</td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() =>
                              onOpenAudit(
                                'schedule_block',
                                b.id,
                                `${b.collaboratorName || 'Consultor'} · ${b.reason}`
                              )
                            }
                            title="Histórico de Auditoria"
                            className="rounded-md border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100"
                          >
                            <History className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setDeleteErr('');
                              setDeleteTarget(b);
                            }}
                            title="Remover Bloqueio"
                            className="rounded-md border border-red-200 p-1.5 text-red-600 hover:bg-red-50"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
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
      </div>

      <ConfirmDeleteModal
        open={Boolean(deleteTarget)}
        title="Remover este bloqueio?"
        description={
          deleteTarget
            ? `Os horários de ${deleteTarget.collaboratorName || 'Consultor'} (${deleteTarget.reason}) voltarão a ficar disponíveis na agenda.`
            : ''
        }
        busy={deleteBusy}
        error={deleteErr}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
};

// =============================================================================
// 3. FILA DE ESPERA DE CLIENTES
// =============================================================================
export const WaitlistTabView: React.FC<{
  units: Unit[];
  collaborators: ScheduleCollaboratorNode[];
  services: ScheduleServiceItem[];
  waitlist: ScheduleWaitlistItem[];
  editingItem: ScheduleWaitlistItem | null;
  onBack: () => void;
  onCancelEdit: () => void;
  onStartEdit: (item: ScheduleWaitlistItem) => void;
  onPromoteToAppointment: (item: ScheduleWaitlistItem) => void;
  onRefresh: () => Promise<void>;
  onToast: (msg: string) => void;
  onOpenAudit: (entityType: string, entityId: string | number, title: string) => void;
}> = ({
  units,
  collaborators,
  services,
  waitlist,
  editingItem,
  onBack,
  onCancelEdit,
  onStartEdit,
  onPromoteToAppointment,
  onRefresh,
  onToast,
  onOpenAudit,
}) => {
  const activeCollabs = collaborators.filter((c) => c.active);
  const [clientQuery, setClientQuery] = useState('');
  const [clientResults, setClientResults] = useState<SearchClientOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedClient, setSelectedClient] = useState<{
    id: number;
    fullName: string;
    phone?: string;
    unitId?: number;
  } | null>(null);

  const [serviceId, setServiceId] = useState<string>(services[0] ? String(services[0].id) : '');
  const [preferredCollabId, setPreferredCollabId] = useState<string>('');
  const [desiredDate, setDesiredDate] = useState(toDateKey(new Date()));
  const [desiredTime, setDesiredTime] = useState('08:00');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const [deleteTarget, setDeleteTarget] = useState<ScheduleWaitlistItem | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteErr, setDeleteErr] = useState('');

  useEffect(() => {
    if (!serviceId && services[0]) {
      setServiceId(String(services[0].id));
    }
  }, [services, serviceId]);

  useEffect(() => {
    if (editingItem) {
      setSelectedClient({
        id: editingItem.clientId,
        fullName: editingItem.clientName,
        phone: editingItem.clientPhone,
        unitId: editingItem.unitId,
      });
      setServiceId(String(editingItem.serviceId));
      setPreferredCollabId(
        editingItem.preferredCollaboratorId ? String(editingItem.preferredCollaboratorId) : ''
      );
      setDesiredDate(editingItem.desiredDate);
      setDesiredTime(editingItem.desiredTime || '08:00');
      setNotes(editingItem.notes || '');
      setErr('');
    }
  }, [editingItem]);

  useEffect(() => {
    if (selectedClient) return;
    const q = clientQuery.trim();
    if (q.length < 2) {
      setClientResults([]);
      return;
    }
    const timer = setTimeout(() => {
      setSearching(true);
      apiFetch<{ clients: SearchClientOption[] }>(
        `/api/appointments/clients-search?q=${encodeURIComponent(q)}`
      )
        .then((res) => setClientResults(res.clients || []))
        .catch(() => setClientResults([]))
        .finally(() => setSearching(false));
    }, 240);
    return () => clearTimeout(timer);
  }, [clientQuery, selectedClient]);

  const resetFields = () => {
    setSelectedClient(null);
    setClientQuery('');
    setClientResults([]);
    setPreferredCollabId('');
    setDesiredDate(toDateKey(new Date()));
    setDesiredTime('08:00');
    setNotes('');
    setErr('');
    if (services[0]) setServiceId(String(services[0].id));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    if (!selectedClient) {
      setErr('Selecione um cliente para incluir na fila de espera.');
      return;
    }
    if (!serviceId) {
      setErr('Selecione o serviço pretendido.');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        clientId: selectedClient.id,
        serviceId: Number(serviceId),
        preferredCollaboratorId: preferredCollabId ? Number(preferredCollabId) : null,
        unitId: selectedClient.unitId || units[0]?.id || 1,
        desiredDate,
        desiredTime,
        notes,
      };
      if (editingItem) {
        await apiFetch(`/api/appointments/waitlist/${editingItem.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        onToast('Registro da fila de espera atualizado.');
        onCancelEdit();
      } else {
        await apiFetch('/api/appointments/waitlist', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        onToast('Cliente adicionado à fila de espera.');
      }
      resetFields();
      await onRefresh();
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'Erro ao salvar na fila de espera.');
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    setDeleteErr('');
    try {
      await apiFetch(`/api/appointments/waitlist/${deleteTarget.id}`, { method: 'DELETE' });
      setDeleteTarget(null);
      onToast('Registro removido da fila de espera.');
      await onRefresh();
    } catch (error) {
      setDeleteErr(error instanceof Error ? error.message : 'Erro ao remover registro.');
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <form
        onSubmit={handleSubmit}
        className="rounded-xl border border-slate-200 bg-white p-5 space-y-4 text-xs overflow-x-auto scroll-rulers"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <ListChecks className="w-4 h-4 text-blue-700" />
            <h3 className="font-display text-sm font-bold text-slate-900">
              {editingItem ? `Alterar Registro na Fila #${editingItem.id}` : 'Adicionar Registro na Fila de Espera'}
            </h3>
          </div>
          <div className="flex items-center gap-2">
            {editingItem && (
              <button
                type="button"
                onClick={() => {
                  onCancelEdit();
                  resetFields();
                }}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 font-semibold text-slate-600 hover:bg-slate-50"
              >
                <X className="w-3.5 h-3.5" /> Cancelar Edição
              </button>
            )}
            <button
              type="button"
              onClick={onBack}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-50"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Voltar
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Cliente *</label>
            {selectedClient ? (
              <div className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50/70 px-3 py-2">
                <div className="flex items-center gap-2 min-w-0">
                  <User className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                  <span className="font-bold text-slate-900 truncate">{selectedClient.fullName}</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedClient(null);
                    setClientQuery('');
                  }}
                  className="text-[11px] font-semibold text-blue-700 hover:underline shrink-0"
                >
                  Trocar
                </button>
              </div>
            ) : (
              <div className="space-y-1">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    value={clientQuery}
                    onChange={(e) => setClientQuery(e.target.value)}
                    placeholder="Buscar cliente por nome, CPF ou telefone..."
                    className="w-full rounded-lg border border-slate-200 pl-8 pr-3 py-2"
                  />
                </div>
                {searching && <div className="text-[11px] text-slate-500">Buscando...</div>}
                {clientResults.length > 0 && (
                  <div className="max-h-36 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100 bg-white scroll-rulers">
                    {clientResults.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() =>
                          setSelectedClient({
                            id: c.id,
                            fullName: c.fullName,
                            phone: c.whatsapp || c.phone,
                            unitId: c.unitId,
                          })
                        }
                        className="w-full px-3 py-2 text-left hover:bg-slate-50 flex justify-between"
                      >
                        <span className="font-semibold text-slate-900 truncate">{c.fullName}</span>
                        <span className="font-mono text-[10px] text-slate-500">{c.whatsapp || c.phone}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">Serviço Pretendido *</label>
            <select
              required
              value={serviceId}
              onChange={(e) => setServiceId(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-medium"
            >
              <option value="">Selecione...</option>
              {services.map((s) => (
                <option key={s.id} value={String(s.id)}>
                  {s.name} ({s.durationMinutes} min)
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Consultor Preferencial</label>
            <select
              value={preferredCollabId}
              onChange={(e) => setPreferredCollabId(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2"
            >
              <option value="">Sem preferência</option>
              {activeCollabs.map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.name} ({c.jobTitle})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Data Pretendida</label>
            <input
              type="date"
              value={desiredDate}
              onChange={(e) => setDesiredDate(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono"
            />
          </div>
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Horário Inicial</label>
            <input
              type="time"
              value={desiredTime}
              onChange={(e) => setDesiredTime(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
          <div className="sm:col-span-9">
            <label className="block font-semibold text-slate-700 mb-1">Observações</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Preferência de turno, urgência do contrato..."
              className="w-full rounded-lg border border-slate-200 px-3 py-2"
            />
          </div>
          <div className="sm:col-span-3">
            <button
              type="submit"
              disabled={saving}
              className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              <Plus className="w-3.5 h-3.5" />
              {saving ? 'Salvando...' : editingItem ? 'Atualizar Fila' : 'Incluir na Fila'}
            </button>
          </div>
        </div>

        {err && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-700 font-medium">
            {err}
          </div>
        )}
      </form>

      {/* Grade Clientes Aguardando Horário com réguas horizontal e vertical */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden text-xs">
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
          <h4 className="font-display text-sm font-bold text-slate-900">
            Clientes Aguardando Horário ({waitlist.length})
          </h4>
        </div>
        <div className="overflow-x-auto overflow-y-auto max-h-[55vh] scroll-rulers">
          <table className="w-full min-w-[680px] text-left border-collapse">
            <thead className="sticky top-0 z-10 bg-slate-50">
              <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-500">
                <th className="py-2.5 px-4">Cliente</th>
                <th className="py-2.5 px-4">Serviço</th>
                <th className="py-2.5 px-4">Consultor Preferencial</th>
                <th className="py-2.5 px-4">Data / Hora Pretendida</th>
                <th className="py-2.5 px-4">Observações</th>
                <th className="py-2.5 px-4 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {waitlist.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-500">
                    Nenhum cliente aguardando encaixe na fila de espera.
                  </td>
                </tr>
              ) : (
                waitlist.map((w) => (
                  <tr key={w.id} className="hover:bg-slate-50/70">
                    <td className="py-3 px-4">
                      <div className="font-semibold text-slate-900">{w.clientName}</div>
                      <div className="font-mono text-[10px] text-slate-500">
                        {w.clientPhone || 'Sem telefone'}
                      </div>
                    </td>
                    <td className="py-3 px-4 font-medium text-slate-800">
                      {w.serviceName} ({w.serviceDurationMinutes} min)
                    </td>
                    <td className="py-3 px-4 text-slate-700">
                      {w.preferredCollaboratorName || 'Sem preferência'}
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-700 whitespace-nowrap">
                      {formatShortDateBR(w.desiredDate)} · {w.desiredTime}
                    </td>
                    <td className="py-3 px-4 text-slate-600 max-w-xs truncate">{w.notes || '—'}</td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => onPromoteToAppointment(w)}
                          className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1.5 font-semibold text-white hover:bg-emerald-700"
                        >
                          <CalendarPlus className="w-3.5 h-3.5" /> Programar
                        </button>
                        <button
                          type="button"
                          onClick={() => onStartEdit(w)}
                          title="Editar Registro"
                          className="rounded-md border border-slate-200 p-1.5 text-blue-700 hover:bg-blue-50"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onOpenAudit('waitlist', w.id, w.clientName)}
                          title="Auditoria"
                          className="rounded-md border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100"
                        >
                          <History className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setDeleteErr('');
                            setDeleteTarget(w);
                          }}
                          title="Remover da Fila"
                          className="rounded-md border border-red-200 p-1.5 text-red-600 hover:bg-red-50"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <ConfirmDeleteModal
        open={Boolean(deleteTarget)}
        title="Remover cliente da Fila de Espera?"
        description={
          deleteTarget
            ? `Confirma a remoção de ${deleteTarget.clientName} da fila para "${deleteTarget.serviceName}"?`
            : ''
        }
        busy={deleteBusy}
        error={deleteErr}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
};

// =============================================================================
// 4. SERVIÇOS DA AGENDA (SEM EXCLUSÃO FÍSICA CONF. MANUAL)
// =============================================================================
export const ServicesTabView: React.FC<{
  services: ScheduleServiceItem[];
  onBack: () => void;
  onRefresh: () => Promise<void>;
  onToast: (msg: string) => void;
  onOpenAudit: (entityType: string, entityId: string | number, title: string) => void;
}> = ({ services, onBack, onRefresh, onToast, onOpenAudit }) => {
  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [durationMinutes, setDurationMinutes] = useState('30');
  const [priceReais, setPriceReais] = useState('0.00');
  const [color, setColor] = useState('#e0e7ff');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const openNew = () => {
    setEditId(null);
    setName('');
    setDurationMinutes('30');
    setPriceReais('0.00');
    setColor('#e0e7ff');
    setErr('');
    setFormOpen(true);
  };

  const openEdit = (srv: ScheduleServiceItem) => {
    setEditId(srv.id);
    setName(srv.name);
    setDurationMinutes(String(srv.durationMinutes || 30));
    setPriceReais(((srv.priceCents || 0) / 100).toFixed(2));
    setColor(srv.color || '#e0e7ff');
    setErr('');
    setFormOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setErr('Informe o nome do serviço.');
      return;
    }
    setSaving(true);
    setErr('');
    try {
      const cleanPrice = Number(priceReais.replace(',', '.')) || 0;
      const payload = {
        name: name.trim(),
        durationMinutes: Math.max(5, Number(durationMinutes) || 30),
        priceCents: Math.max(0, Math.round(cleanPrice * 100)),
        color: color || '#e0e7ff',
      };
      if (editId) {
        await apiFetch(`/api/appointments/services/${editId}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        onToast('Serviço atualizado com sucesso.');
      } else {
        await apiFetch('/api/appointments/services', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        onToast('Novo serviço adicionado ao catálogo da agenda.');
      }
      setFormOpen(false);
      await onRefresh();
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'Erro ao salvar serviço.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 text-xs">
      <div className="rounded-xl border border-slate-200 bg-white px-5 py-3.5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-display text-sm font-bold text-slate-900">
            Catálogo de Serviços da Agenda ({services.length})
          </h3>
          <p className="text-[11px] text-slate-500">
            Cada serviço calcula automaticamente o horário final do agendamento com base na duração configurada.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => (formOpen ? setFormOpen(false) : onBack())}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 font-semibold text-slate-700 hover:bg-slate-50"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Voltar
          </button>
          <button
            type="button"
            onClick={openNew}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 font-semibold text-white hover:bg-slate-800"
          >
            <Plus className="w-3.5 h-3.5" /> Novo Serviço
          </button>
        </div>
      </div>

      {formOpen && (
        <form
          onSubmit={handleSave}
          className="rounded-xl border border-slate-200 bg-white p-5 space-y-4 overflow-x-auto scroll-rulers"
        >
          <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
            <span className="font-display text-sm font-bold text-slate-900">
              {editId ? 'Editar Serviço' : 'Cadastrar Novo Serviço'}
            </span>
            <button
              type="button"
              onClick={() => setFormOpen(false)}
              className="inline-flex items-center gap-1 text-slate-600 hover:text-slate-900 font-semibold"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Voltar à Lista
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
            <div className="sm:col-span-2">
              <label className="block font-semibold text-slate-700 mb-1">Nome do Serviço *</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex: Reunião de Admissão Presencial"
                className="w-full rounded-lg border border-slate-200 px-3 py-2"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Duração (min)</label>
              <input
                type="number"
                min={5}
                max={480}
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Preço (R$)</label>
              <input
                type="text"
                value={priceReais}
                onChange={(e) => setPriceReais(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <label className="font-semibold text-slate-700">Cor Padrão:</label>
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="h-8 w-12 cursor-pointer rounded border border-slate-200 bg-white p-0.5"
              />
              <HexColorSwatch hex={color} />
              <span className="font-mono text-[11px] text-slate-500">{color}</span>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setFormOpen(false)}
                className="rounded-lg border border-slate-200 px-3.5 py-2 font-semibold text-slate-700"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
              >
                <Check className="w-3.5 h-3.5" />
                {saving ? 'Salvando...' : 'Salvar Serviço'}
              </button>
            </div>
          </div>

          {err && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-700 font-medium">
              {err}
            </div>
          )}
        </form>
      )}

      <div className="overflow-x-auto overflow-y-auto max-h-[65vh] scroll-rulers pr-1">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 min-w-[280px]">
          {services.map((srv) => (
            <div
              key={srv.id}
              className="rounded-xl border border-slate-200 bg-white overflow-hidden flex flex-col justify-between"
            >
              <div className="p-4 flex items-start gap-3">
                <HexColorSwatch hex={srv.color || '#e0e7ff'} className="w-2.5 h-12 rounded-sm shrink-0 border border-slate-200" />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="font-display text-sm font-bold text-slate-900 leading-snug">
                    {srv.name}
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-600">
                    <span className="inline-flex items-center gap-1 font-mono font-semibold">
                      <Clock className="w-3.5 h-3.5 text-slate-400" />
                      {srv.durationMinutes} min
                    </span>
                    <span className="font-mono font-bold text-emerald-700">
                      {srv.priceCents > 0 ? formatBRL(srv.priceCents) : 'Cortesia / Padrão'}
                    </span>
                  </div>
                </div>
              </div>

              <div className="px-4 py-2.5 border-t border-slate-100 bg-slate-50/70 flex items-center justify-between">
                <span className="font-mono text-[10px] text-slate-400">#{srv.id}</span>
                <div className="inline-flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => onOpenAudit('schedule_service', srv.id, srv.name)}
                    className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-100"
                  >
                    <History className="w-3 h-3" /> Auditoria
                  </button>
                  <button
                    type="button"
                    onClick={() => openEdit(srv)}
                    className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-blue-700 hover:bg-blue-50"
                  >
                    <Edit3 className="w-3 h-3" /> Editar
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// =============================================================================
// 5. CONFIGURAÇÕES DA AGENDA (HORÁRIOS & CORES DE STATUS)
// =============================================================================
export const ScheduleConfigTabView: React.FC<{
  config: ScheduleConfig;
  onBack: () => void;
  onRefresh: () => Promise<void>;
  onToast: (msg: string) => void;
  onOpenAudit: (entityType: string, entityId: string | number, title: string) => void;
}> = ({ config, onBack, onRefresh, onToast, onOpenAudit }) => {
  const [startTime, setStartTime] = useState(config.startTime || '08:00');
  const [endTime, setEndTime] = useState(config.endTime || '19:00');
  const [slotInterval, setSlotInterval] = useState<number>(config.slotIntervalMinutes || 30);
  const [statusColors, setStatusColors] = useState<ScheduleStatusColors>({
    ...DEFAULT_STATUS_COLORS,
    ...(config.statusColors || {}),
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    setStartTime(config.startTime || '08:00');
    setEndTime(config.endTime || '19:00');
    setSlotInterval(config.slotIntervalMinutes || 30);
    setStatusColors({ ...DEFAULT_STATUS_COLORS, ...(config.statusColors || {}) });
  }, [config]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    setSaving(true);
    try {
      await apiFetch('/api/appointments/config', {
        method: 'PUT',
        body: JSON.stringify({
          startTime,
          endTime,
          slotIntervalMinutes: slotInterval,
          statusColors,
        }),
      });
      onToast('Configurações da grade de horários e cores salvas com sucesso.');
      await onRefresh();
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'Erro ao salvar configurações.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={handleSave}
      className="rounded-xl border border-slate-200 bg-white p-5 space-y-6 text-xs max-w-4xl overflow-x-auto overflow-y-auto scroll-rulers"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
        <div className="flex items-center gap-2">
          <Settings className="w-4 h-4 text-slate-700" />
          <div>
            <h3 className="font-display text-sm font-bold text-slate-900">
              Configurações da Grade &amp; Cores por Status
            </h3>
            <p className="text-[11px] text-slate-500">
              Define os horários exibidos na régua esquerda, intervalo dos slots e paleta dos cartões de agendamento.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-50"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Voltar
          </button>
          <button
            type="button"
            onClick={() => onOpenAudit('system', 'schedule_config', 'Configurações da Agenda')}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-50"
          >
            <History className="w-3.5 h-3.5" /> Auditoria
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label className="block font-semibold text-slate-700 mb-1">Horário de Início da Grade</label>
          <input
            type="time"
            required
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono font-semibold"
          />
        </div>

        <div>
          <label className="block font-semibold text-slate-700 mb-1">Horário de Término da Grade</label>
          <input
            type="time"
            required
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono font-semibold"
          />
        </div>

        <div>
          <label className="block font-semibold text-slate-700 mb-1">Intervalo entre Slots</label>
          <select
            value={slotInterval}
            onChange={(e) => setSlotInterval(Number(e.target.value))}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono font-semibold"
          >
            <option value={15}>15 minutos</option>
            <option value={30}>30 minutos</option>
            <option value={45}>45 minutos</option>
            <option value={60}>60 minutos (1 hora)</option>
          </select>
        </div>
      </div>

      <div className="space-y-3 border-t border-slate-100 pt-4">
        <div className="font-bold text-slate-800 uppercase tracking-wide text-[11px]">
          Cores Personalizadas por Status do Agendamento
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {STATUS_OPTIONS.map((st) => {
            const val = statusColors[st.value] || DEFAULT_STATUS_COLORS[st.value];
            return (
              <div
                key={st.value}
                className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 px-3 py-2.5 bg-slate-50/50"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <HexColorSwatch hex={val} />
                  <span className="font-semibold text-slate-800 truncate">{st.label}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="font-mono text-[10px] text-slate-500 uppercase">{val}</span>
                  <input
                    type="color"
                    value={val}
                    onChange={(e) =>
                      setStatusColors((prev) => ({ ...prev, [st.value]: e.target.value }))
                    }
                    className="h-7 w-9 cursor-pointer rounded border border-slate-200 bg-white p-0.5"
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {err && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-700 font-medium">
          {err}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-slate-100">
        <button
          type="button"
          onClick={() => {
            setStartTime('08:00');
            setEndTime('19:00');
            setSlotInterval(30);
            setStatusColors(DEFAULT_STATUS_COLORS);
          }}
          className="text-slate-600 font-semibold hover:text-slate-900"
        >
          Restaurar Padrão Inicial
        </button>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-4 py-2.5 font-semibold text-slate-700 hover:bg-slate-50"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Voltar
          </button>
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-5 py-2.5 font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          >
            <Check className="w-3.5 h-3.5" />
            {saving ? 'Salvando...' : 'Salvar Configurações'}
          </button>
        </div>
      </div>
    </form>
  );
};
