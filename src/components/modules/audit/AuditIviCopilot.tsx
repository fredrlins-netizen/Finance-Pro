import React, { useState } from 'react';
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  FileWarning,
  Loader2,
  MessageSquareText,
  RefreshCw,
  Send,
  ShieldAlert,
} from 'lucide-react';
import { apiFetch, formatDateTimeBR } from '../../../lib/api.ts';
import { IviAuditAnalysisSnapshot } from '../../../types.ts';

interface AuditIviCopilotProps {
  admissionId: number;
  protocolCode: string;
  initialAnalysis: IviAuditAnalysisSnapshot | null | undefined;
  onAnalysisComplete: (analysis: IviAuditAnalysisSnapshot) => void;
  onApplyCritiqueDraft: (draftText: string) => void;
  onGoToDocs: () => void;
}

const VERDICT_STYLES: Record<
  IviAuditAnalysisSnapshot['verdict'],
  { label: string; border: string; bg: string; text: string; Icon: React.ComponentType<{ className?: string }> }
> = {
  APROVAR: {
    label: 'Pronta para Aprovação',
    border: 'border-emerald-200',
    bg: 'bg-emerald-50/70',
    text: 'text-emerald-800',
    Icon: CheckCircle2,
  },
  CONFERIR_PONTOS: {
    label: 'Requer Conferência Pontual',
    border: 'border-amber-200',
    bg: 'bg-amber-50/70',
    text: 'text-amber-800',
    Icon: AlertTriangle,
  },
  DEVOLVER_COMERCIAL: {
    label: 'Recomenda Devolução ao Comercial',
    border: 'border-red-200',
    bg: 'bg-red-50/70',
    text: 'text-red-800',
    Icon: ShieldAlert,
  },
};

export const AuditIviCopilot: React.FC<AuditIviCopilotProps> = ({
  admissionId,
  protocolCode,
  initialAnalysis,
  onAnalysisComplete,
  onApplyCritiqueDraft,
  onGoToDocs,
}) => {
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState('');
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [qaHistory, setQaHistory] = useState<Array<{ q: string; a: string; provider: string }>>([]);

  const handleAnalyze = async (forceAi = false) => {
    setAnalyzing(true);
    setAnalysisError('');
    try {
      const res = await apiFetch<{ analysis: IviAuditAnalysisSnapshot }>(
        `/api/audit/${admissionId}/ivi-analyze`,
        { method: 'POST', body: JSON.stringify({ forceAi }) }
      );
      onAnalysisComplete(res.analysis);
    } catch (err) {
      setAnalysisError(err instanceof Error ? err.message : 'Não foi possível consultar a Ivi.');
    } finally {
      setAnalyzing(false);
    }
  };

  const handleAsk = async (qText?: string) => {
    const prompt = (qText ?? question).trim();
    if (!prompt) return;
    setAsking(true);
    setAnalysisError('');
    try {
      const res = await apiFetch<{ answer: string; provider: string }>(
        `/api/audit/${admissionId}/ivi-ask`,
        { method: 'POST', body: JSON.stringify({ question: prompt }) }
      );
      setQaHistory((prev) => [{ q: prompt, a: res.answer, provider: res.provider }, ...prev]);
      if (!qText) setQuestion('');
    } catch (err) {
      setAnalysisError(err instanceof Error ? err.message : 'Erro ao perguntar para a Ivi.');
    } finally {
      setAsking(false);
    }
  };

  const verdictStyle = initialAnalysis ? VERDICT_STYLES[initialAnalysis.verdict] || VERDICT_STYLES.CONFERIR_PONTOS : null;
  const checklistReportItems = initialAnalysis?.checklistItemsChecked || [];
  const inconsistenciesCount =
    initialAnalysis?.inconsistenciesCount ??
    checklistReportItems.filter((i) => i.classification === 'INCONSISTENCIA').length;
  const attentionCount =
    initialAnalysis?.attentionMeasuresCount ??
    checklistReportItems.filter((i) => i.classification === 'MEDIDA_ATENCAO').length;

  return (
    <section
      aria-label="Assistente Ivi para Análise de Auditoria"
      className="rounded-xl border border-slate-200 bg-white p-4 space-y-3.5"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 border-b border-slate-100 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-slate-900 text-white flex items-center justify-center shrink-0">
            <Bot className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900">
              Ivi · Verificação de Checklist &amp; Apoio à Decisão
            </h3>
            <p className="text-xs text-slate-500">
              {initialAnalysis
                ? `Última verificação de ${protocolCode} em ${formatDateTimeBR(initialAnalysis.analyzedAt)} · ${
                    initialAnalysis.fromDatabaseCache
                      ? `Decisão recuperada da base (0 custo IA · ${initialAnalysis.aiCallsSaved || 1} reuso(s))`
                      : initialAnalysis.provider === 'local_rules_db'
                      ? 'Regras locais gravadas em base (0 custo IA)'
                      : `Validado com ${initialAnalysis.provider} e salvo em base`
                  }`
                : `Verifique automaticamente inconsistências e medidas de atenção do protocolo ${protocolCode} usando a base do aplicativo.`}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            disabled={analyzing}
            onClick={() => handleAnalyze(false)}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap min-h-[38px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
          >
            {analyzing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Verificar Checklist (Base)
          </button>
          <button
            type="button"
            disabled={analyzing}
            onClick={() => handleAnalyze(true)}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap min-h-[38px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
          >
            {analyzing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Bot className="w-3.5 h-3.5" />}
            {analyzing ? 'Analisando...' : 'Reanalisar c/ IA'}
          </button>
        </div>
      </div>

      {analysisError && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-800"
        >
          {analysisError}
        </div>
      )}

      {initialAnalysis && verdictStyle && (
        <div className="space-y-3">
          {/* Structured Verdict Summary */}
          <div className={`rounded-lg border ${verdictStyle.border} ${verdictStyle.bg} p-3.5 space-y-2`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className={`inline-flex items-center gap-1.5 text-xs font-bold ${verdictStyle.text}`}>
                <verdictStyle.Icon className="w-4 h-4 shrink-0" />
                <span>Parecer Ivi: {initialAnalysis.verdictLabel || verdictStyle.label}</span>
              </div>
              <div className="font-mono text-[11px] text-slate-600 flex items-center gap-2">
                <span className={inconsistenciesCount > 0 ? 'font-bold text-red-700' : 'text-emerald-700'}>
                  {inconsistenciesCount} inconsistência(s)
                </span>
                <span className="text-slate-300">·</span>
                <span className={attentionCount > 0 ? 'font-bold text-amber-800' : 'text-slate-600'}>
                  {attentionCount} medida(s) de atenção
                </span>
              </div>
            </div>
            <p className="text-xs text-slate-800 leading-relaxed">
              {initialAnalysis.executiveSummary}
            </p>
            <p className="text-xs font-semibold text-slate-700">
              Próximo passo sugerido: {initialAnalysis.nextStepRecommendation}
            </p>
          </div>

          {/* Checklist Verification Matrix: Inconsistências vs Medidas de Atenção */}
          {checklistReportItems.length > 0 && (
            <div className="rounded-lg border border-slate-200 overflow-hidden">
              <div className="px-3.5 py-2 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                <span className="font-bold text-slate-900">
                  Auditoria Automática do Checklist &amp; Regras ({checklistReportItems.length} verificação(ões))
                </span>
                <span className="font-mono text-slate-500">
                  Motor: {initialAnalysis.fromDatabaseCache ? 'Base de Dados (Cache)' : initialAnalysis.provider}
                </span>
              </div>
              <div className="divide-y divide-slate-100 max-h-64 overflow-y-auto">
                {checklistReportItems.map((item, idx) => (
                  <div key={`${item.ruleCode}-${idx}`} className="px-3.5 py-2.5 flex items-start gap-2.5 text-xs">
                    {item.classification === 'INCONSISTENCIA' ? (
                      <ShieldAlert className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                    ) : item.classification === 'MEDIDA_ATENCAO' ? (
                      <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    ) : (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                    )}
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="flex flex-wrap items-center justify-between gap-1.5">
                        <span className="font-semibold text-slate-900">{item.ruleTitle}</span>
                        <span
                          className={`text-[11px] font-bold ${
                            item.classification === 'INCONSISTENCIA'
                              ? 'text-red-700'
                              : item.classification === 'MEDIDA_ATENCAO'
                              ? 'text-amber-800'
                              : 'text-emerald-700'
                          }`}
                        >
                          {item.classification === 'INCONSISTENCIA'
                            ? 'Inconsistência'
                            : item.classification === 'MEDIDA_ATENCAO'
                            ? 'Medida de Atenção'
                            : 'Conforme'}
                        </span>
                      </div>
                      <p className="text-slate-600 leading-snug">{item.detail}</p>
                      {item.recommendedAction && item.classification !== 'CONFORME' && (
                        <p className="text-[11px] font-medium text-slate-800">
                          Ação sugerida: {item.recommendedAction}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Detailed Verification Points (fallback / supplemental AI findings) */}
          {initialAnalysis.keyFindings.length > 0 && checklistReportItems.length === 0 && (
            <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {initialAnalysis.keyFindings.map((finding, idx) => (
                <div key={`${finding.category}-${idx}`} className="px-3.5 py-2.5 flex items-start gap-2.5 text-xs">
                  {finding.severity === 'critico' ? (
                    <ShieldAlert className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                  ) : finding.severity === 'atencao' ? (
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-semibold text-slate-900">{finding.title}</span>
                      <span className="text-slate-400">·</span>
                      <span className="text-[11px] font-medium text-slate-500">{finding.category}</span>
                    </div>
                    <p className="mt-0.5 text-slate-600 leading-snug">{finding.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Missing docs shortcut + Critique Draft shortcut */}
          {(initialAnalysis.missingDocs.length > 0 || initialAnalysis.suggestedCritiqueDraft) && (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs">
              <div className="flex items-start gap-2 text-slate-700 min-w-0">
                <FileWarning className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                <div className="min-w-0">
                  {initialAnalysis.missingDocs.length > 0 && (
                    <div>
                      <span className="font-semibold text-slate-900">Pendências detectadas:</span>{' '}
                      {initialAnalysis.missingDocs.join(', ')}
                    </div>
                  )}
                  {initialAnalysis.suggestedCritiqueDraft && (
                    <div className="text-slate-600 mt-0.5 line-clamp-2">
                      Rascunho de devolução pronto para revisão do auditor.
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {initialAnalysis.missingDocs.length > 0 && (
                  <button
                    type="button"
                    onClick={onGoToDocs}
                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 whitespace-nowrap min-h-[36px]"
                  >
                    Conferir Anexos
                  </button>
                )}
                {initialAnalysis.suggestedCritiqueDraft && (
                  <button
                    type="button"
                    onClick={() => onApplyCritiqueDraft(initialAnalysis.suggestedCritiqueDraft)}
                    className="rounded-lg border border-red-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 whitespace-nowrap min-h-[36px]"
                  >
                    Usar Rascunho na Devolução
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Quick Dossier Q&A with Ivi */}
      <div className="pt-1 space-y-2">
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className="font-semibold text-slate-500 flex items-center gap-1">
            <MessageSquareText className="w-3.5 h-3.5" />
            Perguntar à Ivi:
          </span>
          {[
            'Resumir pontos de atenção desta ficha',
            'Os valores e parcelas estão coerentes?',
            'Sugerir justificativa objetiva de devolução',
          ].map((preset) => (
            <button
              key={preset}
              type="button"
              disabled={asking}
              onClick={() => handleAsk(preset)}
              className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap"
            >
              {preset}
            </button>
          ))}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleAsk();
          }}
          className="flex gap-2"
        >
          <label htmlFor={`ivi-ask-${admissionId}`} className="sr-only">
            Perguntar à Ivi sobre este dossiê
          </label>
          <input
            id={`ivi-ask-${admissionId}`}
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ex: Este contrato de terceiro exige algum cuidado na procuração?"
            className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 min-h-[40px]"
          />
          <button
            type="submit"
            disabled={asking || !question.trim()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-100 disabled:opacity-50 whitespace-nowrap shrink-0 min-h-[40px]"
          >
            {asking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            Consultar Ivi
          </button>
        </form>

        {qaHistory.length > 0 && (
          <div className="space-y-2 max-h-48 overflow-y-auto pt-1">
            {qaHistory.map((item, idx) => (
              <div key={idx} className="rounded-lg border border-slate-200 bg-slate-50/70 p-2.5 text-xs space-y-1">
                <div className="font-semibold text-slate-800">Você: {item.q}</div>
                <div className="text-slate-700 leading-relaxed whitespace-pre-line">{item.a}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
};
