import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  FileStack,
  History,
  MessageSquareText,
  PhoneCall,
  Plus,
  Scale,
  TrendingDown,
} from 'lucide-react';
import { apiFetch, formatBRL, formatBytes } from '../../lib/api.ts';
import { ModuleId, NavigationIntent, Unit } from '../../types.ts';
import { EntityAuditModal } from './cadastros/CadastrosShared.tsx';

interface OverviewData {
  units: Unit[];
  clientsCount: number;
  admissions: Array<{
    id: number;
    clientId: number;
    protocolCode: string;
    status: string;
    debtAmountCents: number;
    bankName: string;
  }>;
  leads: Array<{ id: number; name?: string; stage: string; channel: string }>;
  appointments: Array<{ id: number; status: string; modality: string }>;
  processes: Array<{
    id: number;
    processNumber?: string;
    clientId?: number;
    hasUnreadMovement: boolean;
    hasSearchSeizure: boolean;
    vehicleSeized: boolean;
  }>;
  negotiations: Array<{ id: number; currentReductionPct: number; targetReductionPct: number; status: string }>;
  titles: Array<{
    id: number;
    titleCode?: string;
    scope?: string;
    status: string;
    dueDate?: string;
    amountCents: number;
    originalValueCents?: number;
    currentBalanceCents?: number;
  }>;
  collectionCases: Array<{ id: number; status: string; priorityValueCents: number }>;
  documentsCount: number;
  totalVaultBytes: number;
  collaborators: Array<{ id: number; name: string; role: string; points: number }>;
  internalMessages: Array<{
    id: number;
    senderName: string;
    targetSector: string;
    subject: string;
    body: string;
    createdAt: string;
  }>;
}

interface OverviewModuleProps {
  onNavigate: (mod: ModuleId, intent?: NavigationIntent) => void;
  activeUnitId: number;
}

interface ActionTask {
  id: string;
  priority: 'alta' | 'media' | 'normal';
  sector: string;
  title: string;
  subtitle: string;
  cta: string;
  targetMod: ModuleId;
  intent?: NavigationIntent;
}

export const OverviewModule: React.FC<OverviewModuleProps> = ({ onNavigate, activeUnitId }) => {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [auditOpen, setAuditOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await apiFetch<OverviewData>('/api/overview');
      setData(res);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [activeUnitId]);

  const priorityTasks = useMemo<ActionTask[]>(() => {
    if (!data) return [];
    const list: ActionTask[] = [];

    data.processes
      .filter((p) => p.hasUnreadMovement)
      .slice(0, 3)
      .forEach((p) => {
        list.push({
          id: `proc-${p.id}`,
          priority: 'alta',
          sector: 'Jurídico · Escavador',
          title: `Nova movimentação ${p.processNumber ? `· ${p.processNumber}` : ''}`,
          subtitle: p.vehicleSeized
            ? 'Veículo apreendido sinalizado — confirmar leitura e acionar cliente.'
            : 'Despacho aguardando leitura e retorno ao cliente (SLA ativo).',
          cta: 'Abrir processo',
          targetMod: 'legal',
          intent: { processId: p.id, clientId: p.clientId },
        });
      });

    data.admissions
      .filter((a) => a.status === 'aguardando_auditoria' || a.status === 'devolvida_admissao')
      .slice(0, 3)
      .forEach((a) => {
        const isReturned = a.status === 'devolvida_admissao';
        list.push({
          id: `adm-${a.id}`,
          priority: isReturned ? 'alta' : 'media',
          sector: isReturned ? 'Admissão · Correção' : 'Auditoria · Fila',
          title: `${a.protocolCode} · ${a.bankName}`,
          subtitle: `${formatBRL(a.debtAmountCents)} · ${
            isReturned ? 'Devolvida pela auditoria para ajuste documental.' : 'Pronta para conferência e emissão dos 2 boletos iniciais.'
          }`,
          cta: isReturned ? 'Corrigir dossiê' : 'Auditar agora',
          targetMod: isReturned ? 'admission' : 'audit',
          intent: { admissionId: a.id, clientId: a.clientId },
        });
      });

    data.leads
      .filter((l) => l.stage === 'escalado_humano')
      .slice(0, 2)
      .forEach((l) => {
        list.push({
          id: `lead-${l.id}`,
          priority: 'media',
          sector: 'Prospecção · Ivi',
          title: `Lead escalado${l.name ? ` · ${l.name}` : ''}`,
          subtitle: `Canal ${l.channel} aguardando atendimento humano ou agendamento.`,
          cta: 'Assumir lead',
          targetMod: 'prospection',
          intent: { leadId: l.id, tab: 'atendimento' },
        });
      });

    const todayIso = new Date().toISOString().slice(0, 10);
    const receberTitles = data.titles.filter((t) => (t.scope || 'RECEBER') === 'RECEBER');
    const overdueTitles = receberTitles.filter((t) => {
      const st = String(t.status || '').toUpperCase();
      if (st === 'VENCIDO') return true;
      if (st === 'ABERTO' || st === 'PARCIAL') {
        return Boolean(t.dueDate && String(t.dueDate).slice(0, 10) < todayIso);
      }
      return false;
    });
    if (overdueTitles.length > 0) {
      const overdueSum = overdueTitles.reduce((a, b) => a + ((b.currentBalanceCents ?? 0) > 0 ? (b.currentBalanceCents ?? 0) : b.amountCents), 0);
      list.push({
        id: 'finance-overdue',
        priority: 'media',
        sector: 'Financeiro & Cobrança',
        title: `${overdueTitles.length} título(s) vencido(s) · ${formatBRL(overdueSum)}`,
        subtitle: 'Confirme lotes da régua Ivi (-15/-5/+7d) ou trate a fila de cobrança.',
        cta: 'Abrir Régua Ivi',
        targetMod: 'finance_regua',
      });
    }

    return list;
  }, [data]);

  if (loading || !data) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-20 rounded-xl bg-slate-200/70" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 rounded-xl bg-slate-200/70" />
          ))}
        </div>
        <div className="h-64 rounded-xl bg-slate-200/70" />
      </div>
    );
  }

  const pendingAudits = data.admissions.filter(
    (a) => a.status === 'aguardando_auditoria' || a.status === 'devolvida_admissao'
  ).length;
  const unreadLegal = data.processes.filter((p) => p.hasUnreadMovement).length;
  const activeCollection = data.collectionCases.filter((c) => c.status === 'em_cobranca').length;
  const activeUnit = data.units.find((u) => u.id === activeUnitId);

  return (
    <div className="space-y-6">
      {/* Executive Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-slate-200 pb-4 dark:border-slate-700">
        <div>
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Central do Dia · {activeUnit ? `${activeUnit.name} (${activeUnit.state})` : 'Rede Completa (7 Unidades)'}
          </p>
          <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            O Que Fazer Agora
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onNavigate('admission', { tab: 'nova_admissao', triggerNew: true })}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-700 whitespace-nowrap min-h-[38px]"
          >
            <Plus className="w-3.5 h-3.5" />
            Nova Ficha de Admissão
          </button>
          <button
            type="button"
            onClick={() => onNavigate('prospection')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 whitespace-nowrap min-h-[38px] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
          >
            <PhoneCall className="w-3.5 h-3.5 text-blue-700 dark:text-blue-300" />
            Atender Próximo Lead
          </button>
          <button
            type="button"
            onClick={() => setAuditOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 whitespace-nowrap min-h-[38px] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
          >
            <History className="w-3.5 h-3.5 text-slate-600 dark:text-slate-300" />
            Auditoria
          </button>
        </div>
      </div>

      {/* 4-Stage Client Lifecycle Funnel (Clickable Shortcuts) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          {
            step: '1. Prospecção',
            mod: 'prospection' as ModuleId,
            value: String(data.leads.length),
            sub: `${data.appointments.length} agendamentos`,
            accent: 'text-slate-900 dark:text-slate-100',
            icon: PhoneCall,
          },
          {
            step: '2. Admissão & Docs',
            mod: 'admission' as ModuleId,
            value: String(data.clientsCount),
            sub: `${data.documentsCount} arqs · ${formatBytes(data.totalVaultBytes)}`,
            accent: 'text-slate-900 dark:text-slate-100',
            icon: FileStack,
          },
          {
            step: '3. Auditoria',
            mod: 'audit' as ModuleId,
            value: String(pendingAudits),
            sub: pendingAudits > 0 ? 'Aguardando conferência' : 'Fila zerada',
            accent: pendingAudits > 0 ? 'text-amber-700 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-300',
            icon: ClipboardCheck,
          },
          {
            step: '4. Jurídico & Bancos',
            mod: unreadLegal > 0 ? ('legal' as ModuleId) : ('negotiations' as ModuleId),
            value: String(unreadLegal),
            sub: `${data.negotiations.length} negociações ativas`,
            accent: unreadLegal > 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-900 dark:text-slate-100',
            icon: Scale,
          },
        ].map((stage) => {
          const Icon = stage.icon;
          return (
            <button
              key={stage.step}
              type="button"
              onClick={() => onNavigate(stage.mod)}
              className="text-left rounded-xl border border-slate-200 bg-white p-4 hover:border-slate-300 hover:bg-slate-50/50 transition-colors dark:border-slate-700 dark:bg-slate-900"
            >
              <div className="flex items-center justify-between gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
                <span>{stage.step}</span>
                <Icon className="w-3.5 h-3.5 text-slate-400 shrink-0 dark:text-slate-400" />
              </div>
              <div className={`mt-2 font-mono text-xl font-bold tabular-nums ${stage.accent}`}>
                {stage.value}
              </div>
              <div className="mt-1 text-[11px] text-slate-500 truncate dark:text-slate-400">{stage.sub}</div>
            </button>
          );
        })}
      </div>

      {/* Main Action Inbox */}
      <div className="grid grid-cols-1 gap-5">
        {/* Prioritized Action Queue */}
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden dark:border-slate-700 dark:bg-slate-900">
          <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between dark:border-slate-800">
            <div>
              <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                Pendências Prioritárias
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Clique em qualquer item para ir direto à tela e ao registro correspondente
              </p>
            </div>
            <span className="font-mono text-xs font-bold text-slate-600 tabular-nums dark:text-slate-300">
              {priorityTasks.length} ação(ões)
            </span>
          </div>

          {priorityTasks.length === 0 ? (
            <div className="p-8 text-center space-y-2">
              <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto dark:text-emerald-400" />
              <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">Nenhuma pendência crítica agora</div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Auditoria, movimentações do Escavador e fila de leads estão em dia nesta unidade.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {priorityTasks.map((task) => (
                <div
                  key={task.id}
                  className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50/70 transition-colors dark:hover:bg-slate-800"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2 text-[11px] font-semibold">
                      {task.priority === 'alta' && (
                        <AlertTriangle className="w-3.5 h-3.5 text-red-600 shrink-0 dark:text-red-400" />
                      )}
                      <span
                        className={
                          task.priority === 'alta' ? 'text-red-600 dark:text-red-400' : 'text-blue-700 dark:text-blue-300'
                        }
                      >
                        {task.sector}
                      </span>
                    </div>
                    <div className="text-sm font-bold text-slate-900 truncate dark:text-slate-100">{task.title}</div>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{task.subtitle}</p>
                  </div>

                  <button
                    type="button"
                    onClick={() => onNavigate(task.targetMod, task.intent)}
                    className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800 whitespace-nowrap shrink-0 min-h-[38px] dark:bg-emerald-600 dark:hover:bg-emerald-500"
                  >
                    {task.cta}
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Quick Operational Links Footer */}
          <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs dark:bg-slate-800/70 dark:border-slate-800">
            <span className="text-slate-500 dark:text-slate-400">
              Acesso rápido: <strong className="text-slate-700 dark:text-slate-200">Ctrl+K</strong> busca qualquer cliente ou processo
            </span>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => onNavigate('negotiations')}
                className="font-semibold text-blue-700 hover:underline inline-flex items-center gap-1 dark:text-blue-300"
              >
                <TrendingDown className="w-3.5 h-3.5" />
                Negociações ({data.negotiations.length})
              </button>
              <button
                type="button"
                onClick={() => onNavigate('internal_messaging')}
                className="font-semibold text-emerald-700 hover:underline inline-flex items-center gap-1 dark:text-emerald-300"
              >
                <MessageSquareText className="w-3.5 h-3.5" />
                Mensageria Interna ({data.internalMessages.length})
              </button>
              <button
                type="button"
                onClick={() => onNavigate('collection')}
                className="font-semibold text-blue-700 hover:underline dark:text-blue-300"
              >
                Cobrança ({activeCollection})
              </button>
              <button
                type="button"
                onClick={() => onNavigate('config')}
                className="font-semibold text-slate-600 hover:underline dark:text-slate-300"
              >
                Configurações & SQL
              </button>
            </div>
          </div>
        </div>
      </div>

      <EntityAuditModal
        open={auditOpen}
        title="Visão Executiva · Auditoria Cumulativa do Sistema"
        entityType="all"
        entityId="all"
        onClose={() => setAuditOpen(false)}
      />
    </div>
  );
};
