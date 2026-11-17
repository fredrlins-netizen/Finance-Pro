import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  ArrowUpRight,
  Bot,
  Calendar,
  CheckCircle2,
  Download,
  Eye,
  FileAudio,
  History,
  Mic,
  Pencil,
  Phone,
  PhoneCall,
  PhoneOff,
  Plus,
  Save,
  Send,
  Sparkles,
  Square,
  Trash2,
  Upload,
  UserCheck,
  UserPen,
  Volume2,
  X,
} from 'lucide-react';
import iviAvatarImg from '../../assets/images/ivi_avatar_1794682376813.jpg';
import { apiFetch, formatDateTimeBR, getAuthToken } from '../../lib/api.ts';
import {
  Appointment,
  AuthUser,
  CommunicationArchiveItem,
  ModuleId,
  NavigationIntent,
  ProspectionLead,
  ScheduleBlock,
  Unit,
  WhatsappCallLogItem,
} from '../../types.ts';
import { CollapsibleFilterBar } from '../CollapsibleFilterBar.tsx';
import { EntityAuditModal } from './cadastros/CadastrosShared.tsx';

const SecureBucketAudio: React.FC<{
  sha256: string;
  fileName?: string;
}> = ({ sha256, fileName }) => {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    let currentUrl: string | null = null;
    setLoading(true);
    setError('');
    fetch(`/api/bucket/objects/${sha256}?preview=1`, {
      headers: { Authorization: `Bearer ${getAuthToken()}` },
    })
      .then(async (resp) => {
        if (!resp.ok) throw new Error('Objeto indisponível');
        return resp.blob();
      })
      .then((blob) => {
        if (!active) return;
        currentUrl = URL.createObjectURL(blob);
        setObjectUrl(currentUrl);
      })
      .catch(() => {
        if (active) setError('Não foi possível carregar o áudio do BucketDaInvicta.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      if (currentUrl) URL.revokeObjectURL(currentUrl);
    };
  }, [sha256]);

  return (
    <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-2 space-y-1 dark:border-slate-700 dark:bg-slate-800/70">
      <div className="flex items-center justify-between gap-2 text-[10px] text-slate-500 dark:text-slate-400">
        <span className="inline-flex items-center gap-1 font-medium text-slate-700 truncate dark:text-slate-200">
          <Volume2 className="w-3 h-3 text-blue-700 shrink-0 dark:text-blue-300" />
          {fileName || 'Áudio arquivado (BucketDaInvicta)'}
        </span>
        <span className="font-mono tabular-nums shrink-0">{sha256.slice(0, 10)}</span>
      </div>
      {loading && <div className="text-[10px] text-slate-400 dark:text-slate-400">Decriptando áudio do bucket...</div>}
      {error && <div className="text-[10px] text-red-600 dark:text-red-400">{error}</div>}
      {objectUrl && (
        <audio controls preload="metadata" className="w-full h-8" src={objectUrl} />
      )}
    </div>
  );
};

const CachedIviAudioPlayer: React.FC<{
  cacheHash: string;
  cached?: boolean;
  label?: string;
}> = ({ cacheHash, cached, label }) => {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    let currentUrl: string | null = null;
    setLoading(true);
    setError('');
    fetch(`/api/ivi/audio/${cacheHash}`, {
      headers: { Authorization: `Bearer ${getAuthToken()}` },
    })
      .then(async (resp) => {
        if (!resp.ok) throw new Error('Áudio indisponível');
        return resp.blob();
      })
      .then((blob) => {
        if (!active) return;
        currentUrl = URL.createObjectURL(blob);
        setObjectUrl(currentUrl);
      })
      .catch(() => {
        if (active) setError('Não foi possível reproduzir o áudio em cache.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      if (currentUrl) URL.revokeObjectURL(currentUrl);
    };
  }, [cacheHash]);

  return (
    <div className="mt-2 rounded-md border border-blue-200 bg-white/95 px-2.5 py-2 space-y-1 dark:border-blue-800/70 dark:bg-slate-900/90">
      <div className="flex items-center justify-between gap-2 text-[10px] text-slate-600 dark:text-slate-300">
        <span className="inline-flex items-center gap-1 font-semibold text-blue-800 truncate dark:text-blue-300">
          <Volume2 className="w-3 h-3 shrink-0" />
          {label || 'Resposta Verbal Ivi (Gemini Audio)'}
        </span>
        <span className="font-mono text-[10px] shrink-0 text-emerald-700 dark:text-emerald-300">
          {cached ? 'Cache DB · 0 tokens' : `WAV · ${cacheHash.slice(0, 8)}`}
        </span>
      </div>
      {loading && <div className="text-[10px] text-slate-400">Carregando áudio Gemini da base...</div>}
      {error && <div className="text-[10px] text-red-600 dark:text-red-400">{error}</div>}
      {objectUrl && <audio controls preload="metadata" className="w-full h-8" src={objectUrl} />}
    </div>
  );
};

interface KnowledgeArticle {
  id: number;
  scope?: string;
  moduleKey?: string;
  questionPattern: string;
  answerTemplate: string;
  category: string;
  sourceChannel: string;
  hitCount: number;
  updatedByName?: string;
  active?: boolean;
}

interface ConsultantInfo {
  id: number;
  name: string;
  role: string;
  defaultUnitId: number | null;
}

interface ProspectionModuleProps {
  units: Unit[];
  currentUser?: AuthUser | null;
  navIntent?: NavigationIntent | null;
  onClearIntent?: () => void;
  onNavigate?: (mod: ModuleId, intent?: NavigationIntent) => void;
}

function ensurePlus55Prefix(rawPhone: string): string {
  const digits = String(rawPhone || '').replace(/\D/g, '');
  if (!digits) return '+55 ';
  const local = digits.startsWith('55') && digits.length >= 12 ? digits.slice(2) : digits;
  if (local.length === 11) {
    return `+55 (${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  }
  if (local.length === 10) {
    return `+55 (${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  }
  return `+55 ${local}`;
}

function isWhatsappChannel(channel: string): boolean {
  return channel === 'whatsapp_gotalk' || channel === 'whatsapp_uazapi';
}

function isClientNameNotEvident(name: string | null | undefined, phone: string | null | undefined): boolean {
  const clean = String(name || '').trim();
  if (!clean) return true;
  const lower = clean.toLowerCase();
  const placeholders = [
    'sem nome',
    'contato whatsapp',
    'cliente',
    'cliente whatsapp',
    'cliente sem nome',
    'não identificado',
    'nao identificado',
    'desconhecido',
    'lead whatsapp',
  ];
  if (placeholders.includes(lower)) return true;
  const nameDigits = clean.replace(/\D/g, '');
  const phoneDigits = String(phone || '').replace(/\D/g, '');
  if (nameDigits.length >= 8 && (nameDigits === clean.replace(/[\s()+-]/g, '') || phoneDigits.endsWith(nameDigits.slice(-8)))) {
    return true;
  }
  return false;
}

function isPurelyPhoneConversation(lead: ProspectionLead | undefined): boolean {
  if (!lead) return false;
  const items = Array.isArray(lead.aiTranscript) ? lead.aiTranscript : [];
  const hasTextOrAudioChat = items.some(
    (item) => item.type !== 'call' && (item.sender === 'cliente' || item.sender === 'ivi' || item.sender === 'operador')
  );
  if (lead.channel === 'telefone' && !hasTextOrAudioChat) return true;
  if (lead.hasPhoneCall && !hasTextOrAudioChat) return true;
  return false;
}

export const ProspectionModule: React.FC<ProspectionModuleProps> = ({
  units,
  currentUser,
  navIntent,
  onClearIntent,
  onNavigate,
}) => {
  const [leads, setLeads] = useState<ProspectionLead[]>([]);
  const [kb, setKb] = useState<KnowledgeArticle[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [consultants, setConsultants] = useState<ConsultantInfo[]>([]);
  const [callLogs, setCallLogs] = useState<WhatsappCallLogItem[]>([]);
  const [archives, setArchives] = useState<CommunicationArchiveItem[]>([]);
  const [selectedLeadId, setSelectedLeadId] = useState<number | null>(null);
  const [tab, setTab] = useState<'atendimento' | 'agenda' | 'indicadores' | 'kb'>('atendimento');

  // Filters
  const [unitFilter, setUnitFilter] = useState('all');
  const [periodFilter, setPeriodFilter] = useState('30d');
  const [searchQuery, setSearchQuery] = useState('');
  const [stageFilter, setStageFilter] = useState('all');

  // Modals / Forms
  const [newLeadModalOpen, setNewLeadModalOpen] = useState(false);
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [basicContactModalOpen, setBasicContactModalOpen] = useState(false);
  const [auditModalOpen, setAuditModalOpen] = useState(false);
  const [sectorAuditOpen, setSectorAuditOpen] = useState(false);
  const [basicContactAutoTriggeredFor, setBasicContactAutoTriggeredFor] = useState<Record<number, boolean>>({});
  const [contactNameDraft, setContactNameDraft] = useState('');
  const [contactPhoneDraft, setContactPhoneDraft] = useState('+55 ');

  const [newLeadName, setNewLeadName] = useState('');
  const [newLeadPhone, setNewLeadPhone] = useState('');
  const [newLeadChannel, setNewLeadChannel] = useState('whatsapp_uazapi');
  const [newLeadMode, setNewLeadMode] = useState<'ivi' | 'human'>('ivi');
  const [newLeadMessage, setNewLeadMessage] = useState('');
  const [replyText, setReplyText] = useState('');
  const [schedModality, setSchedModality] = useState('presencial');
  const [schedDate, setSchedDate] = useState('');
  const [schedNotesDraft, setSchedNotesDraft] = useState('');

  // Summary container state
  const [summaryDraft, setSummaryDraft] = useState('');

  // Audio recording / upload transcription state
  const [isRecordingAudio, setIsRecordingAudio] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioFileInputRef = useRef<HTMLInputElement | null>(null);

  // Call recording capture / upload per callLog
  const [recordingCallLogId, setRecordingCallLogId] = useState<number | null>(null);
  const [recordingCallStartedAt, setRecordingCallStartedAt] = useState<number>(0);
  const callRecorderRef = useRef<MediaRecorder | null>(null);
  const callAudioChunksRef = useRef<Blob[]>([]);
  const callAudioUploadRef = useRef<HTMLInputElement | null>(null);
  const [uploadTargetCallLogId, setUploadTargetCallLogId] = useState<number | null>(null);

  // Archive snapshot viewer modal
  const [archiveViewer, setArchiveViewer] = useState<{
    fileName: string;
    sha256: string;
    content: string;
  } | null>(null);

  // Direct call state (UaZapi / GoTalk)
  const [activeCallId, setActiveCallId] = useState<string | null>(null);
  const [activeCallProvider, setActiveCallProvider] = useState<'uazapi' | 'gotalk' | null>(null);
  const [activeCallStartedAt, setActiveCallStartedAt] = useState<number>(0);
  const [callFeedback, setCallFeedback] = useState<{ ok: boolean; message: string } | null>(null);

  const [busy, setBusy] = useState(false);
  const [statusBanner, setStatusBanner] = useState('');
  const [scheduleBlocks, setScheduleBlocks] = useState<ScheduleBlock[]>([]);
  const [blockConsultantId, setBlockConsultantId] = useState('');
  const [blockStart, setBlockStart] = useState('');
  const [blockEnd, setBlockEnd] = useState('');
  const [blockReason, setBlockReason] = useState('');

  // Gemini Audio TTS + Admin KB CRUD (Prospecção)
  const isAdmin = currentUser?.role === 'admin';
  const [replyWithAudio, setReplyWithAudio] = useState(false);
  const [onDemandTtsByMsgKey, setOnDemandTtsByMsgKey] = useState<Record<string, { hash: string; cached: boolean }>>({});
  const [kbFormOpen, setKbFormOpen] = useState(false);
  const [kbEditingId, setKbEditingId] = useState<number | null>(null);
  const [kbQuestionDraft, setKbQuestionDraft] = useState('');
  const [kbAnswerDraft, setKbAnswerDraft] = useState('');
  const [kbCategoryDraft, setKbCategoryDraft] = useState('prospeccao');
  const [kbChannelDraft, setKbChannelDraft] = useState('whatsapp_uazapi');
  const [kbActiveDraft, setKbActiveDraft] = useState(true);
  const [kbSearchDraft, setKbSearchDraft] = useState('');
  const [kbAudioPreview, setKbAudioPreview] = useState<{ id: number; hash: string; cached: boolean } | null>(null);

  const load = async () => {
    const data = await apiFetch<{
      leads: ProspectionLead[];
      knowledgeBase: KnowledgeArticle[];
      appointments: Appointment[];
      consultants: ConsultantInfo[];
      scheduleBlocks?: ScheduleBlock[];
      callLogs?: WhatsappCallLogItem[];
      archives?: CommunicationArchiveItem[];
    }>('/api/prospection');
    setLeads(data.leads);
    if (isAdmin) {
      try {
        const kbRes = await apiFetch<{ articles: KnowledgeArticle[] }>(
          '/api/ivi/knowledge?scope=prospection&includeInactive=1'
        );
        setKb(kbRes.articles || data.knowledgeBase);
      } catch {
        setKb(data.knowledgeBase);
      }
    } else {
      setKb(data.knowledgeBase);
    }
    setAppointments(data.appointments);
    setConsultants(data.consultants);
    setScheduleBlocks(data.scheduleBlocks || []);
    setCallLogs(data.callLogs || []);
    setArchives(data.archives || []);
    if (!selectedLeadId && data.leads[0]) setSelectedLeadId(data.leads[0].id);
    if (!blockConsultantId && data.consultants[0]) {
      setBlockConsultantId(String(data.consultants[0].id));
    }
  };

  useEffect(() => {
    load();
  }, [isAdmin]);

  useEffect(() => {
    if (!navIntent) return;
    if (navIntent.leadId) setSelectedLeadId(navIntent.leadId);
    if (
      navIntent.tab === 'atendimento' ||
      navIntent.tab === 'agenda' ||
      navIntent.tab === 'indicadores' ||
      navIntent.tab === 'kb'
    ) {
      setTab(navIntent.tab);
    }
    onClearIntent?.();
  }, [navIntent, onClearIntent]);

  const filteredLeads = useMemo(() => {
    return leads.filter((l) => {
      if (unitFilter !== 'all' && String(l.unitId) !== unitFilter) return false;
      if (stageFilter !== 'all' && l.stage !== stageFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        if (!l.name.toLowerCase().includes(q) && !l.phone.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [leads, unitFilter, stageFilter, searchQuery]);

  const filteredAppointments = useMemo(() => {
    return appointments.filter((a) => {
      if (unitFilter !== 'all' && String(a.unitId) !== unitFilter) return false;
      if (searchQuery.trim() && !a.clientName.toLowerCase().includes(searchQuery.toLowerCase())) {
        return false;
      }
      return true;
    });
  }, [appointments, unitFilter, searchQuery]);

  const activeLead =
    filteredLeads.find((l) => l.id === selectedLeadId) ||
    leads.find((l) => l.id === selectedLeadId) ||
    filteredLeads[0];

  const activeLeadMissingName = activeLead
    ? isWhatsappChannel(activeLead.channel) && isClientNameNotEvident(activeLead.name, activeLead.phone)
    : false;
  const isHumanAttendance = activeLead?.stage === 'escalado_humano';
  const isIviInitialAttendance =
    activeLead?.stage === 'em_atendimento_ivi' || activeLead?.stage === 'novo';
  const purelyPhone = isPurelyPhoneConversation(activeLead);

  // Sync summary draft & trigger Ivi Basic Contact Modal when WhatsApp lead lacks evident name under Ivi attendance
  useEffect(() => {
    if (!activeLead) return;
    setSummaryDraft(activeLead.summaryText || '');
    setCallFeedback(null);

    if (
      isWhatsappChannel(activeLead.channel) &&
      isClientNameNotEvident(activeLead.name, activeLead.phone) &&
      (activeLead.stage === 'em_atendimento_ivi' || activeLead.stage === 'novo') &&
      !basicContactAutoTriggeredFor[activeLead.id]
    ) {
      setContactNameDraft(activeLead.name || '');
      setContactPhoneDraft(ensurePlus55Prefix(activeLead.phone));
      setBasicContactModalOpen(true);
      setBasicContactAutoTriggeredFor((prev) => ({ ...prev, [activeLead.id]: true }));
    }
  }, [activeLead?.id, activeLead?.summaryText, activeLead?.stage]);

  const activeLeadCallLogs = useMemo(() => {
    if (!activeLead) return [];
    return callLogs.filter((c) => c.leadId === activeLead.id);
  }, [callLogs, activeLead]);

  const activeLeadArchives = useMemo(() => {
    if (!activeLead) return [];
    return archives.filter((a) => a.leadId === activeLead.id);
  }, [archives, activeLead]);

  const buildSummaryObservationText = (lead: ProspectionLead | undefined): string => {
    if (!lead) return '';
    const text = (summaryDraft || lead.summaryText || '').trim();
    const author = lead.summaryAuthor || currentUser?.name || 'Ivi IA';
    const dt = lead.summaryUpdatedAt ? formatDateTimeBR(lead.summaryUpdatedAt) : formatDateTimeBR(new Date().toISOString());
    if (text) {
      return `[Resumo da Conversa · Usuário: ${author} · ${dt}]\n${text}`;
    }
    const transcriptFallback = (lead.aiTranscript || [])
      .map((t) => `${t.sender === 'cliente' ? 'Cliente' : t.sender === 'ivi' ? 'Ivi' : t.authorName || 'Operador'}: ${t.audioTranscript || t.text}`)
      .join('\n');
    return `[Histórico Prospecção · Usuário: ${author} · ${dt}]\n${transcriptFallback || 'Sem histórico textual.'}`;
  };

  const openQuickScheduleModal = () => {
    if (!activeLead) return;
    setSchedNotesDraft(buildSummaryObservationText(activeLead));
    setScheduleModalOpen(true);
  };

  const handleOpenInFullAppointments = () => {
    if (!activeLead || !onNavigate) return;
    onNavigate('appointments', {
      tab: 'agenda',
      triggerNew: true,
      leadId: activeLead.id,
      clientName: isClientNameNotEvident(activeLead.name, activeLead.phone)
        ? 'Cliente WhatsApp (Confirmar Nome)'
        : activeLead.name,
      clientPhone: ensurePlus55Prefix(activeLead.phone),
      unitId: activeLead.unitId,
      notes: buildSummaryObservationText(activeLead),
    });
  };

  const handleCreateLead = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newLeadPhone.trim()) return;
    setBusy(true);
    try {
      const res = await apiFetch<{ lead: ProspectionLead }>('/api/prospection/leads', {
        method: 'POST',
        body: JSON.stringify({
          name: newLeadName.trim(),
          phone: ensurePlus55Prefix(newLeadPhone),
          channel: newLeadChannel,
          mode: newLeadMode,
          initialMessage:
            newLeadChannel === 'telefone'
              ? newLeadMessage || 'Contato telefônico receptivo.'
              : newLeadMessage || 'Olá, gostaria de reduzir as parcelas do meu financiamento veicular.',
        }),
      });
      setNewLeadName('');
      setNewLeadPhone('');
      setNewLeadMessage('');
      setNewLeadModalOpen(false);
      setSelectedLeadId(res.lead.id);
      setTab('atendimento');

      if (
        isWhatsappChannel(res.lead.channel) &&
        isClientNameNotEvident(res.lead.name, res.lead.phone) &&
        (res.lead.stage === 'em_atendimento_ivi' || res.lead.stage === 'novo')
      ) {
        setContactNameDraft(res.lead.name || '');
        setContactPhoneDraft(ensurePlus55Prefix(res.lead.phone));
        setBasicContactModalOpen(true);
        setBasicContactAutoTriggeredFor((prev) => ({ ...prev, [res.lead.id]: true }));
        setStatusBanner('Ivi iniciou o atendimento e abriu o cadastro básico de contato para identificar o cliente.');
      } else {
        setStatusBanner(
          `Contato ${res.lead.name || res.lead.phone} registrado no canal ${res.lead.channel}.`
        );
      }
      await load();
    } finally {
      setBusy(false);
    }
  };

  const handleSendMessage = async (mode: 'ivi' | 'human') => {
    if (!activeLead || !replyText.trim()) return;
    setBusy(true);
    try {
      const res = await apiFetch<{
        lead: ProspectionLead;
        ivi: { provider: string; needsHuman: boolean; audioCacheHash?: string; audioCached?: boolean };
      }>(`/api/prospection/leads/${activeLead.id}/ivi-reply`, {
        method: 'POST',
        body: JSON.stringify({ message: replyText, mode, replyWithAudio: mode === 'ivi' && replyWithAudio }),
      });
      setReplyText('');
      setSummaryDraft(res.lead.summaryText || '');
      if (mode === 'human') {
        setStatusBanner('Resposta do operador registrada e resumo atualizado.');
      } else {
        setStatusBanner(
          res.ivi.needsHuman
            ? `Ivi (${res.ivi.provider}) escalou para atendimento humano e atualizou o resumo lateral.${
                res.ivi.audioCacheHash ? ' Resposta em áudio Gemini salva no cache.' : ''
              }`
            : `Ivi (${res.ivi.provider}) respondeu e atualizou o resumo lateral.${
                res.ivi.audioCacheHash ? ' Resposta em áudio Gemini salva no cache.' : ''
              }`
        );
      }
      await load();
    } finally {
      setBusy(false);
    }
  };

  const handleSynthesizeProspectionTts = async (key: string, text: string) => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      const res = await apiFetch<{
        cacheHash: string;
        audioUrl: string;
        cached: boolean;
        unavailableReason?: string;
      }>('/api/ivi/tts', {
        method: 'POST',
        body: JSON.stringify({ text, sourceType: 'prospection', moduleKey: 'prospection' }),
      });
      if (!res.audioUrl) {
        setStatusBanner(res.unavailableReason || 'Não foi possível sintetizar áudio Gemini no momento.');
        return;
      }
      setOnDemandTtsByMsgKey((prev) => ({
        ...prev,
        [key]: { hash: res.cacheHash, cached: res.cached },
      }));
      setStatusBanner(
        res.cached
          ? 'Áudio Gemini reproduzido do cache da base da Ivi (0 tokens gastos).'
          : 'Áudio Gemini sintetizado e armazenado na base da Ivi para reutilização.'
      );
    } finally {
      setBusy(false);
    }
  };

  const handleSaveProspectionKb = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin || !kbQuestionDraft.trim() || !kbAnswerDraft.trim()) return;
    setBusy(true);
    try {
      if (kbEditingId) {
        await apiFetch(`/api/ivi/knowledge/${kbEditingId}`, {
          method: 'PUT',
          body: JSON.stringify({
            scope: 'prospection',
            moduleKey: 'prospection',
            questionPattern: kbQuestionDraft.trim(),
            answerTemplate: kbAnswerDraft.trim(),
            category: kbCategoryDraft.trim() || 'prospeccao',
            sourceChannel: kbChannelDraft.trim() || 'whatsapp_uazapi',
            active: kbActiveDraft,
          }),
        });
        setStatusBanner('Artigo da Base Ivi (Prospecção) atualizado e auditado.');
      } else {
        await apiFetch('/api/ivi/knowledge', {
          method: 'POST',
          body: JSON.stringify({
            scope: 'prospection',
            moduleKey: 'prospection',
            questionPattern: kbQuestionDraft.trim(),
            answerTemplate: kbAnswerDraft.trim(),
            category: kbCategoryDraft.trim() || 'prospeccao',
            sourceChannel: kbChannelDraft.trim() || 'whatsapp_uazapi',
            active: kbActiveDraft,
          }),
        });
        setStatusBanner('Novo conhecimento incluído na Base da Ivi (Prospecção).');
      }
      setKbFormOpen(false);
      setKbEditingId(null);
      setKbQuestionDraft('');
      setKbAnswerDraft('');
      await load();
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteProspectionKb = async (id: number) => {
    if (!isAdmin) return;
    setBusy(true);
    try {
      await apiFetch(`/api/ivi/knowledge/${id}`, { method: 'DELETE' });
      setStatusBanner('Item removido da Base de Conhecimento da Ivi (Prospecção).');
      await load();
    } finally {
      setBusy(false);
    }
  };

  const handleSaveBasicContact = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeLead || !contactNameDraft.trim()) return;
    setBusy(true);
    try {
      const formatted = ensurePlus55Prefix(contactPhoneDraft);
      const res = await apiFetch<{ lead: ProspectionLead }>(
        `/api/prospection/leads/${activeLead.id}/contact`,
        {
          method: 'PATCH',
          body: JSON.stringify({ name: contactNameDraft.trim(), phone: formatted }),
        }
      );
      setBasicContactModalOpen(false);
      setStatusBanner(`Contato atualizado: ${res.lead.name} · ${res.lead.phone}`);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const handleSaveSummary = async () => {
    if (!activeLead) return;
    setBusy(true);
    try {
      const res = await apiFetch<{ lead: ProspectionLead }>(
        `/api/prospection/leads/${activeLead.id}/summary`,
        {
          method: 'PUT',
          body: JSON.stringify({ summaryText: summaryDraft }),
        }
      );
      setSummaryDraft(res.lead.summaryText || '');
      setStatusBanner('Resumo da conversa salvo com usuário, data e hora.');
      await load();
    } finally {
      setBusy(false);
    }
  };

  const handleAutoSummarizeWithIvi = async () => {
    if (!activeLead) return;
    setBusy(true);
    try {
      const res = await apiFetch<{ lead: ProspectionLead }>(
        `/api/prospection/leads/${activeLead.id}/summarize`,
        { method: 'POST' }
      );
      setSummaryDraft(res.lead.summaryText || '');
      setStatusBanner('Ivi gerou e atualizou o resumo da conversa com usuário, data e hora.');
      await load();
    } finally {
      setBusy(false);
    }
  };

  const sendAudioBlobToIvi = async (blob: Blob, description?: string) => {
    if (!activeLead) return;
    setBusy(true);
    try {
      const reader = new FileReader();
      const dataUri = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Falha ao ler arquivo de áudio'));
        reader.readAsDataURL(blob);
      });
      const res = await apiFetch<{ lead: ProspectionLead; transcript: string; provider: string }>(
        `/api/prospection/leads/${activeLead.id}/transcribe-audio`,
        {
          method: 'POST',
          body: JSON.stringify({
            audioDataUri: dataUri,
            mimeType: blob.type || 'audio/webm',
            audioDescription: description || 'Áudio transcrito pela Ivi',
            sender: 'cliente',
          }),
        }
      );
      setSummaryDraft(res.lead.summaryText || '');
      setStatusBanner(`Áudio transcrito pela Ivi (${res.provider}) e incorporado ao resumo da conversa.`);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const toggleAudioRecording = async () => {
    if (!activeLead) return;
    if (isRecordingAudio && mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      setIsRecordingAudio(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) audioChunksRef.current.push(ev.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        if (blob.size > 0) {
          await sendAudioBlobToIvi(blob, 'Gravação de áudio no atendimento');
        }
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecordingAudio(true);
    } catch {
      setStatusBanner('Microfone indisponível neste navegador — anexe um arquivo de áudio (.mp3, .ogg, .wav, .webm) para transcrição da Ivi.');
    }
  };

  const handleAudioFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    await sendAudioBlobToIvi(file, file.name);
  };

  const handleInitiateCall = async (provider: 'uazapi' | 'gotalk') => {
    if (!activeLead) return;
    setBusy(true);
    setCallFeedback(null);
    try {
      const res = await apiFetch<{
        lead: ProspectionLead;
        callLog: WhatsappCallLogItem;
        callResult: { dispatched: boolean; callId: string | null; detail: string };
      }>(`/api/prospection/leads/${activeLead.id}/call`, {
        method: 'POST',
        body: JSON.stringify({ isVideo: false, provider }),
      });
      if (res.callResult.dispatched && (res.callResult.callId || res.callLog?.callId)) {
        setActiveCallId(res.callResult.callId || res.callLog.callId);
        setActiveCallProvider(provider);
        setActiveCallStartedAt(Date.now());
      } else {
        setActiveCallId(null);
        setActiveCallProvider(null);
      }
      setCallFeedback({
        ok: res.callResult.dispatched,
        message: res.callResult.detail,
      });
      await load();
    } finally {
      setBusy(false);
    }
  };

  const handleTerminateCall = async () => {
    if (!activeLead || !activeCallId) return;
    setBusy(true);
    try {
      const durationSeconds = activeCallStartedAt
        ? Math.max(1, Math.round((Date.now() - activeCallStartedAt) / 1000))
        : 0;
      const res = await apiFetch<{ ok: boolean; detail: string }>(
        `/api/prospection/leads/${activeLead.id}/call/terminate`,
        {
          method: 'POST',
          body: JSON.stringify({ callId: activeCallId, durationSeconds }),
        }
      );
      setActiveCallId(null);
      setActiveCallProvider(null);
      setActiveCallStartedAt(0);
      setCallFeedback({ ok: res.ok, message: res.detail });
      await load();
    } finally {
      setBusy(false);
    }
  };

  const uploadCallRecordingBlob = async (
    callLogId: number,
    blob: Blob,
    fileName?: string,
    durationSeconds?: number
  ) => {
    if (!activeLead) return;
    setBusy(true);
    try {
      const reader = new FileReader();
      const dataUri = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Falha ao ler gravação da chamada'));
        reader.readAsDataURL(blob);
      });
      const res = await apiFetch<{ lead?: ProspectionLead; transcript: string }>(
        `/api/prospection/leads/${activeLead.id}/calls/${callLogId}/recording`,
        {
          method: 'POST',
          body: JSON.stringify({
            audioDataUri: dataUri,
            mimeType: blob.type || 'audio/webm',
            fileName: fileName || `gravacao-chamada-${callLogId}.webm`,
            durationSeconds: durationSeconds || 0,
          }),
        }
      );
      if (res.lead?.summaryText) setSummaryDraft(res.lead.summaryText);
      setStatusBanner('Gravação da ligação salva no BucketDaInvicta, transcrita pela Ivi e incorporada ao atendimento.');
      await load();
    } finally {
      setBusy(false);
    }
  };

  const toggleCallRecording = async (callLogId: number) => {
    if (!activeLead) return;
    if (recordingCallLogId === callLogId && callRecorderRef.current) {
      callRecorderRef.current.stop();
      setRecordingCallLogId(null);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const startedAt = Date.now();
      callAudioChunksRef.current = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) callAudioChunksRef.current.push(ev.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(callAudioChunksRef.current, { type: 'audio/webm' });
        const durSec = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
        if (blob.size > 0) {
          await uploadCallRecordingBlob(callLogId, blob, `chamada-${callLogId}.webm`, durSec);
        }
      };
      callRecorderRef.current = recorder;
      recorder.start();
      setRecordingCallLogId(callLogId);
      setRecordingCallStartedAt(startedAt);
    } catch {
      setStatusBanner('Microfone indisponível — utilize "Anexar Gravação" ao lado do registro da ligação.');
    }
  };

  const handleCallRecordingFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    const targetId = uploadTargetCallLogId;
    setUploadTargetCallLogId(null);
    if (!file || !targetId) return;
    await uploadCallRecordingBlob(targetId, file, file.name);
  };

  const handleArchiveConversationNow = async () => {
    if (!activeLead) return;
    setBusy(true);
    try {
      await apiFetch(`/api/prospection/leads/${activeLead.id}/archive`, { method: 'POST' });
      setStatusBanner('Snapshot completo da conversa e transcrições arquivado no BucketDaInvicta.');
      await load();
    } finally {
      setBusy(false);
    }
  };

  const handleViewOrDownloadArchive = async (
    archive: CommunicationArchiveItem,
    mode: 'preview' | 'download'
  ) => {
    const resp = await fetch(
      `/api/bucket/objects/${archive.sha256Hash}${mode === 'preview' ? '?preview=1' : ''}`,
      { headers: { Authorization: `Bearer ${getAuthToken()}` } }
    );
    if (!resp.ok) {
      setStatusBanner('Falha ao acessar objeto no BucketDaInvicta.');
      return;
    }
    const blob = await resp.blob();
    if (mode === 'preview' && archive.mimeType.includes('json')) {
      const rawText = await blob.text();
      let formatted = rawText;
      try {
        formatted = JSON.stringify(JSON.parse(rawText), null, 2);
      } catch {
        // keep raw text
      }
      setArchiveViewer({
        fileName: archive.fileName,
        sha256: archive.sha256Hash,
        content: formatted,
      });
      return;
    }
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objUrl;
    a.download = archive.fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objUrl), 2500);
  };

  const handleSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeLead) return;
    setBusy(true);
    try {
      const notes = schedNotesDraft.trim() || buildSummaryObservationText(activeLead);
      const res = await apiFetch<{ consultant?: { name: string } }>(
        '/api/prospection/appointments',
        {
          method: 'POST',
          body: JSON.stringify({
            leadId: activeLead.id,
            clientName: activeLead.name || 'Cliente WhatsApp',
            clientPhone: ensurePlus55Prefix(activeLead.phone),
            unitId: activeLead.unitId,
            modality: schedModality,
            scheduledFor: schedDate || new Date(Date.now() + 86400000).toISOString(),
            notes,
          }),
        }
      );
      setScheduleModalOpen(false);
      setStatusBanner(
        `Agendamento (${schedModality}) confirmado com o resumo encaminhado para Observações! Consultor ${
          res.consultant?.name || 'da fila'
        } notificado.`
      );
      await load();
    } finally {
      setBusy(false);
    }
  };

  const handleApptStatus = async (id: number, status: string) => {
    await apiFetch(`/api/prospection/appointments/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    await load();
  };

  const metrics = useMemo(() => {
    const captados = filteredLeads.length;
    const recuperados = filteredLeads.filter((l) => l.stage === 'recuperado').length;
    const cumpridos = filteredAppointments.filter((a) => a.status === 'cumprido').length;
    const faltosos = filteredAppointments.filter((a) => a.status === 'faltoso').length;
    const fechados = filteredLeads.filter((l) => l.stage === 'fechado').length;
    const analise = filteredLeads.filter((l) => l.stage === 'analise').length;
    const naoFechados = filteredLeads.filter((l) => l.stage === 'nao_fechado').length;

    const byConsultant = consultants
      .filter((c) => c.role === 'consultant' || c.role === 'admin')
      .map((c) => ({
        name: c.name,
        total: filteredAppointments.filter((a) => a.consultantId === c.id).length,
        cumpridos: filteredAppointments.filter(
          (a) => a.consultantId === c.id && a.status === 'cumprido'
        ).length,
      }))
      .sort((a, b) => b.total - a.total);

    return {
      captados,
      recuperados,
      cumpridos,
      faltosos,
      fechados,
      analise,
      naoFechados,
      byConsultant,
    };
  }, [filteredLeads, filteredAppointments, consultants]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 pb-4 dark:border-slate-700">
        <div>
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            GoTalk · UaZapi (Chat & Voz) · Maton (Instagram, Facebook, E-mail) · Fila de Consultores
          </p>
          <h1 className="mt-1 font-display text-2xl font-bold text-slate-900 dark:text-slate-100">
            Prospecção & Agendamentos
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto scroll-rulers dark:bg-slate-800">
            {[
              { id: 'atendimento', label: `Atendimento (${leads.length})` },
              { id: 'agenda', label: `Agenda (${appointments.length})` },
              { id: 'indicadores', label: 'Indicadores' },
              { id: 'kb', label: 'Base Ivi' },
            ].map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id as typeof tab)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md whitespace-nowrap transition-colors ${
                  tab === t.id
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-slate-100'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setSectorAuditOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap min-h-[38px] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <History className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
            Auditoria
          </button>

          <button
            type="button"
            onClick={() => setNewLeadModalOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-700 whitespace-nowrap min-h-[38px]"
          >
            <Plus className="w-3.5 h-3.5" />
            Novo Lead / Contato
          </button>
        </div>
      </div>

      <CollapsibleFilterBar
        units={units}
        selectedUnitId={unitFilter}
        onUnitChange={setUnitFilter}
        period={periodFilter}
        onPeriodChange={setPeriodFilter}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        extraStatuses={[
          { value: 'em_atendimento_ivi', label: 'Em atendimento Ivi' },
          { value: 'escalado_humano', label: 'Escalado p/ Humano' },
          { value: 'agendado', label: 'Agendado' },
          { value: 'recuperado', label: 'Recuperado' },
          { value: 'analise', label: 'Em Análise' },
        ]}
        selectedStatus={stageFilter}
        onStatusChange={setStageFilter}
      />

      {statusBanner && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-medium text-emerald-900 flex items-center justify-between gap-2 dark:border-emerald-800/70 dark:bg-emerald-950/50 dark:text-emerald-300">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-emerald-600 shrink-0 dark:text-emerald-400" />
            <span>{statusBanner}</span>
          </div>
          <button
            type="button"
            onClick={() => setStatusBanner('')}
            className="text-emerald-700 hover:text-emerald-950 p-1 dark:text-emerald-300"
            aria-label="Fechar aviso"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {tab === 'atendimento' && (
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-start">
          {/* 1. Fila Omnichannel Estreita (à esquerda da conversa) */}
          <div className="md:col-span-3 rounded-xl border border-slate-200 bg-white overflow-hidden dark:border-slate-700 dark:bg-slate-900">
            <div className="px-3 py-2.5 border-b border-slate-200 text-xs font-bold text-slate-800 flex items-center justify-between gap-1 dark:border-slate-700 dark:text-slate-100">
              <span className="truncate">Fila Omnichannel ({filteredLeads.length})</span>
              <span className="font-mono text-[10px] text-slate-500 shrink-0 dark:text-slate-400">Ivi</span>
            </div>
            <div className="divide-y divide-slate-100 max-h-[600px] overflow-y-auto overflow-x-auto scroll-rulers dark:divide-slate-800">
              {filteredLeads.length === 0 ? (
                <div className="p-4 text-center text-xs text-slate-500 space-y-2 dark:text-slate-400">
                  <p>Nenhum contato neste filtro.</p>
                  <button
                    type="button"
                    onClick={() => setNewLeadModalOpen(true)}
                    className="font-semibold text-emerald-700 hover:underline dark:text-emerald-300"
                  >
                    + Novo Contato
                  </button>
                </div>
              ) : (
                filteredLeads.map((lead) => {
                  const isSelected = activeLead?.id === lead.id;
                  const unnamed =
                    isWhatsappChannel(lead.channel) && isClientNameNotEvident(lead.name, lead.phone);
                  return (
                    <button
                      key={lead.id}
                      type="button"
                      onClick={() => setSelectedLeadId(lead.id)}
                      className={`w-full text-left px-3 py-2.5 transition-colors ${
                        isSelected ? 'bg-blue-50/90 dark:bg-blue-950/50' : 'hover:bg-slate-50 dark:hover:bg-slate-800'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1.5">
                        <span className="text-xs font-semibold text-slate-900 truncate dark:text-slate-100">
                          {unnamed ? 'Contato WhatsApp (Sem nome)' : lead.name}
                        </span>
                        {lead.hasPhoneCall && (
                          <Phone className="w-3 h-3 text-blue-600 shrink-0 dark:text-blue-400" aria-label="Ligação registrada" />
                        )}
                      </div>
                      <div className="mt-0.5 text-[11px] font-mono text-slate-500 truncate dark:text-slate-400">
                        {lead.phone}
                      </div>
                      <div className="mt-1 flex items-center justify-between gap-1 text-[10px]">
                        <span
                          className={
                            lead.stage === 'escalado_humano'
                              ? 'text-amber-700 font-semibold truncate dark:text-amber-300'
                              : 'text-emerald-700 font-medium truncate dark:text-emerald-300'
                          }
                        >
                          {lead.stage.replace(/_/g, ' ')}
                        </span>
                        <span className="font-mono text-slate-400 shrink-0 dark:text-slate-400">{lead.channel}</span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* 2. Conteúdo da Conversa + Transcrição de Áudio + Ligação UaZapi (Centro) */}
          <div className="md:col-span-6">
            {activeLead ? (
              <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3 dark:border-slate-700 dark:bg-slate-900">
                {/* Conversation Header */}
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2 border-b border-slate-100 pb-3 dark:border-slate-800">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-display text-base font-bold text-slate-900 truncate dark:text-slate-100">
                        {activeLeadMissingName ? 'Contato WhatsApp (Sem nome)' : activeLead.name}
                      </h3>
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-700 dark:text-blue-300">
                        <Bot className="w-3.5 h-3.5" />
                        {activeLead.iviProviderUsed || 'gemini'}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5 dark:text-slate-400">
                      {activeLead.phone} · {activeLead.channel} · Unidade{' '}
                      {units.find((u) => u.id === activeLead.unitId)?.name || 'Matriz'}
                    </p>
                  </div>

                  {/* Direct Actions + UaZapi & GoTalk Calling */}
                  <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                    {!activeCallId ? (
                      <>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => handleInitiateCall('uazapi')}
                          className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-xs font-semibold text-blue-800 hover:bg-blue-100 whitespace-nowrap disabled:opacity-50 dark:border-blue-800/70 dark:bg-blue-950/50 dark:text-blue-300 dark:hover:bg-blue-900/60"
                          title="Iniciar ligação direta via API UaZapi"
                        >
                          <PhoneCall className="w-3.5 h-3.5" />
                          Ligar (UaZapi)
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => handleInitiateCall('gotalk')}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                          title="Iniciar/registrar ligação GoTalk para gravação e transcrição"
                        >
                          <Phone className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-300" />
                          Ligação (GoTalk)
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={handleTerminateCall}
                        className="inline-flex items-center gap-1 rounded-lg bg-red-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-red-700 whitespace-nowrap"
                      >
                        <PhoneOff className="w-3.5 h-3.5" />
                        Encerrar {activeCallProvider === 'gotalk' ? 'GoTalk' : 'UaZapi'}
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        setContactNameDraft(activeLead.name || '');
                        setContactPhoneDraft(ensurePlus55Prefix(activeLead.phone));
                        setBasicContactModalOpen(true);
                      }}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                    >
                      <UserPen className="w-3.5 h-3.5" />
                      Contato
                    </button>

                    <button
                      type="button"
                      onClick={openQuickScheduleModal}
                      className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 whitespace-nowrap"
                    >
                      <Calendar className="w-3.5 h-3.5" />
                      Agendar
                    </button>

                    <button
                      type="button"
                      onClick={() => setAuditModalOpen(true)}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                      title="Consultar Auditoria Completa do Lead"
                    >
                      <History className="w-3.5 h-3.5" />
                      Auditoria
                    </button>

                    {onNavigate && (
                      <button
                        type="button"
                        onClick={handleOpenInFullAppointments}
                        className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 whitespace-nowrap dark:border-emerald-800/70 dark:bg-emerald-950/50 dark:text-emerald-300 dark:hover:bg-emerald-900/60"
                        title="Abrir grade de Agendamentos com resumo preenchido nas Observações"
                      >
                        Grade
                        <ArrowUpRight className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Ivi Baget: Human Attendance + Missing WhatsApp Client Name */}
                {activeLeadMissingName && isHumanAttendance && (
                  <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 flex items-start gap-3 dark:border-amber-800/70 dark:bg-amber-950/50">
                    <img
                      src={iviAvatarImg}
                      alt="Ivi Assistente"
                      className="w-10 h-10 rounded-full object-cover border border-amber-300 shrink-0 dark:border-amber-800/70"
                    />
                    <div className="flex-1 min-w-0 text-xs text-amber-950 space-y-1.5 dark:text-amber-300">
                      <p className="font-bold">
                        Lembrete da Ivi ao Operador: Nome do Cliente Não Identificado no WhatsApp
                      </p>
                      <p className="leading-relaxed text-amber-900 dark:text-amber-300">
                        Este contato entrou pelo WhatsApp sem nome visível. Como o atendimento está com você (operador humano), solicite o nome completo ao cliente durante a conversa e atualize o cadastro básico.
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          setContactNameDraft(activeLead.name || '');
                          setContactPhoneDraft(ensurePlus55Prefix(activeLead.phone));
                          setBasicContactModalOpen(true);
                        }}
                        className="inline-flex items-center gap-1 rounded-md bg-amber-700 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-amber-800"
                      >
                        <UserPen className="w-3 h-3" />
                        Cadastrar Nome (+55)
                      </button>
                    </div>
                  </div>
                )}

                {/* Ivi Notice when Ivi handles initial attendance without name */}
                {activeLeadMissingName && isIviInitialAttendance && (
                  <div className="rounded-xl border border-blue-200 bg-blue-50/70 p-2.5 flex items-center justify-between gap-2 text-xs text-blue-950 dark:border-blue-800/70 dark:bg-blue-950/50 dark:text-blue-300">
                    <div className="flex items-center gap-2 min-w-0">
                      <img
                        src={iviAvatarImg}
                        alt="Ivi Assistente"
                        className="w-7 h-7 rounded-full object-cover border border-blue-200 shrink-0 dark:border-blue-800/70"
                      />
                      <span className="truncate">
                        Contato WhatsApp sem nome evidente em atendimento inicial pela Ivi.
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setContactNameDraft(activeLead.name || '');
                        setContactPhoneDraft(ensurePlus55Prefix(activeLead.phone));
                        setBasicContactModalOpen(true);
                      }}
                      className="shrink-0 font-semibold text-blue-700 hover:underline dark:text-blue-300"
                    >
                      Abrir Modal Básico
                    </button>
                  </div>
                )}

                {/* UaZapi Call Result Feedback */}
                {callFeedback && (
                  <div
                    className={`rounded-xl border px-3 py-2 text-xs flex flex-wrap items-center justify-between gap-2 ${
                      callFeedback.ok
                        ? 'border-blue-200 bg-blue-50 text-blue-950 dark:border-blue-800/70 dark:bg-blue-950/50 dark:text-blue-300'
                        : 'border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-800/70 dark:bg-amber-950/50 dark:text-amber-300'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Phone className="w-3.5 h-3.5 shrink-0" />
                      <span>{callFeedback.message}</span>
                    </div>
                    <a
                      href={`tel:${ensurePlus55Prefix(activeLead.phone).replace(/[^\d+]/g, '')}`}
                      className="font-semibold underline whitespace-nowrap"
                    >
                      Discar pelo telefone ({ensurePlus55Prefix(activeLead.phone)})
                    </a>
                  </div>
                )}

                {/* Conversation Timeline */}
                <div className="space-y-2.5 max-h-[340px] overflow-y-auto overflow-x-auto scroll-rulers bg-slate-50/70 rounded-xl p-3 border border-slate-100 dark:bg-slate-800/60 dark:border-slate-800">
                  {(activeLead.aiTranscript || []).length === 0 ? (
                    <p className="text-xs text-slate-500 text-center py-6 dark:text-slate-400">
                      Nenhuma mensagem registrada. Envie abaixo para atendimento via Ivi/Operador ou anexe um áudio para transcrição.
                    </p>
                  ) : (
                    activeLead.aiTranscript.map((item, idx) => (
                      <div
                        key={idx}
                        className={`rounded-lg p-3 text-xs border ${
                          item.type === 'call'
                            ? 'bg-amber-50/70 border-amber-200 text-slate-900 dark:bg-amber-950/50 dark:border-amber-800/70 dark:text-slate-100'
                            : item.sender === 'ivi'
                            ? 'bg-blue-50/80 border-blue-100 text-slate-900 ml-4 dark:bg-blue-950/50 dark:border-blue-800/70 dark:text-slate-100'
                            : item.sender === 'operador'
                            ? 'bg-emerald-50/70 border-emerald-200 text-slate-900 ml-4 dark:bg-emerald-950/50 dark:border-emerald-800/70 dark:text-slate-100'
                            : 'bg-white border-slate-200 text-slate-800 mr-4 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-100'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 text-[10px] text-slate-500 mb-1 dark:text-slate-400">
                          <span className="font-semibold">
                            {item.type === 'call'
                              ? `Ligação ${String(item.sourceProvider || 'uazapi').toUpperCase()} · ${item.authorName || 'Operador'}`
                              : item.sender === 'ivi'
                              ? `Agente Ivi (${item.provider || 'gemini'})`
                              : item.sender === 'operador'
                              ? `Operador (${item.authorName || 'Atendente'})${item.sourceProvider ? ` · ${item.sourceProvider.toUpperCase()}` : ''}`
                              : `${activeLeadMissingName ? 'Cliente WhatsApp' : activeLead.name}${item.sourceProvider ? ` · ${item.sourceProvider.toUpperCase()}` : ''}`}
                          </span>
                          <span className="font-mono shrink-0">{formatDateTimeBR(item.timestamp)}</span>
                        </div>
                        <p className="leading-relaxed">{item.text}</p>
                        {item.mediaSha256 && (
                          <SecureBucketAudio sha256={item.mediaSha256} fileName={item.mediaFileName} />
                        )}
                        {(item.audioCacheHash || onDemandTtsByMsgKey[`${activeLead.id}-${idx}`]) && (
                          <CachedIviAudioPlayer
                            cacheHash={
                              item.audioCacheHash || onDemandTtsByMsgKey[`${activeLead.id}-${idx}`].hash
                            }
                            cached={
                              item.audioCacheHash
                                ? item.audioCached
                                : onDemandTtsByMsgKey[`${activeLead.id}-${idx}`]?.cached
                            }
                          />
                        )}
                        {item.sender === 'ivi' &&
                          !item.audioCacheHash &&
                          !onDemandTtsByMsgKey[`${activeLead.id}-${idx}`] && (
                            <div className="mt-1.5">
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => handleSynthesizeProspectionTts(`${activeLead.id}-${idx}`, item.text)}
                                className="inline-flex items-center gap-1 rounded border border-blue-200 bg-white px-2 py-1 text-[10px] font-semibold text-blue-800 hover:bg-blue-100 disabled:opacity-50 dark:border-blue-800/70 dark:bg-slate-900 dark:text-blue-300 dark:hover:bg-blue-950"
                              >
                                <Volume2 className="w-3 h-3" />
                                Ouvir / Gerar Resposta em Áudio Gemini
                              </button>
                            </div>
                          )}
                        {item.audioTranscript && (
                          <div className="mt-2 rounded-md border border-blue-200 bg-white/90 p-2 text-[11px] text-slate-700 dark:border-blue-800/70 dark:bg-slate-900/95 dark:text-slate-200">
                            <span className="font-bold text-blue-800 dark:text-blue-300">Transcrição Ivi: </span>
                            {item.audioTranscript}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>

                {/* Audio Recording & File Transcription Bar (Ivi) */}
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800/70">
                  <div className="flex items-center gap-2 text-slate-700 dark:text-slate-200">
                    <FileAudio className="w-4 h-4 text-blue-700 shrink-0 dark:text-blue-300" />
                    <span className="font-medium">Transcrição & Gravação (BucketDaInvicta):</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={toggleAudioRecording}
                      className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[11px] font-semibold whitespace-nowrap ${
                        isRecordingAudio
                          ? 'bg-red-600 text-white hover:bg-red-700'
                          : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800'
                      }`}
                    >
                      {isRecordingAudio ? (
                        <>
                          <Square className="w-3 h-3" />
                          Parar & Transcrever
                        </>
                      ) : (
                        <>
                          <Mic className="w-3 h-3 text-blue-700 dark:text-blue-300" />
                          Gravar Áudio
                        </>
                      )}
                    </button>
                    <input
                      ref={audioFileInputRef}
                      type="file"
                      accept="audio/*"
                      onChange={handleAudioFileChange}
                      className="hidden"
                    />
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => audioFileInputRef.current?.click()}
                      className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-[11px] font-semibold text-blue-800 hover:bg-blue-100 whitespace-nowrap dark:border-blue-800/70 dark:bg-blue-950/50 dark:text-blue-300 dark:hover:bg-blue-900/60"
                    >
                      <FileAudio className="w-3 h-3" />
                      Enviar Áudio p/ Ivi
                    </button>
                  </div>
                </div>

                {/* Hidden input for per-call audio file attachment */}
                <input
                  ref={callAudioUploadRef}
                  type="file"
                  accept="audio/*"
                  onChange={handleCallRecordingFileChange}
                  className="hidden"
                />

                {/* Recent UaZapi / GoTalk Call History + Recording Capture */}
                {activeLeadCallLogs.length > 0 && (
                  <div className="rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2.5 text-[11px] text-slate-700 space-y-2 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-200">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-slate-900 dark:text-slate-100">
                        Ligações Registradas ({activeLeadCallLogs.length}) · UaZapi & GoTalk
                      </span>
                      <span className="text-[10px] text-slate-500 dark:text-slate-400">
                        Gravações criptografadas no BucketDaInvicta
                      </span>
                    </div>
                    <div className="divide-y divide-slate-200/80 space-y-2">
                      {activeLeadCallLogs.slice(0, 5).map((cl) => (
                        <div key={cl.id} className="pt-2 first:pt-0 space-y-1.5">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="font-medium text-slate-800 dark:text-slate-100">
                              {cl.provider.toUpperCase()} · {cl.direction === 'inbound' ? 'Recebida' : 'Realizada'} ·{' '}
                              {cl.initiatedByName} → {cl.toNumber} ({cl.status})
                              {cl.durationSeconds ? ` · ${cl.durationSeconds}s` : ''}
                            </span>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <span className="font-mono text-[10px] text-slate-500 dark:text-slate-400">
                                {formatDateTimeBR(cl.createdAt)}
                              </span>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => toggleCallRecording(cl.id)}
                                className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[10px] font-semibold ${
                                  recordingCallLogId === cl.id
                                    ? 'bg-red-600 text-white'
                                    : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800'
                                }`}
                              >
                                {recordingCallLogId === cl.id ? (
                                  <>
                                    <Square className="w-2.5 h-2.5" />
                                    Salvar ({Math.max(1, Math.round((Date.now() - recordingCallStartedAt) / 1000))}s)
                                  </>
                                ) : (
                                  <>
                                    <Mic className="w-2.5 h-2.5 text-blue-700 dark:text-blue-300" />
                                    Gravar
                                  </>
                                )}
                              </button>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => {
                                  setUploadTargetCallLogId(cl.id);
                                  callAudioUploadRef.current?.click();
                                }}
                                className="inline-flex items-center gap-1 rounded border border-blue-200 bg-blue-50 px-2 py-1 text-[10px] font-semibold text-blue-800 hover:bg-blue-100 dark:border-blue-800/70 dark:bg-blue-950/50 dark:text-blue-300 dark:hover:bg-blue-900/60"
                              >
                                <Upload className="w-2.5 h-2.5" />
                                Anexar Áudio
                              </button>
                            </div>
                          </div>
                          {cl.errorDetail && !cl.recordingSha256 && (
                            <p className="text-[10px] text-slate-500 dark:text-slate-400">{cl.errorDetail}</p>
                          )}
                          {cl.recordingSha256 && (
                            <SecureBucketAudio
                              sha256={cl.recordingSha256}
                              fileName={cl.recordingFileName || `gravacao-${cl.id}.webm`}
                            />
                          )}
                          {cl.audioTranscript && (
                            <div className="rounded border border-blue-200 bg-white px-2.5 py-1.5 text-[11px] text-slate-700 dark:border-blue-800/70 dark:bg-slate-900 dark:text-slate-200">
                              <span className="font-bold text-blue-800 dark:text-blue-300">Transcrição da Chamada (Ivi): </span>
                              {cl.audioTranscript}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Archived Conversations, Audios & Calls in BucketDaInvicta */}
                <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-[11px] space-y-2 dark:border-slate-700 dark:bg-slate-900">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 font-semibold text-slate-900 dark:text-slate-100">
                      <Archive className="w-3.5 h-3.5 text-slate-700 dark:text-slate-200" />
                      <span>Registros Arquivados no BucketDaInvicta ({activeLeadArchives.length})</span>
                    </div>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={handleArchiveConversationNow}
                      className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-slate-50 px-2.5 py-1 text-[10px] font-semibold text-slate-800 hover:bg-slate-100 whitespace-nowrap dark:border-slate-600 dark:bg-slate-800/70 dark:text-slate-100 dark:hover:bg-slate-800"
                    >
                      <Archive className="w-3 h-3" />
                      Arquivar Conversa Agora
                    </button>
                  </div>
                  {activeLeadArchives.length === 0 ? (
                    <p className="text-[10px] text-slate-500 dark:text-slate-400">
                      Nenhum snapshot salvo ainda para este contato. Qualquer mensagem, áudio, ligação ou clique em "Arquivar Conversa Agora" grava o dossiê completo em tabela + BucketDaInvicta.
                    </p>
                  ) : (
                    <div className="max-h-36 overflow-y-auto overflow-x-auto scroll-rulers divide-y divide-slate-100 dark:divide-slate-800">
                      {activeLeadArchives.slice(0, 8).map((arch) => (
                        <div key={arch.id} className="py-1.5 flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="font-medium text-slate-800 truncate dark:text-slate-100">
                              {arch.archiveType === 'call_recording'
                                ? 'Gravação de Ligação'
                                : arch.archiveType === 'audio_message'
                                ? 'Áudio de Atendimento'
                                : arch.archiveType === 'conversation_snapshot'
                                ? 'Snapshot Conversa Completa'
                                : 'Anexo de Atendimento'}{' '}
                              · {arch.provider.toUpperCase()} ·{' '}
                              <span className="font-mono text-slate-500 dark:text-slate-400">
                                {arch.sha256Hash.slice(0, 10)}
                              </span>
                            </div>
                            <div className="text-[10px] text-slate-500 truncate dark:text-slate-400">
                              {formatDateTimeBR(arch.createdAt)} · {arch.createdByName}
                              {arch.transcriptText ? ` · "${arch.transcriptText.slice(0, 90)}"` : ''}
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {arch.mimeType.includes('json') && (
                              <button
                                type="button"
                                onClick={() => handleViewOrDownloadArchive(arch, 'preview')}
                                className="inline-flex items-center gap-1 text-[10px] font-semibold text-blue-700 hover:underline dark:text-blue-300"
                              >
                                <Eye className="w-3 h-3" />
                                Visualizar
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => handleViewOrDownloadArchive(arch, 'download')}
                              className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-700 hover:underline dark:text-slate-200"
                            >
                              <Download className="w-3 h-3" />
                              Baixar
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Reply Input */}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleSendMessage('ivi');
                  }}
                  className="space-y-2"
                >
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      type="text"
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      placeholder="Mensagem do cliente (para Ivi) ou resposta do operador..."
                      className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-xs min-w-0 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    />
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="submit"
                        disabled={busy || !replyText.trim()}
                        className="inline-flex items-center gap-1 rounded-lg bg-blue-700 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-50 whitespace-nowrap"
                      >
                        <Send className="w-3.5 h-3.5" />
                        Ivi
                      </button>
                      <button
                        type="button"
                        disabled={busy || !replyText.trim()}
                        onClick={() => handleSendMessage('human')}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                      >
                        Operador
                      </button>
                    </div>
                  </div>
                  <label className="inline-flex items-center gap-2 text-[11px] text-slate-600 dark:text-slate-300 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={replyWithAudio}
                      onChange={(e) => setReplyWithAudio(e.target.checked)}
                      className="rounded border-slate-300 text-blue-700 focus:ring-blue-600"
                    />
                    <Volume2 className="w-3.5 h-3.5 text-blue-700 dark:text-blue-300" />
                    <span>
                      Gerar também resposta verbal em áudio Gemini (gravado na base da Ivi para evitar gasto de tokens)
                    </span>
                  </label>
                </form>

                {onNavigate && (
                  <div className="flex justify-end pt-1 border-t border-slate-100 dark:border-slate-800">
                    <button
                      type="button"
                      onClick={() =>
                        onNavigate('admission', { tab: 'nova_admissao', triggerNew: true })
                      }
                      className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
                    >
                      Abrir Ficha de Admissão
                      <ArrowUpRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
                Selecione um contato na Fila Omnichannel ao lado ou clique em "+ Novo Lead / Contato".
              </div>
            )}
          </div>

          {/* 3. Conteiner Estreito à Direita: Resumo da Conversa (Ivi + Usuário + Data/Hora + Observações Agendamentos) */}
          <div className="md:col-span-3 rounded-xl border border-slate-200 bg-white overflow-hidden dark:border-slate-700 dark:bg-slate-900">
            <div className="px-3 py-2.5 border-b border-slate-200 flex items-center justify-between gap-2 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/70">
              <div className="flex items-center gap-2 min-w-0">
                <img
                  src={iviAvatarImg}
                  alt="Ivi"
                  className="w-6 h-6 rounded-full object-cover border border-slate-200 shrink-0 dark:border-slate-700"
                />
                <span className="text-xs font-bold text-slate-900 truncate dark:text-slate-100">Resumo da Conversa</span>
              </div>
              {activeLead && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleAutoSummarizeWithIvi}
                  className="text-[11px] font-semibold text-blue-700 hover:underline shrink-0 dark:text-blue-300"
                >
                  Gerar Ivi
                </button>
              )}
            </div>

            {activeLead ? (
              <div className="p-3 space-y-3 text-xs max-h-[600px] overflow-y-auto scroll-rulers">
                {/* Ivi Baget when conversation is purely by phone */}
                {purelyPhone && (
                  <div className="rounded-xl border border-blue-200 bg-blue-50 p-2.5 flex items-start gap-2.5 dark:border-blue-800/70 dark:bg-blue-950/50">
                    <img
                      src={iviAvatarImg}
                      alt="Ivi Assistente"
                      className="w-9 h-9 rounded-full object-cover border border-blue-300 shrink-0 dark:border-blue-800/70"
                    />
                    <div className="text-[11px] text-blue-950 space-y-1 dark:text-blue-300">
                      <p className="font-bold">Solicitação da Ivi: Preencha o Resumo</p>
                      <p className="leading-relaxed text-blue-900 dark:text-blue-300">
                        Este atendimento é puramente por telefone (sem texto/chat automático para leitura). Registre abaixo o resumo do que foi conversado para documentar no histórico e preencher o campo <strong>Observações</strong> nos Agendamentos.
                      </p>
                    </div>
                  </div>
                )}

                <div className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 space-y-1 text-[11px] dark:border-slate-700 dark:bg-slate-800/70">
                  <div className="flex justify-between gap-2">
                    <span className="text-slate-500 dark:text-slate-400">Usuário:</span>
                    <span className="font-semibold text-slate-900 truncate dark:text-slate-100">
                      {activeLead.summaryAuthor || currentUser?.name || 'Ivi IA'}
                    </span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-slate-500 dark:text-slate-400">Data / Hora:</span>
                    <span className="font-mono text-slate-700 shrink-0 dark:text-slate-200">
                      {activeLead.summaryUpdatedAt
                        ? formatDateTimeBR(activeLead.summaryUpdatedAt)
                        : 'Não salvo'}
                    </span>
                  </div>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1 text-[11px] dark:text-slate-200">
                    Síntese do Atendimento (encaminhada para Observações)
                  </label>
                  <textarea
                    rows={8}
                    value={summaryDraft}
                    onChange={(e) => setSummaryDraft(e.target.value)}
                    placeholder="Resumo do que foi discutido (gerado automaticamente pela Ivi a partir do texto/áudio ou preenchido manualmente após ligação)..."
                    className="w-full rounded-lg border border-slate-200 px-2.5 py-2 text-xs leading-relaxed dark:border-slate-700"
                  />
                </div>

                <button
                  type="button"
                  disabled={busy}
                  onClick={handleSaveSummary}
                  className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-emerald-600 dark:hover:bg-emerald-500"
                >
                  <Save className="w-3.5 h-3.5" />
                  Salvar Resumo
                </button>

                <p className="text-[11px] text-slate-500 leading-relaxed border-t border-slate-100 pt-2 dark:text-slate-400 dark:border-slate-800">
                  Ao confirmar um agendamento neste lead, este resumo com usuário, data e hora é enviado para o campo <strong>Observações</strong> em <strong>Agendamentos</strong>.
                </p>
              </div>
            ) : (
              <div className="p-4 text-xs text-slate-500 text-center dark:text-slate-400">
                Selecione um atendimento para visualizar ou editar o resumo da Ivi.
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'agenda' && (
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden dark:border-slate-700 dark:bg-slate-900">
          <div className="px-5 py-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 dark:border-slate-700">
            <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
              Quadro de Agendas · Fila por Unidade
            </h2>
            <div className="flex items-center gap-3">
              {onNavigate && (
                <button
                  type="button"
                  onClick={() => onNavigate('appointments', { tab: 'agenda' })}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <Calendar className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-300" />
                  Abrir Grade Completa (Agendamentos)
                </button>
              )}
              <span className="text-xs text-slate-500 font-mono dark:text-slate-400">
                {filteredAppointments.length} horários
              </span>
            </div>
          </div>
          <div className="overflow-x-auto scroll-rulers">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-500 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-400">
                  <th className="py-2.5 px-4">Cliente</th>
                  <th className="py-2.5 px-4">Unidade</th>
                  <th className="py-2.5 px-4">Consultor</th>
                  <th className="py-2.5 px-4">Modalidade</th>
                  <th className="py-2.5 px-4">Data / Hora</th>
                  <th className="py-2.5 px-4">Status</th>
                  <th className="py-2.5 px-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs dark:divide-slate-800">
                {filteredAppointments.map((a) => {
                  const u = units.find((unit) => unit.id === a.unitId);
                  const c = consultants.find((cons) => cons.id === a.consultantId);
                  return (
                    <tr key={a.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800">
                      <td className="py-3 px-4 font-semibold text-slate-900 dark:text-slate-100">
                        {a.clientName}
                        <div className="text-[11px] font-normal text-slate-500 dark:text-slate-400">
                          {a.clientPhone}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-slate-700 dark:text-slate-200">{u?.name || 'Matriz'}</td>
                      <td className="py-3 px-4 text-slate-700 dark:text-slate-200">{c?.name || 'Consultor'}</td>
                      <td className="py-3 px-4 text-slate-700 capitalize dark:text-slate-200">{a.modality}</td>
                      <td className="py-3 px-4 font-mono text-slate-700 dark:text-slate-200">
                        {formatDateTimeBR(a.scheduledFor)}
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`font-semibold ${
                            a.status === 'cumprido'
                              ? 'text-emerald-700 dark:text-emerald-300'
                              : a.status === 'faltoso'
                              ? 'text-red-600 dark:text-red-400'
                              : 'text-blue-700 dark:text-blue-300'
                          }`}
                        >
                          {a.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right space-x-2 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => handleApptStatus(a.id, 'cumprido')}
                          className="text-emerald-700 font-semibold hover:underline dark:text-emerald-300"
                        >
                          Cumprido
                        </button>
                        <button
                          type="button"
                          onClick={() => handleApptStatus(a.id, 'faltoso')}
                          className="text-red-600 font-semibold hover:underline dark:text-red-400"
                        >
                          Faltoso
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Schedule Blocks */}
          <div className="border-t border-slate-200 p-5 bg-slate-50/50 space-y-4 dark:border-slate-700 dark:bg-slate-800/60">
            <div>
              <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                Bloqueios de Agenda por Consultor
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                A fila Round-Robin pula automaticamente consultores com bloqueio ativo no horário.
              </p>
            </div>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!blockConsultantId || !blockStart || !blockEnd || !blockReason.trim()) return;
                setBusy(true);
                try {
                  await apiFetch('/api/prospection/schedule-blocks', {
                    method: 'POST',
                    body: JSON.stringify({
                      consultantId: Number(blockConsultantId),
                      startAt: blockStart,
                      endAt: blockEnd,
                      reason: blockReason,
                    }),
                  });
                  setBlockReason('');
                  setStatusBanner('Bloqueio de agenda registrado na fila de distribuição.');
                  await load();
                } finally {
                  setBusy(false);
                }
              }}
              className="grid grid-cols-1 sm:grid-cols-5 gap-2.5 text-xs items-end"
            >
              <div>
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Consultor</label>
                <select
                  value={blockConsultantId}
                  onChange={(e) => setBlockConsultantId(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                >
                  {consultants.map((c) => (
                    <option key={c.id} value={String(c.id)}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Início</label>
                <input
                  type="datetime-local"
                  required
                  value={blockStart}
                  onChange={(e) => setBlockStart(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Fim</label>
                <input
                  type="datetime-local"
                  required
                  value={blockEnd}
                  onChange={(e) => setBlockEnd(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Motivo</label>
                <input
                  type="text"
                  required
                  value={blockReason}
                  onChange={(e) => setBlockReason(e.target.value)}
                  placeholder="Ex: Visita externa / Férias"
                  className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 dark:border-slate-700 dark:bg-slate-900"
                />
              </div>
              <button
                type="submit"
                disabled={busy}
                className="rounded-lg bg-slate-900 px-3 py-2 font-semibold text-white hover:bg-slate-800 dark:bg-emerald-600 dark:hover:bg-emerald-500"
              >
                Bloquear Horário
              </button>
            </form>

            {scheduleBlocks.length > 0 && (
              <div className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white text-xs dark:divide-slate-700 dark:border-slate-700 dark:bg-slate-900">
                {scheduleBlocks.map((b) => {
                  const cons = consultants.find((c) => c.id === b.consultantId);
                  return (
                    <div
                      key={b.id}
                      className="px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2"
                    >
                      <div>
                        <span className="font-semibold text-slate-900 dark:text-slate-100">
                          {cons?.name || 'Consultor'}
                        </span>
                        <span className="text-slate-500 dark:text-slate-400"> · {b.reason}</span>
                      </div>
                      <span className="font-mono text-[11px] text-slate-600 dark:text-slate-300">
                        {formatDateTimeBR(b.startAt)} → {formatDateTimeBR(b.endAt)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'indicadores' && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
            {[
              { label: 'Leads Captados', val: metrics.captados, tone: 'text-slate-900 dark:text-slate-100' },
              { label: 'Recuperados', val: metrics.recuperados, tone: 'text-blue-700 dark:text-blue-300' },
              { label: 'Agend. Cumpridos', val: metrics.cumpridos, tone: 'text-emerald-700 dark:text-emerald-300' },
              { label: 'Agend. Faltosos', val: metrics.faltosos, tone: 'text-red-600 dark:text-red-400' },
              { label: 'Negócios Fechados', val: metrics.fechados, tone: 'text-emerald-700 dark:text-emerald-300' },
              { label: 'Sob Análise', val: metrics.analise, tone: 'text-amber-700 dark:text-amber-300' },
              { label: 'Não Fechadas', val: metrics.naoFechados, tone: 'text-slate-600 dark:text-slate-300' },
            ].map((k) => (
              <div key={k.label} className="rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-700 dark:bg-slate-900">
                <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">{k.label}</div>
                <div className={`mt-1.5 font-mono text-2xl font-bold tabular-nums ${k.tone}`}>
                  {k.val}
                </div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
              <h3 className="font-display text-sm font-bold text-slate-900 pb-3 border-b border-slate-100 dark:text-slate-100 dark:border-slate-800">
                Ranking de Consultores (Agendamentos & Cumprimento)
              </h3>
              <div className="mt-3 space-y-3">
                {metrics.byConsultant.map((c, idx) => (
                  <div key={c.name} className="flex items-center justify-between gap-3 text-xs">
                    <div className="flex items-center gap-2.5">
                      <span className="font-mono font-bold text-slate-400 w-5 dark:text-slate-400">0{idx + 1}</span>
                      <UserCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                      <span className="font-semibold text-slate-900 dark:text-slate-100">{c.name}</span>
                    </div>
                    <div className="font-mono text-slate-700 tabular-nums dark:text-slate-200">
                      {c.total} agend. ·{' '}
                      <span className="text-emerald-700 font-semibold dark:text-emerald-300">
                        {c.cumpridos} cumpridos
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
              <h3 className="font-display text-sm font-bold text-slate-900 pb-3 border-b border-slate-100 dark:text-slate-100 dark:border-slate-800">
                Distribuição por Canal de Captação
              </h3>
              <div className="mt-3 space-y-2.5 text-xs">
                {[
                  'whatsapp_gotalk',
                  'whatsapp_uazapi',
                  'instagram',
                  'facebook',
                  'email_maton',
                  'telefone',
                ].map((ch) => {
                  const total = filteredLeads.filter((l) => l.channel === ch).length;
                  const pct = filteredLeads.length
                    ? Math.round((total / filteredLeads.length) * 100)
                    : 0;
                  return (
                    <div key={ch} className="space-y-1">
                      <div className="flex justify-between">
                        <span className="font-medium text-slate-700 dark:text-slate-200">{ch}</span>
                        <span className="font-mono text-slate-600 tabular-nums dark:text-slate-300">
                          {total} ({pct}%)
                        </span>
                      </div>
                      <progress
                        value={pct}
                        max={100}
                        className="w-full h-2 rounded-full overflow-hidden accent-blue-600"
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === 'kb' && (
        <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4 dark:border-slate-700 dark:bg-slate-900">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
            <div>
              <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                Base de Conhecimento da Ivi · Prospecção Comercial & Voz Gemini
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Aprendizado automático ativo + curadoria exclusiva de administradores (inclusão, edição, exclusão e cache de áudio).
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-slate-500 font-mono dark:text-slate-400">
                {kb.length} artigos
              </span>
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => {
                    setKbEditingId(null);
                    setKbQuestionDraft('');
                    setKbAnswerDraft('');
                    setKbCategoryDraft('prospeccao');
                    setKbChannelDraft('whatsapp_uazapi');
                    setKbActiveDraft(true);
                    setKbFormOpen(true);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-800"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Incluir Orientação (Admin)
                </button>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <input
              type="text"
              value={kbSearchDraft}
              onChange={(e) => setKbSearchDraft(e.target.value)}
              placeholder="Filtrar perguntas, objeções ou respostas da prospecção..."
              className="w-full sm:max-w-md rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
            {!isAdmin && (
              <span className="text-[11px] font-medium text-amber-700 dark:text-amber-300">
                Somente administradores podem alterar ou excluir informações desta base.
              </span>
            )}
          </div>

          {isAdmin && kbFormOpen && (
            <form
              onSubmit={handleSaveProspectionKb}
              className="rounded-xl border border-blue-200 bg-blue-50/60 p-4 space-y-3 text-xs dark:border-blue-800/70 dark:bg-blue-950/30"
            >
              <div className="flex items-center justify-between">
                <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                  {kbEditingId ? 'Editar Orientação de Prospecção' : 'Nova Orientação de Prospecção'}
                </h3>
                <button
                  type="button"
                  onClick={() => {
                    setKbFormOpen(false);
                    setKbEditingId(null);
                  }}
                  className="text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <div className="sm:col-span-2">
                  <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">
                    Pergunta / Objeção do Cliente *
                  </label>
                  <input
                    type="text"
                    required
                    value={kbQuestionDraft}
                    onChange={(e) => setKbQuestionDraft(e.target.value)}
                    placeholder="Ex: Como funciona a proteção contra busca e apreensão?"
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Categoria</label>
                  <input
                    type="text"
                    value={kbCategoryDraft}
                    onChange={(e) => setKbCategoryDraft(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  />
                </div>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">
                  Resposta Oficial da Ivi (Texto & Áudio Verbal) *
                </label>
                <textarea
                  rows={3}
                  required
                  value={kbAnswerDraft}
                  onChange={(e) => setKbAnswerDraft(e.target.value)}
                  placeholder="Resposta clara, objetiva e acolhedora para esclarecer o cliente ao máximo..."
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="inline-flex items-center gap-2 font-medium text-slate-700 dark:text-slate-200">
                  <input
                    type="checkbox"
                    checked={kbActiveDraft}
                    onChange={(e) => setKbActiveDraft(e.target.checked)}
                    className="rounded border-slate-300 text-blue-700"
                  />
                  Artigo ativo nas respostas da Ivi
                </label>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setKbFormOpen(false);
                      setKbEditingId(null);
                    }}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={busy}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-1.5 font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    <Save className="w-3.5 h-3.5" />
                    Salvar na Base
                  </button>
                </div>
              </div>
            </form>
          )}

          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {kb
              .filter((item) => {
                if (!kbSearchDraft.trim()) return true;
                const q = kbSearchDraft.toLowerCase();
                return `${item.category} ${item.questionPattern} ${item.answerTemplate}`.toLowerCase().includes(q);
              })
              .map((item) => (
                <div key={item.id} className="py-3 space-y-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-blue-700 dark:text-blue-300">
                        {item.category} · {item.sourceChannel}
                      </span>
                      {item.active === false && (
                        <span className="font-mono text-[10px] text-amber-700 dark:text-amber-300">[INATIVO]</span>
                      )}
                      {item.updatedByName && (
                        <span className="text-[11px] text-slate-400">· {item.updatedByName}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono">{item.hitCount} usos</span>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={async () => {
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
                                text: item.answerTemplate,
                                sourceType: 'prospection',
                                moduleKey: 'prospection',
                              }),
                            });
                            if (!res.audioUrl) {
                              setStatusBanner(res.unavailableReason || 'Síntese Gemini indisponível.');
                              return;
                            }
                            setKbAudioPreview({ id: item.id, hash: res.cacheHash, cached: res.cached });
                          } finally {
                            setBusy(false);
                          }
                        }}
                        className="inline-flex items-center gap-1 rounded border border-blue-200 bg-blue-50 px-2 py-1 text-[11px] font-semibold text-blue-800 hover:bg-blue-100 dark:border-blue-800/70 dark:bg-blue-950/50 dark:text-blue-300"
                      >
                        <Volume2 className="w-3 h-3" />
                        Ouvir Áudio Gemini
                      </button>
                      {isAdmin && (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              setKbEditingId(item.id);
                              setKbQuestionDraft(item.questionPattern);
                              setKbAnswerDraft(item.answerTemplate);
                              setKbCategoryDraft(item.category || 'prospeccao');
                              setKbChannelDraft(item.sourceChannel || 'whatsapp_uazapi');
                              setKbActiveDraft(item.active !== false);
                              setKbFormOpen(true);
                            }}
                            className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                          >
                            <Pencil className="w-3 h-3" />
                            Editar
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteProspectionKb(item.id)}
                            className="inline-flex items-center gap-1 rounded border border-red-200 bg-red-50 px-2 py-1 text-[11px] font-semibold text-red-700 hover:bg-red-100 dark:border-red-900/70 dark:bg-red-950/40 dark:text-red-300"
                          >
                            <Trash2 className="w-3 h-3" />
                            Excluir
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {item.questionPattern}
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed dark:text-slate-300">{item.answerTemplate}</p>
                  {kbAudioPreview?.id === item.id && (
                    <CachedIviAudioPlayer
                      cacheHash={kbAudioPreview.hash}
                      cached={kbAudioPreview.cached}
                      label="Prévia Verbal da Base Prospecção (Gemini Audio)"
                    />
                  )}
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Modal: Novo Lead / Contato */}
      {newLeadModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 dark:bg-slate-950/80">
          <form
            onSubmit={handleCreateLead}
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl space-y-3.5 text-xs max-h-[90vh] overflow-y-auto scroll-rulers dark:border-slate-700 dark:bg-slate-900"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
              <h3 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                Registrar Novo Contato & Atendimento
              </h3>
              <button
                type="button"
                onClick={() => setNewLeadModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 p-1 dark:text-slate-400 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">
                Nome do Cliente {isWhatsappChannel(newLeadChannel) ? '(opcional se não visível no WhatsApp)' : '*'}
              </label>
              <input
                type="text"
                required={!isWhatsappChannel(newLeadChannel)}
                value={newLeadName}
                onChange={(e) => setNewLeadName(e.target.value)}
                placeholder="Ex: João Pedro Silva (ou deixe vazio se WhatsApp sem nome)"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">WhatsApp / Telefone (+55 automático)</label>
              <input
                type="text"
                required
                value={newLeadPhone}
                onChange={(e) => setNewLeadPhone(e.target.value)}
                placeholder="+55 (81) 99999-1234"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div>
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Canal de Origem</label>
                <select
                  value={newLeadChannel}
                  onChange={(e) => setNewLeadChannel(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                >
                  <option value="whatsapp_uazapi">WhatsApp (UaZapi)</option>
                  <option value="whatsapp_gotalk">WhatsApp (GoTalk)</option>
                  <option value="telefone">Telefone Receptivo</option>
                  <option value="instagram">Instagram Direct (Maton API)</option>
                  <option value="facebook">Facebook Messenger (Maton API)</option>
                  <option value="email_maton">E-mail Comercial (Maton API)</option>
                </select>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Atendimento Inicial</label>
                <select
                  value={newLeadMode}
                  onChange={(e) => setNewLeadMode(e.target.value as 'ivi' | 'human')}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                >
                  <option value="ivi">Ivi IA</option>
                  <option value="human">Operador Humano</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Mensagem / Contexto Inicial</label>
              <textarea
                rows={2}
                value={newLeadMessage}
                onChange={(e) => setNewLeadMessage(e.target.value)}
                placeholder="Dúvida ou solicitação inicial do cliente..."
                className="w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700"
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setNewLeadModalOpen(false)}
                className="rounded-lg border border-slate-200 px-4 py-2 font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={busy}
                className="rounded-lg bg-emerald-600 px-4 py-2 font-semibold text-white hover:bg-emerald-700"
              >
                Registrar Atendimento
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal de Contato Básico (Ivi): WhatsApp sem nome evidente */}
      {basicContactModalOpen && activeLead && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 dark:bg-slate-950/80">
          <form
            onSubmit={handleSaveBasicContact}
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl space-y-4 text-xs dark:border-slate-700 dark:bg-slate-900"
          >
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3 dark:border-slate-800">
              <div className="flex items-center gap-3">
                <img
                  src={iviAvatarImg}
                  alt="Ivi"
                  className="w-11 h-11 rounded-full object-cover border border-blue-200 shrink-0 dark:border-blue-800/70"
                />
                <div>
                  <h3 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                    Contato Básico (Ivi IA)
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Nome não evidente no WhatsApp. Complete o contato com DDI +55.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setBasicContactModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 p-1 dark:text-slate-400 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Nome do Cliente *</label>
              <input
                type="text"
                required
                value={contactNameDraft}
                onChange={(e) => setContactNameDraft(e.target.value)}
                placeholder="Informe o nome completo obtido com o cliente..."
                className="w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">
                Número do Telefone (com +55) *
              </label>
              <input
                type="text"
                required
                value={contactPhoneDraft}
                onChange={(e) => {
                  const val = e.target.value;
                  setContactPhoneDraft(val.startsWith('+55') ? val : `+55 ${val.replace(/^\+?55\s*/, '')}`);
                }}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono dark:border-slate-700"
              />
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setBasicContactModalOpen(false)}
                className="rounded-lg border border-slate-200 px-4 py-2 font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200"
              >
                Fechar
              </button>
              <button
                type="submit"
                disabled={busy || !contactNameDraft.trim()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-4 py-2 font-semibold text-white hover:bg-blue-800 disabled:opacity-50"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                Salvar Contato (+55)
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal: Agendamento Rápido na Fila da Unidade (Observações recebe o Resumo) */}
      {scheduleModalOpen && activeLead && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 dark:bg-slate-950/80">
          <form
            onSubmit={handleSchedule}
            className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl space-y-3.5 text-xs max-h-[90vh] overflow-y-auto scroll-rulers dark:border-slate-700 dark:bg-slate-900"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
              <div>
                <h3 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                  Agendar Atendimento · {activeLead.name || 'Cliente WhatsApp'}
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  O resumo da conversa (usuário, data e hora) será salvo no campo Observações.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setScheduleModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 p-1 dark:text-slate-400 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Modalidade</label>
                <select
                  value={schedModality}
                  onChange={(e) => setSchedModality(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                >
                  <option value="presencial">Presencial na Unidade</option>
                  <option value="telefone">Por Telefone</option>
                  <option value="video">Vídeo Chamada</option>
                </select>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Data e Horário</label>
                <input
                  type="datetime-local"
                  value={schedDate}
                  onChange={(e) => setSchedDate(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">
                Observações para o Agendamento (Resumo da Conversa)
              </label>
              <textarea
                rows={5}
                value={schedNotesDraft}
                onChange={(e) => setSchedNotesDraft(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 leading-relaxed dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
            <div className="flex flex-wrap justify-between items-center gap-2 pt-1">
              {onNavigate && (
                <button
                  type="button"
                  onClick={() => {
                    setScheduleModalOpen(false);
                    handleOpenInFullAppointments();
                  }}
                  className="text-blue-700 font-semibold hover:underline dark:text-blue-300"
                >
                  Abrir na Grade Completa (Agendamentos) →
                </button>
              )}
              <div className="flex gap-2 ml-auto">
                <button
                  type="button"
                  onClick={() => setScheduleModalOpen(false)}
                  className="rounded-lg border border-slate-200 px-4 py-2 font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 font-semibold text-white hover:bg-emerald-700"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Confirmar & Notificar Consultor
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* Modal: Visualizador de Snapshot do BucketDaInvicta */}
      {archiveViewer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 dark:bg-slate-950/80">
          <div className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl space-y-3 text-xs max-h-[88vh] flex flex-col dark:border-slate-700 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
              <div className="min-w-0">
                <h3 className="font-display text-sm font-bold text-slate-900 truncate dark:text-slate-100">
                  Dossiê Arquivado · {archiveViewer.fileName}
                </h3>
                <p className="text-[10px] font-mono text-slate-500 dark:text-slate-400">
                  BucketDaInvicta SHA-256: {archiveViewer.sha256}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setArchiveViewer(null)}
                className="text-slate-400 hover:text-slate-700 p-1 dark:text-slate-400 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <pre className="flex-1 overflow-auto scroll-rulers rounded-lg border border-slate-200 bg-slate-950 text-slate-100 p-3 font-mono text-[11px] leading-relaxed dark:border-slate-700">
              {archiveViewer.content}
            </pre>
          </div>
        </div>
      )}
      <EntityAuditModal
        open={auditModalOpen && Boolean(activeLead)}
        title={activeLead ? `Prospecção · ${activeLead.name || activeLead.phone}` : 'Lead'}
        entityType="prospection_leads"
        entityId={activeLead?.id || 0}
        onClose={() => setAuditModalOpen(false)}
      />
      <EntityAuditModal
        open={sectorAuditOpen}
        title="Prospecção & Funil Comercial · Auditoria Cumulativa"
        entityType="prospection_leads,appointments,whatsapp_messages,whatsapp_call_logs"
        entityId="all"
        onClose={() => setSectorAuditOpen(false)}
      />
    </div>
  );
};
