import type {
  CustomFormFieldType,
  CustomFormItem,
  CustomFormSubmissionItem,
  Unit,
} from '../../../types.ts';

export interface FormsClientOption {
  id: number;
  fullName: string;
  cpfCnpj: string;
  unitId: number;
}

export interface FormsAdmissionOption {
  id: number;
  clientId: number;
  protocolCode: string;
  bankName: string;
  contractNumber: string;
  unitId: number;
}

export interface FormsNegotiationOption {
  id: number;
  clientId: number;
  clientName: string;
  bankName: string;
  contractNumber: string;
  unitId: number;
}

export interface FormsBootstrapPayload {
  forms: CustomFormItem[];
  submissions: CustomFormSubmissionItem[];
  clients: FormsClientOption[];
  admissions: FormsAdmissionOption[];
  negotiations: FormsNegotiationOption[];
  units: Unit[];
  kpis: {
    totalForms: number;
    publishedForms: number;
    templatesCount: number;
    totalSubmissions: number;
    pendingReviewCount: number;
    approvedCount: number;
    avgScore: number | null;
  };
}

export const FORM_CATEGORY_LABELS: Record<string, string> = {
  triagem: 'Triagem & Qualificação',
  auditoria: 'Auditoria & Compliance',
  negociacao: 'Negociação Bancária',
  juridico: 'Jurídico & Risco',
  cobranca: 'Cobrança & Recuperação',
  atendimento: 'Atendimento & Agendamento',
  nps: 'Pesquisa & NPS',
  operacional: 'Operacional Geral',
};

export const LINKED_ENTITY_LABELS: Record<string, string> = {
  geral: 'Uso Geral',
  cliente: 'Cliente',
  admissao: 'Admissão / Dossiê',
  negociacao: 'Negociação Bancária',
  processo: 'Processo Jurídico',
  cobranca: 'Cobrança',
};

export const FORM_STATUS_CONFIG: Record<string, { label: string; textClass: string }> = {
  publicado: { label: 'Publicado', textClass: 'text-emerald-700' },
  rascunho: { label: 'Rascunho', textClass: 'text-amber-700' },
  arquivado: { label: 'Arquivado', textClass: 'text-slate-500' },
};

export const SUBMISSION_STATUS_CONFIG: Record<string, { label: string; textClass: string }> = {
  recebido: { label: 'Recebido', textClass: 'text-blue-700' },
  em_analise: { label: 'Em Análise', textClass: 'text-amber-700' },
  aprovado: { label: 'Aprovado', textClass: 'text-emerald-700' },
  pendente_ajuste: { label: 'Pendente Ajuste', textClass: 'text-rose-700' },
  arquivado: { label: 'Arquivado', textClass: 'text-slate-500' },
};

export const FIELD_TYPE_CATALOG: Array<{ type: CustomFormFieldType; label: string }> = [
  { type: 'section_header', label: 'Cabeçalho de Seção' },
  { type: 'text', label: 'Texto Curto' },
  { type: 'textarea', label: 'Texto Longo / Parecer' },
  { type: 'number', label: 'Número' },
  { type: 'currency', label: 'Valor (R$)' },
  { type: 'date', label: 'Data' },
  { type: 'select', label: 'Lista Suspensa' },
  { type: 'radio', label: 'Seleção Única (Rádio)' },
  { type: 'checkbox_group', label: 'Múltipla Escolha' },
  { type: 'boolean', label: 'Sim / Não' },
  { type: 'rating', label: 'Escala / Nota NPS' },
  { type: 'cpf_cnpj', label: 'CPF / CNPJ' },
  { type: 'phone', label: 'Telefone / WhatsApp' },
  { type: 'email', label: 'E-mail' },
  { type: 'file_note', label: 'Referência Documental' },
];
