import React, { useRef, useState } from 'react';
import { CheckCircle2, FileUp, RefreshCw, Sparkles, Wand2, X } from 'lucide-react';
import { apiFetch } from '../../../lib/api.ts';
import type { CustomFormField, CustomFormItem, CustomFormSettings } from '../../../types.ts';
import { FIELD_TYPE_CATALOG, FORM_CATEGORY_LABELS, LINKED_ENTITY_LABELS } from './types.ts';

interface GeneratedDraft {
  title: string;
  description: string;
  category: string;
  linkedEntity: string;
  fields: CustomFormField[];
  settings: CustomFormSettings;
  provider: string;
}

interface FormIviStudioContainerProps {
  templates: CustomFormItem[];
  onSaveDraft: (draft: {
    title: string;
    description: string;
    category: string;
    linkedEntity: string;
    status: 'rascunho' | 'publicado';
    fieldsJson: CustomFormField[];
    settingsJson: CustomFormSettings;
    iviPromptOrigin: string;
  }, openInBuilder: boolean) => Promise<void>;
}

const QUICK_PROMPTS = [
  {
    label: 'Triagem Veicular & Busca',
    prompt:
      'Crie um formulário de triagem jurídica e financeira para contrato de financiamento veicular com dados do veículo, parcelas vencidas, verificação de risco de busca e apreensão e capacidade de pagamento à vista.',
    category: 'triagem',
    linkedEntity: 'cliente',
  },
  {
    label: 'Auditoria Pré-Protocolo',
    prompt:
      'Gere um checklist técnico de auditoria pré-protocolo validando contrato assinado, procuração, CCB bancária, pagamento da entrada e campo para parecer final do auditor.',
    category: 'auditoria',
    linkedEntity: 'admissao',
  },
  {
    label: 'Alçada de Acordo Bancário',
    prompt:
      'Monte um formulário para mesa de negociação registrar percentual de deságio autorizado pelo banco, valor da entrada, prazo de pagamento, contato da mesa e ciência do cliente.',
    category: 'negociacao',
    linkedEntity: 'negociacao',
  },
  {
    label: 'Pesquisa NPS Pós-Atendimento',
    prompt:
      'Crie uma pesquisa de satisfação NPS de 0 a 10 sobre clareza do consultor, canal preferido de atendimento e sugestões de melhoria.',
    category: 'nps',
    linkedEntity: 'cliente',
  },
];

export const FormIviStudioContainer: React.FC<FormIviStudioContainerProps> = ({
  templates,
  onSaveDraft,
}) => {
  const [prompt, setPrompt] = useState('');
  const [baseTemplateId, setBaseTemplateId] = useState<string>('');
  const [category, setCategory] = useState<string>('operacional');
  const [linkedEntity, setLinkedEntity] = useState<string>('cliente');
  const [refFile, setRefFile] = useState<File | null>(null);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [draft, setDraft] = useState<GeneratedDraft | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() && !baseTemplateId && !refFile) {
      setErrorMsg('Descreva o formulário no prompt, escolha um modelo base ou anexe um arquivo de referência.');
      return;
    }
    setErrorMsg('');
    setGenerating(true);
    try {
      const formData = new FormData();
      formData.append('prompt', prompt.trim());
      if (baseTemplateId) formData.append('baseTemplateId', baseTemplateId);
      formData.append('category', category);
      formData.append('linkedEntity', linkedEntity);
      if (refFile) {
        formData.append('file', refFile);
      }
      const res = await apiFetch<{ generated: GeneratedDraft }>('/api/forms/ivi-generate', {
        method: 'POST',
        body: formData,
      });
      setDraft(res.generated);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao gerar formulário com a Ivi IA.');
    } finally {
      setGenerating(false);
    }
  };

  const handlePersist = async (publishImmediately: boolean) => {
    if (!draft) return;
    setSaving(true);
    setErrorMsg('');
    try {
      await onSaveDraft(
        {
          title: draft.title,
          description: draft.description,
          category: draft.category,
          linkedEntity: draft.linkedEntity,
          status: publishImmediately ? 'publicado' : 'rascunho',
          fieldsJson: draft.fields,
          settingsJson: draft.settings,
          iviPromptOrigin: prompt.trim() || `Gerado via Ivi IA (${refFile?.name || 'modelo'})`,
        },
        !publishImmediately
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao salvar formulário gerado.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
      {/* Left 5 cols: Prompt, Model Selection & Reference File Upload */}
      <form
        onSubmit={handleGenerate}
        className="lg:col-span-5 rounded-xl border border-slate-200 bg-white p-5 space-y-4"
      >
        <div className="flex items-start gap-3">
          <div className="h-9 w-9 rounded-lg bg-slate-900 text-emerald-400 flex items-center justify-center shrink-0">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <h2 className="font-display text-sm font-bold text-slate-900">
              Arquiteta de Formulários Ivi IA
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Descreva os campos necessários, selecione um modelo corporativo para adaptar ou envie um arquivo modelo (PDF, imagem, TXT ou CSV).
            </p>
          </div>
        </div>

        <div className="space-y-1.5">
          <span className="block text-[11px] font-semibold text-slate-600">
            Atalhos de Prompt FinancePro
          </span>
          <div className="flex flex-wrap gap-1.5">
            {QUICK_PROMPTS.map((qp) => (
              <button
                key={qp.label}
                type="button"
                onClick={() => {
                  setPrompt(qp.prompt);
                  setCategory(qp.category);
                  setLinkedEntity(qp.linkedEntity);
                }}
                className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100 hover:border-slate-300"
              >
                {qp.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-[11px] font-semibold text-slate-700 mb-1">
            Instruções / Prompt para a Ivi IA
          </label>
          <textarea
            rows={4}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Ex: Crie um formulário para análise de contrato revisional com identificação do cliente, banco credor, valor das parcelas, juros cobrados e bloco de aprovação da auditoria..."
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-blue-600 focus:outline-none"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] font-semibold text-slate-700 mb-1">
              Categoria
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-2.5 py-2 text-xs bg-white"
            >
              {Object.entries(FORM_CATEGORY_LABELS).map(([k, lbl]) => (
                <option key={k} value={k}>
                  {lbl}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-700 mb-1">
              Entidade Vinculada
            </label>
            <select
              value={linkedEntity}
              onChange={(e) => setLinkedEntity(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-2.5 py-2 text-xs bg-white"
            >
              {Object.entries(LINKED_ENTITY_LABELS).map(([k, lbl]) => (
                <option key={k} value={k}>
                  {lbl}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-[11px] font-semibold text-slate-700 mb-1">
            Adaptar a partir de um Modelo Existente (Opcional)
          </label>
          <select
            value={baseTemplateId}
            onChange={(e) => setBaseTemplateId(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-2.5 py-2 text-xs bg-white"
          >
            <option value="">Criar estrutura nova do zero</option>
            {templates.map((t) => (
              <option key={t.id} value={String(t.id)}>
                {t.code} · {t.title}
              </option>
            ))}
          </select>
        </div>

        {/* Upload Model Document */}
        <div>
          <label className="block text-[11px] font-semibold text-slate-700 mb-1">
            Anexar Arquivo Modelo de Referência (PDF, Imagem, TXT, CSV)
          </label>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.csv,.json,.md"
            onChange={(e) => {
              const f = e.target.files?.[0] || null;
              setRefFile(f);
            }}
            className="hidden"
          />
          {!refFile ? (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-full flex items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-xs font-medium text-slate-600 hover:bg-slate-100"
            >
              <FileUp className="w-4 h-4 text-slate-500" />
              Selecionar arquivo modelo para leitura pela Ivi IA
            </button>
          ) : (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
              <span className="truncate font-medium text-slate-800">{refFile.name}</span>
              <button
                type="button"
                onClick={() => {
                  setRefFile(null);
                  if (fileInputRef.current) fileInputRef.current.value = '';
                }}
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {errorMsg && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            {errorMsg}
          </div>
        )}

        <button
          type="submit"
          disabled={generating}
          className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {generating ? (
            <>
              <RefreshCw className="w-4 h-4 animate-spin" />
              Estruturando formulário com Ivi IA...
            </>
          ) : (
            <>
              <Wand2 className="w-4 h-4 text-emerald-400" />
              Gerar Estrutura de Formulário
            </>
          )}
        </button>
      </form>

      {/* Right 7 cols: Live Preview of Ivi Output */}
      <div className="lg:col-span-7 rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="border-b border-slate-200 px-5 py-3.5 flex flex-wrap items-center justify-between gap-2 bg-slate-50/70">
          <div>
            <h3 className="font-display text-sm font-bold text-slate-900">
              Pré-visualização da Estrutura Gerada
            </h3>
            <p className="text-[11px] text-slate-500">
              Revise os blocos e campos sugeridos pela Ivi IA antes de salvar no construtor ou publicar.
            </p>
          </div>
          {draft && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={() => void handlePersist(false)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
              >
                Ajustar no Construtor
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void handlePersist(true)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                {saving ? 'Salvando...' : 'Publicar Formulário'}
              </button>
            </div>
          )}
        </div>

        {!draft ? (
          <div className="p-12 text-center space-y-2">
            <Sparkles className="w-8 h-8 text-slate-300 mx-auto" />
            <div className="text-sm font-semibold text-slate-700">
              Nenhum rascunho gerado ainda
            </div>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              Preencha o prompt ao lado, escolha um modelo ou envie um documento de referência e clique em &ldquo;Gerar Estrutura de Formulário&rdquo;.
            </p>
          </div>
        ) : (
          <div className="p-5 space-y-4">
            <div className="border-b border-slate-200 pb-3">
              <div className="text-[11px] font-mono text-slate-500">
                {FORM_CATEGORY_LABELS[draft.category] || draft.category} ·{' '}
                {LINKED_ENTITY_LABELS[draft.linkedEntity] || draft.linkedEntity} ·{' '}
                {draft.fields.filter((f) => f.type !== 'section_header').length} campos
              </div>
              <h4 className="font-display text-base font-bold text-slate-900 mt-1">{draft.title}</h4>
              {draft.description && (
                <p className="text-xs text-slate-600 mt-0.5">{draft.description}</p>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {draft.fields.map((fld) => {
                if (fld.type === 'section_header') {
                  return (
                    <div
                      key={fld.id}
                      className="sm:col-span-2 pt-2 border-b border-slate-200 pb-1 text-xs font-bold text-slate-800"
                    >
                      {fld.label}
                    </div>
                  );
                }
                const typeLabel =
                  FIELD_TYPE_CATALOG.find((t) => t.type === fld.type)?.label || fld.type;
                return (
                  <div
                    key={fld.id}
                    className={`rounded-lg border border-slate-200 bg-slate-50/60 p-3 space-y-1 ${
                      fld.width === 'half' ? 'sm:col-span-1' : 'sm:col-span-2'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-900">
                        {fld.label}
                        {fld.required && <span className="text-rose-600 ml-1">*</span>}
                      </span>
                      <span className="text-[10px] font-mono text-slate-500 shrink-0">
                        {typeLabel}
                      </span>
                    </div>
                    {fld.helpText && <p className="text-[11px] text-slate-500">{fld.helpText}</p>}
                    {fld.options && fld.options.length > 0 && (
                      <div className="text-[11px] text-slate-600 pt-0.5">
                        Opções: {fld.options.join(' · ')}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
