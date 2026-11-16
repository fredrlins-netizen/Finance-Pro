import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Ban,
  Bot,
  Calendar,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Filter,
  GripVertical,
  Maximize2,
  Mic,
  MicOff,
  Minimize2,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Search,
  Settings2,
  Share2,
  Sparkles,
  Users,
  X,
} from 'lucide-react';
import { apiFetch } from '../../lib/api.ts';
import {
  AuthUser,
  Client,
  CollaboratorItem,
  CoordinatorTaskColumn,
  CoordinatorTaskItem,
  CoordinatorTasksBootstrapPayload,
} from '../../types.ts';
import {
  computeLiveElapsedSeconds,
  ConfirmTaskDeleteModal,
  CRITICALITY_OPTIONS,
  formatStopwatchHHMMSS,
  getCriticalityMeta,
  getTaskStatusBucket,
  getTaskStatusMeta,
  PRIORITY_OPTIONS,
  TaskClosureModal,
  TaskColumnsModal,
  TaskDetailModal,
  TaskPauseModal,
  TaskShareModal,
  TaskStatusTransitionModal,
} from './CollectionCoordinatorTasksModals.tsx';

interface IviTaskSuggestion {
  title: string;
  description: string;
  criticality: 'alto' | 'critico' | 'medio';
  clientId: number | null;
  clientName: string;
  projectLabel: string;
}

interface CollectionCoordinatorTasksViewProps {
  currentUser: AuthUser | null;
  clients: Client[];
  collaborators: CollaboratorItem[];
  wsTick: number;
  onToast: (msg: string) => void;
  onError: (msg: string) => void;
  onOpenClient?: (clientId: number) => void;
}

type OriginFilter = 'todas' | 'minhas' | 'compartilhadas' | 'direta' | 'nota_rapida' | 'cobranca';
type StatusCategoryFilter = 'TODAS' | 'PENDENTE' | 'PAUSADO' | 'CONCLUIDO' | 'CANCELADO';

function startOfWeekMonday(baseDate: Date): Date {
  const d = new Date(baseDate);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

function addDays(base: Date, days: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

function toLocalYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export const CollectionCoordinatorTasksView: React.FC<CollectionCoordinatorTasksViewProps> = ({
  currentUser,
  clients,
  collaborators,
  wsTick,
  onToast,
  onError,
  onOpenClient,
}) => {
  const [payload, setPayload] = useState<CoordinatorTasksBootstrapPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [nowMs, setNowMs] = useState(() => Date.now());

  // Filtros e Origens
  const [searchTerm, setSearchTerm] = useState('');
  const [originsOpen, setOriginsOpen] = useState(false);
  const [originFilter, setOriginFilter] = useState<OriginFilter>('todas');
  const [statusCategory, setStatusCategory] = useState<StatusCategoryFilter>('TODAS');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filterStatusId, setFilterStatusId] = useState('');
  const [filterPriority, setFilterPriority] = useState('');
  const [filterCriticality, setFilterCriticality] = useState('');
  const [filterClientId, setFilterClientId] = useState('');
  const [filterCollaboratorId, setFilterCollaboratorId] = useState('');
  const [filterDueFrom, setFilterDueFrom] = useState('');
  const [filterDueTo, setFilterDueTo] = useState('');

  // Criação Inline em Campo Texto com Linha (sem Modal)
  const inlineTitleInputRef = useRef<HTMLInputElement | null>(null);
  const [inlineComposerOpen, setInlineComposerOpen] = useState(false);
  const [inlineTitle, setInlineTitle] = useState('');
  const [inlineDescription, setInlineDescription] = useState('');
  const [inlineClientId, setInlineClientId] = useState('');
  const [inlineCollaboratorId, setInlineCollaboratorId] = useState('');
  const [inlineProjectLabel, setInlineProjectLabel] = useState('');
  const [inlineCriticality, setInlineCriticality] = useState('medio');
  const [inlinePriority, setInlinePriority] = useState('media');
  const [inlineDueAt, setInlineDueAt] = useState('');
  const [inlineOriginType, setInlineOriginType] = useState('direta');
  const [inlineReviewIvi, setInlineReviewIvi] = useState(false);
  const [inlineBusy, setInlineBusy] = useState(false);
  const [listeningVoice, setListeningVoice] = useState(false);

  // Drag & Drop Semanal
  const draggingTaskRef = useRef<number | null>(null);
  const [draggingTaskId, setDraggingTaskId] = useState<number | null>(null);
  const [dragOverTarget, setDragOverTarget] = useState<string | null>(null);
  const [weekMonday, setWeekMonday] = useState<Date>(() => startOfWeekMonday(new Date()));
  const [focusedDayYmd, setFocusedDayYmd] = useState<string | null>(null);

  // Sugestões da Ivi
  const [iviSuggestOpen, setIviSuggestOpen] = useState(false);
  const [iviSuggestBusy, setIviSuggestBusy] = useState(false);
  const [iviSuggestions, setIviSuggestions] = useState<IviTaskSuggestion[]>([]);

  // Modais de Detalhes / Compartilhamento / Pausa / Cancelamento / Encerramento / Etapas / Exclusão
  const [detailTaskId, setDetailTaskId] = useState<number | null>(null);
  const [shareTaskId, setShareTaskId] = useState<number | null>(null);
  const [pauseTask, setPauseTask] = useState<CoordinatorTaskItem | null>(null);
  const [statusTransitionState, setStatusTransitionState] = useState<{
    task: CoordinatorTaskItem;
    mode: 'PAUSADO' | 'CANCELADO';
  } | null>(null);
  const [closureState, setClosureState] = useState<{
    task: CoordinatorTaskItem;
    targetColumnId: number | null;
  } | null>(null);
  const [columnsModalOpen, setColumnsModalOpen] = useState(false);
  const [deletingSingleTask, setDeletingSingleTask] = useState<CoordinatorTaskItem | null>(null);
  const [singleDeleteBusy, setSingleDeleteBusy] = useState(false);

  const loadTasks = useCallback(async () => {
    try {
      const res = await apiFetch<CoordinatorTasksBootstrapPayload>(
        '/api/collection/coordinator/tasks'
      );
      setPayload(res);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Erro ao carregar tarefas da coordenação.');
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks, wsTick]);

  // Cronômetro ao vivo (1s tick somente quando houver cronômetro ativo)
  const hasRunningStopwatch = useMemo(() => {
    if (!payload) return false;
    return payload.tasks.some(
      (t) => Boolean(t.timerRunningSince) || t.subtasks.some((s) => Boolean(s.timerRunningSince))
    );
  }, [payload]);

  useEffect(() => {
    if (!hasRunningStopwatch) return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [hasRunningStopwatch]);

  const columns: CoordinatorTaskColumn[] = payload?.columns || [];
  const allTasks: CoordinatorTaskItem[] = payload?.tasks || [];

  const detailTask = useMemo(
    () => (detailTaskId ? allTasks.find((t) => t.id === detailTaskId) || null : null),
    [allTasks, detailTaskId]
  );

  const shareTask = useMemo(
    () => (shareTaskId ? allTasks.find((t) => t.id === shareTaskId) || null : null),
    [allTasks, shareTaskId]
  );

  const openInlineComposer = (opts?: {
    dueAt?: string;
    title?: string;
    description?: string;
    criticality?: string;
    clientId?: number | null;
    projectLabel?: string;
    originType?: string;
  }) => {
    setInlineDueAt(opts?.dueAt ?? '');
    if (opts?.title !== undefined) setInlineTitle(opts.title);
    if (opts?.description !== undefined) setInlineDescription(opts.description);
    if (opts?.criticality !== undefined) setInlineCriticality(opts.criticality);
    if (opts?.clientId !== undefined) setInlineClientId(opts.clientId ? String(opts.clientId) : '');
    if (opts?.projectLabel !== undefined) setInlineProjectLabel(opts.projectLabel);
    if (opts?.originType !== undefined) setInlineOriginType(opts.originType);
    setInlineComposerOpen(true);
    setTimeout(() => {
      inlineTitleInputRef.current?.focus();
    }, 30);
  };

  const resetInlineComposer = () => {
    setInlineTitle('');
    setInlineDescription('');
    setInlineClientId('');
    setInlineCollaboratorId('');
    setInlineProjectLabel('');
    setInlineCriticality('medio');
    setInlinePriority('media');
    setInlineDueAt('');
    setInlineOriginType('direta');
    setInlineReviewIvi(false);
    setInlineComposerOpen(false);
  };

  const handleToggleVoice = () => {
    const w = window as unknown as {
      SpeechRecognition?: new () => {
        lang: string;
        interimResults: boolean;
        onresult: (ev: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
        onerror: () => void;
        onend: () => void;
        start: () => void;
      };
      webkitSpeechRecognition?: new () => {
        lang: string;
        interimResults: boolean;
        onresult: (ev: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
        onerror: () => void;
        onend: () => void;
        start: () => void;
      };
    };
    const Rec = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Rec) {
      onError('Ditado por voz não suportado neste navegador.');
      return;
    }
    const recognition = new Rec();
    recognition.lang = 'pt-BR';
    recognition.interimResults = false;
    setListeningVoice(true);
    recognition.onresult = (ev) => {
      const spoken = ev.results?.[0]?.[0]?.transcript || '';
      if (spoken) {
        setInlineTitle((prev) => (prev ? `${prev} ${spoken}` : spoken));
      }
    };
    recognition.onerror = () => setListeningVoice(false);
    recognition.onend = () => setListeningVoice(false);
    recognition.start();
  };

  const handleInlineCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inlineTitle.trim()) {
      onError('Digite o texto/título da nova tarefa.');
      inlineTitleInputRef.current?.focus();
      return;
    }
    setInlineBusy(true);
    try {
      await apiFetch('/api/collection/coordinator/tasks', {
        method: 'POST',
        body: JSON.stringify({
          title: inlineTitle.trim(),
          description: inlineDescription.trim(),
          clientId: inlineClientId ? Number(inlineClientId) : null,
          collaboratorId: inlineCollaboratorId ? Number(inlineCollaboratorId) : null,
          projectLabel: inlineProjectLabel.trim(),
          criticality: inlineCriticality,
          priority: inlinePriority,
          statusColumnId: columns[0]?.id || null,
          dueAt: inlineDueAt ? new Date(inlineDueAt).toISOString() : null,
          originType: inlineOriginType || 'direta',
          reviewWithIvi: inlineReviewIvi,
        }),
      });
      resetInlineComposer();
      onToast('Tarefa criada e vinculada ao seu usuário.');
      await loadTasks();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Erro ao criar tarefa.');
    } finally {
      setInlineBusy(false);
    }
  };

  // Filtragem unificada
  const filteredTasks = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return allTasks.filter((t) => {
      const bucket = getTaskStatusBucket(t);
      if (statusCategory !== 'TODAS' && bucket !== statusCategory) return false;

      if (originFilter === 'minhas' && !t.isOwner) return false;
      if (originFilter === 'compartilhadas' && t.isOwner) return false;
      if (
        (originFilter === 'direta' || originFilter === 'nota_rapida' || originFilter === 'cobranca') &&
        t.originType !== originFilter
      ) {
        return false;
      }

      if (filterStatusId && String(t.statusColumnId || '') !== filterStatusId) return false;
      if (filterPriority && t.priority !== filterPriority) return false;
      if (filterCriticality && t.criticality !== filterCriticality) return false;
      if (filterClientId && String(t.clientId || '') !== filterClientId) return false;
      if (filterCollaboratorId && String(t.collaboratorId || '') !== filterCollaboratorId) return false;

      if (filterDueFrom) {
        const ymd = t.dueAt ? toLocalYmd(new Date(t.dueAt)) : '';
        if (!ymd || ymd < filterDueFrom) return false;
      }
      if (filterDueTo) {
        const ymd = t.dueAt ? toLocalYmd(new Date(t.dueAt)) : '';
        if (!ymd || ymd > filterDueTo) return false;
      }

      if (q) {
        const blob = `${t.title} ${t.description} ${t.clientName} ${t.projectLabel} ${t.collaboratorName} ${t.ownerName}`.toLowerCase();
        if (!blob.includes(q)) return false;
      }

      return true;
    });
  }, [
    allTasks,
    statusCategory,
    originFilter,
    filterStatusId,
    filterPriority,
    filterCriticality,
    filterClientId,
    filterCollaboratorId,
    filterDueFrom,
    filterDueTo,
    searchTerm,
  ]);

  const statsSummary = useMemo(() => {
    let pendentes = 0;
    let pausadas = 0;
    let concluidas = 0;
    let canceladas = 0;
    let shared = 0;
    for (const t of allTasks) {
      const b = getTaskStatusBucket(t);
      if (b === 'PENDENTE') pendentes++;
      else if (b === 'PAUSADO') pausadas++;
      else if (b === 'CONCLUIDO') concluidas++;
      else if (b === 'CANCELADO') canceladas++;
      if (!t.isOwner && b === 'PENDENTE') shared++;
    }
    return {
      total: allTasks.length,
      pendentes,
      pausadas,
      concluidas,
      canceladas,
      shared,
    };
  }, [allTasks]);

  const handleLoadIviSuggestions = async () => {
    setIviSuggestOpen(true);
    setIviSuggestBusy(true);
    try {
      const res = await apiFetch<{ suggestions: IviTaskSuggestion[] }>(
        '/api/collection/coordinator/tasks/ivi-suggest',
        { method: 'POST', body: JSON.stringify({}) }
      );
      setIviSuggestions(res.suggestions || []);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Erro ao consultar sugestões da Ivi.');
    } finally {
      setIviSuggestBusy(false);
    }
  };

  const handleScheduleTaskDate = async (task: CoordinatorTaskItem, ymdOrNull: string | null) => {
    if (task.mySharePermission === 'view') {
      onError('Você possui permissão apenas de visualização nesta tarefa.');
      return;
    }
    const currentYmd = task.dueAt ? toLocalYmd(new Date(task.dueAt)) : null;
    if (currentYmd === ymdOrNull) return;

    const nextDue = ymdOrNull ? new Date(`${ymdOrNull}T09:00:00`).toISOString() : null;

    // Atualização otimista imediata no quadro semanal ao soltar o card
    setPayload((prev) =>
      prev
        ? {
            ...prev,
            tasks: prev.tasks.map((t) => (t.id === task.id ? { ...t, dueAt: nextDue } : t)),
          }
        : prev
    );

    try {
      await apiFetch(`/api/collection/coordinator/tasks/${task.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ dueAt: nextDue }),
      });
      onToast(
        ymdOrNull
          ? `Tarefa "${task.title}" movida para ${ymdOrNull.split('-').reverse().join('/')}.`
          : `Prazo removido de "${task.title}" (Sem data).`
      );
      await loadTasks();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Erro ao reagendar tarefa.');
      await loadTasks();
    }
  };

  const handleResumeToPending = async (task: CoordinatorTaskItem) => {
    if (task.mySharePermission === 'view') {
      onError('Permissão apenas de leitura nesta tarefa.');
      return;
    }
    try {
      await apiFetch(`/api/collection/coordinator/tasks/${task.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ statusKey: 'PENDENTE', isCompleted: false }),
      });
      onToast(`Tarefa "${task.title}" retornada para Pendente.`);
      await loadTasks();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Erro ao retomar tarefa.');
    }
  };

  const handleInlineTimerToggle = async (task: CoordinatorTaskItem, e: React.MouseEvent) => {
    e.stopPropagation();
    if (task.mySharePermission === 'view') {
      onError('Permissão apenas de leitura nesta tarefa compartilhada.');
      return;
    }
    if (task.timerRunningSince) {
      setPauseTask(task);
      return;
    }
    try {
      await apiFetch(`/api/collection/coordinator/tasks/${task.id}/timer`, {
        method: 'POST',
        body: JSON.stringify({ action: 'start' }),
      });
      onToast(`Cronômetro iniciado em "${task.title}".`);
      await loadTasks();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Erro ao iniciar cronômetro.');
    }
  };

  const handleConfirmSingleDelete = async () => {
    if (!deletingSingleTask) return;
    setSingleDeleteBusy(true);
    try {
      await apiFetch(`/api/collection/coordinator/tasks/${deletingSingleTask.id}`, {
        method: 'DELETE',
      });
      if (detailTaskId === deletingSingleTask.id) setDetailTaskId(null);
      setDeletingSingleTask(null);
      onToast('Tarefa excluída com sucesso.');
      await loadTasks();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Erro ao excluir tarefa.');
    } finally {
      setSingleDeleteBusy(false);
    }
  };

  const clearAllFilters = () => {
    setSearchTerm('');
    setStatusCategory('TODAS');
    setOriginFilter('todas');
    setFilterStatusId('');
    setFilterPriority('');
    setFilterCriticality('');
    setFilterClientId('');
    setFilterCollaboratorId('');
    setFilterDueFrom('');
    setFilterDueTo('');
  };

  const weekDays = useMemo(() => {
    const names = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
    return Array.from({ length: 7 }, (_, i) => {
      const d = addDays(weekMonday, i);
      return {
        ymd: toLocalYmd(d),
        label: names[i],
        shortDate: `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`,
      };
    });
  }, [weekMonday]);

  const weekLabel = `${weekDays[0]?.shortDate} – ${weekDays[6]?.shortDate}`;
  const todayYmd = toLocalYmd(new Date());

  const startTaskDrag = (task: CoordinatorTaskItem, e: React.DragEvent) => {
    if (task.mySharePermission === 'view') {
      e.preventDefault();
      return;
    }
    draggingTaskRef.current = task.id;
    setDraggingTaskId(task.id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(task.id));
  };

  const endTaskDrag = () => {
    draggingTaskRef.current = null;
    setDraggingTaskId(null);
    setDragOverTarget(null);
  };

  const resolveDraggedTask = (e: React.DragEvent): CoordinatorTaskItem | undefined => {
    const dtId = Number(e.dataTransfer.getData('text/plain'));
    const id = Number.isFinite(dtId) && dtId > 0 ? dtId : draggingTaskRef.current ?? draggingTaskId;
    if (!id) return undefined;
    return allTasks.find((x) => x.id === id);
  };

  return (
    <div className="space-y-4">
      {/* KPI / SITUAÇÃO CLICÁVEL */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <button
          type="button"
          onClick={() => setStatusCategory('PENDENTE')}
          className={`text-left rounded-xl border px-4 py-3 transition-colors ${
            statusCategory === 'PENDENTE'
              ? 'border-slate-900 bg-slate-50 dark:border-emerald-500 dark:bg-slate-800/70'
              : 'border-slate-200 bg-white hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900'
          }`}
        >
          <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Pendentes</p>
          <p className="mt-1 font-mono text-xl font-bold text-slate-900 tabular-nums dark:text-slate-100">
            {statsSummary.pendentes}
          </p>
          <p className="text-[11px] text-slate-400 truncate dark:text-slate-400">
            {currentUser?.name || payload?.currentUserName || 'Coordenador'}
          </p>
        </button>

        <button
          type="button"
          onClick={() => setStatusCategory('PAUSADO')}
          className={`text-left rounded-xl border px-4 py-3 transition-colors ${
            statusCategory === 'PAUSADO'
              ? 'border-amber-500 bg-amber-50/60 dark:bg-amber-950/50'
              : 'border-slate-200 bg-white hover:border-amber-300 dark:border-slate-700 dark:bg-slate-900'
          }`}
        >
          <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Pausadas</p>
          <p className="mt-1 font-mono text-xl font-bold text-amber-700 tabular-nums dark:text-amber-300">
            {statsSummary.pausadas}
          </p>
          <p className="text-[11px] text-slate-400 dark:text-slate-400">Com justificativa registrada</p>
        </button>

        <button
          type="button"
          onClick={() => setStatusCategory('CONCLUIDO')}
          className={`text-left rounded-xl border px-4 py-3 transition-colors ${
            statusCategory === 'CONCLUIDO'
              ? 'border-emerald-600 bg-emerald-50/60 dark:bg-emerald-950/50'
              : 'border-slate-200 bg-white hover:border-emerald-300 dark:border-slate-700 dark:bg-slate-900'
          }`}
        >
          <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Concluídas</p>
          <p className="mt-1 font-mono text-xl font-bold text-emerald-700 tabular-nums dark:text-emerald-300">
            {statsSummary.concluidas}
          </p>
          <p className="text-[11px] text-slate-400 dark:text-slate-400">Encerramento auditado</p>
        </button>

        <button
          type="button"
          onClick={() => setStatusCategory('CANCELADO')}
          className={`text-left rounded-xl border px-4 py-3 transition-colors ${
            statusCategory === 'CANCELADO'
              ? 'border-red-500 bg-red-50/60 dark:bg-red-950/50'
              : 'border-slate-200 bg-white hover:border-red-300 dark:border-slate-700 dark:bg-slate-900'
          }`}
        >
          <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Canceladas</p>
          <p className="mt-1 font-mono text-xl font-bold text-red-700 tabular-nums dark:text-red-300">
            {statsSummary.canceladas}
          </p>
          <p className="text-[11px] text-slate-400 dark:text-slate-400">Histórico preservado</p>
        </button>

        <button
          type="button"
          onClick={() => {
            setStatusCategory('TODAS');
            setOriginFilter((prev) => (prev === 'compartilhadas' ? 'todas' : 'compartilhadas'));
          }}
          className={`text-left rounded-xl border px-4 py-3 transition-colors col-span-2 md:col-span-1 ${
            originFilter === 'compartilhadas'
              ? 'border-blue-500 bg-blue-50/60 dark:bg-blue-950/50'
              : 'border-slate-200 bg-white hover:border-blue-300 dark:border-slate-700 dark:bg-slate-900'
          }`}
        >
          <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Compartilhadas Comigo</p>
          <p className="mt-1 font-mono text-xl font-bold text-blue-700 tabular-nums dark:text-blue-300">
            {statsSummary.shared}
          </p>
          <p className="text-[11px] text-slate-400 dark:text-slate-400">De outros coordenadores</p>
        </button>
      </div>

      {/* BARRA DE FERRAMENTAS PRINCIPAL */}
      <div className="rounded-xl border border-slate-200 bg-white p-3.5 space-y-3 dark:border-slate-700 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          {/* Opções de Situação: Todas | Pendentes | Pausados | Concluídos | Cancelados */}
          <div className="inline-flex flex-wrap items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 dark:border-slate-700 dark:bg-slate-800/70">
            {(
              [
                { id: 'TODAS', label: 'Todas', count: statsSummary.total, activeCls: 'bg-slate-900 text-white' },
                { id: 'PENDENTE', label: 'Pendentes', count: statsSummary.pendentes, activeCls: 'bg-slate-800 text-white' },
                { id: 'PAUSADO', label: 'Pausados', count: statsSummary.pausadas, activeCls: 'bg-amber-600 text-white' },
                { id: 'CONCLUIDO', label: 'Concluídos', count: statsSummary.concluidas, activeCls: 'bg-emerald-700 text-white' },
                { id: 'CANCELADO', label: 'Cancelados', count: statsSummary.canceladas, activeCls: 'bg-red-600 text-white' },
              ] as const
            ).map((tab) => {
              const active = statusCategory === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setStatusCategory(tab.id)}
                  className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                    active ? tab.activeCls : 'text-slate-600 hover:text-slate-900 hover:bg-white dark:text-slate-300 dark:hover:text-white dark:hover:bg-slate-800'
                  }`}
                >
                  <span>{tab.label}</span>
                  <span className={`font-mono text-[10px] ${active ? 'opacity-90' : 'text-slate-400 dark:text-slate-400'}`}>
                    {tab.count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Busca */}
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 dark:text-slate-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar tarefa, cliente ou frente..."
              className="w-full rounded-lg border border-slate-200 pl-8 pr-3 py-1.5 text-xs text-slate-900 focus:outline-none focus:border-blue-500 dark:border-slate-700 dark:text-slate-100 dark:bg-slate-950"
            />
          </div>

          {/* Ações */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setOriginsOpen((v) => !v)}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold whitespace-nowrap shrink-0 ${
                originsOpen || originFilter !== 'todas'
                  ? 'border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-800/70 dark:bg-blue-950/50 dark:text-blue-300'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              Origem
            </button>

            <button
              type="button"
              onClick={() => setFiltersOpen((v) => !v)}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold whitespace-nowrap shrink-0 ${
                filtersOpen || filterStatusId || filterPriority || filterCriticality || filterClientId
                  ? 'border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-800/70 dark:bg-blue-950/50 dark:text-blue-300'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800'
              }`}
            >
              <Filter className="w-3.5 h-3.5" />
              Filtros
            </button>

            <button
              type="button"
              onClick={() => void handleLoadIviSuggestions()}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold whitespace-nowrap shrink-0 ${
                iviSuggestOpen
                  ? 'border-blue-700 bg-blue-700 text-white'
                  : 'border-blue-200 bg-blue-50 text-blue-800 hover:bg-blue-100 dark:border-blue-800/70 dark:bg-blue-950/50 dark:text-blue-300 dark:hover:bg-blue-900/60'
              }`}
            >
              <Bot className="w-3.5 h-3.5" />
              {iviSuggestBusy ? 'Ivi Gerando...' : 'Sugestões Ivi'}
            </button>

            <button
              type="button"
              onClick={() => setColumnsModalOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <Settings2 className="w-3.5 h-3.5" />
              Etapas
            </button>

            <button
              type="button"
              onClick={() => {
                if (inlineComposerOpen) {
                  inlineTitleInputRef.current?.focus();
                } else {
                  openInlineComposer({ dueAt: '' });
                }
              }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 whitespace-nowrap shrink-0 dark:bg-emerald-600 dark:hover:bg-emerald-500"
            >
              <Plus className="w-3.5 h-3.5" />
              Nova Tarefa
            </button>
          </div>
        </div>

        {/* CAMPO TEXTO COM LINHA PARA NOVA TAREFA (INLINE — SEM MODAL) */}
        {inlineComposerOpen && (
          <form
            onSubmit={handleInlineCreateSubmit}
            className="pt-3 border-t border-slate-200 space-y-3 text-xs dark:border-slate-700"
          >
            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
              <div className="flex-1 flex items-center gap-2 border-b-2 border-slate-300 focus-within:border-slate-900 pb-1 transition-colors dark:border-slate-600">
                <Plus className="w-4 h-4 text-slate-500 shrink-0 dark:text-slate-400" />
                <input
                  ref={inlineTitleInputRef}
                  type="text"
                  value={inlineTitle}
                  onChange={(e) => setInlineTitle(e.target.value)}
                  placeholder="Escreva a nova tarefa aqui e pressione Enter para criar..."
                  className="flex-1 bg-transparent py-1 text-sm font-medium text-slate-900 placeholder:text-slate-400 focus:outline-none dark:text-slate-100"
                />
                <button
                  type="button"
                  onClick={handleToggleVoice}
                  title="Ditar tarefa por voz"
                  className={`p-1 rounded transition-colors shrink-0 ${
                    listeningVoice
                      ? 'text-red-600 bg-red-50 dark:text-red-400 dark:bg-red-950/50'
                      : 'text-slate-400 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
                  }`}
                >
                  {listeningVoice ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
                </button>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={resetInlineComposer}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={inlineBusy}
                  className="rounded-lg bg-slate-900 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-emerald-600 dark:hover:bg-emerald-500"
                >
                  {inlineBusy ? 'Salvando...' : 'Adicionar Tarefa'}
                </button>
              </div>
            </div>

            {/* Linha complementar discreta (atributos opcionais também em linha) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2.5 items-end">
              <div className="lg:col-span-2">
                <input
                  type="text"
                  value={inlineDescription}
                  onChange={(e) => setInlineDescription(e.target.value)}
                  placeholder="Observação / instrução operacional (opcional)"
                  className="w-full bg-transparent border-0 border-b border-slate-200 focus:border-slate-700 py-1 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none dark:border-slate-700 dark:text-slate-100"
                />
              </div>

              <div>
                <select
                  value={inlineClientId}
                  onChange={(e) => setInlineClientId(e.target.value)}
                  aria-label="Cliente"
                  className="w-full bg-transparent border-0 border-b border-slate-200 focus:border-slate-700 py-1 text-xs text-slate-800 focus:outline-none dark:border-slate-700 dark:text-slate-100"
                >
                  <option value="">Cliente (Opcional)</option>
                  {clients.map((c) => (
                    <option key={c.id} value={String(c.id)}>
                      {c.fullName}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <select
                  value={inlineCollaboratorId}
                  onChange={(e) => setInlineCollaboratorId(e.target.value)}
                  aria-label="Colaborador"
                  className="w-full bg-transparent border-0 border-b border-slate-200 focus:border-slate-700 py-1 text-xs text-slate-800 focus:outline-none dark:border-slate-700 dark:text-slate-100"
                >
                  <option value="">Coordenação direta</option>
                  {collaborators.map((c) => (
                    <option key={c.id} value={String(c.id)}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <select
                  value={inlineCriticality}
                  onChange={(e) => setInlineCriticality(e.target.value)}
                  aria-label="Criticidade"
                  className="w-full bg-transparent border-0 border-b border-slate-200 focus:border-slate-700 py-1 text-xs text-slate-800 focus:outline-none dark:border-slate-700 dark:text-slate-100"
                >
                  {CRITICALITY_OPTIONS.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>

                <select
                  value={inlinePriority}
                  onChange={(e) => setInlinePriority(e.target.value)}
                  aria-label="Prioridade"
                  className="w-full bg-transparent border-0 border-b border-slate-200 focus:border-slate-700 py-1 text-xs text-slate-800 focus:outline-none dark:border-slate-700 dark:text-slate-100"
                >
                  {PRIORITY_OPTIONS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <input
                  type="datetime-local"
                  value={inlineDueAt}
                  onChange={(e) => setInlineDueAt(e.target.value)}
                  title="Prazo agendado"
                  className="w-full bg-transparent border-0 border-b border-slate-200 focus:border-slate-700 py-1 text-xs font-mono text-slate-800 focus:outline-none dark:border-slate-700 dark:text-slate-100"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600 dark:text-slate-300">
              <div className="flex items-center gap-3">
                <input
                  type="text"
                  value={inlineProjectLabel}
                  onChange={(e) => setInlineProjectLabel(e.target.value)}
                  placeholder="Frente / Projeto..."
                  className="bg-transparent border-0 border-b border-slate-200 focus:border-slate-700 py-0.5 text-[11px] text-slate-800 placeholder:text-slate-400 focus:outline-none w-44 dark:border-slate-700 dark:text-slate-100"
                />
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={inlineReviewIvi}
                    onChange={(e) => setInlineReviewIvi(e.target.checked)}
                    className="rounded border-slate-300 text-blue-600 dark:border-slate-600 dark:text-blue-400"
                  />
                  Revisar clareza com Ivi IA
                </label>
              </div>
              <span className="text-slate-400 dark:text-slate-400">
                Vinculada ao usuário: <strong className="text-slate-700 dark:text-slate-200">{currentUser?.name || payload?.currentUserName || 'Coordenador'}</strong>
              </span>
            </div>
          </form>
        )}

        {/* Barra Retrátil: Origem das Tarefas */}
        {originsOpen && (
          <div className="pt-2.5 border-t border-slate-100 flex flex-wrap items-center gap-1.5 text-xs dark:border-slate-800">
            <span className="text-[11px] font-semibold text-slate-500 mr-1 dark:text-slate-400">Origem das tarefas:</span>
            {(
              [
                { id: 'todas', label: 'Todas Visíveis' },
                { id: 'minhas', label: 'Minhas Tarefas' },
                { id: 'compartilhadas', label: 'Compartilhadas Comigo' },
                { id: 'direta', label: 'Diretas' },
                { id: 'nota_rapida', label: 'Notas Rápidas' },
                { id: 'cobranca', label: 'Cobrança / Títulos' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setOriginFilter(opt.id)}
                className={`rounded-md border px-2.5 py-1 text-xs font-semibold transition-colors ${
                  originFilter === opt.id
                    ? 'border-slate-900 bg-slate-900 text-white dark:border-emerald-500 dark:bg-emerald-600'
                    : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-200 dark:hover:bg-slate-800'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}

        {/* Painel Retrátil: Filtros */}
        {filtersOpen && (
          <div className="pt-3 border-t border-slate-100 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2 text-xs dark:border-slate-800">
            <select
              value={filterStatusId}
              onChange={(e) => setFilterStatusId(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              <option value="">Status: Todos</option>
              {columns.map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.title}
                </option>
              ))}
            </select>

            <select
              value={filterCriticality}
              onChange={(e) => setFilterCriticality(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              <option value="">Criticidade: Todas</option>
              {CRITICALITY_OPTIONS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>

            <select
              value={filterPriority}
              onChange={(e) => setFilterPriority(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              <option value="">Prioridade: Todas</option>
              {PRIORITY_OPTIONS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>

            <select
              value={filterClientId}
              onChange={(e) => setFilterClientId(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              <option value="">Cliente: Todos</option>
              {clients.map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.fullName}
                </option>
              ))}
            </select>

            <select
              value={filterCollaboratorId}
              onChange={(e) => setFilterCollaboratorId(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              <option value="">Colaborador: Todos</option>
              {collaborators.map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.name}
                </option>
              ))}
            </select>

            <input
              type="date"
              value={filterDueFrom}
              onChange={(e) => setFilterDueFrom(e.target.value)}
              title="Prazo De"
              className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 font-mono dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />

            <div className="flex items-center gap-1.5">
              <input
                type="date"
                value={filterDueTo}
                onChange={(e) => setFilterDueTo(e.target.value)}
                title="Prazo Até"
                className="flex-1 min-w-0 rounded-lg border border-slate-200 bg-white px-2 py-1.5 font-mono dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
              <button
                type="button"
                onClick={clearAllFilters}
                className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-semibold text-slate-700 hover:bg-slate-100 whitespace-nowrap shrink-0 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Limpar
              </button>
            </div>
          </div>
        )}
      </div>

      {/* STRIP DE SUGESTÕES PROATIVAS DA IVI PARA TAREFAS */}
      {iviSuggestOpen && (
        <div className="rounded-xl border border-blue-200 bg-blue-50/40 p-4 space-y-3 dark:border-blue-800/70 dark:bg-blue-950/50">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-blue-700 shrink-0 dark:text-blue-300" />
              <div>
                <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                  Sugestões de Tarefas Ivi IA (Títulos Vencidos & Cancelamentos)
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-300">
                  Preencha o campo de criação em linha com 1 clique e confirme.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIviSuggestOpen(false)}
              className="p-1 rounded text-slate-500 hover:bg-blue-100 dark:text-slate-400 dark:hover:bg-blue-900/60"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {iviSuggestBusy ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">Ivi analisando títulos vencidos e solicitações de cancelamento...</p>
          ) : iviSuggestions.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">Nenhuma pendência crítica nova sugerida no momento.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              {iviSuggestions.map((sug, i) => (
                <div
                  key={i}
                  className="rounded-lg border border-blue-200 bg-white p-3 flex items-start justify-between gap-3 dark:border-blue-800/70 dark:bg-slate-900"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-slate-900 dark:text-slate-100">{sug.title}</p>
                    <p className="text-[11px] text-slate-600 mt-1 line-clamp-2 dark:text-slate-300">{sug.description}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      openInlineComposer({
                        title: sug.title,
                        description: sug.description,
                        criticality: sug.criticality,
                        clientId: sug.clientId,
                        projectLabel: sug.projectLabel,
                        originType: 'cobranca',
                        dueAt: '',
                      })
                    }
                    className="rounded-lg bg-blue-700 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-blue-800 whitespace-nowrap shrink-0"
                  >
                    + Usar linha
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {loading && !payload ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
          Carregando painel de tarefas da coordenação...
        </div>
      ) : (
        /* ================================================================= */
        /* PLANEJADOR SEMANAL (VISÃO ÚNICA DE TAREFAS + DRAG & DROP)         */
        /* ================================================================= */
        <div className="space-y-3">
          {/* Navegação Semanal */}
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs dark:border-slate-700 dark:bg-slate-900">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setWeekMonday((d) => addDays(d, -7))}
                className="rounded-lg border border-slate-200 px-2.5 py-1.5 font-semibold text-slate-700 hover:bg-slate-50 inline-flex items-center gap-1 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                Anterior
              </button>
              <button
                type="button"
                onClick={() => setWeekMonday(startOfWeekMonday(new Date()))}
                className="rounded-lg border border-slate-200 px-3 py-1.5 font-semibold text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800"
              >
                Hoje
              </button>
              <button
                type="button"
                onClick={() => setWeekMonday((d) => addDays(d, 7))}
                className="rounded-lg border border-slate-200 px-2.5 py-1.5 font-semibold text-slate-700 hover:bg-slate-50 inline-flex items-center gap-1 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Próxima
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="flex items-center gap-3">
              <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                <Calendar className="w-3.5 h-3.5 text-slate-400 dark:text-slate-400" />
                {draggingTaskId
                  ? 'Solte o card no dia da semana desejado'
                  : 'Arraste os cards pendentes com o mouse para mover entre os dias'}
              </span>
              <div className="font-mono font-bold text-slate-800 tabular-nums dark:text-slate-100">
                Semana: {weekLabel}
              </div>
            </div>

            {focusedDayYmd && (
              <button
                type="button"
                onClick={() => setFocusedDayYmd(null)}
                className="rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1.5 font-semibold text-blue-800 hover:bg-blue-100 inline-flex items-center gap-1 dark:border-blue-800/70 dark:bg-blue-950/50 dark:text-blue-300 dark:hover:bg-blue-900/60"
              >
                <Minimize2 className="w-3.5 h-3.5" />
                Mostrar semana inteira
              </button>
            )}
          </div>

          {/* Grade 7 dias + Sem data */}
          <div className="overflow-x-auto pb-2">
            <div className="flex gap-2.5 min-w-[960px] items-stretch">
              {weekDays
                .filter((wd) => !focusedDayYmd || focusedDayYmd === wd.ymd)
                .map((wd) => {
                  const dayTasks = filteredTasks.filter((t) => {
                    if (!t.dueAt) return false;
                    return toLocalYmd(new Date(t.dueAt)) === wd.ymd;
                  });
                  const isToday = wd.ymd === todayYmd;
                  const isDropHovered = dragOverTarget === wd.ymd;

                  return (
                    <div
                      key={wd.ymd}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                        if (dragOverTarget !== wd.ymd) setDragOverTarget(wd.ymd);
                      }}
                      onDragEnter={(e) => {
                        e.preventDefault();
                        setDragOverTarget(wd.ymd);
                      }}
                      onDragLeave={(e) => {
                        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                          setDragOverTarget((cur) => (cur === wd.ymd ? null : cur));
                        }
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        const task = resolveDraggedTask(e);
                        endTaskDrag();
                        if (task) void handleScheduleTaskDate(task, wd.ymd);
                      }}
                      className={`flex-1 min-w-[168px] rounded-xl border p-2.5 flex flex-col gap-2 transition-all ${
                        isDropHovered
                          ? 'border-blue-500 ring-2 ring-blue-200 bg-blue-50/60 dark:bg-blue-950/50'
                          : isToday
                          ? 'border-blue-300 bg-blue-50/30 dark:border-blue-800/70 dark:bg-blue-950/50'
                          : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900'
                      }`}
                    >
                      <div className="flex items-center justify-between pb-1.5 border-b border-slate-100 dark:border-slate-800">
                        <div>
                          <p className={`text-xs font-bold ${isToday ? 'text-blue-800 dark:text-blue-300' : 'text-slate-900 dark:text-slate-100'}`}>
                            {wd.label} · <span className="font-mono tabular-nums">{wd.shortDate}</span>
                          </p>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() =>
                              setFocusedDayYmd((cur) => (cur === wd.ymd ? null : wd.ymd))
                            }
                            title="Expandir dia"
                            className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-slate-800"
                          >
                            <Maximize2 className="w-3 h-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => openInlineComposer({ dueAt: `${wd.ymd}T09:00` })}
                            title="Criar tarefa neste dia"
                            className="p-1 rounded border border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                        </div>
                      </div>

                      <div className="space-y-2 flex-1 min-h-[210px]">
                        {isDropHovered && (
                          <div className="rounded-lg border border-dashed border-blue-400 bg-blue-100/60 py-1.5 text-center text-[11px] font-semibold text-blue-800 pointer-events-none dark:text-blue-300">
                            Soltar em {wd.label} ({wd.shortDate})
                          </div>
                        )}
                        {dayTasks.map((task) => {
                          const critMeta = getCriticalityMeta(task.criticality);
                          const statusMeta = getTaskStatusMeta(task);
                          const bucket = statusMeta.bucket;
                          const canDrag = task.mySharePermission !== 'view';
                          const liveSec = computeLiveElapsedSeconds(
                            task.timerAccumulatedSeconds,
                            task.timerRunningSince,
                            nowMs
                          );
                          const isBeingDragged = draggingTaskId === task.id;
                          return (
                            <div
                              key={task.id}
                              draggable={canDrag}
                              onDragStart={(e) => startTaskDrag(task, e)}
                              onDragEnd={endTaskDrag}
                              onClick={() => setDetailTaskId(task.id)}
                              className={`rounded-lg border p-2.5 transition-all select-none ${
                                canDrag ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'
                              } ${isBeingDragged ? 'opacity-45 scale-[0.98]' : ''} ${statusMeta.cardClass}`}
                            >
                              <div className="flex items-center justify-between gap-1 text-[10px]">
                                <div className="flex items-center gap-1 min-w-0">
                                  {canDrag && (
                                    <GripVertical className="w-3 h-3 text-slate-400 shrink-0 dark:text-slate-400" />
                                  )}
                                  <span className={`font-semibold truncate ${critMeta.textClass}`}>
                                    {critMeta.label}
                                  </span>
                                </div>
                                <span className={`px-1.5 py-0.5 rounded border text-[9px] font-semibold shrink-0 ${statusMeta.badgeClass}`}>
                                  {statusMeta.label}
                                </span>
                              </div>

                              <p
                                className={`mt-1 text-[11px] font-bold line-clamp-2 ${
                                  bucket === 'CONCLUIDO' || bucket === 'CANCELADO'
                                    ? 'line-through text-slate-500 dark:text-slate-400'
                                    : 'text-slate-900 dark:text-slate-100'
                                }`}
                              >
                                {task.title}
                              </p>

                              {task.clientName && (
                                <p className="text-[10px] text-slate-500 truncate mt-0.5 dark:text-slate-400">
                                  {task.clientName}
                                </p>
                              )}

                              {bucket === 'PAUSADO' && task.blockingReason && (
                                <p className="text-[10px] text-amber-800 truncate mt-0.5 dark:text-amber-300">
                                  Motivo: {task.blockingReason}
                                </p>
                              )}

                              {bucket === 'CANCELADO' && task.occurrenceNotes && (
                                <p className="text-[10px] text-red-700 truncate mt-0.5 dark:text-red-300">
                                  {task.occurrenceNotes.split('\n').pop()}
                                </p>
                              )}

                              <div
                                className="mt-2 pt-1.5 border-t border-slate-200/70 flex items-center justify-between gap-1 text-[10px]"
                                onClick={(e) => e.stopPropagation()}
                                onMouseDown={(e) => e.stopPropagation()}
                              >
                                <span className="inline-flex items-center gap-1 font-mono text-slate-600 tabular-nums dark:text-slate-300">
                                  <Clock className="w-2.5 h-2.5" />
                                  {formatStopwatchHHMMSS(liveSec)}
                                </span>
                                <div className="flex items-center gap-1">
                                  {bucket === 'PENDENTE' && task.mySharePermission !== 'view' && (
                                    <>
                                      {task.clientId && (
                                        <button
                                          type="button"
                                          draggable={false}
                                          onClick={(e) => void handleInlineTimerToggle(task, e)}
                                          title={task.timerRunningSince ? 'Pausar cronômetro' : 'Iniciar cronômetro'}
                                          className={`p-1 rounded border ${
                                            task.timerRunningSince
                                              ? 'border-amber-300 bg-amber-600 text-white dark:border-amber-800/70'
                                              : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800'
                                          }`}
                                        >
                                          {task.timerRunningSince ? (
                                            <Pause className="w-2.5 h-2.5" />
                                          ) : (
                                            <Play className="w-2.5 h-2.5" />
                                          )}
                                        </button>
                                      )}
                                      <button
                                        type="button"
                                        draggable={false}
                                        onClick={() => setClosureState({ task, targetColumnId: null })}
                                        title="Concluir tarefa"
                                        className="p-1 rounded border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800/70 dark:bg-emerald-950/50 dark:text-emerald-300 dark:hover:bg-emerald-900/60"
                                      >
                                        <CheckCircle2 className="w-2.5 h-2.5" />
                                      </button>
                                      <button
                                        type="button"
                                        draggable={false}
                                        onClick={() => setStatusTransitionState({ task, mode: 'PAUSADO' })}
                                        title="Pausar tarefa"
                                        className="p-1 rounded border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-800/70 dark:bg-amber-950/50 dark:text-amber-300 dark:hover:bg-amber-900/60"
                                      >
                                        <Pause className="w-2.5 h-2.5" />
                                      </button>
                                      <button
                                        type="button"
                                        draggable={false}
                                        onClick={() => setStatusTransitionState({ task, mode: 'CANCELADO' })}
                                        title="Cancelar tarefa"
                                        className="p-1 rounded border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300 dark:hover:bg-red-900/60"
                                      >
                                        <Ban className="w-2.5 h-2.5" />
                                      </button>
                                    </>
                                  )}
                                  {bucket !== 'PENDENTE' && task.mySharePermission !== 'view' && (
                                    <button
                                      type="button"
                                      draggable={false}
                                      onClick={() => void handleResumeToPending(task)}
                                      title="Retomar tarefa para Pendente"
                                      className="p-1 rounded border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 dark:border-blue-800/70 dark:bg-blue-950/50 dark:text-blue-300 dark:hover:bg-blue-900/60"
                                    >
                                      <RotateCcw className="w-2.5 h-2.5" />
                                    </button>
                                  )}
                                  {task.isOwner && (
                                    <button
                                      type="button"
                                      draggable={false}
                                      onClick={() => setShareTaskId(task.id)}
                                      title="Compartilhar com outro coordenador"
                                      className="p-1 rounded border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                                    >
                                      <Share2 className="w-2.5 h-2.5" />
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}

              {/* Coluna Sem Data */}
              {!focusedDayYmd && (
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    if (dragOverTarget !== 'SEM_DATA') setDragOverTarget('SEM_DATA');
                  }}
                  onDragEnter={(e) => {
                    e.preventDefault();
                    setDragOverTarget('SEM_DATA');
                  }}
                  onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                      setDragOverTarget((cur) => (cur === 'SEM_DATA' ? null : cur));
                    }
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const task = resolveDraggedTask(e);
                    endTaskDrag();
                    if (task) void handleScheduleTaskDate(task, null);
                  }}
                  className={`w-[200px] shrink-0 rounded-xl border border-dashed p-2.5 flex flex-col gap-2 transition-all ${
                    dragOverTarget === 'SEM_DATA'
                      ? 'border-blue-500 ring-2 ring-blue-200 bg-blue-50/60 dark:bg-blue-950/50'
                      : 'border-slate-300 bg-slate-50 dark:border-slate-600 dark:bg-slate-800/70'
                  }`}
                >
                  <div className="flex items-center justify-between pb-1.5 border-b border-slate-200 dark:border-slate-700">
                    <p className="text-xs font-bold text-slate-700 dark:text-slate-200">Sem data</p>
                    <button
                      type="button"
                      onClick={() => openInlineComposer({ dueAt: '' })}
                      title="Criar tarefa sem data"
                      className="p-1 rounded border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>

                  <div className="space-y-2 flex-1 min-h-[210px]">
                    {dragOverTarget === 'SEM_DATA' && (
                      <div className="rounded-lg border border-dashed border-blue-400 bg-blue-100/60 py-1.5 text-center text-[11px] font-semibold text-blue-800 pointer-events-none dark:text-blue-300">
                        Mover para Sem data
                      </div>
                    )}
                    {filteredTasks
                      .filter((t) => !t.dueAt)
                      .map((task) => {
                        const critMeta = getCriticalityMeta(task.criticality);
                        const statusMeta = getTaskStatusMeta(task);
                        const bucket = statusMeta.bucket;
                        const canDrag = task.mySharePermission !== 'view';
                        const isBeingDragged = draggingTaskId === task.id;
                        return (
                          <div
                            key={task.id}
                            draggable={canDrag}
                            onDragStart={(e) => startTaskDrag(task, e)}
                            onDragEnd={endTaskDrag}
                            onClick={() => setDetailTaskId(task.id)}
                            className={`rounded-lg border p-2.5 transition-all select-none ${
                              canDrag ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'
                            } ${isBeingDragged ? 'opacity-45 scale-[0.98]' : ''} ${statusMeta.cardClass}`}
                          >
                            <div className="flex items-center justify-between gap-1 text-[10px]">
                              <div className="flex items-center gap-1 min-w-0">
                                {canDrag && <GripVertical className="w-3 h-3 text-slate-400 shrink-0 dark:text-slate-400" />}
                                <span className={`font-semibold truncate ${critMeta.textClass}`}>
                                  {critMeta.label}
                                </span>
                              </div>
                              <span className={`px-1.5 py-0.5 rounded border text-[9px] font-semibold shrink-0 ${statusMeta.badgeClass}`}>
                                {statusMeta.label}
                              </span>
                            </div>
                            <p
                              className={`mt-1 text-[11px] font-bold line-clamp-2 ${
                                bucket === 'CONCLUIDO' || bucket === 'CANCELADO'
                                  ? 'line-through text-slate-500 dark:text-slate-400'
                                  : 'text-slate-900 dark:text-slate-100'
                              }`}
                            >
                              {task.title}
                            </p>
                            {task.clientName && (
                              <p className="text-[10px] text-slate-500 truncate mt-0.5 dark:text-slate-400">
                                {task.clientName}
                              </p>
                            )}
                            <div
                              className="flex items-center justify-between mt-2 pt-1.5 border-t border-slate-200/70 text-[10px] text-slate-400 dark:text-slate-400"
                              onClick={(e) => e.stopPropagation()}
                              onMouseDown={(e) => e.stopPropagation()}
                            >
                              <span className="truncate">{task.isOwner ? 'Arraste p/ dia' : `De: ${task.ownerName}`}</span>
                              <div className="flex items-center gap-1 shrink-0">
                                {bucket === 'PENDENTE' && task.mySharePermission !== 'view' && (
                                  <>
                                    <button
                                      type="button"
                                      draggable={false}
                                      onClick={() => setClosureState({ task, targetColumnId: null })}
                                      title="Concluir tarefa"
                                      className="p-1 rounded border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800/70 dark:bg-emerald-950/50 dark:text-emerald-300 dark:hover:bg-emerald-900/60"
                                    >
                                      <CheckCircle2 className="w-2.5 h-2.5" />
                                    </button>
                                    <button
                                      type="button"
                                      draggable={false}
                                      onClick={() => setStatusTransitionState({ task, mode: 'PAUSADO' })}
                                      title="Pausar tarefa"
                                      className="p-1 rounded border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-800/70 dark:bg-amber-950/50 dark:text-amber-300 dark:hover:bg-amber-900/60"
                                    >
                                      <Pause className="w-2.5 h-2.5" />
                                    </button>
                                    <button
                                      type="button"
                                      draggable={false}
                                      onClick={() => setStatusTransitionState({ task, mode: 'CANCELADO' })}
                                      title="Cancelar tarefa"
                                      className="p-1 rounded border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300 dark:hover:bg-red-900/60"
                                    >
                                      <Ban className="w-2.5 h-2.5" />
                                    </button>
                                  </>
                                )}
                                {bucket !== 'PENDENTE' && task.mySharePermission !== 'view' && (
                                  <button
                                    type="button"
                                    draggable={false}
                                    onClick={() => void handleResumeToPending(task)}
                                    title="Retomar tarefa para Pendente"
                                    className="p-1 rounded border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 dark:border-blue-800/70 dark:bg-blue-950/50 dark:text-blue-300 dark:hover:bg-blue-900/60"
                                  >
                                    <RotateCcw className="w-2.5 h-2.5" />
                                  </button>
                                )}
                                {task.isOwner && (
                                  <button
                                    type="button"
                                    draggable={false}
                                    onClick={() => setShareTaskId(task.id)}
                                    title="Compartilhar"
                                    className="p-1 rounded border border-slate-200 bg-white text-slate-600 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:text-white"
                                  >
                                    <Share2 className="w-2.5 h-2.5" />
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAIS DE DETALHES / COMPARTILHAMENTO / PAUSA / CANCELAMENTO / FIM    */}
      {/* ===================================================================== */}
      <TaskDetailModal
        task={detailTask}
        columns={columns}
        clients={clients}
        collaborators={collaborators}
        coordinators={payload?.coordinators || []}
        nowMs={nowMs}
        onClose={() => setDetailTaskId(null)}
        onUpdated={async (msg) => {
          if (msg) onToast(msg);
          await loadTasks();
        }}
        onRequestClosure={(t, targetColId) =>
          setClosureState({ task: t, targetColumnId: targetColId })
        }
        onRequestPauseTask={(t) => setPauseTask(t)}
        onRequestStatusTransition={(t, mode) => setStatusTransitionState({ task: t, mode })}
        onRequestResumeTask={handleResumeToPending}
        onRequestShare={(t) => setShareTaskId(t.id)}
        onRequestDelete={(t) => setDeletingSingleTask(t)}
        onOpenClient={onOpenClient}
      />

      <TaskShareModal
        task={shareTask}
        coordinators={payload?.coordinators || []}
        onClose={() => setShareTaskId(null)}
        onChanged={async (msg) => {
          onToast(msg);
          await loadTasks();
        }}
      />

      <TaskPauseModal
        open={Boolean(pauseTask)}
        targetTitle={pauseTask?.title || ''}
        onCancel={() => setPauseTask(null)}
        onConfirm={async (reason) => {
          if (!pauseTask) return;
          await apiFetch(`/api/collection/coordinator/tasks/${pauseTask.id}/timer`, {
            method: 'POST',
            body: JSON.stringify({ action: 'pause', reason }),
          });
          setPauseTask(null);
          onToast('Cronômetro pausado com justificativa registrada.');
          await loadTasks();
        }}
      />

      <TaskStatusTransitionModal
        task={statusTransitionState?.task || null}
        mode={statusTransitionState?.mode || null}
        onCancel={() => setStatusTransitionState(null)}
        onConfirm={async (reason) => {
          if (!statusTransitionState) return;
          const { task, mode } = statusTransitionState;
          await apiFetch(`/api/collection/coordinator/tasks/${task.id}`, {
            method: 'PATCH',
            body: JSON.stringify(
              mode === 'PAUSADO'
                ? { statusKey: 'PAUSADO', pauseReason: reason }
                : { statusKey: 'CANCELADO', cancelReason: reason }
            ),
          });
          setStatusTransitionState(null);
          onToast(
            mode === 'PAUSADO'
              ? `Tarefa "${task.title}" marcada como Pausada.`
              : `Tarefa "${task.title}" marcada como Cancelada.`
          );
          await loadTasks();
        }}
      />

      <TaskClosureModal
        task={closureState?.task || null}
        targetColumnId={closureState?.targetColumnId ?? null}
        onCancel={() => setClosureState(null)}
        onCompleted={async (msg) => {
          setClosureState(null);
          onToast(msg);
          await loadTasks();
        }}
      />

      <TaskColumnsModal
        open={columnsModalOpen}
        columns={columns}
        onClose={() => setColumnsModalOpen(false)}
        onSaved={async (msg) => {
          onToast(msg);
          await loadTasks();
        }}
      />

      <ConfirmTaskDeleteModal
        open={Boolean(deletingSingleTask)}
        title="Excluir Tarefa"
        message={
          deletingSingleTask
            ? `Excluir permanentemente a tarefa "${deletingSingleTask.title}"? Subtarefas, histórico e compartilhamentos serão removidos.`
            : ''
        }
        busy={singleDeleteBusy}
        onCancel={() => setDeletingSingleTask(null)}
        onConfirm={handleConfirmSingleDelete}
      />
    </div>
  );
};
