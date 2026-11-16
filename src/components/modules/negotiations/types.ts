import type {
  Admission,
  BankContactItem,
  BankItem,
  Client,
  CollaboratorItem,
  CommercialDeal,
  CommercialStage,
  DocumentObject,
  FinancialTitle,
  GotalkChannelPublic,
  GotalkHsmTemplate,
  GotalkOperatorPublic,
  ModalityItem,
  Negotiation,
  NegotiationGoal,
  RecalcScenario,
  SeriesItem,
  Unit,
  WhatsappMessage,
  WhatsappThread,
} from '../../../types.ts';

export type AvailableTitleRow = FinancialTitle & {
  clientName: string;
  contractNumber: string;
  bankName: string;
  collaboratorName: string;
  currentBalanceCents: number;
  currentBalance: string;
  originalValue: string;
  hasActiveNegotiation: boolean;
};

export interface PublicUserSummary {
  id: number;
  name: string;
  email?: string;
  role: string;
  points: number;
  whatsappPhone?: string;
}

export interface NegotiationsBootstrapPayload {
  negotiations: Negotiation[];
  banks: BankItem[];
  collaborators: CollaboratorItem[];
  users?: PublicUserSummary[];
  clients: Client[];
  admissions: Admission[];
  units: Unit[];
  availableTitles: AvailableTitleRow[];
  allReceberTitles?: AvailableTitleRow[];
  goals: NegotiationGoal[];
  commercialDeals: CommercialDeal[];
}

export interface ClientModalContextPayload {
  client: Client | null;
  documents: DocumentObject[];
  recalcScenarios: RecalcScenario[];
  whatsappThreads: WhatsappThread[];
  whatsappMessages: WhatsappMessage[];
  modalities: ModalityItem[];
  series: SeriesItem[];
  gotalkChannels: GotalkChannelPublic[];
  gotalkOperators: GotalkOperatorPublic[];
  gotalkHsmTemplates: GotalkHsmTemplate[];
  users: PublicUserSummary[];
}

export interface WhatsappMessageItem {
  id: number;
  threadId: number;
  externalMessageId?: string | null;
  direction: string;
  contentType: string;
  body: string;
  attachmentUrl?: string | null;
  attachmentName?: string | null;
  attachmentMimeType?: string | null;
  iviAudioTranscript?: string | null;
  ackStatus?: number | null;
  senderName: string;
  operatorName?: string | null;
  contactName?: string;
  contactPhone?: string;
  bankContactId?: number | null;
  bankContactName?: string;
  provider?: string;
  createdAt: string;
}

export interface UazapiInstanceSummary {
  id: number;
  unitId: number;
  label: string;
  uazapiInstanceId: string;
  phoneNumber?: string | null;
  isConnected: boolean;
  isDefaultForUnit: boolean;
  active: boolean;
}

export interface WhatsappDualPayload {
  client: { id: number; name: string; phone?: string; mobile?: string };
  bank: { id: number | null; name: string };
  bankContacts: BankContactItem[];
  clientThreads: Array<{
    id: number;
    contactName: string;
    contactPhone: string;
    provider: string;
    uazapiInstanceId?: string | null;
    channelDbId?: number | null;
    operatorName?: string | null;
    lastMessagePreview: string;
  }>;
  clientMessages: WhatsappMessageItem[];
  bankThreads: Array<{
    id: number;
    bankContactId?: number | null;
    contactName: string;
    contactPhone: string;
    provider: string;
    uazapiInstanceId?: string | null;
    channelDbId?: number | null;
    operatorName?: string | null;
    lastMessagePreview: string;
  }>;
  bankMessages: WhatsappMessageItem[];
  providers?: {
    gotalkConfigured: boolean;
    uazapiConfigured: boolean;
    uazapiInstances: UazapiInstanceSummary[];
    gotalkChannels: GotalkChannelPublic[];
    gotalkHsmTemplates: GotalkHsmTemplate[];
  };
}

export const NEGOTIATION_STATUS_CONFIG: Record<
  string,
  { label: string; badgeClass: string; dotClass: string }
> = {
  ABERTA: {
    label: 'Aberta',
    badgeClass: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800/70',
    dotClass: 'bg-blue-500',
  },
  EM_ANDAMENTO: {
    label: 'Em Andamento',
    badgeClass: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800/70',
    dotClass: 'bg-amber-500',
  },
  ACORDO_FECHADO: {
    label: 'Acordo Fechado',
    badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800/70',
    dotClass: 'bg-emerald-500',
  },
  ACORDO_QUEBRADO: {
    label: 'Acordo Quebrado',
    badgeClass: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/60 dark:text-red-300 dark:border-red-800/70',
    dotClass: 'bg-red-500',
  },
  CANCELADA: {
    label: 'Cancelada',
    badgeClass: 'bg-slate-100 text-slate-600 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-600',
    dotClass: 'bg-slate-400',
  },
  ENCERRADA: {
    label: 'Encerrada',
    badgeClass: 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/60 dark:text-purple-300 dark:border-purple-800/70',
    dotClass: 'bg-purple-500',
  },
};

export const CONTACT_TYPE_LABELS: Record<string, string> = {
  LIGACAO_REALIZADA: 'Ligação Realizada',
  LIGACAO_RECEBIDA: 'Ligação Recebida',
  WHATSAPP: 'WhatsApp',
  EMAIL: 'E-mail',
  PRESENCIAL: 'Presencial',
  REUNIAO: 'Reunião',
  OUTROS: 'Outros',
};

export const CONTACT_RESULT_LABELS: Record<string, string> = {
  PROPOSTA_APRESENTADA: 'Proposta Apresentada',
  RECUSA: 'Recusa',
  SEM_RESPOSTA: 'Sem Resposta',
  PROMESSA_RETORNO: 'Promessa de Retorno',
  ACORDO: 'Acordo Firmado',
  OUTROS: 'Outros',
};

export const PROPOSAL_ORIGIN_LABELS: Record<string, string> = {
  NOSSA_PROPOSTA: 'Nossa Proposta',
  PROPOSTA_BANCO: 'Proposta do Banco',
  CONTRA_PROPOSTA_NOSSA: 'Nossa Contra-Proposta',
  CONTRA_PROPOSTA_BANCO: 'Contra-Proposta do Banco',
};

export const PROPOSAL_STATUS_CONFIG: Record<string, { label: string; badgeClass: string }> = {
  AGUARDANDO: { label: 'Aguardando', badgeClass: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800/70' },
  ACEITA: { label: 'Aceita', badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800/70' },
  RECUSADA: { label: 'Recusada', badgeClass: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/60 dark:text-red-300 dark:border-red-800/70' },
  CONTRA_PROPOSTA: { label: 'Contra-Proposta', badgeClass: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800/70' },
  EXPIRADA: { label: 'Expirada', badgeClass: 'bg-slate-100 text-slate-600 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-600' },
};

export const COMMERCIAL_STAGES: Array<{
  key: CommercialStage;
  label: string;
  headerClass: string;
  badgeClass: string;
}> = [
  {
    key: 'TRIAGEM',
    label: 'Triagem & Análise',
    headerClass: 'border-slate-300 bg-slate-100 text-slate-800 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200',
    badgeClass: 'bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-200',
  },
  {
    key: 'PROPOSTA',
    label: 'Proposta Elaborada',
    headerClass: 'border-blue-300 bg-blue-50 text-blue-900 dark:border-blue-700/70 dark:bg-blue-950/60 dark:text-blue-200',
    badgeClass: 'bg-blue-100 text-blue-800 dark:bg-blue-950/70 dark:text-blue-200',
  },
  {
    key: 'AGUARDANDO_BANCO',
    label: 'Aguardando Banco',
    headerClass: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700/70 dark:bg-amber-950/60 dark:text-amber-200',
    badgeClass: 'bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-200',
  },
  {
    key: 'FECHADO',
    label: 'Acordo Fechado',
    headerClass: 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-700/70 dark:bg-emerald-950/60',
    badgeClass: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-200',
  },
  {
    key: 'PERDIDO',
    label: 'Perdido / Arquivado',
    headerClass: 'border-red-300 bg-red-50 text-red-900 dark:border-red-700/70 dark:bg-red-950/60 dark:text-red-200',
    badgeClass: 'bg-red-100 text-red-800 dark:bg-red-950/70 dark:text-red-200',
  },
];
