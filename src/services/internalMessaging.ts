import { eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { internalMessages, units, userGroups } from '../db/schema.ts';

export type SectorKey =
  | 'agendamentos'
  | 'prospeccao'
  | 'admissao'
  | 'auditoria'
  | 'juridico'
  | 'negociacoes'
  | 'financeiro'
  | 'cobranca'
  | 'geral';

export interface SectorCatalogItem {
  key: SectorKey;
  label: string;
  shortLabel: string;
  menuGroup: string;
  defaultModuleId: string;
  moduleIds: string[];
}

export const SECTOR_CATALOG: SectorCatalogItem[] = [
  {
    key: 'agendamentos',
    label: 'Agendamentos',
    shortLabel: 'Agendas',
    menuGroup: 'Entrada & Atendimento',
    defaultModuleId: 'appointments',
    moduleIds: ['appointments'],
  },
  {
    key: 'prospeccao',
    label: 'Comercial → Prospecção',
    shortLabel: 'Prospecção',
    menuGroup: 'Entrada & Atendimento',
    defaultModuleId: 'prospection',
    moduleIds: ['prospection'],
  },
  {
    key: 'admissao',
    label: 'Comercial → Admissão',
    shortLabel: 'Admissão',
    menuGroup: 'Entrada & Atendimento',
    defaultModuleId: 'admission',
    moduleIds: ['admission'],
  },
  {
    key: 'auditoria',
    label: 'Auditoria & Boletos',
    shortLabel: 'Auditoria',
    menuGroup: 'Operação & Tratativa',
    defaultModuleId: 'audit',
    moduleIds: ['audit'],
  },
  {
    key: 'juridico',
    label: 'Jurídico & Escavador',
    shortLabel: 'Jurídico',
    menuGroup: 'Operação & Tratativa',
    defaultModuleId: 'legal',
    moduleIds: ['legal'],
  },
  {
    key: 'negociacoes',
    label: 'Negociações Bancárias',
    shortLabel: 'Negociações',
    menuGroup: 'Operação & Tratativa',
    defaultModuleId: 'negotiations',
    moduleIds: ['negotiations'],
  },
  {
    key: 'financeiro',
    label: 'Receita → Administração Financeira',
    shortLabel: 'Financeiro',
    menuGroup: 'Receita',
    defaultModuleId: 'finance_receber',
    moduleIds: [
      'finance',
      'finance_receber',
      'finance_pagar',
      'finance_regua',
      'finance_operacao',
      'finance_conta_corrente',
      'finance_movimento',
      'finance_conciliacao',
    ],
  },
  {
    key: 'cobranca',
    label: 'Receita → Cobrança & Ranking',
    shortLabel: 'Cobrança',
    menuGroup: 'Receita',
    defaultModuleId: 'collection_operacional',
    moduleIds: ['collection', 'collection_coordenacao', 'collection_operacional'],
  },
  {
    key: 'geral',
    label: 'Geral / Empresa',
    shortLabel: 'Geral',
    menuGroup: 'Operação & Tratativa',
    defaultModuleId: 'internal_messaging',
    moduleIds: ['internal_messaging', 'overview'],
  },
];

export function normalizeSectorKey(raw?: string | null, subjectHint?: string): SectorKey {
  const s = String(raw || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  if (s === 'agendamentos' || s === 'agendamento' || s === 'appointments' || s === 'agenda') {
    return 'agendamentos';
  }
  if (s === 'prospeccao' || s === 'prospection') {
    return 'prospeccao';
  }
  if (s === 'admissao' || s === 'admission') {
    return 'admissao';
  }
  if (s === 'comercial') {
    const hint = String(subjectHint || '').toLowerCase();
    if (hint.includes('prospec')) return 'prospeccao';
    if (hint.includes('agend')) return 'agendamentos';
    return 'admissao';
  }
  if (s === 'auditoria' || s === 'audit') {
    return 'auditoria';
  }
  if (s === 'juridico' || s === 'legal' || s === 'acomp_juridico') {
    return 'juridico';
  }
  if (s === 'negociacoes' || s === 'negociacao' || s === 'negotiations') {
    return 'negociacoes';
  }
  if (
    s === 'financeiro' ||
    s === 'finance' ||
    s === 'finance_receber' ||
    s === 'finance_pagar' ||
    s === 'finance_regua' ||
    s === 'contas_receber' ||
    s === 'contas_pagar'
  ) {
    return 'financeiro';
  }
  if (
    s === 'cobranca' ||
    s === 'collection' ||
    s === 'cobranca_coordenacao' ||
    s === 'cobranca_operacional' ||
    s === 'collection_coordenacao' ||
    s === 'collection_operacional'
  ) {
    return 'cobranca';
  }
  return 'geral';
}

export function getSectorMeta(sector: string): SectorCatalogItem {
  const key = normalizeSectorKey(sector);
  return SECTOR_CATALOG.find((item) => item.key === key) || SECTOR_CATALOG[SECTOR_CATALOG.length - 1];
}

export interface DispatchIviNotificationParams {
  targetSector: SectorKey | string;
  subject: string;
  body: string;
  senderId?: number | null;
  senderName?: string;
  senderGroupId?: number | null;
  recipientId?: number | null;
  targetGroupId?: number | null;
  targetGroupName?: string;
  targetUnitId?: number | null;
  targetUnitName?: string;
  isAutoIvi?: boolean;
  eventType?: string;
  relatedEntityType?: string;
  relatedEntityId?: string | number | null;
}

type DbExecutor = Pick<typeof db, 'select' | 'insert'>;

export async function dispatchIviSectorNotification(
  params: DispatchIviNotificationParams,
  executor?: DbExecutor,
  broadcastFn?: (event: string, payload: unknown) => void
) {
  const exec = executor || db;
  const sectorKey = normalizeSectorKey(params.targetSector, params.subject);
  const sectorMeta = getSectorMeta(sectorKey);

  let resolvedUnitName = params.targetUnitName || '';
  if (params.targetUnitId && !resolvedUnitName) {
    const uRows = await exec.select().from(units).where(eq(units.id, params.targetUnitId)).limit(1);
    if (uRows[0]) {
      resolvedUnitName = `${uRows[0].code} · ${uRows[0].name}`;
    }
  }

  let resolvedGroupName = params.targetGroupName || '';
  if (params.targetGroupId && !resolvedGroupName) {
    const gRows = await exec.select().from(userGroups).where(eq(userGroups.id, params.targetGroupId)).limit(1);
    if (gRows[0]) {
      resolvedGroupName = gRows[0].name;
    }
  }
  if (!resolvedGroupName) {
    resolvedGroupName = `Setor: ${sectorMeta.label}`;
  }
  if (!resolvedUnitName) {
    resolvedUnitName = params.targetUnitId ? `Unidade #${params.targetUnitId}` : 'Todas as Unidades';
  }

  const [created] = await exec
    .insert(internalMessages)
    .values({
      senderId: params.senderId ?? null,
      senderName: params.senderName || 'Ivi IA · Orquestradora',
      senderGroupId: params.senderGroupId ?? null,
      recipientId: params.recipientId ?? null,
      targetSector: sectorKey,
      targetGroupId: params.targetGroupId ?? null,
      targetGroupName: resolvedGroupName,
      targetUnitId: params.targetUnitId ?? null,
      targetUnitName: resolvedUnitName,
      isAutoIvi: params.isAutoIvi !== undefined ? params.isAutoIvi : true,
      eventType: params.eventType || 'task_handoff',
      relatedEntityType: params.relatedEntityType || '',
      relatedEntityId:
        params.relatedEntityId !== undefined && params.relatedEntityId !== null
          ? String(params.relatedEntityId)
          : '',
      subject: params.subject,
      body: params.body,
      readByUserIds: [],
    })
    .returning();

  if (broadcastFn && created) {
    broadcastFn('internal:message', {
      ...created,
      sector: sectorKey,
      sectorLabel: sectorMeta.label,
    });
  }

  return created;
}
