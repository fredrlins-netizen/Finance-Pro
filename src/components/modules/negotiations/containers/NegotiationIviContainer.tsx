import React, { useState } from 'react';
import {
  AlertTriangle,
  Building2,
  Check,
  CheckCircle2,
  Copy,
  RefreshCw,
  Send,
  Sparkles,
  User,
} from 'lucide-react';
import { apiFetch, formatBRL } from '../../../../lib/api.ts';
import type { Negotiation, NegotiationIviAdvisorPayload } from '../../../../types.ts';

interface NegotiationIviContainerProps {
  negotiation: Negotiation;
  iviAdvisor: NegotiationIviAdvisorPayload | null;
  iviLoading: boolean;
  onRunIviAdvisor: () => Promise<void>;
  onUseDraftInWhatsapp: (target: 'CLIENTE' | 'BANCO', draft: string) => void;
  showToast: (msg: string) => void;
}

export const NegotiationIviContainer: React.FC<NegotiationIviContainerProps> = ({
  negotiation,
  iviAdvisor,
  iviLoading,
  onRunIviAdvisor,
  onUseDraftInWhatsapp,
  showToast,
}) => {
  const [iviQuestion, setIviQuestion] = useState('');
  const [iviAnswer, setIviAnswer] = useState('');
  const [iviAsking, setIviAsking] = useState(false);
  const [copiedDraft, setCopiedDraft] = useState<string | null>(null);

  const handleCopyText = (text: string, label: string) => {
    void navigator.clipboard?.writeText(text);
    setCopiedDraft(label);
    window.setTimeout(() => setCopiedDraft(null), 2000);
    showToast(`Minuta copiada: ${label}`);
  };

  const handleAskIvi = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!iviQuestion.trim()) return;
    setIviAsking(true);
    try {
      const res = await apiFetch<{ answer: string }>(`/api/negotiations/${negotiation.id}/ivi-ask`, {
        method: 'POST',
        body: JSON.stringify({ question: iviQuestion }),
      });
      setIviAnswer(res.answer);
    } catch {
      showToast('Erro ao consultar a Ivi IA.');
    } finally {
      setIviAsking(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 text-white flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-purple-500/20 border border-purple-400/30 p-2">
            <Sparkles className="w-5 h-5 text-purple-300" />
          </div>
          <div>
            <h3 className="font-display text-sm font-bold">
              Ivi IA · Assessora Estratégica de Negociação
            </h3>
            <p className="text-xs text-slate-300">
              Cruzamento de alçadas do {negotiation.bankName}, propostas e resumo dos canais WhatsApp.
            </p>
          </div>
        </div>
        <button
          type="button"
          disabled={iviLoading}
          onClick={() => void onRunIviAdvisor()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-purple-600 px-4 py-2 text-xs font-semibold text-white hover:bg-purple-500 disabled:opacity-50 whitespace-nowrap"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${iviLoading ? 'animate-spin' : ''}`} />
          {iviLoading ? 'Analisando Dossiê...' : 'Gerar / Atualizar Diagnóstico'}
        </button>
      </div>

      {!iviAdvisor ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center space-y-3">
          <Sparkles className="w-8 h-8 text-purple-600 mx-auto" />
          <div className="text-sm font-bold text-slate-800">
            Gere o Diagnóstico Estratégico da Ivi IA
          </div>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            A Ivi lê os contatos do banco, conversas de WhatsApp com Cliente e Banco e regras de alçada para sugerir a contraproposta ideal.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          <div className="lg:col-span-7 space-y-4">
            <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <h4 className="font-display text-xs font-bold uppercase tracking-wider text-slate-800">
                  Diagnóstico Estratégico & Meta Recomendada
                </h4>
                <span className="font-mono text-[10px] text-slate-500">Motor: {iviAdvisor.provider}</span>
              </div>
              <p className="text-xs text-slate-700 leading-relaxed">{iviAdvisor.strategicDiagnosis}</p>

              <div className="grid grid-cols-3 divide-x divide-slate-200 rounded-lg border border-slate-200 bg-slate-50 text-xs font-mono tabular-nums">
                <div className="p-2.5">
                  <span className="font-sans text-[10px] text-slate-500 block">Deságio Alvo</span>
                  <strong className="text-sm text-emerald-700">{iviAdvisor.recommendedDiscountPct}%</strong>
                </div>
                <div className="p-2.5">
                  <span className="font-sans text-[10px] text-slate-500 block">Valor Alvo</span>
                  <strong className="text-sm text-slate-900">
                    {formatBRL(iviAdvisor.recommendedTargetValueCents)}
                  </strong>
                </div>
                <div className="p-2.5">
                  <span className="font-sans text-[10px] text-slate-500 block">Parcelamento</span>
                  <strong className="text-sm text-blue-700">Até {iviAdvisor.recommendedInstallments}x</strong>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-1.5">
                <div className="text-[11px] font-bold uppercase text-blue-700 flex items-center gap-1.5">
                  <Building2 className="w-3.5 h-3.5" /> Resumo WhatsApp Banco
                </div>
                <p className="text-xs text-slate-700 leading-relaxed">{iviAdvisor.summaryBank}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-1.5">
                <div className="text-[11px] font-bold uppercase text-emerald-700 flex items-center gap-1.5">
                  <User className="w-3.5 h-3.5" /> Resumo WhatsApp Cliente
                </div>
                <p className="text-xs text-slate-700 leading-relaxed">{iviAdvisor.summaryClient}</p>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2.5">
              <h4 className="font-display text-xs font-bold uppercase tracking-wider text-slate-800">
                Próximas Melhores Ações & Alertas
              </h4>
              <ul className="space-y-1.5 text-xs text-slate-700">
                {iviAdvisor.nextBestActions.map((act, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                    <span>{act}</span>
                  </li>
                ))}
              </ul>
              {iviAdvisor.riskAlerts?.length > 0 && (
                <div className="pt-2 border-t border-slate-100 space-y-1">
                  {iviAdvisor.riskAlerts.map((al, i) => (
                    <div key={i} className="flex items-start gap-1.5 text-xs text-amber-800">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                      <span>{al}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="lg:col-span-5 space-y-4">
            <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
              <h4 className="font-display text-xs font-bold uppercase tracking-wider text-slate-800">
                Minutas Prontas para WhatsApp
              </h4>

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
                <div className="flex items-center justify-between text-[11px] font-bold text-blue-900">
                  <span>Mensagem para Contato do Banco</span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleCopyText(iviAdvisor.suggestedBankWhatsappDraft, 'Banco')}
                      className="inline-flex items-center gap-1 text-[10px] font-semibold text-blue-700 hover:underline"
                    >
                      {copiedDraft === 'Banco' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                      Copiar
                    </button>
                    <button
                      type="button"
                      onClick={() => onUseDraftInWhatsapp('BANCO', iviAdvisor.suggestedBankWhatsappDraft)}
                      className="text-[10px] font-semibold text-emerald-700 hover:underline"
                    >
                      Abrir no Chat →
                    </button>
                  </div>
                </div>
                <p className="text-xs text-slate-700 leading-relaxed">{iviAdvisor.suggestedBankWhatsappDraft}</p>
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
                <div className="flex items-center justify-between text-[11px] font-bold text-emerald-900">
                  <span>Mensagem para o Cliente</span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleCopyText(iviAdvisor.suggestedClientWhatsappDraft, 'Cliente')}
                      className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 hover:underline"
                    >
                      {copiedDraft === 'Cliente' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                      Copiar
                    </button>
                    <button
                      type="button"
                      onClick={() => onUseDraftInWhatsapp('CLIENTE', iviAdvisor.suggestedClientWhatsappDraft)}
                      className="text-[10px] font-semibold text-blue-700 hover:underline"
                    >
                      Abrir no Chat →
                    </button>
                  </div>
                </div>
                <p className="text-xs text-slate-700 leading-relaxed">{iviAdvisor.suggestedClientWhatsappDraft}</p>
              </div>
            </div>

            <form onSubmit={handleAskIvi} className="rounded-xl border border-slate-200 bg-white p-4 space-y-2.5">
              <h4 className="font-display text-xs font-bold uppercase tracking-wider text-slate-800">
                Perguntar à Assessora Ivi IA
              </h4>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={iviQuestion}
                  onChange={(e) => setIviQuestion(e.target.value)}
                  placeholder="Ex: Qual valor mínimo podemos propor à vista?"
                  className="flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
                />
                <button
                  type="submit"
                  disabled={iviAsking || !iviQuestion.trim()}
                  className="inline-flex items-center gap-1 rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-purple-700 disabled:opacity-50 whitespace-nowrap"
                >
                  <Send className="w-3 h-3" />
                  {iviAsking ? '...' : 'Perguntar'}
                </button>
              </div>
              {iviAnswer && (
                <div className="rounded-lg border border-purple-200 bg-purple-50/40 p-3 text-xs text-slate-800 leading-relaxed whitespace-pre-wrap">
                  {iviAnswer}
                </div>
              )}
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
