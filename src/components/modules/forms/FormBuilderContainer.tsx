import React, { useEffect, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Copy,
  Play,
  Plus,
  Save,
  Trash2,
} from 'lucide-react';
import type {
  CustomFormField,
  CustomFormFieldType,
  CustomFormItem,
  CustomFormSettings,
} from '../../../types.ts';
import {
  FIELD_TYPE_CATALOG,
  FORM_CATEGORY_LABELS,
  LINKED_ENTITY_LABELS,
} from './types.ts';

interface FormBuilderContainerProps {
  form: CustomFormItem | null;
  onSaveForm: (
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
    },
    andRun?: boolean
  ) => Promise<void>;
  onCancel: () => void;
}

function makeFieldKey(label: string, idx: number): string {
  const clean = label
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 42);
  return clean || `campo_${idx + 1}`;
}

export const FormBuilderContainer: React.FC<FormBuilderContainerProps> = ({
  form,
  onSaveForm,
  onCancel,
}) => {
  const [title, setTitle] = useState(form?.title || 'Novo Formulário Corporativo');
  const [description, setDescription] = useState(form?.description || '');
  const [category, setCategory] = useState(form?.category || 'operacional');
  const [status, setStatus] = useState<string>(form?.status || 'rascunho');
  const [linkedEntity, setLinkedEntity] = useState(form?.linkedEntity || 'cliente');
  const [isTemplate, setIsTemplate] = useState(Boolean(form?.isTemplate));
  const [allowAnonymous, setAllowAnonymous] = useState(Boolean(form?.allowAnonymous));
  const [iviAutoAnalyze, setIviAutoAnalyze] = useState(
    form?.settingsJson?.iviAutoAnalyze !== false
  );
  const [requiresReview, setRequiresReview] = useState(
    form?.settingsJson?.requiresReview !== false
  );
  const [submitLabel, setSubmitLabel] = useState(
    form?.settingsJson?.submitLabel || 'Enviar Resposta'
  );
  const [fields, setFields] = useState<CustomFormField[]>(form?.fieldsJson || []);
  const [selectedFieldId, setSelectedFieldId] = useState<string>(
    form?.fieldsJson?.[0]?.id || ''
  );
  const [saving, setSaving] = useState(false);
  const [errMsg, setErrMsg] = useState('');

  useEffect(() => {
    setTitle(form?.title || 'Novo Formulário Corporativo');
    setDescription(form?.description || '');
    setCategory(form?.category || 'operacional');
    setStatus(form?.status || 'rascunho');
    setLinkedEntity(form?.linkedEntity || 'cliente');
    setIsTemplate(Boolean(form?.isTemplate));
    setAllowAnonymous(Boolean(form?.allowAnonymous));
    setIviAutoAnalyze(form?.settingsJson?.iviAutoAnalyze !== false);
    setRequiresReview(form?.settingsJson?.requiresReview !== false);
    setSubmitLabel(form?.settingsJson?.submitLabel || 'Enviar Resposta');
    setFields(form?.fieldsJson || []);
    setSelectedFieldId(form?.fieldsJson?.[0]?.id || '');
    setErrMsg('');
  }, [form]);

  const selectedField = fields.find((f) => f.id === selectedFieldId) || null;

  const handleAddField = (type: CustomFormFieldType) => {
    const typeLabel = FIELD_TYPE_CATALOG.find((t) => t.type === type)?.label || 'Campo';
    const newId = `fld_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const defaultLabel =
      type === 'section_header' ? `Nova Seção (${fields.length + 1})` : `${typeLabel} ${fields.length + 1}`;
    const newField: CustomFormField = {
      id: newId,
      key: `${makeFieldKey(defaultLabel, fields.length)}_${fields.length + 1}`,
      label: defaultLabel,
      type,
      required: type !== 'section_header',
      width: type === 'section_header' || type === 'textarea' || type === 'radio' || type === 'checkbox_group' ? 'full' : 'half',
      options:
        type === 'select' || type === 'radio' || type === 'checkbox_group'
          ? ['Opção 1', 'Opção 2', 'Opção 3']
          : undefined,
      maxRating: type === 'rating' ? 5 : undefined,
    };
    setFields((prev) => [...prev, newField]);
    setSelectedFieldId(newId);
  };

  const handleUpdateField = (id: string, patch: Partial<CustomFormField>) => {
    setFields((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  };

  const handleMoveField = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= fields.length) return;
    setFields((prev) => {
      const next = [...prev];
      const [item] = next.splice(idx, 1);
      next.splice(target, 0, item);
      return next;
    });
  };

  const handleDuplicateField = (fld: CustomFormField) => {
    const newId = `fld_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const copy: CustomFormField = {
      ...fld,
      id: newId,
      key: `${fld.key}_copia`,
      label: `${fld.label} (Cópia)`,
    };
    setFields((prev) => [...prev, copy]);
    setSelectedFieldId(newId);
  };

  const handleDeleteField = (id: string) => {
    setFields((prev) => {
      const next = prev.filter((f) => f.id !== id);
      if (selectedFieldId === id) {
        setSelectedFieldId(next[0]?.id || '');
      }
      return next;
    });
  };

  const handlePersist = async (andRun = false) => {
    if (!title.trim()) {
      setErrMsg('Informe o título do formulário.');
      return;
    }
    if (fields.length === 0) {
      setErrMsg('Adicione pelo menos um campo antes de salvar o formulário.');
      return;
    }
    setErrMsg('');
    setSaving(true);
    try {
      await onSaveForm(
        {
          id: form?.id,
          title: title.trim(),
          description: description.trim(),
          category,
          status: andRun ? 'publicado' : status,
          linkedEntity,
          isTemplate,
          allowAnonymous,
          fieldsJson: fields,
          settingsJson: {
            submitLabel: submitLabel.trim() || 'Enviar Resposta',
            successMessage: 'Formulário registrado com sucesso.',
            autoScoreEnabled: fields.some((f) => f.type === 'rating' || (f.weight || 0) > 0),
            iviAutoAnalyze,
            requiresReview,
          },
        },
        andRun
      );
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'Erro ao salvar formulário.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Top Form Metadata Card */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-4 dark:border-slate-700 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3 dark:border-slate-800">
          <div>
            <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
              {form ? `${form.code} · v${form.version}` : 'Novo Formulário'}
            </div>
            <h2 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
              Construtor Estruturado de Formulário
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Voltar ao Catálogo
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void handlePersist(false)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-900 bg-slate-900 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50 dark:border-emerald-500 dark:bg-emerald-600 dark:hover:bg-emerald-500"
            >
              <Save className="w-3.5 h-3.5" />
              {saving ? 'Salvando...' : 'Salvar Formulário'}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void handlePersist(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              <Play className="w-3.5 h-3.5" />
              Publicar &amp; Preencher
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 text-xs">
          <div className="md:col-span-5">
            <label className="block text-[11px] font-semibold text-slate-600 mb-1 dark:text-slate-300">Título *</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-900 dark:border-slate-600 dark:text-slate-100 dark:bg-slate-950"
            />
          </div>

          <div className="md:col-span-3">
            <label className="block text-[11px] font-semibold text-slate-600 mb-1 dark:text-slate-300">Categoria</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs bg-white dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
            >
              {Object.entries(FORM_CATEGORY_LABELS).map(([k, lbl]) => (
                <option key={k} value={k}>
                  {lbl}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-2">
            <label className="block text-[11px] font-semibold text-slate-600 mb-1 dark:text-slate-300">Vínculo</label>
            <select
              value={linkedEntity}
              onChange={(e) => setLinkedEntity(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs bg-white dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
            >
              {Object.entries(LINKED_ENTITY_LABELS).map(([k, lbl]) => (
                <option key={k} value={k}>
                  {lbl}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-2">
            <label className="block text-[11px] font-semibold text-slate-600 mb-1 dark:text-slate-300">Status</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs bg-white dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
            >
              <option value="rascunho">Rascunho</option>
              <option value="publicado">Publicado</option>
              <option value="arquivado">Arquivado</option>
            </select>
          </div>

          <div className="md:col-span-8">
            <label className="block text-[11px] font-semibold text-slate-600 mb-1 dark:text-slate-300">Descrição / Instrução aos operadores</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Explique quando e como este formulário deve ser utilizado..."
              className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs dark:border-slate-600"
            />
          </div>

          <div className="md:col-span-4">
            <label className="block text-[11px] font-semibold text-slate-600 mb-1 dark:text-slate-300">Rótulo do Botão de Envio</label>
            <input
              type="text"
              value={submitLabel}
              onChange={(e) => setSubmitLabel(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-5 pt-1 text-xs text-slate-700 dark:text-slate-200">
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={isTemplate}
              onChange={(e) => setIsTemplate(e.target.checked)}
              className="rounded border-slate-300 dark:border-slate-600"
            />
            Salvar como Modelo Reutilizável
          </label>
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={iviAutoAnalyze}
              onChange={(e) => setIviAutoAnalyze(e.target.checked)}
              className="rounded border-slate-300 dark:border-slate-600"
            />
            Análise automática pela Ivi IA após envio
          </label>
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={requiresReview}
              onChange={(e) => setRequiresReview(e.target.checked)}
              className="rounded border-slate-300 dark:border-slate-600"
            />
            Exigir triagem/aprovação manual nas consultas
          </label>
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={allowAnonymous}
              onChange={(e) => setAllowAnonymous(e.target.checked)}
              className="rounded border-slate-300 dark:border-slate-600"
            />
            Liberar link externo de leitura
          </label>
        </div>

        {errMsg && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-800/70 dark:bg-rose-950/50 dark:text-rose-300">
            {errMsg}
          </div>
        )}
      </div>

      {/* 2-Column Workspace: Left Fields Palette + Ordered List | Right Field Inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        <div className="lg:col-span-7 rounded-xl border border-slate-200 bg-white p-4 space-y-4 dark:border-slate-700 dark:bg-slate-900">
          <div className="space-y-2">
            <div className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
              Adicionar Campo ao Formulário
            </div>
            <div className="flex flex-wrap gap-1.5">
              {FIELD_TYPE_CATALOG.map((ft) => (
                <button
                  key={ft.type}
                  type="button"
                  onClick={() => handleAddField(ft.type)}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <Plus className="w-3 h-3 text-blue-600 dark:text-blue-400" />
                  {ft.label}
                </button>
              ))}
            </div>
          </div>

          <div className="border-t border-slate-100 pt-3 space-y-2 dark:border-slate-800">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-800 dark:text-slate-100">
                Estrutura de Campos ({fields.length})
              </span>
              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                Clique em um campo para configurar validações e regras condicionais
              </span>
            </div>

            {fields.length === 0 ? (
              <div className="py-10 text-center text-xs text-slate-500 border border-dashed border-slate-200 rounded-lg dark:text-slate-400 dark:border-slate-700">
                Use os botões acima para adicionar seções e perguntas ao formulário.
              </div>
            ) : (
              <div className="space-y-1.5">
                {fields.map((fld, idx) => {
                  const isSel = fld.id === selectedFieldId;
                  const typeLbl = FIELD_TYPE_CATALOG.find((t) => t.type === fld.type)?.label || fld.type;
                  return (
                    <div
                      key={fld.id}
                      onClick={() => setSelectedFieldId(fld.id)}
                      className={`rounded-lg border px-3 py-2.5 flex items-center justify-between gap-2 cursor-pointer transition-colors ${
                        isSel
                          ? 'border-blue-600 bg-blue-50/50 dark:bg-blue-950/50'
                          : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 text-xs">
                          <span className="font-mono text-[11px] text-slate-400 tabular-nums dark:text-slate-400">
                            {String(idx + 1).padStart(2, '0')}.
                          </span>
                          <span className="font-semibold text-slate-900 truncate dark:text-slate-100">
                            {fld.label}
                          </span>
                          {fld.required && <span className="text-rose-600 font-bold dark:text-rose-400">*</span>}
                        </div>
                        <div className="text-[11px] text-slate-500 font-mono mt-0.5 truncate dark:text-slate-400">
                          {typeLbl} · chave: {fld.key} · largura: {fld.width === 'half' ? '1/2' : '1/1'}
                          {fld.conditionalFieldId ? ' · condicional' : ''}
                        </div>
                      </div>

                      <div
                        className="flex items-center gap-1 shrink-0"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          disabled={idx === 0}
                          onClick={() => handleMoveField(idx, -1)}
                          className="rounded border border-slate-200 p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-30 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
                          title="Mover para cima"
                        >
                          <ArrowUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={idx === fields.length - 1}
                          onClick={() => handleMoveField(idx, 1)}
                          className="rounded border border-slate-200 p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-30 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
                          title="Mover para baixo"
                        >
                          <ArrowDown className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDuplicateField(fld)}
                          className="rounded border border-slate-200 p-1 text-slate-500 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
                          title="Duplicar campo"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteField(fld.id)}
                          className="rounded border border-slate-200 p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-700 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-rose-950/60"
                          title="Remover campo"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Field Property Inspector */}
        <div className="lg:col-span-5 rounded-xl border border-slate-200 bg-white p-4 space-y-3 dark:border-slate-700 dark:bg-slate-900">
          <h3 className="font-display text-xs font-bold text-slate-900 border-b border-slate-100 pb-2 dark:text-slate-100 dark:border-slate-800">
            Propriedades do Campo Selecionado
          </h3>

          {!selectedField ? (
            <div className="py-10 text-center text-xs text-slate-500 dark:text-slate-400">
              Selecione um campo na lista ao lado para editar suas propriedades.
            </div>
          ) : (
            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1 dark:text-slate-300">
                  Rótulo / Pergunta *
                </label>
                <input
                  type="text"
                  value={selectedField.label}
                  onChange={(e) =>
                    handleUpdateField(selectedField.id, { label: e.target.value })
                  }
                  className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium dark:border-slate-600"
                />
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1 dark:text-slate-300">
                    Tipo do Campo
                  </label>
                  <select
                    value={selectedField.type}
                    onChange={(e) =>
                      handleUpdateField(selectedField.id, {
                        type: e.target.value as CustomFormFieldType,
                      })
                    }
                    className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs bg-white dark:border-slate-600 dark:bg-slate-900"
                  >
                    {FIELD_TYPE_CATALOG.map((ft) => (
                      <option key={ft.type} value={ft.type}>
                        {ft.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1 dark:text-slate-300">
                    Chave Técnica (Exportação)
                  </label>
                  <input
                    type="text"
                    value={selectedField.key}
                    onChange={(e) =>
                      handleUpdateField(selectedField.id, {
                        key: e.target.value.replace(/[^a-zA-Z0-9_]/g, '_'),
                      })
                    }
                    className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-mono dark:border-slate-600"
                  />
                </div>
              </div>

              {selectedField.type !== 'section_header' && (
                <>
                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1 dark:text-slate-300">
                        Largura na Grade
                      </label>
                      <select
                        value={selectedField.width || 'full'}
                        onChange={(e) =>
                          handleUpdateField(selectedField.id, {
                            width: e.target.value as 'full' | 'half',
                          })
                        }
                        className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs bg-white dark:border-slate-600 dark:bg-slate-900"
                      >
                        <option value="full">Linha Inteira (100%)</option>
                        <option value="half">Meia Linha (50%)</option>
                      </select>
                    </div>

                    <div className="flex items-end pb-1.5">
                      <label className="inline-flex items-center gap-2 cursor-pointer font-semibold text-slate-700 dark:text-slate-200">
                        <input
                          type="checkbox"
                          checked={selectedField.required}
                          onChange={(e) =>
                            handleUpdateField(selectedField.id, { required: e.target.checked })
                          }
                          className="rounded border-slate-300 dark:border-slate-600"
                        />
                        Preenchimento Obrigatório
                      </label>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1 dark:text-slate-300">
                      Placeholder / Exemplo
                    </label>
                    <input
                      type="text"
                      value={selectedField.placeholder || ''}
                      onChange={(e) =>
                        handleUpdateField(selectedField.id, { placeholder: e.target.value })
                      }
                      className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs dark:border-slate-600"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1 dark:text-slate-300">
                      Texto de Ajuda
                    </label>
                    <input
                      type="text"
                      value={selectedField.helpText || ''}
                      onChange={(e) =>
                        handleUpdateField(selectedField.id, { helpText: e.target.value })
                      }
                      className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs dark:border-slate-600"
                    />
                  </div>

                  {(selectedField.type === 'select' ||
                    selectedField.type === 'radio' ||
                    selectedField.type === 'checkbox_group') && (
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1 dark:text-slate-300">
                        Alternativas (uma opção por linha)
                      </label>
                      <textarea
                        rows={4}
                        value={(selectedField.options || []).join('\n')}
                        onChange={(e) =>
                          handleUpdateField(selectedField.id, {
                            options: e.target.value.split('\n').map((s) => s.trimStart()),
                          })
                        }
                        className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs dark:border-slate-600"
                      />
                    </div>
                  )}

                  {selectedField.type === 'rating' && (
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1 dark:text-slate-300">
                        Escala Máxima
                      </label>
                      <select
                        value={String(selectedField.maxRating || 5)}
                        onChange={(e) =>
                          handleUpdateField(selectedField.id, { maxRating: Number(e.target.value) })
                        }
                        className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs bg-white dark:border-slate-600 dark:bg-slate-900"
                      >
                        <option value="5">1 a 5 (Estrelas)</option>
                        <option value="10">0 a 10 (NPS)</option>
                      </select>
                    </div>
                  )}

                  {/* Regra Condicional */}
                  <div className="border-t border-slate-100 pt-2.5 space-y-2 dark:border-slate-800">
                    <div className="text-[11px] font-semibold text-slate-700 dark:text-slate-200">
                      Exibição Condicional (Opcional)
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <select
                        value={selectedField.conditionalFieldId || ''}
                        onChange={(e) =>
                          handleUpdateField(selectedField.id, {
                            conditionalFieldId: e.target.value || undefined,
                          })
                        }
                        className="rounded-lg border border-slate-300 px-2 py-1.5 text-[11px] bg-white dark:border-slate-600 dark:bg-slate-900"
                      >
                        <option value="">Sempre visível</option>
                        {fields
                          .filter((f) => f.id !== selectedField.id && f.type !== 'section_header')
                          .map((pf) => (
                            <option key={pf.id} value={pf.id}>
                              Se: {pf.label}
                            </option>
                          ))}
                      </select>

                      {selectedField.conditionalFieldId && (
                        <input
                          type="text"
                          value={selectedField.conditionalEquals || ''}
                          onChange={(e) =>
                            handleUpdateField(selectedField.id, {
                              conditionalEquals: e.target.value,
                            })
                          }
                          placeholder="for igual a (ex: true)"
                          className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-[11px] dark:border-slate-600"
                        />
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
