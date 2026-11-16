import React from 'react';
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ClipboardCheck,
  FileSearch,
  Loader2,
  Maximize2,
  Minimize2,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldAlert,
  X,
} from 'lucide-react';
import { formatDateTimeBR } from '../../../lib/api.ts';
import { DocumentObject, IviAuditInsightsPayload } from '../../../types.ts';

interface AuditIviInsightsPanelProps {
  admissionId: number;
  protocolCode: string;
  documents: DocumentObject[];
  selectedDocId: number | null;
  onSelectDocId: (docId: number | null) => void;
  insights: IviAuditInsightsPayload | null;
  loading: boolean;
  errorMsg: string;
  mode: 'lateral' | 'modal';
  onToggleMode: (nextMode: 'lateral' | 'modal') => void;
  onClose: () => void;
  onRefresh: (forceAi?: boolean) => void;
  canDecide: boolean;
  hasSearchSeizure: boolean;
  onApplyChecklistSuggestions: (itemIds: number[]) => void;
  onEnableSearchSeizure: () => void;
  onApproveDossier: () => void;
  onSaveInAnalysis: () => void;
  onOpenRejectWithDraft: (reason: string) => void;
  onInspectInTab?: () => void;
}

const DECISION_META: Record<
  IviAuditInsightsPayload['recommendedDecision'],
  {
    border: string;
    bg: string;
    text: string;
    badgeText: string;
    Icon: React.ComponentType<{ className?: string }>;
  }
> = {
  APROVAR: {
    border: 'border-emerald-200 dark:border-emerald-800/70',
    bg: 'bg-emerald-50/80 dark:bg-emerald-950/50',
    text: 'text-emerald-900',
    badgeText: 'Sugestão: Aprovar Dossiê',
    Icon: CheckCircle2,
  },
  SALVAR_EM_ANALISE: {
    border: 'border-amber-200 dark:border-amber-800/70',
    bg: 'bg-amber-50/80 dark:bg-amber-950/50',
    text: 'text-amber-900 dark:text-amber-200',
    badgeText: 'Sugestão: Conferir Pendências',
    Icon: AlertTriangle,
  },
  DEVOLVER_ADMISSAO: {
    border: 'border-red-200 dark:border-red-800/70',
    bg: 'bg-red-50/80 dark:bg-red-950/50',
    text: 'text-red-900 dark:text-red-200',
    badgeText: 'Sugestão: Devolver ao Comercial',
    Icon: ShieldAlert,
  },
};

export const AuditIviInsightsPanel: React.FC<AuditIviInsightsPanelProps> = ({
  protocolCode,
  documents,
  selectedDocId,
  onSelectDocId,
  insights,
  loading,
  errorMsg,
  mode,
  onToggleMode,
  onClose,
  onRefresh,
  canDecide,
  hasSearchSeizure,
  onApplyChecklistSuggestions,
  onEnableSearchSeizure,
  onApproveDossier,
  onSaveInAnalysis,
  onOpenRejectWithDraft,
  onInspectInTab,
}) => {
  const decisionMeta = insights
    ? DECISION_META[insights.recommendedDecision] || DECISION_META.SALVAR_EM_ANALISE
    : null;

  const docInspection = insights?.documentInspection || null;

  const panelInner = (
    <div
      className={`rounded-xl border border-slate-200 bg-white flex flex-col overflow-hidden dark:border-slate-700 dark:bg-slate-900 ${
        mode === 'modal' ? 'w-full max-w-2xl max-h-[88vh] shadow-xl' : 'xl:sticky xl:top-4 max-h-[calc(100vh-3rem)]'
      }`}
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-2 shrink-0 dark:border-slate-800">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-slate-900 text-white flex items-center justify-center shrink-0 dark:bg-emerald-600">
            <Bot className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-slate-900 truncate dark:text-slate-100">
              Painel de Insights Ivi
            </h2>
            <p className="text-[11px] font-mono text-slate-500 truncate dark:text-slate-400">
              {protocolCode} ·{' '}
              {insights?.fromDatabaseCache
                ? `Base de Dados (${insights.aiCallsSaved || 1} IA economizada)`
                : 'Análise automática por regras'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => onRefresh(true)}
            disabled={loading}
            title="Reanalisar documento e regras com IA"
            aria-label="Reanalisar documento e regras com IA"
            className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          </button>
          <button
            type="button"
            onClick={() => onToggleMode(mode === 'lateral' ? 'modal' : 'lateral')}
            title={mode === 'lateral' ? 'Expandir em modal' : 'Fixar na lateral'}
            aria-label={mode === 'lateral' ? 'Expandir Painel de Insights Ivi em modal' : 'Fixar Painel de Insights Ivi na lateral'}
            className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            {mode === 'lateral' ? <Maximize2 className="w-3.5 h-3.5" /> : <Minimize2 className="w-3.5 h-3.5" />}
          </button>
          <button
            type="button"
            onClick={onClose}
            title="Fechar Painel de Insights Ivi"
            aria-label="Fechar Painel de Insights Ivi"
            className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Document Selector Bar */}
      <div className="px-4 py-2.5 border-b border-slate-100 bg-slate-50/70 space-y-1.5 shrink-0 dark:border-slate-800 dark:bg-slate-800/60">
        <div className="flex items-center justify-between text-[11px]">
          <label htmlFor="ivi-insights-doc-select" className="font-semibold text-slate-700 dark:text-slate-200">
            Documento em análise automática ({documents.length})
          </label>
          {onInspectInTab && documents.length > 0 && (
            <button
              type="button"
              onClick={onInspectInTab}
              className="font-semibold text-blue-700 hover:underline inline-flex items-center gap-1 dark:text-blue-300"
            >
              <FileSearch className="w-3 h-3" />
              Abrir visualizador
            </button>
          )}
        </div>
        <select
          id="ivi-insights-doc-select"
          value={selectedDocId ?? ''}
          onChange={(e) => onSelectDocId(e.target.value ? Number(e.target.value) : null)}
          disabled={documents.length === 0}
          className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 disabled:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        >
          {documents.length === 0 ? (
            <option value="">Nenhum documento anexado neste dossiê</option>
          ) : (
            documents.map((doc) => (
              <option key={doc.id} value={doc.id}>
                [{doc.docCategory}] {doc.fileName}
              </option>
            ))
          )}
        </select>
      </div>

      {/* Scrollable Body */}
      <div className="p-4 space-y-4 overflow-y-auto flex-1 text-xs">
        {loading && !insights ? (
          <div className="py-10 text-center space-y-2.5 text-slate-600 dark:text-slate-300">
            <Loader2 className="w-6 h-6 animate-spin text-slate-700 mx-auto dark:text-slate-200" />
            <div className="font-semibold text-slate-900 dark:text-slate-100">
              Ivi está lendo o documento e cruzando com as regras do sistema...
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Conferindo checklist configurado, titularidade, veículo e completude do cofre.
            </p>
          </div>
        ) : errorMsg ? (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-800 space-y-2 dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300">
            <p className="font-semibold">{errorMsg}</p>
            <button
              type="button"
              onClick={() => onRefresh(false)}
              className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 dark:border-red-800/70 dark:bg-slate-900 dark:text-red-300 dark:hover:bg-red-950/60"
            >
              Tentar novamente
            </button>
          </div>
        ) : insights && decisionMeta ? (
          <>
            {/* 1. Decision Recommendation */}
            <div className={`rounded-xl border ${decisionMeta.border} ${decisionMeta.bg} p-3.5 space-y-2`}>
              <div className="flex flex-wrap items-center justify-between gap-1.5">
                <div className={`inline-flex items-center gap-1.5 font-bold ${decisionMeta.text}`}>
                  <decisionMeta.Icon className="w-4 h-4 shrink-0" />
                  <span>{decisionMeta.badgeText}</span>
                </div>
                <span className="font-mono text-[10px] text-slate-500 dark:text-slate-400">
                  {loading
                    ? 'Atualizando...'
                    : `${formatDateTimeBR(insights.analyzedAt)}${insights.fromDatabaseCache ? ' · Cache DB' : ''}`}
                </span>
              </div>
              <div className="font-semibold text-slate-900 dark:text-slate-100">
                {insights.recommendedDecisionLabel}
              </div>
              {(typeof insights.inconsistenciesCount === 'number' ||
                typeof insights.attentionMeasuresCount === 'number') && (
                <div className="font-mono text-[11px] text-slate-700 flex items-center gap-2 dark:text-slate-200">
                  <span className={(insights.inconsistenciesCount || 0) > 0 ? 'font-bold text-red-700 dark:text-red-300' : 'text-emerald-700 dark:text-emerald-300'}>
                    {insights.inconsistenciesCount || 0} inconsistência(s)
                  </span>
                  <span className="text-slate-300">·</span>
                  <span className={(insights.attentionMeasuresCount || 0) > 0 ? 'font-bold text-amber-800 dark:text-amber-300' : 'text-slate-600 dark:text-slate-300'}>
                    {insights.attentionMeasuresCount || 0} medida(s) de atenção
                  </span>
                </div>
              )}
              <p className="text-slate-700 leading-relaxed dark:text-slate-200">{insights.decisionRationale}</p>

              {/* Contextual One-Click Decision Shortcuts */}
              {canDecide && (
                <div className="pt-2 flex flex-wrap gap-1.5 border-t border-black/5">
                  {insights.recommendedDecision === 'APROVAR' && (
                    <button
                      type="button"
                      onClick={onApproveDossier}
                      className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-emerald-700 whitespace-nowrap"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Aprovar & Emitir Boletos
                    </button>
                  )}
                  {insights.recommendedDecision === 'SALVAR_EM_ANALISE' && (
                    <button
                      type="button"
                      onClick={onSaveInAnalysis}
                      className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-slate-800 whitespace-nowrap dark:bg-emerald-600 dark:hover:bg-emerald-500"
                    >
                      <Save className="w-3.5 h-3.5" />
                      Salvar Em Análise
                    </button>
                  )}
                  {(insights.recommendedDecision === 'DEVOLVER_ADMISSAO' || insights.suggestedRejectionReason) && (
                    <button
                      type="button"
                      onClick={() => onOpenRejectWithDraft(insights.suggestedRejectionReason)}
                      className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-red-700 hover:bg-red-50 whitespace-nowrap dark:border-red-800/70 dark:bg-slate-900 dark:text-red-300 dark:hover:bg-red-950/60"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      Devolver c/ Critica Ivi
                    </button>
                  )}
                  {insights.suggestedChecklistItemIds.length > 0 && (
                    <button
                      type="button"
                      onClick={() => onApplyChecklistSuggestions(insights.suggestedChecklistItemIds)}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-800 hover:bg-slate-50 whitespace-nowrap dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                    >
                      <ClipboardCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                      Marcar {insights.suggestedChecklistItemIds.length} item(ns) no Checklist
                    </button>
                  )}
                  {insights.suggestedSearchSeizureFlag && !hasSearchSeizure && (
                    <button
                      type="button"
                      onClick={onEnableSearchSeizure}
                      className="inline-flex items-center gap-1 rounded-lg border border-amber-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-amber-800 hover:bg-amber-50 whitespace-nowrap dark:border-amber-800/70 dark:bg-slate-900 dark:text-amber-300 dark:hover:bg-amber-950/60"
                    >
                      <AlertTriangle className="w-3.5 h-3.5" />
                      Marcar Busca e Apreensão
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* 2. Automatic Selected Document Reading */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-slate-900 dark:text-slate-100">Leitura do Documento Selecionado</h3>
                {docInspection && (
                  <span className="font-mono text-[11px] text-slate-600 dark:text-slate-300">
                    {docInspection.legibility} · {docInspection.matchesDossier}
                  </span>
                )}
              </div>

              {!docInspection ? (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-slate-600 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-300">
                  Nenhum documento selecionado ou disponível no cofre para inspeção automática.
                </div>
              ) : (
                <div className="rounded-lg border border-slate-200 p-3 space-y-2.5 dark:border-slate-700">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-900 truncate dark:text-slate-100">
                      {docInspection.documentDetected}
                    </span>
                    <span
                      className={`text-[11px] font-semibold shrink-0 ${
                        docInspection.matchesDossier === 'CONFERE'
                          ? 'text-emerald-700 dark:text-emerald-300'
                          : docInspection.matchesDossier === 'DIVERGENCIA'
                          ? 'text-red-700 dark:text-red-300'
                          : 'text-amber-700 dark:text-amber-300'
                      }`}
                    >
                      {docInspection.matchesDossier === 'CONFERE'
                        ? 'Dados conferem'
                        : docInspection.matchesDossier === 'DIVERGENCIA'
                        ? 'Divergência detectada'
                        : 'Conferência manual'}
                    </span>
                  </div>
                  <p className="text-slate-600 leading-snug dark:text-slate-300">{docInspection.summary}</p>

                  {docInspection.extractedFields.length > 0 && (
                    <div className="divide-y divide-slate-100 border-t border-slate-100 pt-1 dark:divide-slate-800 dark:border-slate-800">
                      {docInspection.extractedFields.slice(0, 5).map((f, idx) => (
                        <div key={idx} className="py-1.5 flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="font-semibold text-slate-800 dark:text-slate-100">{f.label}</div>
                            <div className="text-[11px] text-slate-600 truncate dark:text-slate-300">
                              Doc: {f.foundInDoc}
                            </div>
                          </div>
                          <span
                            className={`text-[11px] font-semibold shrink-0 ${
                              f.match ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'
                            }`}
                          >
                            {f.match ? 'OK' : 'Diverge'}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {docInspection.alerts.length > 0 && (
                    <div className="rounded bg-amber-50 border border-amber-200 px-2.5 py-2 text-[11px] text-amber-900 space-y-1 dark:bg-amber-950/50 dark:border-amber-800/70 dark:text-amber-300">
                      {docInspection.alerts.map((al, i) => (
                        <div key={i}>{al}</div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 3. System Audit Rules Compliance */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-slate-900 dark:text-slate-100">
                  Regras de Auditoria do Sistema ({insights.ruleChecks.length})
                </h3>
                <span className="font-mono text-[10px] text-slate-400 dark:text-slate-400">Motor: {insights.provider}</span>
              </div>

              <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-700">
                {insights.ruleChecks.map((rule, idx) => (
                  <div key={`${rule.ruleCode}-${idx}`} className="p-2.5 flex items-start gap-2">
                    {rule.status === 'IMPEDITIVO' ? (
                      <ShieldAlert className="w-3.5 h-3.5 text-red-600 shrink-0 mt-0.5 dark:text-red-400" />
                    ) : rule.status === 'ATENCAO' ? (
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5 dark:text-amber-400" />
                    ) : (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5 dark:text-emerald-400" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-1">
                        <span className="font-semibold text-slate-900 dark:text-slate-100">{rule.ruleTitle}</span>
                        <span className="font-mono text-[10px] text-slate-400 dark:text-slate-400">{rule.ruleCode}</span>
                      </div>
                      <p className="text-[11px] text-slate-600 leading-snug mt-0.5 dark:text-slate-300">
                        {rule.explanation}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : (
          <div className="py-8 text-center text-slate-500 dark:text-slate-400">
            Selecione uma ficha ou clique em reanalisar para carregar os insights da Ivi.
          </div>
        )}
      </div>
    </div>
  );

  if (mode === 'modal') {
    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Painel de Insights Ivi"
        className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 dark:bg-slate-950/80"
      >
        {panelInner}
      </div>
    );
  }

  return (
    <aside aria-label="Painel Lateral de Insights Ivi" className="w-full">
      {panelInner}
    </aside>
  );
};
