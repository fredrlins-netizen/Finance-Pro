import React, { useEffect, useMemo, useState } from 'react';
import {
  AppWindow,
  Check,
  Copy,
  Download,
  Edit3,
  FilePlus2,
  History,
  Play,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import type { CustomFormItem, CustomFormSettings } from '../../../types.ts';
import { FORM_CONTEXT_REGISTRY } from '../../../lib/formTemplateCatalog.ts';
import {
  FORM_CATEGORY_LABELS,
  FORM_STATUS_CONFIG,
  LINKED_ENTITY_LABELS,
} from './types.ts';

const DISPLAY_MODE_LABELS: Record<'modal' | 'drawer' | 'inline', { label: string; desc: string }> = {
  modal: {
    label: 'Modal Central (Janela Sobreposta)',
    desc: 'Apresenta o formulário em uma janela modal centrada sobre a tela atual.',
  },
  drawer: {
    label: 'Painel Lateral (Drawer)',
    desc: 'Abre o formulário deslizando na lateral direita mantendo o contexto visível.',
  },
  inline: {
    label: 'Página Dedicada',
    desc: 'Abre o preenchimento na aba exclusiva em tela completa.',
  },
};

interface FormCatalogContainerProps {
  forms: CustomFormItem[];
  onCreateBlank: () => void;
  onOpenIviStudio: () => void;
  onEditForm: (form: CustomFormItem) => void;
  onRunForm: (form: CustomFormItem) => void;
  onViewResponses: (formId: number) => void;
  onDuplicateForm: (formId: number) => Promise<void>;
  onDeleteForm: (form: CustomFormItem) => void;
  onExportCsv: (formId: number) => void;
  onSavePresentationOptions: (form: CustomFormItem, nextSettings: CustomFormSettings) => Promise<void>;
  onViewAudit?: (form: CustomFormItem) => void;
}

export const FormCatalogContainer: React.FC<FormCatalogContainerProps> = ({
  forms,
  onCreateBlank,
  onOpenIviStudio,
  onEditForm,
  onRunForm,
  onViewResponses,
  onDuplicateForm,
  onDeleteForm,
  onExportCsv,
  onSavePresentationOptions,
  onViewAudit,
}) => {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('TODAS');
  const [statusFilter, setStatusFilter] = useState('TODOS');
  const [onlyTemplates, setOnlyTemplates] = useState<'TODOS' | 'MODELOS' | 'OPERACIONAIS'>('TODOS');
  const [duplicatingId, setDuplicatingId] = useState<number | null>(null);
  const [selectedFormId, setSelectedFormId] = useState<number | null>(null);
  const [modalTarget, setModalTarget] = useState<CustomFormItem | null>(null);
  const [draftDisplayMode, setDraftDisplayMode] = useState<'modal' | 'drawer' | 'inline'>('modal');
  const [draftContexts, setDraftContexts] = useState<string[]>([]);
  const [savingOptions, setSavingOptions] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return forms.filter((f) => {
      if (q) {
        const hay = `${f.title} ${f.code} ${f.description} ${f.category}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (categoryFilter !== 'TODAS' && f.category !== categoryFilter) return false;
      if (statusFilter !== 'TODOS' && f.status !== statusFilter) return false;
      if (onlyTemplates === 'MODELOS' && !f.isTemplate) return false;
      if (onlyTemplates === 'OPERACIONAIS' && f.isTemplate) return false;
      return true;
    });
  }, [forms, search, categoryFilter, statusFilter, onlyTemplates]);

  useEffect(() => {
    setSelectedFormId((curr) =>
      curr && filtered.some((f) => f.id === curr) ? curr : filtered[0]?.id ?? null
    );
  }, [filtered]);

  const selectedForm = useMemo(
    () => filtered.find((f) => f.id === selectedFormId) || forms.find((f) => f.id === selectedFormId) || null,
    [filtered, forms, selectedFormId]
  );

  const openModalOptions = (fm: CustomFormItem) => {
    setSelectedFormId(fm.id);
    setDraftDisplayMode(fm.settingsJson?.displayMode || 'modal');
    setDraftContexts(
      Array.isArray(fm.settingsJson?.presentationContexts)
        ? [...fm.settingsJson.presentationContexts]
        : []
    );
    setModalTarget(fm);
  };

  const handleSaveModalOptions = async () => {
    if (!modalTarget) return;
    setSavingOptions(true);
    try {
      const nextSettings: CustomFormSettings = {
        ...(modalTarget.settingsJson || {}),
        displayMode: draftDisplayMode,
        presentationContexts: Array.from(new Set(draftContexts)),
      };
      await onSavePresentationOptions(modalTarget, nextSettings);
      setModalTarget(null);
    } finally {
      setSavingOptions(false);
    }
  };

  const handleDuplicate = async (id: number) => {
    setDuplicatingId(id);
    try {
      await onDuplicateForm(id);
    } finally {
      setDuplicatingId(null);
    }
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden dark:border-slate-700 dark:bg-slate-900">
      {/* Filter & Actions Bar */}
      <div className="p-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 dark:border-slate-700">
        <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[260px]">
          <div className="relative w-full sm:w-64">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 dark:text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar formulário ou código..."
              className="w-full rounded-lg border border-slate-300 pl-8 pr-3 py-1.5 text-xs focus:border-blue-600 focus:outline-none dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
            />
          </div>

          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs bg-white text-slate-700 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
          >
            <option value="TODAS">Todas as categorias</option>
            {Object.entries(FORM_CATEGORY_LABELS).map(([k, lbl]) => (
              <option key={k} value={k}>
                {lbl}
              </option>
            ))}
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs bg-white text-slate-700 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
          >
            <option value="TODOS">Todos os status</option>
            <option value="publicado">Publicado</option>
            <option value="rascunho">Rascunho</option>
            <option value="arquivado">Arquivado</option>
          </select>

          <div className="inline-flex items-center p-0.5 rounded-lg bg-slate-100 border border-slate-200 dark:bg-slate-800 dark:border-slate-700">
            {(['TODOS', 'MODELOS', 'OPERACIONAIS'] as const).map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => setOnlyTemplates(opt)}
                className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition-colors whitespace-nowrap ${
                  onlyTemplates === opt
                    ? 'bg-white text-slate-900 shadow-2xs dark:bg-slate-900 dark:text-slate-100'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
                }`}
              >
                {opt === 'TODOS' ? 'Todos' : opt === 'MODELOS' ? 'Modelos' : 'Personalizados'}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            disabled={!selectedForm}
            onClick={() => {
              if (selectedForm) openModalOptions(selectedForm);
            }}
            title={
              selectedForm
                ? `Configurar apresentação modal de "${selectedForm.title}"`
                : 'Selecione um formulário na lista abaixo'
            }
            className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-50 whitespace-nowrap dark:border-blue-800/70 dark:bg-blue-950/50 dark:text-blue-300 dark:hover:bg-blue-900/60"
          >
            <AppWindow className="w-3.5 h-3.5" />
            Opções Modais
            {selectedForm && (
              <span className="rounded bg-blue-600 px-1.5 py-0.5 text-[10px] font-mono text-white">
                {selectedForm.settingsJson?.presentationContexts?.length || 0}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={onOpenIviStudio}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-900 bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800 whitespace-nowrap dark:border-emerald-500 dark:bg-emerald-600 dark:hover:bg-emerald-500"
          >
            <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
            Criar com Ivi IA
          </button>
          <button
            type="button"
            onClick={onCreateBlank}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 whitespace-nowrap dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
          >
            <FilePlus2 className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
            Novo em Branco
          </button>
        </div>
      </div>

      {selectedForm && (
        <div className="border-b border-blue-100 bg-blue-50/40 px-4 py-2 flex flex-wrap items-center justify-between gap-2 text-xs dark:border-blue-800/70 dark:bg-blue-950/50">
          <span className="text-slate-700 truncate dark:text-slate-200">
            Selecionado: <strong className="text-slate-900 dark:text-slate-100">{selectedForm.title}</strong> ({selectedForm.code})
          </span>
          <span className="text-[11px] font-mono text-blue-700 dark:text-blue-300">
            Modo: {DISPLAY_MODE_LABELS[selectedForm.settingsJson?.displayMode || 'modal'].label} ·{' '}
            {selectedForm.settingsJson?.presentationContexts?.length || 0} tela(s)
          </span>
        </div>
      )}

      {/* Desktop Data Grid */}
      <div className="hidden lg:block overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-500 dark:bg-slate-800/70 dark:border-slate-700 dark:text-slate-400">
            <tr>
              <th className="py-2.5 px-4">Código &amp; Formulário</th>
              <th className="py-2.5 px-3">Categoria</th>
              <th className="py-2.5 px-3">Vínculo</th>
              <th className="py-2.5 px-3 text-right">Campos</th>
              <th className="py-2.5 px-3 text-right">Respostas</th>
              <th className="py-2.5 px-3">Status</th>
              <th className="py-2.5 px-4 text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-xs dark:divide-slate-800">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-10 text-center text-slate-500 dark:text-slate-400">
                  Nenhum formulário encontrado com os filtros atuais. Crie um novo com ajuda da Ivi IA ou ajuste os filtros.
                </td>
              </tr>
            ) : (
              filtered.map((f) => {
                const stCfg = FORM_STATUS_CONFIG[f.status] || FORM_STATUS_CONFIG.rascunho;
                const dataFieldsCount = (f.fieldsJson || []).filter((fld) => fld.type !== 'section_header').length;
                const isSelected = selectedFormId === f.id;
                const contextsCount = f.settingsJson?.presentationContexts?.length || 0;
                const modeKey = f.settingsJson?.displayMode || 'modal';
                return (
                  <tr
                    key={f.id}
                    onClick={() => setSelectedFormId(f.id)}
                    className={`cursor-pointer transition-colors ${
                      isSelected ? 'bg-blue-50/70 dark:bg-blue-950/50' : 'hover:bg-slate-50/80'
                    }`}
                  >
                    <td className="py-2.5 px-4 max-w-md">
                      <div className="flex items-start gap-2.5">
                        <input
                          type="radio"
                          name="selected_custom_form"
                          checked={isSelected}
                          onChange={() => setSelectedFormId(f.id)}
                          onClick={(e) => e.stopPropagation()}
                          className="mt-1 text-blue-600 focus:ring-blue-500 dark:text-blue-400"
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 text-[11px] text-slate-500 font-mono tabular-nums dark:text-slate-400">
                            <span>{f.code}</span>
                            <span aria-hidden="true">·</span>
                            <span>v{f.version}</span>
                            {f.isTemplate && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="font-sans font-semibold text-blue-700 dark:text-blue-300">Modelo Base</span>
                              </>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onRunForm(f);
                            }}
                            className="font-semibold text-slate-900 hover:text-blue-700 hover:underline text-left block mt-0.5 dark:text-slate-100"
                          >
                            {f.title}
                          </button>
                          {f.description && (
                            <p className="text-[11px] text-slate-500 truncate mt-0.5 dark:text-slate-400">{f.description}</p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-slate-700 dark:text-slate-200">
                      {FORM_CATEGORY_LABELS[f.category] || f.category}
                    </td>
                    <td className="py-2.5 px-3 text-slate-600 dark:text-slate-300">
                      <div>{LINKED_ENTITY_LABELS[f.linkedEntity] || f.linkedEntity}</div>
                      <div className="text-[10px] text-blue-700 font-mono mt-0.5 dark:text-blue-300">
                        {modeKey === 'modal' ? 'Modal' : modeKey === 'drawer' ? 'Drawer' : 'Página'} · {contextsCount} tela(s)
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-700 dark:text-slate-200">
                      {dataFieldsCount}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        onClick={() => onViewResponses(f.id)}
                        className="font-semibold text-blue-700 hover:underline dark:text-blue-300"
                      >
                        {f.submissionsCount || 0}
                      </button>
                    </td>
                    <td className="py-2.5 px-3">
                      <span className={`font-semibold ${stCfg.textClass}`}>{stCfg.label}</span>
                    </td>
                    <td className="py-2.5 px-4" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => openModalOptions(f)}
                          title="Opções Modais de Apresentação e Uso"
                          className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-[11px] font-semibold text-blue-700 hover:bg-blue-100 whitespace-nowrap dark:border-blue-800/70 dark:bg-blue-950/50 dark:text-blue-300 dark:hover:bg-blue-900/60"
                        >
                          <AppWindow className="w-3 h-3" />
                          Modais
                        </button>
                        <button
                          type="button"
                          onClick={() => onRunForm(f)}
                          title="Preencher formulário"
                          className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700 whitespace-nowrap"
                        >
                          <Play className="w-3 h-3" />
                          Preencher
                        </button>
                        <button
                          type="button"
                          onClick={() => onEditForm(f)}
                          title="Editar no construtor"
                          className="rounded-md border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={duplicatingId === f.id}
                          onClick={() => void handleDuplicate(f.id)}
                          title="Duplicar modelo"
                          className="rounded-md border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onExportCsv(f.id)}
                          title="Exportar respostas CSV"
                          className="rounded-md border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </button>
                        {onViewAudit && (
                          <button
                            type="button"
                            onClick={() => onViewAudit(f)}
                            title="Histórico de Auditoria do Formulário"
                            className="rounded-md border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                          >
                            <History className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => onDeleteForm(f)}
                          title="Excluir formulário"
                          className="rounded-md border border-slate-200 p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-700 hover:border-red-200 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-red-950/60"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile & Tablet Stacked Cards */}
      <div className="lg:hidden divide-y divide-slate-100 dark:divide-slate-800">
        {filtered.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">
            Nenhum formulário encontrado. Utilize &ldquo;Criar com Ivi IA&rdquo; ou &ldquo;Novo em Branco&rdquo;.
          </div>
        ) : (
          filtered.map((f) => {
            const stCfg = FORM_STATUS_CONFIG[f.status] || FORM_STATUS_CONFIG.rascunho;
            const dataFieldsCount = (f.fieldsJson || []).filter((fld) => fld.type !== 'section_header').length;
            return (
              <div key={f.id} className="p-4 space-y-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                      {f.code} · v{f.version} {f.isTemplate ? '· Modelo Base' : ''}
                    </div>
                    <h3 className="font-semibold text-sm text-slate-900 mt-0.5 dark:text-slate-100">{f.title}</h3>
                  </div>
                  <span className={`text-xs font-semibold shrink-0 ${stCfg.textClass}`}>{stCfg.label}</span>
                </div>

                {f.description && <p className="text-xs text-slate-600 dark:text-slate-300">{f.description}</p>}

                <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500 font-mono tabular-nums dark:text-slate-400">
                  <span className="font-sans">{FORM_CATEGORY_LABELS[f.category] || f.category}</span>
                  <span>·</span>
                  <span>{dataFieldsCount} campos</span>
                  <span>·</span>
                  <button
                    type="button"
                    onClick={() => onViewResponses(f.id)}
                    className="text-blue-700 font-semibold hover:underline dark:text-blue-300"
                  >
                    {f.submissionsCount || 0} resposta(s)
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => openModalOptions(f)}
                    className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 dark:border-blue-800/70 dark:bg-blue-950/50 dark:text-blue-300"
                  >
                    <AppWindow className="w-3.5 h-3.5" />
                    Opções Modais
                  </button>
                  <button
                    type="button"
                    onClick={() => onRunForm(f)}
                    className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white"
                  >
                    <Play className="w-3.5 h-3.5" />
                    Preencher
                  </button>
                  <button
                    type="button"
                    onClick={() => onEditForm(f)}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:border-slate-600 dark:text-slate-200"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    Editar
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDuplicate(f.id)}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:border-slate-600 dark:text-slate-200"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    Duplicar
                  </button>
                  {onViewAudit && (
                    <button
                      type="button"
                      onClick={() => onViewAudit(f)}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:border-slate-600 dark:text-slate-200"
                    >
                      <History className="w-3.5 h-3.5" />
                      Auditoria
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Modal Presentation Options Dialog */}
      {modalTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-4"
          onClick={() => !savingOptions && setModalTarget(null)}
        >
          <div
            className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden flex flex-col max-h-[88vh] dark:border-slate-700 dark:bg-slate-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 bg-slate-50 px-5 py-3.5 dark:border-slate-700 dark:bg-slate-800/70">
              <div>
                <div className="flex items-center gap-2">
                  <AppWindow className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                  <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                    Opções Modais · Apresentação e Uso do Formulário
                  </h3>
                </div>
                <p className="text-[11px] text-slate-500 mt-0.5 dark:text-slate-400">
                  Formulário: <strong className="text-slate-800 dark:text-slate-100">{modalTarget.title}</strong> ({modalTarget.code})
                </p>
              </div>
              <button
                type="button"
                disabled={savingOptions}
                onClick={() => setModalTarget(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-5 flex-1">
              <div className="space-y-2">
                <div className="text-xs font-bold text-slate-800 dark:text-slate-100">
                  1. Como o formulário deverá ser apresentado ao usuário
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  {(['modal', 'drawer', 'inline'] as const).map((mode) => {
                    const info = DISPLAY_MODE_LABELS[mode];
                    const active = draftDisplayMode === mode;
                    return (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setDraftDisplayMode(mode)}
                        className={`rounded-xl border p-3 text-left transition-colors ${
                          active
                            ? 'border-blue-500 bg-blue-50/70 dark:bg-blue-950/50'
                            : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800'
                        }`}
                      >
                        <div className="text-xs font-bold text-slate-900 dark:text-slate-100">{info.label}</div>
                        <p className="text-[11px] text-slate-500 mt-1 leading-snug dark:text-slate-400">{info.desc}</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-bold text-slate-800 dark:text-slate-100">
                    2. Modais e Telas do Sistema onde poderá ser utilizado
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() =>
                        setDraftContexts(FORM_CONTEXT_REGISTRY.map((r) => r.menuId))
                      }
                      className="rounded border border-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                    >
                      Marcar Todas
                    </button>
                    <button
                      type="button"
                      onClick={() => setDraftContexts([])}
                      className="rounded border border-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
                    >
                      Limpar
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {FORM_CONTEXT_REGISTRY.map((r) => {
                    const checked = draftContexts.includes(r.menuId);
                    return (
                      <label
                        key={r.menuId}
                        className={`flex items-start gap-2.5 rounded-xl border p-2.5 cursor-pointer transition-colors ${
                          checked
                            ? 'border-blue-400 bg-blue-50/50 dark:bg-blue-950/50'
                            : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setDraftContexts((prev) => Array.from(new Set([...prev, r.menuId])));
                            } else {
                              setDraftContexts((prev) => prev.filter((id) => id !== r.menuId));
                            }
                          }}
                          className="mt-0.5 rounded border-slate-300 text-blue-600 dark:border-slate-600 dark:text-blue-400"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-1">
                            <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">{r.label}</span>
                            <span className="text-[10px] font-mono text-slate-400 dark:text-slate-400">{r.module}</span>
                          </div>
                          <p className="text-[10px] text-slate-500 mt-0.5 dark:text-slate-400">{r.description}</p>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-5 py-3 dark:border-slate-700 dark:bg-slate-800/70">
              <span className="text-xs font-mono tabular-nums text-slate-600 dark:text-slate-300">
                {draftContexts.length} tela(s) selecionada(s)
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={savingOptions}
                  onClick={() => setModalTarget(null)}
                  className="rounded-lg border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={savingOptions}
                  onClick={() => void handleSaveModalOptions()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  <Check className="w-3.5 h-3.5" />
                  {savingOptions ? 'Salvando...' : 'Salvar Opções Modais'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
