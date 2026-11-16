import type {
  Client,
  CompanyLegalProcess,
  CompanyProcessRiskLevel,
  CompanyProcessStatus,
  CompanyProcessType,
  Unit,
} from '../../../types.ts';
import type { FormMergeContext } from '../../../lib/formTemplateRenderer.ts';

export const PROCESS_TYPES: Array<{ value: CompanyProcessType; label: string }> = [
  { value: 'TRABALHISTA', label: 'Trabalhista' },
  { value: 'CÍVEL', label: 'Cível' },
  { value: 'TRIBUTÁRIO', label: 'Tributário' },
  { value: 'CONSUMIDOR', label: 'Consumidor' },
  { value: 'CRIMINAL', label: 'Criminal' },
  { value: 'ADMINISTRATIVO', label: 'Administrativo' },
  { value: 'OUTRO', label: 'Outro' },
];

export const PROCESS_STATUSES: Array<{ value: CompanyProcessStatus; label: string }> = [
  { value: 'ATIVO', label: 'Ativo' },
  { value: 'SUSPENSO', label: 'Suspenso' },
  { value: 'ARQUIVADO', label: 'Arquivado' },
  { value: 'ENCERRADO_PROCEDENTE', label: 'Encerrado (Procedente)' },
  { value: 'ENCERRADO_IMPROCEDENTE', label: 'Encerrado (Improcedente)' },
  { value: 'ACORDO', label: 'Acordo' },
];

export const RISK_LEVELS: Array<{ value: CompanyProcessRiskLevel; label: string }> = [
  { value: 'BAIXO', label: 'Baixo' },
  { value: 'MEDIO', label: 'Médio' },
  { value: 'ALTO', label: 'Alto' },
  { value: 'CRITICO', label: 'Crítico' },
];

export const STATUS_BADGE_MAP: Record<string, { label: string; badgeClass: string; colorHex: string }> = {
  ATIVO: {
    label: 'Ativo',
    badgeClass: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800/70',
    colorHex: '#2563eb',
  },
  SUSPENSO: {
    label: 'Suspenso',
    badgeClass: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/60 dark:text-amber-200 dark:border-amber-800/70',
    colorHex: '#d97706',
  },
  ARQUIVADO: {
    label: 'Arquivado',
    badgeClass: 'bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-600',
    colorHex: '#64748b',
  },
  ENCERRADO_PROCEDENTE: {
    label: 'Encerrado (Proc.)',
    badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800/70',
    colorHex: '#059669',
  },
  ENCERRADO_IMPROCEDENTE: {
    label: 'Encerrado (Impr.)',
    badgeClass: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/60 dark:text-red-300 dark:border-red-800/70',
    colorHex: '#dc2626',
  },
  ACORDO: {
    label: 'Acordo',
    badgeClass: 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/60 dark:text-purple-300 dark:border-purple-800/70',
    colorHex: '#7c3aed',
  },
};

export const RISK_BADGE_MAP: Record<string, { label: string; badgeClass: string; activeBoxClass: string }> = {
  BAIXO: {
    label: 'Baixo',
    badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800/70',
    activeBoxClass: 'border-emerald-500 bg-emerald-50 text-emerald-800 ring-2 ring-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-200 dark:ring-emerald-800/70',
  },
  MEDIO: {
    label: 'Médio',
    badgeClass: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/60 dark:text-amber-200 dark:border-amber-800/70',
    activeBoxClass: 'border-amber-500 bg-amber-50 text-amber-900 ring-2 ring-amber-200 dark:bg-amber-950/60 dark:text-amber-200 dark:ring-amber-800/70',
  },
  ALTO: {
    label: 'Alto',
    badgeClass: 'bg-orange-50 text-orange-800 border-orange-200 dark:bg-orange-950/60 dark:text-orange-200 dark:border-orange-800/70',
    activeBoxClass: 'border-orange-500 bg-orange-50 text-orange-900 ring-2 ring-orange-200 dark:bg-orange-950/60 dark:text-orange-200 dark:ring-orange-800/70',
  },
  CRITICO: {
    label: 'Crítico',
    badgeClass: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/60 dark:text-red-300 dark:border-red-800/70',
    activeBoxClass: 'border-red-600 bg-red-50 text-red-800 ring-2 ring-red-200 dark:bg-red-950/60 dark:text-red-200 dark:ring-red-800/70',
  },
};

export const DEADLINE_TYPES = [
  'CONTESTAÇÃO',
  'RECURSO',
  'MANIFESTAÇÃO',
  'CUMPRIMENTO',
  'AUDIÊNCIA',
  'OUTRO',
] as const;

export const HEARING_TYPES = [
  'INICIAL',
  'INSTRUÇÃO',
  'JULGAMENTO',
  'CONCILIAÇÃO',
  'OUTRO',
] as const;

export const MOVEMENT_TYPES = [
  { value: 'DESPACHO', label: 'Despacho' },
  { value: 'DECISAO', label: 'Decisão' },
  { value: 'PETICAO', label: 'Petição' },
  { value: 'CERTIDAO', label: 'Certidão' },
  { value: 'SENTENCA', label: 'Sentença' },
  { value: 'AUDIENCIA', label: 'Audiência' },
] as const;

export function parseCurrencyToNumber(raw: string | null | undefined): number {
  if (!raw) return 0;
  const cleaned = String(raw)
    .replace(/R\$/gi, '')
    .replace(/\s+/g, '')
    .replace(/\./g, '')
    .replace(',', '.');
  const val = parseFloat(cleaned);
  return Number.isFinite(val) ? val : 0;
}

export function formatMoneyBRL(val: number): string {
  return val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function formatDateBR(dateStr: string | null | undefined): string {
  if (!dateStr) return '-';
  const s = String(dateStr).trim();
  if (!s) return '-';
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return s;
  const iso = s.slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString('pt-BR');
}

export function getUnitDisplayName(unit?: Unit | null): string {
  if (!unit) return 'Sem Unidade';
  return unit.name?.trim() || unit.legalName?.trim() || 'Sem Unidade';
}

export function sanitizeLegalHtml(rawHtml: string): string {
  if (!rawHtml) return '';
  return String(rawHtml)
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<(iframe|object|embed|form|meta|link)\b[^>]*>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/href\s*=\s*(['"])\s*javascript:[^'"]*\1/gi, 'href="#"')
    .replace(/src\s*=\s*(['"])\s*javascript:[^'"]*\1/gi, 'src=""');
}

export function buildCompanyLegalMergeContext(
  proc: Partial<CompanyLegalProcess> | null | undefined,
  clients: Client[],
  units: Unit[],
  currentUserName?: string
): FormMergeContext {
  const p = proc || {};
  const partner = p.partnerId ? clients.find((c) => c.id === p.partnerId) : undefined;
  const unit = p.unitId ? units.find((u) => u.id === p.unitId) : undefined;

  return {
    legalProcess: p,
    client: partner
      ? partner
      : {
          fullName: p.opposingParty || '',
          cpfCnpj: p.opposingPartyDocument || '',
          phone: '',
          email: '',
        },
    company: unit || undefined,
    collaborator: p.responsibleLawyer ? { name: p.responsibleLawyer } : undefined,
    currentUserName,
  };
}
