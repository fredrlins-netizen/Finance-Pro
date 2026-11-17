import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Ban,
  CalendarDays,
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  Edit3,
  Filter,
  History,
  ListChecks,
  Maximize2,
  Minimize2,
  Plus,
  RefreshCw,
  Settings,
  Sparkles,
  Trash2,
  UserCheck,
  Users,
  Wrench,
  X,
} from 'lucide-react';
import { apiFetch } from '../../lib/api.ts';
import {
  Appointment,
  AuthUser,
  ModuleId,
  NavigationIntent,
  ScheduleBlock,
  ScheduleBootstrapPayload,
  ScheduleCollaboratorNode,
  ScheduleConfig,
  ScheduleServiceItem,
  ScheduleWaitlistItem,
  Unit,
  UserGroup,
} from '../../types.ts';
import { ConfirmDeleteModal, EntityAuditModal } from './cadastros/CadastrosShared.tsx';
import {
  addDaysToKey,
  AppointmentsTabId,
  BlockedHatchOverlay,
  buildDateKeysBetween,
  buildTimeSlots,
  CardTintOverlay,
  DEFAULT_STATUS_COLORS,
  findBlockingEntryForSlot,
  formatDateLongBR,
  formatDayMonthBR,
  formatShortDateBR,
  getStatusMeta,
  getWeekdayShortBR,
  getWeekStartKey,
  HexColorSwatch,
  minutesToTimeKey,
  STATUS_OPTIONS,
  timeToMinutes,
  toDateKey,
  toTimeKey,
} from './appointments/appointmentsHelpers.ts';
import {
  AppointmentFormModal,
  AppointmentModalDraft,
  FiltersDrawerModal,
  ManageConsultantsModal,
} from './appointments/ScheduleModals.tsx';
import {
  BlocksTabView,
  ScheduleConfigTabView,
  ServicesTabView,
  WaitlistTabView,
} from './appointments/ScheduleManagementTabs.tsx';

interface AppointmentsModuleProps {
  units: Unit[];
  currentUser: AuthUser;
  activeUnitId: number;
  wsTick: number;
  navIntent?: NavigationIntent | null;
  onClearIntent?: () => void;
  onNavigate?: (mod: ModuleId, intent?: NavigationIntent) => void;
  onGoBack?: () => void;
  previousScreenLabel?: string;
}

const DEFAULT_CONFIG: ScheduleConfig = {
  startTime: '08:00',
  endTime: '19:00',
  slotIntervalMinutes: 30,
  statusColors: DEFAULT_STATUS_COLORS,
};

export const AppointmentsModule: React.FC<AppointmentsModuleProps> = ({
  units: fallbackUnits,
  currentUser,
  activeUnitId,
  wsTick,
  navIntent,
  onClearIntent,
  onNavigate,
  onGoBack,
  previousScreenLabel,
}) => {
  const isAdmin = currentUser.role === 'admin';
  const visibilityStorageKey = `fp_agenda_hidden_collabs_u${currentUser.id}`;

  const [tab, setTab] = useState<AppointmentsTabId>('agenda');
  const [tabHistory, setTabHistory] = useState<AppointmentsTabId[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [banner, setBanner] = useState('');
  const [errBanner, setErrBanner] = useState('');

  // Bootstrap Data
  const [units, setUnits] = useState<Unit[]>(fallbackUnits);
  const [groups, setGroups] = useState<UserGroup[]>([]);
  const [collaborators, setCollaborators] = useState<ScheduleCollaboratorNode[]>([]);
  const [services, setServices] = useState<ScheduleServiceItem[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [blocks, setBlocks] = useState<ScheduleBlock[]>([]);
  const [waitlist, setWaitlist] = useState<ScheduleWaitlistItem[]>([]);
  const [config, setConfig] = useState<ScheduleConfig>(DEFAULT_CONFIG);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string>('');

  // Period & View Mode State (Diário / Hoje, Semanal, Período Selecionado)
  const [viewMode, setViewMode] = useState<'daily' | 'weekly' | 'period'>('daily');
  const [selectedDate, setSelectedDate] = useState<string>(toDateKey(new Date()));
  const [periodEndDate, setPeriodEndDate] = useState<string>(() => addDaysToKey(toDateKey(new Date()), 6));
  const [focusedSubDay, setFocusedSubDay] = useState<string>('all');

  // Filters
  const [unitFilter, setUnitFilter] = useState<string>(
    isAdmin ? 'all' : String(activeUnitId || fallbackUnits[0]?.id || 'all')
  );
  const [groupFilter, setGroupFilter] = useState<string>(
    isAdmin ? 'all' : currentUser.groupId ? String(currentUser.groupId) : 'all'
  );
  const [consultantFilter, setConsultantFilter] = useState<number | null>(null);
  const [waitlistScope, setWaitlistScope] = useState<'period' | 'all'>('period');

  // Column Visibility & Double-Click Column Expansion (#06)
  const [hiddenCollabIds, setHiddenCollabIds] = useState<number[]>(() => {
    try {
      const raw = localStorage.getItem(visibilityStorageKey);
      const parsed = raw ? (JSON.parse(raw) as unknown[]) : [];
      return Array.isArray(parsed) ? parsed.map(Number) : [];
    } catch {
      return [];
    }
  });
  const [expandedColKeys, setExpandedColKeys] = useState<string[]>([]);

  // Modals & Drawers
  const [apptModalOpen, setApptModalOpen] = useState(false);
  const [apptDraft, setApptDraft] = useState<AppointmentModalDraft | null>(null);
  const [manageModalOpen, setManageModalOpen] = useState(false);
  const [filtersDrawerOpen, setFiltersDrawerOpen] = useState(false);
  const [auditModal, setAuditModal] = useState<{
    open: boolean;
    entityType: string;
    entityId: string | number;
    title: string;
  }>({ open: false, entityType: 'appointment', entityId: '', title: '' });

  // Waitlist states
  const [editingWaitlistItem, setEditingWaitlistItem] = useState<ScheduleWaitlistItem | null>(null);
  const [sidebarDeleteWaitlist, setSidebarDeleteWaitlist] = useState<ScheduleWaitlistItem | null>(null);
  const [sidebarDeleteBusy, setSidebarDeleteBusy] = useState(false);

  // Drag & Drop State
  const [draggedApptId, setDraggedApptId] = useState<number | null>(null);

  const switchTab = useCallback(
    (nextTab: AppointmentsTabId) => {
      if (nextTab === tab) return;
      setTabHistory((prev) => [...prev.slice(-10), tab]);
      setTab(nextTab);
    },
    [tab]
  );

  const handleBackAction = useCallback(() => {
    if (tabHistory.length > 0) {
      const prevTab = tabHistory[tabHistory.length - 1];
      setTabHistory((prev) => prev.slice(0, -1));
      setTab(prevTab);
      return;
    }
    if (onGoBack) {
      onGoBack();
    } else if (onNavigate) {
      onNavigate('overview');
    }
  }, [tabHistory, onGoBack, onNavigate]);

  const loadBootstrap = useCallback(
    async (isSilent = false) => {
      if (!isSilent) setLoading(true);
      else setRefreshing(true);
      try {
        const data = await apiFetch<ScheduleBootstrapPayload>('/api/appointments/bootstrap');
        setUnits(data.units?.length ? data.units : fallbackUnits);
        setGroups(data.groups || []);
        setCollaborators(data.collaborators || []);
        setServices(data.services || []);
        setAppointments(data.appointments || []);
        setBlocks(data.blocks || []);
        setWaitlist(data.waitlist || []);
        setConfig(data.config || DEFAULT_CONFIG);
        setLastUpdatedAt(data.lastUpdatedAt || new Date().toISOString());
        setErrBanner('');
      } catch (error) {
        setErrBanner(error instanceof Error ? error.message : 'Erro ao carregar agenda.');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [fallbackUnits]
  );

  useEffect(() => {
    loadBootstrap(false);
  }, [loadBootstrap]);

  useEffect(() => {
    if (wsTick > 0) {
      loadBootstrap(true);
    }
  }, [wsTick, loadBootstrap]);

  useEffect(() => {
    try {
      localStorage.setItem(visibilityStorageKey, JSON.stringify(hiddenCollabIds));
    } catch {
      // ignore storage quota
    }
  }, [hiddenCollabIds, visibilityStorageKey]);

  // Apply external navigation intents
  useEffect(() => {
    if (!navIntent) return;
    if (navIntent.tab && ['agenda', 'bloqueios', 'fila', 'servicos', 'config'].includes(navIntent.tab)) {
      setTab(navIntent.tab as AppointmentsTabId);
    }
    if (navIntent.triggerNew && services.length > 0) {
      const defaultSrv = services[0];
      const dur = defaultSrv?.durationMinutes || 30;
      if (navIntent.clientId) {
        apiFetch<{ clients: Array<{ id: number; fullName: string; phone: string; whatsapp: string; unitId: number }> }>(
          `/api/appointments/clients-search?q=`
        )
          .then((res) => {
            const found = (res.clients || []).find((c) => c.id === navIntent.clientId);
            setApptDraft({
              mode: 'create',
              clientId: navIntent.clientId,
              clientName: found?.fullName || navIntent.clientName,
              clientPhone: found?.whatsapp || found?.phone || navIntent.clientPhone,
              serviceId: defaultSrv?.id ?? null,
              unitId: found?.unitId || navIntent.unitId || activeUnitId || units[0]?.id || 1,
              date: selectedDate,
              startTime: '09:00',
              endTime: minutesToTimeKey(timeToMinutes('09:00') + dur),
              modality: '',
              status: 'agendado',
              notes: navIntent.notes || '',
              useQueueRotation: true,
            });
            setApptModalOpen(true);
          })
          .catch(() => {});
      } else if (navIntent.clientName || navIntent.clientPhone || navIntent.notes) {
        setApptDraft({
          mode: 'create',
          clientName: navIntent.clientName || '',
          clientPhone: navIntent.clientPhone || '',
          serviceId: defaultSrv?.id ?? null,
          unitId: navIntent.unitId || activeUnitId || units[0]?.id || 1,
          date: selectedDate,
          startTime: '09:00',
          endTime: minutesToTimeKey(timeToMinutes('09:00') + dur),
          modality: '',
          status: 'agendado',
          notes: navIntent.notes || '',
          useQueueRotation: true,
        });
        setApptModalOpen(true);
      }
    }
    onClearIntent?.();
  }, [navIntent, services, activeUnitId, units, selectedDate, onClearIntent]);

  const handleSelectDate = (dateKey: string) => {
    setSelectedDate(dateKey);
    setFocusedSubDay('all');
    if (periodEndDate < dateKey) {
      setPeriodEndDate(addDaysToKey(dateKey, 6));
    }
  };

  const toggleCollabVisibility = (collabId: number) => {
    setHiddenCollabIds((prev) =>
      prev.includes(collabId) ? prev.filter((id) => id !== collabId) : [...prev, collabId]
    );
  };

  const toggleExpandColumn = (colKey: string) => {
    setExpandedColKeys((prev) =>
      prev.includes(colKey) ? prev.filter((k) => k !== colKey) : [...prev, colKey]
    );
  };

  // Compute active period date keys (Hoje / Diário, Semanal, ou Período Selecionado)
  const periodRange = useMemo(() => {
    if (viewMode === 'daily') {
      return { start: selectedDate, end: selectedDate, dates: [selectedDate] };
    }
    if (viewMode === 'weekly') {
      const start = getWeekStartKey(selectedDate);
      const end = addDaysToKey(start, 6);
      return { start, end, dates: buildDateKeysBetween(start, end, 7) };
    }
    const safeEnd = periodEndDate >= selectedDate ? periodEndDate : selectedDate;
    return {
      start: selectedDate,
      end: safeEnd,
      dates: buildDateKeysBetween(selectedDate, safeEnd, 14),
    };
  }, [viewMode, selectedDate, periodEndDate]);

  const displayedGridDates = useMemo(() => {
    if (periodRange.dates.length <= 1 || focusedSubDay === 'all') {
      return periodRange.dates;
    }
    return periodRange.dates.includes(focusedSubDay) ? [focusedSubDay] : periodRange.dates;
  }, [periodRange.dates, focusedSubDay]);

  // Collaboradores elegíveis: Ativo + Flag "Participa da Fila" marcada (T) + Unidade + Grupo
  const queueEligibleCollaborators = useMemo(() => {
    return collaborators.filter((c) => c.active && Boolean(c.participatesInScheduleQueue));
  }, [collaborators]);

  const scopedCollaborators = useMemo(() => {
    return queueEligibleCollaborators.filter((c) => {
      if (unitFilter !== 'all' && c.unitId !== Number(unitFilter)) return false;
      if (groupFilter !== 'all' && c.groupId !== Number(groupFilter)) return false;
      return true;
    });
  }, [queueEligibleCollaborators, unitFilter, groupFilter]);

  // Collaborators respecting Consultant filter as well (for Agendas Ativas + Grid)
  const filteredSidebarCollaborators = useMemo(() => {
    if (!consultantFilter) return scopedCollaborators;
    return scopedCollaborators.filter((c) => c.id === consultantFilter);
  }, [scopedCollaborators, consultantFilter]);

  const visibleGridCollaborators = useMemo(() => {
    return filteredSidebarCollaborators.filter((c) => !hiddenCollabIds.includes(c.id));
  }, [filteredSidebarCollaborators, hiddenCollabIds]);

  // Count appointments per collaborator inside the selected period (Hoje / Semana / Período)
  const periodApptCountByCollab = useMemo(() => {
    const map = new Map<number, number>();
    const dateSet = new Set(periodRange.dates);
    appointments.forEach((a) => {
      if (!a.collaboratorId) return;
      if (unitFilter !== 'all' && a.unitId !== Number(unitFilter)) return;
      if (groupFilter !== 'all' && a.groupId && a.groupId !== Number(groupFilter)) return;
      const dKey = toDateKey(new Date(a.scheduledFor));
      if (dateSet.has(dKey)) {
        map.set(a.collaboratorId, (map.get(a.collaboratorId) || 0) + 1);
      }
    });
    return map;
  }, [appointments, periodRange.dates, unitFilter, groupFilter]);

  // Active schedules grouped by unit for narrow left sidebar (#03)
  const activeSchedulesByUnit = useMemo(() => {
    return units
      .filter((u) => unitFilter === 'all' || u.id === Number(unitFilter))
      .map((u) => ({
        unit: u,
        collabs: filteredSidebarCollaborators.filter((c) => c.unitId === u.id),
      }))
      .filter((grp) => grp.collabs.length > 0);
  }, [units, unitFilter, filteredSidebarCollaborators]);

  // Scoped appointments for the grid
  const scopedAppointments = useMemo(() => {
    const visibleIds = new Set(visibleGridCollaborators.map((c) => c.id));
    return appointments.filter((a) => {
      if (unitFilter !== 'all' && a.unitId !== Number(unitFilter)) return false;
      if (groupFilter !== 'all' && a.groupId && a.groupId !== Number(groupFilter)) return false;
      if (consultantFilter && a.collaboratorId !== consultantFilter) return false;
      if (a.collaboratorId && scopedCollaborators.some((c) => c.id === a.collaboratorId)) {
        if (!visibleIds.has(a.collaboratorId) && !consultantFilter) return false;
      }
      return true;
    });
  }, [appointments, unitFilter, groupFilter, consultantFilter, visibleGridCollaborators, scopedCollaborators]);

  // Scoped Waitlist respecting Unidade + Consultor + Período selecionado (#03)
  const unitAndConsultantFilteredWaitlist = useMemo(() => {
    return waitlist.filter((w) => {
      if (unitFilter !== 'all' && w.unitId !== Number(unitFilter)) return false;
      if (
        consultantFilter &&
        w.preferredCollaboratorId &&
        w.preferredCollaboratorId !== consultantFilter
      ) {
        return false;
      }
      return true;
    });
  }, [waitlist, unitFilter, consultantFilter]);

  const periodFilteredWaitlist = useMemo(() => {
    const dateSet = new Set(periodRange.dates);
    return unitAndConsultantFilteredWaitlist.filter((w) => dateSet.has(w.desiredDate));
  }, [unitAndConsultantFilteredWaitlist, periodRange.dates]);

  const sidebarWaitlistItems =
    waitlistScope === 'period' ? periodFilteredWaitlist : unitAndConsultantFilteredWaitlist;

  // Time slots from Config
  const timeSlots = useMemo(() => buildTimeSlots(config), [config]);
  const slotStep = config.slotIntervalMinutes || 30;

  // Helpers to open New/Edit Appointment Modal
  const openCreateModal = (opts?: {
    date?: string;
    startTime?: string;
    collaborator?: ScheduleCollaboratorNode | null;
    unitId?: number;
    waitlistItem?: ScheduleWaitlistItem | null;
  }) => {
    const targetDate = opts?.date || selectedDate;
    const targetStart = opts?.startTime || config.startTime || '08:00';
    const colab = opts?.collaborator || null;
    const wl = opts?.waitlistItem || null;
    const defaultSrv = wl
      ? services.find((s) => s.id === wl.serviceId)
      : services[0];
    const dur = defaultSrv?.durationMinutes || 30;
    const endTime = minutesToTimeKey(timeToMinutes(targetStart) + dur);

    setApptDraft({
      mode: 'create',
      clientId: wl?.clientId ?? null,
      clientName: wl?.clientName,
      clientPhone: wl?.clientPhone,
      serviceId: defaultSrv?.id ?? null,
      collaboratorId: wl?.preferredCollaboratorId ?? colab?.id ?? null,
      collaboratorName: colab?.name,
      unitId:
        wl?.unitId ||
        colab?.unitId ||
        (unitFilter !== 'all' ? Number(unitFilter) : activeUnitId || units[0]?.id || 1),
      date: wl?.desiredDate || targetDate,
      startTime: wl?.desiredTime || targetStart,
      endTime: wl ? minutesToTimeKey(timeToMinutes(wl.desiredTime || targetStart) + dur) : endTime,
      modality: '',
      status: 'agendado',
      notes: wl?.notes || '',
      waitlistId: wl?.id ?? null,
      useQueueRotation: Boolean(!colab && !wl?.preferredCollaboratorId),
    });
    setApptModalOpen(true);
  };

  const openEditModal = (appt: Appointment) => {
    const startDt = new Date(appt.scheduledFor);
    const endDt = appt.endAt ? new Date(appt.endAt) : new Date(startDt.getTime() + 30 * 60000);
    setApptDraft({
      mode: 'edit',
      appointmentId: appt.id,
      clientId: appt.clientId,
      clientName: appt.clientName,
      clientPhone: appt.clientPhone,
      serviceId: appt.serviceId ?? null,
      collaboratorId: appt.collaboratorId ?? null,
      collaboratorName: appt.collaboratorName,
      unitId: appt.unitId,
      date: toDateKey(startDt),
      startTime: toTimeKey(startDt),
      endTime: toTimeKey(endDt),
      modality: appt.modality || '',
      status: appt.status,
      notes: appt.notes || '',
      createdByName: appt.createdByName,
      updatedByName: appt.updatedByName,
    });
    setApptModalOpen(true);
  };

  const handleQuickScheduleForCollab = (colab: ScheduleCollaboratorNode) => {
    const startMinLimit = timeToMinutes(config.startTime || '08:00');
    const endMinLimit = timeToMinutes(config.endTime || '19:00');
    const now = new Date();
    const todayKey = toDateKey(now);

    for (const candidateDate of periodRange.dates) {
      const minNow = candidateDate === todayKey ? now.getHours() * 60 + now.getMinutes() : 0;
      for (let m = startMinLimit; m + 30 <= endMinLimit; m += slotStep) {
        if (candidateDate === todayKey && m < minNow) continue;
        const blocked = findBlockingEntryForSlot({
          blocks,
          collaboratorId: colab.id,
          consultantUserId: colab.userId,
          dateKey: candidateDate,
          slotStartMin: m,
          slotEndMin: m + 30,
        });
        if (blocked) continue;
        const busyAppt = appointments.some((a) => {
          if (a.collaboratorId !== colab.id) return false;
          const aDt = new Date(a.scheduledFor);
          if (toDateKey(aDt) !== candidateDate) return false;
          const aStart = timeToMinutes(toTimeKey(aDt));
          const aEnd = a.endAt ? timeToMinutes(toTimeKey(new Date(a.endAt))) : aStart + 30;
          return m < aEnd && m + 30 > aStart;
        });
        if (!busyAppt) {
          openCreateModal({
            date: candidateDate,
            startTime: minutesToTimeKey(m),
            collaborator: colab,
            unitId: colab.unitId,
          });
          return;
        }
      }
    }

    setErrBanner(
      `Sem horário livre de 30 min para ${colab.name} no período selecionado (${formatShortDateBR(periodRange.start)}).`
    );
  };

  // Drag & Drop Handler
  const handleDropOnSlot = async (params: {
    targetDate: string;
    targetTime: string;
    targetCollabId?: number | null;
    targetUserId?: number | null;
  }) => {
    if (!draggedApptId) return;
    const appt = appointments.find((a) => a.id === draggedApptId);
    setDraggedApptId(null);
    if (!appt) return;

    const origStart = new Date(appt.scheduledFor);
    const origEnd = appt.endAt ? new Date(appt.endAt) : new Date(origStart.getTime() + 30 * 60000);
    const durMin = Math.max(15, Math.round((origEnd.getTime() - origStart.getTime()) / 60000));
    const nextStartMin = timeToMinutes(params.targetTime);
    const nextEndTime = minutesToTimeKey(nextStartMin + durMin);

    const destCollabId = params.targetCollabId ?? appt.collaboratorId ?? null;
    const destUserId =
      params.targetUserId ??
      (destCollabId ? collaborators.find((c) => c.id === destCollabId)?.userId ?? null : appt.consultantId);

    const blk = findBlockingEntryForSlot({
      blocks,
      collaboratorId: destCollabId,
      consultantUserId: destUserId,
      dateKey: params.targetDate,
      slotStartMin: nextStartMin,
      slotEndMin: nextStartMin + durMin,
    });

    if (blk) {
      setErrBanner(`Não foi possível mover: horário bloqueado (${blk.reason}).`);
      return;
    }

    try {
      await apiFetch(`/api/appointments/${appt.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          date: params.targetDate,
          startTime: params.targetTime,
          endTime: nextEndTime,
          collaboratorId: destCollabId,
        }),
      });
      setBanner(
        `Agendamento de ${appt.clientName} movido para ${formatShortDateBR(params.targetDate)} às ${params.targetTime}.`
      );
      await loadBootstrap(true);
    } catch (error) {
      setErrBanner(error instanceof Error ? error.message : 'Erro ao mover agendamento.');
    }
  };

  const handleDeleteWaitlistSidebar = async () => {
    if (!sidebarDeleteWaitlist) return;
    setSidebarDeleteBusy(true);
    try {
      await apiFetch(`/api/appointments/waitlist/${sidebarDeleteWaitlist.id}`, {
        method: 'DELETE',
      });
      setSidebarDeleteWaitlist(null);
      setBanner('Registro removido da fila de espera.');
      await loadBootstrap(true);
    } catch (error) {
      setErrBanner(error instanceof Error ? error.message : 'Erro ao remover da fila de espera.');
    } finally {
      setSidebarDeleteBusy(false);
    }
  };

  const tabItems: Array<{
    id: AppointmentsTabId;
    label: string;
    icon: React.FC<{ className?: string }>;
    badge?: number;
  }> = [
    { id: 'agenda', label: 'Agenda', icon: CalendarDays },
    { id: 'bloqueios', label: 'Bloquear Agenda', icon: Ban, badge: blocks.length },
    { id: 'fila', label: 'Fila de Espera', icon: ListChecks, badge: unitAndConsultantFilteredWaitlist.length },
    { id: 'servicos', label: 'Serviços', icon: Wrench },
    { id: 'config', label: 'Configurações', icon: Settings },
  ];

  // Render appointment card inside calendar cell (supports expanded detail mode when column is double-clicked)
  const renderAppointmentCard = (appt: Appointment, isExpandedCol: boolean) => {
    const startDt = new Date(appt.scheduledFor);
    const endDt = appt.endAt ? new Date(appt.endAt) : new Date(startDt.getTime() + 30 * 60000);
    const dateShort = formatShortDateBR(toDateKey(startDt));
    const timeRange = `${toTimeKey(startDt)} - ${toTimeKey(endDt)}`;
    const st = getStatusMeta(appt.status, config.statusColors);
    const isPresencial = appt.modality === 'presencial';
    const isOnline = appt.modality === 'online';

    return (
      <div
        key={appt.id}
        draggable
        onDragStart={(e) => {
          setDraggedApptId(appt.id);
          e.dataTransfer.setData('text/plain', String(appt.id));
        }}
        onDragEnd={() => setDraggedApptId(null)}
        onClick={(e) => {
          e.stopPropagation();
          openEditModal(appt);
        }}
        className={`group relative rounded-lg border border-slate-300/80 bg-white overflow-hidden cursor-grab active:cursor-grabbing text-[11px] hover:border-slate-900 transition-colors dark:bg-slate-900 ${
          isExpandedCol ? 'p-3' : 'p-2'
        }`}
      >
        <CardTintOverlay hex={st.hex} />
        <div className="relative z-10 space-y-1">
          <div className="flex items-start justify-between gap-1.5">
            <div
              className={`font-bold text-slate-900 leading-tight dark:text-slate-100 ${
                isExpandedCol ? 'text-xs whitespace-normal' : 'truncate'
              }`}
            >
              {appt.clientName}
            </div>
            {(isPresencial || isOnline) && (
              <span
                className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${
                  isPresencial ? 'bg-orange-100 text-orange-800 dark:bg-orange-900/50 dark:text-orange-300' : 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300'
                }`}
              >
                {isPresencial ? 'Presencial' : 'OnLine'}
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-1 text-[10px] font-mono text-slate-700 dark:text-slate-200">
            <span>
              {isExpandedCol ? `${dateShort} · ${timeRange}` : timeRange}
            </span>
            <span
              className={`font-sans font-semibold text-slate-800 dark:text-slate-100 ${
                isExpandedCol ? '' : 'truncate'
              }`}
            >
              {st.label}
            </span>
          </div>

          {appt.serviceName && (
            <div
              className={`text-[10px] text-slate-700 font-medium dark:text-slate-200 ${
                isExpandedCol ? 'whitespace-normal' : 'truncate'
              }`}
            >
              {appt.serviceName}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-slate-600 dark:text-slate-300">
            {appt.clientPhone && <span className="font-mono">{appt.clientPhone}</span>}
            {isExpandedCol && appt.collaboratorName && (
              <span className="font-semibold text-slate-800 dark:text-slate-100">· {appt.collaboratorName}</span>
            )}
          </div>

          {appt.clientAddress && (
            <div
              className={`text-[10px] text-slate-500 dark:text-slate-400 ${
                isExpandedCol ? 'whitespace-normal' : 'truncate'
              }`}
            >
              {appt.clientAddress}
            </div>
          )}

          {isExpandedCol && appt.notes && (
            <div className="pt-1 border-t border-slate-200/70 text-[10px] text-slate-700 whitespace-normal dark:text-slate-200">
              <strong>Obs:</strong> {appt.notes}
            </div>
          )}
        </div>

        {/* Rich Hover Tooltip Details */}
        <div className="hidden group-hover:block fixed z-50 pointer-events-none bottom-4 right-4 max-w-sm rounded-xl border border-slate-200 bg-slate-900 text-white p-3.5 shadow-2xl text-[11px] space-y-1.5 dark:border-slate-700 dark:bg-emerald-600">
          <div className="flex items-center justify-between gap-2 border-b border-slate-700 pb-1.5">
            <span className="font-bold text-white truncate">{appt.clientName}</span>
            <span className="font-mono text-emerald-300 shrink-0">
              {dateShort} · {timeRange}
            </span>
          </div>
          <div>
            <strong>Serviço:</strong> {appt.serviceName || 'Atendimento'} ·{' '}
            <strong>Status:</strong> {st.label}
          </div>
          <div>
            <strong>Colaborador:</strong> {appt.collaboratorName || 'Consultor'} ·{' '}
            <strong>Modalidade:</strong>{' '}
            {isPresencial ? 'Presencial' : isOnline ? 'OnLine' : 'Não definida'}
          </div>
          {appt.clientPhone && (
            <div>
              <strong>Telefone:</strong> {appt.clientPhone}
            </div>
          )}
          {appt.clientAddress && (
            <div>
              <strong>Endereço:</strong> {appt.clientAddress}
            </div>
          )}
          {appt.notes && (
            <div className="text-slate-300">
              <strong>Obs:</strong> {appt.notes}
            </div>
          )}
          <div className="pt-1 border-t border-slate-700 text-[10px] text-slate-400 dark:text-slate-400">
            Criado por: {appt.createdByName || 'Sistema'}
            {appt.updatedByName ? ` · Editado por: ${appt.updatedByName}` : ''}
          </div>
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
        Carregando módulo de Agendamentos, Consultores e Grade de Horários...
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Header & Navigation Tabs */}
      <div className="rounded-xl border border-slate-200 bg-white px-4 sm:px-5 py-3.5 space-y-3 dark:border-slate-700 dark:bg-slate-900">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-2.5 min-w-0">
            <button
              type="button"
              onClick={handleBackAction}
              title={
                tabHistory.length > 0
                  ? 'Voltar para a aba anterior'
                  : `Voltar para a tela anterior${previousScreenLabel ? ` (${previousScreenLabel})` : ''}`
              }
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-700 shrink-0 mt-0.5"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Voltar</span>
            </button>
            <div className="min-w-0">
              <h1 className="font-display text-base sm:text-lg font-bold text-slate-900 flex items-center gap-2 truncate dark:text-slate-100">
                <CalendarDays className="w-5 h-5 text-emerald-700 shrink-0 dark:text-emerald-300" />
                <span className="truncate">Agendamentos &amp; Gestão de Horários</span>
              </h1>
              <p className="text-xs text-slate-500 mt-0.5 dark:text-slate-400">
                Grade por Data, Horário e Colaborador integrada a Colaboradores (Participa da Fila), Clientes, Bloqueios, WhatsApp e Auditoria.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0 text-xs">
            <button
              type="button"
              onClick={() =>
                setAuditModal({
                  open: true,
                  entityType: 'appointments,schedule_blocks,schedule_waitlist',
                  entityId: 'all',
                  title: 'Agendamentos & Escala · Auditoria Cumulativa',
                })
              }
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <History className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" /> Auditoria
            </button>
            {onNavigate && (
              <button
                type="button"
                onClick={() => onNavigate('cad_colaboradores')}
                className="rounded-lg border border-slate-200 px-3 py-2 font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Colaboradores (Fila)
              </button>
            )}
            <button
              type="button"
              onClick={() => openCreateModal()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 font-semibold text-white hover:bg-slate-800 dark:bg-emerald-600 dark:hover:bg-emerald-500"
            >
              <Plus className="w-3.5 h-3.5" /> Novo Agendamento
            </button>
          </div>
        </div>

        {/* Sub-abas com rolamento horizontal para Mobile e Tablets */}
        <div className="flex items-center gap-1.5 border-t border-slate-100 pt-2.5 overflow-x-auto scroll-rulers pb-1 dark:border-slate-800">
          {tabItems.map((item) => {
            const Icon = item.icon;
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => switchTab(item.id)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
                  active
                    ? 'bg-slate-900 text-white dark:bg-emerald-600'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{item.label}</span>
                {typeof item.badge === 'number' && item.badge > 0 && (
                  <span
                    className={`font-mono text-[10px] font-bold px-1.5 py-0.5 rounded ${
                      active ? 'bg-white/20 text-white' : 'bg-white text-slate-800 dark:bg-slate-900 dark:text-slate-100'
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Status Banners */}
      {banner && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-medium text-emerald-900 flex items-center justify-between gap-2 dark:border-emerald-800/70 dark:bg-emerald-950/50 dark:text-emerald-300">
          <span>{banner}</span>
          <button type="button" onClick={() => setBanner('')} className="text-emerald-700 hover:text-emerald-950 dark:text-emerald-300">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      {errBanner && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-xs font-medium text-red-800 flex items-center justify-between gap-2 dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300">
          <span>{errBanner}</span>
          <button type="button" onClick={() => setErrBanner('')} className="text-red-700 hover:text-red-950 dark:text-red-300">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* =====================================================================
          TAB 1: AGENDA (PAINEL ESTREITO À ESQUERDA + GRADE DATA/HORÁRIO/COLABORADOR)
         ===================================================================== */}
      {tab === 'agenda' && (
        <div className="space-y-3">
          {/* Toolbar da Grade com rolagem horizontal p/ telas menores */}
          <div className="rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 overflow-x-auto scroll-rulers dark:border-slate-700 dark:bg-slate-900">
            <div className="flex flex-wrap items-center justify-between gap-2.5 text-xs min-w-max sm:min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                {/* Visão Diário / Semanal / Período */}
                <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 dark:border-slate-700 dark:bg-slate-800/70">
                  <button
                    type="button"
                    onClick={() => {
                      setViewMode('daily');
                      setFocusedSubDay('all');
                    }}
                    className={`rounded-md px-2.5 py-1.5 font-semibold ${
                      viewMode === 'daily'
                        ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-slate-100'
                        : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
                    }`}
                  >
                    Diário
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setViewMode('weekly');
                      setFocusedSubDay('all');
                    }}
                    className={`rounded-md px-2.5 py-1.5 font-semibold ${
                      viewMode === 'weekly'
                        ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-slate-100'
                        : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
                    }`}
                  >
                    Semanal
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setViewMode('period');
                      setFocusedSubDay('all');
                      if (periodEndDate <= selectedDate) {
                        setPeriodEndDate(addDaysToKey(selectedDate, 4));
                      }
                    }}
                    className={`rounded-md px-2.5 py-1.5 font-semibold ${
                      viewMode === 'period'
                        ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-slate-100'
                        : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
                    }`}
                  >
                    Período
                  </button>
                </div>

                {/* Navegação de Data / Período */}
                <div className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-1.5 py-1 dark:border-slate-700 dark:bg-slate-900">
                  <button
                    type="button"
                    onClick={() =>
                      handleSelectDate(addDaysToKey(selectedDate, viewMode === 'weekly' ? -7 : -1))
                    }
                    aria-label="Período anterior"
                    className="p-1 rounded hover:bg-slate-100 text-slate-600 dark:hover:bg-slate-800 dark:text-slate-300"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <input
                    type="date"
                    value={selectedDate}
                    onChange={(e) => e.target.value && handleSelectDate(e.target.value)}
                    aria-label="Data inicial"
                    className="font-mono font-semibold text-slate-900 bg-transparent px-1 focus:outline-none dark:text-slate-100"
                  />
                  {viewMode === 'period' && (
                    <>
                      <span className="text-slate-400 font-mono dark:text-slate-400">→</span>
                      <input
                        type="date"
                        value={periodEndDate}
                        min={selectedDate}
                        onChange={(e) => e.target.value && setPeriodEndDate(e.target.value)}
                        aria-label="Data final"
                        className="font-mono font-semibold text-slate-900 bg-transparent px-1 focus:outline-none dark:text-slate-100"
                      />
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() =>
                      handleSelectDate(addDaysToKey(selectedDate, viewMode === 'weekly' ? 7 : 1))
                    }
                    aria-label="Próximo período"
                    className="p-1 rounded hover:bg-slate-100 text-slate-600 dark:hover:bg-slate-800 dark:text-slate-300"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    const today = toDateKey(new Date());
                    setSelectedDate(today);
                    setFocusedSubDay('all');
                    if (viewMode === 'period') {
                      setPeriodEndDate(today);
                    }
                  }}
                  className={`rounded-lg border px-3 py-1.5 font-semibold ${
                    selectedDate === toDateKey(new Date()) && viewMode === 'daily'
                      ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800/70 dark:bg-emerald-950/50 dark:text-emerald-300'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800'
                  }`}
                >
                  Hoje
                </button>

                <span className="hidden lg:inline font-semibold text-slate-700 capitalize px-1 dark:text-slate-200">
                  {viewMode === 'daily'
                    ? formatDateLongBR(selectedDate)
                    : `${formatShortDateBR(periodRange.start)} → ${formatShortDateBR(periodRange.end)}`}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {/* Filtro Unidade */}
                <select
                  value={unitFilter}
                  onChange={(e) => setUnitFilter(e.target.value)}
                  aria-label="Filtrar por unidade"
                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                >
                  {isAdmin && <option value="all">Todas as Unidades</option>}
                  {units.map((u) => (
                    <option key={u.id} value={String(u.id)}>
                      {u.code} · {u.name}
                    </option>
                  ))}
                </select>

                {/* Filtro Grupo */}
                <select
                  value={groupFilter}
                  onChange={(e) => setGroupFilter(e.target.value)}
                  disabled={!isAdmin && groups.length <= 1}
                  aria-label="Filtrar por grupo"
                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-semibold text-slate-700 disabled:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                >
                  {isAdmin && <option value="all">Todos os Grupos</option>}
                  {groups.map((g) => (
                    <option key={g.id} value={String(g.id)}>
                      Grupo: {g.name}
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  onClick={() => setManageModalOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <Users className="w-3.5 h-3.5" />
                  Consultores ({visibleGridCollaborators.length})
                </button>

                <button
                  type="button"
                  onClick={() => setFiltersDrawerOpen(true)}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 font-semibold ${
                    consultantFilter
                      ? 'border-blue-600 bg-blue-50 text-blue-800 dark:bg-blue-950/50 dark:text-blue-300'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800'
                  }`}
                >
                  <Filter className="w-3.5 h-3.5" />
                  Filtros {consultantFilter ? '(1)' : ''}
                </button>

                <button
                  type="button"
                  onClick={() => loadBootstrap(true)}
                  disabled={refreshing}
                  title="Sincronizar grade em tempo real"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
                  <span className="hidden sm:inline font-mono text-[11px]">
                    {lastUpdatedAt
                      ? new Date(lastUpdatedAt).toLocaleTimeString('pt-BR', {
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        })
                      : 'Atualizar'}
                  </span>
                </button>
              </div>
            </div>
          </div>

          {/* CONTAINER PRINCIPAL LADO A LADO (#02 sem mini-calendário + #03 container estreito à esquerda + #04/#06 grade à direita) */}
          <div className="flex flex-col md:flex-row gap-3 items-stretch">
            {/* CONTAINER ESTREITO À ESQUERDA: Agendas Ativas + Fila de Espera (respeitando filtros de consultor, semana, Hoje e período) */}
            <aside className="w-full md:w-52 lg:w-56 shrink-0 flex flex-col gap-3 text-xs">
              {/* Agendas Ativas */}
              <div className="rounded-xl border border-slate-200 bg-white overflow-hidden flex flex-col dark:border-slate-700 dark:bg-slate-900">
                <div className="px-3 py-2.5 border-b border-slate-100 flex items-center justify-between gap-1 bg-slate-50/60 dark:border-slate-800 dark:bg-slate-800/60">
                  <div className="flex items-center gap-1.5 font-display text-xs font-bold text-slate-900 truncate dark:text-slate-100">
                    <UserCheck className="w-3.5 h-3.5 text-emerald-700 shrink-0 dark:text-emerald-300" />
                    <span className="truncate">Agendas Ativas</span>
                  </div>
                  <span className="font-mono text-[10px] text-slate-500 shrink-0 dark:text-slate-400">
                    {filteredSidebarCollaborators.length} prof.
                  </span>
                </div>

                {consultantFilter && (
                  <div className="px-3 py-1.5 bg-blue-50 border-b border-blue-100 flex items-center justify-between text-[10px] text-blue-800 dark:bg-blue-950/50 dark:border-blue-800/70 dark:text-blue-300">
                    <span className="font-semibold truncate">Filtro consultor ativo</span>
                    <button
                      type="button"
                      onClick={() => setConsultantFilter(null)}
                      className="font-bold underline shrink-0"
                    >
                      Todos
                    </button>
                  </div>
                )}

                <div className="p-2 space-y-2.5 max-h-[300px] md:max-h-[340px] overflow-y-auto overflow-x-auto scroll-rulers">
                  {activeSchedulesByUnit.length === 0 ? (
                    <div className="py-4 px-2 text-center text-[11px] text-slate-500 space-y-2 dark:text-slate-400">
                      <p>
                        Nenhum colaborador com a flag &ldquo;Participa da Fila&rdquo; marcada para os filtros atuais.
                      </p>
                      {onNavigate && (
                        <button
                          type="button"
                          onClick={() => onNavigate('cad_colaboradores')}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-semibold text-slate-800 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-100 dark:hover:bg-slate-800"
                        >
                          Configurar em Colaboradores
                        </button>
                      )}
                    </div>
                  ) : (
                    activeSchedulesByUnit.map(({ unit, collabs }) => (
                      <div key={unit.id} className="space-y-1">
                        <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400 px-1 truncate dark:text-slate-400">
                          {unit.code} · {unit.name}
                        </div>
                        <div className="space-y-1">
                          {collabs.map((c) => {
                            const isVisible = !hiddenCollabIds.includes(c.id);
                            const apptCount = periodApptCountByCollab.get(c.id) || 0;
                            return (
                              <div
                                key={c.id}
                                className={`flex items-center justify-between gap-1.5 rounded-lg border px-2 py-1.5 transition-colors ${
                                  isVisible
                                    ? 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900'
                                    : 'border-slate-100 bg-slate-50 opacity-55 dark:border-slate-800 dark:bg-slate-800/70'
                                }`}
                              >
                                <button
                                  type="button"
                                  onClick={() => toggleCollabVisibility(c.id)}
                                  onDoubleClick={() => toggleExpandColumn(String(c.id))}
                                  title={
                                    isVisible
                                      ? 'Clique para ocultar coluna · Duplo clique para ampliar coluna'
                                      : 'Clique para exibir coluna na grade'
                                  }
                                  className="min-w-0 flex-1 text-left"
                                >
                                  <div className="flex items-center gap-1">
                                    <span className="font-semibold text-[11px] text-slate-900 truncate dark:text-slate-100">
                                      {c.name}
                                    </span>
                                    {c.participatesInScheduleQueue && (
                                      <span className="text-[9px] font-bold text-emerald-700 shrink-0 dark:text-emerald-300">
                                        ✓ Fila
                                      </span>
                                    )}
                                  </div>
                                  <div className="flex flex-wrap items-center gap-1 text-[9px] text-slate-500 dark:text-slate-400">
                                    <span className="truncate max-w-[95px]">{c.jobTitle}</span>
                                    <span className="font-mono text-slate-700 font-semibold dark:text-slate-200">
                                      · {apptCount}
                                    </span>
                                    {c.isNextInQueue && (
                                      <span className="inline-flex items-center gap-0.5 rounded bg-amber-100 px-1 py-0.2 font-bold text-amber-800 shrink-0 dark:bg-amber-900/50 dark:text-amber-300">
                                        <Sparkles className="w-2.5 h-2.5" /> Próx.
                                      </span>
                                    )}
                                  </div>
                                </button>

                                {c.participatesInScheduleQueue && (
                                  <button
                                    type="button"
                                    onClick={() => handleQuickScheduleForCollab(c)}
                                    title={`Agendar próximo horário livre com ${c.name}`}
                                    className="rounded border border-emerald-200 bg-emerald-50 p-1 text-emerald-700 hover:bg-emerald-100 shrink-0 dark:border-emerald-800/70 dark:bg-emerald-950/50 dark:text-emerald-300 dark:hover:bg-emerald-900/60"
                                  >
                                    <CalendarPlus className="w-3 h-3" />
                                  </button>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Fila de Espera (Compacta no container estreito, respeitando filtros e período) */}
              <div className="rounded-xl border border-slate-200 bg-white overflow-hidden flex flex-col dark:border-slate-700 dark:bg-slate-900">
                <div className="px-3 py-2.5 border-b border-slate-100 flex items-center justify-between gap-1 bg-slate-50/60 dark:border-slate-800 dark:bg-slate-800/60">
                  <div className="flex items-center gap-1.5 font-display text-xs font-bold text-slate-900 truncate dark:text-slate-100">
                    <ListChecks className="w-3.5 h-3.5 text-blue-700 shrink-0 dark:text-blue-300" />
                    <span className="truncate">Fila ({sidebarWaitlistItems.length})</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => switchTab('fila')}
                    className="text-[10px] font-semibold text-blue-700 hover:underline shrink-0 dark:text-blue-300"
                  >
                    Gerenciar
                  </button>
                </div>

                {/* Escopo da Fila: Período Selecionado vs Todas */}
                <div className="px-2.5 py-1.5 border-b border-slate-100 flex items-center justify-between gap-1 text-[10px] bg-white dark:border-slate-800 dark:bg-slate-900">
                  <button
                    type="button"
                    onClick={() => setWaitlistScope('period')}
                    className={`flex-1 rounded py-0.5 font-semibold text-center ${
                      waitlistScope === 'period'
                        ? 'bg-slate-900 text-white dark:bg-emerald-600'
                        : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                    }`}
                  >
                    No período ({periodFilteredWaitlist.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setWaitlistScope('all')}
                    className={`flex-1 rounded py-0.5 font-semibold text-center ${
                      waitlistScope === 'all'
                        ? 'bg-slate-900 text-white dark:bg-emerald-600'
                        : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                    }`}
                  >
                    Todas ({unitAndConsultantFilteredWaitlist.length})
                  </button>
                </div>

                <div className="divide-y divide-slate-100 max-h-60 overflow-y-auto overflow-x-auto scroll-rulers dark:divide-slate-800">
                  {sidebarWaitlistItems.length === 0 ? (
                    <div className="p-3 text-center text-[11px] text-slate-500 dark:text-slate-400">
                      {waitlistScope === 'period' && unitAndConsultantFilteredWaitlist.length > 0
                        ? 'Nenhum cliente para este período.'
                        : 'Fila de espera vazia.'}
                    </div>
                  ) : (
                    sidebarWaitlistItems.map((w) => (
                      <div key={w.id} className="p-2.5 space-y-1.5 hover:bg-slate-50 dark:hover:bg-slate-800">
                        <div className="min-w-0">
                          <div className="font-semibold text-[11px] text-slate-900 truncate dark:text-slate-100">
                            {w.clientName}
                          </div>
                          <div className="text-[10px] text-slate-500 truncate dark:text-slate-400">
                            {w.serviceName}
                          </div>
                          <div className="font-mono text-[9px] text-slate-500 dark:text-slate-400">
                            {formatShortDateBR(w.desiredDate)} · {w.desiredTime}
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() =>
                              openCreateModal({
                                waitlistItem: w,
                                collaborator: w.preferredCollaboratorId
                                  ? collaborators.find((c) => c.id === w.preferredCollaboratorId) || null
                                  : null,
                              })
                            }
                            className="inline-flex items-center gap-1 rounded bg-emerald-600 px-2 py-0.5 text-[10px] font-semibold text-white hover:bg-emerald-700"
                          >
                            <CalendarPlus className="w-2.5 h-2.5" /> Agendar
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingWaitlistItem(w);
                              switchTab('fila');
                            }}
                            title="Editar na fila"
                            className="rounded border border-slate-200 p-1 text-blue-700 hover:bg-blue-50 dark:border-slate-700 dark:text-blue-300 dark:hover:bg-blue-950/60"
                          >
                            <Edit3 className="w-2.5 h-2.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setSidebarDeleteWaitlist(w)}
                            title="Remover da fila"
                            className="rounded border border-red-200 p-1 text-red-600 hover:bg-red-50 dark:border-red-800/70 dark:text-red-400 dark:hover:bg-red-950/60"
                          >
                            <Trash2 className="w-2.5 h-2.5" />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </aside>

            {/* GRADE PRINCIPAL DE AGENDAMENTOS À DIREITA (#04 Data + Horário + Colaborador no topo, #06 Duplo clique amplia coluna, + Réguas Horizontais/Verticais) */}
            <section className="flex-1 min-w-0 rounded-xl border border-slate-200 bg-white overflow-hidden flex flex-col dark:border-slate-700 dark:bg-slate-900">
              {/* Legenda de Cores & Dica de Duplo Clique */}
              <div className="px-3.5 py-2 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-2 text-[11px] overflow-x-auto scroll-rulers dark:border-slate-700 dark:bg-slate-800/70">
                <div className="flex flex-wrap items-center gap-2.5">
                  {STATUS_OPTIONS.map((st) => (
                    <span key={st.value} className="inline-flex items-center gap-1 text-slate-700 font-medium whitespace-nowrap dark:text-slate-200">
                      <HexColorSwatch
                        hex={config.statusColors[st.value] || DEFAULT_STATUS_COLORS[st.value]}
                        className="w-3 h-3 rounded-xs border border-slate-300 dark:border-slate-600"
                      />
                      {st.shortLabel}
                    </span>
                  ))}
                </div>
                <div className="flex items-center gap-2 text-[10px] text-slate-500 dark:text-slate-400">
                  <span>Duplo clique na coluna para ampliar/reduzir · Arraste cartões para mover</span>
                  {expandedColKeys.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setExpandedColKeys([])}
                      className="font-semibold text-blue-700 hover:underline whitespace-nowrap dark:text-blue-300"
                    >
                      Restaurar larguras
                    </button>
                  )}
                </div>
              </div>

              {/* Seletor rápido de dias quando Semanal ou Período está ativo */}
              {periodRange.dates.length > 1 && (
                <div className="px-3.5 py-2 border-b border-slate-200 bg-white flex items-center gap-1.5 overflow-x-auto scroll-rulers text-[11px] dark:border-slate-700 dark:bg-slate-900">
                  <span className="font-semibold text-slate-500 shrink-0 mr-1 dark:text-slate-400">Dias no período:</span>
                  <button
                    type="button"
                    onClick={() => setFocusedSubDay('all')}
                    className={`rounded-md px-2.5 py-1 font-semibold whitespace-nowrap shrink-0 ${
                      focusedSubDay === 'all'
                        ? 'bg-slate-900 text-white dark:bg-emerald-600'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
                    }`}
                  >
                    Todos ({periodRange.dates.length})
                  </button>
                  {periodRange.dates.map((dKey) => (
                    <button
                      key={dKey}
                      type="button"
                      onClick={() => setFocusedSubDay(dKey)}
                      className={`rounded-md px-2.5 py-1 font-mono font-semibold whitespace-nowrap shrink-0 ${
                        focusedSubDay === dKey
                          ? 'bg-emerald-700 text-white'
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
                      }`}
                    >
                      {getWeekdayShortBR(dKey)} {formatDayMonthBR(dKey)}
                    </button>
                  ))}
                </div>
              )}

              {/* Container da Tabela com Réguas Horizontais e Verticais visíveis */}
              <div className="overflow-x-auto overflow-y-auto max-h-[calc(100vh-260px)] min-h-[420px] scroll-rulers">
                {(() => {
                  const cols: Array<{
                    key: string;
                    label: string;
                    sub: string;
                    collab: ScheduleCollaboratorNode | null;
                  }> =
                    visibleGridCollaborators.length > 0
                      ? visibleGridCollaborators.map((c) => ({
                          key: String(c.id),
                          label: c.name,
                          sub: c.jobTitle,
                          collab: c,
                        }))
                      : [
                          {
                            key: 'all',
                            label: 'Agenda da Unidade',
                            sub: 'Sem filtro de consultor',
                            collab: null,
                          },
                        ];

                  return (
                    <table className="w-max min-w-full border-collapse text-xs">
                      <thead className="sticky top-0 z-20 bg-slate-50 shadow-2xs dark:bg-slate-800/70">
                        <tr className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/70">
                          <th className="w-24 min-w-[96px] py-2.5 px-2.5 text-center font-mono text-[11px] font-bold text-slate-600 border-r border-slate-200 bg-slate-50 sm:sticky sm:left-0 sm:z-30 dark:text-slate-300 dark:border-slate-700 dark:bg-slate-800/70">
                            Data
                          </th>
                          <th className="w-20 min-w-[78px] py-2.5 px-2 text-center font-mono text-[11px] font-bold text-slate-600 border-r border-slate-200 bg-slate-50 sm:sticky sm:left-24 sm:z-30 dark:text-slate-300 dark:border-slate-700 dark:bg-slate-800/70">
                            Horário
                          </th>
                          {cols.map((col) => {
                            const isExpanded = expandedColKeys.includes(col.key);
                            return (
                              <th
                                key={col.key}
                                onDoubleClick={() => toggleExpandColumn(col.key)}
                                title="Dê duplo clique nesta coluna para ampliar ou reduzir a visualização"
                                className={`py-2.5 px-3 text-left border-r border-slate-200 last:border-r-0 select-none cursor-pointer transition-all dark:border-slate-700 ${
                                  isExpanded
                                    ? 'w-[380px] min-w-[380px] sm:w-[430px] sm:min-w-[430px] bg-emerald-50/70 dark:bg-emerald-950/50'
                                    : 'w-48 min-w-[192px] bg-slate-50 hover:bg-slate-100/80 dark:bg-slate-800/70'
                                }`}
                              >
                                <div className="flex items-center justify-between gap-1.5">
                                  <span
                                    className={`font-display font-bold text-slate-900 dark:text-slate-100 ${
                                      isExpanded ? 'whitespace-normal text-sm' : 'truncate'
                                    }`}
                                  >
                                    {col.label}
                                  </span>
                                  <div className="flex items-center gap-1 shrink-0">
                                    {col.collab?.isNextInQueue && (
                                      <span className="text-[10px] font-bold text-amber-700 dark:text-amber-300">
                                        Próximo
                                      </span>
                                    )}
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        toggleExpandColumn(col.key);
                                      }}
                                      title={isExpanded ? 'Reduzir coluna' : 'Ampliar coluna'}
                                      className="p-1 rounded text-slate-500 hover:bg-white hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
                                    >
                                      {isExpanded ? (
                                        <Minimize2 className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-300" />
                                      ) : (
                                        <Maximize2 className="w-3 h-3" />
                                      )}
                                    </button>
                                  </div>
                                </div>
                                <div className="flex items-center justify-between gap-1 text-[10px] font-normal text-slate-500 dark:text-slate-400">
                                  <span className={isExpanded ? '' : 'truncate'}>{col.sub}</span>
                                  <span className="font-mono text-[10px] text-slate-400 shrink-0 dark:text-slate-400">
                                    {displayedGridDates.length === 1
                                      ? formatDayMonthBR(displayedGridDates[0])
                                      : `${formatDayMonthBR(displayedGridDates[0])}–${formatDayMonthBR(
                                          displayedGridDates[displayedGridDates.length - 1]
                                        )}`}
                                  </span>
                                </div>
                              </th>
                            );
                          })}
                        </tr>
                      </thead>

                      <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                        {displayedGridDates.map((rowDateKey) => {
                          const coveredSlotsForDate = new Map<string, number>();
                          const weekdayLabel = getWeekdayShortBR(rowDateKey);
                          const shortDateLabel = formatShortDateBR(rowDateKey);

                          return timeSlots.map((slotTime, slotIdx) => {
                            const slotStartMin = timeToMinutes(slotTime);
                            const slotEndMin = slotStartMin + slotStep;
                            const isFirstSlotOfDay = slotIdx === 0;

                            return (
                              <tr
                                key={`${rowDateKey}-${slotTime}`}
                                className={`align-top ${
                                  isFirstSlotOfDay && displayedGridDates.length > 1
                                    ? 'border-t-2 border-t-slate-300'
                                    : ''
                                }`}
                              >
                                {/* Coluna 1: Data */}
                                <td className="w-24 min-w-[96px] py-2.5 px-2 text-center bg-slate-50/95 border-r border-slate-200 sm:sticky sm:left-0 sm:z-10 dark:border-slate-700">
                                  <div className="font-mono text-[11px] font-bold text-slate-800 leading-tight dark:text-slate-100">
                                    {shortDateLabel}
                                  </div>
                                  <div className="text-[10px] font-semibold uppercase text-slate-500 dark:text-slate-400">
                                    {weekdayLabel}
                                  </div>
                                </td>

                                {/* Coluna 2: Horário */}
                                <td className="w-20 min-w-[78px] py-2.5 px-2 text-center font-mono text-[11px] font-semibold text-slate-600 bg-slate-50/95 border-r border-slate-200 sm:sticky sm:left-24 sm:z-10 dark:text-slate-300 dark:border-slate-700">
                                  {slotTime}
                                </td>

                                {/* Colunas 3..N: Colaboradores */}
                                {cols.map((col) => {
                                  const covKey = `${rowDateKey}:${col.key}`;
                                  const covUntil = coveredSlotsForDate.get(covKey) || 0;
                                  if (slotIdx < covUntil) {
                                    return null;
                                  }

                                  const isExpanded = expandedColKeys.includes(col.key);

                                  const colAppts = scopedAppointments.filter((a) => {
                                    const aDt = new Date(a.scheduledFor);
                                    if (toDateKey(aDt) !== rowDateKey) return false;
                                    if (col.collab && a.collaboratorId !== col.collab.id) return false;
                                    const aMin = timeToMinutes(toTimeKey(aDt));
                                    return aMin >= slotStartMin && aMin < slotEndMin;
                                  });

                                  const blk = col.collab
                                    ? findBlockingEntryForSlot({
                                        blocks,
                                        collaboratorId: col.collab.id,
                                        consultantUserId: col.collab.userId,
                                        dateKey: rowDateKey,
                                        slotStartMin,
                                        slotEndMin,
                                      })
                                    : null;

                                  // Safe rowSpan within same day
                                  let cellRowSpan = 1;
                                  if (colAppts.length === 1 && !blk) {
                                    const onlyAppt = colAppts[0];
                                    const sDt = new Date(onlyAppt.scheduledFor);
                                    const eDt = onlyAppt.endAt
                                      ? new Date(onlyAppt.endAt)
                                      : new Date(sDt.getTime() + 30 * 60000);
                                    const durMin = Math.max(
                                      slotStep,
                                      Math.round((eDt.getTime() - sDt.getTime()) / 60000)
                                    );
                                    const desiredSpan = Math.min(
                                      timeSlots.length - slotIdx,
                                      Math.max(1, Math.round(durMin / slotStep))
                                    );

                                    if (desiredSpan > 1) {
                                      const spanEndMin = slotStartMin + desiredSpan * slotStep;
                                      const hasFollowingCollision = scopedAppointments.some((other) => {
                                        if (other.id === onlyAppt.id) return false;
                                        const oDt = new Date(other.scheduledFor);
                                        if (toDateKey(oDt) !== rowDateKey) return false;
                                        if (col.collab && other.collaboratorId !== col.collab.id)
                                          return false;
                                        const oMin = timeToMinutes(toTimeKey(oDt));
                                        return oMin >= slotEndMin && oMin < spanEndMin;
                                      });
                                      if (!hasFollowingCollision) {
                                        cellRowSpan = desiredSpan;
                                        coveredSlotsForDate.set(covKey, slotIdx + desiredSpan);
                                      }
                                    }
                                  }

                                  return (
                                    <td
                                      key={`${rowDateKey}-${col.key}-${slotTime}`}
                                      rowSpan={cellRowSpan}
                                      onDoubleClick={(e) => {
                                        e.stopPropagation();
                                        toggleExpandColumn(col.key);
                                      }}
                                      onDragOver={(e) => {
                                        if (!blk) e.preventDefault();
                                      }}
                                      onDrop={(e) => {
                                        e.preventDefault();
                                        handleDropOnSlot({
                                          targetDate: rowDateKey,
                                          targetTime: slotTime,
                                          targetCollabId: col.collab?.id ?? null,
                                          targetUserId: col.collab?.userId ?? null,
                                        });
                                      }}
                                      onClick={() => {
                                        if (blk) {
                                          setErrBanner(
                                            `Agenda Bloqueada (${col.label} · ${shortDateLabel}): ${blk.reason}.`
                                          );
                                          return;
                                        }
                                        openCreateModal({
                                          date: rowDateKey,
                                          startTime: slotTime,
                                          collaborator: col.collab,
                                        });
                                      }}
                                      title={
                                        blk
                                          ? `Agenda Bloqueada · ${blk.reason} (Duplo clique amplia coluna)`
                                          : `Clique para agendar em ${shortDateLabel} às ${slotTime} · Duplo clique amplia coluna`
                                      }
                                      className={`relative min-h-[54px] h-14 p-1.5 border-r border-slate-200 last:border-r-0 transition-all dark:border-slate-700 ${
                                        isExpanded
                                          ? 'w-[380px] min-w-[380px] sm:w-[430px] sm:min-w-[430px] bg-emerald-50/15'
                                          : 'w-48 min-w-[192px]'
                                      } ${
                                        blk
                                          ? 'bg-slate-100 cursor-not-allowed dark:bg-slate-800'
                                          : 'hover:bg-slate-50/80 cursor-pointer'
                                      }`}
                                    >
                                      {blk ? (
                                        <div className="relative h-full min-h-[42px] rounded-lg border border-slate-300/80 overflow-hidden p-1.5 flex flex-col justify-center">
                                          <BlockedHatchOverlay
                                            patternId={`blk-${rowDateKey}-${col.key}-${slotIdx}`}
                                          />
                                          <div
                                            className={`relative z-10 text-[10px] font-bold text-slate-700 dark:text-slate-200 ${
                                              isExpanded ? '' : 'truncate'
                                            }`}
                                          >
                                            Bloqueado · {blk.reason}
                                          </div>
                                          <div className="relative z-10 font-mono text-[9px] text-slate-500 dark:text-slate-400">
                                            {blk.allDay !== false
                                              ? 'Dia Inteiro'
                                              : `${blk.startTime} - ${blk.endTime}`}
                                          </div>
                                        </div>
                                      ) : colAppts.length > 0 ? (
                                        <div className="space-y-1.5">
                                          {colAppts.map((a) => renderAppointmentCard(a, isExpanded))}
                                        </div>
                                      ) : (
                                        <div className="h-full min-h-[42px] flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
                                          <span className="inline-flex items-center gap-1 rounded-md border border-dashed border-slate-300 px-2 py-0.5 text-[10px] font-semibold text-slate-500 dark:border-slate-600 dark:text-slate-400">
                                            <Plus className="w-3 h-3" /> {slotTime}
                                          </span>
                                        </div>
                                      )}
                                    </td>
                                  );
                                })}
                              </tr>
                            );
                          });
                        })}
                      </tbody>
                    </table>
                  );
                })()}
              </div>
            </section>
          </div>
        </div>
      )}

      {/* =====================================================================
          TAB 2: BLOQUEAR AGENDA
         ===================================================================== */}
      {tab === 'bloqueios' && (
        <BlocksTabView
          collaborators={queueEligibleCollaborators}
          blocks={blocks}
          onBack={handleBackAction}
          onRefresh={() => loadBootstrap(true)}
          onToast={(msg) => setBanner(msg)}
          onOpenAudit={(entityType, entityId, title) =>
            setAuditModal({ open: true, entityType, entityId, title })
          }
        />
      )}

      {/* =====================================================================
          TAB 3: FILA DE ESPERA DE CLIENTES
         ===================================================================== */}
      {tab === 'fila' && (
        <WaitlistTabView
          units={units}
          collaborators={queueEligibleCollaborators}
          services={services}
          waitlist={waitlist}
          editingItem={editingWaitlistItem}
          onBack={handleBackAction}
          onCancelEdit={() => setEditingWaitlistItem(null)}
          onStartEdit={(item) => setEditingWaitlistItem(item)}
          onPromoteToAppointment={(item) =>
            openCreateModal({
              waitlistItem: item,
              collaborator: item.preferredCollaboratorId
                ? collaborators.find((c) => c.id === item.preferredCollaboratorId) || null
                : null,
            })
          }
          onRefresh={() => loadBootstrap(true)}
          onToast={(msg) => setBanner(msg)}
          onOpenAudit={(entityType, entityId, title) =>
            setAuditModal({ open: true, entityType, entityId, title })
          }
        />
      )}

      {/* =====================================================================
          TAB 4: SERVIÇOS DA AGENDA
         ===================================================================== */}
      {tab === 'servicos' && (
        <ServicesTabView
          services={services}
          onBack={handleBackAction}
          onRefresh={() => loadBootstrap(true)}
          onToast={(msg) => setBanner(msg)}
          onOpenAudit={(entityType, entityId, title) =>
            setAuditModal({ open: true, entityType, entityId, title })
          }
        />
      )}

      {/* =====================================================================
          TAB 5: CONFIGURAÇÕES DA AGENDA
         ===================================================================== */}
      {tab === 'config' && (
        <ScheduleConfigTabView
          config={config}
          onBack={handleBackAction}
          onRefresh={() => loadBootstrap(true)}
          onToast={(msg) => setBanner(msg)}
          onOpenAudit={(entityType, entityId, title) =>
            setAuditModal({ open: true, entityType, entityId, title })
          }
        />
      )}

      {/* MODAIS DA AGENDA */}
      <AppointmentFormModal
        open={apptModalOpen}
        draft={apptDraft}
        units={units}
        services={services}
        collaborators={collaborators}
        onClose={() => setApptModalOpen(false)}
        onSaved={async (msg) => {
          setBanner(msg);
          setEditingWaitlistItem(null);
          await loadBootstrap(true);
        }}
        onOpenAudit={(apptId, label) =>
          setAuditModal({
            open: true,
            entityType: 'appointment',
            entityId: apptId,
            title: `Agendamento · ${label}`,
          })
        }
      />

      <ManageConsultantsModal
        open={manageModalOpen}
        collaborators={scopedCollaborators}
        hiddenCollabIds={hiddenCollabIds}
        onToggleVisibility={toggleCollabVisibility}
        onShowAll={() => setHiddenCollabIds([])}
        onClose={() => setManageModalOpen(false)}
      />

      <FiltersDrawerModal
        open={filtersDrawerOpen}
        collaborators={scopedCollaborators}
        selectedConsultantFilter={consultantFilter}
        statusColors={config.statusColors}
        onSelectConsultantFilter={(id) => setConsultantFilter(id)}
        onJumpToDate={(dKey) => {
          handleSelectDate(dKey);
          setTab('agenda');
        }}
        onClose={() => setFiltersDrawerOpen(false)}
      />

      <ConfirmDeleteModal
        open={Boolean(sidebarDeleteWaitlist)}
        title="Remover da Fila de Espera?"
        description={
          sidebarDeleteWaitlist
            ? `Deseja remover ${sidebarDeleteWaitlist.clientName} (${sidebarDeleteWaitlist.serviceName}) da fila de espera?`
            : ''
        }
        busy={sidebarDeleteBusy}
        onCancel={() => setSidebarDeleteWaitlist(null)}
        onConfirm={handleDeleteWaitlistSidebar}
      />

      <EntityAuditModal
        open={auditModal.open}
        title={auditModal.title}
        entityType={auditModal.entityType}
        entityId={auditModal.entityId}
        onClose={() => setAuditModal((prev) => ({ ...prev, open: false }))}
      />
    </div>
  );
};
