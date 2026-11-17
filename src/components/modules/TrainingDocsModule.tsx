import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  Bot,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Database,
  ExternalLink,
  GitBranch,
  GraduationCap,
  HelpCircle,
  Maximize2,
  MessageCircleQuestion,
  Mic,
  Pause,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Save,
  Search,
  Send,
  Sparkles,
  Square,
  Trash2,
  Volume2,
  X,
} from 'lucide-react';
import iviFullBodyImg from '../../assets/images/ivi_instructor_fullbody_1794879324550.jpg';
import { apiFetch, formatDateTimeBR, getAuthToken } from '../../lib/api.ts';
import { IviAnimatedStage } from './IviAnimatedStage.tsx';
import { IviLiveVoicePanel } from './IviLiveVoicePanel.tsx';
import {
  AuthUser,
  IviAudioCacheItem,
  IviKnowledgeArticle,
  ModuleId,
  SystemDocFieldDef,
  SystemDocTrainingStep,
  SystemModuleDoc,
  TrainingQaHistoryEntry,
  TrainingSessionRecord,
} from '../../types.ts';

interface TrainingDocsModuleProps {
  currentUser: AuthUser;
  activeUnitId?: number;
  onNavigate?: (mod: ModuleId) => void;
}

interface IntegrationGraphPayload {
  nodes: Array<{
    moduleKey: string;
    title: string;
    menuGroup: string;
    inputsCount: number;
    outputsCount: number;
  }>;
  edges: Array<{
    from: string;
    to: string;
    label: string;
    description: string;
  }>;
}

interface AudioCacheStats {
  count: number;
  totalHits: number;
  totalTokensSaved: number;
  totalBytes: number;
}

const PT_MODULE_TITLES: Record<string, string> = {
  diagrama_integracao: 'Diagrama Geral de Integração do Sistema',
  login: 'Acesso Corporativo & Dupla Verificação (LGPD)',
  home: 'Home Corporativa',
  overview: 'Visão Executiva',
  managerial_dashboard: 'Dashboard Gerencial',
  appointments: 'Agendamentos',
  cadastros_comuns: 'Cadastros Comuns',
  prospection: 'Prospecção & Atendimento',
  admission: 'Admissão & Dossiê',
  audit: 'Auditoria & Boletos',
  legal: 'Jurídico & Escavador',
  negotiations: 'Negociações Bancárias',
  internal_messaging: 'Mensageria Interna (Ivi)',
  finance: 'Administração Financeira',
  collection: 'Cobrança & Ranking',
  forms: 'Formulários Personalizados',
  reports: 'Relatórios Gerais',
  acomp_juridico: 'Acompanhamento Jurídico',
  config: 'Governança & Configurações',
  backup_restore: 'Backup & Restore (Google Drive)',
  training_docs: 'Treinamento & Docs Ivi',
};

function humanizeDocText(raw: string, customMap?: Record<string, string>): string {
  let out = String(raw || '');
  const mergedMap = { ...PT_MODULE_TITLES, ...(customMap || {}) };
  out = out
    .replace(/\bAPI\s+\/api\/auth\/captcha\b/gi, 'Tela de Acesso Corporativo (Desafios de Verificação)')
    .replace(/\bAPI\s+\/api\/auth\/login\b/gi, 'Tela de Acesso Corporativo (Validação de Entrada)')
    .replace(/\/api\/auth\/captcha\b/gi, 'Desafios de Verificação do Acesso Corporativo')
    .replace(/\/api\/auth\/login\b/gi, 'Validação de Entrada do Acesso Corporativo')
    .replace(/\/api\/[a-z0-9_/-]+/gi, 'rotina do sistema')
    .replace(/\baudit_logs\b/gi, 'Auditoria Geral')
    .replace(/\bsystem_module_docs\b/gi, 'Documentação dos Módulos')
    .replace(/\btraining_sessions\b/gi, 'Progresso do Treinamento')
    .replace(/\bcheckbox_group\b/gi, 'Múltipla Escolha')
    .replace(/\bgoogle\s+classroom\b|\bsala\s+de\s+aula\s+do\s+google\b|\bclassroom\b/gi, 'Sala de Aula da Invicta')
    .replace(
      /\b(diagrama_integracao|login|home|overview|managerial_dashboard|appointments|cadastros_comuns|prospection|admission|audit|legal|negotiations|internal_messaging|finance|collection|forms|reports|acomp_juridico|config|backup_restore|training_docs)\b/g,
      (m) => mergedMap[m] || m
    );
  return out;
}

const CachedDocAudioPlayer: React.FC<{
  cacheHash: string;
  cached?: boolean;
  label?: string;
  autoPlay?: boolean;
  onEnded?: () => void;
  onPlayStateChange?: (playing: boolean) => void;
}> = ({ cacheHash, cached, label, autoPlay, onEnded, onPlayStateChange }) => {
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    let mounted = true;
    let url: string | null = null;
    setLoading(true);
    setErr('');

    fetch(`/api/ivi/audio/${cacheHash}`, {
      headers: { Authorization: `Bearer ${getAuthToken()}` },
    })
      .then(async (r) => {
        if (!r.ok) throw new Error('Áudio não encontrado');
        return r.blob();
      })
      .then((blob) => {
        if (!mounted) return;
        url = URL.createObjectURL(blob);
        setAudioUrl(url);
      })
      .catch(() => {
        if (mounted) setErr('Falha ao carregar áudio da base da Ivi.');
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [cacheHash]);

  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50/70 px-3 py-2.5 space-y-1.5 dark:border-blue-800/70 dark:bg-blue-950/40">
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
        <span className="inline-flex items-center gap-1.5 font-semibold text-blue-900 dark:text-blue-200">
          <Volume2 className="w-3.5 h-3.5 shrink-0" />
          {label || 'Narração Ivi · Gemini Audio'}
        </span>
        <span className="font-mono text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
          {cached ? 'Cache Base Ivi · 0 tokens gastos' : 'Armazenado na Base Ivi'}
        </span>
      </div>
      {loading && <div className="text-[11px] text-slate-500 dark:text-slate-400">Carregando áudio WAV...</div>}
      {err && <div className="text-[11px] text-red-600 dark:text-red-400">{err}</div>}
      {audioUrl && (
        <audio
          controls
          autoPlay={autoPlay}
          preload="metadata"
          className="w-full h-9"
          src={audioUrl}
          onPlay={() => onPlayStateChange?.(true)}
          onPause={() => onPlayStateChange?.(false)}
          onEnded={() => {
            onPlayStateChange?.(false);
            onEnded?.();
          }}
        />
      )}
    </div>
  );
};

const PIPELINE_DIAGRAM_NODES: Array<{
  key: string;
  short: string;
  x: number;
  y: number;
  w: number;
  h: number;
  stage: string;
}> = [
  { key: 'prospection', short: 'Prospecção', x: 24, y: 26, w: 170, h: 68, stage: 'Captação' },
  { key: 'appointments', short: 'Agendamentos', x: 226, y: 26, w: 175, h: 68, stage: 'Atendimento' },
  { key: 'admission', short: 'Admissão & Dossiê', x: 432, y: 26, w: 192, h: 68, stage: 'Comercial' },
  { key: 'audit', short: 'Auditoria & Boletos', x: 656, y: 26, w: 192, h: 68, stage: 'Validação' },
  { key: 'legal', short: 'Jurídico & Escavador', x: 432, y: 150, w: 192, h: 68, stage: 'Contencioso' },
  { key: 'negotiations', short: 'Negociações Bancárias', x: 656, y: 150, w: 192, h: 68, stage: 'Acordos' },
  { key: 'finance', short: 'Admin. Financeira', x: 882, y: 26, w: 192, h: 68, stage: 'Receita' },
  { key: 'collection', short: 'Cobrança & Ranking', x: 882, y: 150, w: 192, h: 68, stage: 'Recuperação' },
  { key: 'internal_messaging', short: 'Mensageria Interna', x: 226, y: 150, w: 175, h: 68, stage: 'Alertas Ivi' },
  { key: 'forms', short: 'Formulários & Relatórios', x: 24, y: 274, w: 226, h: 64, stage: 'Análises' },
  { key: 'cadastros_comuns', short: 'Cadastros Comuns', x: 278, y: 274, w: 208, h: 64, stage: 'Base Unificada' },
  { key: 'config', short: 'Configurações, R2 & SQL', x: 514, y: 274, w: 240, h: 64, stage: 'Governança' },
  { key: 'backup_restore', short: 'Backup Drive & Docs Ivi', x: 782, y: 274, w: 292, h: 64, stage: 'Nuvem & Treino' },
];

const PIPELINE_EDGES: Array<{ from: string; to: string }> = [
  { from: 'prospection', to: 'appointments' },
  { from: 'appointments', to: 'admission' },
  { from: 'admission', to: 'audit' },
  { from: 'audit', to: 'finance' },
  { from: 'audit', to: 'legal' },
  { from: 'audit', to: 'negotiations' },
  { from: 'finance', to: 'collection' },
  { from: 'legal', to: 'negotiations' },
  { from: 'admission', to: 'internal_messaging' },
  { from: 'cadastros_comuns', to: 'admission' },
  { from: 'config', to: 'backup_restore' },
];

export const TrainingDocsModule: React.FC<TrainingDocsModuleProps> = ({
  currentUser,
  onNavigate,
}) => {
  const isAdmin = currentUser.role === 'admin';

  const [mode, setMode] = useState<'static' | 'training' | 'admin'>('static');
  const [modules, setModules] = useState<SystemModuleDoc[]>([]);
  const [knowledgeArticles, setKnowledgeArticles] = useState<IviKnowledgeArticle[]>([]);
  const [audioStats, setAudioStats] = useState<AudioCacheStats>({
    count: 0,
    totalHits: 0,
    totalTokensSaved: 0,
    totalBytes: 0,
  });
  const [integrationGraph, setIntegrationGraph] = useState<IntegrationGraphPayload>({ nodes: [], edges: [] });
  const [audioCacheItems, setAudioCacheItems] = useState<IviAudioCacheItem[]>([]);
  const [trainingSessions, setTrainingSessions] = useState<TrainingSessionRecord[]>([]);

  const [selectedModuleKey, setSelectedModuleKey] = useState<string>('diagrama_integracao');
  const [moduleSearch, setModuleSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [statusBanner, setStatusBanner] = useState('');
  const [zoomScreenshotOpen, setZoomScreenshotOpen] = useState(false);
  const [imgErrorKey, setImgErrorKey] = useState<string | null>(null);
  const [resumedCheckpointInfo, setResumedCheckpointInfo] = useState<string>('');
  const initialResumeAppliedRef = useRef(false);

  // Mode 1 & Mode 2 Grounded Q&A State
  const [qaQuestion, setQaQuestion] = useState('');
  const [qaAllowLearn, setQaAllowLearn] = useState(true);
  const [qaWithAudio, setQaWithAudio] = useState(true);
  const [qaResult, setQaResult] = useState<{
    answer: string;
    citedModules: string[];
    citedFields: Array<{ moduleKey: string; fieldLabel: string; originModule: string; destinationModule: string }>;
    learnedArticle: { id: number; questionPattern: string; answerTemplate: string; moduleKey: string } | null;
    audioCacheHash?: string;
    audioCached?: boolean;
    provider: string;
  } | null>(null);
  const [qaHistory, setQaHistory] = useState<TrainingQaHistoryEntry[]>([]);

  // Voice recording for Q&A
  const [recordingQa, setRecordingQa] = useState(false);
  const qaRecorderRef = useRef<MediaRecorder | null>(null);
  const qaChunksRef = useRef<Blob[]>([]);

  // Mode 2 Dynamic Training State
  const [traineeNameInput, setTraineeNameInput] = useState(currentUser.name || '');
  const [traineeConfirmed, setTraineeConfirmed] = useState(true);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<number[]>([]);
  const [selectedVoice, setSelectedVoice] = useState<'Aoede' | 'Kore' | 'Zephyr'>('Aoede');
  const [activeTtsHash, setActiveTtsHash] = useState<{
    hash: string;
    cached: boolean;
    stepKey: string;
  } | null>(null);
  const [isPlayingNarration, setIsPlayingNarration] = useState(false);
  const [isLiveSpeaking, setIsLiveSpeaking] = useState(false);

  // Post-Lesson Centered Doubt Modal & 5-Second Auto-Advance State
  const [lessonDoubtOpen, setLessonDoubtOpen] = useState(false);
  const [lessonDoubtInput, setLessonDoubtInput] = useState('');
  const [lessonDoubtCountdown, setLessonDoubtCountdown] = useState<number | null>(null);
  const [lessonAutoAdvanceMsg, setLessonAutoAdvanceMsg] = useState('');
  const [lessonChatMessages, setLessonChatMessages] = useState<
    Array<{
      id: string;
      sender: 'ivi' | 'user';
      text: string;
      audioCacheHash?: string;
      audioCached?: boolean;
      outOfContext?: boolean;
      createdAt: string;
    }>
  >([]);
  const autoAdvanceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const goToNextStepFromTimerRef = useRef<() => void>(() => {});

  // Mode 3 Admin Subtabs & Forms
  const [adminTab, setAdminTab] = useState<'modules' | 'kb_docs' | 'kb_prospection' | 'audio_cache'>('modules');
  const [editingDoc, setEditingDoc] = useState<SystemModuleDoc | null>(null);
  const [newModuleModalOpen, setNewModuleModalOpen] = useState(false);
  const [newModKey, setNewModKey] = useState('');
  const [newModTitle, setNewModTitle] = useState('');
  const [newModGroup, setNewModGroup] = useState('Operação & Tratativa');
  const [newModPath, setNewModPath] = useState('');
  const [newModSummary, setNewModSummary] = useState('');
  const [newModObjective, setNewModObjective] = useState('');
  const [newModScreenshot, setNewModScreenshot] = useState('/assets/module-docs/overview.png');

  // Admin KB CRUD state
  const [kbFormOpen, setKbFormOpen] = useState(false);
  const [kbEditingId, setKbEditingId] = useState<number | null>(null);
  const [kbScope, setKbScope] = useState<'system_doc' | 'learned_insight' | 'prospection'>('system_doc');
  const [kbModuleKey, setKbModuleKey] = useState('login');
  const [kbQuestion, setKbQuestion] = useState('');
  const [kbAnswer, setKbAnswer] = useState('');
  const [kbCategory, setKbCategory] = useState('documentacao');
  const [kbActive, setKbActive] = useState(true);
  const [adminAudioPreview, setAdminAudioPreview] = useState<{ id: number; hash: string; cached: boolean } | null>(null);

  const moduleTitleMap = useMemo(() => {
    const map: Record<string, string> = { ...PT_MODULE_TITLES };
    for (const m of modules) {
      map[m.moduleKey] = m.title;
    }
    return map;
  }, [modules]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [docsRes, sessionsRes] = await Promise.all([
        apiFetch<{
          modules: SystemModuleDoc[];
          knowledgeArticles: IviKnowledgeArticle[];
          audioCacheStats: AudioCacheStats;
          integrationGraph: IntegrationGraphPayload;
        }>(`/api/docs/modules${isAdmin ? '?includeInactive=1' : ''}`),
        apiFetch<{ sessions: TrainingSessionRecord[] }>('/api/training/sessions'),
      ]);

      const sortedMods = [...(docsRes.modules || [])].sort(
        (a, b) => (a.sortOrder ?? 99) - (b.sortOrder ?? 99) || a.id - b.id
      );
      const fetchedSessions = sessionsRes.sessions || [];

      setModules(sortedMods);
      setKnowledgeArticles(docsRes.knowledgeArticles || []);
      setAudioStats(
        docsRes.audioCacheStats || { count: 0, totalHits: 0, totalTokensSaved: 0, totalBytes: 0 }
      );
      setIntegrationGraph(docsRes.integrationGraph || { nodes: [], edges: [] });
      setTrainingSessions(fetchedSessions);

      if (sortedMods.length > 0 && !initialResumeAppliedRef.current) {
        initialResumeAppliedRef.current = true;
        const inProgress = fetchedSessions.find(
          (s) => s.status === 'em_andamento' && sortedMods.some((m) => m.moduleKey === s.moduleKey)
        );
        const completedSet = new Set(
          fetchedSessions.filter((s) => s.status === 'concluido').map((s) => s.moduleKey)
        );
        const firstUnfinished = sortedMods.find((m) => !completedSet.has(m.moduleKey));
        const targetMod =
          (inProgress && sortedMods.find((m) => m.moduleKey === inProgress.moduleKey)) ||
          firstUnfinished ||
          sortedMods.find((m) => m.moduleKey === 'diagrama_integracao') ||
          sortedMods.find((m) => m.moduleKey === 'login') ||
          sortedMods[0];

        if (targetMod) {
          setSelectedModuleKey(targetMod.moduleKey);
          const matchingSess =
            inProgress || fetchedSessions.find((s) => s.moduleKey === targetMod.moduleKey) || null;
          if (matchingSess) {
            const totalFieldsCount = Math.max(
              targetMod.trainingStepsJson?.length || 0,
              targetMod.fieldsJson?.length || 0,
              1
            );
            const restoredStep = Math.min(
              Math.max(0, matchingSess.currentStepIndex || 0),
              totalFieldsCount - 1
            );
            setCurrentStepIndex(restoredStep);
            setCompletedSteps(matchingSess.completedStepsJson || []);
            setQaHistory(matchingSess.qaHistoryJson || []);
            if (matchingSess.moduleKey !== 'diagrama_integracao' || restoredStep > 0) {
              setResumedCheckpointInfo(
                `Retomando automaticamente de onde você parou: "${targetMod.title}" (Aula ${restoredStep + 1}).`
              );
            }
          } else {
            setCurrentStepIndex(0);
            setCompletedSteps([]);
            setQaHistory([]);
          }
        }
      }

      if (isAdmin) {
        try {
          const cacheRes = await apiFetch<{ items: IviAudioCacheItem[] }>('/api/ivi/audio-cache');
          setAudioCacheItems(cacheRes.items || []);
        } catch {
          // ignore secondary load errors
        }
      }
    } catch (err) {
      setStatusBanner(err instanceof Error ? err.message : 'Erro ao carregar documentação.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, [isAdmin]);

  const activeDoc = useMemo(
    () => modules.find((m) => m.moduleKey === selectedModuleKey) || modules[0] || null,
    [modules, selectedModuleKey]
  );

  const persistSessionForModule = async (
    targetModuleKey: string,
    nextStepIdx: number,
    nextCompleted: number[],
    nextQaHistory: TrainingQaHistoryEntry[] = [],
    forceStatus?: 'em_andamento' | 'concluido'
  ) => {
    const cleanTrainee = traineeNameInput.trim() || currentUser.name || 'Colaborador';
    try {
      const targetDoc = modules.find((m) => m.moduleKey === targetModuleKey);
      const totalModSteps = Math.max(
        targetDoc?.trainingStepsJson?.length || 0,
        targetDoc?.fieldsJson?.length || 0,
        1
      );
      const computedStatus =
        forceStatus || (nextCompleted.length >= totalModSteps ? 'concluido' : 'em_andamento');
      const res = await apiFetch<{ session: TrainingSessionRecord }>('/api/training/sessions', {
        method: 'POST',
        body: JSON.stringify({
          traineeName: cleanTrainee,
          moduleKey: targetModuleKey,
          currentStepIndex: nextStepIdx,
          completedStepsJson: nextCompleted,
          qaHistoryJson: nextQaHistory,
          status: computedStatus,
        }),
      });
      setTrainingSessions((prev) => {
        const idx = prev.findIndex((s) => s.id === res.session.id);
        if (idx >= 0) {
          const copy = [...prev];
          copy[idx] = res.session;
          return copy;
        }
        return [res.session, ...prev];
      });
    } catch {
      // keep smooth UX if offline
    }
  };

  const selectModuleForStudy = (modKey: string, persistCheckpoint = mode === 'training') => {
    const targetMod = modules.find((m) => m.moduleKey === modKey);
    if (!targetMod) return;
    setImgErrorKey(null);
    setSelectedModuleKey(modKey);
    setActiveTtsHash(null);
    setIsPlayingNarration(false);
    setLessonDoubtOpen(false);
    setLessonDoubtCountdown(null);
    setLessonAutoAdvanceMsg('');
    setLessonChatMessages([]);

    const matchingSession = trainingSessions.find((s) => s.moduleKey === modKey);
    const totalCount = Math.max(
      targetMod.trainingStepsJson?.length || 0,
      targetMod.fieldsJson?.length || 0,
      1
    );
    const nextStep = matchingSession
      ? Math.min(Math.max(0, matchingSession.currentStepIndex || 0), totalCount - 1)
      : 0;
    const nextDone = matchingSession?.completedStepsJson || [];
    const nextHistory = matchingSession?.qaHistoryJson || [];

    setCurrentStepIndex(nextStep);
    setCompletedSteps(nextDone);
    setQaHistory(nextHistory);

    if (persistCheckpoint) {
      void persistSessionForModule(modKey, nextStep, nextDone, nextHistory);
    }
  };

  const handleStartNewTraining = async () => {
    const firstMod =
      modules.find((m) => m.moduleKey === 'diagrama_integracao') ||
      modules.find((m) => m.moduleKey === 'login') ||
      modules[0];
    const startKey = firstMod?.moduleKey || 'diagrama_integracao';
    setBusy(true);
    try {
      const cleanName = traineeNameInput.trim() || currentUser.name || 'Colaborador';
      const res = await apiFetch<{ sessions: TrainingSessionRecord[] }>('/api/training/sessions/reset', {
        method: 'POST',
        body: JSON.stringify({ traineeName: cleanName }),
      });
      setTrainingSessions(res.sessions || []);
      setSelectedModuleKey(startKey);
      setCurrentStepIndex(0);
      setCompletedSteps([]);
      setQaHistory([]);
      setActiveTtsHash(null);
      setIsPlayingNarration(false);
      setLessonDoubtOpen(false);
      setLessonDoubtCountdown(null);
      setLessonAutoAdvanceMsg('');
      setLessonChatMessages([]);
      setResumedCheckpointInfo('');
      setMode('training');
      setStatusBanner(
        `Novo treinamento iniciado do zero para ${cleanName.split(' ')[0]}! Começando na sala de aula pelo "${
          firstMod?.title || 'Diagrama Geral de Integração do Sistema'
        }" e seguindo todas as telas.`
      );
    } catch (err) {
      setStatusBanner(err instanceof Error ? err.message : 'Erro ao reiniciar treinamento.');
    } finally {
      setBusy(false);
    }
  };

  const groupedModules = useMemo(() => {
    const q = moduleSearch.trim().toLowerCase();
    const filtered = modules.filter((m) => {
      if (!q) return true;
      const hay = `${m.title} ${m.menuGroup} ${m.menuPath} ${m.summary} ${(m.fieldsJson || [])
        .map((f) => `${f.fieldLabel} ${f.description}`)
        .join(' ')}`.toLowerCase();
      return hay.includes(q);
    });
    const groups = new Map<string, SystemModuleDoc[]>();
    for (const m of filtered) {
      const list = groups.get(m.menuGroup) || [];
      list.push(m);
      groups.set(m.menuGroup, list);
    }
    return Array.from(groups.entries());
  }, [modules, moduleSearch]);

  const trainingSteps: Array<
    SystemDocTrainingStep & { fieldMeta?: SystemDocFieldDef }
  > = useMemo(() => {
    if (!activeDoc) return [];
    const fields = Array.isArray(activeDoc.fieldsJson) ? activeDoc.fieldsJson : [];
    const baseSteps = Array.isArray(activeDoc.trainingStepsJson) ? activeDoc.trainingStepsJson : [];

    const coveredLabels = new Set<string>();
    const merged: Array<SystemDocTrainingStep & { fieldMeta?: SystemDocFieldDef }> = baseSteps.map((st, idx) => {
      const matchedField =
        fields.find(
          (f) =>
            f.fieldLabel.toLowerCase() === st.fieldLabel.toLowerCase() ||
            f.fieldName.toLowerCase() === st.fieldLabel.toLowerCase() ||
            st.fieldLabel.toLowerCase().includes(f.fieldLabel.toLowerCase())
        ) || fields[idx];
      if (matchedField) coveredLabels.add(matchedField.fieldLabel.toLowerCase());
      return {
        ...st,
        scriptText: humanizeDocText(st.scriptText, moduleTitleMap),
        fieldMeta: matchedField,
      };
    });

    // Ensure EVERY documented field in the screen has its own dynamic lesson step
    fields.forEach((f, idx) => {
      if (coveredLabels.has(f.fieldLabel.toLowerCase())) return;
      const toX = f.targetX || (360 + ((idx * 290) % 760));
      const toY = f.targetY || (220 + ((Math.floor(idx / 2) * 185) % 480));
      const fromX = toX > 720 ? Math.max(210, toX - 380) : Math.min(1190, toX + 380);
      const fromY = toY > 450 ? Math.max(180, toY - 190) : Math.min(680, toY + 190);
      merged.push({
        stepOrder: merged.length + 1,
        title: `Campo: ${f.fieldLabel}`,
        fieldLabel: f.fieldLabel,
        scriptText: humanizeDocText(f.description, moduleTitleMap),
        fromX,
        fromY,
        toX,
        toY,
        boxW: 360,
        boxH: 88,
        relatedModule: f.destinationModule,
        fieldMeta: f,
      });
    });

    return merged;
  }, [activeDoc, moduleTitleMap]);

  const currentStep = trainingSteps[currentStepIndex] || trainingSteps[0] || null;
  const activeTraineeName = (traineeNameInput || currentUser.name || 'Colega').trim().split(' ')[0] || 'Colega';

  const personalizedScript = useMemo(() => {
    if (!currentStep) return '';
    if (activeDoc?.moduleKey === 'diagrama_integracao' && currentStepIndex === 0) {
      return `Olá, ${activeTraineeName}! Seja bem-vindo(a) à nossa Sala de Aula Invicta! Eu sou a Ivi, sua instrutora aqui na Invicta Assessoria Financeira — vestindo nossa camisa oficial da Invicta para guiar você por TODAS as opções e telas do sistema, passo a passo. Olhando para o Diagrama Geral no quadro ao lado, vamos entender primeiro como todos os setores se integram ponta a ponta antes de abrir cada tela individual.`;
    }
    const openers = [
      `E aí, ${activeTraineeName}! Chega mais que agora vou te mostrar no quadro o item "${currentStep.fieldLabel}".`,
      `Olha só que importante esse ponto aqui, ${activeTraineeName}! Veja a seta apontando para "${currentStep.fieldLabel}".`,
      `Bora entender direitinho agora "${currentStep.fieldLabel}", ${activeTraineeName}! Ele faz toda a diferença na rotina.`,
      `Atenção nesse detalhe prático, ${activeTraineeName}! Aqui em "${currentStep.fieldLabel}" funciona assim:`,
    ];
    const opener = openers[currentStepIndex % openers.length];
    const meta = currentStep.fieldMeta;
    const flowLine = meta
      ? ` Os dados vêm de "${humanizeDocText(meta.originModule, moduleTitleMap)}" e seguem depois para "${humanizeDocText(
          meta.destinationModule,
          moduleTitleMap
        )}".`
      : '';
    return `${opener} ${humanizeDocText(currentStep.scriptText, moduleTitleMap)}${flowLine}`;
  }, [activeDoc, currentStep, currentStepIndex, activeTraineeName, moduleTitleMap]);

  const saveTrainingProgress = async (
    nextStepIdx: number,
    nextCompleted: number[],
    nextQaHistory: TrainingQaHistoryEntry[] = qaHistory,
    forceStatus?: 'em_andamento' | 'concluido'
  ) => {
    if (!activeDoc) return;
    await persistSessionForModule(activeDoc.moduleKey, nextStepIdx, nextCompleted, nextQaHistory, forceStatus);
  };

  const goToLessonStep = (nextIdx: number, markCurrentDone = false, reasonText?: string) => {
    if (autoAdvanceTimeoutRef.current) {
      clearTimeout(autoAdvanceTimeoutRef.current);
      autoAdvanceTimeoutRef.current = null;
    }
    const nextCompleted =
      markCurrentDone && !completedSteps.includes(currentStepIndex)
        ? [...completedSteps, currentStepIndex]
        : completedSteps;

    setLessonDoubtOpen(false);
    setLessonDoubtCountdown(null);
    setLessonAutoAdvanceMsg('');
    setLessonChatMessages([]);
    setActiveTtsHash(null);
    setIsPlayingNarration(false);

    if (nextIdx < trainingSteps.length) {
      setCompletedSteps(nextCompleted);
      setCurrentStepIndex(nextIdx);
      setResumedCheckpointInfo('');
      void saveTrainingProgress(nextIdx, nextCompleted, qaHistory, 'em_andamento');
      if (reasonText) setStatusBanner(reasonText);
    } else if (activeDoc) {
      const allIdxs = trainingSteps.map((_, idx) => idx);
      setCompletedSteps(allIdxs);
      void persistSessionForModule(activeDoc.moduleKey, currentStepIndex, allIdxs, qaHistory, 'concluido');

      const curModIdx = modules.findIndex((m) => m.moduleKey === activeDoc.moduleKey);
      if (curModIdx >= 0 && curModIdx + 1 < modules.length) {
        const nextMod = modules[curModIdx + 1];
        setStatusBanner(
          `Mandou bem demais, ${activeTraineeName}! Você fechou todas as aulas de "${activeDoc.title}". Seguindo agora na fila para "${nextMod.title}"!`
        );
        setSelectedModuleKey(nextMod.moduleKey);
        setCurrentStepIndex(0);
        setCompletedSteps([]);
        setQaHistory([]);
        setImgErrorKey(null);
        void persistSessionForModule(nextMod.moduleKey, 0, [], [], 'em_andamento');
      } else {
        setStatusBanner(
          `Parabéns, ${activeTraineeName}! Você concluiu 100% da trilha completa do sistema FinancePro Invicta!`
        );
      }
    }
  };

  useEffect(() => {
    goToNextStepFromTimerRef.current = () => {
      goToLessonStep(
        currentStepIndex + 1,
        true,
        `Sem dúvidas por enquanto, ${activeTraineeName}! Seguindo automaticamente para a próxima aula.`
      );
    };
  });

  const openLessonDoubtChat = () => {
    if (!currentStep) return;
    setLessonDoubtOpen(true);
    setLessonAutoAdvanceMsg('');
    setLessonDoubtCountdown(5);
    setLessonChatMessages([
      {
        id: `ivi-prompt-${Date.now()}`,
        sender: 'ivi',
        text: `E aí, ${activeTraineeName}! Deu pra pegar certinho como funciona o campo "${currentStep.fieldLabel}"? Ficou com alguma dúvida ou podemos seguir para a próxima aula?`,
        createdAt: new Date().toISOString(),
      },
    ]);
  };

  // Auto-advance after 5 seconds when centered doubt modal opens without user interaction
  useEffect(() => {
    if (!lessonDoubtOpen || lessonDoubtCountdown === null) return;
    if (lessonDoubtCountdown <= 0) {
      goToNextStepFromTimerRef.current();
      return;
    }
    const timer = setTimeout(() => {
      setLessonDoubtCountdown((prev) => (prev === null ? null : prev - 1));
    }, 1000);
    return () => clearTimeout(timer);
  }, [lessonDoubtOpen, lessonDoubtCountdown]);

  useEffect(() => {
    return () => {
      if (autoAdvanceTimeoutRef.current) clearTimeout(autoAdvanceTimeoutRef.current);
    };
  }, []);

  const handleAskLessonDoubt = async (e?: React.FormEvent, overrideText?: string) => {
    if (e) e.preventDefault();
    const q = (overrideText ?? lessonDoubtInput).trim();
    if (!q || !currentStep || !activeDoc) return;

    setLessonDoubtCountdown(null);
    if (!overrideText) setLessonDoubtInput('');

    setLessonChatMessages((prev) => [
      ...prev,
      {
        id: `usr-${Date.now()}`,
        sender: 'user',
        text: q,
        createdAt: new Date().toISOString(),
      },
    ]);

    setBusy(true);
    try {
      const res = await apiFetch<{
        answer: string;
        inContext: boolean;
        noDoubtDetected: boolean;
        shouldAdvanceToNextLesson: boolean;
        audioCacheHash?: string;
        audioCached?: boolean;
        citedFields: Array<{ moduleKey: string; fieldLabel: string; originModule: string; destinationModule: string }>;
      }>('/api/ivi/doc-ask', {
        method: 'POST',
        body: JSON.stringify({
          question: q,
          moduleKey: activeDoc.moduleKey,
          traineeName: activeTraineeName,
          allowLearn: qaAllowLearn,
          withAudio: qaWithAudio,
          lessonMode: true,
          currentFieldLabel: currentStep.fieldLabel,
          currentFieldDescription: currentStep.scriptText,
          voiceName: selectedVoice,
        }),
      });

      setLessonChatMessages((prev) => [
        ...prev,
        {
          id: `ivi-ans-${Date.now()}`,
          sender: 'ivi',
          text: res.answer,
          audioCacheHash: res.audioCacheHash,
          audioCached: res.audioCached,
          outOfContext: !res.inContext,
          createdAt: new Date().toISOString(),
        },
      ]);

      const nextHistory: TrainingQaHistoryEntry[] = [
        {
          id: String(Date.now()),
          question: `[Aula ${currentStepIndex + 1} · ${currentStep.fieldLabel}] ${q}`,
          answer: res.answer,
          learnedArticleId: null,
          audioCacheHash: res.audioCacheHash,
          createdAt: new Date().toISOString(),
        },
        ...qaHistory,
      ].slice(0, 15);
      setQaHistory(nextHistory);
      void saveTrainingProgress(currentStepIndex, completedSteps, nextHistory);

      if (res.noDoubtDetected) {
        setLessonAutoAdvanceMsg(`Zero dúvidas, ${activeTraineeName}! Passando para a próxima aula...`);
        autoAdvanceTimeoutRef.current = setTimeout(() => {
          goToLessonStep(currentStepIndex + 1, true);
        }, 1800);
      } else if (!res.inContext || res.shouldAdvanceToNextLesson) {
        setLessonAutoAdvanceMsg(
          `Pergunta fora de contexto! 😂 Depois das risadas, ${activeTraineeName}, vamos para a próxima aula...`
        );
        autoAdvanceTimeoutRef.current = setTimeout(() => {
          goToLessonStep(
            currentStepIndex + 1,
            true,
            `Haha, voltando ao foco, ${activeTraineeName}! Avançamos para a próxima aula.`
          );
        }, 3600);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleSynthesizeStepAudio = async () => {
    if (!activeDoc || !personalizedScript.trim()) return;
    setBusy(true);
    try {
      const res = await apiFetch<{
        cacheHash: string;
        audioUrl: string;
        cached: boolean;
        unavailableReason?: string;
      }>('/api/ivi/tts', {
        method: 'POST',
        body: JSON.stringify({
          text: personalizedScript,
          voiceName: selectedVoice,
          sourceType: 'training',
          moduleKey: activeDoc.moduleKey,
        }),
      });
      if (!res.audioUrl) {
        setStatusBanner(res.unavailableReason || 'Síntese de áudio Gemini indisponível no momento.');
        return;
      }
      setActiveTtsHash({
        hash: res.cacheHash,
        cached: res.cached,
        stepKey: `${activeDoc.moduleKey}-${currentStepIndex}-${selectedVoice}`,
      });
      setIsPlayingNarration(true);
      setStatusBanner(
        res.cached
          ? 'Áudio da explicação carregado direto do cache da Ivi (sem gasto de tokens Gemini).'
          : 'Explicação convertida em áudio Gemini e salva na base da Ivi.'
      );
      await loadData();
    } finally {
      setBusy(false);
    }
  };

  const handleAskDocQuestion = async (e?: React.FormEvent, overrideQuestion?: string) => {
    if (e) e.preventDefault();
    const q = (overrideQuestion ?? qaQuestion).trim();
    if (!q) return;
    setBusy(true);
    try {
      const res = await apiFetch<{
        answer: string;
        citedModules: string[];
        citedFields: Array<{ moduleKey: string; fieldLabel: string; originModule: string; destinationModule: string }>;
        learnedArticle: { id: number; questionPattern: string; answerTemplate: string; moduleKey: string } | null;
        audioCacheHash?: string;
        audioCached?: boolean;
        provider: string;
      }>('/api/ivi/doc-ask', {
        method: 'POST',
        body: JSON.stringify({
          question: q,
          moduleKey: activeDoc?.moduleKey || '',
          traineeName: traineeConfirmed ? traineeNameInput.trim() : currentUser.name,
          allowLearn: qaAllowLearn,
          withAudio: qaWithAudio,
        }),
      });
      setQaResult(res);
      if (!overrideQuestion) setQaQuestion('');
      const entry: TrainingQaHistoryEntry = {
        id: String(Date.now()),
        question: q,
        answer: res.answer,
        learnedArticleId: res.learnedArticle?.id ?? null,
        audioCacheHash: res.audioCacheHash,
        createdAt: new Date().toISOString(),
      };
      const nextHistory = [entry, ...qaHistory].slice(0, 15);
      setQaHistory(nextHistory);
      if (mode === 'training') {
        await saveTrainingProgress(currentStepIndex, completedSteps, nextHistory);
      }
      if (res.learnedArticle) {
        setStatusBanner(
          `Ivi aprendeu um novo ponto de vista coerente ("${res.learnedArticle.questionPattern}") e salvou na Base de Conhecimento.`
        );
        await loadData();
      }
    } finally {
      setBusy(false);
    }
  };

  const toggleQaVoiceRecording = async () => {
    if (recordingQa && qaRecorderRef.current) {
      qaRecorderRef.current.stop();
      setRecordingQa(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      qaChunksRef.current = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) qaChunksRef.current.push(ev.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(qaChunksRef.current, { type: 'audio/webm' });
        if (blob.size === 0) return;
        setBusy(true);
        try {
          const reader = new FileReader();
          const dataUri = await new Promise<string>((resolve, reject) => {
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => reject(new Error('Falha ao ler áudio'));
            reader.readAsDataURL(blob);
          });
          const trans = await apiFetch<{ transcript: string; cached: boolean }>('/api/ivi/transcribe', {
            method: 'POST',
            body: JSON.stringify({
              audioDataUri: dataUri,
              mimeType: blob.type || 'audio/webm',
              moduleKey: activeDoc?.moduleKey || 'training_docs',
            }),
          });
          setQaQuestion(trans.transcript);
          await handleAskDocQuestion(undefined, trans.transcript);
        } finally {
          setBusy(false);
        }
      };
      qaRecorderRef.current = recorder;
      recorder.start();
      setRecordingQa(true);
    } catch {
      setStatusBanner('Microfone indisponível neste navegador. Digite sua dúvida para a Ivi responder.');
    }
  };

  // Arrow geometry helper (in 1440x900 SVG coordinate space)
  const arrowPathD = useMemo(() => {
    if (!currentStep) return '';
    const { fromX, fromY, toX, toY } = currentStep;
    const ctrlX = Math.round((fromX + toX) / 2);
    const ctrlY = Math.max(40, Math.min(fromY, toY) - 90);
    return `M ${fromX} ${fromY} Q ${ctrlX} ${ctrlY} ${toX} ${toY}`;
  }, [currentStep]);

  // Admin: Save module edit / creation
  const handleSaveEditingDoc = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin || !editingDoc) return;
    setBusy(true);
    try {
      await apiFetch(`/api/docs/modules/${editingDoc.id}`, {
        method: 'PUT',
        body: JSON.stringify(editingDoc),
      });
      setStatusBanner(`Documentação do módulo "${editingDoc.title}" salva e auditada.`);
      setEditingDoc(null);
      await loadData();
    } finally {
      setBusy(false);
    }
  };

  const handleCreateModuleDoc = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin || !newModKey.trim() || !newModTitle.trim()) return;
    setBusy(true);
    try {
      const res = await apiFetch<{ module: SystemModuleDoc }>('/api/docs/modules', {
        method: 'POST',
        body: JSON.stringify({
          moduleKey: newModKey.trim(),
          title: newModTitle.trim(),
          menuGroup: newModGroup,
          menuPath: newModPath.trim() || newModTitle.trim(),
          summary: newModSummary.trim(),
          objective: newModObjective.trim(),
          screenshotUrl: newModScreenshot.trim() || '/assets/module-docs/overview.png',
          fieldsJson: [],
          integrationsJson: { inputsFrom: [], outputsTo: [] },
          trainingStepsJson: [],
        }),
      });
      setNewModuleModalOpen(false);
      setNewModKey('');
      setNewModTitle('');
      setNewModSummary('');
      setNewModObjective('');
      setSelectedModuleKey(res.module.moduleKey);
      setStatusBanner(`Módulo "${res.module.title}" incluído na documentação da Ivi.`);
      await loadData();
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteModuleDoc = async (id: number, title: string) => {
    if (!isAdmin) return;
    setBusy(true);
    try {
      await apiFetch(`/api/docs/modules/${id}`, { method: 'DELETE' });
      setStatusBanner(`Módulo "${title}" excluído da documentação.`);
      await loadData();
    } finally {
      setBusy(false);
    }
  };

  const handleSaveKbArticle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin || !kbQuestion.trim() || !kbAnswer.trim()) return;
    setBusy(true);
    try {
      if (kbEditingId) {
        await apiFetch(`/api/ivi/knowledge/${kbEditingId}`, {
          method: 'PUT',
          body: JSON.stringify({
            scope: kbScope,
            moduleKey: kbScope === 'prospection' ? 'prospection' : kbModuleKey,
            questionPattern: kbQuestion.trim(),
            answerTemplate: kbAnswer.trim(),
            category: kbCategory.trim() || 'orientacao',
            active: kbActive,
          }),
        });
        setStatusBanner('Artigo da Base de Conhecimento da Ivi atualizado.');
      } else {
        await apiFetch('/api/ivi/knowledge', {
          method: 'POST',
          body: JSON.stringify({
            scope: kbScope,
            moduleKey: kbScope === 'prospection' ? 'prospection' : kbModuleKey,
            questionPattern: kbQuestion.trim(),
            answerTemplate: kbAnswer.trim(),
            category: kbCategory.trim() || 'orientacao',
            active: kbActive,
          }),
        });
        setStatusBanner('Novo artigo incluído na Base de Conhecimento da Ivi.');
      }
      setKbFormOpen(false);
      setKbEditingId(null);
      setKbQuestion('');
      setKbAnswer('');
      await loadData();
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteKbArticle = async (id: number) => {
    if (!isAdmin) return;
    setBusy(true);
    try {
      await apiFetch(`/api/ivi/knowledge/${id}`, { method: 'DELETE' });
      setStatusBanner('Artigo inútil removido da base da Ivi e registrado em Auditoria.');
      await loadData();
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteAudioCache = async (id: number) => {
    if (!isAdmin) return;
    setBusy(true);
    try {
      await apiFetch(`/api/ivi/audio-cache/${id}`, { method: 'DELETE' });
      setStatusBanner('Registro de áudio removido do cache da Ivi.');
      await loadData();
    } finally {
      setBusy(false);
    }
  };

  const docsKbArticles = useMemo(
    () => knowledgeArticles.filter((k) => k.scope === 'system_doc' || k.scope === 'learned_insight'),
    [knowledgeArticles]
  );

  const prospectionKbArticles = useMemo(
    () => knowledgeArticles.filter((k) => k.scope === 'prospection'),
    [knowledgeArticles]
  );

  if (loading && modules.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
        Carregando documentação completa dos módulos, diagramas de integração e academia da Ivi...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header Toolbar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-slate-200 pb-4 dark:border-slate-700">
        <div>
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Documentação Oficial por Módulo · Instrutora Virtual Ivi (Invicta) · Cache de Áudio Gemini
          </p>
          <h1 className="mt-1 font-display text-2xl font-bold text-slate-900 dark:text-slate-100">
            Treinamento Dinâmico & Documentação Ivi
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg dark:bg-slate-800">
            <button
              type="button"
              onClick={() => setMode('static')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                mode === 'static'
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-slate-100'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
              }`}
            >
              <BookOpen className="w-3.5 h-3.5" />
              Docs Estática & Consulta Ivi
            </button>
            <button
              type="button"
              onClick={() => setMode('training')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                mode === 'training'
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-slate-100'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
              }`}
            >
              <GraduationCap className="w-3.5 h-3.5 text-blue-700 dark:text-blue-400" />
              Treinamento Dinâmico (Ivi)
            </button>
            {isAdmin && (
              <button
                type="button"
                onClick={() => setMode('admin')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                  mode === 'admin'
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-slate-100'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
                }`}
              >
                <Database className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" />
                Gestão Base & Áudio (Admin)
              </button>
            )}
          </div>

          <div className="hidden sm:flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-mono text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
            <Volume2 className="w-3.5 h-3.5 text-blue-700 dark:text-blue-300" />
            <span>{audioStats.count} áudios em cache · {audioStats.totalTokensSaved} tokens economizados</span>
          </div>
        </div>
      </div>

      {statusBanner && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-medium text-emerald-900 flex items-center justify-between gap-2 dark:border-emerald-800/70 dark:bg-emerald-950/40 dark:text-emerald-200">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-emerald-600 shrink-0 dark:text-emerald-400" />
            <span>{statusBanner}</span>
          </div>
          <button
            type="button"
            onClick={() => setStatusBanner('')}
            className="p-1 text-emerald-700 hover:text-emerald-950 dark:text-emerald-300"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODO 1 & MODO 2 COMPARTILHAM DIRETÓRIO ESQUERDO DE MÓDULOS           */}
      {/* ===================================================================== */}
      {mode !== 'admin' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
          {/* Left Directory of Modules */}
          <aside className="lg:col-span-3 rounded-xl border border-slate-200 bg-white overflow-hidden dark:border-slate-700 dark:bg-slate-900">
            <div className="p-3 border-b border-slate-200 space-y-2 dark:border-slate-700">
              <div className="flex items-center justify-between text-xs font-bold text-slate-900 dark:text-slate-100">
                <span>Módulos do Sistema ({modules.length})</span>
                <span className="font-mono text-[10px] text-slate-400">PT-BR</span>
              </div>
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                <input
                  type="text"
                  value={moduleSearch}
                  onChange={(e) => setModuleSearch(e.target.value)}
                  placeholder="Filtrar módulo, tela ou campo..."
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 pl-8 pr-2.5 py-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
            </div>

            <div className="max-h-[760px] overflow-y-auto scroll-rulers divide-y divide-slate-100 dark:divide-slate-800">
              {groupedModules.map(([grpName, items]) => (
                <div key={grpName} className="py-1.5">
                  <div className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                    {grpName}
                  </div>
                  <div className="space-y-0.5 px-1.5">
                    {items.map((mod) => {
                      const active = activeDoc?.moduleKey === mod.moduleKey;
                      const sess = trainingSessions.find((s) => s.moduleKey === mod.moduleKey);
                      const sessionDone = sess?.status === 'concluido';
                      const sessionInProgress = sess?.status === 'em_andamento';
                      const stepCount = Math.max(mod.trainingStepsJson?.length || 0, mod.fieldsJson?.length || 0);
                      return (
                        <button
                          key={mod.moduleKey}
                          type="button"
                          onClick={() => selectModuleForStudy(mod.moduleKey)}
                          className={`w-full text-left px-2.5 py-2 rounded-lg text-xs transition-colors flex items-center justify-between gap-2 ${
                            active
                              ? 'bg-slate-900 text-white font-semibold dark:bg-blue-700'
                              : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800'
                          }`}
                        >
                          <div className="min-w-0">
                            <div className="truncate">
                              <span className="font-mono text-[10px] opacity-70 mr-1">{mod.sortOrder}.</span>
                              {mod.title}
                            </div>
                            <div
                              className={`text-[10px] truncate ${
                                active ? 'text-slate-300' : 'text-slate-400'
                              }`}
                            >
                              {mod.fieldsJson?.length || 0} campos · {stepCount} aulas
                              {sessionInProgress ? ` · Parou na aula ${(sess?.currentStepIndex || 0) + 1}` : ''}
                            </div>
                          </div>
                          {sessionDone ? (
                            <CheckCircle2
                              className={`w-3.5 h-3.5 shrink-0 ${
                                active ? 'text-emerald-300' : 'text-emerald-600 dark:text-emerald-400'
                              }`}
                            />
                          ) : sessionInProgress ? (
                            <span
                              className={`text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0 ${
                                active
                                  ? 'bg-amber-400/20 text-amber-200'
                                  : 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                              }`}
                            >
                              Em curso
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </aside>

          {/* Right Workspace */}
          <div className="lg:col-span-9 space-y-4">
            {activeDoc && mode === 'static' && (
              <>
                {/* Module Documentation Header + Real Screenshot */}
                <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4 dark:border-slate-700 dark:bg-slate-900">
                  <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4 dark:border-slate-800">
                    <div className="space-y-1">
                      <div className="text-[11px] font-mono font-semibold text-blue-700 dark:text-blue-300">
                        {activeDoc.menuPath}
                      </div>
                      <h2 className="font-display text-xl font-bold text-slate-900 dark:text-slate-100">
                        {activeDoc.title}
                      </h2>
                      <p className="text-xs text-slate-600 leading-relaxed max-w-3xl dark:text-slate-300">
                        {activeDoc.summary}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setMode('training')}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-800"
                      >
                        <GraduationCap className="w-3.5 h-3.5" />
                        Iniciar Treinamento Dinâmico deste Módulo
                      </button>
                      {onNavigate && (
                        <button
                          type="button"
                          onClick={() => onNavigate(activeDoc.moduleKey as ModuleId)}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          Abrir Tela Real
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Screenshot & Objective Grid */}
                  <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
                    <div className="xl:col-span-7 space-y-2">
                      <div className="flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-200">
                        <span>Captura Oficial da Tela ({activeDoc.title})</span>
                        <button
                          type="button"
                          onClick={() => setZoomScreenshotOpen(true)}
                          className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-700 hover:underline dark:text-blue-300"
                        >
                          <Maximize2 className="w-3 h-3" />
                          Ampliar Tela
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => setZoomScreenshotOpen(true)}
                        className="group relative block w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-100 aspect-[16/10] dark:border-slate-700 dark:bg-slate-800"
                      >
                        <img
                          src={activeDoc.screenshotUrl}
                          alt={`Tela ${activeDoc.title}`}
                          onError={() => setImgErrorKey(activeDoc.moduleKey)}
                          className="w-full h-full object-fill group-hover:scale-[1.01] transition-transform block"
                        />
                      </button>
                    </div>

                    <div className="xl:col-span-5 space-y-3">
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 space-y-1.5 dark:border-slate-700 dark:bg-slate-800/70">
                        <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                          Objetivo Operacional
                        </div>
                        <p className="text-xs text-slate-800 leading-relaxed dark:text-slate-200">
                          {activeDoc.objective}
                        </p>
                      </div>

                      <div className="rounded-xl border border-blue-200 bg-blue-50/70 p-3.5 space-y-2 dark:border-blue-800/70 dark:bg-blue-950/40">
                        <div className="text-[11px] font-bold uppercase tracking-wider text-blue-800 dark:text-blue-300">
                          Origem dos Dados (Entradas)
                        </div>
                        {(activeDoc.integrationsJson?.inputsFrom || []).length === 0 ? (
                          <p className="text-xs text-slate-600 dark:text-slate-300">
                            Entrada inicial / direta de usuários e integrações externas.
                          </p>
                        ) : (
                          <ul className="space-y-1.5 text-xs">
                            {activeDoc.integrationsJson.inputsFrom.map((edge, idx) => (
                              <li key={idx} className="flex items-start gap-2">
                                <ArrowRight className="w-3.5 h-3.5 text-blue-700 shrink-0 mt-0.5 dark:text-blue-300" />
                                <div>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (modules.some((m) => m.moduleKey === edge.moduleKey)) {
                                        setSelectedModuleKey(edge.moduleKey);
                                      }
                                    }}
                                    className="font-semibold text-blue-800 hover:underline dark:text-blue-200"
                                  >
                                    {edge.label}
                                  </button>
                                  <p className="text-[11px] text-slate-600 dark:text-slate-300">
                                    {edge.description}
                                  </p>
                                </div>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>

                      <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3.5 space-y-2 dark:border-emerald-800/70 dark:bg-emerald-950/40">
                        <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-800 dark:text-emerald-300">
                          Destino após Preenchimento (Saídas)
                        </div>
                        {(activeDoc.integrationsJson?.outputsTo || []).length === 0 ? (
                          <p className="text-xs text-slate-600 dark:text-slate-300">
                            Armazenamento em Cloud SQL PostgreSQL e trilha cumulativa em Audit Logs.
                          </p>
                        ) : (
                          <ul className="space-y-1.5 text-xs">
                            {activeDoc.integrationsJson.outputsTo.map((edge, idx) => (
                              <li key={idx} className="flex items-start gap-2">
                                <ArrowRight className="w-3.5 h-3.5 text-emerald-700 shrink-0 mt-0.5 dark:text-emerald-300" />
                                <div>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (modules.some((m) => m.moduleKey === edge.moduleKey)) {
                                        setSelectedModuleKey(edge.moduleKey);
                                      }
                                    }}
                                    className="font-semibold text-emerald-800 hover:underline dark:text-emerald-200"
                                  >
                                    {edge.label}
                                  </button>
                                  <p className="text-[11px] text-slate-600 dark:text-slate-300">
                                    {edge.description}
                                  </p>
                                </div>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Dictionary of Fields */}
                <div className="rounded-xl border border-slate-200 bg-white overflow-hidden dark:border-slate-700 dark:bg-slate-900">
                  <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between gap-2 dark:border-slate-700">
                    <div>
                      <h3 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                        Dicionário de Campos & Fluxo Origem → Destino ({activeDoc.fieldsJson?.length || 0})
                      </h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Material oficial lido pela Ivi para responder dúvidas pontuais de operação.
                      </p>
                    </div>
                  </div>
                  <div className="overflow-x-auto scroll-rulers">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-500 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-400">
                          <th className="py-2.5 px-4">Campo (Label)</th>
                          <th className="py-2.5 px-3">Tipo</th>
                          <th className="py-2.5 px-4">Explicação Completa</th>
                          <th className="py-2.5 px-4">Origem dos Dados</th>
                          <th className="py-2.5 px-4">Destino / Consumo</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {(activeDoc.fieldsJson || []).map((f, idx) => (
                          <tr key={idx} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/50 align-top">
                            <td className="py-3 px-4">
                              <div className="font-semibold text-slate-900 dark:text-slate-100">
                                {f.fieldLabel}
                                {f.required && (
                                  <span className="ml-1 text-red-600 font-bold" title="Obrigatório">
                                    *
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="py-3 px-3 text-[11px] font-medium text-slate-600 whitespace-nowrap dark:text-slate-300">
                              {humanizeDocText(f.fieldType, moduleTitleMap)}
                            </td>
                            <td className="py-3 px-4 text-slate-700 leading-relaxed dark:text-slate-200">
                              {humanizeDocText(f.description, moduleTitleMap)}
                            </td>
                            <td className="py-3 px-4 text-blue-800 font-medium dark:text-blue-300">
                              {humanizeDocText(f.originModule, moduleTitleMap)}
                            </td>
                            <td className="py-3 px-4 text-emerald-800 font-medium dark:text-emerald-300">
                              {humanizeDocText(f.destinationModule, moduleTitleMap)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}

            {/* ================================================================= */}
            {/* MODO 2: SALA DE AULA IVI NO TOPO + ITENS APRESENTADOS ABAIXO     */}
            {/* ================================================================= */}
            {activeDoc && mode === 'training' && (
              <>
                {/* 1º BLOCO (TOPO): SALA DE AULA DA IVI (ESQUERDA) + QUADRO DE AULA (DIREITA) */}
                <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-stretch">
                  {/* Left Classroom Stage: Full-Body Ivi in Invicta Polo Shirt */}
                  <div className="xl:col-span-5">
                    <IviAnimatedStage
                      traineeName={activeTraineeName}
                      moduleTitle={activeDoc.title}
                      fieldLabel={currentStep?.fieldLabel}
                      stepNumber={currentStepIndex + 1}
                      totalSteps={trainingSteps.length}
                      isSpeaking={isPlayingNarration || isLiveSpeaking}
                      selectedVoice={selectedVoice}
                      onChangeVoice={setSelectedVoice}
                    />
                  </div>

                  {/* Right Classroom Board: Live Integration Diagram OR Full-Bleed Screen + Pointer */}
                  <div className="xl:col-span-7 rounded-xl border border-slate-200 bg-white p-4 flex flex-col gap-3 h-full dark:border-slate-700 dark:bg-slate-900">
                    <div className="flex flex-wrap items-center justify-between gap-2 shrink-0">
                      <div>
                        <div className="text-[11px] font-medium text-blue-700 dark:text-blue-300">
                          {activeDoc.menuPath} · Aula {(activeDoc.sortOrder ?? 0) + 1} de {modules.length} · Item {currentStepIndex + 1}/{trainingSteps.length}
                        </div>
                        <h3 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                          Quadro da Sala · {currentStep?.title || activeDoc.title}
                        </h3>
                      </div>
                      {activeDoc.moduleKey !== 'diagrama_integracao' && (
                        <button
                          type="button"
                          onClick={() => setZoomScreenshotOpen(true)}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                        >
                          <Maximize2 className="w-3.5 h-3.5" />
                          Ampliar Quadro
                        </button>
                      )}
                    </div>

                    {/* Classroom Board Canvas (100% Filled — Diagram on Lesson 0, Screens on 1..20) */}
                    <div className="relative flex-1 w-full min-h-[385px] rounded-xl border-2 border-slate-300 bg-slate-50 overflow-hidden dark:border-slate-700 dark:bg-slate-950">
                      {activeDoc.moduleKey === 'diagrama_integracao' ? (
                        <div className="relative w-full h-full flex items-center justify-center p-2 bg-slate-50 dark:bg-slate-950">
                          <svg
                            viewBox="0 0 1100 365"
                            className="w-full h-full"
                            role="img"
                            aria-label="Diagrama Geral de Integração do Sistema Invicta"
                          >
                            <defs>
                              <marker id="boardDiagArrow" markerWidth="10" markerHeight="10" refX="8" refY="4" orient="auto">
                                <path d="M 0 0 L 10 4 L 0 8 z" fill="#64748b" />
                              </marker>
                              <marker id="boardDiagArrowHot" markerWidth="12" markerHeight="12" refX="9" refY="5" orient="auto">
                                <path d="M 0 0 L 11 5 L 0 10 z" fill="#f59e0b" />
                              </marker>
                            </defs>

                            {PIPELINE_EDGES.map((edge, idx) => {
                              const fromNode = PIPELINE_DIAGRAM_NODES.find((n) => n.key === edge.from);
                              const toNode = PIPELINE_DIAGRAM_NODES.find((n) => n.key === edge.to);
                              if (!fromNode || !toNode) return null;
                              const x1 = fromNode.x + fromNode.w / 2;
                              const y1 = fromNode.y + fromNode.h / 2;
                              const x2 = toNode.x + toNode.w / 2;
                              const y2 = toNode.y + toNode.h / 2;
                              const hot = currentStep?.relatedModule === edge.from || currentStep?.relatedModule === edge.to;
                              return (
                                <line
                                  key={idx}
                                  x1={x1}
                                  y1={y1}
                                  x2={x2}
                                  y2={y2}
                                  stroke={hot ? '#2563eb' : '#94a3b8'}
                                  strokeWidth={hot ? '3.2' : '2'}
                                  strokeDasharray={hot ? '8 5' : undefined}
                                  markerEnd={hot ? 'url(#boardDiagArrowHot)' : 'url(#boardDiagArrow)'}
                                />
                              );
                            })}

                            {PIPELINE_DIAGRAM_NODES.map((node) => {
                              const isHighlighted =
                                currentStep?.relatedModule === node.key ||
                                (currentStepIndex === 0 && node.key === 'prospection') ||
                                (currentStepIndex === 1 && node.key === 'config') ||
                                (currentStepIndex === 2 && ['prospection', 'appointments', 'admission'].includes(node.key)) ||
                                (currentStepIndex === 3 && ['audit', 'legal', 'negotiations', 'internal_messaging'].includes(node.key)) ||
                                (currentStepIndex === 4 && ['finance', 'collection', 'forms', 'backup_restore'].includes(node.key));
                              return (
                                <g
                                  key={node.key}
                                  onClick={() => selectModuleForStudy(node.key)}
                                  className="cursor-pointer"
                                >
                                  <rect
                                    x={node.x}
                                    y={node.y}
                                    width={node.w}
                                    height={node.h}
                                    rx="10"
                                    fill={isHighlighted ? '#1d4ed8' : '#ffffff'}
                                    stroke={isHighlighted ? '#f59e0b' : '#cbd5e1'}
                                    strokeWidth={isHighlighted ? '3' : '1.75'}
                                  />
                                  <text
                                    x={node.x + node.w / 2}
                                    y={node.y + 27}
                                    textAnchor="middle"
                                    fontSize="13.5"
                                    fontWeight="700"
                                    fill={isHighlighted ? '#ffffff' : '#0f172a'}
                                  >
                                    {node.short}
                                  </text>
                                  <text
                                    x={node.x + node.w / 2}
                                    y={node.y + 47}
                                    textAnchor="middle"
                                    fontSize="11"
                                    fill={isHighlighted ? '#bfdbfe' : '#64748b'}
                                  >
                                    {node.stage}
                                  </text>
                                </g>
                              );
                            })}

                            {/* Diagram Zone Focus Highlight Frame */}
                            {currentStep && (
                              <rect
                                x={Math.max(12, currentStep.toX - currentStep.boxW / 2)}
                                y={Math.max(12, currentStep.toY - currentStep.boxH / 2)}
                                width={Math.min(1076, currentStep.boxW)}
                                height={Math.min(316, currentStep.boxH)}
                                rx="14"
                                fill="#f59e0b"
                                fillOpacity="0.08"
                                stroke="#f59e0b"
                                strokeWidth="3.5"
                                strokeDasharray="12 8"
                                pointerEvents="none"
                              >
                                <animate
                                  attributeName="stroke-dashoffset"
                                  from="0"
                                  to="40"
                                  dur="1.6s"
                                  repeatCount="indefinite"
                                />
                              </rect>
                            )}
                          </svg>
                        </div>
                      ) : (
                        <>
                          {imgErrorKey === activeDoc.moduleKey ? (
                            <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center space-y-2 bg-slate-50 dark:bg-slate-900">
                              <div className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                                {activeDoc.title}
                              </div>
                              <p className="text-xs text-slate-600 max-w-md dark:text-slate-300">
                                {activeDoc.summary}
                              </p>
                            </div>
                          ) : (
                            <img
                              src={activeDoc.screenshotUrl}
                              alt={`Tela no quadro ${activeDoc.title}`}
                              onError={() => setImgErrorKey(activeDoc.moduleKey)}
                              className="absolute inset-0 w-full h-full object-fill block"
                            />
                          )}

                          {currentStep && (
                            <svg
                              viewBox="0 0 1440 900"
                              preserveAspectRatio="none"
                              className="absolute inset-0 w-full h-full pointer-events-none"
                            >
                              <defs>
                                <marker
                                  id="iviArrowHead"
                                  markerWidth="14"
                                  markerHeight="14"
                                  refX="10"
                                  refY="5"
                                  orient="auto"
                                >
                                  <path d="M 0 0 L 12 5 L 0 10 z" fill="#f59e0b" />
                                </marker>
                              </defs>

                              <rect
                                x={Math.max(10, currentStep.toX - currentStep.boxW / 2)}
                                y={Math.max(10, currentStep.toY - currentStep.boxH / 2)}
                                width={currentStep.boxW}
                                height={currentStep.boxH}
                                rx="14"
                                fill="#f59e0b"
                                fillOpacity="0.16"
                                stroke="#f59e0b"
                                strokeWidth="4"
                                strokeDasharray="12 8"
                              >
                                <animate
                                  attributeName="stroke-dashoffset"
                                  from="0"
                                  to="40"
                                  dur="1.4s"
                                  repeatCount="indefinite"
                                />
                                <animate
                                  attributeName="fill-opacity"
                                  values="0.10;0.28;0.10"
                                  dur="1.8s"
                                  repeatCount="indefinite"
                                />
                              </rect>

                              <path
                                d={arrowPathD}
                                fill="none"
                                stroke="#f59e0b"
                                strokeWidth="5"
                                strokeLinecap="round"
                                strokeDasharray="16 10"
                                markerEnd="url(#iviArrowHead)"
                              >
                                <animate
                                  attributeName="stroke-dashoffset"
                                  from="52"
                                  to="0"
                                  dur="1.2s"
                                  repeatCount="indefinite"
                                />
                              </path>

                              <circle cx={currentStep.fromX} cy={currentStep.fromY} r="10" fill="#2563eb" stroke="#ffffff" strokeWidth="3" />

                              <circle r="8" fill="#fde047" stroke="#b45309" strokeWidth="2.5">
                                <animateMotion dur="1.7s" repeatCount="indefinite" path={arrowPathD} />
                              </circle>
                            </svg>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* 2º BLOCO (SEMPRE ABAIXO DO QUADRO DA IVI): ITENS APRESENTADOS + FALA + CONTROLES */}
                <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-4 dark:border-slate-700 dark:bg-slate-900">
                  {/* Lista Horizontal de Itens Apresentados nesta Aula (Abaixo do Quadro da Ivi) */}
                  <div className="space-y-2 border-b border-slate-100 pb-3 dark:border-slate-800">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-bold text-slate-900 dark:text-slate-100">
                        Itens Apresentados no Quadro · {activeDoc.title} ({trainingSteps.length} etapas)
                      </span>
                      <span className="text-[11px] text-slate-500 dark:text-slate-400">
                        Clique em qualquer item para a Ivi detalhar no quadro
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {trainingSteps.map((st, idx) => {
                        const isCur = idx === currentStepIndex;
                        const isDone = completedSteps.includes(idx);
                        return (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => goToLessonStep(idx)}
                            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold border transition-colors ${
                              isCur
                                ? 'border-amber-500 bg-amber-50 text-amber-950 dark:bg-amber-950/50 dark:text-amber-200'
                                : isDone
                                ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800/70 dark:bg-emerald-950/40 dark:text-emerald-300'
                                : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                            }`}
                          >
                            <span className="font-mono">{idx + 1}.</span>
                            <span>{st.fieldLabel}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Explicação Conversacional da Ivi + Controles de Áudio e Navegação */}
                  <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-center">
                    <div className="xl:col-span-7">
                      {currentStep && (
                        <div className="rounded-xl border border-blue-200 bg-blue-50/70 p-3.5 space-y-2 dark:border-blue-800/70 dark:bg-blue-950/40">
                          <div className="flex items-center justify-between gap-2 text-[11px] font-bold text-blue-900 dark:text-blue-200">
                            <span>Em Explicação: {currentStep.fieldLabel}</span>
                            {completedSteps.includes(currentStepIndex) && (
                              <span className="text-emerald-700 dark:text-emerald-300">Concluído</span>
                            )}
                          </div>
                          <p className="text-xs text-slate-800 leading-relaxed dark:text-slate-100">
                            “{personalizedScript}”
                          </p>
                          {currentStep.fieldMeta && (
                            <div className="border-t border-blue-200/70 pt-2 text-[11px] text-slate-600 flex flex-wrap gap-x-4 gap-y-1 dark:border-blue-800/60 dark:text-slate-300">
                              <div>
                                <strong>Vem de:</strong> {humanizeDocText(currentStep.fieldMeta.originModule, moduleTitleMap)}
                              </div>
                              <div>
                                <strong>Segue para:</strong>{' '}
                                {humanizeDocText(currentStep.fieldMeta.destinationModule, moduleTitleMap)}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="xl:col-span-5 space-y-2">
                      <button
                        type="button"
                        disabled={busy || !currentStep}
                        onClick={handleSynthesizeStepAudio}
                        className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-blue-700 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-50"
                      >
                        {isPlayingNarration ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                        Ouvir Explicação em Áudio (abre dúvidas ao terminar)
                      </button>

                      {activeTtsHash && (
                        <CachedDocAudioPlayer
                          cacheHash={activeTtsHash.hash}
                          cached={activeTtsHash.cached}
                          autoPlay
                          label={`Narração Aula ${currentStepIndex + 1} (${selectedVoice})`}
                          onPlayStateChange={setIsPlayingNarration}
                          onEnded={() => openLessonDoubtChat()}
                        />
                      )}

                      <button
                        type="button"
                        disabled={!currentStep}
                        onClick={() => openLessonDoubtChat()}
                        className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200"
                      >
                        <MessageCircleQuestion className="w-3.5 h-3.5" />
                        Finalizar Explicação & Perguntar Dúvidas
                      </button>

                      <div className="flex items-center justify-between gap-2 pt-0.5">
                        <button
                          type="button"
                          disabled={currentStepIndex <= 0}
                          onClick={() => goToLessonStep(Math.max(0, currentStepIndex - 1))}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                        >
                          <ChevronLeft className="w-3.5 h-3.5" />
                          Anterior
                        </button>

                        <button
                          type="button"
                          onClick={() => goToLessonStep(currentStepIndex + 1, true)}
                          className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          {currentStepIndex + 1 < trainingSteps.length ? 'Sem Dúvidas · Próxima' : 'Avançar Próxima Tela'}
                          <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 3º BLOCO (ABAIXO): IDENTIFICAÇÃO DO TREINANDO & INÍCIO DO DIAGRAM -> TODAS AS TELAS */}
                <div className="rounded-xl border border-blue-200 bg-blue-50/70 p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3 dark:border-blue-800/70 dark:bg-blue-950/40">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-full overflow-hidden border-2 border-blue-300 bg-slate-900 shrink-0">
                      <img src={iviFullBodyImg} alt="Ivi Instrutora" className="w-full h-full object-cover object-top" />
                    </div>
                    <div className="space-y-1">
                      <div className="text-xs font-bold text-blue-950 dark:text-blue-100">
                        Treinando(a): {traineeNameInput} · Trilha: Diagrama Geral até Todas as {modules.length - 1} Telas
                      </div>
                      <p className="text-xs text-blue-900 dark:text-blue-200">
                        {resumedCheckpointInfo
                          ? resumedCheckpointInfo
                          : `Seu ponto de parada é salvo automaticamente a cada item concluído na sala de aula da Invicta.`}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (!traineeNameInput.trim()) return;
                        setTraineeConfirmed(true);
                        void saveTrainingProgress(currentStepIndex, completedSteps);
                      }}
                      className="flex flex-wrap items-center gap-2"
                    >
                      <input
                        type="text"
                        required
                        value={traineeNameInput}
                        onChange={(e) => {
                          setTraineeNameInput(e.target.value);
                          if (traineeConfirmed) setTraineeConfirmed(false);
                        }}
                        placeholder="Seu nome ou apelido..."
                        className="rounded-lg border border-blue-200 bg-white px-3 py-1.5 text-xs text-slate-900 dark:border-blue-700 dark:bg-slate-900 dark:text-slate-100"
                      />
                      <button
                        type="submit"
                        className="rounded-lg bg-blue-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-800"
                      >
                        {traineeConfirmed ? 'Salvar Nome' : 'Confirmar Nome'}
                      </button>
                    </form>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleStartNewTraining()}
                      title="Inicia um novo treinamento na sala de aula pelo Diagrama Geral de Integração seguindo tela a tela"
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                    >
                      <RotateCcw className="w-3.5 h-3.5 text-blue-700 dark:text-blue-300" />
                      Novo Treinamento (Começar do Diagrama)
                    </button>
                  </div>
                </div>

                {/* Quick Launcher Bar for Centered Doubt Chat & Live Voice */}
                <div className="rounded-xl border border-amber-200 bg-white p-4 flex flex-wrap items-center justify-between gap-3 dark:border-amber-800/60 dark:bg-slate-900">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-lg bg-amber-500 text-white flex items-center justify-center shrink-0">
                      <HelpCircle className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                        Dúvidas ao Final da Explicação · {currentStep?.fieldLabel || activeDoc.title}
                      </h3>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        Ao concluir cada explicação a caixa de perguntas abre no centro da tela. Sem dúvidas em 5s, a Ivi avança sozinha.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={openLessonDoubtChat}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3.5 py-2 text-xs font-semibold text-white hover:bg-amber-600"
                  >
                    <MessageCircleQuestion className="w-4 h-4" />
                    Abrir Janela de Dúvidas no Centro
                  </button>
                </div>

                {/* Mapa Geral Clicável de Todas as Telas do Sistema (Abaixo da Sala de Aula) */}
                <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3 dark:border-slate-700 dark:bg-slate-900">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <GitBranch className="w-4 h-4 text-blue-700 dark:text-blue-300" />
                      <div>
                        <h3 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                          Mapa de Integração Ponta a Ponta ({integrationGraph.nodes.length} telas)
                        </h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          Clique em qualquer tela no mapa abaixo para inspecionar seu funcionamento na sala de aula.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="overflow-x-auto scroll-rulers rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-950">
                    <svg viewBox="0 0 1100 365" className="w-full min-w-[780px] h-auto">
                      <defs>
                        <marker id="diagArrow" markerWidth="10" markerHeight="10" refX="8" refY="4" orient="auto">
                          <path d="M 0 0 L 10 4 L 0 8 z" fill="#64748b" />
                        </marker>
                        <marker id="diagArrowHot" markerWidth="10" markerHeight="10" refX="8" refY="4" orient="auto">
                          <path d="M 0 0 L 10 4 L 0 8 z" fill="#2563eb" />
                        </marker>
                      </defs>

                      {PIPELINE_EDGES.map((edge, idx) => {
                        const fromNode = PIPELINE_DIAGRAM_NODES.find((n) => n.key === edge.from);
                        const toNode = PIPELINE_DIAGRAM_NODES.find((n) => n.key === edge.to);
                        if (!fromNode || !toNode) return null;
                        const x1 = fromNode.x + fromNode.w / 2;
                        const y1 = fromNode.y + fromNode.h / 2;
                        const x2 = toNode.x + toNode.w / 2;
                        const y2 = toNode.y + toNode.h / 2;
                        const hot =
                          activeDoc.moduleKey === edge.from || activeDoc.moduleKey === edge.to;
                        return (
                          <line
                            key={idx}
                            x1={x1}
                            y1={y1}
                            x2={x2}
                            y2={y2}
                            stroke={hot ? '#2563eb' : '#94a3b8'}
                            strokeWidth={hot ? '3' : '1.75'}
                            strokeDasharray={hot ? '8 5' : undefined}
                            markerEnd={hot ? 'url(#diagArrowHot)' : 'url(#diagArrow)'}
                          >
                            {hot && (
                              <animate
                                attributeName="stroke-dashoffset"
                                from="26"
                                to="0"
                                dur="1.1s"
                                repeatCount="indefinite"
                              />
                            )}
                          </line>
                        );
                      })}

                      {PIPELINE_DIAGRAM_NODES.map((node) => {
                        const isSelected = activeDoc.moduleKey === node.key;
                        return (
                          <g
                            key={node.key}
                            onClick={() => selectModuleForStudy(node.key)}
                            className="cursor-pointer"
                          >
                            <rect
                              x={node.x}
                              y={node.y}
                              width={node.w}
                              height={node.h}
                              rx="10"
                              fill={isSelected ? '#1d4ed8' : '#ffffff'}
                              stroke={isSelected ? '#f59e0b' : '#cbd5e1'}
                              strokeWidth={isSelected ? '3' : '1.5'}
                            />
                            <text
                              x={node.x + node.w / 2}
                              y={node.y + 27}
                              textAnchor="middle"
                              fontSize="13.5"
                              fontWeight="700"
                              fill={isSelected ? '#ffffff' : '#0f172a'}
                            >
                              {node.short}
                            </text>
                            <text
                              x={node.x + node.w / 2}
                              y={node.y + 47}
                              textAnchor="middle"
                              fontSize="11"
                              fill={isSelected ? '#bfdbfe' : '#64748b'}
                            >
                              {node.stage}
                            </text>
                          </g>
                        );
                      })}
                    </svg>
                  </div>
                </div>
              </>
            )}

            {/* Grounded Q&A Panel (shared in both Static Docs & Training Mode) */}
            <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4 dark:border-slate-700 dark:bg-slate-900">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3 dark:border-slate-800">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-full overflow-hidden border border-blue-200 shrink-0">
                    <img src={iviFullBodyImg} alt="Ivi" className="w-full h-full object-cover object-top" />
                  </div>
                  <div>
                    <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                      Perguntar à Ivi sobre {activeDoc?.title || 'o Sistema'} (100% Baseada na Documentação)
                    </h3>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Respostas estritamente fundamentadas neste manual, mostrando módulo, campo, origem dos dados e destino.
                    </p>
                  </div>
                </div>
              </div>

              <form onSubmit={(e) => void handleAskDocQuestion(e)} className="space-y-2.5 text-xs">
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    value={qaQuestion}
                    onChange={(e) => setQaQuestion(e.target.value)}
                    placeholder={`Ex: De onde vêm os dados de ${activeDoc?.title || 'Admissão'} e para qual setor vão depois?`}
                    className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={toggleQaVoiceRecording}
                      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 font-semibold ${
                        recordingQa
                          ? 'bg-red-600 text-white hover:bg-red-700'
                          : 'border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200'
                      }`}
                    >
                      {recordingQa ? <Square className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5 text-blue-700 dark:text-blue-300" />}
                      {recordingQa ? 'Parar' : 'Falar'}
                    </button>
                    <button
                      type="submit"
                      disabled={busy || !qaQuestion.trim()}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-3.5 py-2 font-semibold text-white hover:bg-blue-800 disabled:opacity-50"
                    >
                      <Send className="w-3.5 h-3.5" />
                      Consultar Ivi
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-4 text-[11px] text-slate-600 dark:text-slate-300">
                  <label className="inline-flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={qaAllowLearn}
                      onChange={(e) => setQaAllowLearn(e.target.checked)}
                      className="rounded border-slate-300 text-blue-700"
                    />
                    <span>Permitir que a Ivi aprenda novo ponto de vista se coerente com os módulos</span>
                  </label>

                  <label className="inline-flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={qaWithAudio}
                      onChange={(e) => setQaWithAudio(e.target.checked)}
                      className="rounded border-slate-300 text-blue-700"
                    />
                    <span>Incluir resposta em áudio Gemini (armazenada em cache)</span>
                  </label>
                </div>
              </form>

              {qaResult && (
                <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-4 space-y-3 text-xs dark:border-blue-800/70 dark:bg-blue-950/30">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 font-bold text-blue-900 dark:text-blue-200">
                      <Bot className="w-4 h-4" />
                      Resposta Ivi ({qaResult.provider})
                    </span>
                    {qaResult.learnedArticle && (
                      <span className="inline-flex items-center gap-1 rounded-md bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200">
                        <Sparkles className="w-3 h-3" />
                        Novo aprendizado salvo na base
                      </span>
                    )}
                  </div>

                  <p className="text-slate-800 whitespace-pre-wrap leading-relaxed dark:text-slate-100">
                    {qaResult.answer}
                  </p>

                  {qaResult.audioCacheHash && (
                    <CachedDocAudioPlayer
                      cacheHash={qaResult.audioCacheHash}
                      cached={qaResult.audioCached}
                      label="Áudio da Resposta Ivi (Gemini Cache)"
                    />
                  )}

                  {qaResult.citedFields.length > 0 && (
                    <div className="border-t border-blue-200/70 pt-2.5 space-y-1.5 dark:border-blue-800/60">
                      <div className="text-[11px] font-bold text-blue-900 dark:text-blue-200">
                        Campos & Integrações Citados:
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        {qaResult.citedFields.map((cf, i) => (
                          <div
                            key={i}
                            className="rounded-lg border border-blue-100 bg-white px-2.5 py-2 text-[11px] dark:border-blue-900/60 dark:bg-slate-900"
                          >
                            <div className="font-semibold text-slate-900 dark:text-slate-100">
                              {cf.fieldLabel}{' '}
                              <span className="text-[10px] font-medium text-slate-500">
                                ({moduleTitleMap[cf.moduleKey] || cf.moduleKey})
                              </span>
                            </div>
                            <div className="text-slate-600 dark:text-slate-300">
                              Vem de: <strong>{humanizeDocText(cf.originModule, moduleTitleMap)}</strong> → Segue para:{' '}
                              <strong>{humanizeDocText(cf.destinationModule, moduleTitleMap)}</strong>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {qaHistory.length > 0 && (
                <div className="border-t border-slate-100 pt-3 space-y-2 dark:border-slate-800">
                  <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider dark:text-slate-400">
                    Histórico desta Sessão ({qaHistory.length})
                  </div>
                  <div className="space-y-2 max-h-48 overflow-y-auto scroll-rulers">
                    {qaHistory.map((item) => (
                      <div
                        key={item.id}
                        className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs dark:border-slate-800 dark:bg-slate-800/60"
                      >
                        <div className="font-semibold text-slate-900 dark:text-slate-100">P: {item.question}</div>
                        <div className="text-slate-600 mt-0.5 line-clamp-2 dark:text-slate-300">R: {item.answer}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODO 3: GESTÃO ADMINISTRATIVA EXCLUSIVA (DOCS, BASE IVI & CACHE AUDIO)*/}
      {/* ===================================================================== */}
      {mode === 'admin' && isAdmin && (
        <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4 dark:border-slate-700 dark:bg-slate-900">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3 dark:border-slate-700">
            <div className="flex flex-wrap items-center gap-1.5 bg-slate-100 p-1 rounded-lg dark:bg-slate-800">
              {[
                { id: 'modules', label: `Módulos & Campos (${modules.length})` },
                { id: 'kb_docs', label: `Base Ivi · Docs & Aprendizados (${docsKbArticles.length})` },
                { id: 'kb_prospection', label: `Base Ivi · Prospecção (${prospectionKbArticles.length})` },
                { id: 'audio_cache', label: `Cache de Áudios Gemini (${audioCacheItems.length})` },
              ].map((st) => (
                <button
                  key={st.id}
                  type="button"
                  onClick={() => setAdminTab(st.id as typeof adminTab)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                    adminTab === st.id
                      ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-slate-100'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-300'
                  }`}
                >
                  {st.label}
                </button>
              ))}
            </div>

            {adminTab === 'modules' && (
              <button
                type="button"
                onClick={() => setNewModuleModalOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
              >
                <Plus className="w-3.5 h-3.5" />
                Novo Módulo na Documentação
              </button>
            )}

            {(adminTab === 'kb_docs' || adminTab === 'kb_prospection') && (
              <button
                type="button"
                onClick={() => {
                  setKbEditingId(null);
                  setKbScope(adminTab === 'kb_prospection' ? 'prospection' : 'system_doc');
                  setKbModuleKey(adminTab === 'kb_prospection' ? 'prospection' : activeDoc?.moduleKey || 'overview');
                  setKbQuestion('');
                  setKbAnswer('');
                  setKbCategory(adminTab === 'kb_prospection' ? 'prospeccao' : 'documentacao');
                  setKbActive(true);
                  setKbFormOpen(true);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-800"
              >
                <Plus className="w-3.5 h-3.5" />
                Incluir Conhecimento
              </button>
            )}
          </div>

          {/* Subtab 1: Module Documentation CRUD */}
          {adminTab === 'modules' && (
            <div className="space-y-4">
              {editingDoc ? (
                <form
                  onSubmit={handleSaveEditingDoc}
                  className="rounded-xl border border-blue-200 bg-blue-50/40 p-4 space-y-4 text-xs dark:border-blue-800/70 dark:bg-blue-950/20"
                >
                  <div className="flex items-center justify-between border-b border-blue-200/70 pb-2.5 dark:border-blue-800/60">
                    <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                      Editando Módulo: {editingDoc.title} ({editingDoc.moduleKey})
                    </h3>
                    <button
                      type="button"
                      onClick={() => setEditingDoc(null)}
                      className="text-slate-500 hover:text-slate-900 dark:text-slate-400"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block font-semibold mb-1">Título</label>
                      <input
                        type="text"
                        required
                        value={editingDoc.title}
                        onChange={(e) => setEditingDoc({ ...editingDoc, title: e.target.value })}
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold mb-1">Caminho do Menu</label>
                      <input
                        type="text"
                        value={editingDoc.menuPath}
                        onChange={(e) => setEditingDoc({ ...editingDoc, menuPath: e.target.value })}
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold mb-1">Screenshot URL</label>
                      <input
                        type="text"
                        value={editingDoc.screenshotUrl}
                        onChange={(e) => setEditingDoc({ ...editingDoc, screenshotUrl: e.target.value })}
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono dark:border-slate-700 dark:bg-slate-900"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block font-semibold mb-1">Resumo do Módulo</label>
                      <textarea
                        rows={3}
                        value={editingDoc.summary}
                        onChange={(e) => setEditingDoc({ ...editingDoc, summary: e.target.value })}
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold mb-1">Objetivo Operacional</label>
                      <textarea
                        rows={3}
                        value={editingDoc.objective}
                        onChange={(e) => setEditingDoc({ ...editingDoc, objective: e.target.value })}
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900"
                      />
                    </div>
                  </div>

                  {/* Fields Editor */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-900 dark:text-slate-100">
                        Campos Documentados ({editingDoc.fieldsJson.length})
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          const newField: SystemDocFieldDef = {
                            fieldName: 'novo_campo',
                            fieldLabel: 'Novo Campo',
                            fieldType: 'Texto',
                            description: 'Explicação operacional do campo.',
                            originModule: 'Entrada do usuário',
                            destinationModule: 'PostgreSQL & Auditoria',
                          };
                          setEditingDoc({
                            ...editingDoc,
                            fieldsJson: [...editingDoc.fieldsJson, newField],
                          });
                        }}
                        className="inline-flex items-center gap-1 rounded border border-blue-200 bg-white px-2.5 py-1 font-semibold text-blue-700 hover:bg-blue-50 dark:border-blue-800 dark:bg-slate-900 dark:text-blue-300"
                      >
                        <Plus className="w-3 h-3" />
                        Adicionar Campo
                      </button>
                    </div>
                    <div className="space-y-2 max-h-64 overflow-y-auto scroll-rulers pr-1">
                      {editingDoc.fieldsJson.map((f, idx) => (
                        <div
                          key={idx}
                          className="rounded-lg border border-slate-200 bg-white p-2.5 grid grid-cols-1 sm:grid-cols-12 gap-2 items-start dark:border-slate-700 dark:bg-slate-900"
                        >
                          <input
                            type="text"
                            value={f.fieldLabel}
                            onChange={(e) => {
                              const copy = [...editingDoc.fieldsJson];
                              copy[idx] = { ...f, fieldLabel: e.target.value };
                              setEditingDoc({ ...editingDoc, fieldsJson: copy });
                            }}
                            placeholder="Label do campo"
                            className="sm:col-span-2 rounded border border-slate-200 px-2 py-1 dark:border-slate-700 dark:bg-slate-950"
                          />
                          <input
                            type="text"
                            value={f.description}
                            onChange={(e) => {
                              const copy = [...editingDoc.fieldsJson];
                              copy[idx] = { ...f, description: e.target.value };
                              setEditingDoc({ ...editingDoc, fieldsJson: copy });
                            }}
                            placeholder="Explicação"
                            className="sm:col-span-4 rounded border border-slate-200 px-2 py-1 dark:border-slate-700 dark:bg-slate-950"
                          />
                          <input
                            type="text"
                            value={f.originModule}
                            onChange={(e) => {
                              const copy = [...editingDoc.fieldsJson];
                              copy[idx] = { ...f, originModule: e.target.value };
                              setEditingDoc({ ...editingDoc, fieldsJson: copy });
                            }}
                            placeholder="Origem"
                            className="sm:col-span-2 rounded border border-slate-200 px-2 py-1 dark:border-slate-700 dark:bg-slate-950"
                          />
                          <input
                            type="text"
                            value={f.destinationModule}
                            onChange={(e) => {
                              const copy = [...editingDoc.fieldsJson];
                              copy[idx] = { ...f, destinationModule: e.target.value };
                              setEditingDoc({ ...editingDoc, fieldsJson: copy });
                            }}
                            placeholder="Destino"
                            className="sm:col-span-3 rounded border border-slate-200 px-2 py-1 dark:border-slate-700 dark:bg-slate-950"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              const copy = editingDoc.fieldsJson.filter((_, i) => i !== idx);
                              setEditingDoc({ ...editingDoc, fieldsJson: copy });
                            }}
                            className="sm:col-span-1 rounded border border-red-200 bg-red-50 p-1.5 text-red-700 hover:bg-red-100 flex items-center justify-center dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300"
                            title="Remover campo"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-2">
                    <label className="inline-flex items-center gap-2 font-semibold">
                      <input
                        type="checkbox"
                        checked={editingDoc.active}
                        onChange={(e) => setEditingDoc({ ...editingDoc, active: e.target.checked })}
                        className="rounded border-slate-300 text-blue-700"
                      />
                      Módulo ativo no treinamento e na base da Ivi
                    </label>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setEditingDoc(null)}
                        className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                      >
                        Cancelar
                      </button>
                      <button
                        type="submit"
                        disabled={busy}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 font-semibold text-white hover:bg-emerald-700"
                      >
                        <Save className="w-3.5 h-3.5" />
                        Salvar Alterações
                      </button>
                    </div>
                  </div>
                </form>
              ) : (
                <div className="overflow-x-auto scroll-rulers">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-500 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-400">
                        <th className="py-2.5 px-4">Módulo</th>
                        <th className="py-2.5 px-3">Menu</th>
                        <th className="py-2.5 px-3">Campos</th>
                        <th className="py-2.5 px-3">Passos</th>
                        <th className="py-2.5 px-3">Status</th>
                        <th className="py-2.5 px-4 text-right">Ações (Admin)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {modules.map((m) => (
                        <tr key={m.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/50">
                          <td className="py-2.5 px-4">
                            <div className="font-semibold text-slate-900 dark:text-slate-100">{m.title}</div>
                            <div className="font-mono text-[10px] text-slate-400">{m.moduleKey}</div>
                          </td>
                          <td className="py-2.5 px-3 text-slate-600 dark:text-slate-300">{m.menuGroup}</td>
                          <td className="py-2.5 px-3 font-mono">{m.fieldsJson?.length || 0}</td>
                          <td className="py-2.5 px-3 font-mono">{m.trainingStepsJson?.length || 0}</td>
                          <td className="py-2.5 px-3">
                            <span
                              className={`font-semibold ${
                                m.active ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'
                              }`}
                            >
                              {m.active ? 'Ativo' : 'Inativo'}
                            </span>
                          </td>
                          <td className="py-2.5 px-4 text-right space-x-2 whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => setEditingDoc(m)}
                              className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                            >
                              <Pencil className="w-3 h-3" />
                              Editar
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleDeleteModuleDoc(m.id, m.title)}
                              className="inline-flex items-center gap-1 rounded border border-red-200 bg-red-50 px-2.5 py-1 text-[11px] font-semibold text-red-700 hover:bg-red-100 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300"
                            >
                              <Trash2 className="w-3 h-3" />
                              Excluir
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Subtab 2 & 3: Knowledge Base CRUD (Docs & Prospecção) */}
          {(adminTab === 'kb_docs' || adminTab === 'kb_prospection') && (
            <div className="space-y-4">
              {kbFormOpen && (
                <form
                  onSubmit={handleSaveKbArticle}
                  className="rounded-xl border border-blue-200 bg-blue-50/50 p-4 space-y-3 text-xs dark:border-blue-800/70 dark:bg-blue-950/20"
                >
                  <div className="flex items-center justify-between">
                    <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                      {kbEditingId ? 'Editar Artigo da Base Ivi' : 'Incluir Conhecimento na Base Ivi'}
                    </h3>
                    <button
                      type="button"
                      onClick={() => setKbFormOpen(false)}
                      className="text-slate-500 hover:text-slate-900 dark:text-slate-400"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <div>
                      <label className="block font-semibold mb-1">Escopo</label>
                      <select
                        value={kbScope}
                        onChange={(e) =>
                          setKbScope(e.target.value as 'system_doc' | 'learned_insight' | 'prospection')
                        }
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900"
                      >
                        <option value="system_doc">Documentação / Treinamento</option>
                        <option value="learned_insight">Aprendizado Coerente (Treinamento)</option>
                        <option value="prospection">Prospecção Comercial (Atendimento)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block font-semibold mb-1">Módulo Associado</label>
                      <select
                        value={kbModuleKey}
                        onChange={(e) => setKbModuleKey(e.target.value)}
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900"
                      >
                        <option value="">Geral</option>
                        {modules.map((m) => (
                          <option key={m.moduleKey} value={m.moduleKey}>
                            {m.title}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block font-semibold mb-1">Categoria</label>
                      <input
                        type="text"
                        value={kbCategory}
                        onChange={(e) => setKbCategory(e.target.value)}
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block font-semibold mb-1">Pergunta / Assunto *</label>
                    <input
                      type="text"
                      required
                      value={kbQuestion}
                      onChange={(e) => setKbQuestion(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900"
                    />
                  </div>

                  <div>
                    <label className="block font-semibold mb-1">Conteúdo / Resposta Oficial da Ivi *</label>
                    <textarea
                      rows={3}
                      required
                      value={kbAnswer}
                      onChange={(e) => setKbAnswer(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900"
                    />
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="inline-flex items-center gap-2 font-semibold">
                      <input
                        type="checkbox"
                        checked={kbActive}
                        onChange={(e) => setKbActive(e.target.checked)}
                        className="rounded border-slate-300 text-blue-700"
                      />
                      Ativo nas respostas da Ivi
                    </label>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setKbFormOpen(false)}
                        className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                      >
                        Cancelar
                      </button>
                      <button
                        type="submit"
                        disabled={busy}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-1.5 font-semibold text-white hover:bg-emerald-700"
                      >
                        <Save className="w-3.5 h-3.5" />
                        Salvar na Base
                      </button>
                    </div>
                  </div>
                </form>
              )}

              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {(adminTab === 'kb_docs' ? docsKbArticles : prospectionKbArticles).map((art) => (
                  <div key={art.id} className="py-3 space-y-1.5 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-blue-700 dark:text-blue-300">
                          {art.scope === 'prospection'
                            ? 'Prospecção Comercial'
                            : art.scope === 'learned_insight'
                            ? 'Aprendizado Coerente'
                            : 'Documentação Oficial'}{' '}
                          · {art.moduleKey ? moduleTitleMap[art.moduleKey] || art.moduleKey : 'Geral'}
                        </span>
                        {!art.active && (
                          <span className="font-mono text-[10px] text-amber-700 dark:text-amber-300">[INATIVO]</span>
                        )}
                        <span className="font-mono text-[11px] text-slate-400">{art.hitCount} usos</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={async () => {
                            const res = await apiFetch<{ cacheHash: string; audioUrl: string; cached: boolean }>(
                              '/api/ivi/tts',
                              {
                                method: 'POST',
                                body: JSON.stringify({
                                  text: art.answerTemplate,
                                  sourceType: art.scope === 'prospection' ? 'prospection' : 'static_doc',
                                  moduleKey: art.moduleKey,
                                }),
                              }
                            );
                            if (res.audioUrl) {
                              setAdminAudioPreview({ id: art.id, hash: res.cacheHash, cached: res.cached });
                            }
                          }}
                          className="inline-flex items-center gap-1 rounded border border-blue-200 bg-blue-50 px-2 py-1 text-[11px] font-semibold text-blue-800 hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950/50 dark:text-blue-300"
                        >
                          <Volume2 className="w-3 h-3" />
                          Gerar/Ouvir Áudio
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setKbEditingId(art.id);
                            setKbScope(
                              (art.scope as 'system_doc' | 'learned_insight' | 'prospection') || 'system_doc'
                            );
                            setKbModuleKey(art.moduleKey || '');
                            setKbQuestion(art.questionPattern);
                            setKbAnswer(art.answerTemplate);
                            setKbCategory(art.category || 'orientacao');
                            setKbActive(art.active);
                            setKbFormOpen(true);
                          }}
                          className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                        >
                          <Pencil className="w-3 h-3" />
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDeleteKbArticle(art.id)}
                          className="inline-flex items-center gap-1 rounded border border-red-200 bg-red-50 px-2 py-1 text-[11px] font-semibold text-red-700 hover:bg-red-100 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300"
                        >
                          <Trash2 className="w-3 h-3" />
                          Excluir
                        </button>
                      </div>
                    </div>
                    <div className="font-semibold text-sm text-slate-900 dark:text-slate-100">
                      {art.questionPattern}
                    </div>
                    <p className="text-slate-600 leading-relaxed dark:text-slate-300">{art.answerTemplate}</p>
                    {adminAudioPreview?.id === art.id && (
                      <CachedDocAudioPlayer
                        cacheHash={adminAudioPreview.hash}
                        cached={adminAudioPreview.cached}
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Subtab 4: Gemini Audio Cache Manager (Token Economy) */}
          {adminTab === 'audio_cache' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/70">
                  <div className="text-slate-500 dark:text-slate-400">Áudios & Transcrições</div>
                  <div className="mt-1 font-mono text-xl font-bold text-slate-900 dark:text-slate-100">
                    {audioStats.count}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/70">
                  <div className="text-slate-500 dark:text-slate-400">Reproduções Totais</div>
                  <div className="mt-1 font-mono text-xl font-bold text-blue-700 dark:text-blue-300">
                    {audioStats.totalHits}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/70">
                  <div className="text-slate-500 dark:text-slate-400">Tokens Economizados</div>
                  <div className="mt-1 font-mono text-xl font-bold text-emerald-700 dark:text-emerald-300">
                    {audioStats.totalTokensSaved}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/70">
                  <div className="text-slate-500 dark:text-slate-400">Armazenamento DB</div>
                  <div className="mt-1 font-mono text-xl font-bold text-slate-900 dark:text-slate-100">
                    {Math.round((audioStats.totalBytes || 0) / 1024)} KB
                  </div>
                </div>
              </div>

              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {audioCacheItems.map((item) => (
                  <div key={item.id} className="py-3 space-y-2 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-blue-700 dark:text-blue-300">
                          {item.sourceType} · {item.moduleKey || 'geral'} · Voz {item.voiceName}
                        </span>
                        <span className="font-mono text-[11px] text-slate-500">
                          {item.hitCount}x reutilizado · {item.tokensSavedEstimate} tokens poupados ·{' '}
                          {formatDateTimeBR(item.lastUsedAt)}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleDeleteAudioCache(item.id)}
                        className="inline-flex items-center gap-1 rounded border border-red-200 bg-red-50 px-2 py-1 text-[11px] font-semibold text-red-700 hover:bg-red-100 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300"
                      >
                        <Trash2 className="w-3 h-3" />
                        Remover
                      </button>
                    </div>
                    <p className="text-slate-700 dark:text-slate-200">{item.textContent}</p>
                    {item.sizeBytes > 0 && item.sourceType !== 'transcription' && (
                      <CachedDocAudioPlayer
                        cacheHash={item.cacheHash}
                        cached
                        label={`Cache WAV (${Math.round(item.sizeBytes / 1024)} KB)`}
                      />
                    )}
                  </div>
                ))}
                {audioCacheItems.length === 0 && (
                  <p className="py-6 text-center text-xs text-slate-400">
                    Nenhum áudio armazenado no cache Gemini ainda. Ao clicar em "Ouvir Explicação" no Treinamento ou Prospecção, os WAVs ficam salvos aqui automaticamente.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Modal: Full Screenshot Zoom */}
      {zoomScreenshotOpen && activeDoc && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-4"
          onClick={() => setZoomScreenshotOpen(false)}
        >
          <div
            className="w-full max-w-6xl rounded-2xl border border-slate-700 bg-slate-900 p-4 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between text-white">
              <div>
                <h3 className="font-display text-sm font-bold">
                  Captura Oficial · {activeDoc.title} ({activeDoc.menuPath})
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setZoomScreenshotOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <img
              src={activeDoc.screenshotUrl}
              alt={activeDoc.title}
              className="w-full max-h-[82vh] object-contain rounded-xl border border-slate-700 bg-slate-950"
            />
          </div>
        </div>
      )}

      {/* Modal: Admin New Module Documentation */}
      {newModuleModalOpen && isAdmin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 dark:bg-slate-950/80">
          <form
            onSubmit={handleCreateModuleDoc}
            className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl space-y-3 text-xs dark:border-slate-700 dark:bg-slate-900"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-2.5 dark:border-slate-800">
              <h3 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                Novo Módulo na Documentação da Ivi
              </h3>
              <button type="button" onClick={() => setNewModuleModalOpen(false)} className="text-slate-400">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block font-semibold mb-1">Chave do Módulo *</label>
                <input
                  type="text"
                  required
                  value={newModKey}
                  onChange={(e) => setNewModKey(e.target.value)}
                  placeholder="ex: auditoria_especial"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono dark:border-slate-700 dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Grupo no Menu</label>
                <input
                  type="text"
                  value={newModGroup}
                  onChange={(e) => setNewModGroup(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-950"
                />
              </div>
            </div>
            <div>
              <label className="block font-semibold mb-1">Título *</label>
              <input
                type="text"
                required
                value={newModTitle}
                onChange={(e) => setNewModTitle(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-950"
              />
            </div>
            <div>
              <label className="block font-semibold mb-1">Caminho do Menu</label>
              <input
                type="text"
                value={newModPath}
                onChange={(e) => setNewModPath(e.target.value)}
                placeholder="Ex: Operação & Tratativa → Novo Módulo"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-950"
              />
            </div>
            <div>
              <label className="block font-semibold mb-1">URL da Captura de Tela</label>
              <input
                type="text"
                value={newModScreenshot}
                onChange={(e) => setNewModScreenshot(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono dark:border-slate-700 dark:bg-slate-950"
              />
            </div>
            <div>
              <label className="block font-semibold mb-1">Resumo</label>
              <textarea
                rows={2}
                value={newModSummary}
                onChange={(e) => setNewModSummary(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-950"
              />
            </div>
            <div>
              <label className="block font-semibold mb-1">Objetivo</label>
              <textarea
                rows={2}
                value={newModObjective}
                onChange={(e) => setNewModObjective(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-950"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setNewModuleModalOpen(false)}
                className="rounded-lg border border-slate-200 px-4 py-2 font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={busy}
                className="rounded-lg bg-emerald-600 px-4 py-2 font-semibold text-white hover:bg-emerald-700"
              >
                Cadastrar Módulo
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal Centralizado: Perguntas e Dúvidas ao Término da Explicação (Auto-avanço em 5s sem dúvidas) */}
      {lessonDoubtOpen && activeDoc && currentStep && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-4 backdrop-blur-[2px]">
          <div className="w-full max-w-2xl rounded-2xl border border-amber-300 bg-white p-5 shadow-2xl space-y-4 text-xs dark:border-amber-700 dark:bg-slate-900">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-3 dark:border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-full overflow-hidden border-2 border-amber-400 bg-slate-900 shrink-0">
                  <img src={iviFullBodyImg} alt="Ivi Instrutora" className="w-full h-full object-cover object-top" />
                </div>
                <div>
                  <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                    Ficou alguma dúvida, {activeTraineeName}? · {currentStep.fieldLabel}
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Pergunte por texto ou áudio ao vivo para a Ivi, ou clique em Sem Dúvidas para seguir.
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {lessonDoubtCountdown !== null && (
                  <span className="inline-flex items-center gap-1.5 rounded-lg bg-amber-100 px-2.5 py-1.5 text-[11px] font-bold text-amber-900 dark:bg-amber-950/60 dark:text-amber-200">
                    Próxima aula automática em {lessonDoubtCountdown}s
                    <button
                      type="button"
                      onClick={() => setLessonDoubtCountdown(null)}
                      className="underline ml-1"
                    >
                      Pausar
                    </button>
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setLessonDoubtOpen(false)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:text-white dark:hover:bg-slate-800"
                  title="Fechar janela"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {lessonAutoAdvanceMsg && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-200">
                {lessonAutoAdvanceMsg}
              </div>
            )}

            <div className="space-y-2 max-h-56 overflow-y-auto scroll-rulers pr-1">
              {lessonChatMessages.map((msg) => (
                <div
                  key={msg.id}
                  className={`rounded-xl px-3.5 py-2.5 text-xs space-y-2 ${
                    msg.sender === 'user'
                      ? 'bg-slate-100 text-slate-900 ml-8 dark:bg-slate-800 dark:text-slate-100'
                      : msg.outOfContext
                      ? 'border border-amber-300 bg-amber-50 text-amber-950 mr-6 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100'
                      : 'border border-blue-200 bg-blue-50/70 text-slate-900 mr-6 dark:border-blue-800/70 dark:bg-blue-950/40 dark:text-slate-100'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 text-[10px] font-bold">
                    <span>{msg.sender === 'user' ? activeTraineeName : 'Ivi Instrutora'}</span>
                    {msg.outOfContext && (
                      <span className="text-amber-700 dark:text-amber-300">
                        Fora de Contexto · Próxima Aula
                      </span>
                    )}
                  </div>
                  <p className="leading-relaxed whitespace-pre-wrap">{msg.text}</p>
                  {msg.audioCacheHash && (
                    <CachedDocAudioPlayer
                      cacheHash={msg.audioCacheHash}
                      cached={msg.audioCached}
                      autoPlay
                      label="Resposta Falada da Ivi (Gemini Audio)"
                    />
                  )}
                </div>
              ))}
            </div>

            <form onSubmit={(e) => void handleAskLessonDoubt(e)} className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={lessonDoubtInput}
                onFocus={() => setLessonDoubtCountdown(null)}
                onChange={(e) => {
                  setLessonDoubtInput(e.target.value);
                  setLessonDoubtCountdown(null);
                }}
                placeholder={`Digite sua dúvida, ${activeTraineeName}, ou clique em Sem Dúvidas...`}
                className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
              <button
                type="submit"
                disabled={busy || !lessonDoubtInput.trim()}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-700 px-4 py-2 font-semibold text-white hover:bg-blue-800 disabled:opacity-50"
              >
                <Send className="w-3.5 h-3.5" />
                Perguntar à Ivi
              </button>
            </form>

            {/* Conversa por Voz em Tempo Real (Gemini 3.8 Live) */}
            <IviLiveVoicePanel
              traineeName={activeTraineeName}
              moduleKey={activeDoc.moduleKey}
              fieldLabel={currentStep.fieldLabel}
              fieldDescription={currentStep.scriptText}
              originModule={humanizeDocText(currentStep.fieldMeta?.originModule || 'Tela Anterior', moduleTitleMap)}
              destinationModule={humanizeDocText(
                currentStep.fieldMeta?.destinationModule || 'Próxima Etapa',
                moduleTitleMap
              )}
              voiceName={selectedVoice}
              onSpeakingChange={(speaking) => {
                setIsLiveSpeaking(speaking);
                if (speaking) setLessonDoubtCountdown(null);
              }}
              onUserSpeechEnded={() => setLessonDoubtCountdown(null)}
              onTranscriptMessage={(speaker, text) => {
                setLessonDoubtCountdown(null);
                setLessonDoubtOpen(true);
                setLessonChatMessages((prev) => [
                  ...prev,
                  {
                    id: `live-${speaker}-${Date.now()}`,
                    sender: speaker === 'user' ? 'user' : 'ivi',
                    text,
                    createdAt: new Date().toISOString(),
                  },
                ]);
              }}
              onLiveAction={(action) => {
                if (action === 'advance_next') {
                  setLessonAutoAdvanceMsg(
                    `Zero dúvidas na conversa ao vivo, ${activeTraineeName}! Avançando para a próxima aula...`
                  );
                  autoAdvanceTimeoutRef.current = setTimeout(() => {
                    goToLessonStep(currentStepIndex + 1, true);
                  }, 1800);
                } else if (action === 'out_of_context_advance') {
                  setLessonAutoAdvanceMsg(
                    `Pergunta divertida fora de contexto! 😂 Bora voltar pro foco na próxima aula...`
                  );
                  autoAdvanceTimeoutRef.current = setTimeout(() => {
                    goToLessonStep(currentStepIndex + 1, true);
                  }, 2800);
                }
              }}
            />

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                Aula {currentStepIndex + 1} de {trainingSteps.length} · Módulo {activeDoc.sortOrder} de {modules.length}
              </span>
              <button
                type="button"
                onClick={() =>
                  goToLessonStep(
                    currentStepIndex + 1,
                    true,
                    `Tudo entendido, ${activeTraineeName}! Seguindo para a próxima aula.`
                  )
                }
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
              >
                <CheckCircle2 className="w-4 h-4" />
                {currentStepIndex + 1 < trainingSteps.length
                  ? 'Sem Dúvidas · Próxima Aula'
                  : 'Sem Dúvidas · Próximo Módulo'}
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
