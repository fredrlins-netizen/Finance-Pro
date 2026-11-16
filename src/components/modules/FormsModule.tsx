import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ClipboardList,
  Database,
  FilePlus2,
  FileText,
  Maximize2,
  Minimize2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Wrench,
  X,
} from 'lucide-react';
import { apiFetch, getAuthToken } from '../../lib/api.ts';
import {
  ensurePortalBrandingLoaded,
  getCachedLogoNeedsDarkBackdrop,
  getCachedPortalBranding,
  setCachedPortalBranding,
  subscribePortalBranding,
} from '../../lib/portalBrandingCache.ts';
import type {
  CustomFormField,
  CustomFormItem,
  CustomFormSettings,
  CustomFormSubmissionItem,
  ModuleId,
  NavigationIntent,
  PortalBrandingConfig,
  Unit,
} from '../../types.ts';
import { ConfirmDeleteModal } from './CollectionCoordinatorModalViews.tsx';
import type { FormsBootstrapPayload } from './forms/types.ts';
import { FormTemplatesManagerContainer } from './forms/FormTemplatesManagerContainer.tsx';
import { FormCatalogContainer } from './forms/FormCatalogContainer.tsx';
import { FormIviStudioContainer } from './forms/FormIviStudioContainer.tsx';
import { FormBuilderContainer } from './forms/FormBuilderContainer.tsx';
import { FormRunnerContainer } from './forms/FormRunnerContainer.tsx';
import { FormResponsesContainer } from './forms/FormResponsesContainer.tsx';

type FormsSubTab = 'templates' | 'catalog' | 'ivi_studio' | 'builder' | 'runner' | 'responses';

export const FormsModule: React.FC<{
  units?: Unit[];
  wsTick?: number;
  navIntent?: NavigationIntent | null;
  onClearIntent?: () => void;
  onNavigate?: (module: ModuleId, intent?: NavigationIntent) => void;
  onGoBack?: () => void;
  previousScreenLabel?: string;
  branding?: PortalBrandingConfig | null;
}> = ({ wsTick, onNavigate, onGoBack, previousScreenLabel, branding }) => {
  const [data, setData] = useState<FormsBootstrapPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [isExpanded, setIsExpanded] = useState(false);
  const [subTab, setSubTab] = useState<FormsSubTab>('templates');
  const [subTabHistory, setSubTabHistory] = useState<FormsSubTab[]>([]);
  const subTabRef = useRef<FormsSubTab>('templates');

  const switchSubTab = useCallback((nextTab: FormsSubTab) => {
    const curr = subTabRef.current;
    if (curr !== nextTab) {
      setSubTabHistory((prev) => [...prev.slice(-15), curr]);
      subTabRef.current = nextTab;
    }
    setSubTab(nextTab);
  }, []);

  const handleHeaderGoBack = useCallback(() => {
    if (subTabHistory.length > 0) {
      const prevTab = subTabHistory[subTabHistory.length - 1];
      setSubTabHistory((prev) => prev.slice(0, -1));
      subTabRef.current = prevTab;
      setSubTab(prevTab);
      return;
    }
    if (onGoBack) {
      onGoBack();
    } else if (onNavigate) {
      onNavigate('overview');
    }
  }, [subTabHistory, onGoBack, onNavigate]);
  const [docTemplatesCount, setDocTemplatesCount] = useState<number>(5);
  const [editingForm, setEditingForm] = useState<CustomFormItem | null>(null);
  const [runningForm, setRunningForm] = useState<CustomFormItem | null>(null);
  const [modalRunnerForm, setModalRunnerForm] = useState<CustomFormItem | null>(null);
  const [responsesFormFilter, setResponsesFormFilter] = useState<string>('TODOS');
  const [deleteTarget, setDeleteTarget] = useState<CustomFormItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [toastMsg, setToastMsg] = useState('');
  const [fetchedBranding, setFetchedBranding] = useState<PortalBrandingConfig | null>(() =>
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
      setFetchedBranding(nextB);
      setDarkBackdrop(nextDark);
    });
  }, [branding]);

  const activeBranding = branding || fetchedBranding;

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    window.setTimeout(() => setToastMsg((curr) => (curr === msg ? '' : curr)), 3500);
  }, []);

  const loadBootstrap = useCallback(async (silent = false) => {
    if (!silent) setLoading((prev) => (prev ? true : false));
    try {
      const res = await apiFetch<FormsBootstrapPayload>('/api/forms/bootstrap');
      setData(res);
    } catch (err) {
      console.error('Erro ao carregar Formulários:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadBootstrap();
  }, [loadBootstrap]);

  const prevWsRef = useRef(wsTick);
  useEffect(() => {
    if (prevWsRef.current === wsTick) return;
    prevWsRef.current = wsTick;
    const t = window.setTimeout(() => void loadBootstrap(true), 350);
    return () => window.clearTimeout(t);
  }, [wsTick, loadBootstrap]);

  const forms = useMemo(() => data?.forms || [], [data]);
  const templates = useMemo(() => forms.filter((f) => f.isTemplate), [forms]);
  const submissions = useMemo(() => data?.submissions || [], [data]);
  const kpis = data?.kpis;

  const handleSaveForm = async (
    payload: {
      id?: number;
      title: string;
      description: string;
      category: string;
      status: string;
      linkedEntity: string;
      isTemplate: boolean;
      allowAnonymous: boolean;
      fieldsJson: CustomFormField[];
      settingsJson: CustomFormSettings;
      iviPromptOrigin?: string;
    },
    andRun = false
  ) => {
    if (payload.id) {
      const res = await apiFetch<{ form: CustomFormItem }>(`/api/forms/${payload.id}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      setData((prev) =>
        prev
          ? { ...prev, forms: prev.forms.map((f) => (f.id === res.form.id ? { ...f, ...res.form } : f)) }
          : prev
      );
      showToast('Formulário atualizado com sucesso.');
      if (andRun) {
        setRunningForm(res.form);
        switchSubTab('runner');
      } else {
        setEditingForm(res.form);
      }
    } else {
      const res = await apiFetch<{ form: CustomFormItem }>('/api/forms', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setData((prev) => (prev ? { ...prev, forms: [res.form, ...prev.forms] } : prev));
      showToast('Formulário criado e salvo.');
      if (andRun) {
        setRunningForm(res.form);
        switchSubTab('runner');
      } else {
        setEditingForm(res.form);
        switchSubTab('builder');
      }
    }
    void loadBootstrap(true);
  };

  const handleSaveFromIvi = async (
    draft: {
      title: string;
      description: string;
      category: string;
      linkedEntity: string;
      status: 'rascunho' | 'publicado';
      fieldsJson: CustomFormField[];
      settingsJson: CustomFormSettings;
      iviPromptOrigin: string;
    },
    openInBuilder: boolean
  ) => {
    const res = await apiFetch<{ form: CustomFormItem }>('/api/forms', {
      method: 'POST',
      body: JSON.stringify(draft),
    });
    setData((prev) => (prev ? { ...prev, forms: [res.form, ...prev.forms] } : prev));
    if (openInBuilder) {
      setEditingForm(res.form);
      switchSubTab('builder');
      showToast('Rascunho gerado pela Ivi IA aberto no Construtor.');
    } else {
      setRunningForm(res.form);
      switchSubTab('runner');
      showToast('Formulário publicado e pronto para preenchimento!');
    }
    void loadBootstrap(true);
  };

  const handleSavePresentationOptions = async (
    fm: CustomFormItem,
    nextSettings: CustomFormSettings
  ) => {
    const res = await apiFetch<{ form: CustomFormItem }>(`/api/forms/${fm.id}`, {
      method: 'PUT',
      body: JSON.stringify({ settingsJson: nextSettings }),
    });
    setData((prev) =>
      prev
        ? {
            ...prev,
            forms: prev.forms.map((f) => (f.id === res.form.id ? { ...f, ...res.form } : f)),
          }
        : prev
    );
    showToast(`Opções modais de "${res.form.title}" salvas com sucesso.`);
  };

  const handleDuplicateForm = async (formId: number) => {
    const res = await apiFetch<{ form: CustomFormItem }>(`/api/forms/${formId}/duplicate`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    setData((prev) => (prev ? { ...prev, forms: [res.form, ...prev.forms] } : prev));
    setEditingForm(res.form);
    switchSubTab('builder');
    showToast(`Cópia "${res.form.title}" criada no Construtor.`);
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiFetch(`/api/forms/${deleteTarget.id}`, { method: 'DELETE' });
      const deletedId = deleteTarget.id;
      setDeleteTarget(null);
      setData((prev) =>
        prev
          ? {
              ...prev,
              forms: prev.forms.filter((f) => f.id !== deletedId),
              submissions: prev.submissions.filter((s) => s.formId !== deletedId),
            }
          : prev
      );
      if (editingForm?.id === deletedId) setEditingForm(null);
      if (runningForm?.id === deletedId) setRunningForm(null);
      showToast('Formulário excluído.');
    } finally {
      setDeleting(false);
    }
  };

  const handleExportCsv = (formId: number) => {
    const token = getAuthToken();
    const url = `/api/forms/${formId}/export-csv${token ? `?token=${encodeURIComponent(token)}` : ''}`;
    const a = document.createElement('a');
    a.href = url;
    a.download = `formulario_${formId}.csv`;
    a.click();
  };

  if (loading && !data) {
    return (
      <div className="p-8 text-center text-sm text-slate-500 flex items-center justify-center gap-2 dark:text-slate-400">
        <RefreshCw className="w-4 h-4 animate-spin text-blue-600 dark:text-blue-400" />
        Carregando Análises &amp; Consultas · Formulários...
      </div>
    );
  }

  return (
    <div
      className={
        isExpanded
          ? 'fixed inset-0 z-40 bg-slate-50 overflow-y-auto p-4 sm:p-6 space-y-5 dark:bg-slate-800/70'
          : 'space-y-5'
      }
    >
      {/* Header */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-center gap-3 min-w-0">
          {(onGoBack || onNavigate || subTabHistory.length > 0) && (
            <button
              type="button"
              onClick={handleHeaderGoBack}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-700 shrink-0 transition-colors"
              title={
                subTabHistory.length > 0
                  ? 'Voltar para a aba anterior'
                  : `Voltar para a tela anterior${previousScreenLabel ? ` (${previousScreenLabel})` : ''}`
              }
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="hidden sm:inline">Voltar</span>
            </button>
          )}
          <div className="min-w-0">
            <h1 className="font-display text-lg font-bold text-slate-900 truncate dark:text-slate-100">
              Análises &amp; Consultas · Formulários
            </h1>
            <p className="text-xs text-slate-500 truncate dark:text-slate-400">
              Modelos corporativos, criação assistida pela Ivi IA por modelo/prompt e consulta analítica de respostas
            </p>
          </div>
        </div>

        {/* Centered Company Logo from Portal & Identidade */}
        <div className="flex items-center justify-center justify-self-center">
          {activeBranding?.logoDataUrl ? (
            <div
              className={`inline-flex items-center justify-center rounded-xl border px-3.5 py-1.5 ${
                darkBackdrop
                  ? 'bg-slate-900 border-slate-800 dark:bg-slate-950 dark:border-slate-700'
                  : 'bg-white border-slate-200 dark:bg-slate-900 dark:border-slate-700'
              }`}
            >
              <img
                src={activeBranding.logoDataUrl}
                alt={activeBranding.companyName || 'Logomarca da Empresa'}
                title={activeBranding.companyName || 'Logomarca da Empresa'}
                referrerPolicy="no-referrer"
                className="h-10 max-w-[200px] w-auto object-contain"
              />
            </div>
          ) : (
            <div className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-700 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-200">
              <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <span>{activeBranding?.companyName?.trim() || 'FinancePro'}</span>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 lg:justify-self-end">
          <button
            type="button"
            onClick={() => void loadBootstrap(false)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Atualizar
          </button>
          <button
            type="button"
            onClick={() => setIsExpanded((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            {isExpanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">{isExpanded ? 'Restaurar' : 'Tela Cheia'}</span>
          </button>
        </div>
      </div>

      {toastMsg && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs font-medium text-emerald-800 dark:border-emerald-800/70 dark:bg-emerald-950/50 dark:text-emerald-300">
          {toastMsg}
        </div>
      )}

      {/* Single-Elevation KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-700 dark:bg-slate-900">
          <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Modelos A4 &amp; Questionários</div>
          <div className="font-mono tabular-nums text-xl font-bold text-slate-900 mt-1 dark:text-slate-100">
            {docTemplatesCount} <span className="text-xs font-normal text-slate-400 dark:text-slate-400">A4</span> · {kpis?.totalForms || 0} <span className="text-xs font-normal text-slate-400 dark:text-slate-400">Coleta</span>
          </div>
          <div className="text-[11px] text-slate-500 font-mono tabular-nums mt-0.5 dark:text-slate-400">
            {kpis?.publishedForms || 0} publicados · 171 variáveis A4
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-700 dark:bg-slate-900">
          <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Respostas Protocoladas</div>
          <div className="font-mono tabular-nums text-xl font-bold text-slate-900 mt-1 dark:text-slate-100">
            {kpis?.totalSubmissions || 0}
          </div>
          <div className="text-[11px] text-slate-500 font-mono tabular-nums mt-0.5 dark:text-slate-400">
            {kpis?.approvedCount || 0} aprovadas
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-700 dark:bg-slate-900">
          <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Aguardando Triagem</div>
          <div className="font-mono tabular-nums text-xl font-bold text-amber-700 mt-1 dark:text-amber-300">
            {kpis?.pendingReviewCount || 0}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5 dark:text-slate-400">Recebidas / em análise</div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-700 dark:bg-slate-900">
          <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Score Médio Apurado</div>
          <div className="font-mono tabular-nums text-xl font-bold text-emerald-700 mt-1 dark:text-emerald-300">
            {kpis?.avgScore !== null && kpis?.avgScore !== undefined ? `${kpis.avgScore}%` : '—'}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5 dark:text-slate-400">Conformidade / NPS</div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex items-center gap-1 border-b border-slate-200 overflow-x-auto dark:border-slate-700">
        <button
          type="button"
          onClick={() => switchSubTab('templates')}
          className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold border-b-2 whitespace-nowrap transition-colors ${
            subTab === 'templates'
              ? 'border-blue-600 text-blue-700 bg-blue-50/40 dark:text-blue-300 dark:bg-blue-950/50'
              : 'border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
          }`}
        >
          <FileText className="w-4 h-4" />
          Modelos de Documentos A4 ({docTemplatesCount})
        </button>

        <button
          type="button"
          onClick={() => switchSubTab('catalog')}
          className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold border-b-2 whitespace-nowrap transition-colors ${
            subTab === 'catalog'
              ? 'border-blue-600 text-blue-700 bg-blue-50/40 dark:text-blue-300 dark:bg-blue-950/50'
              : 'border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
          }`}
        >
          <ClipboardList className="w-4 h-4" />
          Coleta &amp; Questionários ({forms.length})
        </button>

        <button
          type="button"
          onClick={() => switchSubTab('ivi_studio')}
          className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold border-b-2 whitespace-nowrap transition-colors ${
            subTab === 'ivi_studio'
              ? 'border-blue-600 text-blue-700 bg-blue-50/40 dark:text-blue-300 dark:bg-blue-950/50'
              : 'border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
          }`}
        >
          <Sparkles className="w-4 h-4" />
          Criar com Ivi IA
        </button>

        <button
          type="button"
          onClick={() => switchSubTab('builder')}
          className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold border-b-2 whitespace-nowrap transition-colors ${
            subTab === 'builder'
              ? 'border-blue-600 text-blue-700 bg-blue-50/40 dark:text-blue-300 dark:bg-blue-950/50'
              : 'border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
          }`}
        >
          <Wrench className="w-4 h-4" />
          Construtor {editingForm ? `(${editingForm.code})` : ''}
        </button>

        {runningForm && (
          <button
            type="button"
            onClick={() => switchSubTab('runner')}
            className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold border-b-2 whitespace-nowrap transition-colors ${
              subTab === 'runner'
                ? 'border-emerald-600 text-emerald-700 bg-emerald-50/40 dark:text-emerald-300 dark:bg-emerald-950/50'
                : 'border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
            }`}
          >
            <FilePlus2 className="w-4 h-4" />
            Preencher ({runningForm.code})
          </button>
        )}

        <button
          type="button"
          onClick={() => switchSubTab('responses')}
          className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold border-b-2 whitespace-nowrap transition-colors ${
            subTab === 'responses'
              ? 'border-blue-600 text-blue-700 bg-blue-50/40 dark:text-blue-300 dark:bg-blue-950/50'
              : 'border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
          }`}
        >
          <Database className="w-4 h-4" />
          Consultas &amp; Respostas ({submissions.length})
        </button>
      </div>

      {/* Views */}
      {subTab === 'templates' && (
        <FormTemplatesManagerContainer
          wsTick={wsTick}
          branding={activeBranding}
          onTemplatesCountChange={setDocTemplatesCount}
          onNotify={showToast}
        />
      )}

      {subTab === 'catalog' && (
        <FormCatalogContainer
          forms={forms}
          onCreateBlank={() => {
            setEditingForm(null);
            switchSubTab('builder');
          }}
          onOpenIviStudio={() => switchSubTab('ivi_studio')}
          onEditForm={(fm) => {
            setEditingForm(fm);
            switchSubTab('builder');
          }}
          onRunForm={(fm) => {
            const mode = fm.settingsJson?.displayMode;
            if (mode === 'modal' || mode === 'drawer') {
              setModalRunnerForm(fm);
            } else {
              setRunningForm(fm);
              switchSubTab('runner');
            }
          }}
          onViewResponses={(formId) => {
            setResponsesFormFilter(String(formId));
            switchSubTab('responses');
          }}
          onDuplicateForm={handleDuplicateForm}
          onDeleteForm={(fm) => setDeleteTarget(fm)}
          onExportCsv={handleExportCsv}
          onSavePresentationOptions={handleSavePresentationOptions}
        />
      )}

      {subTab === 'ivi_studio' && (
        <FormIviStudioContainer templates={templates} onSaveDraft={handleSaveFromIvi} />
      )}

      {subTab === 'builder' && (
        <FormBuilderContainer
          form={editingForm}
          onSaveForm={handleSaveForm}
          onCancel={() => switchSubTab('catalog')}
        />
      )}

      {subTab === 'runner' && runningForm && (
        <FormRunnerContainer
          form={runningForm}
          clients={data?.clients || []}
          admissions={data?.admissions || []}
          negotiations={data?.negotiations || []}
          units={data?.units || []}
          branding={activeBranding}
          onSubmitted={(sub) => {
            setData((prev) =>
              prev
                ? {
                    ...prev,
                    submissions: [sub, ...prev.submissions],
                    forms: prev.forms.map((f) =>
                      f.id === sub.formId
                        ? { ...f, submissionsCount: (f.submissionsCount || 0) + 1 }
                        : f
                    ),
                  }
                : prev
            );
            void loadBootstrap(true);
          }}
          onBackToCatalog={() => switchSubTab('catalog')}
        />
      )}

      {subTab === 'responses' && (
        <FormResponsesContainer
          forms={forms}
          submissions={submissions}
          selectedFormFilter={responsesFormFilter}
          onFormFilterChange={setResponsesFormFilter}
          onSubmissionUpdated={(updated) => {
            setData((prev) =>
              prev
                ? {
                    ...prev,
                    submissions: prev.submissions.map((s) =>
                      s.id === updated.id ? { ...s, ...updated } : s
                    ),
                  }
                : prev
            );
            showToast('Triagem da resposta atualizada.');
          }}
          onExportCsv={handleExportCsv}
        />
      )}

      {modalRunnerForm && (
        <div
          className={`fixed inset-0 z-50 flex ${
            modalRunnerForm.settingsJson?.displayMode === 'drawer'
              ? 'justify-end'
              : 'items-center justify-center p-4'
          } bg-slate-900/55`}
          onClick={() => setModalRunnerForm(null)}
        >
          <div
            className={
              modalRunnerForm.settingsJson?.displayMode === 'drawer'
                ? 'h-full w-full max-w-2xl bg-slate-50 shadow-2xl flex flex-col overflow-hidden border-l border-slate-200 dark:bg-slate-800/70 dark:border-slate-700'
                : 'w-full max-w-4xl max-h-[90vh] rounded-2xl bg-slate-50 shadow-2xl flex flex-col overflow-hidden border border-slate-200 dark:bg-slate-800/70 dark:border-slate-700'
            }
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 bg-white px-5 py-3 dark:border-slate-700 dark:bg-slate-900">
              <div>
                <div className="text-[10px] font-mono text-blue-700 uppercase dark:text-blue-300">
                  {modalRunnerForm.settingsJson?.displayMode === 'drawer'
                    ? 'Apresentação em Painel Lateral'
                    : 'Apresentação em Modal Central'}{' '}
                  · {modalRunnerForm.code}
                </div>
                <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                  {modalRunnerForm.title}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setModalRunnerForm(null)}
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 sm:p-5">
              <FormRunnerContainer
                form={modalRunnerForm}
                clients={data?.clients || []}
                admissions={data?.admissions || []}
                negotiations={data?.negotiations || []}
                units={data?.units || []}
                branding={activeBranding}
                onSubmitted={(sub) => {
                  setData((prev) =>
                    prev
                      ? {
                          ...prev,
                          submissions: [sub, ...prev.submissions],
                          forms: prev.forms.map((f) =>
                            f.id === sub.formId
                              ? { ...f, submissionsCount: (f.submissionsCount || 0) + 1 }
                              : f
                          ),
                        }
                      : prev
                  );
                  void loadBootstrap(true);
                }}
                onBackToCatalog={() => setModalRunnerForm(null)}
              />
            </div>
          </div>
        </div>
      )}

      <ConfirmDeleteModal
        open={Boolean(deleteTarget)}
        title="Excluir Formulário"
        message={
          deleteTarget
            ? `Deseja realmente excluir "${deleteTarget.title}" (${deleteTarget.code}) e todas as suas respostas vinculadas?`
            : ''
        }
        busy={deleting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
};
