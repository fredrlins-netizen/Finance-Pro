import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  Ban,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Eye,
  FolderOpen,
  History,
  Plus,
  RefreshCw,
  Scale,
  Send,
  ShieldCheck,
  ShieldOff,
  Sparkles,
  Wallet,
  X,
} from 'lucide-react';
import { apiFetch, formatBRL, formatDateTimeBR } from '../../lib/api.ts';
import type { FormMergeContext } from '../../lib/formTemplateRenderer.ts';
import { FormTemplateButton } from '../FormTemplateButton.tsx';
import {
  Client,
  CollectionCase,
  FinancialTitle,
  LegalMovement,
  LegalProcess,
  ModuleId,
  NavigationIntent,
  Unit,
} from '../../types.ts';
import { CollapsibleFilterBar } from '../CollapsibleFilterBar.tsx';
import { EntityAuditModal } from './cadastros/CadastrosShared.tsx';

interface LegalModuleProps {
  units: Unit[];
  wsTick: number;
  navIntent?: NavigationIntent | null;
  onClearIntent?: () => void;
  onNavigate?: (mod: ModuleId, intent?: NavigationIntent) => void;
}

interface LegalLawyerRef {
  id: number;
  name: string;
  role: string;
}

type TimelinePointType =
  | 'abertura'
  | 'movimento'
  | 'abertura_leitura'
  | 'leitura'
  | 'retorno'
  | 'integracao';

interface LegalTimelinePoint {
  id: string;
  stepIndex: number;
  pointType: TimelinePointType;
  timestamp: string;
  title: string;
  subtitle: string;
  summary: string;
  statusAtPoint: string;
  tone: 'red' | 'amber' | 'blue' | 'emerald' | 'slate';
  movement: LegalMovement | null;
  originalDispatchSnapshot: string;
  iviTranslationSnapshot: string;
  contactSnapshot?: {
    channel: string | null;
    summary: string | null;
    emailSent: boolean;
    at: string;
  } | null;
}

const ACTION_TYPE_LABELS: Record<string, string> = {
  busca_apreensao: 'Busca e Apreensão',
  revisional: 'Ação Revisional',
  execucao: 'Execução',
};

const PROCESS_STATUS_META: Record<string, { label: string; toneClass: string }> = {
  alerta_movimentacao: { label: 'Movimentação Nova', toneClass: 'text-red-700 font-semibold dark:text-red-300' },
  apreendido: { label: 'Veículo Apreendido', toneClass: 'text-red-700 font-bold dark:text-red-300' },
  em_acompanhamento: { label: 'Em Acompanhamento', toneClass: 'text-blue-700 font-semibold dark:text-blue-300' },
  revertido: { label: 'Revertido', toneClass: 'text-emerald-700 font-semibold dark:text-emerald-300' },
  suspenso: { label: 'Suspenso (Cobrança)', toneClass: 'text-amber-800 font-semibold dark:text-amber-200' },
  cancelado: { label: 'Cancelado (Contrato)', toneClass: 'text-red-800 font-semibold dark:text-red-200' },
};

const SOURCE_LABELS: Record<string, string> = {
  escavador_webhook: 'Webhook Escavador',
  escavador_fallback: 'Varredura Escavador',
  detran_scan: 'Varredura Detran',
  integracao_cobranca: 'Integração Cobrança & Ivi',
};

function isEscavadorActiveForProcess(proc: LegalProcess, client?: Client): boolean {
  if (proc.escavadorMonitored === false) return false;
  if (proc.status === 'suspenso' || proc.status === 'cancelado') return false;
  if (client?.status === 'suspenso' || client?.status === 'cancelado') return false;
  return true;
}

function buildTimelinePoints(
  proc: LegalProcess,
  procMovements: LegalMovement[],
  clientName: string,
  lawyerName: string
): LegalTimelinePoint[] {
  const sortedAsc = [...procMovements].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  const actionLabel = ACTION_TYPE_LABELS[proc.actionType] || proc.actionType.replace(/_/g, ' ');
  const firstMovTs = sortedAsc[0]?.createdAt;
  const openingTs = proc.createdAt || firstMovTs || proc.lastMovementAt || new Date().toISOString();

  const rawPoints: Omit<LegalTimelinePoint, 'stepIndex'>[] = [
    {
      id: `open-${proc.id}`,
      pointType: 'abertura',
      timestamp: openingTs,
      title: 'Abertura & Monitoramento no Setor Jurídico',
      subtitle: `${proc.courtName} · ${actionLabel} · Resp.: ${lawyerName}`,
      summary: proc.hasSearchSeizure
        ? `Processo de ${clientName} distribuído com alerta preventivo de busca e apreensão ativo no Escavador.`
        : `Processo de ${clientName} ingressou em acompanhamento preventivo contínuo no Escavador e Detran.`,
      statusAtPoint: proc.hasSearchSeizure
        ? 'Monitoramento Intensivo (Busca e Apreensão)'
        : 'Em Acompanhamento Preventivo',
      tone: proc.hasSearchSeizure ? 'amber' : 'blue',
      movement: null,
      originalDispatchSnapshot: `Abertura do cadastro processual nº ${proc.processNumber} perante ${proc.courtName} (${actionLabel}).`,
      iviTranslationSnapshot: proc.hasSearchSeizure
        ? 'Nesta etapa inicial, a Ivi registrou o protocolo sob vigilância prioritária de busca e apreensão via Escavador para resposta imediata caso haja despacho liminar.'
        : 'Nesta etapa inicial, o processo entrou em acompanhamento regular no Escavador para monitoramento automático de novas publicações e movimentações judiciais.',
    },
  ];

  sortedAsc.forEach((mov, idx) => {
    const srcLabel = SOURCE_LABELS[mov.source] || mov.source.replace(/_/g, ' ');

    if (mov.source === 'integracao_cobranca') {
      const upperDispatch = mov.originalDispatch.toUpperCase();
      const isReactivation = upperDispatch.includes('RETORNO AO STATUS NORMAL');
      const isCancelled = upperDispatch.includes('CONTRATO CANCELADO');

      rawPoints.push({
        id: `mov-${mov.id}`,
        pointType: 'integracao',
        timestamp: mov.createdAt,
        title: isReactivation
          ? 'Retorno ao Status Normal · Ivi Reativou CPF/CNPJ no Escavador'
          : isCancelled
          ? 'Contrato Cancelado · Ivi Retirou CPF/CNPJ do Escavador'
          : 'Cliente Suspenso · Ivi Retirou CPF/CNPJ do Escavador',
        subtitle: mov.contactSummary || `Sincronização automática · ${srcLabel}`,
        summary: mov.iviTranslationPtBr,
        statusAtPoint: isReactivation
          ? 'Status Normal · Escavador Reativado (Ivi)'
          : isCancelled
          ? 'Contrato Cancelado · Fora do Escavador'
          : 'Suspenso (Cobrança) · Fora do Escavador',
        tone: isReactivation ? 'emerald' : isCancelled ? 'red' : 'amber',
        movement: mov,
        originalDispatchSnapshot: mov.originalDispatch,
        iviTranslationSnapshot: mov.iviTranslationPtBr,
      });
      return;
    }

    const dispatchLower = mov.originalDispatch.toLowerCase();
    const mentionsSeizure =
      dispatchLower.includes('apreendido') ||
      dispatchLower.includes('recolhido') ||
      dispatchLower.includes('cumprido o mandado');
    const isLastMov = idx === sortedAsc.length - 1;
    const isSeizedAtMov = mentionsSeizure || (isLastMov && proc.vehicleSeized);

    rawPoints.push({
      id: `mov-${mov.id}`,
      pointType: 'movimento',
      timestamp: mov.createdAt,
      title: `Movimentação #${idx + 1} · ${srcLabel}`,
      subtitle: `${proc.courtName} · Recebido via ${srcLabel}`,
      summary: mov.iviTranslationPtBr,
      statusAtPoint: isSeizedAtMov
        ? 'Veículo Apreendido / Auto Cumprido'
        : 'Alerta de Movimentação Recebida',
      tone: isSeizedAtMov ? 'red' : 'amber',
      movement: mov,
      originalDispatchSnapshot: mov.originalDispatch,
      iviTranslationSnapshot: mov.iviTranslationPtBr,
    });

    if (mov.openedAt) {
      rawPoints.push({
        id: `opened-${mov.id}`,
        pointType: 'abertura_leitura',
        timestamp: mov.openedAt,
        title: `Passo 1 SLA · Despacho Aberto (#${idx + 1})`,
        subtitle: `Equipe jurídica iniciou a análise da movimentação #${idx + 1}`,
        summary: 'Movimentação aberta para conferência do despacho original e da tradução Ivi.',
        statusAtPoint: 'Em Análise Jurídica (Aguardando Confirmação de Leitura)',
        tone: 'blue',
        movement: mov,
        originalDispatchSnapshot: mov.originalDispatch,
        iviTranslationSnapshot: mov.iviTranslationPtBr,
      });
    }

    if (mov.readCompletedAt) {
      rawPoints.push({
        id: `read-${mov.id}`,
        pointType: 'leitura',
        timestamp: mov.readCompletedAt,
        title: `Passo 2 SLA · Leitura Jurídica Confirmada (#${idx + 1})`,
        subtitle: `Responsável: ${lawyerName} · Pendência de leitura encerrada`,
        summary: 'Leitura do despacho formalmente concluída. Próxima etapa: retorno orientado ao cliente.',
        statusAtPoint: mov.clientContactedAt
          ? 'Leitura Confirmada · Seguindo para Retorno'
          : 'Leitura Concluída (Aguardando Retorno ao Cliente)',
        tone: 'blue',
        movement: mov,
        originalDispatchSnapshot: mov.originalDispatch,
        iviTranslationSnapshot: mov.iviTranslationPtBr,
      });
    }

    if (mov.clientContactedAt) {
      rawPoints.push({
        id: `contact-${mov.id}`,
        pointType: 'retorno',
        timestamp: mov.clientContactedAt,
        title: `Passo 3 SLA · Retorno ao Cliente Registrado (#${idx + 1})`,
        subtitle: `Canal: ${(mov.contactChannel || 'whatsapp').toUpperCase()}${
          mov.emailSent ? ' · E-mail oficial enviado' : ''
        }`,
        summary: mov.contactSummary || 'Cliente devidamente orientado pela equipe jurídica.',
        statusAtPoint: 'SLA Concluído · Cliente Orientado',
        tone: 'emerald',
        movement: mov,
        originalDispatchSnapshot: mov.originalDispatch,
        iviTranslationSnapshot: mov.iviTranslationPtBr,
        contactSnapshot: {
          channel: mov.contactChannel,
          summary: mov.contactSummary,
          emailSent: mov.emailSent,
          at: mov.clientContactedAt,
        },
      });
    }
  });

  const hasIntegrationMov = sortedAsc.some((m) => m.source === 'integracao_cobranca');
  if ((proc.status === 'suspenso' || proc.status === 'cancelado') && !hasIntegrationMov) {
    const lastTs = rawPoints[rawPoints.length - 1]?.timestamp || openingTs;
    const isCancel = proc.status === 'cancelado';
    rawPoints.push({
      id: `status-${proc.status}-${proc.id}`,
      pointType: 'integracao',
      timestamp: proc.escavadorUpdatedAt || proc.lastMovementAt || lastTs,
      title: isCancel
        ? 'Contrato Cancelado · Ivi Retirou CPF/CNPJ do Escavador'
        : 'Suspensão Financeira · Ivi Retirou CPF/CNPJ do Escavador',
      subtitle: proc.statusChangeReason
        ? `Causa: ${proc.statusChangeReason}`
        : `Status atual no processo ${proc.processNumber}`,
      summary:
        proc.escavadorLastActionNote ||
        (isCancel
          ? 'Contrato cancelado com retirada automática dos dados do Escavador pela Ivi.'
          : 'Acompanhamento jurídico suspenso com retirada automática dos dados do Escavador pela Ivi.'),
      statusAtPoint: isCancel
        ? 'Cancelado (Contrato) · Fora do Escavador'
        : 'Suspenso (Cobrança) · Fora do Escavador',
      tone: isCancel ? 'red' : 'amber',
      movement: sortedAsc[sortedAsc.length - 1] || null,
      originalDispatchSnapshot:
        proc.statusChangeReason ||
        `Processo ${proc.processNumber} marcado como ${isCancel ? 'cancelado' : 'suspenso'}.`,
      iviTranslationSnapshot:
        proc.escavadorLastActionNote ||
        'Ivi manteve os dados (CPF/CNPJ) fora da pesquisa do Escavador até retorno ao status normal.',
    });
  }

  return rawPoints.map((pt, index) => ({
    ...pt,
    stepIndex: index + 1,
  }));
}

export const LegalModule: React.FC<LegalModuleProps> = ({
  units,
  wsTick,
  navIntent,
  onClearIntent,
  onNavigate,
}) => {
  const [processes, setProcesses] = useState<LegalProcess[]>([]);
  const [movements, setMovements] = useState<LegalMovement[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [lawyers, setLawyers] = useState<LegalLawyerRef[]>([]);
  const [collectionCases, setCollectionCases] = useState<CollectionCase[]>([]);
  const [financialTitles, setFinancialTitles] = useState<FinancialTitle[]>([]);
  const [loadingList, setLoadingList] = useState(true);

  // Highlighted row in grid (timeline always follows this) vs Explicitly Opened Process
  const [highlightedProcessId, setHighlightedProcessId] = useState<number | null>(null);
  const [openedProcessId, setOpenedProcessId] = useState<number | null>(null);
  const [activeTimelinePointId, setActiveTimelinePointId] = useState<string | null>(null);
  const [gridCollapsed, setGridCollapsed] = useState(false);

  const [unitFilter, setUnitFilter] = useState('all');
  const [periodFilter, setPeriodFilter] = useState('30d');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  // Escavador Dispatch Modal & Contact Form
  const [dispatchModalOpen, setDispatchModalOpen] = useState(false);
  const [newDispatchText, setNewDispatchText] = useState('');
  const [isSeizedFlag, setIsSeizedFlag] = useState(false);
  const [contactChannel, setContactChannel] = useState('whatsapp');
  const [contactSummary, setContactSummary] = useState('');
  const [emailSent, setEmailSent] = useState(true);
  const [busy, setBusy] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [auditProcess, setAuditProcess] = useState<LegalProcess | null>(null);
  const [sectorAuditOpen, setSectorAuditOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<{
        processes: LegalProcess[];
        movements: LegalMovement[];
        clients: Client[];
        lawyers?: LegalLawyerRef[];
        collectionCases?: CollectionCase[];
        financialTitles?: FinancialTitle[];
      }>('/api/legal');
      setProcesses(data.processes);
      setMovements(data.movements);
      setClients(data.clients);
      if (Array.isArray(data.lawyers)) setLawyers(data.lawyers);
      if (Array.isArray(data.collectionCases)) setCollectionCases(data.collectionCases);
      if (Array.isArray(data.financialTitles)) setFinancialTitles(data.financialTitles);

      setHighlightedProcessId((prev) => {
        if (prev && data.processes.some((p) => p.id === prev)) return prev;
        const urgent = data.processes.find((p) => p.hasUnreadMovement || p.vehicleSeized);
        return urgent ? urgent.id : data.processes[0]?.id ?? null;
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao carregar processos jurídicos.');
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [wsTick, load]);

  const openProcessForAnalysis = useCallback(
    async (proc: LegalProcess, targetPointId?: string) => {
      setHighlightedProcessId(proc.id);
      setOpenedProcessId(proc.id);
      setErrorMsg('');

      if (targetPointId) {
        setActiveTimelinePointId(targetPointId);
      } else {
        setActiveTimelinePointId(null);
      }

      const unread = movements.find((m) => m.processId === proc.id && !m.openedAt);
      if (unread) {
        try {
          await apiFetch(`/api/legal/movements/${unread.id}/open`, { method: 'POST' });
          await load();
        } catch {
          // non-blocking
        }
      }
    },
    [movements, load]
  );

  const handleCloseAnalyzedProcess = useCallback(() => {
    setOpenedProcessId(null);
    setGridCollapsed(false);
  }, []);

  useEffect(() => {
    if (!navIntent) return;
    if (navIntent.processId && processes.length > 0) {
      const target = processes.find((p) => p.id === navIntent.processId);
      setStatusFilter('all');
      if (target) {
        openProcessForAnalysis(target);
      }
    } else if (navIntent.clientId && processes.length > 0) {
      const match = processes.find((p) => p.clientId === navIntent.clientId);
      if (match) {
        setStatusFilter('all');
        openProcessForAnalysis(match);
      }
    }
    onClearIntent?.();
  }, [navIntent, processes, onClearIntent, openProcessForAnalysis]);

  // Prioritize unread Escavador alerts and seized vehicles at the top
  const filteredProcesses = useMemo(() => {
    return processes
      .filter((p) => {
        if (unitFilter !== 'all' && String(p.unitId) !== unitFilter) return false;
        if (statusFilter !== 'all' && p.status !== statusFilter) return false;
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          const c = clients.find((cl) => cl.id === p.clientId);
          const match =
            p.processNumber.toLowerCase().includes(q) ||
            p.courtName.toLowerCase().includes(q) ||
            (c?.fullName || '').toLowerCase().includes(q) ||
            (c?.cpfCnpj || '').toLowerCase().includes(q);
          if (!match) return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (a.hasUnreadMovement !== b.hasUnreadMovement) return a.hasUnreadMovement ? -1 : 1;
        if (a.vehicleSeized !== b.vehicleSeized) return a.vehicleSeized ? -1 : 1;
        return 0;
      });
  }, [processes, clients, unitFilter, statusFilter, searchQuery]);

  // Process currently shown in the Persistent Timeline (opened process or highlighted grid row)
  const timelineProcess = useMemo(() => {
    const targetId = openedProcessId ?? highlightedProcessId;
    return (
      filteredProcesses.find((p) => p.id === targetId) ||
      processes.find((p) => p.id === targetId) ||
      filteredProcesses[0] ||
      null
    );
  }, [openedProcessId, highlightedProcessId, filteredProcesses, processes]);

  // Process currently OPENED for full analysis
  const analyzedProcess = useMemo(() => {
    if (openedProcessId === null) return null;
    return (
      processes.find((p) => p.id === openedProcessId) ||
      filteredProcesses.find((p) => p.id === openedProcessId) ||
      null
    );
  }, [openedProcessId, processes, filteredProcesses]);

  const timelineClient = timelineProcess
    ? clients.find((c) => c.id === timelineProcess.clientId)
    : undefined;

  const timelineLawyerName = useMemo(() => {
    if (!timelineProcess?.assignedLawyerId) return 'Equipe Jurídica';
    return (
      lawyers.find((l) => l.id === timelineProcess.assignedLawyerId)?.name || 'Advogado Designado'
    );
  }, [timelineProcess, lawyers]);

  const timelinePoints = useMemo(() => {
    if (!timelineProcess) return [];
    const procMovs = movements.filter((m) => m.processId === timelineProcess.id);
    return buildTimelinePoints(
      timelineProcess,
      procMovs,
      timelineClient?.fullName || `Cliente #${timelineProcess.clientId}`,
      timelineLawyerName
    );
  }, [timelineProcess, movements, timelineClient, timelineLawyerName]);

  // Keep activeTimelinePointId valid whenever timelinePoints changes (defaults to latest milestone)
  useEffect(() => {
    if (timelinePoints.length === 0) {
      if (activeTimelinePointId !== null) setActiveTimelinePointId(null);
      return;
    }
    if (!activeTimelinePointId || !timelinePoints.some((pt) => pt.id === activeTimelinePointId)) {
      setActiveTimelinePointId(timelinePoints[timelinePoints.length - 1].id);
    }
  }, [timelinePoints, activeTimelinePointId]);

  const activePoint = useMemo(() => {
    if (timelinePoints.length === 0) return null;
    return (
      timelinePoints.find((pt) => pt.id === activeTimelinePointId) ||
      timelinePoints[timelinePoints.length - 1]
    );
  }, [timelinePoints, activeTimelinePointId]);

  const handleTimelinePointClick = async (point: LegalTimelinePoint) => {
    if (!timelineProcess) return;
    if (openedProcessId !== timelineProcess.id) {
      await openProcessForAnalysis(timelineProcess, point.id);
    } else {
      setActiveTimelinePointId(point.id);
    }
  };

  const handleReadComplete = async (movementId: number) => {
    setBusy(true);
    setErrorMsg('');
    try {
      await apiFetch(`/api/legal/movements/${movementId}/read-complete`, { method: 'POST' });
      setFeedbackMsg('Passo 2 (Leitura do despacho) confirmado e gravado na linha do tempo.');
      setActiveTimelinePointId(`read-${movementId}`);
      await load();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao confirmar leitura.');
    } finally {
      setBusy(false);
    }
  };

  const handleRegisterContact = async (movementId: number) => {
    if (!contactSummary.trim()) return;
    setBusy(true);
    setErrorMsg('');
    try {
      await apiFetch(`/api/legal/movements/${movementId}/client-contact`, {
        method: 'POST',
        body: JSON.stringify({ contactChannel, contactSummary, emailSent }),
      });
      setContactSummary('');
      setFeedbackMsg('Passo 3 (Retorno ao cliente e SLA) concluído na linha do tempo.');
      setActiveTimelinePointId(`contact-${movementId}`);
      await load();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao registrar retorno ao cliente.');
    } finally {
      setBusy(false);
    }
  };

  const handleSimulateEscavador = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetProc = analyzedProcess || timelineProcess;
    if (!targetProc || !newDispatchText.trim()) return;
    setBusy(true);
    setErrorMsg('');
    try {
      const res = await apiFetch<{ movement: LegalMovement }>('/api/legal/escavador-sync', {
        method: 'POST',
        body: JSON.stringify({
          processId: targetProc.id,
          dispatchText: newDispatchText,
          source: 'escavador_webhook',
          isSeized: isSeizedFlag,
        }),
      });
      setNewDispatchText('');
      setIsSeizedFlag(false);
      setDispatchModalOpen(false);
      setOpenedProcessId(targetProc.id);
      setHighlightedProcessId(targetProc.id);
      if (res.movement?.id) {
        setActiveTimelinePointId(`mov-${res.movement.id}`);
      }
      setFeedbackMsg('Novo despacho Escavador processado e adicionado à linha do tempo.');
      await load();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao processar despacho Escavador.');
    } finally {
      setBusy(false);
    }
  };

  const billingByClientId = useMemo(() => {
    const map = new Map<
      number,
      {
        openBalanceCents: number;
        overdueCount: number;
        openCount: number;
        paidCount: number;
        cancelledCount: number;
        casesCount: number;
        activeCaseStatus: string | null;
      }
    >();

    for (const title of financialTitles) {
      const entry = map.get(title.clientId) || {
        openBalanceCents: 0,
        overdueCount: 0,
        openCount: 0,
        paidCount: 0,
        cancelledCount: 0,
        casesCount: 0,
        activeCaseStatus: null,
      };
      const st = String(title.status || '').toUpperCase();
      const bal = Number(title.currentBalanceCents ?? title.amountCents ?? 0);
      if (st === 'PAGO') {
        entry.paidCount += 1;
      } else if (st === 'CANCELADO') {
        entry.cancelledCount += 1;
      } else {
        entry.openCount += 1;
        entry.openBalanceCents += bal;
        if (st === 'ATRASADO' || st === 'VENCIDO' || new Date(title.dueDate).getTime() < Date.now()) {
          entry.overdueCount += 1;
        }
      }
      map.set(title.clientId, entry);
    }

    for (const c of collectionCases) {
      const entry = map.get(c.clientId) || {
        openBalanceCents: 0,
        overdueCount: 0,
        openCount: 0,
        paidCount: 0,
        cancelledCount: 0,
        casesCount: 0,
        activeCaseStatus: null,
      };
      entry.casesCount += 1;
      if (!entry.activeCaseStatus) {
        entry.activeCaseStatus = c.status;
      }
      map.set(c.clientId, entry);
    }

    return map;
  }, [financialTitles, collectionCases]);

  const slaStats = useMemo(() => {
    const readPairs = movements.filter((m) => m.openedAt && m.readCompletedAt);
    const avgOpenToReadMin = readPairs.length
      ? Math.round(
          readPairs.reduce(
            (acc, m) =>
              acc +
              (new Date(m.readCompletedAt!).getTime() - new Date(m.openedAt!).getTime()) / 60000,
            0
          ) / readPairs.length
        )
      : 14;

    const contactPairs = movements.filter((m) => m.readCompletedAt && m.clientContactedAt);
    const avgReadToContactMin = contactPairs.length
      ? Math.round(
          contactPairs.reduce(
            (acc, m) =>
              acc +
              (new Date(m.clientContactedAt!).getTime() - new Date(m.readCompletedAt!).getTime()) /
                60000,
            0
          ) / contactPairs.length
        )
      : 22;

    let escavadorActiveCount = 0;
    let escavadorPausedCount = 0;
    for (const p of filteredProcesses) {
      const c = clients.find((cl) => cl.id === p.clientId);
      if (isEscavadorActiveForProcess(p, c)) {
        escavadorActiveCount += 1;
      } else {
        escavadorPausedCount += 1;
      }
    }

    return {
      total: filteredProcesses.length,
      escavadorActiveCount,
      escavadorPausedCount,
      searchSeizure: filteredProcesses.filter((p) => p.hasSearchSeizure).length,
      seized: filteredProcesses.filter((p) => p.vehicleSeized).length,
      avgOpenToReadMin,
      avgReadToContactMin,
    };
  }, [filteredProcesses, movements, clients]);

  const activePointIndex = activePoint
    ? timelinePoints.findIndex((pt) => pt.id === activePoint.id)
    : -1;
  const prevTimelinePoint = activePointIndex > 0 ? timelinePoints[activePointIndex - 1] : null;
  const nextTimelinePoint =
    activePointIndex >= 0 && activePointIndex < timelinePoints.length - 1
      ? timelinePoints[activePointIndex + 1]
      : null;

  const activeMovementForPoint = activePoint?.movement || null;
  const analyzedClient = analyzedProcess
    ? clients.find((c) => c.id === analyzedProcess.clientId)
    : undefined;
  const analyzedBilling = analyzedProcess
    ? billingByClientId.get(analyzedProcess.clientId)
    : undefined;
  const analyzedEscavadorActive = analyzedProcess
    ? isEscavadorActiveForProcess(analyzedProcess, analyzedClient)
    : true;
  const targetEscavadorProc = analyzedProcess || timelineProcess;
  const targetEscavadorClient = targetEscavadorProc
    ? clients.find((c) => c.id === targetEscavadorProc.clientId)
    : undefined;
  const targetEscavadorActive = targetEscavadorProc
    ? isEscavadorActiveForProcess(targetEscavadorProc, targetEscavadorClient)
    : false;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 border-b border-slate-200 pb-4 dark:border-slate-700">
        <div>
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Webhook Escavador · Tradução Jurídica Ivi PT-BR · Integração Automática com Cobrança
          </p>
          <h1 className="mt-1 font-display text-2xl font-bold text-slate-900 dark:text-slate-100">
            Setor Jurídico &amp; Escavador
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setSectorAuditOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap min-h-[38px] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <History className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
            Auditoria
          </button>
          {analyzedProcess && (
            <button
              type="button"
              onClick={handleCloseAnalyzedProcess}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 whitespace-nowrap min-h-[38px] dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
            >
              <X className="w-3.5 h-3.5" />
              Fechar Processo Analisado
            </button>
          )}
          {targetEscavadorProc && (
            <button
              type="button"
              disabled={!targetEscavadorActive}
              title={
                targetEscavadorActive
                  ? 'Registrar despacho manual ou retorno do webhook Escavador'
                  : 'Ivi retirou este CPF/CNPJ do Escavador porque o cliente está suspenso ou cancelado'
              }
              onClick={() => setDispatchModalOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-45 disabled:cursor-not-allowed whitespace-nowrap min-h-[38px] dark:bg-emerald-600 dark:hover:bg-emerald-500"
            >
              <Plus className="w-3.5 h-3.5 text-emerald-400" />
              Registrar Despacho Escavador
            </button>
          )}
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
          { value: 'alerta_movimentacao', label: 'Movimentação Nova' },
          { value: 'em_acompanhamento', label: 'Em Acompanhamento' },
          { value: 'apreendido', label: 'Veículo Apreendido' },
          { value: 'suspenso', label: 'Suspenso (Cobrança)' },
          { value: 'cancelado', label: 'Cancelado (Contrato)' },
        ]}
        selectedStatus={statusFilter}
        onStatusChange={setStatusFilter}
      />

      {feedbackMsg && (
        <div
          role="status"
          className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-medium text-emerald-900 flex items-center justify-between gap-2 dark:border-emerald-800/70 dark:bg-emerald-950/50 dark:text-emerald-300"
        >
          <span>{feedbackMsg}</span>
          <button
            type="button"
            onClick={() => setFeedbackMsg('')}
            aria-label="Dispensar aviso"
            className="text-emerald-700 hover:text-emerald-900 dark:text-emerald-300 dark:hover:text-emerald-200"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      {errorMsg && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-xs font-medium text-red-900 flex items-center justify-between gap-2 dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300"
        >
          <span>{errorMsg}</span>
          <button
            type="button"
            onClick={() => setErrorMsg('')}
            aria-label="Dispensar erro"
            className="text-red-700 hover:text-red-900 dark:text-red-300 dark:hover:text-red-200"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* SLA, Escavador & Risk KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3.5">
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
          <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Processos no Grid</div>
          <div className="mt-1 font-mono text-2xl font-bold text-slate-900 tabular-nums dark:text-slate-100">
            {slaStats.total}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
          <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Varredura Escavador (Ivi)</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="font-mono text-2xl font-bold text-emerald-700 tabular-nums dark:text-emerald-300">
              {slaStats.escavadorActiveCount}
            </span>
            <span className="text-[11px] font-medium text-slate-500 tabular-nums dark:text-slate-400">
              {slaStats.escavadorPausedCount > 0
                ? `(${slaStats.escavadorPausedCount} retirado${slaStats.escavadorPausedCount > 1 ? 's' : ''})`
                : 'ativos'}
            </span>
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
          <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Com Busca e Apreensão</div>
          <div className="mt-1 font-mono text-2xl font-bold text-amber-700 tabular-nums dark:text-amber-300">
            {slaStats.searchSeizure}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
          <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Veículos Apreendidos</div>
          <div className="mt-1 font-mono text-2xl font-bold text-red-600 tabular-nums dark:text-red-400">
            {slaStats.seized}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
          <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">SLA Leitura / Retorno</div>
          <div className="mt-1 font-mono text-2xl font-bold text-blue-700 tabular-nums dark:text-blue-300">
            {slaStats.avgOpenToReadMin}m / {slaStats.avgReadToContactMin}m
          </div>
        </div>
      </div>

      {/* DATA GRID OF LEGAL PROCESSES (Double-click row to open) */}
      <section
        aria-label="Grid de Processos Jurídicos e Escavador"
        className="rounded-xl border border-slate-200 bg-white overflow-hidden dark:border-slate-700 dark:bg-slate-900"
      >
        <div className="px-4 py-3 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs dark:border-slate-700">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-bold text-slate-900 dark:text-slate-100">
              Data Grid · Processos Jurídicos ({filteredProcesses.length})
            </span>
            <span className="text-slate-300">·</span>
            <span className="text-slate-500 dark:text-slate-400">
              Dê dois cliques na linha do processo para abrir a análise
            </span>
          </div>

          <div className="flex items-center gap-2">
            {analyzedProcess && (
              <button
                type="button"
                onClick={handleCloseAnalyzedProcess}
                className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-red-700 hover:bg-red-50 whitespace-nowrap dark:border-red-800/70 dark:bg-slate-900 dark:text-red-300 dark:hover:bg-red-950/60"
              >
                <X className="w-3 h-3" />
                Fechar Analisado
              </button>
            )}
            <button
              type="button"
              onClick={() => setGridCollapsed((prev) => !prev)}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              {gridCollapsed ? 'Expandir Grid' : 'Recolher Grid'}
            </button>
          </div>
        </div>

        {!gridCollapsed && (
          <div className="overflow-x-auto">
            {loadingList ? (
              <div className="p-6 text-center text-xs text-slate-500 dark:text-slate-400">
                Carregando processos jurídicos...
              </div>
            ) : filteredProcesses.length === 0 ? (
              <div className="p-8 text-center space-y-2 text-xs text-slate-500 dark:text-slate-400">
                <p>Nenhum processo encontrado para o filtro selecionado.</p>
                {statusFilter !== 'all' && (
                  <button
                    type="button"
                    onClick={() => {
                      setStatusFilter('all');
                      setSearchQuery('');
                    }}
                    className="font-semibold text-blue-700 hover:underline dark:text-blue-300"
                  >
                    Limpar filtros
                  </button>
                )}
              </div>
            ) : (
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold text-slate-600 dark:bg-slate-800/70 dark:border-slate-700 dark:text-slate-300">
                    <th className="py-2.5 px-4">Processo / Ação</th>
                    <th className="py-2.5 px-4">Cliente</th>
                    <th className="py-2.5 px-4">Cobrança / Títulos</th>
                    <th className="py-2.5 px-4">Situação Jurídica &amp; Escavador (Ivi)</th>
                    <th className="py-2.5 px-4">Última Movimentação</th>
                    <th className="py-2.5 px-4 text-right">Ação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {filteredProcesses.map((proc) => {
                    const client = clients.find((c) => c.id === proc.clientId);
                    const lawyer = lawyers.find((l) => l.id === proc.assignedLawyerId);
                    const billing = billingByClientId.get(proc.clientId);
                    const procMovCount = movements.filter((m) => m.processId === proc.id).length;
                    const isOpened = analyzedProcess?.id === proc.id;
                    const isHighlighted = timelineProcess?.id === proc.id;
                    const escActive = isEscavadorActiveForProcess(proc, client);
                    const stMeta = PROCESS_STATUS_META[proc.status] || {
                      label: proc.status.replace(/_/g, ' '),
                      toneClass: 'text-slate-700 dark:text-slate-200',
                    };
                    const clientSt = (client?.status || 'ativo').toLowerCase();

                    return (
                      <tr
                        key={proc.id}
                        tabIndex={0}
                        onClick={() => {
                          setHighlightedProcessId(proc.id);
                          setActiveTimelinePointId(null);
                        }}
                        onDoubleClick={() => openProcessForAnalysis(proc)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            openProcessForAnalysis(proc);
                          }
                        }}
                        title="Clique para visualizar a linha do tempo · Dois cliques para abrir o processo em análise"
                        className={`cursor-pointer select-none transition-colors focus-visible:outline-none focus-visible:bg-blue-50 ${
                          isOpened
                            ? 'bg-blue-50/80 dark:bg-blue-950/50'
                            : isHighlighted
                            ? 'bg-slate-50 dark:bg-slate-800/70'
                            : 'hover:bg-slate-50/80'
                        }`}
                      >
                        <td className="py-3 px-4 align-middle">
                          <div className="flex items-center gap-2">
                            <span
                              className={`font-mono text-xs font-bold tabular-nums ${
                                proc.hasUnreadMovement && escActive ? 'text-red-700 dark:text-red-300' : 'text-slate-900 dark:text-slate-100'
                              }`}
                            >
                              {proc.processNumber}
                            </span>
                            {isOpened && (
                              <span className="text-[11px] font-semibold text-blue-700 dark:text-blue-300">
                                · Analisando
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-500 mt-0.5 dark:text-slate-400">
                            {ACTION_TYPE_LABELS[proc.actionType] || proc.actionType} · {proc.courtName}
                          </div>
                        </td>

                        <td className="py-3 px-4 align-middle">
                          <div
                            className={`font-semibold ${
                              proc.hasUnreadMovement && escActive ? 'text-red-800 dark:text-red-300' : 'text-slate-900 dark:text-slate-100'
                            }`}
                          >
                            {client?.fullName || `Cliente #${proc.clientId}`}
                          </div>
                          <div className="text-[11px] font-mono text-slate-500 tabular-nums dark:text-slate-400">
                            {client?.cpfCnpj || '—'} · {lawyer?.name || 'Equipe Jurídica'}
                          </div>
                        </td>

                        <td className="py-3 px-4 align-middle">
                          <div
                            className={`font-mono font-semibold tabular-nums ${
                              clientSt === 'cancelado'
                                ? 'text-red-700 dark:text-red-300'
                                : clientSt === 'suspenso'
                                ? 'text-amber-800 dark:text-amber-300'
                                : billing && billing.overdueCount > 0
                                ? 'text-red-700 dark:text-red-300'
                                : 'text-slate-800 dark:text-slate-100'
                            }`}
                          >
                            {clientSt === 'cancelado'
                              ? 'Contrato Cancelado'
                              : clientSt === 'suspenso'
                              ? 'Cliente Suspenso'
                              : billing && billing.openBalanceCents > 0
                              ? formatBRL(billing.openBalanceCents)
                              : 'Regular'}
                          </div>
                          <div className="text-[11px] text-slate-500 mt-0.5 tabular-nums dark:text-slate-400">
                            {billing
                              ? `${billing.openCount} aberto(s) · ${billing.overdueCount} vencido(s)`
                              : 'Sem títulos vinculados'}
                          </div>
                        </td>

                        <td className="py-3 px-4 align-middle">
                          <div className={`flex items-center gap-1.5 ${stMeta.toneClass}`}>
                            {proc.vehicleSeized && (
                              <AlertTriangle className="w-3.5 h-3.5 text-red-600 shrink-0 dark:text-red-400" />
                            )}
                            <span>{stMeta.label}</span>
                          </div>
                          <div
                            className={`text-[11px] mt-0.5 flex items-center gap-1 font-medium ${
                              escActive ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'
                            }`}
                          >
                            {escActive ? (
                              <>
                                <ShieldCheck className="w-3 h-3 shrink-0" />
                                <span>Escavador Ativo (Ivi · CPF/CNPJ)</span>
                              </>
                            ) : (
                              <>
                                <ShieldOff className="w-3 h-3 shrink-0" />
                                <span>Retirado do Escavador (Ivi · CPF/CNPJ)</span>
                              </>
                            )}
                          </div>
                          {proc.statusChangeReason && !escActive && (
                            <div
                              className="text-[11px] text-slate-500 mt-0.5 max-w-[260px] truncate dark:text-slate-400"
                              title={proc.statusChangeReason}
                            >
                              Causa: {proc.statusChangeReason}
                            </div>
                          )}
                        </td>

                        <td className="py-3 px-4 align-middle font-mono text-[11px] text-slate-600 tabular-nums dark:text-slate-300">
                          <div>{proc.lastMovementAt ? formatDateTimeBR(proc.lastMovementAt) : '—'}</div>
                          <div className="text-slate-400 dark:text-slate-400">
                            {procMovCount} registro(s)
                            {proc.hasUnreadMovement && escActive ? ' · Leitura pendente' : ''}
                          </div>
                        </td>

                        <td className="py-3 px-4 align-middle text-right">
                          <div className="inline-flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setAuditProcess(proc);
                              }}
                              title="Auditoria do Processo"
                              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                            >
                              <History className="w-3.5 h-3.5" />
                            </button>
                            {isOpened ? (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleCloseAnalyzedProcess();
                                }}
                                className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-red-700 hover:bg-red-50 whitespace-nowrap dark:border-red-800/70 dark:bg-slate-900 dark:text-red-300 dark:hover:bg-red-950/60"
                              >
                                <X className="w-3 h-3" />
                                Fechar Análise
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openProcessForAnalysis(proc);
                                }}
                                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-800 hover:bg-slate-50 whitespace-nowrap dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                              >
                                <FolderOpen className="w-3 h-3" />
                                Abrir Processo
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}
      </section>

      {/* PERSISTENT TIMELINE + OPENED PROCESS AT SELECTED TIMELINE POINT */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* ALWAYS VISIBLE: Linha do Tempo Interativa do Processo */}
        <section
          aria-label="Linha do tempo do processo"
          className={`${
            analyzedProcess ? 'lg:col-span-5' : 'lg:col-span-12'
          } rounded-xl border border-slate-200 bg-white overflow-hidden dark:border-slate-700 dark:bg-slate-900`}
        >
          <div className="px-4 py-3 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs dark:border-slate-700">
            <div className="flex items-center gap-2 min-w-0">
              <History className="w-4 h-4 text-slate-700 shrink-0 dark:text-slate-200" />
              <div className="min-w-0">
                <div className="font-bold text-slate-900 truncate dark:text-slate-100">
                  Linha do Tempo {timelineProcess ? `· ${timelineProcess.processNumber}` : ''}
                </div>
                <div className="text-[11px] text-slate-500 truncate dark:text-slate-400">
                  {timelineProcess
                    ? `${timelineClient?.fullName || 'Cliente'} · Clique em uma linha para abrir o processo naquele ponto`
                    : 'Selecione um processo no grid acima'}
                </div>
              </div>
            </div>
            <span className="font-mono text-[11px] text-slate-500 tabular-nums shrink-0 dark:text-slate-400">
              {timelinePoints.length} marco(s)
            </span>
          </div>

          {!timelineProcess || timelinePoints.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">
              Nenhum processo selecionado para exibir a linha do tempo.
            </div>
          ) : (
            <div className="p-4 max-h-[540px] overflow-y-auto">
              <ol className="space-y-2.5">
                {timelinePoints.map((pt, idx) => {
                  const isActivePt = activePoint?.id === pt.id;
                  const isLast = idx === timelinePoints.length - 1;
                  const nodeTone =
                    pt.tone === 'red'
                      ? 'border-red-300 bg-red-50 text-red-700 dark:border-red-700/70 dark:bg-red-950/60 dark:text-red-300'
                      : pt.tone === 'amber'
                      ? 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700/70 dark:bg-amber-950/60 dark:text-amber-200'
                      : pt.tone === 'emerald'
                      ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700/70 dark:bg-emerald-950/60 dark:text-emerald-300'
                      : 'border-blue-300 bg-blue-50 text-blue-700';

                  return (
                    <li key={pt.id} className="relative flex gap-3">
                      {/* Vertical Timeline Connector */}
                      <div className="flex flex-col items-center pt-2.5">
                        <span
                          aria-hidden="true"
                          className={`w-6 h-6 rounded-full border font-mono text-[10px] font-bold tabular-nums flex items-center justify-center shrink-0 ${
                            isActivePt && analyzedProcess
                              ? 'border-blue-700 bg-blue-700 text-white'
                              : nodeTone
                          }`}
                        >
                          {pt.stepIndex}
                        </span>
                        {!isLast && (
                          <span
                            aria-hidden="true"
                            className="w-px flex-1 bg-slate-200 mt-1.5 dark:bg-slate-700"
                          />
                        )}
                      </div>

                      {/* Clickable Timeline Line */}
                      <button
                        type="button"
                        onClick={() => handleTimelinePointClick(pt)}
                        className={`flex-1 text-left rounded-xl border p-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                          isActivePt && analyzedProcess
                            ? 'border-blue-600 bg-blue-50/70 dark:bg-blue-950/50'
                            : isActivePt
                            ? 'border-slate-300 bg-slate-50 dark:border-slate-600 dark:bg-slate-800/70'
                            : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800'
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                          <span className="font-mono font-bold text-slate-800 tabular-nums dark:text-slate-100">
                            Marco {pt.stepIndex}/{timelinePoints.length} ·{' '}
                            {formatDateTimeBR(pt.timestamp)}
                          </span>
                          <span
                            className={`font-semibold ${
                              pt.tone === 'red'
                                ? 'text-red-700 dark:text-red-300'
                                : pt.tone === 'amber'
                                ? 'text-amber-800 dark:text-amber-300'
                                : pt.tone === 'emerald'
                                ? 'text-emerald-700 dark:text-emerald-300'
                                : 'text-blue-700 dark:text-blue-300'
                            }`}
                          >
                            {pt.statusAtPoint}
                          </span>
                        </div>
                        <div className="mt-1 text-xs font-bold text-slate-900 dark:text-slate-100">
                          {pt.title}
                        </div>
                        <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                          {pt.subtitle}
                        </div>
                        <p className="mt-1.5 text-xs text-slate-700 line-clamp-2 leading-snug dark:text-slate-200">
                          {pt.summary}
                        </p>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </div>
          )}
        </section>

        {/* OPENED PROCESS DETAIL: Shown when double-clicked from grid or clicked on a timeline line */}
        {analyzedProcess && activePoint && (
          <section
            aria-label={`Processo analisado ${analyzedProcess.processNumber}`}
            className="lg:col-span-7 rounded-xl border border-slate-200 bg-white p-5 space-y-4 dark:border-slate-700 dark:bg-slate-900"
          >
            {/* Header + Fechar Processo Analisado */}
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 border-b border-slate-100 pb-3.5 dark:border-slate-800">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Scale className="w-4 h-4 text-slate-700 shrink-0 dark:text-slate-200" />
                  <h2 className="font-mono text-base font-bold text-slate-900 tabular-nums dark:text-slate-100">
                    {analyzedProcess.processNumber}
                  </h2>
                  <span className="text-slate-300">·</span>
                  <span className="text-xs font-semibold text-blue-700 dark:text-blue-300">
                    Marco {activePoint.stepIndex} de {timelinePoints.length}
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-0.5 dark:text-slate-400">
                  {timelineClient?.fullName || 'Cliente'} · {analyzedProcess.courtName} ·{' '}
                  {timelineLawyerName}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <FormTemplateButton
                  menuId="jur_processos"
                  label="Modelos A4"
                  getContext={(): FormMergeContext => ({
                    client: timelineClient,
                    titular: timelineClient,
                    legalProcess: {
                      ...analyzedProcess,
                      responsibleLawyerName: timelineLawyerName,
                    },
                    company: units.find((u) => u.id === analyzedProcess.unitId) || units[0] || null,
                    collaborator: { name: timelineLawyerName, role: 'Advogado Responsável' },
                  })}
                  onError={(msg) => setErrorMsg(msg)}
                />
                {onNavigate && timelineClient && (
                  <button
                    type="button"
                    onClick={() =>
                      onNavigate('admission', { clientId: timelineClient.id, tab: 'clientes' })
                    }
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap min-h-[36px] dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    Abrir Dossiê
                    <ArrowUpRight className="w-3.5 h-3.5" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setAuditProcess(analyzedProcess)}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap min-h-[36px] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                  title="Auditoria completa das alterações do processo"
                >
                  <History className="w-3.5 h-3.5" />
                  Auditoria
                </button>
                <button
                  type="button"
                  onClick={handleCloseAnalyzedProcess}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 whitespace-nowrap min-h-[36px] dark:border-red-800/70 dark:bg-slate-900 dark:text-red-300 dark:hover:bg-red-950/60"
                >
                  <X className="w-3.5 h-3.5" />
                  Fechar Processo Analisado
                </button>
              </div>
            </div>

            {/* Integração Cobrança & Monitoramento Escavador (Ivi) */}
            <div
              className={`rounded-xl border p-3.5 text-xs grid grid-cols-1 md:grid-cols-2 gap-3 ${
                analyzedEscavadorActive
                  ? 'border-slate-200 bg-slate-50/60 dark:border-slate-700 dark:bg-slate-800/60'
                  : 'border-amber-200 bg-amber-50/70 dark:border-amber-800/70 dark:bg-amber-950/50'
              }`}
            >
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 font-bold text-slate-900 dark:text-slate-100">
                  {analyzedEscavadorActive ? (
                    <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 dark:text-emerald-400" />
                  ) : (
                    <ShieldOff className="w-4 h-4 text-red-600 shrink-0 dark:text-red-400" />
                  )}
                  <span>
                    {analyzedEscavadorActive
                      ? 'Escavador Ativo (Ivi · CPF/CNPJ monitorado)'
                      : 'Dados Retirados do Escavador pela Ivi (CPF/CNPJ)'}
                  </span>
                </div>
                <p className="text-[11px] text-slate-600 leading-relaxed dark:text-slate-300">
                  {analyzedProcess.escavadorLastActionNote ||
                    (analyzedEscavadorActive
                      ? `CPF/CNPJ ${
                          analyzedClient?.cpfCnpj || 'do cliente'
                        } ativo na pesquisa contínua do Escavador.`
                      : `CPF/CNPJ ${
                          analyzedClient?.cpfCnpj || 'do cliente'
                        } retirado automaticamente da varredura Escavador até retorno ao status normal.`)}
                </p>
                {analyzedProcess.statusChangeReason && (
                  <p className="text-[11px] font-semibold text-slate-800 dark:text-slate-100">
                    Causa registrada no histórico: {analyzedProcess.statusChangeReason}
                  </p>
                )}
              </div>

              <div className="flex flex-col justify-between gap-2 md:border-l md:border-slate-200/80 md:pl-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-1.5 font-bold text-slate-900 dark:text-slate-100">
                      <Wallet className="w-3.5 h-3.5 text-slate-700 dark:text-slate-200" />
                      <span>Integração Lançamentos de Cobrança</span>
                    </div>
                    <div className="text-[11px] text-slate-600 mt-0.5 tabular-nums dark:text-slate-300">
                      Status cliente:{' '}
                      <strong
                        className={
                          analyzedClient?.status === 'cancelado'
                            ? 'text-red-700 dark:text-red-300'
                            : analyzedClient?.status === 'suspenso'
                            ? 'text-amber-800 dark:text-amber-300'
                            : 'text-emerald-700 dark:text-emerald-300'
                        }
                      >
                        {(analyzedClient?.status || 'ativo').toUpperCase()}
                      </strong>{' '}
                      · Aberto: {formatBRL(analyzedBilling?.openBalanceCents || 0)} (
                      {analyzedBilling?.overdueCount || 0} vencido(s))
                    </div>
                  </div>
                  {onNavigate && analyzedClient && (
                    <button
                      type="button"
                      onClick={() => onNavigate('collection', { clientId: analyzedClient.id })}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-800 hover:bg-slate-50 whitespace-nowrap shrink-0 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                    >
                      Cobrança
                      <ArrowUpRight className="w-3 h-3" />
                    </button>
                  )}
                </div>
                {!analyzedEscavadorActive && (
                  <div className="text-[11px] text-slate-600 flex items-center gap-1.5 dark:text-slate-300">
                    <RefreshCw className="w-3 h-3 text-amber-700 shrink-0 dark:text-amber-300" />
                    <span>
                      Ao retornar o cliente para status normal em Cobrança, a Ivi reativa o CPF/CNPJ automaticamente.
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Process Snapshot at the Selected Timeline Point */}
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-3 text-xs dark:border-slate-700 dark:bg-slate-800/60">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                    Estado do Processo no Ponto Selecionado da Linha do Tempo
                  </div>
                  <div className="mt-0.5 text-sm font-bold text-slate-900 dark:text-slate-100">
                    {activePoint.title}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    disabled={!prevTimelinePoint}
                    onClick={() => prevTimelinePoint && setActiveTimelinePointId(prevTimelinePoint.id)}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                    Anterior
                  </button>
                  <button
                    type="button"
                    disabled={!nextTimelinePoint}
                    onClick={() => nextTimelinePoint && setActiveTimelinePointId(nextTimelinePoint.id)}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    Próximo
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1 border-t border-slate-200/80">
                <div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">Data/Hora do Ponto</div>
                  <div className="font-mono font-semibold text-slate-900 tabular-nums dark:text-slate-100">
                    {formatDateTimeBR(activePoint.timestamp)}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">Situação neste Ponto</div>
                  <div
                    className={`font-semibold ${
                      activePoint.tone === 'red'
                        ? 'text-red-700 dark:text-red-300'
                        : activePoint.tone === 'amber'
                        ? 'text-amber-800 dark:text-amber-300'
                        : activePoint.tone === 'emerald'
                        ? 'text-emerald-700 dark:text-emerald-300'
                        : 'text-blue-700 dark:text-blue-300'
                    }`}
                  >
                    {activePoint.statusAtPoint}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">Ação / Vara</div>
                  <div className="font-medium text-slate-800 truncate dark:text-slate-100">
                    {ACTION_TYPE_LABELS[analyzedProcess.actionType] || analyzedProcess.actionType}
                  </div>
                </div>
              </div>

              {/* Dispatch & Ivi Translation Snapshot at This Timeline Point */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
                  <div className="font-semibold text-slate-700 mb-1 flex items-center gap-1.5 dark:text-slate-200">
                    <Eye className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
                    Registro / Despacho neste Ponto
                  </div>
                  <p className="text-slate-600 leading-relaxed dark:text-slate-300">
                    {activePoint.originalDispatchSnapshot}
                  </p>
                </div>
                <div className="rounded-lg border border-blue-200 bg-blue-50/70 p-3 dark:border-blue-800/70 dark:bg-blue-950/50">
                  <div className="font-semibold text-blue-900 mb-1 flex items-center gap-1.5 dark:text-blue-300">
                    <Sparkles className="w-3.5 h-3.5 text-blue-700 dark:text-blue-300" />
                    Tradução Ivi neste Ponto (PT-BR)
                  </div>
                  <p className="text-slate-800 leading-relaxed dark:text-slate-100">
                    {activePoint.iviTranslationSnapshot}
                  </p>
                </div>
              </div>

              {activePoint.contactSnapshot && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-3 text-emerald-950 flex items-start gap-2 dark:border-emerald-800/70 dark:bg-emerald-950/50 dark:text-emerald-300">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5 dark:text-emerald-400" />
                  <div>
                    <strong>
                      Retorno ao cliente via {(activePoint.contactSnapshot.channel || 'whatsapp').toUpperCase()} em{' '}
                      {formatDateTimeBR(activePoint.contactSnapshot.at)}:
                    </strong>{' '}
                    {activePoint.contactSnapshot.summary}
                    {activePoint.contactSnapshot.emailSent ? ' · E-mail oficial enviado.' : ''}
                  </div>
                </div>
              )}
            </div>

            {/* Interactive SLA Action Bar for Movement-Linked Points */}
            {activeMovementForPoint ? (
              activeMovementForPoint.source === 'integracao_cobranca' ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 flex flex-wrap items-center justify-between gap-2 text-xs dark:border-slate-700 dark:bg-slate-800/70">
                  <div className="flex items-start gap-2 text-slate-700 dark:text-slate-200">
                    {activeMovementForPoint.originalDispatch.toUpperCase().includes('RETORNO') ? (
                      <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5 dark:text-emerald-400" />
                    ) : (
                      <Ban className="w-4 h-4 text-amber-700 shrink-0 mt-0.5 dark:text-amber-300" />
                    )}
                    <div>
                      <div className="font-semibold text-slate-900 dark:text-slate-100">
                        Evento Automático Cobrança ↔ Jurídico &amp; Escavador (Ivi)
                      </div>
                      <div className="text-[11px] text-slate-600 mt-0.5 dark:text-slate-300">
                        {activeMovementForPoint.contactSummary ||
                          'Sincronização de ciclo de vida registrada no histórico processual.'}
                      </div>
                    </div>
                  </div>
                  {onNavigate && analyzedClient && (
                    <button
                      type="button"
                      onClick={() => onNavigate('collection', { clientId: analyzedClient.id })}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-800 hover:bg-slate-100 whitespace-nowrap dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                    >
                      Abrir em Cobrança
                      <ArrowUpRight className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ) : (
                <div className="rounded-xl border border-slate-200 p-4 space-y-3 text-xs dark:border-slate-700">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                    <span className="font-semibold text-slate-800 dark:text-slate-100">
                      Tratativa da Movimentação #{activeMovementForPoint.id} (
                      {SOURCE_LABELS[activeMovementForPoint.source] || activeMovementForPoint.source})
                    </span>
                    <div className="flex items-center gap-2 font-semibold">
                      <span className={activeMovementForPoint.openedAt ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-400 dark:text-slate-400'}>
                        1. Aberto
                      </span>
                      <span>→</span>
                      <span
                        className={
                          activeMovementForPoint.readCompletedAt ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'
                        }
                      >
                        2. Lido
                      </span>
                      <span>→</span>
                      <span
                        className={
                          activeMovementForPoint.clientContactedAt ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-400 dark:text-slate-400'
                        }
                      >
                        3. Retornado
                      </span>
                    </div>
                  </div>

                  {!activeMovementForPoint.readCompletedAt ? (
                    <div className="flex justify-end">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleReadComplete(activeMovementForPoint.id)}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-50 min-h-[38px]"
                      >
                        <Clock className="w-3.5 h-3.5" />
                        Passo 2: Confirmar Leitura do Despacho
                      </button>
                    </div>
                  ) : activeMovementForPoint.clientContactedAt ? (
                    <div className="rounded-lg bg-emerald-50/70 border border-emerald-200 p-2.5 text-emerald-950 flex items-start gap-2 dark:bg-emerald-950/50 dark:border-emerald-800/70 dark:text-emerald-300">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5 dark:text-emerald-400" />
                      <div>
                        <strong>
                          Retorno registrado ({activeMovementForPoint.contactChannel}) em{' '}
                          {formatDateTimeBR(activeMovementForPoint.clientContactedAt)}:
                        </strong>{' '}
                        {activeMovementForPoint.contactSummary}{' '}
                        {activeMovementForPoint.emailSent ? '· E-mail oficial enviado.' : ''}
                      </div>
                    </div>
                  ) : (
                    <div className="pt-2 border-t border-slate-100 space-y-2 dark:border-slate-800">
                      <div className="font-semibold text-slate-800 dark:text-slate-100">
                        Passo 3: Registrar Retorno ao Cliente &amp; Finalizar SLA
                      </div>
                      <div className="flex flex-col sm:flex-row gap-2">
                        <select
                          value={contactChannel}
                          onChange={(e) => setContactChannel(e.target.value)}
                          className="rounded-lg border border-slate-200 px-2.5 py-2 text-xs min-h-[38px] dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                        >
                          <option value="whatsapp">WhatsApp</option>
                          <option value="telefone">Telefone</option>
                          <option value="email">E-mail</option>
                        </select>
                        <input
                          type="text"
                          value={contactSummary}
                          onChange={(e) => setContactSummary(e.target.value)}
                          placeholder="Resumo das orientações passadas ao cliente..."
                          className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-xs min-h-[38px] dark:border-slate-700"
                        />
                        <label className="flex items-center gap-1.5 text-xs text-slate-700 whitespace-nowrap dark:text-slate-200">
                          <input
                            type="checkbox"
                            checked={emailSent}
                            onChange={(e) => setEmailSent(e.target.checked)}
                          />
                          Enviar e-mail
                        </label>
                        <button
                          type="button"
                          disabled={busy || !contactSummary.trim()}
                          onClick={() => handleRegisterContact(activeMovementForPoint.id)}
                          className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 min-h-[38px] whitespace-nowrap"
                        >
                          <Send className="w-3.5 h-3.5" />
                          Salvar SLA
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            ) : (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-300">
                <span>
                  {analyzedEscavadorActive
                    ? 'Marco inicial do processo. Selecione outra linha na Linha do Tempo ou registre um novo despacho Escavador.'
                    : 'Varredura Escavador pausada pela Ivi enquanto o cliente estiver suspenso ou cancelado.'}
                </span>
                {analyzedEscavadorActive && (
                  <button
                    type="button"
                    onClick={() => setDispatchModalOpen(true)}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-800 hover:bg-slate-100 whitespace-nowrap dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Registrar Despacho Escavador
                  </button>
                )}
              </div>
            )}
          </section>
        )}
      </div>

      {/* Modal: Registrar Novo Despacho Escavador */}
      {dispatchModalOpen && (analyzedProcess || timelineProcess) && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Registrar Novo Despacho Escavador"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 dark:bg-slate-950/80"
        >
          <form
            onSubmit={handleSimulateEscavador}
            className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl space-y-3.5 text-xs dark:border-slate-700 dark:bg-slate-900"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
              <div>
                <h3 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                  Novo Despacho Escavador · Tradução Ivi
                </h3>
                <p className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                  Processo {(analyzedProcess || timelineProcess)!.processNumber}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDispatchModalOpen(false)}
                aria-label="Fechar modal de despacho"
                className="text-slate-400 hover:text-slate-700 p-1 dark:text-slate-400 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <textarea
              rows={4}
              required
              value={newDispatchText}
              onChange={(e) => setNewDispatchText(e.target.value)}
              placeholder="Cole o despacho judicial em juridiquês para a Ivi traduzir automaticamente para PT-BR..."
              className="w-full rounded-lg border border-slate-200 p-3 text-xs dark:border-slate-700"
            />
            <label className="flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer dark:text-slate-200">
              <input
                type="checkbox"
                checked={isSeizedFlag}
                onChange={(e) => setIsSeizedFlag(e.target.checked)}
              />
              Sinalizar auto de busca e apreensão cumprido (alerta vermelho)
            </label>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setDispatchModalOpen(false)}
                className="rounded-lg border border-slate-200 px-4 py-2 font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={busy || !newDispatchText.trim()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-emerald-600 dark:hover:bg-emerald-500"
              >
                <Sparkles className="w-3.5 h-3.5" />
                Processar &amp; Traduzir c/ Ivi
              </button>
            </div>
          </form>
        </div>
      )}
      <EntityAuditModal
        open={Boolean(auditProcess)}
        title={auditProcess ? `Processo · ${auditProcess.processNumber}` : 'Processo'}
        entityType="legal_processes"
        entityId={auditProcess?.id || 0}
        onClose={() => setAuditProcess(null)}
      />
      <EntityAuditModal
        open={sectorAuditOpen}
        title="Jurídico & Escavador · Auditoria Cumulativa"
        entityType="legal_processes,legal_movements"
        entityId="all"
        onClose={() => setSectorAuditOpen(false)}
      />
    </div>
  );
};
