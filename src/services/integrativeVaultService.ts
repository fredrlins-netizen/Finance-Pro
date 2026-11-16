import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { admissions, auditLogs, documentObjects, units } from '../db/schema.ts';

export type IntegrativeEntityType = 'DOSS' | 'DOC';

function getIntegrativeHmacSecret(): string {
  return (
    process.env.VAULT_INTEGRATIVE_SECRET?.trim() ||
    process.env.ENCRYPTION_KEY?.trim() ||
    process.env.SQL_PASSWORD?.trim() ||
    'invicta-financepro-hmac-integrative-v1'
  );
}

export function normalizeCodeToken(raw: string): string {
  return String(raw || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .trim();
}

export function cleanUnitCodeSegment(unitCode: string): string {
  const cleaned = normalizeCodeToken(unitCode).slice(0, 6);
  return cleaned || 'GEN';
}

export function computeIntegrativeHmac8(params: {
  unitCode: string;
  entityType: IntegrativeEntityType;
  entityId: number;
  referenceSeed: string;
}): string {
  const payload = `${cleanUnitCodeSegment(params.unitCode)}:${params.entityType}:${params.entityId}:${String(
    params.referenceSeed || ''
  ).trim()}`;
  return crypto
    .createHmac('sha256', getIntegrativeHmacSecret())
    .update(payload, 'utf8')
    .digest('hex')
    .slice(0, 8)
    .toUpperCase();
}

export function generateIntegrativeCode(params: {
  unitCode: string;
  entityType: IntegrativeEntityType;
  entityId: number;
  referenceSeed: string;
}): string {
  const unitSeg = cleanUnitCodeSegment(params.unitCode);
  const idSeg = String(Math.max(1, Number(params.entityId) || 1)).padStart(6, '0');
  const hmac8 = computeIntegrativeHmac8(params);
  return `INV-${unitSeg}-${params.entityType}-${idSeg}-${hmac8}`;
}

export function parseIntegrativeCode(code: string): {
  unitCode: string;
  entityType: IntegrativeEntityType;
  entityId: number;
  hmac8: string;
} | null {
  const m = String(code || '')
    .trim()
    .toUpperCase()
    .match(/^INV-([A-Z0-9]{1,8})-(DOSS|DOC)-(\d{1,10})-([A-F0-9]{8})$/);
  if (!m) return null;
  const entityId = Number(m[3]);
  if (!Number.isFinite(entityId) || entityId <= 0) return null;
  return {
    unitCode: m[1],
    entityType: m[2] as IntegrativeEntityType,
    entityId,
    hmac8: m[4],
  };
}

export function verifyIntegrativeCodeAgainstRecord(params: {
  code: string;
  unitCode: string;
  entityType: IntegrativeEntityType;
  entityId: number;
  referenceSeed: string;
}): boolean {
  const parsed = parseIntegrativeCode(params.code);
  if (!parsed) return false;
  if (parsed.entityType !== params.entityType || parsed.entityId !== params.entityId) return false;
  if (parsed.unitCode !== cleanUnitCodeSegment(params.unitCode)) return false;
  const expected = computeIntegrativeHmac8({
    unitCode: params.unitCode,
    entityType: params.entityType,
    entityId: params.entityId,
    referenceSeed: params.referenceSeed,
  });
  try {
    return crypto.timingSafeEqual(Buffer.from(parsed.hmac8, 'utf8'), Buffer.from(expected, 'utf8'));
  } catch {
    return false;
  }
}

/**
 * Extracts leading unit code from a Windows unit folder name.
 * Examples:
 *  - "MTZ - Matriz Recife" -> ["MTZ"]
 *  - "SSA_Salvador" -> ["SSA"]
 *  - "001 - Recife" -> ["001"]
 *  - "FOR" -> ["FOR"]
 */
export function extractUnitCodeCandidates(folderName: string): string[] {
  const raw = String(folderName || '').trim();
  if (!raw) return [];
  const candidates: string[] = [];
  // First token before whitespace, " - ", "_", ":", "("
  const leading = raw.split(/\s+[-–—]\s+|[_:()\[\]]|\s+/)[0]?.trim();
  if (leading) candidates.push(leading);
  const leadingHyphen = raw.split(/[-–—_\s]+/)[0]?.trim();
  if (leadingHyphen && !candidates.includes(leadingHyphen)) candidates.push(leadingHyphen);
  if (!candidates.includes(raw)) candidates.push(raw);
  return candidates;
}

/**
 * Extracts leading contract number from a Windows client folder name.
 * Examples:
 *  - "CT-2024-00981 - Joao da Silva" -> ["CT-2024-00981", "CT202400981"]
 *  - "4589210_Maria_Souza" -> ["4589210"]
 *  - "ADM-0042-11 - Carlos" -> ["ADM-0042-11"]
 */
export function extractContractCandidates(folderName: string): string[] {
  const raw = String(folderName || '').trim();
  if (!raw) return [];
  const candidates = new Set<string>();

  // Before " - " separator (common naming: "<CONTRACT> - <Client Name>")
  const beforeDash = raw.split(/\s+[-–—]\s+/)[0]?.trim();
  if (beforeDash) candidates.add(beforeDash);

  // Before "_" or "(" or "["
  const beforeSep = raw.split(/[_(\[]/)[0]?.trim();
  if (beforeSep) candidates.add(beforeSep);

  // Leading alphanumeric/hyphen/slash token before first space
  const beforeSpace = raw.split(/\s+/)[0]?.trim();
  if (beforeSpace) candidates.add(beforeSpace);

  // Leading digits block if folder starts with numeric contract
  const digitsMatch = raw.match(/^(\d{3,})/);
  if (digitsMatch?.[1]) candidates.add(digitsMatch[1]);

  return Array.from(candidates).filter(Boolean);
}

export function inferDocCategoryFromPath(relativeSubpath: string, fileName: string): string {
  const text = `${relativeSubpath} ${fileName}`
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  if (text.includes('procurac')) return 'procuracao';
  if (text.includes('crlv') || text.includes('veicul') || text.includes('dut') || text.includes('renavam')) return 'crlv';
  if (text.includes('resid') || text.includes('comprovante_end') || text.includes('agua') || text.includes('luz')) return 'residencia';
  if (text.includes('aditiv')) return 'aditivo';
  if (text.includes('cancel') || text.includes('distrat')) return 'termo_cancelamento';
  if (text.includes('comprov') || text.includes('bolet') || text.includes('recibo') || text.includes('pix')) return 'comprovante';
  if (text.includes('audio') || text.endsWith('.ogg') || text.endsWith('.mp3') || text.endsWith('.wav') || text.endsWith('.m4a')) return 'audio_whatsapp';
  if (text.includes('cnh') || text.includes('rg') || text.includes('cpf') || text.includes('pessoal') || text.includes('identid')) return 'pessoal';
  if (text.includes('ficha')) return 'ficha_admissao';
  if (text.includes('contrat')) return 'contrato';
  return 'contrato';
}

export async function assignIntegrativeCodesBatch(params: {
  unitId?: number | null;
  overwrite?: boolean;
  actorUserId?: number | null;
  actorName: string;
}): Promise<{
  admissionsUpdated: number;
  documentsUpdated: number;
  skippedAlreadyAssigned: number;
}> {
  const allUnits = await db.select().from(units);
  const unitCodeMap = new Map<number, string>();
  for (const u of allUnits) {
    unitCodeMap.set(u.id, u.code || `U${u.id}`);
  }

  const admRows = params.unitId
    ? await db.select().from(admissions).where(eq(admissions.unitId, params.unitId))
    : await db.select().from(admissions);

  let admissionsUpdated = 0;
  let documentsUpdated = 0;
  let skippedAlreadyAssigned = 0;

  for (const adm of admRows) {
    if (adm.integrativeCode && !params.overwrite) {
      skippedAlreadyAssigned++;
      continue;
    }
    const unitCode = unitCodeMap.get(adm.unitId) || `U${adm.unitId}`;
    const code = generateIntegrativeCode({
      unitCode,
      entityType: 'DOSS',
      entityId: adm.id,
      referenceSeed: adm.contractNumber || adm.protocolCode,
    });
    const legacyProto = adm.legacyProtocolCode || adm.protocolCode;
    await db
      .update(admissions)
      .set({
        integrativeCode: code,
        legacyProtocolCode: legacyProto,
      })
      .where(eq(admissions.id, adm.id));
    admissionsUpdated++;
  }

  const docRows = params.unitId
    ? await db.select().from(documentObjects).where(eq(documentObjects.unitId, params.unitId))
    : await db.select().from(documentObjects);

  for (const doc of docRows) {
    if (doc.deletedAt) continue;
    if (doc.integrativeCode && !params.overwrite) {
      skippedAlreadyAssigned++;
      continue;
    }
    const unitCode = unitCodeMap.get(doc.unitId) || `U${doc.unitId}`;
    const code = generateIntegrativeCode({
      unitCode,
      entityType: 'DOC',
      entityId: doc.id,
      referenceSeed: doc.sha256Hash || doc.fileName,
    });
    await db
      .update(documentObjects)
      .set({ integrativeCode: code })
      .where(eq(documentObjects.id, doc.id));
    documentsUpdated++;
  }

  await db.insert(auditLogs).values({
    userId: params.actorUserId ?? null,
    userName: params.actorName,
    action: 'INTEGRATIVE_HMAC_CODES_ASSIGNED',
    entityType: 'vault_integrative_code',
    entityId: String(admissionsUpdated + documentsUpdated),
    details: {
      unitId: params.unitId || 'ALL',
      overwrite: Boolean(params.overwrite),
      admissionsUpdated,
      documentsUpdated,
      skippedAlreadyAssigned,
    },
    unitId: params.unitId || null,
  });

  return { admissionsUpdated, documentsUpdated, skippedAlreadyAssigned };
}
