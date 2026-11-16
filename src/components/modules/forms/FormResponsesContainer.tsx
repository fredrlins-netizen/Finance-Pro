import React, { useMemo, useState } from 'react';
import { Download, Eye, RefreshCw, Search, Sparkles, X } from 'lucide-react';
import { apiFetch, formatDateBR } from '../../../lib/api.ts';
import type { CustomFormItem, CustomFormSubmissionItem } from '../../../types.ts';
import { SUBMISSION_STATUS_CONFIG } from './types.ts';

interface FormResponsesContainerProps {
  forms: CustomFormItem[];
  submissions: CustomFormSubmissionItem[];
  selectedFormFilter: string;
  onFormFilterChange: (val: string) => void;
  onSubmissionUpdated: (updated: CustomFormSubmissionItem) => void;
  onExportCsv: (formId: number) => void;
}

export const FormResponsesContainer: React.FC<FormResponsesContainerProps> = ({
  forms,
  submissions,
  selectedFormFilter,
  onFormFilterChange,
  onSubmissionUpdated,
  onExportCsv,
}) => {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('TODOS');
  const [activeSub, setActiveSub] = useState<CustomFormSubmissionItem | null>(null);
  const [reviewStatus, setReviewStatus] = useState<string>('aprovado');
  const [reviewNotes, setReviewNotes] = useState<string>('');
  const [savingReview, setSavingReview] = useState(false);
  const [analyzingIvi, setAnalyzingIvi] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return submissions.filter((s) => {
      if (selectedFormFilter !== 'TODOS' && String(s.formId) !== selectedFormFilter) return false;
      if (statusFilter !== 'TODOS' && s.status !== statusFilter) return false;
      if (q) {
        const hay =
          `${s.protocolCode} ${s.formTitle || ''} ${s.clientName || ''} ${s.submittedByName || ''} ${s.iviClassification || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [submissions, selectedFormFilter, statusFilter, search]);

  const activeForm = useMemo(
    () => (activeSub ? forms.find((f) => f.id === activeSub.formId) || null : null),
    [activeSub, forms]
  );

  const openModal = (sub: CustomFormSubmissionItem) => {
    setActiveSub(sub);
    setReviewStatus(sub.status === 'recebido' ? 'aprovado' : sub.status);
    setReviewNotes(sub.reviewedNotes || '');
  };

  const handleSaveTriage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeSub) return;
    setSavingReview(true);
    try {
      const res = await apiFetch<{ submission: CustomFormSubmissionItem }>(
        `/api/forms/submissions/${activeSub.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ status: reviewStatus, reviewedNotes: reviewNotes }),
        }
      );
      const merged = {
        ...activeSub,
        ...res.submission,
      };
      setActiveSub(merged);
      onSubmissionUpdated(merged);
    } finally {
      setSavingReview(false);
    }
  };

  const handleRunIviAnalyze = async () => {
    if (!activeSub) return;
    setAnalyzingIvi(true);
    try {
      const res = await apiFetch<{ submission: CustomFormSubmissionItem }>(
        `/api/forms/submissions/${activeSub.id}/ivi-analyze`,
        { method: 'POST', body: JSON.stringify({}) }
      );
      const merged = { ...activeSub, ...res.submission };
      setActiveSub(merged);
      onSubmissionUpdated(merged);
    } finally {
      setAnalyzingIvi(false);
    }
  };

  const exportTargetFormId =
    selectedFormFilter !== 'TODOS'
      ? Number(selectedFormFilter)
      : forms[0]?.id || 0;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden dark:border-slate-700 dark:bg-slate-900">
        {/* Filters */}
        <div className="p-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 dark:border-slate-700">
          <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[260px]">
            <div className="relative w-full sm:w-64">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 dark:text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar protocolo, cliente ou operador..."
                className="w-full rounded-lg border border-slate-300 pl-8 pr-3 py-1.5 text-xs focus:border-blue-600 focus:outline-none dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>

            <select
              value={selectedFormFilter}
              onChange={(e) => onFormFilterChange(e.target.value)}
              className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs bg-white max-w-xs dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
            >
              <option value="TODOS">Todos os formulários</option>
              {forms.map((f) => (
                <option key={f.id} value={String(f.id)}>
                  {f.code} · {f.title}
                </option>
              ))}
            </select>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs bg-white dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
            >
              <option value="TODOS">Todos os status</option>
              {Object.entries(SUBMISSION_STATUS_CONFIG).map(([k, cfg]) => (
                <option key={k} value={k}>
                  {cfg.label}
                </option>
              ))}
            </select>
          </div>

          {exportTargetFormId > 0 && (
            <button
              type="button"
              onClick={() => onExportCsv(exportTargetFormId)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <Download className="w-3.5 h-3.5" />
              Exportar CSV
            </button>
          )}
        </div>

        {/* Desktop Table */}
        <div className="hidden lg:block overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-500 dark:bg-slate-800/70 dark:border-slate-700 dark:text-slate-400">
              <tr>
                <th className="py-2.5 px-4">Protocolo &amp; Data</th>
                <th className="py-2.5 px-3">Formulário</th>
                <th className="py-2.5 px-3">Cliente</th>
                <th className="py-2.5 px-3">Responsável</th>
                <th className="py-2.5 px-3 text-right">Score</th>
                <th className="py-2.5 px-3">Classificação Ivi</th>
                <th className="py-2.5 px-3">Status</th>
                <th className="py-2.5 px-4 text-right">Consultar</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs dark:divide-slate-800">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-slate-500 dark:text-slate-400">
                    Nenhuma resposta protocolada com os filtros selecionados.
                  </td>
                </tr>
              ) : (
                filtered.map((s) => {
                  const stCfg = SUBMISSION_STATUS_CONFIG[s.status] || SUBMISSION_STATUS_CONFIG.recebido;
                  return (
                    <tr
                      key={s.id}
                      onClick={() => openModal(s)}
                      className="hover:bg-slate-50 cursor-pointer transition-colors dark:hover:bg-slate-800"
                    >
                      <td className="py-2.5 px-4 font-mono tabular-nums text-[11px]">
                        <div className="font-semibold text-slate-900 dark:text-slate-100">{s.protocolCode}</div>
                        <div className="text-slate-500 dark:text-slate-400">{formatDateBR(s.createdAt)}</div>
                      </td>
                      <td className="py-2.5 px-3 font-medium text-slate-900 max-w-[240px] truncate dark:text-slate-100">
                        {s.formTitle || `Formulário #${s.formId}`}
                      </td>
                      <td className="py-2.5 px-3 text-slate-700 dark:text-slate-200">{s.clientName || '—'}</td>
                      <td className="py-2.5 px-3 text-slate-600 dark:text-slate-300">{s.submittedByName}</td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                        {s.calculatedScore !== null && s.calculatedScore !== undefined
                          ? `${s.calculatedScore}%`
                          : '—'}
                      </td>
                      <td className="py-2.5 px-3 text-slate-700 truncate max-w-[180px] dark:text-slate-200">
                        {s.iviClassification || '—'}
                      </td>
                      <td className="py-2.5 px-3">
                        <span className={`font-semibold ${stCfg.textClass}`}>{stCfg.label}</span>
                      </td>
                      <td className="py-2.5 px-4 text-right">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            openModal(s);
                          }}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                        >
                          <Eye className="w-3 h-3" />
                          Analisar
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile Cards */}
        <div className="lg:hidden divide-y divide-slate-100 dark:divide-slate-800">
          {filtered.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">
              Nenhuma resposta encontrada para consulta.
            </div>
          ) : (
            filtered.map((s) => {
              const stCfg = SUBMISSION_STATUS_CONFIG[s.status] || SUBMISSION_STATUS_CONFIG.recebido;
              return (
                <div
                  key={s.id}
                  onClick={() => openModal(s)}
                  className="p-4 space-y-2 hover:bg-slate-50 cursor-pointer dark:hover:bg-slate-800"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-mono text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
                        {s.protocolCode} · {formatDateBR(s.createdAt)}
                      </div>
                      <h3 className="font-semibold text-xs text-slate-900 mt-0.5 dark:text-slate-100">
                        {s.formTitle || `Formulário #${s.formId}`}
                      </h3>
                    </div>
                    <span className={`text-xs font-semibold ${stCfg.textClass}`}>{stCfg.label}</span>
                  </div>
                  <div className="text-xs text-slate-600 dark:text-slate-300">
                    Cliente: <strong>{s.clientName || '—'}</strong> · Resp: {s.submittedByName}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Submission Inspection & Triage Modal */}
      {activeSub && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-3 sm:p-4 overflow-y-auto dark:bg-slate-950/80"
          onClick={() => setActiveSub(null)}
        >
          <div
            className="w-full max-w-3xl rounded-xl border border-slate-200 bg-white shadow-2xl overflow-hidden flex flex-col max-h-[92vh] dark:border-slate-700 dark:bg-slate-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 bg-slate-900 px-5 py-3.5 text-white shrink-0 dark:bg-emerald-600">
              <div>
                <div className="text-[11px] font-mono tabular-nums text-slate-300">
                  {activeSub.protocolCode} · {formatDateBR(activeSub.createdAt)}
                </div>
                <h3 className="font-display text-sm font-bold">
                  {activeSub.formTitle || `Formulário #${activeSub.formId}`}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setActiveSub(null)}
                className="rounded-lg p-1.5 text-slate-300 hover:bg-slate-800 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
              <div className="flex flex-wrap items-center gap-3 text-slate-600 border-b border-slate-100 pb-3 dark:text-slate-300 dark:border-slate-800">
                <span>
                  Cliente: <strong className="text-slate-900 dark:text-slate-100">{activeSub.clientName || '—'}</strong>
                </span>
                <span>·</span>
                <span>
                  Enviado por: <strong className="text-slate-900 dark:text-slate-100">{activeSub.submittedByName}</strong>
                </span>
                {activeSub.calculatedScore !== null && (
                  <>
                    <span>·</span>
                    <span className="font-mono tabular-nums">
                      Score: <strong className="text-slate-900 dark:text-slate-100">{activeSub.calculatedScore}%</strong>
                    </span>
                  </>
                )}
              </div>

              {/* Ivi IA Diagnostic Box */}
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 space-y-2 dark:border-slate-700 dark:bg-slate-800/70">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-slate-900 flex items-center gap-1.5 dark:text-slate-100">
                    <Sparkles className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                    Análise &amp; Síntese da Ivi IA
                    {activeSub.iviClassification ? ` · ${activeSub.iviClassification}` : ''}
                  </span>
                  <button
                    type="button"
                    disabled={analyzingIvi}
                    onClick={() => void handleRunIviAnalyze()}
                    className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    <RefreshCw className={`w-3 h-3 ${analyzingIvi ? 'animate-spin' : ''}`} />
                    {activeSub.iviSummary ? 'Reanalisar' : 'Analisar com Ivi'}
                  </button>
                </div>
                <p className="text-xs text-slate-700 leading-relaxed dark:text-slate-200">
                  {activeSub.iviSummary ||
                    'Clique em "Analisar com Ivi" para gerar uma síntese executiva e próxima ação recomendada.'}
                </p>
              </div>

              {/* Answers List */}
              <div className="space-y-2">
                <div className="font-semibold text-slate-800 dark:text-slate-100">Respostas Registradas</div>
                <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-700">
                  {(activeForm?.fieldsJson || []).filter((f) => f.type !== 'section_header').length > 0
                    ? (activeForm?.fieldsJson || [])
                        .filter((f) => f.type !== 'section_header')
                        .map((fld) => {
                          const raw = activeSub.answersJson?.[fld.key];
                          const formatted =
                            typeof raw === 'boolean'
                              ? raw
                                ? 'Sim'
                                : 'Não'
                              : Array.isArray(raw)
                              ? raw.join(', ')
                              : raw !== undefined && raw !== null && raw !== ''
                              ? String(raw)
                              : '—';
                          return (
                            <div key={fld.id} className="px-3.5 py-2.5 grid grid-cols-1 sm:grid-cols-12 gap-1.5">
                              <div className="sm:col-span-5 text-slate-500 font-medium dark:text-slate-400">{fld.label}</div>
                              <div className="sm:col-span-7 text-slate-900 font-semibold whitespace-pre-wrap dark:text-slate-100">
                                {formatted}
                              </div>
                            </div>
                          );
                        })
                    : Object.entries(activeSub.answersJson || {}).map(([k, v]) => (
                        <div key={k} className="px-3.5 py-2.5 grid grid-cols-1 sm:grid-cols-12 gap-1.5">
                          <div className="sm:col-span-5 text-slate-500 font-mono dark:text-slate-400">{k}</div>
                          <div className="sm:col-span-7 text-slate-900 font-semibold dark:text-slate-100">
                            {Array.isArray(v) ? v.join(', ') : String(v ?? '—')}
                          </div>
                        </div>
                      ))}
                </div>
              </div>

              {/* Triage Review Form */}
              <form
                onSubmit={handleSaveTriage}
                className="border-t border-slate-200 pt-3 space-y-3 dark:border-slate-700"
              >
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1 dark:text-slate-300">
                      Status da Triagem
                    </label>
                    <select
                      value={reviewStatus}
                      onChange={(e) => setReviewStatus(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs bg-white dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                    >
                      {Object.entries(SUBMISSION_STATUS_CONFIG).map(([k, cfg]) => (
                        <option key={k} value={k}>
                          {cfg.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1 dark:text-slate-300">
                      Parecer / Observação da Análise
                    </label>
                    <input
                      type="text"
                      value={reviewNotes}
                      onChange={(e) => setReviewNotes(e.target.value)}
                      placeholder="Registre o encaminhamento ou pendência identificada..."
                      className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs dark:border-slate-600"
                    />
                  </div>
                </div>
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={savingReview}
                    className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-emerald-600 dark:hover:bg-emerald-500"
                  >
                    {savingReview ? 'Salvando...' : 'Atualizar Triagem'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
