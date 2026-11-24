import type { Express, Response } from 'express';
import multer from 'multer';
import { eq, desc, asc, inArray, and, or, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  negotiations,
  negotiationGoals,
  commercialDeals,
  clients,
  admissions,
  financialTitles,
  banks,
  bankServices,
  bankContacts,
  collaborators,
  modalities,
  seriesCatalog,
  units,
  users,
  unitWhatsappCredentials,
  whatsappThreads,
  whatsappMessages,
  documentObjects,
  recalcScenarios,
  communicationArchives,
  gotalkChannels,
  gotalkOperators,
  gotalkHsmTemplates,
  auditLogs,
  type NegotiationContactItem,
  type NegotiationProposalItem,
} from '../db/schema.js';
import { AuthRequest, requireAuth, requireModule } from '../middleware/auth.js';
import { parsePositiveIntId, parseSafeDate, sanitizeErrorMessage } from '../utils/validation.js';
import {
  iviAnalyzeNegotiationAdvisor,
  iviAskNegotiationCopilot,
  iviTranscribeAudioNote,
  type NegotiationAdvisorContextInput,
} from '../services/ivi.js';
import { dispatchIviSectorNotification } from '../services/internalMessaging.js';
import { isProductionModeLocked } from '../services/productionModeService.js';
import {
  isGotalkConfigured,
  phonesMatchBR,
  sendGotalkActiveNotification,
  sendGotalkFile,
  sendGotalkMessage,
  sendGotalkTemplateByName,
} from '../services/gotalk.js';
import {
  sendUazapiMedia,
  sendUazapiText,
  type UazapiCredentials,
} from '../services/uazapi.js';
import {
  putBucketObject,
  sanitizeFileName,
  validateUploadFile,
} from '../services/bucketStorage.js';

export interface NegotiationsRoutesDeps {
  broadcast: (event: string, payload: unknown) => void;
  resolveUazapiCredentials?: (opts?: {
    instanceId?: string | null;
    unitId?: number | null;
    groupId?: number | null;
    moduleId?: string | null;
  }) => Promise<(UazapiCredentials & { dbId?: number }) | null>;
  mirrorCommunicationToProspection?: (params: {
    unitId: number;
    phone: string;
    contactName: string;
    channel: 'whatsapp_gotalk' | 'whatsapp_uazapi' | 'telefone';
    provider: 'gotalk' | 'uazapi' | 'telefone';
    threadId?: number | null;
    direction: 'inbound' | 'outbound';
    contentType: 'text' | 'audio' | 'image' | 'document' | 'call';
    body: string;
    audioTranscript?: string | null;
    authorName?: string;
    externalMessageId?: string | null;
    callId?: string | null;
    mediaSha256?: string | null;
    mediaStorageUri?: string | null;
    mediaMimeType?: string | null;
    mediaFileName?: string | null;
    timestamp?: Date;
    triggerIviAutoSummarize?: boolean;
  }) => Promise<unknown>;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

let seedCompleted = false;
let seedEnrichmentPromise: Promise<void> | null = null;

function mapLegacyStatusToNegotiationStatus(legacyStatus: string, negotiationStatus?: string | null): string {
  const valid = ['ABERTA', 'EM_ANDAMENTO', 'ACORDO_FECHADO', 'ACORDO_QUEBRADO', 'CANCELADA', 'ENCERRADA'];
  if (negotiationStatus && valid.includes(negotiationStatus.toUpperCase())) {
    return negotiationStatus.toUpperCase();
  }
  const s = (legacyStatus || '').toLowerCase();
  if (s === 'meta_alcancada') return 'ACORDO_FECHADO';
  if (s === 'suspensa' || s === 'cancelada') return 'CANCELADA';
  if (s === 'aberta') return 'ABERTA';
  return 'EM_ANDAMENTO';
}

function mapNegotiationStatusToLegacy(negStatus: string, targetPct: number, currentPct: number): string {
  const st = (negStatus || '').toUpperCase();
  if (st === 'ACORDO_FECHADO') return 'meta_alcancada';
  if (st === 'CANCELADA' || st === 'ENCERRADA' || st === 'ACORDO_QUEBRADO') return 'suspensa';
  if (currentPct >= targetPct) return 'meta_alcancada';
  if (targetPct - currentPct <= 10) return 'proxima_meta';
  return 'em_negociacao';
}

function parseValueToCents(val: string | number | undefined | null): number {
  if (typeof val === 'number') {
    return val > 100000 ? Math.round(val) : Math.round(val * 100);
  }
  const raw = String(val || '0').trim();
  if (!raw) return 0;
  const normalized =
    raw.includes(',') && raw.includes('.')
      ? raw.replace(/\./g, '').replace(',', '.')
      : raw.includes(',')
      ? raw.replace(',', '.')
      : raw;
  const num = parseFloat(normalized.replace(/[^\d.-]/g, ''));
  return Number.isFinite(num) ? Math.round(num * 100) : 0;
}

function centsToDecimalString(cents: number | null | undefined): string {
  return ((Number(cents || 0) || 0) / 100).toFixed(2);
}

function getAllowedUnitScope(req: AuthRequest): number[] | null {
  if (!req.authUser) return null;
  if (req.authUser.role === 'admin') return null; // admin sees all permitted units
  const allowed = Array.isArray(req.authUser.allowedUnitIds) ? req.authUser.allowedUnitIds : [];
  if (req.activeUnitId && allowed.includes(req.activeUnitId)) {
    return [req.activeUnitId];
  }
  return allowed.length > 0 ? allowed : [req.authUser.defaultUnitId || 1];
}

function isUnitPermitted(req: AuthRequest, unitId: number | null | undefined): boolean {
  if (!req.authUser) return false;
  if (req.authUser.role === 'admin') return true;
  if (!unitId) return true;
  const allowed = Array.isArray(req.authUser.allowedUnitIds) ? req.authUser.allowedUnitIds : [1];
  return allowed.includes(unitId) || req.activeUnitId === unitId;
}

async function ensureNegotiationsEnrichedSeed() {
  if (await isProductionModeLocked()) {
    seedCompleted = true;
    return;
  }
  if (seedCompleted) return;
  if (seedEnrichmentPromise) return seedEnrichmentPromise;
  seedEnrichmentPromise = (async () => {
    try {
      if (await isProductionModeLocked()) {
        seedCompleted = true;
        return;
      }
      const [allBanks, initialBankContacts, allUnits] = await Promise.all([
        db.select().from(banks).orderBy(asc(banks.id)),
        db.select().from(bankContacts).orderBy(asc(bankContacts.id)),
        db.select().from(units).orderBy(asc(units.id)),
      ]);
      let allBankContacts = initialBankContacts;
      const defaultUnitId = allUnits[0]?.id || 1;

      const defaultContactsByBankName: Record<
        string,
        Array<{ name: string; sector: string; phone: string; mobile: string; isWhatsapp: boolean; email: string }>
      > = {
        bradesco: [
          {
            name: 'Marcelo Tavares',
            sector: 'Mesa de Acordos Veículos & Contencioso',
            phone: '(11) 3684-5500',
            mobile: '(11) 99412-8830',
            isWhatsapp: true,
            email: 'marcelo.tavares@bradesco.com.br',
          },
          {
            name: 'Camila Vasconcelos',
            sector: 'Alçada Especial Recuperação de Crédito',
            phone: '(11) 3684-5512',
            mobile: '(11) 99412-8845',
            isWhatsapp: true,
            email: 'camila.vasconcelos@bradesco.com.br',
          },
        ],
        pan: [
          {
            name: 'Rodrigo Siqueira',
            sector: 'Célula de Quitação Antecipada Veículos',
            phone: '(11) 3264-9100',
            mobile: '(11) 98821-4490',
            isWhatsapp: true,
            email: 'rodrigo.siqueira@bancopan.com.br',
          },
        ],
      };

      for (const b of allBanks) {
        const existingForBank = allBankContacts.filter((c) => c.bankId === b.id);
        if (existingForBank.length === 0) {
          const lower = b.name.toLowerCase();
          const presets =
            lower.includes('bradesco')
              ? defaultContactsByBankName.bradesco
              : lower.includes('pan')
              ? defaultContactsByBankName.pan
              : [
                  {
                    name: `Mesa de Acordos ${b.name}`,
                    sector: 'Recuperação de Ativos & Deságio',
                    phone: '(11) 3003-4050',
                    mobile: `(11) 99100-${String(1000 + b.id).slice(-4)}`,
                    isWhatsapp: true,
                    email: `acordos@${b.name.toLowerCase().replace(/[^a-z0-9]/g, '')}.com.br`,
                  },
                ];
          for (const preset of presets) {
            await db.insert(bankContacts).values({
              bankId: b.id,
              ...preset,
            });
          }
        }
      }

      allBankContacts = await db.select().from(bankContacts).orderBy(asc(bankContacts.id));
      const existingThreads = await db.select().from(whatsappThreads);

      for (const bc of allBankContacts) {
        const bankObj = allBanks.find((b) => b.id === bc.bankId);
        const bankLabel = bankObj ? bankObj.name : 'Banco';
        const bcPhone = bc.mobile || bc.phone || '';
        const existingThread = existingThreads.find(
          (t) => t.bankContactId === bc.id || (bcPhone && t.contactPhone && phonesMatchBR(t.contactPhone, bcPhone))
        );
        if (!existingThread) {
          const [createdThread] = await db
            .insert(whatsappThreads)
            .values({
              clientId: null,
              bankId: bc.bankId,
              bankContactId: bc.id,
              unitId: defaultUnitId,
              contactName: `${bc.name} (${bankLabel} · ${bc.sector})`,
              contactPhone: bcPhone || '(11) 99000-0000',
              provider: 'gotalk',
              operatorName: 'Carla Dias (Negociadora)',
              department: 'Negociação Bancária',
              unreadCount: 0,
              lastMessagePreview: `Alçada de deságio conferida na mesa do ${bankLabel}. Aguardando confirmação do boleto único.`,
            })
            .returning();

          if (createdThread) {
            await db.insert(whatsappMessages).values([
              {
                threadId: createdThread.id,
                direction: 'outbound',
                contentType: 'text',
                body: `Olá ${bc.name}, tudo bem? Encaminhei a proposta formal da carteira ${bankLabel} com pedido de deságio dentro da alçada de liquidação à vista.`,
                operatorName: 'Carla Dias (Negociadora)',
                department: 'Negociação Bancária',
                senderName: 'Carla Dias (Negociadora)',
                ackStatus: 3,
              },
              {
                threadId: createdThread.id,
                direction: 'inbound',
                contentType: 'text',
                body: `Olá Carla! Recebi aqui no setor ${bc.sector}. Para pagamento em parcela única até o fechamento da quinzena conseguimos defender 52% a 58% de desconto no comitê do ${bankLabel}.`,
                operatorName: 'Carla Dias (Negociadora)',
                department: 'Negociação Bancária',
                senderName: `${bc.name} (${bankLabel})`,
                ackStatus: 3,
              },
            ]);
          }
        } else if (!existingThread.bankContactId || !existingThread.bankId) {
          await db
            .update(whatsappThreads)
            .set({ bankId: bc.bankId, bankContactId: bc.id })
            .where(eq(whatsappThreads.id, existingThread.id));
        }
      }

      const allNegs = await db.select().from(negotiations).orderBy(asc(negotiations.id));
      const allClients = await db.select().from(clients);
      const allAdmissions = await db.select().from(admissions);
      const allCollabs = await db.select().from(collaborators);
      const allTitles = await db.select().from(financialTitles);

      for (let idx = 0; idx < allNegs.length; idx++) {
        const neg = allNegs[idx];
        if (neg.openDate && Array.isArray(neg.contactsJson) && neg.contactsJson.length > 0) {
          continue;
        }
        const client = allClients.find((c) => c.id === neg.clientId);
        const admission = allAdmissions.find((a) => a.id === neg.admissionId);
        const matchedBank =
          allBanks.find((b) => b.name.toLowerCase().includes(neg.bankName.toLowerCase().replace('banco ', '').trim())) ||
          allBanks.find((b) => neg.bankName.toLowerCase().includes(b.name.toLowerCase().replace('banco ', '').trim())) ||
          allBanks[0];
        const bankContact =
          allBankContacts.find((c) => matchedBank && c.bankId === matchedBank.id) || allBankContacts[0] || null;
        const collab =
          allCollabs.find((c) => c.userId === neg.negotiatorId) ||
          allCollabs[idx % Math.max(1, allCollabs.length)] ||
          null;
        const clientTitle =
          allTitles.find((t) => t.admissionId === neg.admissionId) ||
          allTitles.find((t) => t.clientId === neg.clientId) ||
          null;

        const openDateStr = neg.createdAt
          ? new Date(neg.createdAt).toISOString().slice(0, 10)
          : new Date(Date.now() - (15 - idx * 2) * 86400000).toISOString().slice(0, 10);
        const nextDateStr = new Date(Date.now() + ((idx % 5) + 1) * 86400000).toISOString().slice(0, 10);
        const debtReais = ((neg.originalDebtCents || 0) / 100).toFixed(2);
        const ourPropCents = Math.round((neg.originalDebtCents || 3000000) * (1 - (neg.targetReductionPct || 55) / 100));
        const bankCounterCents = Math.round(
          (neg.originalDebtCents || 3000000) * (1 - Math.max(25, (neg.currentReductionPct || 35)) / 100)
        );
        const negStatus = neg.status === 'meta_alcancada' ? 'ACORDO_FECHADO' : 'EM_ANDAMENTO';

        const seededContacts: NegotiationContactItem[] = [
          {
            id: Date.now() - 200000 - idx * 100,
            date: openDateStr,
            type: 'WHATSAPP',
            result: 'PROPOSTA_APRESENTADA',
            target: 'CLIENTE',
            description: `Alinhamento inicial com cliente ${client?.fullName || ''} sobre capacidade de liquidação à vista e autorização de contraproposta.`,
            responsible: collab?.name || 'Carla Dias (Negociadora)',
          },
          {
            id: Date.now() - 100000 - idx * 100,
            date: new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10),
            type: 'LIGACAO_REALIZADA',
            result: negStatus === 'ACORDO_FECHADO' ? 'ACORDO' : 'PROMESSA_RETORNO',
            target: 'BANCO',
            bankContactId: bankContact?.id || null,
            bankContactName: bankContact ? `${bankContact.name} (${bankContact.sector})` : neg.bankName,
            description: `Tratativa direta com ${bankContact?.name || 'mesa de acordos'} (${neg.bankName}). Apresentado pedido de ${neg.targetReductionPct}% de redução.`,
            responsible: collab?.name || 'Carla Dias (Negociadora)',
          },
        ];

        const seededProposals: NegotiationProposalItem[] = [
          {
            id: Date.now() - 150000 - idx * 100,
            date: openDateStr,
            origin: 'NOSSA_PROPOSTA',
            proposedValue: centsToDecimalString(ourPropCents),
            proposedValueCents: ourPropCents,
            discountPercentage: String(neg.targetReductionPct || 55),
            installments: 1,
            installmentValue: centsToDecimalString(ourPropCents),
            entryValue: '0.00',
            status: negStatus === 'ACORDO_FECHADO' ? 'ACEITA' : 'CONTRA_PROPOSTA',
            bankContactId: bankContact?.id || null,
            bankContactName: bankContact?.name || neg.bankName,
            notes: `Proposta ancorada na meta técnica de ${neg.targetReductionPct}% de desconto para quitação integral.`,
          },
          {
            id: Date.now() - 50000 - idx * 100,
            date: new Date(Date.now() - 1 * 86400000).toISOString().slice(0, 10),
            origin: 'CONTRA_PROPOSTA_BANCO',
            proposedValue: centsToDecimalString(bankCounterCents),
            proposedValueCents: bankCounterCents,
            discountPercentage: String(neg.currentReductionPct || 35),
            installments: 6,
            installmentValue: centsToDecimalString(Math.round(bankCounterCents / 6)),
            entryValue: centsToDecimalString(Math.round(bankCounterCents * 0.2)),
            status: negStatus === 'ACORDO_FECHADO' ? 'ACEITA' : 'AGUARDANDO',
            bankContactId: bankContact?.id || null,
            bankContactName: bankContact?.name || neg.bankName,
            notes: `Retorno da mesa do ${neg.bankName} com desconto de ${neg.currentReductionPct}% ou parcelamento em 6x.`,
          },
        ];

        await db
          .update(negotiations)
          .set({
            clientName: client?.fullName || `Cliente #${neg.clientId}`,
            bankId: matchedBank?.id || null,
            collaboratorId: collab?.id || null,
            collaboratorName: collab?.name || 'Carla Dias (Negociadora)',
            titleId: clientTitle?.id || null,
            contractNumber: admission?.contractNumber || clientTitle?.contractNumber || `CTR-2025-00${neg.id}`,
            openDate: openDateStr,
            debtValueText: debtReais,
            negotiationStatus: negStatus,
            contactsJson: seededContacts,
            proposalsJson: seededProposals,
            nextContactDate: negStatus === 'ACORDO_FECHADO' ? null : nextDateStr,
            nextContactDescription:
              negStatus === 'ACORDO_FECHADO'
                ? 'Acordo liquidado — acompanhar baixa do gravame'
                : `Retornar contato com ${bankContact?.name || neg.bankName} sobre alçada de ${neg.targetReductionPct}%`,
            notes: `Dossiê vinculado ao contrato ${admission?.contractNumber || `CTR-2025-00${neg.id}`} (${neg.bankName}). Meta de redução: ${neg.targetReductionPct}%.`,
            closedDate: negStatus === 'ACORDO_FECHADO' ? new Date().toISOString().slice(0, 10) : null,
            closedValueCents: negStatus === 'ACORDO_FECHADO' ? ourPropCents : null,
            closedValueText: negStatus === 'ACORDO_FECHADO' ? centsToDecimalString(ourPropCents) : null,
            closedInstallments: negStatus === 'ACORDO_FECHADO' ? 1 : null,
            selectedBankContactId: bankContact?.id || null,
          })
          .where(eq(negotiations.id, neg.id));
      }

      const existingGoals = await db.select().from(negotiationGoals);
      if (existingGoals.length === 0) {
        const now = new Date();
        const curMonth = now.getMonth() + 1;
        const curYear = now.getFullYear();
        const goalRows = allCollabs.slice(0, 4).map((c, idx) => ({
          collaboratorId: c.id,
          collaboratorName: c.name,
          unitId: c.unitId || defaultUnitId,
          month: curMonth,
          year: curYear,
          targetCount: 8 + idx * 2,
          targetSavingsCents: (65000 + idx * 15000) * 100,
          targetValue: (65000 + idx * 15000).toFixed(2),
        }));
        if (goalRows.length > 0) {
          await db.insert(negotiationGoals).values(goalRows);
        }
      }

      const existingDeals = await db.select().from(commercialDeals);
      if (existingDeals.length === 0 && allClients.length > 0) {
        const stages = ['TRIAGEM', 'PROPOSTA', 'AGUARDANDO_BANCO', 'FECHADO', 'PERDIDO'];
        const sampleDeals = allClients.slice(0, 5).map((cl, idx) => {
          const adm = allAdmissions.find((a) => a.clientId === cl.id);
          const bnk = allBanks[idx % Math.max(1, allBanks.length)];
          const col = allCollabs[idx % Math.max(1, allCollabs.length)];
          const debtCents = adm?.debtAmountCents || (32000 + idx * 11500) * 100;
          const discountPct = 45 + idx * 5;
          const propCents = Math.round(debtCents * (1 - discountPct / 100));
          return {
            clientId: cl.id,
            clientName: cl.fullName,
            admissionId: adm?.id || null,
            titleId: null,
            bankId: bnk?.id || null,
            bankName: bnk?.name || adm?.bankName || 'Banco BV',
            collaboratorId: col?.id || null,
            collaboratorName: col?.name || 'Carla Dias',
            unitId: cl.unitId || defaultUnitId,
            stage: stages[idx % stages.length],
            debtValueCents: debtCents,
            debtValue: centsToDecimalString(debtCents),
            proposedValueCents: propCents,
            proposedValue: centsToDecimalString(propCents),
            discountPercentage: String(discountPct),
            lossReason:
              stages[idx % stages.length] === 'PERDIDO'
                ? 'Cliente optou por aguardar revisão pericial antes do acordo'
                : null,
            notes: `Oportunidade comercial vinculada ao contrato ${adm?.contractNumber || `CTR-2025-9${idx}`}.`,
          };
        });
        await db.insert(commercialDeals).values(sampleDeals);
      }
      seedCompleted = true;
    } catch (err) {
      console.warn('ensureNegotiationsEnrichedSeed warning:', err);
    }
  })();
  return seedEnrichmentPromise;
}

export function registerNegotiationsRoutes(app: Express, deps: NegotiationsRoutesDeps) {
  void ensureNegotiationsEnrichedSeed();

  // Scoped bootstrap cache keyed by user permission scope
  const bootstrapCache = new Map<string, { payload: unknown; expiresAt: number }>();
  let staticCatalogsCache: {
    data: {
      modalities: (typeof modalities.$inferSelect)[];
      series: (typeof seriesCatalog.$inferSelect)[];
      gotalkChannels: Array<Omit<typeof gotalkChannels.$inferSelect, 'channelId'>>;
      gotalkOperators: (typeof gotalkOperators.$inferSelect)[];
      gotalkHsmTemplates: (typeof gotalkHsmTemplates.$inferSelect)[];
      users: Array<{
        id: number;
        name: string;
        email: string;
        role: string;
        points: number;
        whatsappPhone: string | null;
      }>;
    };
    expiresAt: number;
  } | null = null;

  const broadcast = (event: string, payload: unknown) => {
    bootstrapCache.clear();
    deps.broadcast(event, payload);
  };

  function serializeNegotiationsFromRows(params: {
    allNegs: Array<typeof negotiations.$inferSelect>;
    allClients: Array<Pick<typeof clients.$inferSelect, 'id' | 'fullName'>>;
    allAdmissions: Array<Pick<typeof admissions.$inferSelect, 'id' | 'contractNumber'>>;
    allBanks: Array<Pick<typeof banks.$inferSelect, 'id' | 'name'>>;
    allCollabs: Array<Pick<typeof collaborators.$inferSelect, 'id' | 'name' | 'userId'>>;
    allUsers: Array<{ id: number; name: string }>;
    allTitles: Array<Pick<typeof financialTitles.$inferSelect, 'id' | 'contractNumber' | 'documentNumber'>>;
  }) {
    const { allNegs, allClients, allAdmissions, allBanks, allCollabs, allUsers, allTitles } = params;
    const clientMap = new Map(allClients.map((c) => [c.id, c]));
    const admissionMap = new Map(allAdmissions.map((a) => [a.id, a]));
    const bankById = new Map(allBanks.map((b) => [b.id, b]));
    const bankByLowerName = new Map(allBanks.map((b) => [b.name.toLowerCase(), b]));
    const collabById = new Map(allCollabs.map((c) => [c.id, c]));
    const collabByUserId = new Map(
      allCollabs.filter((c) => typeof c.userId === 'number').map((c) => [c.userId as number, c])
    );
    const userById = new Map(allUsers.map((u) => [u.id, u]));
    const titleById = new Map(allTitles.map((t) => [t.id, t]));

    return allNegs.map((row) => {
      const client = clientMap.get(row.clientId);
      const admission = row.admissionId ? admissionMap.get(row.admissionId) : undefined;
      const bank =
        (row.bankId ? bankById.get(row.bankId) : undefined) ||
        bankByLowerName.get((row.bankName || '').toLowerCase());
      const collab =
        (row.collaboratorId ? collabById.get(row.collaboratorId) : undefined) ||
        (row.negotiatorId ? collabByUserId.get(row.negotiatorId) : undefined);
      const user = row.negotiatorId ? userById.get(row.negotiatorId) : undefined;
      const linkedTitle = row.titleId ? titleById.get(row.titleId) : undefined;

      const negStatus = mapLegacyStatusToNegotiationStatus(row.status, row.negotiationStatus);
      const debtValueStr =
        row.debtValueText && row.debtValueText !== '0.00'
          ? row.debtValueText
          : centsToDecimalString(row.originalDebtCents);

      const contractNum =
        row.contractNumber ||
        admission?.contractNumber ||
        linkedTitle?.contractNumber ||
        linkedTitle?.documentNumber ||
        `CTR-${row.id}`;

      return {
        ...row,
        openDate:
          row.openDate ||
          (row.createdAt
            ? new Date(row.createdAt).toISOString().slice(0, 10)
            : new Date().toISOString().slice(0, 10)),
        clientName: row.clientName || client?.fullName || `Cliente #${row.clientId}`,
        bankId: row.bankId || bank?.id || null,
        bankName: bank?.name || row.bankName,
        collaboratorId: row.collaboratorId || collab?.id || null,
        collaboratorName: row.collaboratorName || collab?.name || user?.name || 'Não atribuído',
        titleId: row.titleId || null,
        contractNumber: contractNum,
        negotiationStatus: negStatus,
        debtValue: debtValueStr,
        debtValueText: debtValueStr,
        contacts: Array.isArray(row.contactsJson) ? row.contactsJson : [],
        proposals: Array.isArray(row.proposalsJson) ? row.proposalsJson : [],
        closedValue:
          row.closedValueText || (row.closedValueCents ? centsToDecimalString(row.closedValueCents) : null),
      };
    });
  }

  /**
   * Single-record fast hydration — eliminates full-table scans on PUT/PATCH/POST mutations
   */
  async function serializeNegotiationById(id: number) {
    const [row] = await db.select().from(negotiations).where(eq(negotiations.id, id)).limit(1);
    if (!row) return null;

    const [clientRows, admRows, bankRows, collabRows, userRows, titleRows] = await Promise.all([
      db.select({ id: clients.id, fullName: clients.fullName }).from(clients).where(eq(clients.id, row.clientId)).limit(1),
      row.admissionId
        ? db.select({ id: admissions.id, contractNumber: admissions.contractNumber }).from(admissions).where(eq(admissions.id, row.admissionId)).limit(1)
        : Promise.resolve([]),
      row.bankId
        ? db.select({ id: banks.id, name: banks.name }).from(banks).where(eq(banks.id, row.bankId)).limit(1)
        : db.select({ id: banks.id, name: banks.name }).from(banks),
      row.collaboratorId
        ? db.select({ id: collaborators.id, name: collaborators.name, userId: collaborators.userId }).from(collaborators).where(eq(collaborators.id, row.collaboratorId)).limit(1)
        : row.negotiatorId
        ? db.select({ id: collaborators.id, name: collaborators.name, userId: collaborators.userId }).from(collaborators).where(eq(collaborators.userId, row.negotiatorId)).limit(1)
        : Promise.resolve([]),
      row.negotiatorId
        ? db.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, row.negotiatorId)).limit(1)
        : Promise.resolve([]),
      row.titleId
        ? db.select({ id: financialTitles.id, contractNumber: financialTitles.contractNumber, documentNumber: financialTitles.documentNumber }).from(financialTitles).where(eq(financialTitles.id, row.titleId)).limit(1)
        : Promise.resolve([]),
    ]);

    return (
      serializeNegotiationsFromRows({
        allNegs: [row],
        allClients: clientRows,
        allAdmissions: admRows,
        allBanks: bankRows,
        allCollabs: collabRows,
        allUsers: userRows,
        allTitles: titleRows,
      })[0] || null
    );
  }

  async function buildSerializedNegotiations(unitScope: number[] | null = null) {
    await ensureNegotiationsEnrichedSeed();
    const negQuery =
      unitScope && unitScope.length > 0
        ? db
            .select()
            .from(negotiations)
            .where(inArray(negotiations.unitId, unitScope))
            .orderBy(desc(negotiations.updatedAt), desc(negotiations.id))
        : db.select().from(negotiations).orderBy(desc(negotiations.updatedAt), desc(negotiations.id));

    const [allNegs, allClients, allAdmissions, allBanks, allCollabs, allUsers, allTitles] = await Promise.all([
      negQuery,
      db.select({ id: clients.id, fullName: clients.fullName }).from(clients),
      db.select({ id: admissions.id, contractNumber: admissions.contractNumber }).from(admissions),
      db.select({ id: banks.id, name: banks.name }).from(banks),
      db.select({ id: collaborators.id, name: collaborators.name, userId: collaborators.userId }).from(collaborators),
      db.select({ id: users.id, name: users.name }).from(users),
      db
        .select({
          id: financialTitles.id,
          contractNumber: financialTitles.contractNumber,
          documentNumber: financialTitles.documentNumber,
        })
        .from(financialTitles)
        .where(eq(financialTitles.scope, 'RECEBER')),
    ]);

    return serializeNegotiationsFromRows({
      allNegs,
      allClients,
      allAdmissions,
      allBanks,
      allCollabs,
      allUsers,
      allTitles,
    });
  }

  async function getStaticModalCatalogs() {
    const now = Date.now();
    if (staticCatalogsCache && staticCatalogsCache.expiresAt > now) {
      return staticCatalogsCache.data;
    }
    const [allModalities, allSeries, rawChannels, allOperators, allTemplates, publicUsers] = await Promise.all([
      db.select().from(modalities).orderBy(asc(modalities.id)),
      db.select().from(seriesCatalog).orderBy(asc(seriesCatalog.id)),
      db.select().from(gotalkChannels).orderBy(asc(gotalkChannels.id)),
      db.select().from(gotalkOperators).orderBy(asc(gotalkOperators.id)),
      db.select().from(gotalkHsmTemplates).orderBy(asc(gotalkHsmTemplates.id)),
      db
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          role: users.role,
          points: users.points,
          whatsappPhone: users.whatsappPhone,
        })
        .from(users),
    ]);

    const data = {
      modalities: allModalities,
      series: allSeries,
      gotalkChannels: rawChannels.map(({ channelId: _cid, ...pub }) => pub),
      gotalkOperators: allOperators,
      gotalkHsmTemplates: allTemplates,
      users: publicUsers,
    };
    staticCatalogsCache = { data, expiresAt: now + 30_000 };
    return data;
  }

  async function resolveMatchedBankForNegotiation(neg: typeof negotiations.$inferSelect) {
    const allBanks = await db.select().from(banks);
    return (
      (neg.bankId ? allBanks.find((b) => b.id === neg.bankId) : undefined) ||
      allBanks.find((b) => b.name.toLowerCase().includes(neg.bankName.toLowerCase().replace('banco ', '').trim())) ||
      allBanks.find((b) => neg.bankName.toLowerCase().includes(b.name.toLowerCase().replace('banco ', '').trim())) ||
      allBanks[0] ||
      null
    );
  }

  async function loadDualWhatsappForNegotiation(neg: typeof negotiations.$inferSelect, req: AuthRequest) {
    const [clientRow] = await db.select().from(clients).where(eq(clients.id, neg.clientId)).limit(1);
    const matchedBank = await resolveMatchedBankForNegotiation(neg);
    const bankContactsList = matchedBank
      ? await db.select().from(bankContacts).where(eq(bankContacts.bankId, matchedBank.id)).orderBy(asc(bankContacts.id))
      : [];

    const bankContactIds = bankContactsList.map((c) => c.id);

    // Scoped SQL thread lookup instead of loading the entire whatsapp_threads table
    const threadConditions = [eq(whatsappThreads.clientId, neg.clientId)];
    if (matchedBank) threadConditions.push(eq(whatsappThreads.bankId, matchedBank.id));
    if (bankContactIds.length > 0) threadConditions.push(inArray(whatsappThreads.bankContactId, bankContactIds));

    let candidateThreads = await db
      .select()
      .from(whatsappThreads)
      .where(or(...threadConditions))
      .orderBy(desc(whatsappThreads.updatedAt));

    // Also match any thread by canonical BR phone if client phone isn't yet linked to clientId
    const clientPhoneRaw = clientRow?.whatsapp || clientRow?.phone || '';
    if (clientPhoneRaw && !candidateThreads.some((t) => t.clientId === neg.clientId)) {
      const unitThreads = await db
        .select()
        .from(whatsappThreads)
        .where(eq(whatsappThreads.unitId, neg.unitId || 1))
        .orderBy(desc(whatsappThreads.updatedAt))
        .limit(120);
      const matchedPhoneThreads = unitThreads.filter((t) => phonesMatchBR(t.contactPhone, clientPhoneRaw));
      for (const mt of matchedPhoneThreads) {
        if (!candidateThreads.some((c) => c.id === mt.id)) {
          candidateThreads.push(mt);
        }
      }
    }

    let clientThreads = candidateThreads.filter(
      (t) =>
        t.clientId === neg.clientId ||
        (!t.bankId && !t.bankContactId && clientPhoneRaw && phonesMatchBR(t.contactPhone, clientPhoneRaw))
    );

    if (clientThreads.length === 0 && clientRow) {
      const [newClientThread] = await db
        .insert(whatsappThreads)
        .values({
          clientId: clientRow.id,
          unitId: neg.unitId || 1,
          contactName: clientRow.fullName,
          contactPhone: clientRow.whatsapp || clientRow.phone || '',
          provider: 'gotalk',
          operatorName: neg.collaboratorName || req.authUser?.name || 'Negociador',
          department: 'Negociação Bancária',
          unreadCount: 0,
          lastMessagePreview: `Acompanhamento de negociação do contrato ${neg.contractNumber || ''} (${neg.bankName}).`,
        })
        .returning();

      if (newClientThread) {
        await db.insert(whatsappMessages).values([
          {
            threadId: newClientThread.id,
            direction: 'outbound',
            contentType: 'text',
            body: `Olá ${clientRow.fullName}, estamos conduzindo a negociação do seu contrato ${neg.contractNumber || ''} junto ao ${neg.bankName} buscando atingir ${neg.targetReductionPct}% de redução.`,
            operatorName: neg.collaboratorName || 'Negociador',
            department: 'Negociação Bancária',
            senderName: neg.collaboratorName || 'Negociador',
            ackStatus: 3,
          },
        ]);
        clientThreads = [newClientThread];
      }
    }

    const bankContactIdSet = new Set(bankContactIds);
    const bankThreads = candidateThreads.filter(
      (t) =>
        (matchedBank && t.bankId === matchedBank.id) ||
        (t.bankContactId && bankContactIdSet.has(t.bankContactId))
    );

    const clientThreadIds = new Set(clientThreads.map((t) => t.id));
    const bankThreadIds = new Set(bankThreads.map((t) => t.id));
    const combinedThreadIds = Array.from(new Set([...clientThreadIds, ...bankThreadIds]));

    const [relevantMessages, catalogs, uazapiRows] = await Promise.all([
      combinedThreadIds.length > 0
        ? db
            .select()
            .from(whatsappMessages)
            .where(inArray(whatsappMessages.threadId, combinedThreadIds))
            .orderBy(asc(whatsappMessages.createdAt))
        : Promise.resolve([]),
      getStaticModalCatalogs(),
      db
        .select({
          id: unitWhatsappCredentials.id,
          unitId: unitWhatsappCredentials.unitId,
          label: unitWhatsappCredentials.label,
          uazapiInstanceId: unitWhatsappCredentials.uazapiInstanceId,
          phoneNumber: unitWhatsappCredentials.connectedPhone,
          isConnected: unitWhatsappCredentials.isConnected,
          isDefaultForUnit: unitWhatsappCredentials.isDefaultForUnit,
          active: unitWhatsappCredentials.active,
        })
        .from(unitWhatsappCredentials)
        .where(eq(unitWhatsappCredentials.active, true))
        .orderBy(asc(unitWhatsappCredentials.id)),
    ]);

    const clientMessages = relevantMessages
      .filter((m) => clientThreadIds.has(m.threadId))
      .map((m) => {
        const th = clientThreads.find((t) => t.id === m.threadId);
        return {
          ...m,
          contactName: th?.contactName || clientRow?.fullName || neg.clientName,
          contactPhone: th?.contactPhone || clientRow?.whatsapp || clientRow?.phone || '',
          provider: th?.provider || 'gotalk',
        };
      });

    const bankMessages = relevantMessages
      .filter((m) => bankThreadIds.has(m.threadId))
      .map((m) => {
        const th = bankThreads.find((t) => t.id === m.threadId);
        const bc = bankContactsList.find((c) => c.id === th?.bankContactId);
        return {
          ...m,
          bankContactId: th?.bankContactId || null,
          bankContactName: bc ? `${bc.name} (${bc.sector})` : th?.contactName || neg.bankName,
          contactPhone: th?.contactPhone || bc?.mobile || bc?.phone || '',
          provider: th?.provider || 'gotalk',
        };
      });

    const uazapiCreds = deps.resolveUazapiCredentials
      ? await deps.resolveUazapiCredentials({
          unitId: neg.unitId || req.activeUnitId || 1,
          groupId: req.authUser?.groupId ?? null,
          moduleId: 'negotiations',
        })
      : null;

    return {
      client: clientRow
        ? {
            id: clientRow.id,
            name: clientRow.fullName,
            phone: clientRow.phone || '',
            mobile: clientRow.whatsapp || clientRow.phone || '',
          }
        : { id: neg.clientId, name: neg.clientName || `Cliente #${neg.clientId}`, phone: '', mobile: '' },
      bank: matchedBank ? { id: matchedBank.id, name: matchedBank.name } : { id: neg.bankId, name: neg.bankName },
      bankContacts: bankContactsList,
      clientThreads,
      clientMessages,
      bankThreads,
      bankMessages,
      providers: {
        gotalkConfigured: isGotalkConfigured(),
        uazapiConfigured: Boolean(uazapiCreds?.token),
        uazapiInstances: uazapiRows,
        gotalkChannels: catalogs.gotalkChannels,
        gotalkHsmTemplates: catalogs.gotalkHsmTemplates,
      },
    };
  }

  // =========================================================================
  // BOOTSTRAP & CONTEXT (AUTH + MODULE + UNIT SCOPED)
  // =========================================================================
  app.get('/api/negotiations/bootstrap', requireAuth, requireModule('negotiations'), async (req: AuthRequest, res: Response) => {
    try {
      await ensureNegotiationsEnrichedSeed();
      const unitScope = getAllowedUnitScope(req);
      const cacheKey = unitScope ? `u:${unitScope.join(',')}` : 'admin:all';
      const forceRefresh = req.query.force === '1';
      const now = Date.now();
      const cached = bootstrapCache.get(cacheKey);
      if (!forceRefresh && cached && cached.expiresAt > now) {
        return res.json(cached.payload);
      }

      const [
        allNegs,
        allBanks,
        allBankServices,
        allBankContacts,
        allCollabs,
        allUsers,
        allClients,
        allAdmissions,
        receberTitles,
        allGoals,
        allDeals,
        allUnits,
      ] = await Promise.all([
        unitScope
          ? db.select().from(negotiations).where(inArray(negotiations.unitId, unitScope)).orderBy(desc(negotiations.updatedAt), desc(negotiations.id))
          : db.select().from(negotiations).orderBy(desc(negotiations.updatedAt), desc(negotiations.id)),
        db.select().from(banks).orderBy(asc(banks.name)),
        db.select().from(bankServices).orderBy(asc(bankServices.id)),
        db.select().from(bankContacts).orderBy(asc(bankContacts.id)),
        db.select().from(collaborators).orderBy(asc(collaborators.name)),
        db
          .select({
            id: users.id,
            name: users.name,
            email: users.email,
            role: users.role,
            points: users.points,
            whatsappPhone: users.whatsappPhone,
          })
          .from(users),
        unitScope
          ? db.select().from(clients).where(inArray(clients.unitId, unitScope)).orderBy(asc(clients.fullName))
          : db.select().from(clients).orderBy(asc(clients.fullName)),
        unitScope
          ? db.select().from(admissions).where(inArray(admissions.unitId, unitScope)).orderBy(desc(admissions.id))
          : db.select().from(admissions).orderBy(desc(admissions.id)),
        unitScope
          ? db
              .select()
              .from(financialTitles)
              .where(and(eq(financialTitles.scope, 'RECEBER'), inArray(financialTitles.unitId, unitScope)))
              .orderBy(asc(financialTitles.dueDate))
          : db
              .select()
              .from(financialTitles)
              .where(eq(financialTitles.scope, 'RECEBER'))
              .orderBy(asc(financialTitles.dueDate)),
        unitScope
          ? db.select().from(negotiationGoals).where(inArray(negotiationGoals.unitId, unitScope)).orderBy(desc(negotiationGoals.year), desc(negotiationGoals.month))
          : db.select().from(negotiationGoals).orderBy(desc(negotiationGoals.year), desc(negotiationGoals.month)),
        unitScope
          ? db.select().from(commercialDeals).where(inArray(commercialDeals.unitId, unitScope)).orderBy(desc(commercialDeals.updatedAt))
          : db.select().from(commercialDeals).orderBy(desc(commercialDeals.updatedAt)),
        db.select().from(units).orderBy(asc(units.id)),
      ]);

      const serializedNegs = serializeNegotiationsFromRows({
        allNegs,
        allClients,
        allAdmissions,
        allBanks,
        allCollabs,
        allUsers,
        allTitles: receberTitles,
      });

      const servicesByBank = new Map<number, typeof allBankServices>();
      for (const s of allBankServices) {
        const arr = servicesByBank.get(s.bankId) || [];
        arr.push(s);
        servicesByBank.set(s.bankId, arr);
      }

      const contactsByBank = new Map<number, typeof allBankContacts>();
      for (const c of allBankContacts) {
        const arr = contactsByBank.get(c.bankId) || [];
        arr.push(c);
        contactsByBank.set(c.bankId, arr);
      }

      const banksWithDetails = allBanks.map((b) => ({
        ...b,
        services: servicesByBank.get(b.id) || [],
        contacts: contactsByBank.get(b.id) || [],
      }));

      const activeNegTitleIds = new Set(
        serializedNegs
          .filter((n) => !['CANCELADA', 'ENCERRADA'].includes(String(n.negotiationStatus).toUpperCase()))
          .map((n) => n.titleId)
          .filter((id): id is number => typeof id === 'number')
      );

      const clientMap = new Map(allClients.map((c) => [c.id, c]));
      const admissionMap = new Map(allAdmissions.map((a) => [a.id, a]));
      const collabMap = new Map(allCollabs.map((c) => [c.id, c]));
      const collabByUserMap = new Map(
        allCollabs.filter((c) => typeof c.userId === 'number').map((c) => [c.userId as number, c])
      );

      const enrichTitle = (t: typeof financialTitles.$inferSelect) => {
        const cl = clientMap.get(t.clientId);
        const adm = t.admissionId ? admissionMap.get(t.admissionId) : undefined;
        const col = t.assignedCollaboratorId
          ? collabMap.get(t.assignedCollaboratorId) || collabByUserMap.get(t.assignedCollaboratorId)
          : undefined;
        const balanceCents =
          t.currentBalanceCents && t.currentBalanceCents > 0 ? t.currentBalanceCents : t.amountCents;
        return {
          ...t,
          clientName: t.clientName || cl?.fullName || `Cliente #${t.clientId}`,
          contractNumber: t.contractNumber || adm?.contractNumber || t.documentNumber || t.titleCode,
          bankName: adm?.bankName || 'Banco BV',
          collaboratorName: col?.name || 'Sem atribuição',
          currentBalanceCents: balanceCents,
          currentBalance: centsToDecimalString(balanceCents),
          originalValue: centsToDecimalString(t.originalValueCents || t.amountCents),
          hasActiveNegotiation: activeNegTitleIds.has(t.id),
        };
      };

      const allReceberTitles = receberTitles.map(enrichTitle);
      const availableTitles = allReceberTitles.filter((t) => {
        const st = (t.status || '').toUpperCase();
        return !['PAGO', 'CANCELADO', 'FATURA_GERADA', 'AGRUPADO', 'DEVOLUCAO'].includes(st);
      });

      const payload = {
        negotiations: serializedNegs,
        banks: banksWithDetails,
        collaborators: allCollabs,
        users: allUsers,
        clients: allClients,
        admissions: allAdmissions,
        units: allUnits,
        availableTitles,
        allReceberTitles,
        goals: allGoals,
        commercialDeals: allDeals,
      };

      bootstrapCache.set(cacheKey, { payload, expiresAt: Date.now() + 4_000 });
      res.json(payload);
    } catch (err) {
      console.error('Error in GET /api/negotiations/bootstrap:', err);
      res.status(500).json({ error: 'Falha ao carregar dados de Negociações Bancárias.' });
    }
  });

  app.get('/api/negotiations/client-context/:clientId', requireAuth, requireModule('negotiations'), async (req: AuthRequest, res: Response) => {
    try {
      const clientId = parsePositiveIntId(req.params.clientId);
      if (!clientId) {
        return res.status(400).json({ error: 'ID do cliente inválido.' });
      }

      const [clientRow, clientAdms, catalogs] = await Promise.all([
        db.select().from(clients).where(eq(clients.id, clientId)).limit(1).then((rows) => rows[0] || null),
        db.select().from(admissions).where(eq(admissions.clientId, clientId)),
        getStaticModalCatalogs(),
      ]);

      if (!clientRow) {
        return res.status(404).json({ error: 'Cliente não encontrado.' });
      }
      if (!isUnitPermitted(req, clientRow.unitId)) {
        return res.status(403).json({ error: 'Cliente pertence a uma unidade não autorizada para seu perfil.' });
      }

      const admIds = clientAdms.map((a) => a.id);

      const [clientDocs, clientScenarios, directClientThreads] = await Promise.all([
        admIds.length > 0
          ? db
              .select()
              .from(documentObjects)
              .where(
                and(
                  isNull(documentObjects.deletedAt),
                  or(eq(documentObjects.clientId, clientId), inArray(documentObjects.admissionId, admIds))
                )
              )
              .orderBy(desc(documentObjects.createdAt))
          : db
              .select()
              .from(documentObjects)
              .where(and(isNull(documentObjects.deletedAt), eq(documentObjects.clientId, clientId)))
              .orderBy(desc(documentObjects.createdAt)),
        admIds.length > 0
          ? db
              .select()
              .from(recalcScenarios)
              .where(inArray(recalcScenarios.admissionId, admIds))
              .orderBy(desc(recalcScenarios.createdAt))
          : Promise.resolve([]),
        db
          .select()
          .from(whatsappThreads)
          .where(eq(whatsappThreads.clientId, clientId))
          .orderBy(desc(whatsappThreads.updatedAt)),
      ]);

      const threadIds = directClientThreads.map((t) => t.id);
      const clientMsgs =
        threadIds.length > 0
          ? await db
              .select()
              .from(whatsappMessages)
              .where(inArray(whatsappMessages.threadId, threadIds))
              .orderBy(asc(whatsappMessages.createdAt))
          : [];

      res.json({
        client: clientRow,
        documents: clientDocs,
        recalcScenarios: clientScenarios,
        whatsappThreads: directClientThreads,
        whatsappMessages: clientMsgs,
        modalities: catalogs.modalities,
        series: catalogs.series,
        gotalkChannels: catalogs.gotalkChannels,
        gotalkOperators: catalogs.gotalkOperators,
        gotalkHsmTemplates: catalogs.gotalkHsmTemplates,
        users: catalogs.users,
      });
    } catch (err) {
      console.error('Error in GET /api/negotiations/client-context/:clientId:', err);
      res.status(500).json({ error: 'Falha ao carregar contexto detalhado do cliente.' });
    }
  });

  // =========================================================================
  // NEGOTIATIONS CRUD
  // =========================================================================
  app.get('/api/negotiations', requireAuth, requireModule('negotiations'), async (req: AuthRequest, res: Response) => {
    try {
      const unitScope = getAllowedUnitScope(req);
      const list = await buildSerializedNegotiations(unitScope);
      res.json(list);
    } catch (err) {
      console.error('Error in GET /api/negotiations:', err);
      res.status(500).json({ error: 'Falha ao listar negociações.' });
    }
  });

  app.get('/api/negotiations/:id', requireAuth, requireModule('negotiations'), async (req: AuthRequest, res: Response) => {
    try {
      const id = parsePositiveIntId(req.params.id);
      if (!id) return res.status(400).json({ error: 'ID inválido.' });
      const found = await serializeNegotiationById(id);
      if (!found) return res.status(404).json({ error: 'Negociação não encontrada.' });
      if (!isUnitPermitted(req, found.unitId)) return res.status(403).json({ error: 'Unidade não autorizada.' });
      res.json(found);
    } catch (err) {
      res.status(500).json({ error: sanitizeErrorMessage(err, 'Falha ao buscar negociação.') });
    }
  });

  app.post('/api/negotiations', requireAuth, requireModule('negotiations'), async (req: AuthRequest, res: Response) => {
    try {
      const body = req.body || {};
      const clientId = parsePositiveIntId(body.clientId);
      if (!clientId) {
        return res.status(400).json({ error: 'Selecione um cliente válido para iniciar a negociação.' });
      }

      let parsedDeadline: Date | null = null;
      if (body.targetDeadline !== undefined && body.targetDeadline !== null && body.targetDeadline !== '') {
        parsedDeadline = parseSafeDate(body.targetDeadline);
        if (!parsedDeadline) {
          return res.status(400).json({ error: 'Prazo alvo (targetDeadline) inválido.' });
        }
      }

      const [clientRow] = await db.select().from(clients).where(eq(clients.id, clientId)).limit(1);
      if (!clientRow) {
        return res.status(404).json({ error: 'Cliente não encontrado.' });
      }
      const [allBanks, allBankContacts, allCollabs, allAdmissions] = await Promise.all([
        db.select().from(banks),
        db.select().from(bankContacts),
        db.select().from(collaborators),
        db.select().from(admissions).where(eq(admissions.clientId, clientId)),
      ]);

      const matchedBank = body.bankId
        ? allBanks.find((b) => b.id === Number(body.bankId))
        : allBanks.find((b) => b.name.toLowerCase() === String(body.bankName || '').toLowerCase());

      const bankId = matchedBank?.id || (body.bankId ? Number(body.bankId) : null);
      const bankName = matchedBank?.name || body.bankName || 'Banco BV';

      const collab = body.collaboratorId
        ? allCollabs.find((c) => c.id === Number(body.collaboratorId))
        : body.negotiatorId
        ? allCollabs.find((c) => c.userId === Number(body.negotiatorId))
        : allCollabs.find((c) => c.userId === req.authUser?.id) || allCollabs[0];

      const admission = body.admissionId
        ? allAdmissions.find((a) => a.id === Number(body.admissionId))
        : allAdmissions[0];

      const targetUnitId = Number(body.unitId || clientRow?.unitId || req.activeUnitId || 1);
      if (!isUnitPermitted(req, targetUnitId)) {
        return res.status(403).json({ error: 'Unidade não autorizada para criar negociação.' });
      }

      const debtCents =
        typeof body.originalDebtCents === 'number' && body.originalDebtCents > 0
          ? body.originalDebtCents
          : parseValueToCents(body.debtValue || body.debtValueText || admission?.debtAmountCents || 2500000);

      const targetPct = Math.max(1, Math.min(95, Number(body.targetReductionPct || 55)));
      const currentPct = Math.max(0, Math.min(95, Number(body.currentReductionPct || 0)));
      const negStatus = mapLegacyStatusToNegotiationStatus(body.status || 'aberta', body.negotiationStatus || 'ABERTA');
      const legacyStatus = mapNegotiationStatusToLegacy(negStatus, targetPct, currentPct);
      const savingsCents = Math.round(debtCents * (targetPct / 100));

      const defaultBankContact = bankId ? allBankContacts.find((c) => c.bankId === bankId) : null;
      const openDateStr = body.openDate || new Date().toISOString().slice(0, 10);
      const initialContacts: NegotiationContactItem[] = Array.isArray(body.contacts) ? body.contacts : [];
      const initialProposals: NegotiationProposalItem[] = Array.isArray(body.proposals) ? body.proposals : [];

      const [created] = await db
        .insert(negotiations)
        .values({
          admissionId: admission?.id || (body.admissionId ? Number(body.admissionId) : null),
          clientId,
          clientName: body.clientName || clientRow?.fullName || `Cliente #${clientId}`,
          unitId: targetUnitId,
          negotiatorId: collab?.userId || req.authUser!.id,
          collaboratorId: collab?.id || (body.collaboratorId ? Number(body.collaboratorId) : null),
          collaboratorName: body.collaboratorName || collab?.name || req.authUser!.name,
          bankId,
          bankName,
          titleId: body.titleId ? Number(body.titleId) : null,
          contractNumber: body.contractNumber || admission?.contractNumber || `CTR-${Date.now().toString().slice(-5)}`,
          openDate: openDateStr,
          originalDebtCents: debtCents,
          debtValueText: centsToDecimalString(debtCents),
          targetReductionPct: targetPct,
          currentReductionPct: currentPct,
          estimatedSavingsCents: savingsCents,
          targetDeadline: parsedDeadline || new Date(Date.now() + 20 * 86400000),
          status: legacyStatus,
          negotiationStatus: negStatus,
          contactsJson: initialContacts,
          proposalsJson: initialProposals,
          nextContactDate: body.nextContactDate || null,
          nextContactDescription: body.nextContactDescription || null,
          notes: body.notes || '',
          selectedBankContactId: body.selectedBankContactId
            ? Number(body.selectedBankContactId)
            : defaultBankContact?.id || null,
          chatLogs: [
            {
              channel: 'sistema',
              note: `Negociação aberta em ${openDateStr} para ${bankName} (${centsToDecimalString(debtCents)}).`,
              author: req.authUser!.name,
              timestamp: new Date().toISOString(),
            },
          ],
        })
        .returning();

      await db.insert(auditLogs).values({
        userId: req.authUser!.id,
        userName: req.authUser!.name,
        action: 'NEGOTIATION_CREATED',
        entityType: 'negotiation',
        entityId: String(created.id),
        details: {
          clientId,
          clientName: created.clientName,
          bankName,
          debtValue: created.debtValueText,
          titleId: created.titleId,
        },
        unitId: created.unitId,
      });

      const enriched = (await serializeNegotiationById(created.id)) || created;
      await dispatchIviSectorNotification(
        {
          targetSector: 'negociacoes',
          targetUnitId: created.unitId,
          relatedEntityType: 'negotiation',
          relatedEntityId: created.id,
          senderName: 'Ivi IA · Negociações',
          subject: `Nova Negociação Bancária · ${created.clientName || bankName}`,
          body: `Negociação #${created.id} (${bankName} · ${created.debtValueText || ''}) aberta por ${req.authUser!.name} em Negociações Bancárias.`,
        },
        db,
        broadcast
      );
      broadcast('negotiations_updated', { negotiationId: created.id });
      res.status(201).json(enriched);
    } catch (err) {
      console.error('Error in POST /api/negotiations:', err);
      res.status(500).json({ error: 'Falha ao criar nova negociação.' });
    }
  });

  const updateNegotiationHandler = async (req: AuthRequest, res: Response) => {
    try {
      const id = parsePositiveIntId(req.params.id);
      if (!id) return res.status(400).json({ error: 'ID de negociação inválido.' });
      const [existing] = await db.select().from(negotiations).where(eq(negotiations.id, id)).limit(1);
      if (!existing) return res.status(404).json({ error: 'Negociação não encontrada.' });
      if (!isUnitPermitted(req, existing.unitId)) return res.status(403).json({ error: 'Unidade não autorizada.' });

      const body = req.body || {};
      const targetPct =
        body.targetReductionPct !== undefined ? Number(body.targetReductionPct) : existing.targetReductionPct;
      const currentPct =
        body.currentReductionPct !== undefined ? Number(body.currentReductionPct) : existing.currentReductionPct;

      const negStatus = body.negotiationStatus
        ? String(body.negotiationStatus).toUpperCase()
        : body.status && ['ABERTA', 'EM_ANDAMENTO', 'ACORDO_FECHADO', 'ACORDO_QUEBRADO', 'CANCELADA', 'ENCERRADA'].includes(String(body.status).toUpperCase())
        ? String(body.status).toUpperCase()
        : mapLegacyStatusToNegotiationStatus(body.status || existing.status, existing.negotiationStatus);

      const legacyStatus = mapNegotiationStatusToLegacy(negStatus, targetPct, currentPct);

      const debtCents =
        body.originalDebtCents !== undefined
          ? Number(body.originalDebtCents)
          : body.debtValue !== undefined
          ? parseValueToCents(body.debtValue)
          : existing.originalDebtCents;

      const savingsCents = Math.round(debtCents * (Math.max(currentPct, targetPct) / 100));

      const updatedChatLogs = [...(existing.chatLogs || [])];
      if (body.note) {
        updatedChatLogs.push({
          channel: body.channel || 'sistema',
          note: body.note,
          author: req.authUser!.name,
          timestamp: new Date().toISOString(),
        });
      }

      const closedValueCents =
        body.closedValueCents !== undefined
          ? body.closedValueCents
          : body.closedValue !== undefined
          ? parseValueToCents(body.closedValue)
          : existing.closedValueCents;

      await db
        .update(negotiations)
        .set({
          clientId: body.clientId !== undefined ? Number(body.clientId) : existing.clientId,
          clientName: body.clientName !== undefined ? String(body.clientName) : existing.clientName,
          bankId: body.bankId !== undefined ? (body.bankId ? Number(body.bankId) : null) : existing.bankId,
          bankName: body.bankName !== undefined ? String(body.bankName) : existing.bankName,
          collaboratorId:
            body.collaboratorId !== undefined
              ? body.collaboratorId
                ? Number(body.collaboratorId)
                : null
              : existing.collaboratorId,
          collaboratorName:
            body.collaboratorName !== undefined ? String(body.collaboratorName) : existing.collaboratorName,
          titleId: body.titleId !== undefined ? (body.titleId ? Number(body.titleId) : null) : existing.titleId,
          contractNumber:
            body.contractNumber !== undefined ? String(body.contractNumber) : existing.contractNumber,
          openDate: body.openDate !== undefined ? String(body.openDate) : existing.openDate,
          originalDebtCents: debtCents,
          debtValueText: centsToDecimalString(debtCents),
          targetReductionPct: targetPct,
          currentReductionPct: currentPct,
          estimatedSavingsCents: savingsCents,
          status: legacyStatus,
          negotiationStatus: negStatus,
          contactsJson: Array.isArray(body.contacts) ? body.contacts : existing.contactsJson,
          proposalsJson: Array.isArray(body.proposals) ? body.proposals : existing.proposalsJson,
          nextContactDate:
            body.nextContactDate !== undefined ? body.nextContactDate : existing.nextContactDate,
          nextContactDescription:
            body.nextContactDescription !== undefined
              ? body.nextContactDescription
              : existing.nextContactDescription,
          notes: body.notes !== undefined ? String(body.notes) : existing.notes,
          closedDate:
            body.closedDate !== undefined
              ? body.closedDate
              : negStatus === 'ACORDO_FECHADO' && !existing.closedDate
              ? new Date().toISOString().slice(0, 10)
              : existing.closedDate,
          closedValueCents,
          closedValueText: closedValueCents ? centsToDecimalString(closedValueCents) : existing.closedValueText,
          closedInstallments:
            body.closedInstallments !== undefined
              ? body.closedInstallments
                ? Number(body.closedInstallments)
                : null
              : existing.closedInstallments,
          selectedBankContactId:
            body.selectedBankContactId !== undefined
              ? body.selectedBankContactId
                ? Number(body.selectedBankContactId)
                : null
              : existing.selectedBankContactId,
          chatLogs: updatedChatLogs,
          updatedAt: new Date(),
        })
        .where(eq(negotiations.id, id));

      await db.insert(auditLogs).values({
        userId: req.authUser!.id,
        userName: req.authUser!.name,
        action: 'NEGOTIATION_UPDATED',
        entityType: 'negotiation',
        entityId: String(id),
        details: {
          negotiationStatus: negStatus,
          currentReductionPct: currentPct,
          nextContactDate: body.nextContactDate,
        },
        unitId: existing.unitId,
      });

      const updated = await serializeNegotiationById(id);
      if (negStatus !== existing.negotiationStatus) {
        if (negStatus === 'ACORDO_FECHADO') {
          await dispatchIviSectorNotification(
            {
              targetSector: 'financeiro',
              targetUnitId: existing.unitId,
              relatedEntityType: 'negotiation',
              relatedEntityId: id,
              senderName: 'Ivi IA · Negociações',
              subject: `Acordo Bancário Fechado · ${existing.clientName || existing.bankName}`,
              body: `Negociação #${id} (${existing.bankName}) fechada com acordo por ${req.authUser!.name}. Encaminhada para conferência em Administração Financeira.`,
            },
            db,
            broadcast
          );
        } else if (negStatus === 'ACORDO_QUEBRADO') {
          await dispatchIviSectorNotification(
            {
              targetSector: 'cobranca',
              targetUnitId: existing.unitId,
              relatedEntityType: 'negotiation',
              relatedEntityId: id,
              senderName: 'Ivi IA · Negociações',
              subject: `Acordo Quebrado — Atenção Cobrança · ${existing.clientName || existing.bankName}`,
              body: `A negociação #${id} (${existing.bankName}) foi marcada como ACORDO QUEBRADO e requer tratativa em Cobrança & Ranking.`,
            },
            db,
            broadcast
          );
        }
      }
      broadcast('negotiations_updated', { negotiationId: id });
      res.json(updated);
    } catch (err) {
      console.error('Error in updateNegotiationHandler:', err);
      res.status(500).json({ error: 'Falha ao atualizar negociação.' });
    }
  };

  app.put('/api/negotiations/:id', requireAuth, requireModule('negotiations'), updateNegotiationHandler);
  app.patch('/api/negotiations/:id', requireAuth, requireModule('negotiations'), updateNegotiationHandler);

  app.delete('/api/negotiations/:id', requireAuth, requireModule('negotiations'), async (req: AuthRequest, res: Response) => {
    try {
      const id = parsePositiveIntId(req.params.id);
      if (!id) return res.status(400).json({ error: 'ID de negociação inválido.' });
      const [existing] = await db.select().from(negotiations).where(eq(negotiations.id, id)).limit(1);
      if (!existing) return res.status(404).json({ error: 'Negociação não encontrada.' });
      if (!isUnitPermitted(req, existing.unitId)) return res.status(403).json({ error: 'Unidade não autorizada.' });

      await db.delete(negotiations).where(eq(negotiations.id, id));
      await db.insert(auditLogs).values({
        userId: req.authUser!.id,
        userName: req.authUser!.name,
        action: 'NEGOTIATION_DELETED',
        entityType: 'negotiation',
        entityId: String(id),
        details: { clientName: existing.clientName, bankName: existing.bankName },
        unitId: existing.unitId,
      });
      broadcast('negotiations_updated', { deletedId: id });
      res.json({ ok: true, deletedId: id });
    } catch (err) {
      res.status(500).json({ error: sanitizeErrorMessage(err, 'Falha ao excluir negociação.') });
    }
  });

  // =========================================================================
  // CONTACTS CRUD (/api/negotiations/:id/contacts)
  // =========================================================================
  app.post('/api/negotiations/:id/contacts', requireAuth, requireModule('negotiations'), async (req: AuthRequest, res: Response) => {
    try {
      const id = parsePositiveIntId(req.params.id);
      if (!id) return res.status(400).json({ error: 'ID de negociação inválido.' });
      const [existing] = await db.select().from(negotiations).where(eq(negotiations.id, id)).limit(1);
      if (!existing) return res.status(404).json({ error: 'Negociação não encontrada.' });
      if (!isUnitPermitted(req, existing.unitId)) return res.status(403).json({ error: 'Unidade não autorizada.' });

      const body = req.body || {};
      const newContact: NegotiationContactItem = {
        id: Date.now(),
        date: body.date || new Date().toISOString().slice(0, 10),
        type: body.type || 'WHATSAPP',
        result: body.result || 'PROPOSTA_APRESENTADA',
        target: body.target || 'BANCO',
        bankContactId: body.bankContactId ? Number(body.bankContactId) : null,
        bankContactName: body.bankContactName || '',
        description: String(body.description || '').trim(),
        responsible: String(body.responsible || req.authUser!.name || existing.collaboratorName || 'Negociador').trim(),
      };

      const contacts = [...(existing.contactsJson || []), newContact];
      const chatLogs = [
        ...(existing.chatLogs || []),
        {
          channel: newContact.type.toLowerCase(),
          note: `[${newContact.target || 'CONTATO'}] ${newContact.description} (${newContact.result})`,
          author: newContact.responsible,
          timestamp: new Date().toISOString(),
        },
      ];

      const nextStatus =
        newContact.result === 'ACORDO'
          ? 'ACORDO_FECHADO'
          : existing.negotiationStatus === 'ABERTA'
          ? 'EM_ANDAMENTO'
          : existing.negotiationStatus;

      await db
        .update(negotiations)
        .set({
          contactsJson: contacts,
          chatLogs,
          negotiationStatus: nextStatus,
          status: mapNegotiationStatusToLegacy(nextStatus, existing.targetReductionPct, existing.currentReductionPct),
          nextContactDate: body.nextContactDate !== undefined ? body.nextContactDate : existing.nextContactDate,
          nextContactDescription:
            body.nextContactDescription !== undefined
              ? body.nextContactDescription
              : existing.nextContactDescription,
          updatedAt: new Date(),
        })
        .where(eq(negotiations.id, id));

      await db.insert(auditLogs).values({
        userId: req.authUser!.id,
        userName: req.authUser!.name,
        action: 'NEGOTIATION_CONTACT_ADDED',
        entityType: 'negotiation',
        entityId: String(id),
        details: { contact: newContact },
        unitId: existing.unitId,
      });

      const updated = await serializeNegotiationById(id);
      broadcast('negotiations_updated', { negotiationId: id });
      res.status(201).json(updated);
    } catch (err) {
      res.status(500).json({ error: 'Falha ao registrar contato na negociação.' });
    }
  });

  app.put('/api/negotiations/:id/contacts/:cid', requireAuth, requireModule('negotiations'), async (req: AuthRequest, res: Response) => {
    try {
      const id = parsePositiveIntId(req.params.id);
      const cid = parsePositiveIntId(req.params.cid);
      if (!id || !cid) return res.status(400).json({ error: 'Identificador de negociação ou contato inválido.' });
      const [existing] = await db.select().from(negotiations).where(eq(negotiations.id, id)).limit(1);
      if (!existing) return res.status(404).json({ error: 'Negociação não encontrada.' });
      if (!isUnitPermitted(req, existing.unitId)) return res.status(403).json({ error: 'Unidade não autorizada.' });

      const existingContacts = existing.contactsJson || [];
      if (!existingContacts.some((c) => c.id === cid)) {
        return res.status(404).json({ error: 'Registro de contato não encontrado.' });
      }

      const body = req.body || {};
      const contacts = existingContacts.map((c) =>
        c.id === cid
          ? {
              ...c,
              date: body.date ?? c.date,
              type: body.type ?? c.type,
              result: body.result ?? c.result,
              target: body.target ?? c.target,
              bankContactId: body.bankContactId !== undefined ? body.bankContactId : c.bankContactId,
              bankContactName: body.bankContactName !== undefined ? body.bankContactName : c.bankContactName,
              description: body.description ?? c.description,
              responsible: body.responsible ?? c.responsible,
            }
          : c
      );

      await db.update(negotiations).set({ contactsJson: contacts, updatedAt: new Date() }).where(eq(negotiations.id, id));

      const updated = await serializeNegotiationById(id);
      broadcast('negotiations_updated', { negotiationId: id });
      res.json(updated);
    } catch (err) {
      res.status(500).json({ error: sanitizeErrorMessage(err, 'Falha ao editar contato.') });
    }
  });

  app.delete('/api/negotiations/:id/contacts/:cid', requireAuth, requireModule('negotiations'), async (req: AuthRequest, res: Response) => {
    try {
      const id = parsePositiveIntId(req.params.id);
      const cid = parsePositiveIntId(req.params.cid);
      if (!id || !cid) return res.status(400).json({ error: 'Identificador de negociação ou contato inválido.' });
      const [existing] = await db.select().from(negotiations).where(eq(negotiations.id, id)).limit(1);
      if (!existing) return res.status(404).json({ error: 'Negociação não encontrada.' });
      if (!isUnitPermitted(req, existing.unitId)) return res.status(403).json({ error: 'Unidade não autorizada.' });

      const existingContacts = existing.contactsJson || [];
      if (!existingContacts.some((c) => c.id === cid)) {
        return res.status(404).json({ error: 'Registro de contato não encontrado.' });
      }

      const contacts = existingContacts.filter((c) => c.id !== cid);
      await db.update(negotiations).set({ contactsJson: contacts, updatedAt: new Date() }).where(eq(negotiations.id, id));

      const updated = await serializeNegotiationById(id);
      broadcast('negotiations_updated', { negotiationId: id });
      res.json(updated);
    } catch (err) {
      res.status(500).json({ error: sanitizeErrorMessage(err, 'Falha ao remover contato.') });
    }
  });

  // =========================================================================
  // PROPOSALS CRUD (/api/negotiations/:id/proposals)
  // =========================================================================
  app.post('/api/negotiations/:id/proposals', requireAuth, requireModule('negotiations'), async (req: AuthRequest, res: Response) => {
    try {
      const id = parsePositiveIntId(req.params.id);
      if (!id) return res.status(400).json({ error: 'ID de negociação inválido.' });
      const [existing] = await db.select().from(negotiations).where(eq(negotiations.id, id)).limit(1);
      if (!existing) return res.status(404).json({ error: 'Negociação não encontrada.' });
      if (!isUnitPermitted(req, existing.unitId)) return res.status(403).json({ error: 'Unidade não autorizada.' });

      const body = req.body || {};
      const propCents = parseValueToCents(body.proposedValue);
      const debtCents = existing.originalDebtCents || 1;
      const calcDiscount =
        body.discountPercentage !== undefined && String(body.discountPercentage).trim() !== ''
          ? String(body.discountPercentage)
          : Math.max(0, Math.min(99, Math.round((1 - propCents / debtCents) * 100))).toFixed(1);

      const installments = Math.max(1, Number(body.installments || 1));
      const entryCents = parseValueToCents(body.entryValue || '0');
      const remainingCents = Math.max(0, propCents - entryCents);
      const installmentCents = Math.round(remainingCents / installments);

      const newProposal: NegotiationProposalItem = {
        id: Date.now(),
        date: body.date || new Date().toISOString().slice(0, 10),
        origin: body.origin || 'NOSSA_PROPOSTA',
        proposedValue: centsToDecimalString(propCents),
        proposedValueCents: propCents,
        discountPercentage: calcDiscount,
        installments,
        installmentValue: body.installmentValue || centsToDecimalString(installmentCents),
        entryValue: centsToDecimalString(entryCents),
        status: body.status || 'AGUARDANDO',
        bankContactId: body.bankContactId ? Number(body.bankContactId) : existing.selectedBankContactId || null,
        bankContactName: body.bankContactName || '',
        notes: body.notes || '',
      };

      const proposals = [...(existing.proposalsJson || []), newProposal];
      const isAccepted = newProposal.status === 'ACEITA';
      const newReductionPct = Math.round(parseFloat(calcDiscount) || existing.currentReductionPct);
      const nextStatus = isAccepted
        ? 'ACORDO_FECHADO'
        : existing.negotiationStatus === 'ABERTA'
        ? 'EM_ANDAMENTO'
        : existing.negotiationStatus;

      await db
        .update(negotiations)
        .set({
          proposalsJson: proposals,
          currentReductionPct: newReductionPct,
          estimatedSavingsCents: Math.max(0, debtCents - propCents),
          negotiationStatus: nextStatus,
          status: mapNegotiationStatusToLegacy(nextStatus, existing.targetReductionPct, newReductionPct),
          closedDate: isAccepted ? new Date().toISOString().slice(0, 10) : existing.closedDate,
          closedValueCents: isAccepted ? propCents : existing.closedValueCents,
          closedValueText: isAccepted ? centsToDecimalString(propCents) : existing.closedValueText,
          closedInstallments: isAccepted ? installments : existing.closedInstallments,
          updatedAt: new Date(),
        })
        .where(eq(negotiations.id, id));

      await db.insert(auditLogs).values({
        userId: req.authUser!.id,
        userName: req.authUser!.name,
        action: 'NEGOTIATION_PROPOSAL_ADDED',
        entityType: 'negotiation',
        entityId: String(id),
        details: { proposal: newProposal },
        unitId: existing.unitId,
      });

      const updated = await serializeNegotiationById(id);
      broadcast('negotiations_updated', { negotiationId: id });
      res.status(201).json(updated);
    } catch (err) {
      console.error('Error in POST /api/negotiations/:id/proposals:', err);
      res.status(500).json({ error: 'Falha ao registrar proposta.' });
    }
  });

  app.put('/api/negotiations/:id/proposals/:pid', requireAuth, requireModule('negotiations'), async (req: AuthRequest, res: Response) => {
    try {
      const id = parsePositiveIntId(req.params.id);
      const pid = parsePositiveIntId(req.params.pid);
      if (!id || !pid) return res.status(400).json({ error: 'Identificador de negociação ou proposta inválido.' });
      const [existing] = await db.select().from(negotiations).where(eq(negotiations.id, id)).limit(1);
      if (!existing) return res.status(404).json({ error: 'Negociação não encontrada.' });
      if (!isUnitPermitted(req, existing.unitId)) return res.status(403).json({ error: 'Unidade não autorizada.' });

      const existingProposals = existing.proposalsJson || [];
      if (!existingProposals.some((p) => p.id === pid)) {
        return res.status(404).json({ error: 'Proposta não encontrada.' });
      }

      const body = req.body || {};
      let acceptedProposal: NegotiationProposalItem | null = null;

      const proposals = existingProposals.map((p) => {
        if (p.id !== pid) return p;
        const propCents =
          body.proposedValue !== undefined
            ? parseValueToCents(body.proposedValue)
            : p.proposedValueCents || parseValueToCents(p.proposedValue);
        const updatedProp: NegotiationProposalItem = {
          ...p,
          date: body.date ?? p.date,
          origin: body.origin ?? p.origin,
          proposedValue: body.proposedValue !== undefined ? centsToDecimalString(propCents) : p.proposedValue,
          proposedValueCents: propCents,
          discountPercentage: body.discountPercentage ?? p.discountPercentage,
          installments: body.installments !== undefined ? Number(body.installments) : p.installments,
          installmentValue: body.installmentValue ?? p.installmentValue,
          entryValue: body.entryValue ?? p.entryValue,
          status: body.status ?? p.status,
          bankContactId: body.bankContactId !== undefined ? body.bankContactId : p.bankContactId,
          bankContactName: body.bankContactName !== undefined ? body.bankContactName : p.bankContactName,
          notes: body.notes ?? p.notes,
        };
        if (updatedProp.status === 'ACEITA') {
          acceptedProposal = updatedProp;
        }
        return updatedProp;
      });

      let nextStatus = existing.negotiationStatus;
      let closedDate = existing.closedDate;
      let closedValueCents = existing.closedValueCents;
      let closedValueText = existing.closedValueText;
      let closedInstallments = existing.closedInstallments;
      let currentReductionPct = existing.currentReductionPct;
      let estimatedSavingsCents = existing.estimatedSavingsCents;

      if (acceptedProposal) {
        const ap = acceptedProposal as NegotiationProposalItem;
        nextStatus = 'ACORDO_FECHADO';
        closedDate = new Date().toISOString().slice(0, 10);
        closedValueCents = ap.proposedValueCents || parseValueToCents(ap.proposedValue);
        closedValueText = centsToDecimalString(closedValueCents);
        closedInstallments = ap.installments || 1;
        currentReductionPct = Math.round(parseFloat(ap.discountPercentage || '0') || existing.currentReductionPct);
        estimatedSavingsCents = Math.max(0, existing.originalDebtCents - closedValueCents);
      }

      await db
        .update(negotiations)
        .set({
          proposalsJson: proposals,
          negotiationStatus: nextStatus,
          status: mapNegotiationStatusToLegacy(nextStatus, existing.targetReductionPct, currentReductionPct),
          closedDate,
          closedValueCents,
          closedValueText,
          closedInstallments,
          currentReductionPct,
          estimatedSavingsCents,
          updatedAt: new Date(),
        })
        .where(eq(negotiations.id, id));

      await db.insert(auditLogs).values({
        userId: req.authUser!.id,
        userName: req.authUser!.name,
        action: acceptedProposal ? 'NEGOTIATION_PROPOSAL_ACCEPTED' : 'NEGOTIATION_PROPOSAL_UPDATED',
        entityType: 'negotiation',
        entityId: String(id),
        details: { proposalId: pid, status: body.status },
        unitId: existing.unitId,
      });

      const updated = await serializeNegotiationById(id);
      broadcast('negotiations_updated', { negotiationId: id });
      res.json(updated);
    } catch (err) {
      res.status(500).json({ error: 'Falha ao atualizar proposta.' });
    }
  });

  app.delete('/api/negotiations/:id/proposals/:pid', requireAuth, requireModule('negotiations'), async (req: AuthRequest, res: Response) => {
    try {
      const id = parsePositiveIntId(req.params.id);
      const pid = parsePositiveIntId(req.params.pid);
      if (!id || !pid) return res.status(400).json({ error: 'Identificador de negociação ou proposta inválido.' });
      const [existing] = await db.select().from(negotiations).where(eq(negotiations.id, id)).limit(1);
      if (!existing) return res.status(404).json({ error: 'Negociação não encontrada.' });
      if (!isUnitPermitted(req, existing.unitId)) return res.status(403).json({ error: 'Unidade não autorizada.' });

      const existingProposals = existing.proposalsJson || [];
      if (!existingProposals.some((p) => p.id === pid)) {
        return res.status(404).json({ error: 'Proposta não encontrada.' });
      }

      const proposals = existingProposals.filter((p) => p.id !== pid);
      await db.update(negotiations).set({ proposalsJson: proposals, updatedAt: new Date() }).where(eq(negotiations.id, id));

      const updated = await serializeNegotiationById(id);
      broadcast('negotiations_updated', { negotiationId: id });
      res.json(updated);
    } catch (err) {
      res.status(500).json({ error: sanitizeErrorMessage(err, 'Falha ao excluir proposta.') });
    }
  });

  // =========================================================================
  // BANK CONTACTS QUICK MANAGEMENT (/api/negotiations/banks/:bankId/contacts)
  // =========================================================================
  app.post('/api/negotiations/banks/:bankId/contacts', requireAuth, requireModule('negotiations'), async (req: AuthRequest, res: Response) => {
    try {
      const bankId = parsePositiveIntId(req.params.bankId);
      if (!bankId) return res.status(400).json({ error: 'ID do banco inválido.' });
      const [bankRow] = await db.select().from(banks).where(eq(banks.id, bankId)).limit(1);
      if (!bankRow) return res.status(404).json({ error: 'Banco não encontrado.' });

      const body = req.body || {};
      if (!body.name || !String(body.name).trim()) {
        return res.status(400).json({ error: 'Informe o nome do contato do banco.' });
      }

      const [created] = await db
        .insert(bankContacts)
        .values({
          bankId,
          name: String(body.name).trim(),
          sector: String(body.sector || 'Mesa de Acordos').trim(),
          phone: String(body.phone || '').trim(),
          mobile: String(body.mobile || body.phone || '').trim(),
          isWhatsapp: body.isWhatsapp !== undefined ? Boolean(body.isWhatsapp) : true,
          email: String(body.email || '').trim(),
        })
        .returning();

      const contactPhone = created.mobile || created.phone || '';
      const [thread] = await db
        .insert(whatsappThreads)
        .values({
          clientId: null,
          bankId,
          bankContactId: created.id,
          unitId: req.activeUnitId || 1,
          contactName: `${created.name} (${bankRow.name} · ${created.sector})`,
          contactPhone: contactPhone || '(11) 99000-0000',
          provider: 'gotalk',
          operatorName: req.authUser!.name,
          department: 'Negociação Bancária',
          unreadCount: 0,
          lastMessagePreview: `Contato cadastrado na tabela de bancos (${bankRow.name}).`,
        })
        .returning();

      if (thread) {
        await db.insert(whatsappMessages).values({
          threadId: thread.id,
          direction: 'outbound',
          contentType: 'text',
          body: `Canal de WhatsApp vinculado ao contato bancário ${created.name} (${bankRow.name} - ${created.sector}).`,
          operatorName: req.authUser!.name,
          department: 'Negociação Bancária',
          senderName: req.authUser!.name,
          ackStatus: 3,
        });
      }

      await db.insert(auditLogs).values({
        userId: req.authUser!.id,
        userName: req.authUser!.name,
        action: 'BANK_CONTACT_CREATED_IN_NEGOTIATION',
        entityType: 'bank_contact',
        entityId: String(created.id),
        details: { bankId, bankName: bankRow.name, name: created.name, mobile: created.mobile },
        unitId: req.activeUnitId || 1,
      });

      broadcast('negotiations_updated', { bankId });
      res.status(201).json(created);
    } catch (err) {
      res.status(500).json({ error: 'Falha ao cadastrar contato no banco.' });
    }
  });

  // =========================================================================
  // DUAL WHATSAPP COMMUNICATION (REAL GOTALK & UAZAPI + MULTIPART + HSM)
  // =========================================================================
  app.get('/api/negotiations/:id/whatsapp', requireAuth, requireModule('negotiations'), async (req: AuthRequest, res: Response) => {
    try {
      await ensureNegotiationsEnrichedSeed();
      const id = parsePositiveIntId(req.params.id);
      if (!id) return res.status(400).json({ error: 'ID de negociação inválido.' });
      const [neg] = await db.select().from(negotiations).where(eq(negotiations.id, id)).limit(1);
      if (!neg) return res.status(404).json({ error: 'Negociação não encontrada.' });
      if (!isUnitPermitted(req, neg.unitId)) return res.status(403).json({ error: 'Unidade não autorizada.' });

      const payload = await loadDualWhatsappForNegotiation(neg, req);
      res.json(payload);
    } catch (err) {
      console.error('Error in GET /api/negotiations/:id/whatsapp:', err);
      res.status(500).json({ error: 'Falha ao carregar conversas de WhatsApp da negociação.' });
    }
  });

  async function resolveTargetThreadForSend(params: {
    neg: typeof negotiations.$inferSelect;
    target: 'CLIENTE' | 'BANCO';
    threadId?: number | null;
    bankContactId?: number | null;
    provider: 'gotalk' | 'uazapi';
    uazapiInstanceId?: string | null;
    channelDbId?: number | null;
    senderName: string;
    preview: string;
  }) {
    const { neg, target, provider, uazapiInstanceId, channelDbId, senderName, preview } = params;
    let thread: typeof whatsappThreads.$inferSelect | null = null;
    let bankContactName = '';

    if (params.threadId) {
      const [found] = await db.select().from(whatsappThreads).where(eq(whatsappThreads.id, params.threadId)).limit(1);
      if (found) thread = found;
    }

    if (target === 'BANCO') {
      const matchedBank = await resolveMatchedBankForNegotiation(neg);
      const bankContactsList = matchedBank
        ? await db.select().from(bankContacts).where(eq(bankContacts.bankId, matchedBank.id)).orderBy(asc(bankContacts.id))
        : [];

      const bc =
        (params.bankContactId ? bankContactsList.find((c) => c.id === params.bankContactId) : undefined) ||
        (neg.selectedBankContactId ? bankContactsList.find((c) => c.id === neg.selectedBankContactId) : undefined) ||
        bankContactsList[0] ||
        null;

      bankContactName = bc ? `${bc.name} (${bc.sector})` : neg.bankName;
      const targetPhone = bc?.mobile || bc?.phone || '';

      if (!thread && bc) {
        const [byBc] = await db.select().from(whatsappThreads).where(eq(whatsappThreads.bankContactId, bc.id)).limit(1);
        if (byBc) thread = byBc;
      }
      if (!thread && matchedBank) {
        const [byBank] = await db.select().from(whatsappThreads).where(eq(whatsappThreads.bankId, matchedBank.id)).limit(1);
        if (byBank) thread = byBank;
      }

      if (!thread) {
        const [createdThread] = await db
          .insert(whatsappThreads)
          .values({
            clientId: null,
            bankId: matchedBank?.id || neg.bankId || bc?.bankId || null,
            bankContactId: bc?.id || null,
            unitId: neg.unitId || 1,
            contactName: `${bc?.name || 'Mesa'} (${neg.bankName})`,
            contactPhone: targetPhone,
            provider,
            uazapiInstanceId: provider === 'uazapi' ? uazapiInstanceId || null : null,
            channelDbId: provider === 'gotalk' ? channelDbId || null : null,
            operatorName: senderName,
            department: 'Negociação Bancária',
            unreadCount: 0,
            lastMessagePreview: preview.slice(0, 120),
          })
          .returning();
        thread = createdThread;
      }
      return { thread, bankContactName, targetPhone: thread.contactPhone || targetPhone };
    }

    const [clientRow] = await db.select().from(clients).where(eq(clients.id, neg.clientId)).limit(1);
    const clientPhone = clientRow?.whatsapp || clientRow?.phone || '';
    if (!thread) {
      const [byClient] = await db.select().from(whatsappThreads).where(eq(whatsappThreads.clientId, neg.clientId)).limit(1);
      if (byClient) thread = byClient;
    }

    if (!thread) {
      const [createdThread] = await db
        .insert(whatsappThreads)
        .values({
          clientId: neg.clientId,
          unitId: neg.unitId || 1,
          contactName: clientRow?.fullName || neg.clientName || `Cliente #${neg.clientId}`,
          contactPhone: clientPhone,
          provider,
          uazapiInstanceId: provider === 'uazapi' ? uazapiInstanceId || null : null,
          channelDbId: provider === 'gotalk' ? channelDbId || null : null,
          operatorName: senderName,
          department: 'Negociação Bancária',
          unreadCount: 0,
          lastMessagePreview: preview.slice(0, 120),
        })
        .returning();
      thread = createdThread;
    }
    return { thread, bankContactName: '', targetPhone: thread.contactPhone || clientPhone };
  }

  async function resolveGotalkChannelExternalId(channelDbId?: number | null): Promise<string | null> {
    if (!channelDbId) return null;
    const rows = await db
      .select({ channelId: gotalkChannels.channelId })
      .from(gotalkChannels)
      .where(eq(gotalkChannels.id, channelDbId))
      .limit(1);
    return rows[0]?.channelId ?? null;
  }

  app.post('/api/negotiations/:id/whatsapp/send', requireAuth, requireModule('negotiations'), async (req: AuthRequest, res: Response) => {
    try {
      const id = parsePositiveIntId(req.params.id);
      if (!id) return res.status(400).json({ error: 'ID de negociação inválido.' });
      const [neg] = await db.select().from(negotiations).where(eq(negotiations.id, id)).limit(1);
      if (!neg) return res.status(404).json({ error: 'Negociação não encontrada.' });
      if (!isUnitPermitted(req, neg.unitId)) return res.status(403).json({ error: 'Unidade não autorizada.' });

      const body = req.body || {};
      const target: 'CLIENTE' | 'BANCO' = body.target === 'BANCO' ? 'BANCO' : 'CLIENTE';
      const provider: 'gotalk' | 'uazapi' = body.provider === 'uazapi' ? 'uazapi' : 'gotalk';
      const messageText = String(body.message || body.body || '').trim();
      if (!messageText) {
        return res.status(400).json({ error: 'Digite uma mensagem para enviar.' });
      }

      const senderName = req.authUser!.name || neg.collaboratorName || 'Operador';
      const bankContactId = body.bankContactId ? Number(body.bankContactId) : neg.selectedBankContactId;
      const uazapiInstanceId = body.uazapiInstanceId ? String(body.uazapiInstanceId) : null;
      const channelDbId = body.gotalkChannelDbId ? Number(body.gotalkChannelDbId) : null;

      const { thread, bankContactName, targetPhone } = await resolveTargetThreadForSend({
        neg,
        target,
        threadId: body.threadId ? Number(body.threadId) : null,
        bankContactId,
        provider,
        uazapiInstanceId,
        channelDbId,
        senderName,
        preview: messageText,
      });

      const phoneDigits = String(targetPhone || '').replace(/\D/g, '');
      if (phoneDigits.length < 10) {
        return res.status(400).json({
          error:
            target === 'BANCO'
              ? 'O contato do banco selecionado não possui telefone/WhatsApp válido cadastrado.'
              : 'Este cliente não possui WhatsApp/telefone válido cadastrado na ficha.',
        });
      }

      let delivery: { dispatched: boolean; provider: string; externalMessageId?: string | null; detail?: string } | null = null;

      if (provider === 'uazapi') {
        const creds = deps.resolveUazapiCredentials
          ? await deps.resolveUazapiCredentials({
              instanceId: uazapiInstanceId || thread.uazapiInstanceId,
              unitId: neg.unitId || req.activeUnitId || 1,
              groupId: req.authUser?.groupId ?? null,
              moduleId: 'negotiations',
            })
          : null;
        if (!creds?.token) {
          delivery = {
            dispatched: false,
            provider: 'uazapi_unconfigured',
            detail: 'Nenhuma instância UaZapi conectada para esta unidade — mensagem registrada no histórico local.',
          };
        } else {
          delivery = await sendUazapiText(creds, targetPhone, messageText);
        }
      } else {
        const resolvedChannelId = await resolveGotalkChannelExternalId(channelDbId || thread.channelDbId);
        delivery = await sendGotalkMessage(targetPhone, messageText, {
          attendanceId: thread.gotalkAttendanceId,
          contactName: thread.contactName,
          contactId: thread.gotalkContactId,
          channelId: resolvedChannelId,
          type: 'text',
        });
      }

      const [outboundMsg] = await db
        .insert(whatsappMessages)
        .values({
          threadId: thread.id,
          externalMessageId: delivery?.externalMessageId || null,
          direction: 'outbound',
          contentType: 'text',
          body: messageText,
          operatorName: senderName,
          department: 'Negociação Bancária',
          senderName,
          ackStatus: delivery?.dispatched ? 1 : null,
        })
        .returning();

      await db
        .update(whatsappThreads)
        .set({
          provider,
          uazapiInstanceId: provider === 'uazapi' ? uazapiInstanceId || thread.uazapiInstanceId : thread.uazapiInstanceId,
          channelDbId: provider === 'gotalk' ? channelDbId || thread.channelDbId : thread.channelDbId,
          lastMessagePreview: messageText.slice(0, 120),
          operatorName: senderName,
          updatedAt: new Date(),
        })
        .where(eq(whatsappThreads.id, thread.id));

      if (deps.mirrorCommunicationToProspection) {
        await deps.mirrorCommunicationToProspection({
          unitId: neg.unitId || thread.unitId || 1,
          phone: targetPhone,
          contactName: thread.contactName,
          channel: provider === 'uazapi' ? 'whatsapp_uazapi' : 'whatsapp_gotalk',
          provider,
          threadId: thread.id,
          direction: 'outbound',
          contentType: 'text',
          body: messageText,
          authorName: senderName,
          externalMessageId: delivery?.externalMessageId || `neg-msg-${outboundMsg.id}`,
          triggerIviAutoSummarize: false,
        });
      }

      if (body.registerContactLog !== false) {
        const newContact: NegotiationContactItem = {
          id: Date.now(),
          date: new Date().toISOString().slice(0, 10),
          type: 'WHATSAPP',
          result: 'PROPOSTA_APRESENTADA',
          target,
          bankContactId: target === 'BANCO' ? (bankContactId || null) : null,
          bankContactName: target === 'BANCO' ? bankContactName : undefined,
          description: `[WhatsApp ${provider.toUpperCase()} -> ${target === 'BANCO' ? bankContactName : neg.clientName}] ${messageText}`,
          responsible: senderName,
        };
        const updatedContacts = [...(neg.contactsJson || []), newContact];
        await db
          .update(negotiations)
          .set({
            contactsJson: updatedContacts,
            selectedBankContactId:
              target === 'BANCO' && bankContactId ? Number(bankContactId) : neg.selectedBankContactId,
            updatedAt: new Date(),
          })
          .where(eq(negotiations.id, id));
      }

      await db.insert(auditLogs).values({
        userId: req.authUser!.id,
        userName: senderName,
        action: 'NEGOTIATION_WHATSAPP_SENT',
        entityType: 'negotiation',
        entityId: String(id),
        details: { target, provider, dispatched: delivery?.dispatched, detail: delivery?.detail },
        unitId: neg.unitId,
      });

      const updatedNeg = await serializeNegotiationById(id);
      broadcast('whatsapp:message', outboundMsg);
      broadcast('negotiations_updated', { negotiationId: id });
      res.status(201).json({ ok: true, message: outboundMsg, threadId: thread.id, delivery, negotiation: updatedNeg });
    } catch (err) {
      console.error('Error in POST /api/negotiations/:id/whatsapp/send:', err);
      res.status(500).json({ error: 'Falha ao enviar mensagem de WhatsApp.' });
    }
  });

  app.post(
    '/api/negotiations/:id/whatsapp/send-file',
    requireAuth,
    requireModule('negotiations'),
    upload.single('file'),
    async (req: AuthRequest, res: Response) => {
      try {
        const id = parsePositiveIntId(req.params.id);
        if (!id) return res.status(400).json({ error: 'ID de negociação inválido.' });
        const [neg] = await db.select().from(negotiations).where(eq(negotiations.id, id)).limit(1);
        if (!neg) return res.status(404).json({ error: 'Negociação não encontrada.' });
        if (!isUnitPermitted(req, neg.unitId)) return res.status(403).json({ error: 'Unidade não autorizada.' });

        const file = req.file;
        if (!file) return res.status(400).json({ error: 'Selecione um arquivo ou áudio para enviar.' });

        const validationErr = validateUploadFile(file.originalname, file.mimetype, file.size);
        if (validationErr) return res.status(400).json({ error: validationErr });

        const safeFileName = sanitizeFileName(file.originalname);
        const target: 'CLIENTE' | 'BANCO' = req.body?.target === 'BANCO' ? 'BANCO' : 'CLIENTE';
        const provider: 'gotalk' | 'uazapi' = req.body?.provider === 'uazapi' ? 'uazapi' : 'gotalk';
        const caption = typeof req.body?.caption === 'string' ? req.body.caption.trim() : '';
        const senderName = req.authUser!.name || neg.collaboratorName || 'Operador';
        const bankContactId = req.body?.bankContactId ? Number(req.body.bankContactId) : neg.selectedBankContactId;

        const { thread, bankContactName, targetPhone } = await resolveTargetThreadForSend({
          neg,
          target,
          threadId: req.body?.threadId ? Number(req.body.threadId) : null,
          bankContactId,
          provider,
          uazapiInstanceId: req.body?.uazapiInstanceId || null,
          channelDbId: req.body?.gotalkChannelDbId ? Number(req.body.gotalkChannelDbId) : null,
          senderName,
          preview: caption || safeFileName,
        });

        const phoneDigits = String(targetPhone || '').replace(/\D/g, '');
        if (phoneDigits.length < 10) {
          return res.status(400).json({ error: 'Destinatário sem telefone/WhatsApp válido para envio de mídia.' });
        }

        const contentType: 'image' | 'audio' | 'document' = file.mimetype.startsWith('image/')
          ? 'image'
          : file.mimetype.startsWith('audio/')
          ? 'audio'
          : 'document';

        const bucketStored = await putBucketObject(file.buffer, {
          folderPath: `bucketdainvicta/U${neg.unitId}/NEGOTIATIONS/N${neg.id}`,
          mimeType: file.mimetype,
          originalName: safeFileName,
        });

        const dataUri = `data:${file.mimetype || 'application/octet-stream'};base64,${file.buffer.toString('base64')}`;
        let iviTranscript: string | null = null;
        if (contentType === 'audio') {
          const trans = await iviTranscribeAudioNote(dataUri, file.mimetype || 'audio/webm');
          iviTranscript = trans.transcript;
        }

        let linkedDocId: number | null = null;
        if (neg.clientId) {
          const [doc] = await db
            .insert(documentObjects)
            .values({
              clientId: neg.clientId,
              admissionId: neg.admissionId || null,
              folderPath: `bucketdainvicta/U${neg.unitId}/C${neg.clientId}/WHATSAPP`,
              fileName: safeFileName,
              docCategory: contentType === 'audio' ? 'audio_whatsapp' : 'negociacao_anexo',
              mimeType: file.mimetype || 'application/octet-stream',
              sizeBytes: bucketStored.sizeBytes,
              sha256Hash: bucketStored.sha256Hash,
              storageUri: bucketStored.storageUri,
              uploadedBy: senderName,
              unitId: neg.unitId || 1,
            })
            .returning();
          linkedDocId = doc.id;
        }

        const attachmentUrl = linkedDocId
          ? `/api/documents/${linkedDocId}/download`
          : `/api/bucket/objects/${bucketStored.sha256Hash}?name=${encodeURIComponent(safeFileName)}&mime=${encodeURIComponent(file.mimetype || 'application/octet-stream')}`;

        let delivery: { dispatched: boolean; provider: string; externalMessageId?: string | null; detail?: string } | null = null;
        if (provider === 'uazapi') {
          const creds = deps.resolveUazapiCredentials
            ? await deps.resolveUazapiCredentials({
                instanceId: req.body?.uazapiInstanceId || thread.uazapiInstanceId,
                unitId: neg.unitId || req.activeUnitId || 1,
                groupId: req.authUser?.groupId ?? null,
                moduleId: 'negotiations',
              })
            : null;
          if (!creds?.token) {
            delivery = {
              dispatched: false,
              provider: 'uazapi_unconfigured',
              detail: 'Instância UaZapi indisponível — arquivo salvo no cofre e registrado no histórico.',
            };
          } else {
            delivery = await sendUazapiMedia(creds, {
              phone: targetPhone,
              type: contentType,
              file: dataUri,
              caption: caption || undefined,
              fileName: safeFileName,
              mimeType: file.mimetype,
            });
          }
        } else {
          delivery = await sendGotalkFile({
            phone: targetPhone,
            fileBuffer: file.buffer,
            fileName: safeFileName,
            mimeType: file.mimetype,
            caption: caption || undefined,
          });
        }

        const [outboundMsg] = await db
          .insert(whatsappMessages)
          .values({
            threadId: thread.id,
            externalMessageId: delivery?.externalMessageId || null,
            direction: 'outbound',
            contentType,
            body: caption || safeFileName,
            attachmentUrl,
            attachmentName: safeFileName,
            attachmentMimeType: file.mimetype,
            mediaSha256: bucketStored.sha256Hash,
            mediaStorageUri: bucketStored.storageUri,
            iviAudioTranscript: iviTranscript,
            ackStatus: delivery?.dispatched ? 1 : null,
            operatorName: senderName,
            department: 'Negociação Bancária',
            senderName,
          })
          .returning();

        await db.insert(communicationArchives).values({
          unitId: neg.unitId || 1,
          threadId: thread.id,
          provider,
          archiveType: contentType === 'audio' ? 'audio_message' : 'conversation_snapshot',
          contactName: thread.contactName,
          contactPhone: targetPhone,
          fileName: safeFileName,
          mimeType: file.mimetype || 'application/octet-stream',
          sizeBytes: bucketStored.sizeBytes,
          sha256Hash: bucketStored.sha256Hash,
          storageUri: bucketStored.storageUri,
          transcriptText: iviTranscript || caption || safeFileName,
          createdByName: senderName,
        });

        await db
          .update(whatsappThreads)
          .set({
            provider,
            lastMessagePreview: (caption || safeFileName).slice(0, 120),
            operatorName: senderName,
            updatedAt: new Date(),
          })
          .where(eq(whatsappThreads.id, thread.id));

        if (deps.mirrorCommunicationToProspection) {
          await deps.mirrorCommunicationToProspection({
            unitId: neg.unitId || 1,
            phone: targetPhone,
            contactName: thread.contactName,
            channel: provider === 'uazapi' ? 'whatsapp_uazapi' : 'whatsapp_gotalk',
            provider,
            threadId: thread.id,
            direction: 'outbound',
            contentType,
            body: caption || `[Arquivo enviado]: ${safeFileName}`,
            audioTranscript: iviTranscript,
            authorName: senderName,
            externalMessageId: delivery?.externalMessageId || `neg-file-${outboundMsg.id}`,
            mediaSha256: bucketStored.sha256Hash,
            mediaStorageUri: bucketStored.storageUri,
            mediaMimeType: file.mimetype,
            mediaFileName: safeFileName,
            triggerIviAutoSummarize: contentType === 'audio',
          });
        }

        const newContact: NegotiationContactItem = {
          id: Date.now(),
          date: new Date().toISOString().slice(0, 10),
          type: 'WHATSAPP',
          result: 'PROPOSTA_APRESENTADA',
          target,
          bankContactId: target === 'BANCO' ? (bankContactId || null) : null,
          bankContactName: target === 'BANCO' ? bankContactName : undefined,
          description: `[Anexo WhatsApp -> ${target === 'BANCO' ? bankContactName : neg.clientName}] ${safeFileName}${caption ? ` — ${caption}` : ''}`,
          responsible: senderName,
        };
        await db
          .update(negotiations)
          .set({ contactsJson: [...(neg.contactsJson || []), newContact], updatedAt: new Date() })
          .where(eq(negotiations.id, id));

        const updatedNeg = await serializeNegotiationById(id);
        broadcast('whatsapp:message', outboundMsg);
        broadcast('negotiations_updated', { negotiationId: id });
        res.status(201).json({ ok: true, message: outboundMsg, threadId: thread.id, delivery, negotiation: updatedNeg });
      } catch (err) {
        console.error('Error in POST /api/negotiations/:id/whatsapp/send-file:', err);
        res.status(500).json({ error: 'Falha ao enviar arquivo pelo WhatsApp.' });
      }
    }
  );

  app.post('/api/negotiations/:id/whatsapp/send-hsm', requireAuth, requireModule('negotiations'), async (req: AuthRequest, res: Response) => {
    try {
      const id = parsePositiveIntId(req.params.id);
      if (!id) return res.status(400).json({ error: 'ID de negociação inválido.' });
      const [neg] = await db.select().from(negotiations).where(eq(negotiations.id, id)).limit(1);
      if (!neg) return res.status(404).json({ error: 'Negociação não encontrada.' });
      if (!isUnitPermitted(req, neg.unitId)) return res.status(403).json({ error: 'Unidade não autorizada.' });

      const body = req.body || {};
      const target: 'CLIENTE' | 'BANCO' = body.target === 'BANCO' ? 'BANCO' : 'CLIENTE';
      const templateId = body.templateId ? Number(body.templateId) : null;
      const senderName = req.authUser!.name || neg.collaboratorName || 'Operador';
      const bankContactId = body.bankContactId ? Number(body.bankContactId) : neg.selectedBankContactId;

      let tplRow: typeof gotalkHsmTemplates.$inferSelect | null = null;
      if (templateId) {
        const [found] = await db.select().from(gotalkHsmTemplates).where(eq(gotalkHsmTemplates.id, templateId)).limit(1);
        if (found) tplRow = found;
      }

      const renderedText = String(
        body.renderedText ||
          tplRow?.bodyText ||
          `Olá, estamos entrando em contato sobre o acordo referente ao contrato ${neg.contractNumber || ''} (${neg.bankName}).`
      ).trim();

      const { thread, bankContactName, targetPhone } = await resolveTargetThreadForSend({
        neg,
        target,
        threadId: body.threadId ? Number(body.threadId) : null,
        bankContactId,
        provider: 'gotalk',
        channelDbId: body.gotalkChannelDbId ? Number(body.gotalkChannelDbId) : null,
        senderName,
        preview: renderedText,
      });

      const phoneDigits = String(targetPhone || '').replace(/\D/g, '');
      if (phoneDigits.length < 10) {
        return res.status(400).json({ error: 'Destinatário sem telefone válido para disparo de template HSM.' });
      }

      const delivery = tplRow?.templateName
        ? await sendGotalkTemplateByName({
            phone: targetPhone,
            templateName: tplRow.templateName,
            tag: {
              clientName: target === 'BANCO' ? bankContactName || neg.bankName : neg.clientName || '',
              contractNumber: neg.contractNumber || '',
            },
          })
        : await sendGotalkActiveNotification({
            phone: targetPhone,
            contactName: thread.contactName,
            templateId: tplRow?.gotalkTemplateId || undefined,
            text: renderedText,
            channelId: await resolveGotalkChannelExternalId(body.gotalkChannelDbId ? Number(body.gotalkChannelDbId) : thread.channelDbId),
          });

      const [outboundMsg] = await db
        .insert(whatsappMessages)
        .values({
          threadId: thread.id,
          externalMessageId: delivery.externalMessageId || null,
          direction: 'outbound',
          contentType: 'text',
          body: `[HSM ${tplRow?.templateName || 'Notificação Ativa'}]: ${renderedText}`,
          operatorName: senderName,
          department: 'Negociação Bancária',
          senderName,
          ackStatus: delivery.dispatched ? 1 : null,
        })
        .returning();

      await db
        .update(whatsappThreads)
        .set({ lastMessagePreview: renderedText.slice(0, 120), operatorName: senderName, updatedAt: new Date() })
        .where(eq(whatsappThreads.id, thread.id));

      const updatedNeg = await serializeNegotiationById(id);
      broadcast('whatsapp:message', outboundMsg);
      broadcast('negotiations_updated', { negotiationId: id });
      res.status(201).json({ ok: true, message: outboundMsg, threadId: thread.id, delivery, negotiation: updatedNeg });
    } catch (err) {
      console.error('Error in POST /api/negotiations/:id/whatsapp/send-hsm:', err);
      res.status(500).json({ error: 'Falha ao disparar template HSM via GoTalk.' });
    }
  });

  // =========================================================================
  // IVI IA NEGOTIATION ADVISOR & COPILOT
  // =========================================================================
  async function buildAdvisorContext(negotiationId: number): Promise<NegotiationAdvisorContextInput | null> {
    const neg = await serializeNegotiationById(negotiationId);
    if (!neg) return null;

    const [clientRow] = await db.select().from(clients).where(eq(clients.id, neg.clientId)).limit(1);
    const allBanks = await db.select().from(banks);
    const matchedBank =
      (neg.bankId ? allBanks.find((b) => b.id === neg.bankId) : undefined) ||
      allBanks.find((b) => b.name.toLowerCase().includes(neg.bankName.toLowerCase().replace('banco ', '').trim())) ||
      allBanks[0];

    const [services, contacts] = matchedBank
      ? await Promise.all([
          db.select().from(bankServices).where(eq(bankServices.bankId, matchedBank.id)),
          db.select().from(bankContacts).where(eq(bankContacts.bankId, matchedBank.id)),
        ])
      : [[], []];

    const bankContactIds = contacts.map((c) => c.id);
    const threadFilters = [eq(whatsappThreads.clientId, neg.clientId)];
    if (matchedBank) threadFilters.push(eq(whatsappThreads.bankId, matchedBank.id));
    if (bankContactIds.length > 0) threadFilters.push(inArray(whatsappThreads.bankContactId, bankContactIds));

    const scopedThreads = await db.select().from(whatsappThreads).where(or(...threadFilters));
    const clientThreadIds = new Set(scopedThreads.filter((t) => t.clientId === neg.clientId).map((t) => t.id));
    const bankContactIdSet = new Set(bankContactIds);
    const bankThreadIds = new Set(
      scopedThreads
        .filter((t) => (matchedBank && t.bankId === matchedBank.id) || (t.bankContactId && bankContactIdSet.has(t.bankContactId)))
        .map((t) => t.id)
    );

    const combinedIds = Array.from(new Set([...clientThreadIds, ...bankThreadIds]));
    const relevantMsgs =
      combinedIds.length > 0
        ? await db
            .select()
            .from(whatsappMessages)
            .where(inArray(whatsappMessages.threadId, combinedIds))
            .orderBy(asc(whatsappMessages.createdAt))
        : [];

    const clientWhatsappMessages = relevantMsgs
      .filter((m) => clientThreadIds.has(m.threadId))
      .map((m) => ({
        direction: m.direction,
        senderName: m.senderName,
        body: m.body,
        audioTranscript: m.iviAudioTranscript,
        createdAt: m.createdAt ? new Date(m.createdAt).toISOString() : '',
      }));

    const bankWhatsappMessages = relevantMsgs
      .filter((m) => bankThreadIds.has(m.threadId))
      .map((m) => ({
        direction: m.direction,
        senderName: m.senderName,
        body: m.body,
        audioTranscript: m.iviAudioTranscript,
        createdAt: m.createdAt ? new Date(m.createdAt).toISOString() : '',
      }));

    const selectedBc = contacts.find((c) => c.id === neg.selectedBankContactId);

    return {
      negotiationId: neg.id,
      clientName: neg.clientName || clientRow?.fullName || `Cliente #${neg.clientId}`,
      clientCpfCnpj: clientRow?.cpfCnpj,
      bankName: neg.bankName,
      contractNumber: neg.contractNumber || '',
      originalDebtCents: neg.originalDebtCents,
      negotiationStatus: neg.negotiationStatus || 'EM_ANDAMENTO',
      targetReductionPct: neg.targetReductionPct,
      currentReductionPct: neg.currentReductionPct,
      collaboratorName: neg.collaboratorName || 'Negociador',
      nextContactDate: neg.nextContactDate,
      nextContactDescription: neg.nextContactDescription,
      notes: neg.notes,
      bankServices: services.map((s) => ({
        name: s.name,
        modalityDescription: s.modalityDescription,
        negotiationPercent: s.negotiationPercent,
        defaultInstallments: s.defaultInstallments,
      })),
      bankContacts: contacts,
      selectedBankContactName: selectedBc?.name,
      contacts: neg.contacts || [],
      proposals: neg.proposals || [],
      clientWhatsappMessages,
      bankWhatsappMessages,
    };
  }

  app.post('/api/negotiations/:id/ivi-advisor', requireAuth, requireModule('negotiations'), async (req: AuthRequest, res: Response) => {
    try {
      const id = parsePositiveIntId(req.params.id);
      if (!id) return res.status(400).json({ error: 'ID de negociação inválido.' });
      const [negRow] = await db.select().from(negotiations).where(eq(negotiations.id, id)).limit(1);
      if (!negRow) return res.status(404).json({ error: 'Negociação não encontrada.' });
      if (!isUnitPermitted(req, negRow.unitId)) return res.status(403).json({ error: 'Unidade não autorizada.' });

      const ctx = await buildAdvisorContext(id);
      if (!ctx) return res.status(404).json({ error: 'Negociação não encontrada.' });

      const advisorPayload = await iviAnalyzeNegotiationAdvisor(ctx);
      await db
        .update(negotiations)
        .set({
          iviInsightsJson: advisorPayload,
          updatedAt: new Date(),
        })
        .where(eq(negotiations.id, id));

      broadcast('negotiations_updated', { negotiationId: id });
      res.json(advisorPayload);
    } catch (err) {
      console.error('Error in POST /api/negotiations/:id/ivi-advisor:', err);
      res.status(500).json({ error: sanitizeErrorMessage(err, 'Falha ao gerar análise da Assessora Ivi IA.') });
    }
  });

  app.post('/api/negotiations/:id/ivi-ask', requireAuth, requireModule('negotiations'), async (req: AuthRequest, res: Response) => {
    try {
      const id = parsePositiveIntId(req.params.id);
      if (!id) return res.status(400).json({ error: 'ID de negociação inválido.' });
      const question = String(req.body?.question || '').trim();
      if (!question) return res.status(400).json({ error: 'Informe sua pergunta para a Ivi IA.' });

      const [negRow] = await db.select().from(negotiations).where(eq(negotiations.id, id)).limit(1);
      if (!negRow) return res.status(404).json({ error: 'Negociação não encontrada.' });
      if (!isUnitPermitted(req, negRow.unitId)) return res.status(403).json({ error: 'Unidade não autorizada.' });

      const ctx = await buildAdvisorContext(id);
      if (!ctx) return res.status(404).json({ error: 'Negociação não encontrada.' });

      const response = await iviAskNegotiationCopilot({ question, context: ctx });
      res.json(response);
    } catch (err) {
      res.status(500).json({ error: sanitizeErrorMessage(err, 'Falha ao consultar a Assessora Ivi IA.') });
    }
  });

  // =========================================================================
  // NEGOTIATION GOALS (/api/negotiation-goals)
  // =========================================================================
  app.get('/api/negotiation-goals', requireAuth, requireModule('negotiations'), async (req: AuthRequest, res: Response) => {
    try {
      await ensureNegotiationsEnrichedSeed();
      const unitScope = getAllowedUnitScope(req);
      const rows = unitScope
        ? await db
            .select()
            .from(negotiationGoals)
            .where(inArray(negotiationGoals.unitId, unitScope))
            .orderBy(desc(negotiationGoals.year), desc(negotiationGoals.month), asc(negotiationGoals.id))
        : await db
            .select()
            .from(negotiationGoals)
            .orderBy(desc(negotiationGoals.year), desc(negotiationGoals.month), asc(negotiationGoals.id));
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: sanitizeErrorMessage(err, 'Falha ao listar metas de negociação.') });
    }
  });

  app.post('/api/negotiation-goals', requireAuth, requireModule('negotiations'), async (req: AuthRequest, res: Response) => {
    try {
      const body = req.body || {};
      const targetUnitId = body.unitId ? parsePositiveIntId(body.unitId) : (req.activeUnitId || 1);
      if (!targetUnitId) return res.status(400).json({ error: 'Unidade inválida.' });
      if (!isUnitPermitted(req, targetUnitId)) return res.status(403).json({ error: 'Unidade não autorizada.' });

      const collaboratorId = body.collaboratorId ? parsePositiveIntId(body.collaboratorId) : null;
      if (body.collaboratorId && !collaboratorId) {
        return res.status(400).json({ error: 'Identificador de colaborador inválido.' });
      }
      let collaboratorName = body.collaboratorName || 'Meta Geral da Equipe';
      if (collaboratorId) {
        const [col] = await db.select().from(collaborators).where(eq(collaborators.id, collaboratorId)).limit(1);
        if (col) collaboratorName = col.name;
      }
      const savingsCents = parseValueToCents(body.targetValue || body.targetSavingsCents || '50000.00');

      const [created] = await db
        .insert(negotiationGoals)
        .values({
          collaboratorId,
          collaboratorName,
          unitId: targetUnitId,
          month: Number(body.month || new Date().getMonth() + 1),
          year: Number(body.year || new Date().getFullYear()),
          targetCount: Number(body.targetCount || 10),
          targetSavingsCents: savingsCents,
          targetValue: centsToDecimalString(savingsCents),
        })
        .returning();

      broadcast('negotiations_updated', { goalId: created.id });
      res.status(201).json(created);
    } catch (err) {
      res.status(500).json({ error: sanitizeErrorMessage(err, 'Falha ao salvar meta de negociação.') });
    }
  });

  app.put('/api/negotiation-goals/:id', requireAuth, requireModule('negotiations'), async (req: AuthRequest, res: Response) => {
    try {
      const id = parsePositiveIntId(req.params.id);
      if (!id) return res.status(400).json({ error: 'ID da meta inválido.' });
      const [existing] = await db.select().from(negotiationGoals).where(eq(negotiationGoals.id, id)).limit(1);
      if (!existing) return res.status(404).json({ error: 'Meta não encontrada.' });
      if (!isUnitPermitted(req, existing.unitId)) return res.status(403).json({ error: 'Unidade não autorizada.' });

      const body = req.body || {};
      const savingsCents = parseValueToCents(body.targetValue || body.targetSavingsCents || '50000.00');
      const [updated] = await db
        .update(negotiationGoals)
        .set({
          collaboratorId: body.collaboratorId ? Number(body.collaboratorId) : null,
          collaboratorName: body.collaboratorName || 'Geral',
          month: Number(body.month || new Date().getMonth() + 1),
          year: Number(body.year || new Date().getFullYear()),
          targetCount: Number(body.targetCount || 10),
          targetSavingsCents: savingsCents,
          targetValue: centsToDecimalString(savingsCents),
          updatedAt: new Date(),
        })
        .where(eq(negotiationGoals.id, id))
        .returning();

      if (!updated) return res.status(404).json({ error: 'Meta não encontrada.' });
      broadcast('negotiations_updated', { goalId: id });
      res.json(updated);
    } catch (err) {
      res.status(500).json({ error: sanitizeErrorMessage(err, 'Falha ao atualizar meta.') });
    }
  });

  app.delete('/api/negotiation-goals/:id', requireAuth, requireModule('negotiations'), async (req: AuthRequest, res: Response) => {
    try {
      const id = parsePositiveIntId(req.params.id);
      if (!id) return res.status(400).json({ error: 'ID da meta inválido.' });
      const [existing] = await db.select().from(negotiationGoals).where(eq(negotiationGoals.id, id)).limit(1);
      if (!existing) return res.status(404).json({ error: 'Meta não encontrada.' });
      if (!isUnitPermitted(req, existing.unitId)) return res.status(403).json({ error: 'Unidade não autorizada.' });

      await db.delete(negotiationGoals).where(eq(negotiationGoals.id, id));
      broadcast('negotiations_updated', { deletedGoalId: id });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: sanitizeErrorMessage(err, 'Falha ao remover meta.') });
    }
  });

  // =========================================================================
  // COMMERCIAL DEALS KANBAN (/api/commercial-deals)
  // =========================================================================
  app.get('/api/commercial-deals', requireAuth, requireModule('negotiations'), async (req: AuthRequest, res: Response) => {
    try {
      await ensureNegotiationsEnrichedSeed();
      const unitScope = getAllowedUnitScope(req);
      const rows = unitScope
        ? await db
            .select()
            .from(commercialDeals)
            .where(inArray(commercialDeals.unitId, unitScope))
            .orderBy(desc(commercialDeals.updatedAt))
        : await db.select().from(commercialDeals).orderBy(desc(commercialDeals.updatedAt));
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: sanitizeErrorMessage(err, 'Falha ao carregar pipeline comercial.') });
    }
  });

  app.post('/api/commercial-deals', requireAuth, requireModule('negotiations'), async (req: AuthRequest, res: Response) => {
    try {
      const body = req.body || {};
      const clientId = parsePositiveIntId(body.clientId);
      if (!clientId) return res.status(400).json({ error: 'Cliente válido é obrigatório.' });

      const [clientRow] = await db.select().from(clients).where(eq(clients.id, clientId)).limit(1);
      if (!clientRow) return res.status(404).json({ error: 'Cliente não encontrado.' });

      const targetUnitId = body.unitId ? parsePositiveIntId(body.unitId) : (clientRow.unitId || req.activeUnitId || 1);
      if (!targetUnitId) return res.status(400).json({ error: 'Unidade inválida.' });
      if (!isUnitPermitted(req, targetUnitId)) return res.status(403).json({ error: 'Unidade não autorizada.' });

      const [allBanks, allCollabs] = await Promise.all([db.select().from(banks), db.select().from(collaborators)]);
      const bank = body.bankId ? allBanks.find((b) => b.id === Number(body.bankId)) : undefined;
      const collab = body.collaboratorId ? allCollabs.find((c) => c.id === Number(body.collaboratorId)) : undefined;

      const debtCents = parseValueToCents(body.debtValue || body.debtValueCents || '0');
      const propCents = body.proposedValue ? parseValueToCents(body.proposedValue) : null;

      const [created] = await db
        .insert(commercialDeals)
        .values({
          clientId,
          clientName: body.clientName || clientRow.fullName,
          admissionId: body.admissionId ? Number(body.admissionId) : null,
          titleId: body.titleId ? Number(body.titleId) : null,
          bankId: bank?.id || (body.bankId ? Number(body.bankId) : null),
          bankName: bank?.name || body.bankName || 'Banco BV',
          collaboratorId: collab?.id || (body.collaboratorId ? Number(body.collaboratorId) : null),
          collaboratorName: collab?.name || body.collaboratorName || req.authUser!.name,
          unitId: targetUnitId,
          stage: body.stage || 'TRIAGEM',
          debtValueCents: debtCents,
          debtValue: centsToDecimalString(debtCents),
          proposedValueCents: propCents,
          proposedValue: propCents !== null ? centsToDecimalString(propCents) : null,
          discountPercentage: body.discountPercentage || null,
          lossReason: body.lossReason || null,
          notes: body.notes || '',
        })
        .returning();

      broadcast('negotiations_updated', { dealId: created.id });
      res.status(201).json(created);
    } catch (err) {
      res.status(500).json({ error: sanitizeErrorMessage(err, 'Falha ao criar oportunidade no pipeline comercial.') });
    }
  });

  app.put('/api/commercial-deals/:id', requireAuth, requireModule('negotiations'), async (req: AuthRequest, res: Response) => {
    try {
      const id = parsePositiveIntId(req.params.id);
      if (!id) return res.status(400).json({ error: 'ID de oportunidade inválido.' });
      const [existing] = await db.select().from(commercialDeals).where(eq(commercialDeals.id, id)).limit(1);
      if (!existing) return res.status(404).json({ error: 'Oportunidade não encontrada.' });
      if (!isUnitPermitted(req, existing.unitId)) return res.status(403).json({ error: 'Unidade não autorizada.' });

      const body = req.body || {};
      const debtCents = body.debtValue !== undefined ? parseValueToCents(body.debtValue) : existing.debtValueCents;
      const propCents =
        body.proposedValue !== undefined
          ? body.proposedValue
            ? parseValueToCents(body.proposedValue)
            : null
          : existing.proposedValueCents;

      const [updated] = await db
        .update(commercialDeals)
        .set({
          clientName: body.clientName ?? existing.clientName,
          bankId: body.bankId !== undefined ? (body.bankId ? Number(body.bankId) : null) : existing.bankId,
          bankName: body.bankName ?? existing.bankName,
          collaboratorId:
            body.collaboratorId !== undefined
              ? body.collaboratorId
                ? Number(body.collaboratorId)
                : null
              : existing.collaboratorId,
          collaboratorName: body.collaboratorName ?? existing.collaboratorName,
          stage: body.stage ?? existing.stage,
          debtValueCents: debtCents,
          debtValue: centsToDecimalString(debtCents),
          proposedValueCents: propCents,
          proposedValue: propCents !== null ? centsToDecimalString(propCents) : null,
          discountPercentage: body.discountPercentage ?? existing.discountPercentage,
          lossReason: body.lossReason !== undefined ? body.lossReason : existing.lossReason,
          notes: body.notes ?? existing.notes,
          updatedAt: new Date(),
        })
        .where(eq(commercialDeals.id, id))
        .returning();

      broadcast('negotiations_updated', { dealId: id });
      res.json(updated);
    } catch (err) {
      res.status(500).json({ error: sanitizeErrorMessage(err, 'Falha ao atualizar oportunidade.') });
    }
  });

  const moveStageHandler = async (req: AuthRequest, res: Response) => {
    try {
      const id = parsePositiveIntId(req.params.id);
      if (!id) return res.status(400).json({ error: 'ID de oportunidade inválido.' });
      const [existing] = await db.select().from(commercialDeals).where(eq(commercialDeals.id, id)).limit(1);
      if (!existing) return res.status(404).json({ error: 'Oportunidade não encontrada.' });
      if (!isUnitPermitted(req, existing.unitId)) return res.status(403).json({ error: 'Unidade não autorizada.' });

      const stage = String(req.body?.stage || 'TRIAGEM').toUpperCase();
      const lossReason = req.body?.lossReason !== undefined ? req.body.lossReason : undefined;

      const [updated] = await db
        .update(commercialDeals)
        .set({
          stage,
          ...(lossReason !== undefined ? { lossReason } : {}),
          updatedAt: new Date(),
        })
        .where(eq(commercialDeals.id, id))
        .returning();

      broadcast('negotiations_updated', { dealId: id });
      res.json(updated);
    } catch (err) {
      res.status(500).json({ error: sanitizeErrorMessage(err, 'Falha ao mover etapa do pipeline.') });
    }
  };

  app.patch('/api/commercial-deals/:id/stage', requireAuth, requireModule('negotiations'), moveStageHandler);
  app.patch('/api/commercial-deals/:id/move-stage', requireAuth, requireModule('negotiations'), moveStageHandler);

  app.delete('/api/commercial-deals/:id', requireAuth, requireModule('negotiations'), async (req: AuthRequest, res: Response) => {
    try {
      const id = parsePositiveIntId(req.params.id);
      if (!id) return res.status(400).json({ error: 'ID de oportunidade inválido.' });
      const [existing] = await db.select().from(commercialDeals).where(eq(commercialDeals.id, id)).limit(1);
      if (!existing) return res.status(404).json({ error: 'Oportunidade não encontrada.' });
      if (!isUnitPermitted(req, existing.unitId)) return res.status(403).json({ error: 'Unidade não autorizada.' });

      await db.delete(commercialDeals).where(eq(commercialDeals.id, id));
      broadcast('negotiations_updated', { deletedDealId: id });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: sanitizeErrorMessage(err, 'Falha ao excluir oportunidade.') });
    }
  });

  app.post('/api/commercial-deals/:id/convert', requireAuth, requireModule('negotiations'), async (req: AuthRequest, res: Response) => {
    try {
      const id = parsePositiveIntId(req.params.id);
      if (!id) return res.status(400).json({ error: 'ID de oportunidade inválido.' });
      const [dealPre] = await db.select().from(commercialDeals).where(eq(commercialDeals.id, id)).limit(1);
      if (!dealPre) return res.status(404).json({ error: 'Oportunidade não encontrada.' });
      if (!isUnitPermitted(req, dealPre.unitId)) return res.status(403).json({ error: 'Unidade não autorizada.' });

      const txResult = await db.transaction(async (tx) => {
        const [deal] = await tx.select().from(commercialDeals).where(eq(commercialDeals.id, id)).limit(1);
        if (!deal) return { status: 404 as const, error: 'Oportunidade não encontrada.' };
        if (deal.convertedNegotiationId) {
          return { status: 409 as const, error: 'Oportunidade já convertida em negociação.' };
        }

        const targetPct = Math.round(parseFloat(deal.discountPercentage || '55') || 55);
        const openDateStr = new Date().toISOString().slice(0, 10);

        const initialProposals: NegotiationProposalItem[] = deal.proposedValue
          ? [
              {
                id: Date.now(),
                date: openDateStr,
                origin: 'NOSSA_PROPOSTA',
                proposedValue: deal.proposedValue,
                proposedValueCents: deal.proposedValueCents || parseValueToCents(deal.proposedValue),
                discountPercentage: deal.discountPercentage || String(targetPct),
                installments: 1,
                installmentValue: deal.proposedValue,
                entryValue: '0.00',
                status: deal.stage === 'FECHADO' ? 'ACEITA' : 'AGUARDANDO',
                notes: `Proposta originada do Pipeline Comercial (#${deal.id}).`,
              },
            ]
          : [];

        const [createdNeg] = await tx
          .insert(negotiations)
          .values({
            admissionId: deal.admissionId,
            clientId: deal.clientId,
            clientName: deal.clientName,
            unitId: deal.unitId || req.activeUnitId || 1,
            negotiatorId: req.authUser!.id,
            collaboratorId: deal.collaboratorId,
            collaboratorName: deal.collaboratorName || req.authUser!.name,
            bankId: deal.bankId,
            bankName: deal.bankName || 'Banco BV',
            titleId: deal.titleId,
            contractNumber: `CTR-PIPE-${deal.id}`,
            openDate: openDateStr,
            originalDebtCents: deal.debtValueCents,
            debtValueText: deal.debtValue,
            targetReductionPct: targetPct,
            currentReductionPct: deal.stage === 'FECHADO' ? targetPct : Math.round(targetPct * 0.5),
            estimatedSavingsCents: Math.round(deal.debtValueCents * (targetPct / 100)),
            targetDeadline: new Date(Date.now() + 15 * 86400000),
            status: deal.stage === 'FECHADO' ? 'meta_alcancada' : 'em_negociacao',
            negotiationStatus: deal.stage === 'FECHADO' ? 'ACORDO_FECHADO' : 'EM_ANDAMENTO',
            contactsJson: [
              {
                id: Date.now() - 100,
                date: openDateStr,
                type: 'WHATSAPP',
                result: deal.stage === 'FECHADO' ? 'ACORDO' : 'PROPOSTA_APRESENTADA',
                target: 'CLIENTE',
                description: `Convertido do Pipeline Comercial (Etapa: ${deal.stage}). ${deal.notes || ''}`,
                responsible: deal.collaboratorName || req.authUser!.name,
              },
            ],
            proposalsJson: initialProposals,
            notes: deal.notes || '',
          })
          .returning();

        await tx
          .update(commercialDeals)
          .set({
            stage: 'FECHADO',
            convertedNegotiationId: createdNeg.id,
            updatedAt: new Date(),
          })
          .where(eq(commercialDeals.id, id));

        return { status: 201 as const, createdNeg };
      });

      if (txResult.status !== 201) {
        return res.status(txResult.status).json({ error: txResult.error });
      }

      const hydrated = (await serializeNegotiationById(txResult.createdNeg.id)) || txResult.createdNeg;
      broadcast('negotiations_updated', { negotiationId: txResult.createdNeg.id, dealId: id });
      res.status(201).json({
        dealId: id,
        negotiation: hydrated,
      });
    } catch (err) {
      res.status(500).json({ error: sanitizeErrorMessage(err, 'Falha ao converter oportunidade em negociação.') });
    }
  });

  // POST /api/negotiations/mass-email — unit-scoped & batched
  app.post('/api/negotiations/mass-email', requireAuth, requireModule('negotiations'), async (req: AuthRequest, res: Response) => {
    try {
      const unitScope = getAllowedUnitScope(req);
      const targetNegs = unitScope
        ? await db.select().from(negotiations).where(inArray(negotiations.unitId, unitScope))
        : await db.select().from(negotiations);

      const now = new Date();
      const author = req.authUser!.name || 'Ivi Automação';

      await db.transaction(async (tx) => {
        await Promise.all(
          targetNegs.map((neg) => {
            const updatedLogs = [
              ...(neg.chatLogs || []),
              {
                channel: 'email_massa',
                note: `Disparo em massa de contraproposta jurídica enviado ao ${neg.bankName} (Meta: ${neg.targetReductionPct}% de redução).`,
                author,
                timestamp: now.toISOString(),
              },
            ];
            return tx
              .update(negotiations)
              .set({ lastMassEmailAt: now, chatLogs: updatedLogs, updatedAt: now })
              .where(eq(negotiations.id, neg.id));
          })
        );

        await tx.insert(auditLogs).values({
          userId: req.authUser!.id,
          userName: author,
          action: 'MASS_EMAIL_BANKS',
          entityType: 'negotiation',
          entityId: 'batch',
          details: { count: targetNegs.length },
          unitId: req.activeUnitId || 1,
        });
      });

      broadcast('negotiations_mass_email', { count: targetNegs.length });
      res.json({ dispatched: targetNegs.length });
    } catch (err) {
      res.status(500).json({ error: 'Falha ao realizar disparo em massa.' });
    }
  });
}
