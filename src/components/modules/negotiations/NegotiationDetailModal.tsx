import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Building2,
  Calculator,
  CheckCircle2,
  ExternalLink,
  FileText,
  History,
  MessageCircle,
  Phone,
  Sparkles,
  Target,
  User,
  X,
} from 'lucide-react';
import { apiFetch, formatBRL } from '../../../lib/api.ts';
import type {
  BankContactItem,
  BankItem,
  BankServiceItem,
  CollaboratorItem,
  Negotiation,
  NegotiationGoal,
  NegotiationIviAdvisorPayload,
} from '../../../types.ts';
import { NEGOTIATION_STATUS_CONFIG, type WhatsappDualPayload } from './types.ts';
import { NegotiationOverviewContainer } from './containers/NegotiationOverviewContainer.tsx';
import { NegotiationContactsContainer } from './containers/NegotiationContactsContainer.tsx';
import { NegotiationProposalsContainer } from './containers/NegotiationProposalsContainer.tsx';
import { NegotiationWhatsappContainer } from './containers/NegotiationWhatsappContainer.tsx';
import { NegotiationIviContainer } from './containers/NegotiationIviContainer.tsx';
import { NegotiationGoalsContainer } from './containers/NegotiationGoalsContainer.tsx';

export type DetailSubTab = 'dados' | 'contatos' | 'propostas' | 'whatsapp' | 'ivi' | 'metas';

interface NegotiationDetailModalProps {
  negotiation: Negotiation | null;
  banks: BankItem[];
  collaborators: CollaboratorItem[];
  goals: NegotiationGoal[];
  allNegotiations: Negotiation[];
  wsTick?: number;
  onClose: () => void;
  onUpdated: (updated?: Negotiation) => Promise<void>;
  onOpenClientFicha?: (clientId: number) => void;
  onOpenAdmissionFicha?: (admissionId: number | null, clientId: number) => void;
  onOpenHistoryModal?: (neg: Negotiation) => void;
  onOpenNegAuditModal?: (neg: Negotiation) => void;
}

export const NegotiationDetailModal: React.FC<NegotiationDetailModalProps> = ({
  negotiation,
  banks,
  collaborators: _collaborators,
  goals,
  allNegotiations,
  wsTick,
  onClose,
  onUpdated,
  onOpenClientFicha,
  onOpenAdmissionFicha,
  onOpenHistoryModal,
  onOpenNegAuditModal,
}) => {
  const [subTab, setSubTab] = useState<DetailSubTab>('dados');
  const [statusVal, setStatusVal] = useState<string>('EM_ANDAMENTO');
  const [selectedBankContactId, setSelectedBankContactId] = useState<number | null>(null);
  const [savingStatus, setSavingStatus] = useState(false);

  // WhatsApp Dual state
  const [waData, setWaData] = useState<WhatsappDualPayload | null>(null);
  const [waLoading, setWaLoading] = useState(false);
  const [waChannelTarget, setWaChannelTarget] = useState<'CLIENTE' | 'BANCO'>('BANCO');
  const [waBankContactFilterId, setWaBankContactFilterId] = useState<string>('');

  // Ivi IA Advisor state
  const [iviAdvisor, setIviAdvisor] = useState<NegotiationIviAdvisorPayload | null>(
    negotiation?.iviInsightsJson || null
  );
  const [iviLoading, setIviLoading] = useState(false);

  // Local transient feedback toast
  const [toastMsg, setToastMsg] = useState<string>('');
  const toastTimerRef = useRef<number | null>(null);
  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => setToastMsg(''), 3600);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    };
  }, []);

  const negId = negotiation?.id ?? 0;

  const matchedBank: BankItem | null = useMemo(() => {
    if (!negotiation) return null;
    if (negotiation.bankId) {
      const byId = banks.find((b) => b.id === negotiation.bankId);
      if (byId) return byId;
    }
    const q = (negotiation.bankName || '').toLowerCase().replace('banco ', '').trim();
    return (
      banks.find((b) => b.name.toLowerCase().includes(q) || q.includes(b.name.toLowerCase())) || null
    );
  }, [banks, negotiation]);

  const bankContactsList: BankContactItem[] = useMemo(
    () => (waData?.bankContacts?.length ? waData.bankContacts : matchedBank?.contacts || []),
    [waData?.bankContacts, matchedBank?.contacts]
  );

  const bankServicesList: BankServiceItem[] = useMemo(
    () => matchedBank?.services || [],
    [matchedBank?.services]
  );

  const loadWhatsappDual = useCallback(async (id: number, silent = false) => {
    if (!id) return;
    if (!silent) setWaLoading(true);
    try {
      const res = await apiFetch<WhatsappDualPayload>(`/api/negotiations/${id}/whatsapp`);
      setWaData(res);
    } catch (err) {
      console.error('Erro ao carregar WhatsApp da negociação:', err);
    } finally {
      if (!silent) setWaLoading(false);
    }
  }, []);

  // Synchronize when switching which negotiation is opened
  useEffect(() => {
    if (!negotiation) {
      setWaData(null);
      return;
    }
    setStatusVal(negotiation.negotiationStatus || 'EM_ANDAMENTO');
    setSelectedBankContactId(negotiation.selectedBankContactId || null);
    setWaBankContactFilterId(
      negotiation.selectedBankContactId ? String(negotiation.selectedBankContactId) : ''
    );
    setIviAdvisor(negotiation.iviInsightsJson || null);
    setSubTab('dados');
    void loadWhatsappDual(negotiation.id);
  }, [negId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Background refresh of WhatsApp messages when WebSocket notifies while modal is open
  const lastWsRef = useRef(wsTick);
  useEffect(() => {
    if (lastWsRef.current === wsTick) return;
    lastWsRef.current = wsTick;
    if (negId > 0) {
      void loadWhatsappDual(negId, true);
    }
  }, [wsTick, negId, loadWhatsappDual]);

  const handleQuickStatusChange = async (nextStatus: string) => {
    if (!negotiation) return;
    setStatusVal(nextStatus);
    setSavingStatus(true);
    try {
      const updated = await apiFetch<Negotiation>(`/api/negotiations/${negotiation.id}`, {
        method: 'PUT',
        body: JSON.stringify({ negotiationStatus: nextStatus }),
      });
      await onUpdated(updated);
      showToast(`Status alterado para ${NEGOTIATION_STATUS_CONFIG[nextStatus]?.label || nextStatus}.`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erro ao atualizar status.');
    } finally {
      setSavingStatus(false);
    }
  };

  const handleRunIviAdvisor = useCallback(async () => {
    if (!negotiation) return;
    setIviLoading(true);
    try {
      const res = await apiFetch<{ advisor: NegotiationIviAdvisorPayload; negotiation?: Negotiation }>(
        `/api/negotiations/${negotiation.id}/ivi-advisor`,
        { method: 'POST', body: JSON.stringify({}) }
      );
      setIviAdvisor(res.advisor);
      await onUpdated(res.negotiation);
      showToast('Diagnóstico Ivi IA atualizado com resumos de WhatsApp.');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Falha ao consultar a Assessora Ivi IA.');
    } finally {
      setIviLoading(false);
    }
  }, [negotiation, onUpdated, showToast]);

  // Early return ONLY AFTER all hooks are registered
  if (!negotiation) return null;

  const statusCfg =
    NEGOTIATION_STATUS_CONFIG[statusVal] || NEGOTIATION_STATUS_CONFIG.EM_ANDAMENTO;

  const tabs: Array<{ id: DetailSubTab; label: string; icon: React.ReactNode }> = [
    { id: 'dados', label: 'Dados & Contatos Banco', icon: <Building2 className="w-3.5 h-3.5" /> },
    {
      id: 'contatos',
      label: `Contatos (${negotiation.contacts?.length || 0})`,
      icon: <Phone className="w-3.5 h-3.5" />,
    },
    {
      id: 'propostas',
      label: `Propostas (${negotiation.proposals?.length || 0})`,
      icon: <Calculator className="w-3.5 h-3.5" />,
    },
    {
      id: 'whatsapp',
      label: `WhatsApp (${(waData?.bankMessages?.length || 0) + (waData?.clientMessages?.length || 0)})`,
      icon: <MessageCircle className="w-3.5 h-3.5" />,
    },
    { id: 'ivi', label: 'Assessora Ivi IA', icon: <Sparkles className="w-3.5 h-3.5" /> },
    { id: 'metas', label: 'Metas', icon: <Target className="w-3.5 h-3.5" /> },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-2 sm:p-4 overflow-y-auto dark:bg-slate-950/80"
      onClick={onClose}
    >
      <div
        className="w-full max-w-6xl rounded-xl border border-slate-200 bg-white shadow-2xl overflow-hidden flex flex-col max-h-[94vh] dark:border-slate-700 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Clean Header Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-900 px-4 sm:px-6 py-3.5 text-white shrink-0 dark:border-slate-700 dark:bg-emerald-600">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded bg-blue-600 px-2 py-0.5 text-[11px] font-mono tabular-nums font-bold">
                #{negotiation.id}
              </span>
              {onOpenClientFicha ? (
                <button
                  type="button"
                  onClick={() => onOpenClientFicha(negotiation.clientId)}
                  className="font-display text-base font-bold text-white hover:text-blue-300 hover:underline inline-flex items-center gap-1.5 text-left truncate"
                  title="Abrir Ficha Completa do Cliente"
                >
                  <span>{negotiation.clientName}</span>
                  <ExternalLink className="w-3.5 h-3.5 opacity-80 shrink-0" />
                </button>
              ) : (
                <h2 className="font-display text-base font-bold truncate">{negotiation.clientName}</h2>
              )}
              <span className={`rounded border px-2 py-0.5 text-[10px] font-bold ${statusCfg.badgeClass}`}>
                {statusCfg.label}
              </span>
            </div>
            <div className="text-xs text-slate-300 mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5">
              <span>
                Contrato:{' '}
                <strong className="font-mono text-white">{negotiation.contractNumber || '—'}</strong>
              </span>
              <span>
                Banco: <strong className="text-white">{negotiation.bankName}</strong>
              </span>
              <span>
                Dívida Original:{' '}
                <strong className="font-mono tabular-nums text-emerald-300">
                  {formatBRL(negotiation.originalDebtCents)}
                </strong>
              </span>
              <span>
                Negociador: <strong className="text-white">{negotiation.collaboratorName}</strong>
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {onOpenClientFicha && (
              <button
                type="button"
                onClick={() => onOpenClientFicha(negotiation.clientId)}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-700"
              >
                <User className="w-3.5 h-3.5 text-blue-400" />
                <span className="hidden sm:inline">Ficha Cliente</span>
              </button>
            )}
            {onOpenAdmissionFicha && (
              <button
                type="button"
                onClick={() => onOpenAdmissionFicha(negotiation.admissionId, negotiation.clientId)}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-700"
              >
                <FileText className="w-3.5 h-3.5 text-emerald-400" />
                <span className="hidden sm:inline">Admissão</span>
              </button>
            )}
            {onOpenHistoryModal && (
              <button
                type="button"
                onClick={() => onOpenHistoryModal(negotiation)}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-700"
                title="Histórico do Título Financeiro"
              >
                <History className="w-3.5 h-3.5 text-amber-400" />
                <span className="hidden sm:inline">Histórico</span>
              </button>
            )}
            {onOpenNegAuditModal && (
              <button
                type="button"
                onClick={() => onOpenNegAuditModal(negotiation)}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-700"
                title="Auditoria completa das alterações desta Negociação"
              >
                <History className="w-3.5 h-3.5 text-emerald-400" />
                <span className="hidden sm:inline">Auditoria</span>
              </button>
            )}

            <select
              value={statusVal}
              disabled={savingStatus}
              onChange={(e) => void handleQuickStatusChange(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs font-semibold text-white focus:outline-none dark:text-slate-100"
            >
              {Object.entries(NEGOTIATION_STATUS_CONFIG).map(([key, cfg]) => (
                <option key={key} value={key}>
                  {cfg.label}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-slate-300 hover:bg-slate-800 hover:text-white"
              title="Fechar modal"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Toast feedback bar */}
        {toastMsg && (
          <div className="bg-emerald-700 text-white px-6 py-2 text-xs font-medium flex items-center justify-between shrink-0">
            <span className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              {toastMsg}
            </span>
            <button type="button" onClick={() => setToastMsg('')} className="text-emerald-200 hover:text-white">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Sub-Tabs Navigation */}
        <div className="flex items-center gap-1 border-b border-slate-200 bg-slate-50 px-4 sm:px-6 pt-2 overflow-x-auto shrink-0 dark:border-slate-700 dark:bg-slate-800/70">
          {tabs.map((tab) => {
            const active = subTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setSubTab(tab.id)}
                className={`inline-flex items-center gap-1.5 rounded-t-lg px-3.5 py-2 text-xs font-semibold whitespace-nowrap border-b-2 transition-colors ${
                  active
                    ? 'border-blue-600 bg-white text-blue-700 dark:bg-slate-900 dark:text-blue-300'
                    : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-300 dark:hover:text-white dark:hover:bg-slate-800'
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Dedicated Container Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-slate-50/40">
          {subTab === 'dados' && (
            <NegotiationOverviewContainer
              key={`overview-${negotiation.id}-${negotiation.updatedAt || ''}`}
              negotiation={negotiation}
              matchedBank={matchedBank}
              bankContactsList={bankContactsList}
              bankServicesList={bankServicesList}
              statusVal={statusVal}
              selectedBankContactId={selectedBankContactId}
              onSelectBankContactId={setSelectedBankContactId}
              onOpenBankWhatsapp={(bcId) => {
                setSelectedBankContactId(bcId);
                setWaBankContactFilterId(String(bcId));
                setWaChannelTarget('BANCO');
                setSubTab('whatsapp');
              }}
              onUpdated={onUpdated}
              showToast={showToast}
            />
          )}

          {subTab === 'contatos' && (
            <NegotiationContactsContainer
              negotiation={negotiation}
              bankContactsList={bankContactsList}
              onUpdated={onUpdated}
              showToast={showToast}
            />
          )}

          {subTab === 'propostas' && (
            <NegotiationProposalsContainer
              negotiation={negotiation}
              bankContactsList={bankContactsList}
              onUpdated={onUpdated}
              showToast={showToast}
            />
          )}

          {subTab === 'whatsapp' && (
            <NegotiationWhatsappContainer
              negotiation={negotiation}
              waData={waData}
              waLoading={waLoading}
              waChannelTarget={waChannelTarget}
              onChannelTargetChange={setWaChannelTarget}
              waBankContactFilterId={waBankContactFilterId}
              onBankContactFilterIdChange={setWaBankContactFilterId}
              bankContactsList={bankContactsList}
              iviAdvisor={iviAdvisor}
              onRunIviAdvisor={handleRunIviAdvisor}
              onRefreshWhatsapp={() => loadWhatsappDual(negotiation.id)}
              onUpdated={onUpdated}
              showToast={showToast}
            />
          )}

          {subTab === 'ivi' && (
            <NegotiationIviContainer
              negotiation={negotiation}
              iviAdvisor={iviAdvisor}
              iviLoading={iviLoading}
              onRunIviAdvisor={handleRunIviAdvisor}
              onUseDraftInWhatsapp={(target, _draft) => {
                setWaChannelTarget(target);
                setSubTab('whatsapp');
                showToast(
                  target === 'BANCO'
                    ? 'Canal do Banco aberto. Clique em "Inserir Minuta na Mensagem" no painel esquerdo.'
                    : 'Canal do Cliente aberto. Clique em "Inserir Minuta na Mensagem" no painel esquerdo.'
                );
              }}
              showToast={showToast}
            />
          )}

          {subTab === 'metas' && (
            <NegotiationGoalsContainer
              negotiation={negotiation}
              goals={goals}
              allNegotiations={allNegotiations}
              onUpdated={async () => {
                await onUpdated();
              }}
              showToast={showToast}
            />
          )}
        </div>
      </div>
    </div>
  );
};
