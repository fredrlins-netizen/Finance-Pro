import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CheckCircle2, RefreshCw, Send, Sparkles } from 'lucide-react';
import { apiFetch } from '../../../lib/api.ts';
import {
  ensurePortalBrandingLoaded,
  getCachedLogoNeedsDarkBackdrop,
  getCachedPortalBranding,
  setCachedPortalBranding,
  subscribePortalBranding,
} from '../../../lib/portalBrandingCache.ts';
import type {
  CustomFormField,
  CustomFormItem,
  CustomFormSubmissionItem,
  PortalBrandingConfig,
  Unit,
} from '../../../types.ts';
import type {
  FormsAdmissionOption,
  FormsClientOption,
  FormsNegotiationOption,
} from './types.ts';

interface FormRunnerContainerProps {
  form: CustomFormItem;
  clients: FormsClientOption[];
  admissions: FormsAdmissionOption[];
  negotiations: FormsNegotiationOption[];
  units: Unit[];
  branding?: PortalBrandingConfig | null;
  onSubmitted: (submission: CustomFormSubmissionItem) => void;
  onBackToCatalog: () => void;
}

export const FormRunnerContainer: React.FC<FormRunnerContainerProps> = ({
  form,
  clients,
  admissions,
  negotiations,
  units,
  branding,
  onSubmitted,
  onBackToCatalog,
}) => {
  const [cachedBranding, setCachedBrandingState] = useState<PortalBrandingConfig | null>(() =>
    getCachedPortalBranding()
  );
  const [darkBackdrop, setDarkBackdrop] = useState<boolean>(() =>
    getCachedLogoNeedsDarkBackdrop()
  );

  useEffect(() => {
    if (branding) {
      setCachedPortalBranding(branding);
    } else {
      void ensurePortalBrandingLoaded();
    }
    return subscribePortalBranding((nextB, nextDark) => {
      setCachedBrandingState(nextB);
      setDarkBackdrop(nextDark);
    });
  }, [branding]);

  const activeBranding = branding || cachedBranding;

  const [clientId, setClientId] = useState<string>('');
  const [admissionId, setAdmissionId] = useState<string>('');
  const [negotiationId, setNegotiationId] = useState<string>('');
  const [unitId, setUnitId] = useState<string>(units[0] ? String(units[0].id) : '');
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [runIviAnalyze, setRunIviAnalyze] = useState<boolean>(
    form.settingsJson?.iviAutoAnalyze !== false
  );
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [receipt, setReceipt] = useState<CustomFormSubmissionItem | null>(null);

  const fields = useMemo(() => form.fieldsJson || [], [form.fieldsJson]);

  const filteredAdmissions = useMemo(
    () =>
      clientId
        ? admissions.filter((a) => String(a.clientId) === clientId)
        : admissions,
    [admissions, clientId]
  );

  const filteredNegotiations = useMemo(
    () =>
      clientId
        ? negotiations.filter((n) => String(n.clientId) === clientId)
        : negotiations,
    [negotiations, clientId]
  );

  const isFieldVisible = (fld: CustomFormField): boolean => {
    if (!fld.conditionalFieldId) return true;
    const parent = fields.find((pf) => pf.id === fld.conditionalFieldId);
    if (!parent) return true;
    const parentVal = String(answers[parent.key] ?? '');
    return parentVal === String(fld.conditionalEquals ?? '');
  };

  const setAnswer = (key: string, val: unknown) => {
    setAnswers((prev) => ({ ...prev, [key]: val }));
  };

  const toggleCheckboxOption = (key: string, opt: string) => {
    const curr = Array.isArray(answers[key]) ? (answers[key] as string[]) : [];
    if (curr.includes(opt)) {
      setAnswer(
        key,
        curr.filter((item) => item !== opt)
      );
    } else {
      setAnswer(key, [...curr, opt]);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSubmitting(true);
    try {
      const res = await apiFetch<{ submission: CustomFormSubmissionItem }>(
        `/api/forms/${form.id}/submissions`,
        {
          method: 'POST',
          body: JSON.stringify({
            clientId: clientId ? Number(clientId) : null,
            admissionId: admissionId ? Number(admissionId) : null,
            negotiationId: negotiationId ? Number(negotiationId) : null,
            unitId: unitId ? Number(unitId) : null,
            answersJson: answers,
            runIviAnalyze,
          }),
        }
      );
      setReceipt(res.submission);
      onSubmitted(res.submission);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao enviar respostas do formulário.');
    } finally {
      setSubmitting(false);
    }
  };

  if (receipt) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 max-w-2xl mx-auto text-center space-y-4">
        {activeBranding?.logoDataUrl && (
          <div className="flex justify-center">
            <div
              className={`inline-flex items-center justify-center rounded-xl border px-3.5 py-1.5 ${
                darkBackdrop
                  ? 'bg-slate-900 border-slate-800'
                  : 'bg-white border-slate-200'
              }`}
            >
              <img
                src={activeBranding.logoDataUrl}
                alt={activeBranding.companyName || 'Logomarca da Empresa'}
                className="h-11 max-w-[190px] w-auto object-contain"
              />
            </div>
          </div>
        )}
        <div className="h-12 w-12 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto">
          <CheckCircle2 className="w-6 h-6" />
        </div>
        <div>
          <div className="text-xs font-mono text-slate-500 tabular-nums">
            Protocolo {receipt.protocolCode}
          </div>
          <h2 className="font-display text-lg font-bold text-slate-900 mt-1">
            {form.settingsJson?.successMessage || 'Formulário protocolado com sucesso!'}
          </h2>
          {receipt.calculatedScore !== null && (
            <p className="text-xs text-slate-600 mt-1 font-mono tabular-nums">
              Pontuação apurada: <strong>{receipt.calculatedScore}%</strong>
            </p>
          )}
        </div>

        {receipt.iviSummary && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-left space-y-1">
            <div className="text-[11px] font-bold text-slate-800 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-blue-600" />
              Parecer Ivi IA ({receipt.iviClassification || 'Analisado'})
            </div>
            <p className="text-xs text-slate-700 leading-relaxed">{receipt.iviSummary}</p>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
          <button
            type="button"
            onClick={() => {
              setAnswers({});
              setReceipt(null);
            }}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50"
          >
            Novo Preenchimento
          </button>
          <button
            type="button"
            onClick={onBackToCatalog}
            className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800"
          >
            Voltar ao Catálogo
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-4xl mx-auto space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
        {activeBranding?.logoDataUrl && (
          <div className="flex justify-center pb-1">
            <div
              className={`inline-flex items-center justify-center rounded-xl border px-3.5 py-1.5 ${
                darkBackdrop
                  ? 'bg-slate-900 border-slate-800'
                  : 'bg-white border-slate-200'
              }`}
            >
              <img
                src={activeBranding.logoDataUrl}
                alt={activeBranding.companyName || 'Logomarca da Empresa'}
                className="h-11 max-w-[200px] w-auto object-contain"
              />
            </div>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
          <div>
            <div className="text-[11px] font-mono text-slate-500">
              {form.code} · v{form.version}
            </div>
            <h2 className="font-display text-base font-bold text-slate-900 mt-0.5">{form.title}</h2>
            {form.description && <p className="text-xs text-slate-600 mt-0.5">{form.description}</p>}
          </div>

          <button
            type="button"
            onClick={onBackToCatalog}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Voltar
          </button>
        </div>

        {/* Entity Context Linking */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs pb-2 border-b border-slate-100">
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">
              Cliente Vinculado
            </label>
            <select
              value={clientId}
              onChange={(e) => {
                setClientId(e.target.value);
                setAdmissionId('');
                setNegotiationId('');
              }}
              className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs bg-white"
            >
              <option value="">Sem vínculo direto</option>
              {clients.map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.fullName}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">
              Admissão / Dossiê
            </label>
            <select
              value={admissionId}
              onChange={(e) => setAdmissionId(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs bg-white"
            >
              <option value="">Opcional</option>
              {filteredAdmissions.map((a) => (
                <option key={a.id} value={String(a.id)}>
                  {a.protocolCode} · {a.bankName}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">
              Negociação Bancária
            </label>
            <select
              value={negotiationId}
              onChange={(e) => setNegotiationId(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs bg-white"
            >
              <option value="">Opcional</option>
              {filteredNegotiations.map((n) => (
                <option key={n.id} value={String(n.id)}>
                  #{n.id} · {n.bankName} ({n.contractNumber})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">
              Unidade
            </label>
            <select
              value={unitId}
              onChange={(e) => setUnitId(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs bg-white"
            >
              {units.map((u) => (
                <option key={u.id} value={String(u.id)}>
                  {u.code} · {u.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Dynamic Fields Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          {fields.map((fld) => {
            if (!isFieldVisible(fld)) return null;

            if (fld.type === 'section_header') {
              return (
                <div
                  key={fld.id}
                  className="md:col-span-2 pt-2 border-b border-slate-200 pb-1.5 text-xs font-bold text-slate-800"
                >
                  {fld.label}
                </div>
              );
            }

            const colSpan = fld.width === 'half' ? 'md:col-span-1' : 'md:col-span-2';
            const val = answers[fld.key];

            return (
              <div key={fld.id} className={`${colSpan} space-y-1.5`}>
                <label className="block text-xs font-semibold text-slate-800">
                  {fld.label}
                  {fld.required && <span className="text-rose-600 ml-1">*</span>}
                </label>

                {fld.helpText && <p className="text-[11px] text-slate-500">{fld.helpText}</p>}

                {fld.type === 'textarea' && (
                  <textarea
                    rows={3}
                    value={String(val || '')}
                    onChange={(e) => setAnswer(fld.key, e.target.value)}
                    placeholder={fld.placeholder || ''}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-blue-600 focus:outline-none"
                  />
                )}

                {(fld.type === 'text' ||
                  fld.type === 'cpf_cnpj' ||
                  fld.type === 'phone' ||
                  fld.type === 'email' ||
                  fld.type === 'file_note') && (
                  <input
                    type={fld.type === 'email' ? 'email' : 'text'}
                    value={String(val || '')}
                    onChange={(e) => setAnswer(fld.key, e.target.value)}
                    placeholder={fld.placeholder || ''}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-blue-600 focus:outline-none"
                  />
                )}

                {(fld.type === 'number' || fld.type === 'currency') && (
                  <input
                    type="number"
                    step={fld.type === 'currency' ? '0.01' : '1'}
                    value={String(val ?? '')}
                    onChange={(e) => setAnswer(fld.key, e.target.value)}
                    placeholder={fld.placeholder || (fld.type === 'currency' ? '0,00' : '0')}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono focus:border-blue-600 focus:outline-none"
                  />
                )}

                {fld.type === 'date' && (
                  <input
                    type="date"
                    value={String(val || '')}
                    onChange={(e) => setAnswer(fld.key, e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono focus:border-blue-600 focus:outline-none"
                  />
                )}

                {fld.type === 'select' && (
                  <select
                    value={String(val || '')}
                    onChange={(e) => setAnswer(fld.key, e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs bg-white focus:border-blue-600 focus:outline-none"
                  >
                    <option value="">Selecione...</option>
                    {(fld.options || []).map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                )}

                {fld.type === 'radio' && (
                  <div className="space-y-1.5 pt-1">
                    {(fld.options || []).map((opt) => (
                      <label key={opt} className="flex items-center gap-2 cursor-pointer text-slate-700">
                        <input
                          type="radio"
                          name={`radio_${fld.id}`}
                          checked={val === opt}
                          onChange={() => setAnswer(fld.key, opt)}
                        />
                        <span>{opt}</span>
                      </label>
                    ))}
                  </div>
                )}

                {fld.type === 'checkbox_group' && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pt-1">
                    {(fld.options || []).map((opt) => {
                      const checked = Array.isArray(val) && val.includes(opt);
                      return (
                        <label
                          key={opt}
                          className="flex items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-2 cursor-pointer hover:bg-slate-50"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleCheckboxOption(fld.key, opt)}
                            className="rounded border-slate-300"
                          />
                          <span className="text-slate-700">{opt}</span>
                        </label>
                      );
                    })}
                  </div>
                )}

                {fld.type === 'boolean' && (
                  <div className="inline-flex items-center gap-2 pt-0.5">
                    {[
                      { v: true, lbl: 'Sim' },
                      { v: false, lbl: 'Não' },
                    ].map((opt) => (
                      <button
                        key={opt.lbl}
                        type="button"
                        onClick={() => setAnswer(fld.key, opt.v)}
                        className={`rounded-lg border px-4 py-1.5 text-xs font-semibold transition-colors ${
                          val === opt.v
                            ? 'border-slate-900 bg-slate-900 text-white'
                            : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        {opt.lbl}
                      </button>
                    ))}
                  </div>
                )}

                {fld.type === 'rating' && (
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    {Array.from(
                      { length: (fld.maxRating || 5) === 10 ? 11 : fld.maxRating || 5 },
                      (_, i) => ((fld.maxRating || 5) === 10 ? i : i + 1)
                    ).map((num) => (
                      <button
                        key={num}
                        type="button"
                        onClick={() => setAnswer(fld.key, num)}
                        className={`min-w-[36px] h-9 rounded-lg border font-mono tabular-nums text-xs font-bold transition-colors ${
                          Number(val) === num
                            ? 'border-slate-900 bg-slate-900 text-white'
                            : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        {num}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {errorMsg && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            {errorMsg}
          </div>
        )}

        <div className="border-t border-slate-200 pt-4 flex flex-wrap items-center justify-between gap-3">
          <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={runIviAnalyze}
              onChange={(e) => setRunIviAnalyze(e.target.checked)}
              className="rounded border-slate-300"
            />
            Gerar classificação &amp; resumo automático pela Ivi IA
          </label>

          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {submitting ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                Protocolando...
              </>
            ) : (
              <>
                <Send className="w-4 h-4" />
                {form.settingsJson?.submitLabel || 'Enviar Resposta'}
              </>
            )}
          </button>
        </div>
      </div>
    </form>
  );
};
