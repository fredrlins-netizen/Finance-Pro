import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  CheckCircle2,
  ClipboardCheck,
  FileStack,
  PhoneCall,
  Plus,
  Scale,
  Send,
  TrendingDown,
} from 'lucide-react';
import { apiFetch, formatBRL, formatBytes, formatDateTimeBR } from '../../lib/api.ts';
import { ModuleId, NavigationIntent, Unit } from '../../types.ts';

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
  const [msgSector, setMsgSector] = useState('juridico');
  const [msgSubject, setMsgSubject] = useState('');
  const [msgBody, setMsgBody] = useState('');
  const [sending, setSending] = useState(false);

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

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!msgSubject.trim() || !msgBody.trim()) return;
    setSending(true);
    try {
      await apiFetch('/api/messages', {
        method: 'POST',
        body: JSON.stringify({ targetSector: msgSector, subject: msgSubject, body: msgBody }),
      });
      setMsgSubject('');
      setMsgBody('');
      await load();
    } finally {
      setSending(false);
    }
  };

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
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-24 rounded-xl bg-slate-200/70" />
          ))}
        </div>
        <div className="h-64 rounded-xl bg-slate-200/70" />
      </div>
    );
  }

  const todayIsoKpi = new Date().toISOString().slice(0, 10);
  const receberOnly = data.titles.filter((t) => (t.scope || 'RECEBER') === 'RECEBER');
  const paidTotal = receberOnly
    .filter((t) => String(t.status || '').toUpperCase() === 'PAGO')
    .reduce((a, b) => a + (b.originalValueCents || b.amountCents), 0);
  const overdueTotal = receberOnly
    .filter((t) => {
      const st = String(t.status || '').toUpperCase();
      if (st === 'VENCIDO') return true;
      if (st === 'ABERTO' || st === 'PARCIAL') {
        return Boolean(t.dueDate && String(t.dueDate).slice(0, 10) < todayIsoKpi);
      }
      return false;
    })
    .reduce((a, b) => a + ((b.currentBalanceCents ?? 0) > 0 ? (b.currentBalanceCents ?? 0) : b.amountCents), 0);
  const pendingAudits = data.admissions.filter(
    (a) => a.status === 'aguardando_auditoria' || a.status === 'devolvida_admissao'
  ).length;
  const unreadLegal = data.processes.filter((p) => p.hasUnreadMovement).length;
  const activeCollection = data.collectionCases.filter((c) => c.status === 'em_cobranca').length;
  const activeUnit = data.units.find((u) => u.id === activeUnitId);

  return (
    <div className="space-y-6">
      {/* Executive Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <p className="text-xs font-medium text-slate-500">
            Central do Dia · {activeUnit ? `${activeUnit.name} (${activeUnit.state})` : 'Rede Completa (7 Unidades)'}
          </p>
          <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-slate-900">
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
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 whitespace-nowrap min-h-[38px]"
          >
            <PhoneCall className="w-3.5 h-3.5 text-blue-700" />
            Atender Próximo Lead
          </button>
        </div>
      </div>

      {/* 5-Stage Client Lifecycle Funnel (Clickable Shortcuts) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {[
          {
            step: '1. Prospecção',
            mod: 'prospection' as ModuleId,
            value: String(data.leads.length),
            sub: `${data.appointments.length} agendamentos`,
            accent: 'text-slate-900',
            icon: PhoneCall,
          },
          {
            step: '2. Admissão & Docs',
            mod: 'admission' as ModuleId,
            value: String(data.clientsCount),
            sub: `${data.documentsCount} arqs · ${formatBytes(data.totalVaultBytes)}`,
            accent: 'text-slate-900',
            icon: FileStack,
          },
          {
            step: '3. Auditoria',
            mod: 'audit' as ModuleId,
            value: String(pendingAudits),
            sub: pendingAudits > 0 ? 'Aguardando conferência' : 'Fila zerada',
            accent: pendingAudits > 0 ? 'text-amber-700' : 'text-emerald-700',
            icon: ClipboardCheck,
          },
          {
            step: '4. Jurídico & Bancos',
            mod: unreadLegal > 0 ? ('legal' as ModuleId) : ('negotiations' as ModuleId),
            value: String(unreadLegal),
            sub: `${data.negotiations.length} negociações ativas`,
            accent: unreadLegal > 0 ? 'text-red-600' : 'text-slate-900',
            icon: Scale,
          },
          {
            step: '5. Financeiro',
            mod: 'finance' as ModuleId,
            value: formatBRL(paidTotal),
            sub: overdueTotal > 0 ? `Atraso: ${formatBRL(overdueTotal)}` : 'Carteira em dia',
            accent: 'text-emerald-700',
            icon: Banknote,
          },
        ].map((stage) => {
          const Icon = stage.icon;
          return (
            <button
              key={stage.step}
              type="button"
              onClick={() => onNavigate(stage.mod)}
              className="text-left rounded-xl border border-slate-200 bg-white p-4 hover:border-slate-300 hover:bg-slate-50/50 transition-colors"
            >
              <div className="flex items-center justify-between gap-2 text-xs font-semibold text-slate-500">
                <span>{stage.step}</span>
                <Icon className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              </div>
              <div className={`mt-2 font-mono text-xl font-bold tabular-nums ${stage.accent}`}>
                {stage.value}
              </div>
              <div className="mt-1 text-[11px] text-slate-500 truncate">{stage.sub}</div>
            </button>
          );
        })}
      </div>

      {/* Main Action Inbox + Team Messaging */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left: Prioritized Action Queue */}
        <div className="lg:col-span-7 rounded-xl border border-slate-200 bg-white overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between">
            <div>
              <h2 className="font-display text-base font-bold text-slate-900">
                Pendências Prioritárias
              </h2>
              <p className="text-[11px] text-slate-500">
                Clique em qualquer item para ir direto à tela e ao registro correspondente
              </p>
            </div>
            <span className="font-mono text-xs font-bold text-slate-600 tabular-nums">
              {priorityTasks.length} ação(ões)
            </span>
          </div>

          {priorityTasks.length === 0 ? (
            <div className="p-8 text-center space-y-2">
              <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto" />
              <div className="text-sm font-semibold text-slate-900">Nenhuma pendência crítica agora</div>
              <p className="text-xs text-slate-500">
                Auditoria, movimentações do Escavador e fila de leads estão em dia nesta unidade.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {priorityTasks.map((task) => (
                <div
                  key={task.id}
                  className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50/70 transition-colors"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2 text-[11px] font-semibold">
                      {task.priority === 'alta' && (
                        <AlertTriangle className="w-3.5 h-3.5 text-red-600 shrink-0" />
                      )}
                      <span
                        className={
                          task.priority === 'alta' ? 'text-red-600' : 'text-blue-700'
                        }
                      >
                        {task.sector}
                      </span>
                    </div>
                    <div className="text-sm font-bold text-slate-900 truncate">{task.title}</div>
                    <p className="text-xs text-slate-500">{task.subtitle}</p>
                  </div>

                  <button
                    type="button"
                    onClick={() => onNavigate(task.targetMod, task.intent)}
                    className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800 whitespace-nowrap shrink-0 min-h-[38px]"
                  >
                    {task.cta}
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Quick Operational Links Footer */}
          <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="text-slate-500">
              Acesso rápido: <strong className="text-slate-700">Ctrl+K</strong> busca qualquer cliente ou processo
            </span>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => onNavigate('negotiations')}
                className="font-semibold text-blue-700 hover:underline inline-flex items-center gap-1"
              >
                <TrendingDown className="w-3.5 h-3.5" />
                Negociações ({data.negotiations.length})
              </button>
              <button
                type="button"
                onClick={() => onNavigate('collection')}
                className="font-semibold text-blue-700 hover:underline"
              >
                Cobrança ({activeCollection})
              </button>
              <button
                type="button"
                onClick={() => onNavigate('config')}
                className="font-semibold text-slate-600 hover:underline"
              >
                Configurações & SQL
              </button>
            </div>
          </div>
        </div>

        {/* Right: Internal Team Messaging */}
        <div className="lg:col-span-5 rounded-xl border border-slate-200 bg-white p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h2 className="font-display text-base font-bold text-slate-900">
                Mensageria Entre Setores
              </h2>
              <span className="text-[11px] text-emerald-700 font-semibold">Tempo Real</span>
            </div>

            <div className="mt-3 space-y-2.5 max-h-64 overflow-y-auto pr-1">
              {data.internalMessages.map((m) => (
                <div key={m.id} className="rounded-lg border border-slate-100 bg-slate-50/70 p-3">
                  <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500">
                    <span className="font-semibold text-slate-800">
                      {m.senderName} · <span className="text-blue-700">{m.targetSector}</span>
                    </span>
                    <span className="font-mono">{formatDateTimeBR(m.createdAt)}</span>
                  </div>
                  <div className="mt-1 text-xs font-semibold text-slate-900">{m.subject}</div>
                  <p className="mt-0.5 text-xs text-slate-600">{m.body}</p>
                </div>
              ))}
            </div>
          </div>

          <form onSubmit={handleSendMessage} className="mt-4 pt-3 border-t border-slate-100 space-y-2">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <select
                value={msgSector}
                onChange={(e) => setMsgSector(e.target.value)}
                className="rounded-lg border border-slate-200 px-2.5 py-2 text-xs text-slate-800"
              >
                <option value="comercial">Comercial</option>
                <option value="admissao">Admissão</option>
                <option value="auditoria">Auditoria</option>
                <option value="juridico">Jurídico</option>
                <option value="negociacoes">Negociações</option>
                <option value="financeiro">Financeiro</option>
                <option value="cobranca">Cobrança</option>
              </select>
              <input
                type="text"
                value={msgSubject}
                onChange={(e) => setMsgSubject(e.target.value)}
                placeholder="Assunto rápido..."
                className="sm:col-span-2 rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-900"
              />
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={msgBody}
                onChange={(e) => setMsgBody(e.target.value)}
                placeholder="Enviar aviso para outro setor..."
                className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-900"
              />
              <button
                type="submit"
                disabled={sending}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800 whitespace-nowrap"
              >
                <Send className="w-3.5 h-3.5" />
                Enviar
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
