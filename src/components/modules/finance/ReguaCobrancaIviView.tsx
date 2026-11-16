import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BellRing,
  CheckCircle2,
  Clock,
  FileSpreadsheet,
  MessageSquare,
  RefreshCw,
  ScanSearch,
  Send,
  Sparkles,
  X,
} from 'lucide-react';
import { apiFetch, formatBRL, formatDateBR } from '../../../lib/api.ts';
import { ReguaBatchCandidate } from '../../../types.ts';

interface CoverSheetCandidate {
  admissionId: number;
  protocolCode: string;
  clientName: string;
  bankName: string;
  remainingInstallments: number;
  installmentAmountCents: number;
}

interface ReguaCobrancaIviViewProps {
  onReloadFinance: () => Promise<void>;
}

const STAGE_META: Record<
  '-15d' | '-5d' | '+7d',
  { title: string; subtitle: string; hint: string; tone: string; activeBorder: string }
> = {
  '-15d': {
    title: 'Lembrete Preventivo (-15 dias)',
    subtitle: 'Vencimentos acima de 5 dias à frente',
    hint: 'Mensagem amigável para antecipar 2ª via de boleto ou PIX.',
    tone: 'text-blue-700 dark:text-blue-300',
    activeBorder: 'border-blue-600 bg-blue-50/60',
  },
  '-5d': {
    title: 'Aviso de Vencimento (-5 dias)',
    subtitle: 'Vencem nos próximos 5 dias ou hoje',
    hint: 'Lembrete próximo ao vencimento para evitar esquecimento.',
    tone: 'text-amber-700 dark:text-amber-300',
    activeBorder: 'border-amber-600 bg-amber-50/60',
  },
  '+7d': {
    title: 'Cobrança em Atraso (+7d / Vencidos)',
    subtitle: 'Títulos já vencidos em aberto ou parcial',
    hint: 'Abordagem resolutiva para renegociação ou quitação imediata.',
    tone: 'text-red-700 dark:text-red-300',
    activeBorder: 'border-red-600 bg-red-50/60',
  },
};

export const ReguaCobrancaIviView: React.FC<ReguaCobrancaIviViewProps> = ({ onReloadFinance }) => {
  const [candidates, setCandidates] = useState<ReguaBatchCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeStage, setActiveStage] = useState<'-15d' | '-5d' | '+7d'>('+7d');
  const [includeAlreadySent, setIncludeAlreadySent] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [useAiPersonalization, setUseAiPersonalization] = useState(true);
  const [editingMsgId, setEditingMsgId] = useState<number | null>(null);
  const [messageOverrides, setMessageOverrides] = useState<Record<string, string>>({});
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  const [toast, setToast] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [lastDispatchReport, setLastDispatchReport] = useState<
    Array<{ titleId: number; titleCode: string; clientName: string; provider: string; message: string }>
  >([]);

  // Varredura 07h / Folha de Rosto state
  const [scanResults, setScanResults] = useState<CoverSheetCandidate[] | null>(null);
  const [coverSheetTarget, setCoverSheetTarget] = useState<CoverSheetCandidate | null>(null);
  const [firstDueDate, setFirstDueDate] = useState('');
  const [customAmountReais, setCustomAmountReais] = useState('');
  const [scanBusy, setScanBusy] = useState(false);

  const loadBatches = useCallback(async () => {
    setLoading(true);
    setErrorMsg('');
    try {
      const res = await apiFetch<{ candidates: ReguaBatchCandidate[] }>('/api/finance/regua/batches');
      setCandidates(res.candidates || []);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao carregar lotes da Régua Ivi.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadBatches();
  }, [loadBatches]);

  const stageCounts = useMemo(() => {
    const map: Record<'-15d' | '-5d' | '+7d', { pendingCount: number; pendingCents: number; totalCount: number }> = {
      '-15d': { pendingCount: 0, pendingCents: 0, totalCount: 0 },
      '-5d': { pendingCount: 0, pendingCents: 0, totalCount: 0 },
      '+7d': { pendingCount: 0, pendingCents: 0, totalCount: 0 },
    };
    for (const c of candidates) {
      map[c.stageTag].totalCount += 1;
      if (!c.alreadySentStages.includes(c.stageTag)) {
        map[c.stageTag].pendingCount += 1;
        map[c.stageTag].pendingCents += c.balanceCents;
      }
    }
    return map;
  }, [candidates]);

  const visibleCandidates = useMemo(() => {
    return candidates.filter((c) => {
      if (c.stageTag !== activeStage) return false;
      if (!includeAlreadySent && c.alreadySentStages.includes(c.stageTag)) return false;
      return true;
    });
  }, [candidates, activeStage, includeAlreadySent]);

  // Auto-select pending candidates whenever stage changes
  useEffect(() => {
    const pendingInStage = candidates
      .filter((c) => c.stageTag === activeStage && !c.alreadySentStages.includes(activeStage))
      .map((c) => c.titleId);
    setSelectedIds(pendingInStage);
  }, [activeStage, candidates]);

  const selectedCandidates = useMemo(
    () => visibleCandidates.filter((c) => selectedIds.includes(c.titleId)),
    [visibleCandidates, selectedIds]
  );

  const selectedTotalCents = useMemo(
    () => selectedCandidates.reduce((acc, c) => acc + c.balanceCents, 0),
    [selectedCandidates]
  );

  const toggleAll = () => {
    const allIds = visibleCandidates.map((c) => c.titleId);
    const allChecked = allIds.length > 0 && allIds.every((id) => selectedIds.includes(id));
    if (allChecked) {
      setSelectedIds([]);
    } else {
      setSelectedIds(allIds);
    }
  };

  const handleConfirmBatchDispatch = async () => {
    if (selectedCandidates.length === 0) return;
    setDispatching(true);
    setErrorMsg('');
    try {
      const res = await apiFetch<{
        dispatchedCount: number;
        stageTag: string;
        dispatched: Array<{ titleId: number; titleCode: string; clientName: string; provider: string; message: string }>;
      }>('/api/finance/regua/confirm-batch', {
        method: 'POST',
        body: JSON.stringify({
          stageTag: activeStage,
          titleIds: selectedCandidates.map((c) => c.titleId),
          useAiPersonalization,
          messageOverrides,
        }),
      });
      setLastDispatchReport(res.dispatched || []);
      setConfirmModalOpen(false);
      setToast(
        `Lote ${activeStage} confirmado! A Ivi processou e enviou ${res.dispatchedCount} cobrança(s) automaticamente.`
      );
      await loadBatches();
      await onReloadFinance();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao confirmar disparo do lote.');
    } finally {
      setDispatching(false);
    }
  };

  const handleRunIvi07hScan = async () => {
    setScanBusy(true);
    setErrorMsg('');
    try {
      const res = await apiFetch<{ readyForCoverSheet: CoverSheetCandidate[] }>('/api/finance/ivi-07h-scan', {
        method: 'POST',
      });
      setScanResults(res.readyForCoverSheet || []);
      if ((res.readyForCoverSheet || []).length === 0) {
        setToast('Varredura 07:00h concluída: nenhum contrato pendente de Folha de Rosto no momento.');
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao executar varredura 07:00h.');
    } finally {
      setScanBusy(false);
    }
  };

  const handleApproveCoverSheet = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!coverSheetTarget) return;
    setScanBusy(true);
    try {
      const customAmountCents = Math.round(Number(customAmountReais) * 100);
      const res = await apiFetch<{ generatedCount: number }>(
        `/api/finance/generate-remaining/${coverSheetTarget.admissionId}`,
        {
          method: 'POST',
          body: JSON.stringify({ firstDueDate, customAmountCents }),
        }
      );
      setToast(
        `Folha de Rosto aprovada! ${res.generatedCount} boletos restantes gerados e integrados ao Contas a Receber.`
      );
      setCoverSheetTarget(null);
      setScanResults((prev) =>
        prev ? prev.filter((item) => item.admissionId !== coverSheetTarget.admissionId) : null
      );
      await onReloadFinance();
      await loadBatches();
    } finally {
      setScanBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Contextual Explanation for Lay User */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4 dark:border-slate-700 dark:bg-slate-900">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-slate-100">
            <BellRing className="w-4 h-4 text-blue-700 dark:text-blue-300" />
            Confirmação de Lotes da Régua Ivi
          </div>
          <p className="text-xs text-slate-600 leading-relaxed max-w-3xl dark:text-slate-300">
            Esta área é separada das movimentações diárias para evitar envios acidentais. Escolha o lote abaixo, revise os
            clientes selecionados (ou edite qualquer mensagem) e clique em <strong>Confirmar Lote para Ivi</strong>.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            disabled={scanBusy}
            onClick={handleRunIvi07hScan}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 whitespace-nowrap min-h-[40px] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
          >
            <ScanSearch className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            Varredura 07:00h (Folha de Rosto)
          </button>
          <button
            type="button"
            onClick={loadBatches}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap min-h-[40px] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Atualizar Lotes
          </button>
        </div>
      </div>

      {toast && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-medium text-emerald-900 flex items-center justify-between dark:border-emerald-800/70 dark:bg-emerald-950/50 dark:text-emerald-300">
          <span>{toast}</span>
          <button type="button" onClick={() => setToast('')}>
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {errorMsg && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-xs font-medium text-red-800 flex items-center justify-between dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300">
          <span>{errorMsg}</span>
          <button type="button" onClick={() => setErrorMsg('')}>
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Varredura 07h / Folha de Rosto results */}
      {scanResults && scanResults.length > 0 && (
        <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-4 space-y-3 dark:border-blue-800/70 dark:bg-blue-950/50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-bold text-blue-950 dark:text-blue-300">
              <FileSpreadsheet className="w-4 h-4 text-blue-700 dark:text-blue-300" />
              Varredura 07:00h · {scanResults.length} contrato(s) com parcelas iniciais pagas prontos para Folha de Rosto
            </div>
            <button type="button" onClick={() => setScanResults(null)} className="text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {scanResults.map((cand) => (
              <div
                key={cand.admissionId}
                className="rounded-lg border border-blue-200 bg-white p-3.5 flex items-center justify-between gap-3 dark:border-blue-800/70 dark:bg-slate-900"
              >
                <div>
                  <div className="font-mono text-xs font-bold text-slate-900 dark:text-slate-100">
                    {cand.protocolCode} · {cand.clientName}
                  </div>
                  <div className="text-[11px] text-slate-600 mt-0.5 dark:text-slate-300">
                    {cand.bankName} · Gerar {cand.remainingInstallments} parcelas de{' '}
                    <span className="font-mono tabular-nums">{formatBRL(cand.installmentAmountCents)}</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setCoverSheetTarget(cand);
                    setFirstDueDate(new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10));
                    setCustomAmountReais((cand.installmentAmountCents / 100).toFixed(2));
                  }}
                  className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 whitespace-nowrap"
                >
                  Aprovar Folha de Rosto
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 3 Stage Batch Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
        {(['-15d', '-5d', '+7d'] as const).map((stage) => {
          const meta = STAGE_META[stage];
          const stat = stageCounts[stage];
          const isActive = activeStage === stage;
          return (
            <button
              key={stage}
              type="button"
              onClick={() => setActiveStage(stage)}
              className={`rounded-xl border p-4 text-left transition-colors ${
                isActive ? meta.activeBorder : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className={`text-xs font-bold ${meta.tone}`}>{meta.title}</span>
                <span className="font-mono text-xs font-bold text-slate-700 tabular-nums dark:text-slate-200">
                  {stat.pendingCount} pendente(s)
                </span>
              </div>
              <div className="mt-2 font-mono text-xl font-bold text-slate-900 tabular-nums dark:text-slate-100">
                {formatBRL(stat.pendingCents)}
              </div>
              <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{meta.subtitle}</p>
            </button>
          );
        })}
      </div>

      {/* Stage Batch Confirmation Grid */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden dark:border-slate-700 dark:bg-slate-900">
        <div className="px-4 py-3 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-3 dark:border-slate-800">
          <div>
            <h2 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
              {STAGE_META[activeStage].title}
            </h2>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">{STAGE_META[activeStage].hint}</p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer dark:text-slate-200">
              <input
                type="checkbox"
                checked={includeAlreadySent}
                onChange={(e) => setIncludeAlreadySent(e.target.checked)}
              />
              <span>Exibir já notificados neste estágio</span>
            </label>

            <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer dark:text-slate-200">
              <input
                type="checkbox"
                checked={useAiPersonalization}
                onChange={(e) => setUseAiPersonalization(e.target.checked)}
              />
              <span>Personalizar texto com IA Ivi</span>
            </label>

            <button
              type="button"
              disabled={selectedCandidates.length === 0 || dispatching}
              onClick={() => setConfirmModalOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-45 whitespace-nowrap min-h-[38px]"
            >
              <Send className="w-3.5 h-3.5" />
              Confirmar Lote para Ivi ({selectedCandidates.length})
            </button>
          </div>
        </div>

        <div className="overflow-x-auto scroll-rulers">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-[11px] font-semibold text-slate-500 border-b border-slate-200 dark:bg-slate-800/70 dark:text-slate-400 dark:border-slate-700">
              <tr>
                <th className="px-3 py-2.5 w-10">
                  <input
                    type="checkbox"
                    checked={
                      visibleCandidates.length > 0 &&
                      visibleCandidates.every((c) => selectedIds.includes(c.titleId))
                    }
                    onChange={toggleAll}
                    aria-label="Selecionar todos do lote"
                  />
                </th>
                <th className="px-3 py-2.5">Cliente / WhatsApp</th>
                <th className="px-3 py-2.5">Documento / Parcela</th>
                <th className="px-3 py-2.5">Vencimento</th>
                <th className="px-3 py-2.5">Prazo</th>
                <th className="px-3 py-2.5 text-right">Saldo Aberto</th>
                <th className="px-3 py-2.5">Histórico Ivi</th>
                <th className="px-3 py-2.5 text-right">Mensagem</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {loading ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-500 dark:text-slate-400">
                    Carregando títulos elegíveis para a régua de cobrança...
                  </td>
                </tr>
              ) : visibleCandidates.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-slate-500 dark:text-slate-400">
                    Nenhum título pendente de confirmação para o estágio {activeStage}.
                  </td>
                </tr>
              ) : (
                visibleCandidates.map((c) => {
                  const checked = selectedIds.includes(c.titleId);
                  const sentHere = c.alreadySentStages.includes(activeStage);
                  const currentText = messageOverrides[String(c.titleId)] ?? c.suggestedMessage;
                  const isEditingThis = editingMsgId === c.titleId;
                  return (
                    <React.Fragment key={c.titleId}>
                      <tr className={`hover:bg-slate-50/70 dark:hover:bg-slate-800 ${checked ? 'bg-blue-50/25' : ''}`}>
                        <td className="px-3 py-2.5">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              if (e.target.checked) setSelectedIds((prev) => [...prev, c.titleId]);
                              else setSelectedIds((prev) => prev.filter((id) => id !== c.titleId));
                            }}
                          />
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="font-semibold text-slate-900 dark:text-slate-100">{c.clientName}</div>
                          <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                            {c.clientWhatsapp || c.clientPhone || 'Sem telefone'}
                          </div>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="font-mono font-semibold text-slate-900 dark:text-slate-100">{c.documentNumber}</div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400">
                            Parcela {c.installmentNumber}/{c.totalInstallments}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 font-mono tabular-nums text-slate-700 dark:text-slate-200">
                          {formatDateBR(c.dueDate)}
                        </td>
                        <td className="px-3 py-2.5 font-mono tabular-nums">
                          <span
                            className={`font-semibold ${
                              c.daysOffset < 0
                                ? 'text-red-600 dark:text-red-400'
                                : c.daysOffset <= 5
                                ? 'text-amber-700 dark:text-amber-300'
                                : 'text-blue-700 dark:text-blue-300'
                            }`}
                          >
                            {c.daysOffset < 0
                              ? `${Math.abs(c.daysOffset)}d atraso`
                              : c.daysOffset === 0
                              ? 'Vence hoje'
                              : `Em ${c.daysOffset}d`}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono font-bold tabular-nums text-slate-900 dark:text-slate-100">
                          {formatBRL(c.balanceCents)}
                        </td>
                        <td className="px-3 py-2.5 text-[11px]">
                          {c.alreadySentStages.length > 0 ? (
                            <span className={sentHere ? 'text-emerald-700 font-semibold dark:text-emerald-300' : 'text-slate-600 dark:text-slate-300'}>
                              {c.alreadySentStages.join(' · ')}
                            </span>
                          ) : (
                            <span className="text-slate-400 dark:text-slate-400">Nunca cobrado</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <button
                            type="button"
                            onClick={() => setEditingMsgId(isEditingThis ? null : c.titleId)}
                            className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-700 hover:underline whitespace-nowrap dark:text-blue-300"
                          >
                            <MessageSquare className="w-3.5 h-3.5" />
                            {isEditingThis ? 'Fechar Texto' : 'Revisar / Editar'}
                          </button>
                        </td>
                      </tr>
                      {isEditingThis && (
                        <tr className="bg-slate-50/90 dark:bg-slate-800/60">
                          <td colSpan={8} className="px-4 py-3">
                            <label className="block text-[11px] font-semibold text-slate-700 mb-1 dark:text-slate-200">
                              Prévia da mensagem para {c.clientName} (edite se desejar envio personalizado sem alterar o padrão dos demais):
                            </label>
                            <textarea
                              rows={2}
                              value={currentText}
                              onChange={(e) =>
                                setMessageOverrides((prev) => ({
                                  ...prev,
                                  [String(c.titleId)]: e.target.value,
                                }))
                              }
                              className="w-full rounded-lg border border-slate-200 bg-white p-2.5 text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                            />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
            {selectedCandidates.length > 0 && (
              <tfoot className="bg-slate-50 border-t border-slate-200 text-xs font-bold text-slate-900 dark:bg-slate-800/70 dark:border-slate-700 dark:text-slate-100">
                <tr>
                  <td colSpan={5} className="px-4 py-2.5 text-right">
                    Total selecionado no lote ({selectedCandidates.length} título(s)):
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono tabular-nums text-blue-800 dark:text-blue-300">
                    {formatBRL(selectedTotalCents)}
                  </td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Dispatched Confirmation Report */}
      {lastDispatchReport.length > 0 && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4 space-y-2.5 dark:border-emerald-800/70 dark:bg-emerald-950/50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-bold text-emerald-900 dark:text-emerald-300">
              <CheckCircle2 className="w-4 h-4 text-emerald-700 dark:text-emerald-300" />
              Último Lote Confirmado e Processado pela Ivi ({lastDispatchReport.length} envio(s))
            </div>
            <button type="button" onClick={() => setLastDispatchReport([])} className="text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="divide-y divide-emerald-100 bg-white rounded-lg border border-emerald-200 dark:bg-slate-900 dark:border-emerald-800/70">
            {lastDispatchReport.map((item) => (
              <div key={item.titleId} className="p-3 text-xs space-y-1">
                <div className="flex items-center justify-between font-semibold text-slate-900 dark:text-slate-100">
                  <span>
                    {item.clientName} · <span className="font-mono">{item.titleCode}</span>
                  </span>
                  <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">Motor: {item.provider}</span>
                </div>
                <p className="text-slate-700 leading-relaxed dark:text-slate-200">{item.message}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Confirm Batch Modal */}
      {confirmModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4 dark:bg-slate-950/80">
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-5 shadow-2xl space-y-4 dark:border-slate-700 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-blue-700 dark:text-blue-300" />
                <h3 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                  Confirmar Envio Automático pela Ivi
                </h3>
              </div>
              <button type="button" onClick={() => setConfirmModalOpen(false)} className="text-slate-400 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2 text-xs text-slate-700 dark:text-slate-200">
              <p>
                Você está prestes a autorizar a <strong>Ivi IA</strong> a disparar cobranças para{' '}
                <strong>{selectedCandidates.length} título(s)</strong> no estágio{' '}
                <strong className="font-mono">{activeStage}</strong>.
              </p>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 flex items-center justify-between dark:border-slate-700 dark:bg-slate-800/70">
                <span>Montante total do lote:</span>
                <span className="font-mono text-sm font-bold text-slate-900 tabular-nums dark:text-slate-100">
                  {formatBRL(selectedTotalCents)}
                </span>
              </div>
              <div className="max-h-40 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100 dark:border-slate-700 dark:divide-slate-800">
                {selectedCandidates.map((c) => (
                  <div key={c.titleId} className="px-3 py-1.5 flex items-center justify-between text-[11px]">
                    <span className="truncate font-medium text-slate-800 dark:text-slate-100">
                      {c.clientName} ({c.documentNumber})
                    </span>
                    <span className="font-mono tabular-nums text-slate-700 shrink-0 ml-2 dark:text-slate-200">
                      {formatBRL(c.balanceCents)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={dispatching}
                onClick={() => setConfirmModalOpen(false)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Voltar e Revisar
              </button>
              <button
                type="button"
                disabled={dispatching}
                onClick={handleConfirmBatchDispatch}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-50"
              >
                <Clock className="w-3.5 h-3.5" />
                {dispatching ? 'Ivi enviando lote...' : 'Autorizar e Enviar Agora'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cover Sheet Modal */}
      {coverSheetTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4 dark:bg-slate-950/80">
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-2xl space-y-4 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
              <div>
                <h3 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                  Folha de Rosto · Emissão de Boletos Restantes
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {coverSheetTarget.protocolCode} · {coverSheetTarget.clientName}
                </p>
              </div>
              <button type="button" onClick={() => setCoverSheetTarget(null)} className="text-slate-400 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleApproveCoverSheet} className="space-y-3.5 text-xs">
              <div className="rounded-lg bg-slate-50 border border-slate-100 p-3 space-y-1 dark:bg-slate-800/70 dark:border-slate-800">
                <div><strong>Credor:</strong> {coverSheetTarget.bankName}</div>
                <div><strong>Parcelas iniciais:</strong> Liquidadas</div>
                <div><strong>Parcelas a gerar:</strong> {coverSheetTarget.remainingInstallments} boletos Santander</div>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">1º Vencimento das demais parcelas</label>
                <input
                  type="date"
                  required
                  value={firstDueDate}
                  onChange={(e) => setFirstDueDate(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Valor unitário (R$)</label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={customAmountReais}
                  onChange={(e) => setCustomAmountReais(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono dark:border-slate-700"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setCoverSheetTarget(null)}
                  className="rounded-lg border border-slate-200 px-4 py-2 font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={scanBusy}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 font-semibold text-white hover:bg-emerald-700"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Aprovar e Emitir Boletos
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
