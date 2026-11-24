import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Ban,
  Bot,
  Check,
  CheckCircle2,
  Clock,
  Download,
  Edit3,
  Eye,
  FileText,
  History,
  Lock,
  Mic,
  MicOff,
  Paperclip,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Share2,
  ShieldAlert,
  Sparkles,
  Trash2,
  Upload,
  UserCheck,
  X,
} from 'lucide-react';
import { apiFetch, formatBytes, formatDateTimeBR, getAuthToken } from '../../lib/api.ts';
import { DossierDocumentPreviewModal } from '../DossierDocumentViewer.tsx';
import {
  Client,
  CollaboratorItem,
  CoordinatorEligibleUser,
  CoordinatorTaskAttachment,
  CoordinatorTaskColumn,
  CoordinatorTaskItem,
  CoordinatorTaskSubtask,
} from '../../types.ts';
import { EntityAuditModal } from './cadastros/CadastrosShared.tsx';

// -----------------------------------------------------------------------------
// UTILITÁRIOS COMPARTILHADOS
// -----------------------------------------------------------------------------
export const CRITICALITY_OPTIONS = [
  { value: 'baixo', label: 'Baixo', textClass: 'text-slate-700 dark:text-slate-200', borderClass: 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/70' },
  { value: 'medio', label: 'Médio', textClass: 'text-blue-800 dark:text-blue-200', borderClass: 'border-blue-200 bg-blue-50 dark:border-blue-800/70 dark:bg-blue-950/60' },
  { value: 'alto', label: 'Alto', textClass: 'text-amber-800 dark:text-amber-200', borderClass: 'border-amber-200 bg-amber-50 dark:border-amber-800/70 dark:bg-amber-950/60' },
  { value: 'critico', label: 'Crítico', textClass: 'text-orange-800 dark:text-orange-200', borderClass: 'border-orange-200 bg-orange-50 dark:border-orange-800/70 dark:bg-orange-950/60' },
  { value: 'emergencial', label: 'Emergencial', textClass: 'text-red-800 dark:text-red-200', borderClass: 'border-red-200 bg-red-50 dark:border-red-800/70 dark:bg-red-950/60' },
] as const;

export const PRIORITY_OPTIONS = [
  { value: 'alta', label: 'Alta' },
  { value: 'media', label: 'Média' },
  { value: 'baixa', label: 'Baixa' },
] as const;

export function getCriticalityMeta(crit: string | undefined) {
  const clean = String(crit || 'medio').toLowerCase();
  return CRITICALITY_OPTIONS.find((c) => c.value === clean) || CRITICALITY_OPTIONS[1];
}

export function getPriorityLabel(prio: string | undefined) {
  const clean = String(prio || 'media').toLowerCase();
  return PRIORITY_OPTIONS.find((p) => p.value === clean)?.label || 'Média';
}

export type TaskStatusBucket = 'PENDENTE' | 'PAUSADO' | 'CONCLUIDO' | 'CANCELADO';

export function getTaskStatusBucket(task: Pick<CoordinatorTaskItem, 'statusKey' | 'isCompleted'>): TaskStatusBucket {
  const key = String(task.statusKey || '').toUpperCase();
  if (task.isCompleted || key === 'CONCLUIDO') return 'CONCLUIDO';
  if (key === 'CANCELADO') return 'CANCELADO';
  if (key === 'PAUSADO') return 'PAUSADO';
  return 'PENDENTE';
}

export function getTaskStatusMeta(task: Pick<CoordinatorTaskItem, 'statusKey' | 'statusLabel' | 'isCompleted'>) {
  const bucket = getTaskStatusBucket(task);
  if (bucket === 'CONCLUIDO') {
    return {
      bucket,
      label: task.statusLabel || 'Concluído',
      badgeClass: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800/70 dark:bg-emerald-950/60 dark:text-emerald-200',
      cardClass: 'border-emerald-200 bg-emerald-50/40 dark:border-emerald-800/70 dark:bg-emerald-950/35',
    };
  }
  if (bucket === 'PAUSADO') {
    return {
      bucket,
      label: task.statusLabel || 'Pausado',
      badgeClass: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800/70 dark:bg-amber-950/60 dark:text-amber-200',
      cardClass: 'border-amber-200 bg-amber-50/40 dark:border-amber-800/70 dark:bg-amber-950/35',
    };
  }
  if (bucket === 'CANCELADO') {
    return {
      bucket,
      label: task.statusLabel || 'Cancelado',
      badgeClass: 'border-red-200 bg-red-50 text-red-800 dark:border-red-800/70 dark:bg-red-950/60 dark:text-red-200',
      cardClass: 'border-red-200 bg-red-50/35 dark:border-red-800/70 dark:bg-red-950/30',
    };
  }
  return {
    bucket,
    label: task.statusLabel || 'Pendente',
    badgeClass: 'border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200',
    cardClass: 'border-slate-200 bg-white hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-600',
  };
}

export function computeLiveElapsedSeconds(
  accumulatedSeconds: number,
  runningSince: string | null | undefined,
  nowMs: number
): number {
  const base = Math.max(0, Number(accumulatedSeconds || 0));
  if (!runningSince) return base;
  const started = new Date(runningSince).getTime();
  if (Number.isNaN(started)) return base;
  return base + Math.max(0, Math.floor((nowMs - started) / 1000));
}

export function formatStopwatchHHMMSS(totalSec: number): string {
  const sec = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function toDatetimeLocalValue(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// =============================================================================
// 1. MODAL: NOVA TAREFA (§4.1)
// =============================================================================
interface NewTaskModalProps {
  open: boolean;
  columns: CoordinatorTaskColumn[];
  clients: Client[];
  collaborators: CollaboratorItem[];
  defaultDueAt?: string;
  initialDraft?: {
    title?: string;
    description?: string;
    criticality?: string;
    clientId?: number | null;
    projectLabel?: string;
    originType?: string;
  } | null;
  onClose: () => void;
  onCreated: (msg: string) => Promise<void> | void;
}

export const NewTaskModal: React.FC<NewTaskModalProps> = ({
  open,
  columns,
  clients,
  collaborators,
  defaultDueAt,
  initialDraft,
  onClose,
  onCreated,
}) => {
  const [title, setTitle] = useState('');
  const [clientId, setClientId] = useState<string>('');
  const [projectLabel, setProjectLabel] = useState('');
  const [criticality, setCriticality] = useState('medio');
  const [priority, setPriority] = useState('media');
  const [statusColumnId, setStatusColumnId] = useState<string>('');
  const [collaboratorId, setCollaboratorId] = useState<string>('');
  const [dueAt, setDueAt] = useState('');
  const [estimatedMinutes, setEstimatedMinutes] = useState('');
  const [description, setDescription] = useState('');
  const [solutionNotes, setSolutionNotes] = useState('');
  const [reviewWithIvi, setReviewWithIvi] = useState(false);
  const [originType, setOriginType] = useState('direta');
  const [iviPreview, setIviPreview] = useState('');
  const [iviBusy, setIviBusy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [listening, setListening] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(initialDraft?.title || '');
    setDescription(initialDraft?.description || '');
    setCriticality(initialDraft?.criticality || 'medio');
    setClientId(initialDraft?.clientId ? String(initialDraft.clientId) : '');
    setProjectLabel(initialDraft?.projectLabel || '');
    setOriginType(initialDraft?.originType || 'direta');
    setPriority('media');
    setStatusColumnId(columns[0]?.id ? String(columns[0].id) : '');
    setCollaboratorId('');
    setDueAt(defaultDueAt || '');
    setEstimatedMinutes('');
    setSolutionNotes('');
    setReviewWithIvi(false);
    setIviPreview('');
    setError('');
  }, [open, columns, defaultDueAt, initialDraft]);

  if (!open) return null;

  const toggleVoiceInput = () => {
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
      setError('Ditado por voz não suportado neste navegador.');
      return;
    }
    const recognition = new Rec();
    recognition.lang = 'pt-BR';
    recognition.interimResults = false;
    setListening(true);
    recognition.onresult = (ev) => {
      const spoken = ev.results?.[0]?.[0]?.transcript || '';
      if (spoken) {
        setTitle((prev) => (prev ? `${prev} ${spoken}` : spoken));
      }
    };
    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);
    recognition.start();
  };

  const handleCheckIvi = async () => {
    if (!title.trim() && !description.trim()) {
      setError('Preencha ao menos o título ou a descrição para a Ivi avaliar.');
      return;
    }
    setIviBusy(true);
    setError('');
    try {
      const res = await apiFetch<{ approved: boolean; feedback: string; suggestion?: string }>(
        '/api/collection/coordinator/tasks/ivi-review',
        {
          method: 'POST',
          body: JSON.stringify({
            mode: 'creation',
            title: title.trim(),
            description: description.trim(),
          }),
        }
      );
      setIviPreview([res.feedback, res.suggestion].filter(Boolean).join(' — '));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao consultar Ivi IA.');
    } finally {
      setIviBusy(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError('Informe o título da tarefa.');
      return;
    }
    if (estimatedMinutes && Number(estimatedMinutes) < 1) {
      setError('A estimativa de tempo deve ser no mínimo 1 minuto.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await apiFetch('/api/collection/coordinator/tasks', {
        method: 'POST',
        body: JSON.stringify({
          title: title.trim(),
          clientId: clientId ? Number(clientId) : null,
          projectLabel: projectLabel.trim(),
          criticality,
          priority,
          statusColumnId: statusColumnId ? Number(statusColumnId) : null,
          collaboratorId: collaboratorId ? Number(collaboratorId) : null,
          dueAt: dueAt ? new Date(dueAt).toISOString() : null,
          estimatedMinutes: estimatedMinutes ? Number(estimatedMinutes) : null,
          description: description.trim(),
          solutionNotes: solutionNotes.trim(),
          originType,
          reviewWithIvi,
        }),
      });
      await onCreated('Tarefa criada e vinculada ao seu usuário.');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao criar tarefa.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-[1px] flex items-center justify-center p-4 dark:bg-slate-950/80">
      <div className="bg-white rounded-xl border border-slate-200 shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden dark:bg-slate-900 dark:border-slate-700">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 bg-slate-50/70 dark:border-slate-700 dark:bg-slate-800/60">
          <div>
            <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">Nova Tarefa da Coordenação</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Associada automaticamente ao coordenador logado, com compartilhamento opcional posterior.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-200/70 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white dark:hover:bg-slate-700/70"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 overflow-y-auto space-y-4 text-xs">
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-800 font-medium dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300">
              {error}
            </div>
          )}

          <div>
            <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">
              Título *
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ex.: Validar acordo vencido ou cobrar comprovante PIX"
                className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-blue-500 dark:border-slate-700 dark:text-slate-100"
                autoFocus
              />
              <button
                type="button"
                onClick={toggleVoiceInput}
                title="Ditar título por voz"
                className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-2 text-xs font-semibold whitespace-nowrap shrink-0 ${
                  listening
                    ? 'border-red-300 bg-red-50 text-red-700 dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800'
                }`}
              >
                {listening ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
                {listening ? 'Ouvindo...' : 'Voz'}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Cliente (Opcional)</label>
              <select
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs bg-white text-slate-900 focus:outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              >
                <option value="">Sem cliente vinculado</option>
                {clients.map((c) => (
                  <option key={c.id} value={String(c.id)}>
                    {c.fullName} ({c.cpfCnpj})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Frente / Projeto</label>
              <input
                type="text"
                value={projectLabel}
                onChange={(e) => setProjectLabel(e.target.value)}
                placeholder="Ex.: Cobrança Ativa, Auditoria, Retenção"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-blue-500 dark:border-slate-700 dark:text-slate-100"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Criticidade</label>
              <select
                value={criticality}
                onChange={(e) => setCriticality(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs bg-white text-slate-900 focus:outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              >
                {CRITICALITY_OPTIONS.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Prioridade</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs bg-white text-slate-900 focus:outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              >
                {PRIORITY_OPTIONS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Status Inicial (Coluna)</label>
              <select
                value={statusColumnId}
                onChange={(e) => setStatusColumnId(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs bg-white text-slate-900 focus:outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              >
                {columns.map((col) => (
                  <option key={col.id} value={String(col.id)}>
                    {col.title}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Colaborador Associado</label>
              <select
                value={collaboratorId}
                onChange={(e) => setCollaboratorId(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs bg-white text-slate-900 focus:outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              >
                <option value="">Coordenação direta</option>
                {collaborators.map((c) => (
                  <option key={c.id} value={String(c.id)}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Prazo (Data / Hora)</label>
              <input
                type="datetime-local"
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-mono text-slate-900 focus:outline-none focus:border-blue-500 dark:border-slate-700 dark:text-slate-100 dark:bg-slate-950"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Tempo Estimado (min)</label>
              <input
                type="number"
                min={1}
                value={estimatedMinutes}
                onChange={(e) => setEstimatedMinutes(e.target.value)}
                placeholder="Ex.: 30"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-mono text-slate-900 focus:outline-none focus:border-blue-500 dark:border-slate-700 dark:text-slate-100"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="font-semibold text-slate-700 dark:text-slate-200">Descrição Operacional</label>
              <button
                type="button"
                disabled={iviBusy}
                onClick={handleCheckIvi}
                className="inline-flex items-center gap-1 rounded border border-blue-200 bg-blue-50 px-2 py-1 text-[11px] font-semibold text-blue-800 hover:bg-blue-100 whitespace-nowrap shrink-0 dark:border-blue-800/70 dark:bg-blue-950/50 dark:text-blue-300 dark:hover:bg-blue-900/60"
              >
                <Bot className="w-3 h-3" />
                {iviBusy ? 'Ivi revisando...' : 'Revisar com Ivi IA'}
              </button>
            </div>
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Descreva o contexto, pendência ou instruções de execução..."
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-blue-500 dark:border-slate-700 dark:text-slate-100"
            />
          </div>

          {iviPreview && (
            <div className="rounded-lg border border-blue-200 bg-blue-50/70 px-3 py-2 text-xs text-slate-800 flex items-start gap-2 dark:border-blue-800/70 dark:bg-blue-950/50 dark:text-slate-100">
              <Sparkles className="w-4 h-4 text-blue-700 shrink-0 mt-0.5 dark:text-blue-300" />
              <div>
                <p className="font-semibold text-blue-900 dark:text-blue-300">Parecer Ivi IA</p>
                <p className="text-slate-700 mt-0.5 dark:text-slate-200">{iviPreview}</p>
              </div>
            </div>
          )}

          <div>
            <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Solução Planejada / Observação Inicial (Opcional)</label>
            <textarea
              rows={2}
              value={solutionNotes}
              onChange={(e) => setSolutionNotes(e.target.value)}
              placeholder="Solução prevista ou critério de resolução..."
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-blue-500 dark:border-slate-700 dark:text-slate-100 dark:bg-slate-950"
            />
          </div>

          <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer dark:text-slate-200">
            <input
              type="checkbox"
              checked={reviewWithIvi}
              onChange={(e) => setReviewWithIvi(e.target.checked)}
              className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 dark:border-slate-600 dark:text-blue-400"
            />
            Salvar revisão automática de clareza da Ivi ao criar a tarefa
          </label>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-700">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60 inline-flex items-center gap-1.5 dark:bg-emerald-600 dark:hover:bg-emerald-500"
            >
              <Plus className="w-3.5 h-3.5" />
              {submitting ? 'Salvando...' : 'Criar Tarefa'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// =============================================================================
// 2. MODAL: COMPARTILHAR TAREFA COM OUTRO COORDENADOR (§6.6)
// =============================================================================
interface TaskShareModalProps {
  task: CoordinatorTaskItem | null;
  coordinators: CoordinatorEligibleUser[];
  onClose: () => void;
  onChanged: (msg: string) => Promise<void> | void;
}

export const TaskShareModal: React.FC<TaskShareModalProps> = ({
  task,
  coordinators,
  onClose,
  onChanged,
}) => {
  const [targetUserId, setTargetUserId] = useState('');
  const [permission, setPermission] = useState<'edit' | 'view'>('edit');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setTargetUserId('');
    setPermission('edit');
    setError('');
  }, [task?.id]);

  if (!task) return null;

  const availableCoordinators = coordinators.filter(
    (c) => c.id !== task.ownerUserId
  );

  const handleGrant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetUserId) {
      setError('Selecione um coordenador destinatário.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await apiFetch(`/api/collection/coordinator/tasks/${task.id}/shares`, {
        method: 'POST',
        body: JSON.stringify({
          sharedWithUserId: Number(targetUserId),
          permission,
        }),
      });
      setTargetUserId('');
      await onChanged('Compartilhamento concedido sem transferir a propriedade.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao conceder acesso.');
    } finally {
      setBusy(false);
    }
  };

  const handleRevoke = async (shareId: number) => {
    setBusy(true);
    setError('');
    try {
      await apiFetch(`/api/collection/coordinator/tasks/${task.id}/shares/${shareId}`, {
        method: 'DELETE',
      });
      await onChanged('Acesso compartilhado revogado.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao revogar compartilhamento.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-slate-900/50 flex items-center justify-center p-4 dark:bg-slate-950/80">
      <div className="bg-white rounded-xl border border-slate-200 shadow-2xl w-full max-w-lg overflow-hidden dark:bg-slate-900 dark:border-slate-700">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/70">
          <div className="min-w-0">
            <h3 className="font-display text-sm font-bold text-slate-900 truncate dark:text-slate-100">
              Compartilhar Tarefa entre Coordenadores
            </h3>
            <p className="text-xs text-slate-500 truncate dark:text-slate-400">{task.title}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-200 dark:text-slate-400 dark:hover:bg-slate-700"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 text-xs">
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-800 font-medium dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300">
              {error}
            </div>
          )}

          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-slate-600 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-300">
            Proprietário original: <strong className="text-slate-900 dark:text-slate-100">{task.ownerName}</strong>. O compartilhamento concede acesso ao destinatário sem alterar o proprietário da tarefa.
          </div>

          <form onSubmit={handleGrant} className="space-y-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Destinatário *</label>
              <select
                value={targetUserId}
                onChange={(e) => setTargetUserId(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 bg-white text-slate-900 focus:outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              >
                <option value="">Selecione outro coordenador / usuário...</option>
                {availableCoordinators.map((c) => (
                  <option key={c.id} value={String(c.id)}>
                    {c.name} · {c.groupName} ({c.email})
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-end gap-2">
              <div className="flex-1">
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Permissão</label>
                <select
                  value={permission}
                  onChange={(e) => setPermission(e.target.value === 'view' ? 'view' : 'edit')}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 bg-white text-slate-900 focus:outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                >
                  <option value="edit">Editar (alterar status, cronômetro, subtarefas)</option>
                  <option value="view">Somente visualizar</option>
                </select>
              </div>
              <button
                type="submit"
                disabled={busy}
                className="rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white hover:bg-slate-800 disabled:opacity-60 whitespace-nowrap shrink-0 dark:bg-emerald-600 dark:hover:bg-emerald-500"
              >
                Conceder
              </button>
            </div>
          </form>

          <div className="border-t border-slate-200 pt-3 dark:border-slate-700">
            <h4 className="font-semibold text-slate-800 mb-2 dark:text-slate-100">
              Pessoas com acesso ({task.shares.length})
            </h4>
            {task.shares.length === 0 ? (
              <p className="text-slate-400 dark:text-slate-400">Nenhum compartilhamento ativo para esta tarefa.</p>
            ) : (
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {task.shares.map((s) => (
                  <div
                    key={s.id}
                    className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 bg-white dark:border-slate-700 dark:bg-slate-900"
                  >
                    <div>
                      <p className="font-semibold text-slate-900 dark:text-slate-100">{s.sharedWithName}</p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        Permissão: {s.permission === 'view' ? 'Somente visualização' : 'Edição completa'}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleRevoke(s.id)}
                      className="rounded border border-red-200 bg-red-50 px-2.5 py-1 text-[11px] font-semibold text-red-700 hover:bg-red-100 whitespace-nowrap shrink-0 dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300 dark:hover:bg-red-900/60"
                    >
                      Revogar
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// =============================================================================
// 3. MODAL: JUSTIFICATIVA DE PAUSA DO CRONÔMETRO (§6.2)
// =============================================================================
interface TaskPauseModalProps {
  open: boolean;
  targetTitle: string;
  onCancel: () => void;
  onConfirm: (reason: string) => Promise<void> | void;
}

const PAUSE_REASONS = ['Reunião', 'Aguardando Cliente', 'Bloqueio Operacional', 'Intervalo / Fim de Turno'];

export const TaskPauseModal: React.FC<TaskPauseModalProps> = ({
  open,
  targetTitle,
  onCancel,
  onConfirm,
}) => {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setReason('');
      setError('');
    }
  }, [open]);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) {
      setError('Informe a justificativa de pausa para registrar no histórico.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await onConfirm(reason.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao pausar cronômetro.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] bg-slate-900/50 flex items-center justify-center p-4 dark:bg-slate-950/80">
      <div className="bg-white rounded-xl border border-slate-200 shadow-2xl w-full max-w-md overflow-hidden dark:bg-slate-900 dark:border-slate-700">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/70">
          <div>
            <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">Justificativa de Pausa</h3>
            <p className="text-[11px] text-slate-500 truncate max-w-xs dark:text-slate-400">{targetTitle}</p>
          </div>
          <button type="button" onClick={onCancel} className="p-1 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-3 text-xs">
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-800 dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300">{error}</div>
          )}
          <div className="flex flex-wrap gap-1.5">
            {PAUSE_REASONS.map((chip) => (
              <button
                key={chip}
                type="button"
                onClick={() => setReason(chip)}
                className="rounded border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                {chip}
              </button>
            ))}
          </div>
          <textarea
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Descreva o motivo da pausa..."
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-blue-500 dark:border-slate-700 dark:text-slate-100 dark:bg-slate-950"
            autoFocus
          />
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-lg border border-slate-200 px-3.5 py-2 font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-amber-600 px-3.5 py-2 font-semibold text-white hover:bg-amber-700 disabled:opacity-60"
            >
              {busy ? 'Pausando...' : 'Confirmar Pausa'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// =============================================================================
// 4. MODAL: REGISTRAR ENCERRAMENTO (§6.1)
// =============================================================================
interface TaskClosureModalProps {
  task: CoordinatorTaskItem | null;
  targetColumnId: number | null;
  onCancel: () => void;
  onCompleted: (msg: string) => Promise<void> | void;
}

export const TaskClosureModal: React.FC<TaskClosureModalProps> = ({
  task,
  targetColumnId,
  onCancel,
  onCompleted,
}) => {
  const [occurrenceNotes, setOccurrenceNotes] = useState('');
  const [solutionNotes, setSolutionNotes] = useState('');
  const [validateWithIvi, setValidateWithIvi] = useState(true);
  const [iviCheckMsg, setIviCheckMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!task) return;
    setOccurrenceNotes(task.occurrenceNotes || '');
    setSolutionNotes(task.solutionNotes || '');
    setIviCheckMsg('');
    setError('');
  }, [task?.id, targetColumnId]);

  if (!task) return null;

  const pendingSubtasks = task.subtasks.filter((s) => s.status !== 'CONCLUIDO');

  const handleConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pendingSubtasks.length > 0) {
      setError(`Conclua as ${pendingSubtasks.length} subtarefa(s) pendente(s) antes de encerrar esta tarefa.`);
      return;
    }
    if (!occurrenceNotes.trim() && !solutionNotes.trim()) {
      setError('Preencha Ocorrência ou Solução Adotada para concluir o encerramento.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await apiFetch(`/api/collection/coordinator/tasks/${task.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          statusColumnId: targetColumnId,
          isCompleted: true,
          occurrenceNotes: occurrenceNotes.trim(),
          solutionNotes: solutionNotes.trim(),
          validateClosureWithIvi: validateWithIvi,
        }),
      });
      await onCompleted('Tarefa concluída com encerramento registrado.');
      onCancel();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível concluir a tarefa.');
    } finally {
      setBusy(false);
    }
  };

  const handlePreviewIvi = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await apiFetch<{ approved: boolean; feedback: string; suggestion?: string }>(
        '/api/collection/coordinator/tasks/ivi-review',
        {
          method: 'POST',
          body: JSON.stringify({
            mode: 'closure',
            title: task.title,
            occurrence: occurrenceNotes.trim(),
            solution: solutionNotes.trim(),
          }),
        }
      );
      setIviCheckMsg([res.feedback, res.suggestion].filter(Boolean).join(' — '));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro na validação Ivi.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] bg-slate-900/50 flex items-center justify-center p-4 dark:bg-slate-950/80">
      <div className="bg-white rounded-xl border border-slate-200 shadow-2xl w-full max-w-lg overflow-hidden dark:bg-slate-900 dark:border-slate-700">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/70">
          <div>
            <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">Registrar Encerramento</h3>
            <p className="text-xs text-slate-500 truncate max-w-sm dark:text-slate-400">{task.title}</p>
          </div>
          <button type="button" onClick={onCancel} className="p-1 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleConfirm} className="p-5 space-y-3 text-xs">
          {pendingSubtasks.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900 flex items-center gap-2 dark:border-amber-800/70 dark:bg-amber-950/50 dark:text-amber-300">
              <AlertTriangle className="w-4 h-4 shrink-0 text-amber-700 dark:text-amber-300" />
              <span>
                Existem <strong>{pendingSubtasks.length}</strong> subtarefa(s) em aberto. Conclua todas na guia de detalhes antes do encerramento.
              </span>
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-800 dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300">{error}</div>
          )}

          <div>
            <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Ocorrência (O que aconteceu)</label>
            <textarea
              rows={2}
              value={occurrenceNotes}
              onChange={(e) => setOccurrenceNotes(e.target.value)}
              placeholder="Descreva a causa raiz ou situação apurada..."
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-blue-500 dark:border-slate-700 dark:text-slate-100"
            />
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Solução Adotada</label>
            <textarea
              rows={3}
              value={solutionNotes}
              onChange={(e) => setSolutionNotes(e.target.value)}
              placeholder="Descreva a ação executada, acordo fechado ou encaminhamento..."
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-blue-500 dark:border-slate-700 dark:text-slate-100"
            />
          </div>

          <div className="flex items-center justify-between gap-2">
            <label className="inline-flex items-center gap-2 text-slate-700 cursor-pointer dark:text-slate-200">
              <input
                type="checkbox"
                checked={validateWithIvi}
                onChange={(e) => setValidateWithIvi(e.target.checked)}
                className="rounded border-slate-300 text-blue-600 dark:border-slate-600 dark:text-blue-400"
              />
              Registrar validação automática com Ivi IA
            </label>
            <button
              type="button"
              disabled={busy}
              onClick={handlePreviewIvi}
              className="inline-flex items-center gap-1 rounded border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-800 hover:bg-blue-100 whitespace-nowrap shrink-0 dark:border-blue-800/70 dark:bg-blue-950/50 dark:text-blue-300 dark:hover:bg-blue-900/60"
            >
              <Bot className="w-3 h-3" />
              Testar clareza Ivi
            </button>
          </div>

          {iviCheckMsg && (
            <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-slate-800 dark:border-blue-800/70 dark:bg-blue-950/50 dark:text-slate-100">
              <span className="font-semibold text-blue-900 dark:text-blue-300">Ivi IA:</span> {iviCheckMsg}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-700">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-lg border border-slate-200 px-4 py-2 font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={busy || pendingSubtasks.length > 0}
              className="rounded-lg bg-emerald-700 px-4 py-2 font-semibold text-white hover:bg-emerald-800 disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              {busy ? 'Concluindo...' : 'Concluir Tarefa'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// =============================================================================
// 5. MODAL: CONFIGURAR COLUNAS DO QUADRO KANBAN (§6.4)
// =============================================================================
interface TaskColumnsModalProps {
  open: boolean;
  columns: CoordinatorTaskColumn[];
  onClose: () => void;
  onSaved: (msg: string) => Promise<void> | void;
}

const PRESET_COLORS = ['#64748b', '#2563eb', '#d97706', '#C4A484', '#16a34a', '#9333ea', '#dc2626'];

export const TaskColumnsModal: React.FC<TaskColumnsModalProps> = ({
  open,
  columns,
  onClose,
  onSaved,
}) => {
  const [draftCols, setDraftCols] = useState<Array<{ id?: number; title: string; color: string; isFinal: boolean }>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setDraftCols(
      columns.map((c) => ({
        id: c.id,
        title: c.title,
        color: c.color || '#64748b',
        isFinal: Boolean(c.isFinal),
      }))
    );
    setError('');
  }, [open, columns]);

  if (!open) return null;

  const moveCol = (idx: number, delta: -1 | 1) => {
    const target = idx + delta;
    if (target < 0 || target >= draftCols.length) return;
    setDraftCols((prev) => {
      const next = [...prev];
      const [item] = next.splice(idx, 1);
      next.splice(target, 0, item);
      return next;
    });
  };

  const handleSave = async () => {
    const clean = draftCols.filter((c) => c.title.trim().length > 0);
    if (clean.length === 0) {
      setError('Mantenha pelo menos 1 coluna nomeada.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await apiFetch('/api/collection/coordinator/tasks/columns', {
        method: 'PUT',
        body: JSON.stringify({ columns: clean }),
      });
      await onSaved('Colunas do quadro Kanban atualizadas.');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar colunas.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4 dark:bg-slate-950/80">
      <div className="bg-white rounded-xl border border-slate-200 shadow-2xl w-full max-w-xl max-h-[88vh] flex flex-col overflow-hidden dark:bg-slate-900 dark:border-slate-700">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/70">
          <div>
            <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">Configurar Colunas do Quadro</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Personalize nomes, cores, ordem e quais colunas representam encerramento final.
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-200 dark:text-slate-400 dark:hover:bg-slate-700">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-3 text-xs">
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-800 dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300">{error}</div>
          )}

          {draftCols.map((col, idx) => (
            <div
              key={`${col.id || 'new'}-${idx}`}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 p-2.5 bg-white dark:border-slate-700 dark:bg-slate-900"
            >
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={idx === 0}
                  onClick={() => moveCol(idx, -1)}
                  className="p-1 rounded border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-30 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                  title="Mover para cima"
                >
                  <ArrowUp className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  disabled={idx === draftCols.length - 1}
                  onClick={() => moveCol(idx, 1)}
                  className="p-1 rounded border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-30 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                  title="Mover para baixo"
                >
                  <ArrowDown className="w-3.5 h-3.5" />
                </button>
              </div>

              <input
                type="text"
                value={col.title}
                onChange={(e) =>
                  setDraftCols((prev) =>
                    prev.map((item, i) => (i === idx ? { ...item, title: e.target.value } : item))
                  )
                }
                placeholder="Nome da coluna"
                className="flex-1 min-w-[140px] rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-900 focus:outline-none focus:border-blue-500 dark:border-slate-700 dark:text-slate-100"
              />

              <div className="flex items-center gap-1">
                {PRESET_COLORS.map((hex) => (
                  <button
                    key={hex}
                    type="button"
                    onClick={() =>
                      setDraftCols((prev) =>
                        prev.map((item, i) => (i === idx ? { ...item, color: hex } : item))
                      )
                    }
                    className={`w-4 h-4 rounded border ${
                      col.color === hex ? 'border-slate-900 scale-110 dark:border-emerald-500' : 'border-slate-300 dark:border-slate-600'
                    }`}
                    style={{ backgroundColor: hex }}
                    title={hex}
                  />
                ))}
              </div>

              <label className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-700 cursor-pointer whitespace-nowrap shrink-0 dark:text-slate-200">
                <input
                  type="checkbox"
                  checked={col.isFinal}
                  onChange={(e) =>
                    setDraftCols((prev) =>
                      prev.map((item, i) => (i === idx ? { ...item, isFinal: e.target.checked } : item))
                    )
                  }
                  className="rounded border-slate-300 text-emerald-600 dark:border-slate-600 dark:text-emerald-400"
                />
                Final
              </label>

              <button
                type="button"
                disabled={draftCols.length <= 1}
                onClick={() => setDraftCols((prev) => prev.filter((_, i) => i !== idx))}
                className="p-1.5 rounded border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-30 dark:border-red-800/70 dark:text-red-400 dark:hover:bg-red-950/60"
                title="Remover coluna"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}

          <button
            type="button"
            onClick={() =>
              setDraftCols((prev) => [
                ...prev,
                { title: `Etapa ${prev.length + 1}`, color: '#64748b', isFinal: false },
              ])
            }
            className="w-full rounded-lg border border-dashed border-slate-300 py-2 text-xs font-semibold text-slate-600 hover:border-slate-400 hover:text-slate-900 inline-flex items-center justify-center gap-1 dark:border-slate-600 dark:text-slate-300 dark:hover:text-white"
          >
            <Plus className="w-3.5 h-3.5" />
            Adicionar Coluna
          </button>
        </div>

        <div className="flex justify-end gap-2 px-5 py-3.5 border-t border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/70">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={handleSave}
            className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60 dark:bg-emerald-600 dark:hover:bg-emerald-500"
          >
            {busy ? 'Salvando...' : 'Salvar Colunas'}
          </button>
        </div>
      </div>
    </div>
  );
};

// =============================================================================
// 6. MODAL: CONFIRMAÇÃO DE EXCLUSÃO SEGURA (SUBSTITUI browser confirm)
// =============================================================================
interface ConfirmTaskDeleteModalProps {
  open: boolean;
  title: string;
  message: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => Promise<void> | void;
}

export const ConfirmTaskDeleteModal: React.FC<ConfirmTaskDeleteModalProps> = ({
  open,
  title,
  message,
  busy,
  onCancel,
  onConfirm,
}) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[80] bg-slate-900/50 flex items-center justify-center p-4 dark:bg-slate-950/80">
      <div className="bg-white rounded-xl border border-slate-200 shadow-2xl w-full max-w-md overflow-hidden dark:bg-slate-900 dark:border-slate-700">
        <div className="px-5 py-4 border-b border-slate-200 bg-red-50/50 flex items-center gap-2 dark:border-slate-700 dark:bg-red-950/50">
          <ShieldAlert className="w-4 h-4 text-red-600 shrink-0 dark:text-red-400" />
          <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">{title}</h3>
        </div>
        <div className="p-5 space-y-4 text-xs text-slate-700 dark:text-slate-200">
          <p>{message}</p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="rounded-lg border border-slate-200 px-4 py-2 font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => void onConfirm()}
              disabled={busy}
              className="rounded-lg bg-red-600 px-4 py-2 font-semibold text-white hover:bg-red-700 disabled:opacity-60"
            >
              {busy ? 'Excluindo...' : 'Confirmar Exclusão'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// =============================================================================
// 6B. MODAL: PAUSAR OU CANCELAR TAREFA COM MOTIVO
// =============================================================================
interface TaskStatusTransitionModalProps {
  task: CoordinatorTaskItem | null;
  mode: 'PAUSADO' | 'CANCELADO' | null;
  onCancel: () => void;
  onConfirm: (reason: string) => Promise<void> | void;
}

const TASK_PAUSE_CHIPS = [
  'Aguardando retorno do cliente',
  'Dependência de outro setor',
  'Negociação suspensa temporariamente',
  'Reunião / Replanejamento',
];

const TASK_CANCEL_CHIPS = [
  'Título quitado / Não aplicável',
  'Tarefa duplicada',
  'Desistência / Cancelamento contratual',
  'Substituída por outra demanda',
];

export const TaskStatusTransitionModal: React.FC<TaskStatusTransitionModalProps> = ({
  task,
  mode,
  onCancel,
  onConfirm,
}) => {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (task && mode) {
      setReason('');
      setError('');
    }
  }, [task?.id, mode]);

  if (!task || !mode) return null;

  const isCancel = mode === 'CANCELADO';
  const chips = isCancel ? TASK_CANCEL_CHIPS : TASK_PAUSE_CHIPS;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) {
      setError(
        isCancel
          ? 'Informe o motivo do cancelamento da tarefa.'
          : 'Informe o motivo para pausar a tarefa.'
      );
      return;
    }
    setBusy(true);
    setError('');
    try {
      await onConfirm(reason.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao atualizar status da tarefa.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[75] bg-slate-900/50 flex items-center justify-center p-4 dark:bg-slate-950/80">
      <div className="bg-white rounded-xl border border-slate-200 shadow-2xl w-full max-w-md overflow-hidden dark:bg-slate-900 dark:border-slate-700">
        <div
          className={`flex items-center justify-between px-5 py-3.5 border-b border-slate-200 dark:border-slate-700 ${
            isCancel ? 'bg-red-50/70 dark:bg-red-950/50' : 'bg-amber-50/70 dark:bg-amber-950/50'
          }`}
        >
          <div>
            <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
              {isCancel ? 'Cancelar Tarefa' : 'Pausar Tarefa'}
            </h3>
            <p className="text-[11px] text-slate-600 truncate max-w-xs dark:text-slate-300">{task.title}</p>
          </div>
          <button type="button" onClick={onCancel} className="p-1 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-3 text-xs">
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-800 dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300">{error}</div>
          )}
          <div className="flex flex-wrap gap-1.5">
            {chips.map((chip) => (
              <button
                key={chip}
                type="button"
                onClick={() => setReason(chip)}
                className="rounded border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                {chip}
              </button>
            ))}
          </div>
          <textarea
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={
              isCancel
                ? 'Descreva o motivo do cancelamento desta tarefa...'
                : 'Descreva o motivo pelo qual esta tarefa será pausada...'
            }
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-blue-500 dark:border-slate-700 dark:text-slate-100"
            autoFocus
          />
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-lg border border-slate-200 px-3.5 py-2 font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Voltar
            </button>
            <button
              type="submit"
              disabled={busy}
              className={`rounded-lg px-3.5 py-2 font-semibold text-white disabled:opacity-60 inline-flex items-center gap-1.5 ${
                isCancel ? 'bg-red-600 hover:bg-red-700' : 'bg-amber-600 hover:bg-amber-700'
              }`}
            >
              {isCancel ? <Ban className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
              {busy
                ? 'Salvando...'
                : isCancel
                ? 'Confirmar Cancelamento'
                : 'Confirmar Pausa'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// =============================================================================
// 7. MODAL: DETALHES DA TAREFA (EDIÇÃO, SUBTAREFAS, CRONÔMETROS, ANEXOS BUCKET) (§5)
// =============================================================================
interface TaskDetailModalProps {
  task: CoordinatorTaskItem | null;
  columns: CoordinatorTaskColumn[];
  clients: Client[];
  collaborators: CollaboratorItem[];
  coordinators: CoordinatorEligibleUser[];
  nowMs: number;
  onClose: () => void;
  onUpdated: (msg?: string) => Promise<void> | void;
  onRequestClosure: (task: CoordinatorTaskItem, targetColId: number | null) => void;
  onRequestPauseTask: (task: CoordinatorTaskItem) => void;
  onRequestStatusTransition?: (task: CoordinatorTaskItem, mode: 'PAUSADO' | 'CANCELADO') => void;
  onRequestResumeTask?: (task: CoordinatorTaskItem) => Promise<void> | void;
  onRequestShare: (task: CoordinatorTaskItem) => void;
  onRequestDelete: (task: CoordinatorTaskItem) => void;
  onOpenClient?: (clientId: number) => void;
}

export const TaskDetailModal: React.FC<TaskDetailModalProps> = ({
  task,
  columns,
  clients,
  collaborators,
  nowMs,
  onClose,
  onUpdated,
  onRequestClosure,
  onRequestPauseTask,
  onRequestStatusTransition,
  onRequestResumeTask,
  onRequestShare,
  onRequestDelete,
  onOpenClient,
}) => {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [clientId, setClientId] = useState('');
  const [collaboratorId, setCollaboratorId] = useState('');
  const [projectLabel, setProjectLabel] = useState('');
  const [criticality, setCriticality] = useState('medio');
  const [priority, setPriority] = useState('media');
  const [dueAt, setDueAt] = useState('');
  const [estimatedMinutes, setEstimatedMinutes] = useState('');
  const [description, setDescription] = useState('');
  const [blockingReason, setBlockingReason] = useState('');
  const [occurrenceNotes, setOccurrenceNotes] = useState('');
  const [solutionNotes, setSolutionNotes] = useState('');

  // Subtarefa inline form
  const [showNewSub, setShowNewSub] = useState(false);
  const [subTitle, setSubTitle] = useState('');
  const [subDesc, setSubDesc] = useState('');
  const [subCrit, setSubCrit] = useState('medio');
  const [subEst, setSubEst] = useState('');
  const [subRequiresPred, setSubRequiresPred] = useState(false);
  const [editingSubId, setEditingSubId] = useState<number | null>(null);
  const [editSubTitle, setEditSubTitle] = useState('');
  const [editSubDesc, setEditSubDesc] = useState('');
  const [subPauseTarget, setSubPauseTarget] = useState<CoordinatorTaskSubtask | null>(null);

  // Anexos & Preview modal
  const [uploadingFile, setUploadingFile] = useState(false);
  const [previewAtt, setPreviewAtt] = useState<{ att: CoordinatorTaskAttachment; url: string } | null>(null);
  const [taskAuditOpen, setTaskAuditOpen] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!task) return;
    setEditing(false);
    setTaskAuditOpen(false);
    setTitle(task.title);
    setClientId(task.clientId ? String(task.clientId) : '');
    setCollaboratorId(task.collaboratorId ? String(task.collaboratorId) : '');
    setProjectLabel(task.projectLabel || '');
    setCriticality(task.criticality || 'medio');
    setPriority(task.priority || 'media');
    setDueAt(toDatetimeLocalValue(task.dueAt));
    setEstimatedMinutes(task.estimatedMinutes ? String(task.estimatedMinutes) : '');
    setDescription(task.description || '');
    setBlockingReason(task.blockingReason || '');
    setOccurrenceNotes(task.occurrenceNotes || '');
    setSolutionNotes(task.solutionNotes || '');
    setShowNewSub(false);
    setEditingSubId(null);
    setError('');
  }, [task]);

  useEffect(() => {
    return () => {
      if (previewAtt?.url) URL.revokeObjectURL(previewAtt.url);
    };
  }, [previewAtt]);

  if (!task) return null;

  const canEdit = task.mySharePermission !== 'view';
  const liveSec = computeLiveElapsedSeconds(task.timerAccumulatedSeconds, task.timerRunningSince, nowMs);
  const critMeta = getCriticalityMeta(task.criticality);

  const handleSaveEdit = async () => {
    if (!title.trim()) {
      setError('O título é obrigatório.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await apiFetch(`/api/collection/coordinator/tasks/${task.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          title: title.trim(),
          clientId: clientId ? Number(clientId) : null,
          collaboratorId: collaboratorId ? Number(collaboratorId) : null,
          projectLabel: projectLabel.trim(),
          criticality,
          priority,
          dueAt: dueAt ? new Date(dueAt).toISOString() : null,
          estimatedMinutes: estimatedMinutes ? Number(estimatedMinutes) : null,
          description,
          blockingReason,
          occurrenceNotes,
          solutionNotes,
        }),
      });
      setEditing(false);
      await onUpdated('Dados da tarefa salvos.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao atualizar tarefa.');
    } finally {
      setBusy(false);
    }
  };

  const handleHeaderStatusChange = async (newColIdStr: string) => {
    const colId = Number(newColIdStr);
    const col = columns.find((c) => c.id === colId);
    if (!col) return;
    if (col.isFinal) {
      onRequestClosure(task, col.id);
      return;
    }
    setBusy(true);
    setError('');
    try {
      await apiFetch(`/api/collection/coordinator/tasks/${task.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ statusColumnId: col.id, isCompleted: false }),
      });
      await onUpdated(`Status alterado para ${col.title}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao alterar status.');
    } finally {
      setBusy(false);
    }
  };

  const handleStartTaskTimer = async () => {
    setBusy(true);
    setError('');
    try {
      await apiFetch(`/api/collection/coordinator/tasks/${task.id}/timer`, {
        method: 'POST',
        body: JSON.stringify({ action: 'start' }),
      });
      await onUpdated('Cronômetro iniciado.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao iniciar cronômetro.');
    } finally {
      setBusy(false);
    }
  };

  const handleCreateSubtask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subTitle.trim()) {
      setError('Informe o título da subtarefa.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await apiFetch(`/api/collection/coordinator/tasks/${task.id}/subtasks`, {
        method: 'POST',
        body: JSON.stringify({
          title: subTitle.trim(),
          description: subDesc.trim(),
          criticality: subCrit,
          estimatedMinutes: subEst ? Number(subEst) : null,
          requiresPredecessor: subRequiresPred,
        }),
      });
      setSubTitle('');
      setSubDesc('');
      setSubEst('');
      setSubRequiresPred(false);
      setShowNewSub(false);
      await onUpdated('Subtarefa adicionada.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao criar subtarefa.');
    } finally {
      setBusy(false);
    }
  };

  const handleToggleSubtask = async (sub: CoordinatorTaskSubtask) => {
    const nextStatus = sub.status === 'CONCLUIDO' ? 'PENDENTE' : 'CONCLUIDO';
    setBusy(true);
    setError('');
    try {
      await apiFetch(`/api/collection/coordinator/tasks/${task.id}/subtasks/${sub.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: nextStatus }),
      });
      await onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao atualizar subtarefa.');
    } finally {
      setBusy(false);
    }
  };

  const handleSaveSubEdit = async (subId: number) => {
    if (!editSubTitle.trim()) return;
    setBusy(true);
    setError('');
    try {
      await apiFetch(`/api/collection/coordinator/tasks/${task.id}/subtasks/${subId}`, {
        method: 'PATCH',
        body: JSON.stringify({ title: editSubTitle.trim(), description: editSubDesc.trim() }),
      });
      setEditingSubId(null);
      await onUpdated('Subtarefa atualizada.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao editar subtarefa.');
    } finally {
      setBusy(false);
    }
  };

  const handleSubTimerStart = async (subId: number) => {
    setBusy(true);
    setError('');
    try {
      await apiFetch(`/api/collection/coordinator/tasks/${task.id}/subtasks/${subId}/timer`, {
        method: 'POST',
        body: JSON.stringify({ action: 'start' }),
      });
      await onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao iniciar cronômetro da subtarefa.');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteSubtask = async (subId: number) => {
    setBusy(true);
    setError('');
    try {
      await apiFetch(`/api/collection/coordinator/tasks/${task.id}/subtasks/${subId}`, {
        method: 'DELETE',
      });
      await onUpdated('Subtarefa removida.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao remover subtarefa.');
    } finally {
      setBusy(false);
    }
  };

  const handleUploadAttachment = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadingFile(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      await apiFetch(`/api/collection/coordinator/tasks/${task.id}/attachments`, {
        method: 'POST',
        body: fd,
      });
      await onUpdated(`Anexo "${file.name}" armazenado no bucketdainvicta.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao anexar arquivo.');
    } finally {
      setUploadingFile(false);
    }
  };

  const handlePreviewAttachment = async (att: CoordinatorTaskAttachment) => {
    setError('');
    try {
      const token = getAuthToken();
      const resp = await fetch(`/api/collection/coordinator/tasks/${task.id}/attachments/${att.id}/file`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!resp.ok) throw new Error('Falha ao carregar arquivo do bucket.');
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      setPreviewAtt({ att, url });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao visualizar anexo.');
    }
  };

  const handleDownloadAttachment = async (att: CoordinatorTaskAttachment) => {
    try {
      const token = getAuthToken();
      const resp = await fetch(`/api/collection/coordinator/tasks/${task.id}/attachments/${att.id}/file`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!resp.ok) throw new Error('Falha ao baixar arquivo.');
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = att.fileName;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro no download do anexo.');
    }
  };

  const handleDeleteAttachment = async (attId: number) => {
    setBusy(true);
    setError('');
    try {
      await apiFetch(`/api/collection/coordinator/tasks/${task.id}/attachments/${attId}`, {
        method: 'DELETE',
      });
      await onUpdated('Anexo removido.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao remover anexo.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-[1px] flex items-center justify-center p-4 dark:bg-slate-950/80">
      <div className="bg-white rounded-xl border border-slate-200 shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden dark:bg-slate-900 dark:border-slate-700">
        {/* Header (§5.1) */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/70">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium text-slate-500 dark:text-slate-400">
              <span className="font-mono text-slate-700 font-semibold dark:text-slate-200">#{task.id}</span>
              <span>·</span>
              <span>Proprietário: <strong className="text-slate-800 dark:text-slate-100">{task.ownerName}</strong></span>
              {!task.isOwner && (
                <>
                  <span>·</span>
                  <span className="text-blue-700 font-semibold dark:text-blue-300">
                    Compartilhada ({task.mySharePermission === 'view' ? 'Leitura' : 'Edição'})
                  </span>
                </>
              )}
              <span>·</span>
              <span className={`px-1.5 py-0.5 rounded border text-[11px] font-semibold ${critMeta.borderClass} ${critMeta.textClass}`}>
                {critMeta.label}
              </span>
              <span>·</span>
              <span className={`px-1.5 py-0.5 rounded border text-[11px] font-semibold ${getTaskStatusMeta(task).badgeClass}`}>
                {getTaskStatusMeta(task).label}
              </span>
            </div>
            <h2 className="mt-1 font-display text-base font-bold text-slate-900 truncate dark:text-slate-100">
              {task.title}
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 shrink-0">
            <select
              disabled={!canEdit || busy}
              value={task.statusColumnId ? String(task.statusColumnId) : ''}
              onChange={(e) => void handleHeaderStatusChange(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-800 focus:outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              {!task.statusColumnId && (
                <option value="">{getTaskStatusMeta(task).label}</option>
              )}
              {columns.map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.title}
                </option>
              ))}
            </select>

            {canEdit && getTaskStatusBucket(task) === 'PENDENTE' && (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onRequestClosure(task, null)}
                  className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 whitespace-nowrap shrink-0 dark:border-emerald-800/70 dark:bg-emerald-950/50 dark:text-emerald-300 dark:hover:bg-emerald-900/60"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Concluir
                </button>
                {onRequestStatusTransition && (
                  <>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onRequestStatusTransition(task, 'PAUSADO')}
                      className="inline-flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100 whitespace-nowrap shrink-0 dark:border-amber-800/70 dark:bg-amber-950/50 dark:text-amber-300 dark:hover:bg-amber-900/60"
                    >
                      <Pause className="w-3.5 h-3.5" />
                      Pausar
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onRequestStatusTransition(task, 'CANCELADO')}
                      className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100 whitespace-nowrap shrink-0 dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300 dark:hover:bg-red-900/60"
                    >
                      <Ban className="w-3.5 h-3.5" />
                      Cancelar
                    </button>
                  </>
                )}
              </>
            )}

            {canEdit && getTaskStatusBucket(task) !== 'PENDENTE' && onRequestResumeTask && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void onRequestResumeTask(task)}
                className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-xs font-semibold text-blue-800 hover:bg-blue-100 whitespace-nowrap shrink-0 dark:border-blue-800/70 dark:bg-blue-950/50 dark:text-blue-300 dark:hover:bg-blue-900/60"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Retomar p/ Pendente
              </button>
            )}

            {task.isOwner && (
              <button
                type="button"
                onClick={() => onRequestShare(task)}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <Share2 className="w-3.5 h-3.5" />
                Compartilhar ({task.shares.length})
              </button>
            )}

            {canEdit && (
              <button
                type="button"
                onClick={() => setEditing((v) => !v)}
                className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-semibold whitespace-nowrap shrink-0 ${
                  editing
                    ? 'border-slate-900 bg-slate-900 text-white dark:border-emerald-500 dark:bg-emerald-600'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800'
                }`}
              >
                <Edit3 className="w-3.5 h-3.5" />
                {editing ? 'Cancelar Edição' : 'Editar'}
              </button>
            )}

            <button
              type="button"
              onClick={() => setTaskAuditOpen(true)}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              title="Auditoria da Tarefa"
            >
              <History className="w-3.5 h-3.5" />
              Auditoria
            </button>

            {task.isOwner && (
              <button
                type="button"
                onClick={() => onRequestDelete(task)}
                className="p-1.5 rounded-lg border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300 dark:hover:bg-red-900/60"
                title="Excluir tarefa"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-200 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto space-y-5 text-xs flex-1">
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-800 font-medium dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300">
              {error}
            </div>
          )}

          {/* Barra do Cronômetro + Bloqueio (§5.2 & §6.2) */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 flex flex-wrap items-center justify-between gap-3 dark:border-slate-700 dark:bg-slate-800/60">
            <div className="flex items-center gap-4">
              <div>
                <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Tempo Registrado</p>
                <p className="font-mono text-lg font-bold text-slate-900 tabular-nums dark:text-slate-100">
                  {formatStopwatchHHMMSS(liveSec)}
                </p>
              </div>
              {task.derivedEstimatedMinutes && (
                <div>
                  <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Estimativa</p>
                  <p className="font-mono text-sm font-semibold text-slate-700 tabular-nums dark:text-slate-200">
                    {task.derivedEstimatedMinutes} min
                  </p>
                </div>
              )}
              {task.clientName && (
                <div>
                  <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Cliente Vinculado</p>
                  <button
                    type="button"
                    onClick={() => task.clientId && onOpenClient?.(task.clientId)}
                    className="font-semibold text-blue-700 hover:underline text-left dark:text-blue-300"
                  >
                    {task.clientName}
                  </button>
                </div>
              )}
            </div>

            {canEdit && !task.isCompleted && (
              <div className="flex items-center gap-2">
                {task.timerRunningSince ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onRequestPauseTask(task)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-2 text-xs font-semibold text-white hover:bg-amber-700 whitespace-nowrap shrink-0"
                  >
                    <Pause className="w-3.5 h-3.5" />
                    Pausar Cronômetro
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleStartTaskTimer()}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 whitespace-nowrap shrink-0 dark:bg-emerald-600 dark:hover:bg-emerald-500"
                  >
                    <Play className="w-3.5 h-3.5" />
                    Iniciar Cronômetro
                  </button>
                )}
              </div>
            )}
          </div>

          {task.blockingReason && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-red-900 flex items-center gap-2 dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300">
              <AlertTriangle className="w-4 h-4 text-red-700 shrink-0 dark:text-red-300" />
              <span>
                <strong>Motivo de Bloqueio Ativo:</strong> {task.blockingReason}
              </span>
            </div>
          )}

          {/* Edição ou Visualização de Campos (§5.2) */}
          {editing ? (
            <div className="rounded-xl border border-slate-200 p-4 space-y-3 bg-white dark:border-slate-700 dark:bg-slate-900">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="md:col-span-2">
                  <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Título</label>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900 dark:border-slate-700 dark:text-slate-100 dark:bg-slate-950"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Cliente</label>
                  <select
                    value={clientId}
                    onChange={(e) => setClientId(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 bg-white text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  >
                    <option value="">Sem cliente</option>
                    {clients.map((c) => (
                      <option key={c.id} value={String(c.id)}>
                        {c.fullName}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Colaborador</label>
                  <select
                    value={collaboratorId}
                    onChange={(e) => setCollaboratorId(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 bg-white text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  >
                    <option value="">Coordenação direta</option>
                    {collaborators.map((c) => (
                      <option key={c.id} value={String(c.id)}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Frente / Projeto</label>
                  <input
                    type="text"
                    value={projectLabel}
                    onChange={(e) => setProjectLabel(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900 dark:border-slate-700 dark:text-slate-100 dark:bg-slate-950"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Criticidade</label>
                    <select
                      value={criticality}
                      onChange={(e) => setCriticality(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 px-2 py-2 bg-white dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    >
                      {CRITICALITY_OPTIONS.map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Prioridade</label>
                    <select
                      value={priority}
                      onChange={(e) => setPriority(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 px-2 py-2 bg-white dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    >
                      {PRIORITY_OPTIONS.map((p) => (
                        <option key={p.value} value={p.value}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Prazo</label>
                  <input
                    type="datetime-local"
                    value={dueAt}
                    onChange={(e) => setDueAt(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Tempo Estimado (min)</label>
                  <input
                    type="number"
                    min={1}
                    value={estimatedMinutes}
                    onChange={(e) => setEstimatedMinutes(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Motivo de Bloqueio (impede avanço/cronômetro se preenchido)</label>
                  <input
                    type="text"
                    value={blockingReason}
                    onChange={(e) => setBlockingReason(e.target.value)}
                    placeholder="Deixe em branco para liberar o fluxo"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900 dark:border-slate-700 dark:text-slate-100"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Descrição</label>
                  <textarea
                    rows={3}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900 dark:border-slate-700 dark:text-slate-100 dark:bg-slate-950"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Ocorrência</label>
                  <textarea
                    rows={2}
                    value={occurrenceNotes}
                    onChange={(e) => setOccurrenceNotes(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900 dark:border-slate-700 dark:text-slate-100 dark:bg-slate-950"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Solução Adotada</label>
                  <textarea
                    rows={2}
                    value={solutionNotes}
                    onChange={(e) => setSolutionNotes(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900 dark:border-slate-700 dark:text-slate-100 dark:bg-slate-950"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  className="rounded-lg border border-slate-200 px-3.5 py-2 font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleSaveEdit()}
                  className="rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white hover:bg-slate-800 disabled:opacity-60 dark:bg-emerald-600 dark:hover:bg-emerald-500"
                >
                  {busy ? 'Salvando...' : 'Salvar Alterações'}
                </button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-2 space-y-3">
                <div className="rounded-xl border border-slate-200 p-3.5 bg-white dark:border-slate-700 dark:bg-slate-900">
                  <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1 dark:text-slate-400">
                    Descrição
                  </p>
                  <p className="text-slate-800 whitespace-pre-wrap dark:text-slate-100">
                    {task.description || 'Nenhuma descrição informada.'}
                  </p>
                </div>

                {(task.occurrenceNotes || task.solutionNotes) && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="rounded-xl border border-slate-200 p-3 bg-white dark:border-slate-700 dark:bg-slate-900">
                      <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1 dark:text-slate-400">
                        Ocorrência
                      </p>
                      <p className="text-slate-800 whitespace-pre-wrap dark:text-slate-100">{task.occurrenceNotes || '—'}</p>
                    </div>
                    <div className="rounded-xl border border-slate-200 p-3 bg-white dark:border-slate-700 dark:bg-slate-900">
                      <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1 dark:text-slate-400">
                        Solução Adotada
                      </p>
                      <p className="text-slate-800 whitespace-pre-wrap dark:text-slate-100">{task.solutionNotes || '—'}</p>
                    </div>
                  </div>
                )}

                {task.iviReviewNote && (
                  <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-3 flex items-start gap-2 dark:border-blue-800/70 dark:bg-blue-950/50">
                    <Bot className="w-4 h-4 text-blue-700 shrink-0 mt-0.5 dark:text-blue-300" />
                    <div>
                      <p className="font-semibold text-blue-900 dark:text-blue-300">Revisão Ivi IA</p>
                      <p className="text-slate-700 mt-0.5 dark:text-slate-200">{task.iviReviewNote}</p>
                    </div>
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-slate-200 p-3.5 bg-slate-50/60 space-y-2 dark:border-slate-700 dark:bg-slate-800/60">
                <div className="flex justify-between">
                  <span className="text-slate-500 dark:text-slate-400">Prioridade</span>
                  <span className="font-semibold text-slate-900 dark:text-slate-100">{getPriorityLabel(task.priority)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 dark:text-slate-400">Frente / Projeto</span>
                  <span className="font-semibold text-slate-900 dark:text-slate-100">{task.projectLabel || '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 dark:text-slate-400">Colaborador</span>
                  <span className="font-semibold text-slate-900 dark:text-slate-100">{task.collaboratorName || 'Coordenação'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 dark:text-slate-400">Prazo</span>
                  <span className="font-mono font-semibold text-slate-900 tabular-nums dark:text-slate-100">
                    {task.dueAt ? formatDateTimeBR(task.dueAt) : 'Sem prazo'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 dark:text-slate-400">Origem</span>
                  <span className="font-semibold text-slate-900 uppercase dark:text-slate-100">{task.originType || 'direta'}</span>
                </div>
              </div>
            </div>
          )}

          {/* SUBTAREFAS (§5.3) */}
          <div className="rounded-xl border border-slate-200 p-4 space-y-3 bg-white dark:border-slate-700 dark:bg-slate-900">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                  Subtarefas ({task.subtasks.filter((s) => s.status === 'CONCLUIDO').length}/{task.subtasks.length})
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Cronômetros individuais e precedência sequencial entre etapas.
                </p>
              </div>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => setShowNewSub((v) => !v)}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 font-semibold text-slate-800 hover:bg-slate-100 whitespace-nowrap shrink-0 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-100 dark:hover:bg-slate-800"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Adicionar Subtarefa
                </button>
              )}
            </div>

            {showNewSub && (
              <form onSubmit={handleCreateSubtask} className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2.5 dark:border-slate-700 dark:bg-slate-800/70">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  <input
                    type="text"
                    value={subTitle}
                    onChange={(e) => setSubTitle(e.target.value)}
                    placeholder="Título da subtarefa *"
                    className="md:col-span-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  />
                  <input
                    type="number"
                    min={1}
                    value={subEst}
                    onChange={(e) => setSubEst(e.target.value)}
                    placeholder="Estimativa (min)"
                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-mono dark:border-slate-700 dark:bg-slate-900"
                  />
                </div>
                <textarea
                  rows={2}
                  value={subDesc}
                  onChange={(e) => setSubDesc(e.target.value)}
                  placeholder="Descrição operacional da subtarefa..."
                  className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900"
                />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <select
                      value={subCrit}
                      onChange={(e) => setSubCrit(e.target.value)}
                      className="rounded border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    >
                      {CRITICALITY_OPTIONS.map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                    <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer dark:text-slate-200">
                      <input
                        type="checkbox"
                        checked={subRequiresPred}
                        onChange={(e) => setSubRequiresPred(e.target.checked)}
                        className="rounded border-slate-300 dark:border-slate-600"
                      />
                      Requer conclusão da subtarefa anterior
                    </label>
                  </div>
                  <button
                    type="submit"
                    disabled={busy}
                    className="rounded-lg bg-slate-900 px-3 py-1.5 font-semibold text-white hover:bg-slate-800 dark:bg-emerald-600 dark:hover:bg-emerald-500"
                  >
                    Salvar Subtarefa
                  </button>
                </div>
              </form>
            )}

            {task.subtasks.length === 0 ? (
              <p className="text-slate-400 dark:text-slate-400">Nenhuma subtarefa cadastrada.</p>
            ) : (
              <div className="space-y-2">
                {task.subtasks.map((sub, idx) => {
                  const locked =
                    sub.requiresPredecessor && idx > 0 && task.subtasks[idx - 1].status !== 'CONCLUIDO';
                  const subSec = computeLiveElapsedSeconds(sub.timerAccumulatedSeconds, sub.timerRunningSince, nowMs);
                  const isDone = sub.status === 'CONCLUIDO';
                  return (
                    <div
                      key={sub.id}
                      className={`rounded-lg border p-3 ${
                        isDone ? 'border-emerald-200 bg-emerald-50/40 dark:border-emerald-800/70 dark:bg-emerald-950/50' : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900'
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <button
                            type="button"
                            disabled={!canEdit || busy || locked}
                            onClick={() => void handleToggleSubtask(sub)}
                            title={locked ? 'Aguardando conclusão da subtarefa anterior' : 'Alternar conclusão'}
                            className={`w-5 h-5 rounded border flex items-center justify-center shrink-0 ${
                              isDone
                                ? 'bg-emerald-600 border-emerald-600 text-white'
                                : locked
                                ? 'bg-slate-100 border-slate-300 text-slate-400 cursor-not-allowed dark:bg-slate-800 dark:border-slate-600 dark:text-slate-400'
                                : 'bg-white border-slate-300 text-transparent hover:border-slate-500 dark:bg-slate-900 dark:border-slate-600'
                            }`}
                          >
                            {locked ? <Lock className="w-3 h-3 text-slate-500 dark:text-slate-400" /> : <Check className="w-3.5 h-3.5" />}
                          </button>

                          {editingSubId === sub.id ? (
                            <div className="flex-1 flex flex-wrap gap-2">
                              <input
                                type="text"
                                value={editSubTitle}
                                onChange={(e) => setEditSubTitle(e.target.value)}
                                className="flex-1 rounded border border-slate-200 px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                              />
                              <input
                                type="text"
                                value={editSubDesc}
                                onChange={(e) => setEditSubDesc(e.target.value)}
                                placeholder="Descrição"
                                className="flex-1 rounded border border-slate-200 px-2 py-1 text-xs dark:border-slate-700"
                              />
                              <button
                                type="button"
                                onClick={() => void handleSaveSubEdit(sub.id)}
                                className="rounded bg-slate-900 px-2.5 py-1 text-white font-semibold dark:bg-emerald-600"
                              >
                                OK
                              </button>
                            </div>
                          ) : (
                            <div className="min-w-0">
                              <p className={`font-semibold ${isDone ? 'line-through text-slate-500 dark:text-slate-400' : 'text-slate-900 dark:text-slate-100'}`}>
                                {sub.title}
                              </p>
                              {sub.description && (
                                <p className="text-[11px] text-slate-500 truncate dark:text-slate-400">{sub.description}</p>
                              )}
                            </div>
                          )}
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <span className="font-mono text-[11px] text-slate-700 tabular-nums dark:text-slate-200">
                            {formatStopwatchHHMMSS(subSec)}
                          </span>
                          {canEdit && !isDone && (
                            sub.timerRunningSince ? (
                              <button
                                type="button"
                                onClick={() => setSubPauseTarget(sub)}
                                className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-800 hover:bg-amber-100 dark:border-amber-800/70 dark:bg-amber-950/50 dark:text-amber-300 dark:hover:bg-amber-900/60"
                              >
                                Pausar
                              </button>
                            ) : (
                              <button
                                type="button"
                                disabled={locked}
                                onClick={() => void handleSubTimerStart(sub.id)}
                                className="rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                              >
                                Iniciar
                              </button>
                            )
                          )}
                          {canEdit && (
                            <>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingSubId(sub.id);
                                  setEditSubTitle(sub.title);
                                  setEditSubDesc(sub.description || '');
                                }}
                                className="p-1 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
                                title="Editar subtarefa"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleDeleteSubtask(sub.id)}
                                className="p-1 text-red-500 hover:text-red-700"
                                title="Excluir subtarefa"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ANEXOS NO BUCKETDAINVICTA */}
          <div className="rounded-xl border border-slate-200 p-4 space-y-3 bg-white dark:border-slate-700 dark:bg-slate-900">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                  Anexos da Tarefa ({task.attachments.length})
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">Armazenados com segurança no bucketdainvicta.</p>
              </div>
              {canEdit && (
                <label className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 font-semibold text-slate-800 hover:bg-slate-100 cursor-pointer whitespace-nowrap shrink-0 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-100 dark:hover:bg-slate-800">
                  <Upload className="w-3.5 h-3.5" />
                  {uploadingFile ? 'Enviando...' : 'Anexar Arquivo'}
                  <input
                    type="file"
                    className="hidden"
                    disabled={uploadingFile}
                    onChange={(e) => void handleUploadAttachment(e)}
                  />
                </label>
              )}
            </div>

            {task.attachments.length === 0 ? (
              <p className="text-slate-400 dark:text-slate-400">Nenhum anexo enviado para esta tarefa.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {task.attachments.map((att) => (
                  <div
                    key={att.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 bg-slate-50/50 dark:border-slate-700 dark:bg-slate-800/60"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <FileText className="w-4 h-4 text-slate-500 shrink-0 dark:text-slate-400" />
                      <div className="min-w-0">
                        <p className="font-semibold text-slate-800 truncate dark:text-slate-100">{att.fileName}</p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          {formatBytes(att.sizeBytes)} · {att.addedByName}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => void handlePreviewAttachment(att)}
                        className="p-1.5 rounded border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                        title="Visualizar anexo"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDownloadAttachment(att)}
                        className="p-1.5 rounded border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                        title="Baixar anexo"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </button>
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => void handleDeleteAttachment(att.id)}
                          className="p-1.5 rounded border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300 dark:hover:bg-red-900/60"
                          title="Excluir anexo"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* HISTÓRICO DE PAUSAS DO CRONÔMETRO */}
          {Array.isArray(task.timerPauseLogsJson) && task.timerPauseLogsJson.length > 0 && (
            <div className="rounded-xl border border-slate-200 p-4 space-y-2 bg-white dark:border-slate-700 dark:bg-slate-900">
              <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                Histórico de Pausas do Cronômetro ({task.timerPauseLogsJson.length})
              </h3>
              <div className="space-y-1.5">
                {task.timerPauseLogsJson.map((log, i) => (
                  <div
                    key={i}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-[11px] dark:border-slate-800 dark:bg-slate-800/70"
                  >
                    <div>
                      <span className="font-semibold text-slate-900 dark:text-slate-100">{log.reason}</span>
                      <span className="text-slate-500 dark:text-slate-400"> · {log.userName}</span>
                    </div>
                    <div className="font-mono text-slate-700 tabular-nums dark:text-slate-200">
                      +{formatStopwatchHHMMSS(log.durationSeconds)} · {formatDateTimeBR(log.pausedAt)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Modal Justificativa de Pausa da Subtarefa */}
      <TaskPauseModal
        open={Boolean(subPauseTarget)}
        targetTitle={subPauseTarget ? `Subtarefa: ${subPauseTarget.title}` : ''}
        onCancel={() => setSubPauseTarget(null)}
        onConfirm={async (reason) => {
          if (!subPauseTarget) return;
          await apiFetch(
            `/api/collection/coordinator/tasks/${task.id}/subtasks/${subPauseTarget.id}/timer`,
            {
              method: 'POST',
              body: JSON.stringify({ action: 'pause', reason }),
            }
          );
          setSubPauseTarget(null);
          await onUpdated('Cronômetro da subtarefa pausado.');
        }}
      />

      {/* Modal Preview In-App de Anexo do Bucket (Tema Dark/White) */}
      <DossierDocumentPreviewModal
        open={Boolean(previewAtt)}
        title={previewAtt?.att.fileName || ''}
        mimeType={previewAtt?.att.mimeType || ''}
        blobUrl={previewAtt?.url || ''}
        onClose={() => {
          if (previewAtt?.url) URL.revokeObjectURL(previewAtt.url);
          setPreviewAtt(null);
        }}
      />

      <EntityAuditModal
        open={taskAuditOpen}
        title={`Tarefa #${task.id} · ${task.title}`}
        entityType="coordinator_tasks"
        entityId={task.id}
        onClose={() => setTaskAuditOpen(false)}
      />
    </div>
  );
};
