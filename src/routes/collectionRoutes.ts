import type { Express } from 'express';
import multer from 'multer';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db, pool } from '../db/index.ts';
import {
  admissions,
  appointments,
  auditLogs,
  bankAccountApiConfigs,
  bankAccounts,
  banks,
  bankServices,
  clients,
  collaborators,
  collectionCases,
  collectionNotes,
  collectionReports,
  documentObjects,
  financialTitles,
  gotalkChannels,
  gotalkHsmTemplates,
  gotalkOperators,
  legalMovements,
  legalProcesses,
  modalities,
  negotiations,
  paymentCategories,
  recalcScenarios,
  seriesCatalog,
  systemSettings,
  titleSettlements,
  units,
  userGroups,
  users,
  whatsappMessages,
  whatsappThreads,
  type CollectionCancelRequestInfo,
  type CollectionDebtSnapshot,
  type CollectionNoteAttachment,
} from '../db/schema.ts';
import { ensureCommonCadastrosSeed, ensureInitialSeed } from '../db/seed.ts';
import { dispatchIviSectorNotification } from '../services/internalMessaging.ts';
import {
  AuthRequest,
  getAllowedUnitIds,
  isUnitPermitted,
  requireAnyModule,
  requireAuth,
  requireModule,
} from '../middleware/auth.ts';
import { syncClientLegalAndEscavadorStatus } from '../services/legalSync.ts';
import { putBucketObject, sanitizeFileName, validateUploadFile } from '../services/bucketStorage.ts';
import {
  iviAnalyzeCollectionInsights,
  iviBuildCollectionReport,
  iviSummarizeCollectionWhatsapp,
  runIviOrchestrator,
} from '../services/ivi.ts';
import {
  parsePositiveIntArray,
  parsePositiveIntId,
  sanitizeErrorMessage,
} from '../utils/validation.ts';

const receiptUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

const EXCLUDED_PORTFOLIO_STATUSES = new Set([
  'CANCELADO',
  'AGRUPADO',
  'PAGO',
  'FATURA_GERADA',
  'ADIANTAMENTO',
  'ADIANTAMENTO_PARCIAL',
  'DEVOLUCAO',
  'DEVOLUCAO_VINCULADA',
  'DEVOLUCAO_PARCIAL',
]);

const ELIGIBLE_ADMISSION_STATUSES = new Set([
  'auditada',
  'aprovada',
  'finalizada',
  'concluido',
  'em_andamento',
]);

function normStatusUpper(raw: string | null | undefined): string {
  const s = String(raw || 'ABERTO').trim().toUpperCase();
  if (s === 'VENCIDO') return 'ABERTO';
  return s;
}

let collectionNotesColumnsEnsured = false;
async function ensureCollectionNotesColumns(): Promise<void> {
  if (collectionNotesColumnsEnsured) return;
  try {
    await pool.query(`
      ALTER TABLE collection_notes ADD COLUMN IF NOT EXISTS other_status_detail text NOT NULL DEFAULT '';
      ALTER TABLE collection_notes ADD COLUMN IF NOT EXISTS next_contact_date text NOT NULL DEFAULT '';
      ALTER TABLE collection_notes ADD COLUMN IF NOT EXISTS debt_snapshot_json jsonb DEFAULT NULL;
      ALTER TABLE collection_notes ADD COLUMN IF NOT EXISTS attachments_json jsonb NOT NULL DEFAULT '[]'::jsonb;
    `);
    collectionNotesColumnsEnsured = true;
  } catch (err) {
    console.error('ensureCollectionNotesColumns warning:', err);
  }
}

export function registerCollectionRoutes(
  app: Express,
  deps: { broadcast: (event: string, payload: unknown) => void }
) {
  // ---------------------------------------------------------------------------
  // 1. OPERACIONAL: Carga certificada com paridade total Coordenação & Gerencial
  // ---------------------------------------------------------------------------
  app.get('/api/collection', requireAuth, requireModule('collection'), async (req: AuthRequest, res) => {
    try {
      await ensureCollectionNotesColumns();
      await ensureInitialSeed();
      await ensureCommonCadastrosSeed();
      const allowedUnits = getAllowedUnitIds(req);
      const allowUnit = (uId: number | null | undefined) =>
        allowedUnits === null || (uId != null && allowedUnits.includes(uId));

      const [
        rawCases,
        rawReceberTitles,
        rawSettlements,
        rawAllClients,
        cats,
        allUsers,
        allGroups,
        rawDocs,
        collabs,
        rawNotes,
        rawAllAdmissions,
        allUnits,
        allBanks,
        allBankServices,
        allModalities,
        allSeries,
        rawAllProcesses,
        rawAllScenarios,
        rawAllNegotiations,
        rawThreads,
        rawMessages,
        channels,
        operators,
        hsmTemplates,
        gotalkCfgRows,
      ] = await Promise.all([
        db.select().from(collectionCases).orderBy(desc(collectionCases.priorityValueCents)),
        db
          .select()
          .from(financialTitles)
          .where(eq(financialTitles.scope, 'RECEBER'))
          .orderBy(asc(financialTitles.dueDate), asc(financialTitles.id)),
        db.select().from(titleSettlements).orderBy(desc(titleSettlements.settlementDate), desc(titleSettlements.id)),
        db.select().from(clients).orderBy(asc(clients.fullName)),
        db.select().from(paymentCategories),
        db
          .select({
            id: users.id,
            name: users.name,
            email: users.email,
            role: users.role,
            groupId: users.groupId,
            points: users.points,
            whatsappPhone: users.whatsappPhone,
          })
          .from(users),
        db.select().from(userGroups),
        db.select().from(documentObjects).where(isNull(documentObjects.deletedAt)),
        db.select().from(collaborators).orderBy(asc(collaborators.name)),
        db.select().from(collectionNotes).orderBy(desc(collectionNotes.createdAt)),
        db.select().from(admissions).orderBy(desc(admissions.createdAt)),
        db.select().from(units).orderBy(asc(units.id)),
        db.select().from(banks).orderBy(asc(banks.name)),
        db.select().from(bankServices).orderBy(asc(bankServices.name)),
        db.select().from(modalities).orderBy(asc(modalities.description)),
        db.select().from(seriesCatalog).orderBy(asc(seriesCatalog.sigla)),
        db.select().from(legalProcesses).orderBy(desc(legalProcesses.lastMovementAt)),
        db.select().from(recalcScenarios),
        db.select().from(negotiations).orderBy(desc(negotiations.id)),
        db.select().from(whatsappThreads).orderBy(desc(whatsappThreads.updatedAt)),
        db.select().from(whatsappMessages).orderBy(asc(whatsappMessages.createdAt)),
        db
          .select({
            id: gotalkChannels.id,
            name: gotalkChannels.name,
            phoneNumber: gotalkChannels.phoneNumber,
            unitId: gotalkChannels.unitId,
            notes: gotalkChannels.notes,
            isPrimary: gotalkChannels.isPrimary,
            isActive: gotalkChannels.isActive,
          })
          .from(gotalkChannels)
          .orderBy(asc(gotalkChannels.id)),
        db.select().from(gotalkOperators).orderBy(asc(gotalkOperators.id)),
        db.select().from(gotalkHsmTemplates).orderBy(asc(gotalkHsmTemplates.templateName)),
        db.select().from(systemSettings).where(eq(systemSettings.key, 'gotalk_config')).limit(1),
      ]);

      const cases = allowedUnits === null ? rawCases : rawCases.filter((c) => allowUnit(c.unitId));
      const receberTitles = allowedUnits === null ? rawReceberTitles : rawReceberTitles.filter((t) => allowUnit(t.unitId));
      const receberTitleIdSet = new Set(receberTitles.map((t) => t.id));
      const settlements = allowedUnits === null ? rawSettlements : rawSettlements.filter((s) => receberTitleIdSet.has(s.titleId));
      const allClients = allowedUnits === null ? rawAllClients : rawAllClients.filter((c) => allowUnit(c.unitId));
      const docs = allowedUnits === null ? rawDocs : rawDocs.filter((d) => allowUnit(d.unitId));
      const notes = allowedUnits === null ? rawNotes : rawNotes.filter((n) => allowUnit(n.unitId));
      const allAdmissions = allowedUnits === null ? rawAllAdmissions : rawAllAdmissions.filter((a) => allowUnit(a.unitId));
      const admIdSet = new Set(allAdmissions.map((a) => a.id));
      const allProcesses = allowedUnits === null ? rawAllProcesses : rawAllProcesses.filter((p) => allowUnit(p.unitId));
      const allScenarios = allowedUnits === null ? rawAllScenarios : rawAllScenarios.filter((s) => s.admissionId && admIdSet.has(s.admissionId));
      const allNegotiations = allowedUnits === null ? rawAllNegotiations : rawAllNegotiations.filter((n) => allowUnit(n.unitId));
      const threads = allowedUnits === null ? rawThreads : rawThreads.filter((th) => allowUnit(th.unitId));
      const threadIdSet = new Set(threads.map((th) => th.id));
      const messages = allowedUnits === null ? rawMessages : rawMessages.filter((m) => threadIdSet.has(m.threadId));

      const portfolioTitles = receberTitles.filter((t) => {
        const type = String(t.titleType || 'PADRAO').toUpperCase();
        const st = normStatusUpper(t.status);
        return type === 'PADRAO' && !EXCLUDED_PORTFOLIO_STATUSES.has(st);
      });

      const paidTitles = receberTitles.filter((t) => {
        const type = String(t.titleType || 'PADRAO').toUpperCase();
        const st = String(t.status || '').trim().toUpperCase();
        return type === 'PADRAO' && st === 'PAGO';
      });

      const gridTitles = receberTitles.filter((t) => {
        const type = String(t.titleType || 'PADRAO').toUpperCase();
        if (type !== 'PADRAO') return false;
        const st = normStatusUpper(t.status);
        if (st === 'PAGO') return true;
        return !EXCLUDED_PORTFOLIO_STATUSES.has(st);
      });

      const eligibleAdmIdsByClient = new Map<number, number[]>();
      for (const adm of allAdmissions) {
        const st = String(adm.status || '').toLowerCase();
        if (!ELIGIBLE_ADMISSION_STATUSES.has(st)) continue;
        const list = eligibleAdmIdsByClient.get(adm.clientId) || [];
        list.push(adm.id);
        eligibleAdmIdsByClient.set(adm.clientId, list);
      }

      const addendumsByAdmission = new Map<number, { count: number; latestDate: string | null }>();
      for (const doc of docs) {
        if (!doc.admissionId || doc.docCategory !== 'aditivo') continue;
        const prev = addendumsByAdmission.get(doc.admissionId) || { count: 0, latestDate: null };
        const createdIso = doc.createdAt ? new Date(doc.createdAt).toISOString() : null;
        prev.count += 1;
        if (createdIso && (!prev.latestDate || createdIso > prev.latestDate)) {
          prev.latestDate = createdIso;
        }
        addendumsByAdmission.set(doc.admissionId, prev);
      }

      const admissionSummaryByClient: Record<
        number,
        { fichas: number; aditivos: number; latestAddendumDate: string | null }
      > = {};
      for (const [cId, admIds] of eligibleAdmIdsByClient.entries()) {
        let aditivos = 0;
        let latest: string | null = null;
        for (const admId of admIds) {
          const info = addendumsByAdmission.get(admId);
          if (info) {
            aditivos += info.count;
            if (info.latestDate && (!latest || info.latestDate > latest)) {
              latest = info.latestDate;
            }
          }
        }
        admissionSummaryByClient[cId] = {
          fichas: admIds.length,
          aditivos,
          latestAddendumDate: latest,
        };
      }

      const banksWithServices = allBanks.map((b) => ({
        ...b,
        services: allBankServices.filter((s) => s.bankId === b.id),
      }));

      const gotalkConfig = gotalkCfgRows[0]?.value || {};
      const gotalkEnabled = Boolean(
        process.env.GOTALK_TOKEN ||
          (gotalkConfig as Record<string, unknown>).enabled ||
          channels.some((c) => c.isActive) ||
          threads.length > 0
      );

      res.json({
        cases,
        titles: receberTitles,
        portfolioTitles,
        paidTitles,
        gridTitles,
        allReceberTitles: receberTitles,
        settlements,
        titleSettlements: settlements,
        clients: allClients,
        categories: cats,
        operators: allUsers,
        users: allUsers,
        userGroups: allGroups,
        collaborators: collabs,
        admissions: allAdmissions,
        documents: docs,
        units: allUnits,
        banks: banksWithServices,
        modalities: allModalities,
        series: allSeries,
        notes,
        collectionNotes: notes,
        legalProcesses: allProcesses,
        recalcScenarios: allScenarios,
        negotiations: allNegotiations,
        admissionSummaryByClient,
        gotalkEnabled,
        whatsappThreads: threads,
        whatsappMessages: messages,
        gotalkChannels: channels,
        gotalkOperators: operators,
        gotalkHsmTemplates: hsmTemplates,
      });
    } catch (error) {
      console.error('Collection get error:', error);
      res.status(500).json({ error: 'Erro ao carregar módulo de cobrança.' });
    }
  });

  // ---------------------------------------------------------------------------
  // 2. COORDENAÇÃO: Carga completa global da carteira RECEBER + KPIs + auxiliares
  // ---------------------------------------------------------------------------
  app.get('/api/collection/coordinator', requireAuth, requireModule('collection'), async (req: AuthRequest, res) => {
    try {
      await ensureCollectionNotesColumns();
      await ensureInitialSeed();
      await ensureCommonCadastrosSeed();
      const allowedUnits = getAllowedUnitIds(req);
      const allowUnit = (uId: number | null | undefined) =>
        allowedUnits === null || (uId != null && allowedUnits.includes(uId));

      const [
        rawReceberTitles,
        rawAllClients,
        allCollabs,
        allUsers,
        rawAllAdmissions,
        rawAllDocs,
        allUnits,
        allBanks,
        allBankServices,
        allModalities,
        allSeries,
        rawNotesRows,
        rawAllProcesses,
        rawAllScenarios,
        rawAllNegotiations,
        rawAllSettlements,
        rawSavedReports,
        rawThreads,
        rawMessages,
        channels,
        operators,
        hsmTemplates,
        gotalkCfgRows,
        rawBankAccounts,
        rawBankApiConfigs,
      ] = await Promise.all([
        db
          .select()
          .from(financialTitles)
          .where(eq(financialTitles.scope, 'RECEBER'))
          .orderBy(asc(financialTitles.dueDate), asc(financialTitles.id)),
        db.select().from(clients).orderBy(asc(clients.fullName)),
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
        db.select().from(admissions).orderBy(desc(admissions.createdAt)),
        db.select().from(documentObjects).where(isNull(documentObjects.deletedAt)),
        db.select().from(units).orderBy(asc(units.id)),
        db.select().from(banks).orderBy(asc(banks.name)),
        db.select().from(bankServices).orderBy(asc(bankServices.name)),
        db.select().from(modalities).orderBy(asc(modalities.description)),
        db.select().from(seriesCatalog).orderBy(asc(seriesCatalog.sigla)),
        db.select().from(collectionNotes).orderBy(desc(collectionNotes.createdAt)),
        db.select().from(legalProcesses).orderBy(desc(legalProcesses.lastMovementAt)),
        db.select().from(recalcScenarios),
        db.select().from(negotiations).orderBy(desc(negotiations.id)),
        db.select().from(titleSettlements).orderBy(desc(titleSettlements.settlementDate), desc(titleSettlements.id)),
        db.select().from(collectionReports).orderBy(desc(collectionReports.createdAt)),
        db.select().from(whatsappThreads).orderBy(desc(whatsappThreads.updatedAt)),
        db.select().from(whatsappMessages).orderBy(asc(whatsappMessages.createdAt)),
        db.select({
          id: gotalkChannels.id,
          name: gotalkChannels.name,
          phoneNumber: gotalkChannels.phoneNumber,
          unitId: gotalkChannels.unitId,
          notes: gotalkChannels.notes,
          isPrimary: gotalkChannels.isPrimary,
          isActive: gotalkChannels.isActive,
        }).from(gotalkChannels).orderBy(asc(gotalkChannels.id)),
        db.select().from(gotalkOperators).orderBy(asc(gotalkOperators.id)),
        db.select().from(gotalkHsmTemplates).orderBy(asc(gotalkHsmTemplates.templateName)),
        db.select().from(systemSettings).where(eq(systemSettings.key, 'gotalk_config')).limit(1),
        db.select().from(bankAccounts).where(eq(bankAccounts.active, true)).orderBy(asc(bankAccounts.bankName)),
        db.select().from(bankAccountApiConfigs),
      ]);

      const receberTitles = allowedUnits === null ? rawReceberTitles : rawReceberTitles.filter((t) => allowUnit(t.unitId));
      const titleIdSet = new Set(receberTitles.map((t) => t.id));
      const allClients = allowedUnits === null ? rawAllClients : rawAllClients.filter((c) => allowUnit(c.unitId));
      const allAdmissions = allowedUnits === null ? rawAllAdmissions : rawAllAdmissions.filter((a) => allowUnit(a.unitId));
      const admIdSet = new Set(allAdmissions.map((a) => a.id));
      const allDocs = allowedUnits === null ? rawAllDocs : rawAllDocs.filter((d) => allowUnit(d.unitId));
      const notesRows = allowedUnits === null ? rawNotesRows : rawNotesRows.filter((n) => allowUnit(n.unitId));
      const allProcesses = allowedUnits === null ? rawAllProcesses : rawAllProcesses.filter((p) => allowUnit(p.unitId));
      const allScenarios = allowedUnits === null ? rawAllScenarios : rawAllScenarios.filter((s) => s.admissionId && admIdSet.has(s.admissionId));
      const allNegotiations = allowedUnits === null ? rawAllNegotiations : rawAllNegotiations.filter((n) => allowUnit(n.unitId));
      const allSettlements = allowedUnits === null ? rawAllSettlements : rawAllSettlements.filter((s) => titleIdSet.has(s.titleId));
      const savedReports = allowedUnits === null ? rawSavedReports : rawSavedReports.filter((r) => allowUnit(r.unitId));
      const threads = allowedUnits === null ? rawThreads : rawThreads.filter((th) => allowUnit(th.unitId));
      const threadIdSet = new Set(threads.map((th) => th.id));
      const messages = allowedUnits === null ? rawMessages : rawMessages.filter((m) => threadIdSet.has(m.threadId));

      // Títulos elegíveis ativos para KPIs (PADRAO e fora da lista de exclusão)
      const portfolioTitles = receberTitles.filter((t) => {
        const type = String(t.titleType || 'PADRAO').toUpperCase();
        const st = normStatusUpper(t.status);
        return type === 'PADRAO' && !EXCLUDED_PORTFOLIO_STATUSES.has(st);
      });

      // Títulos pagos (PADRAO + PAGO) para cálculo exato de Taxa de Recuperação & DSO
      const paidTitles = receberTitles.filter((t) => {
        const type = String(t.titleType || 'PADRAO').toUpperCase();
        const st = String(t.status || '').trim().toUpperCase();
        return type === 'PADRAO' && st === 'PAGO';
      });

      // Títulos para o Data Grid da Coordenação: inclui ativos + PAGO (Recebimento Total) e PARCIAL (Recebimento Parcial)
      const gridTitles = receberTitles.filter((t) => {
        const type = String(t.titleType || 'PADRAO').toUpperCase();
        if (type !== 'PADRAO') return false;
        const st = normStatusUpper(t.status);
        if (st === 'PAGO') return true;
        return !EXCLUDED_PORTFOLIO_STATUSES.has(st);
      });

      // Resumo global Fichas & Aditivos por cliente (especificação §1.5 & §3.3)
      const eligibleAdmIdsByClient = new Map<number, number[]>();
      for (const adm of allAdmissions) {
        const st = String(adm.status || '').toLowerCase();
        if (!ELIGIBLE_ADMISSION_STATUSES.has(st)) continue;
        const list = eligibleAdmIdsByClient.get(adm.clientId) || [];
        list.push(adm.id);
        eligibleAdmIdsByClient.set(adm.clientId, list);
      }

      const addendumsByAdmission = new Map<number, { count: number; latestDate: string | null }>();
      for (const doc of allDocs) {
        if (!doc.admissionId) continue;
        if (doc.docCategory !== 'aditivo') continue;
        const prev = addendumsByAdmission.get(doc.admissionId) || { count: 0, latestDate: null };
        const createdIso = doc.createdAt ? new Date(doc.createdAt).toISOString() : null;
        prev.count += 1;
        if (createdIso && (!prev.latestDate || createdIso > prev.latestDate)) {
          prev.latestDate = createdIso;
        }
        addendumsByAdmission.set(doc.admissionId, prev);
      }

      const admissionSummaryByClient: Record<number, { fichas: number; aditivos: number; latestAddendumDate: string | null }> = {};
      for (const [cId, admIds] of eligibleAdmIdsByClient.entries()) {
        let aditivos = 0;
        let latest: string | null = null;
        for (const admId of admIds) {
          const info = addendumsByAdmission.get(admId);
          if (info) {
            aditivos += info.count;
            if (info.latestDate && (!latest || info.latestDate > latest)) {
              latest = info.latestDate;
            }
          }
        }
        admissionSummaryByClient[cId] = {
          fichas: admIds.length,
          aditivos,
          latestAddendumDate: latest,
        };
      }

      const banksWithServices = allBanks.map((b) => ({
        ...b,
        services: allBankServices.filter((s) => s.bankId === b.id),
      }));

      const gotalkConfig = gotalkCfgRows[0]?.value || {};
      const gotalkEnabled = Boolean(
        process.env.GOTALK_TOKEN ||
          (gotalkConfig as Record<string, unknown>).enabled ||
          channels.some((c) => c.isActive) ||
          threads.length > 0
      );

      const cfgMap = new Map(rawBankApiConfigs.map((c) => [c.bankAccountId, c]));
      const coordinatorBankAccounts = rawBankAccounts
        .filter((acc) => allowedUnits === null || acc.unitId === null || allowedUnits.includes(acc.unitId))
        .map((acc) => {
          const cfg = cfgMap.get(acc.id);
          return {
            ...acc,
            santanderSummary: cfg
              ? {
                  configured: true,
                  environment: cfg.environment,
                  executionMode: cfg.executionMode,
                  boletoEnabled: cfg.boletoEnabled,
                  pixEnabled: cfg.pixEnabled,
                  hybridBoletoPixEnabled: cfg.hybridBoletoPixEnabled,
                  covenantCode: cfg.covenantCode,
                  workspaceId: cfg.workspaceId,
                  pixKey: cfg.pixKey,
                  hasClientId: Boolean(cfg.clientId || process.env.SANTANDER_CLIENT_ID),
                  hasClientSecret: Boolean(cfg.clientSecretEncrypted || process.env.SANTANDER_CLIENT_SECRET),
                  hasCertificate: Boolean(cfg.pfxBase64Encrypted || (cfg.certPemEncrypted && cfg.keyPemEncrypted)),
                  lastTestOk: cfg.lastTestOk,
                  lastTestedAt: cfg.lastTestedAt ? new Date(cfg.lastTestedAt).toISOString() : null,
                }
              : null,
          };
        });

      res.json({
        portfolioTitles,
        paidTitles,
        gridTitles,
        allReceberTitles: receberTitles,
        clients: allClients,
        collaborators: allCollabs,
        users: allUsers,
        admissions: allAdmissions,
        documents: allDocs,
        units: allUnits,
        banks: banksWithServices,
        bankAccounts: coordinatorBankAccounts,
        modalities: allModalities,
        series: allSeries,
        collectionNotes: notesRows,
        legalProcesses: allProcesses,
        recalcScenarios: allScenarios,
        negotiations: allNegotiations,
        titleSettlements: allSettlements,
        collectionReports: savedReports,
        admissionSummaryByClient,
        gotalkEnabled,
        whatsappThreads: threads,
        whatsappMessages: messages,
        gotalkChannels: channels,
        gotalkOperators: operators,
        gotalkHsmTemplates: hsmTemplates,
      });
    } catch (error) {
      console.error('GET /api/collection/coordinator error:', error);
      res.status(500).json({ error: 'Erro ao carregar carteira de coordenação.' });
    }
  });

  // ---------------------------------------------------------------------------
  // 3. COORDENAÇÃO: Atribuição & Transferência em lote (audit_logs completo)
  // ---------------------------------------------------------------------------
  app.post('/api/collection/coordinator/assign', requireAuth, requireModule('collection'), async (req: AuthRequest, res) => {
    try {
      const { titleIds, collaboratorId, collectionStatus, transferReason } = (req.body || {}) as {
        titleIds?: number[];
        collaboratorId?: number;
        collectionStatus?: string;
        transferReason?: string;
      };

      const cleanIds = parsePositiveIntArray(titleIds);
      const validCollabId = parsePositiveIntId(collaboratorId);
      if (!validCollabId) {
        return res.status(400).json({ error: 'Selecione um colaborador válido.' });
      }
      if (cleanIds.length === 0) {
        return res.status(400).json({ error: 'Selecione pelo menos um título válido.' });
      }

      const [collab] = await db
        .select()
        .from(collaborators)
        .where(eq(collaborators.id, validCollabId))
        .limit(1);
      if (!collab) {
        return res.status(404).json({ error: 'Colaborador responsável não encontrado.' });
      }

      const targetTitles = await db
        .select()
        .from(financialTitles)
        .where(inArray(financialTitles.id, cleanIds));
      if (targetTitles.length === 0) {
        return res.status(404).json({ error: 'Nenhum título válido encontrado.' });
      }
      for (const t of targetTitles) {
        if (!isUnitPermitted(req, t.unitId)) {
          return res.status(403).json({ error: 'Sem permissão para atribuir títulos desta unidade.' });
        }
      }

      const clientIds = [...new Set(targetTitles.map((t) => t.clientId))];
      const linkedClients = await db
        .select()
        .from(clients)
        .where(inArray(clients.id, clientIds));
      const blockedClients = linkedClients.filter(
        (c) => c.status === 'suspenso' || c.status === 'cancelado'
      );
      if (blockedClients.length > 0) {
        return res.status(403).json({
          error: 'Existem títulos de clientes bloqueados na seleção. Não é possível atribuir/transferir cobrança.',
          blockedClients: blockedClients.map((c) => c.fullName),
        });
      }

      const nextSituation = ['EM_DIA', 'COBRAR', 'NAO_COBRAR'].includes(String(collectionStatus || ''))
        ? String(collectionStatus)
        : 'COBRAR';

      const existingCollabs = await db.select().from(collaborators);
      const collabMap = new Map(existingCollabs.map((c) => [c.id, c.name]));

      const updatedRows = await db
        .update(financialTitles)
        .set({
          assignedCollaboratorId: collab.id,
          collectionStatus: nextSituation,
          updatedAt: new Date(),
        })
        .where(inArray(financialTitles.id, cleanIds))
        .returning();

      const clientMap = new Map(linkedClients.map((c) => [c.id, c]));
      let assignedCount = 0;
      let transferredCount = 0;

      for (const prev of targetTitles) {
        const isTransfer = Boolean(prev.assignedCollaboratorId && prev.assignedCollaboratorId !== collab.id);
        if (isTransfer) transferredCount += 1;
        else if (!prev.assignedCollaboratorId) assignedCount += 1;

        const prevCollabName = prev.assignedCollaboratorId
          ? collabMap.get(prev.assignedCollaboratorId) || `#${prev.assignedCollaboratorId}`
          : 'Sem atribuição';

        const changes: Array<{ field: string; from: string; to: string }> = [
          {
            field: isTransfer ? 'Transferência de Operador' : 'Responsável Cobrança',
            from: prevCollabName,
            to: collab.name,
          },
          {
            field: 'Situação Cobrança',
            from: prev.collectionStatus || 'EM_DIA',
            to: nextSituation,
          },
        ];
        if (transferReason?.trim()) {
          changes.push({
            field: 'Motivo / Observação',
            from: '—',
            to: transferReason.trim(),
          });
        }

        await db.insert(auditLogs).values({
          userId: req.authUser?.id ?? null,
          userName: req.authUser?.name || 'Sistema',
          action: isTransfer ? 'TRANSFER_COLLECTION' : 'ASSIGN_COLLECTION',
          entityType: 'CONTA_RECEBER',
          entityId: String(prev.id),
          details: {
            changes,
            isTransfer,
            fromCollaboratorId: prev.assignedCollaboratorId || null,
            toCollaboratorId: collab.id,
            transferReason: transferReason?.trim() || null,
          },
          unitId: prev.unitId,
        });

        const existingCase = await db
          .select()
          .from(collectionCases)
          .where(eq(collectionCases.titleId, prev.id))
          .limit(1);

        if (existingCase[0]) {
          const transferNote = isTransfer
            ? `\n[Transferido de ${prevCollabName} para ${collab.name} por ${req.authUser?.name || 'Coordenação'}${
                transferReason?.trim() ? `: ${transferReason.trim()}` : ''
              }]`
            : '';
          await db
            .update(collectionCases)
            .set({
              assignedCollectorId: collab.userId ?? existingCase[0].assignedCollectorId,
              conversationSummary: transferNote
                ? `${existingCase[0].conversationSummary || ''}${transferNote}`.trim()
                : existingCase[0].conversationSummary,
              updatedAt: new Date(),
            })
            .where(eq(collectionCases.id, existingCase[0].id));
        } else if (normStatusUpper(prev.status) !== 'PAGO' && normStatusUpper(prev.status) !== 'CANCELADO') {
          const cl = clientMap.get(prev.clientId);
          await db.insert(collectionCases).values({
            titleId: prev.id,
            clientId: prev.clientId,
            unitId: prev.unitId,
            assignedCollectorId: collab.userId ?? null,
            stateCode: (cl?.state || 'PE').toUpperCase().slice(0, 2),
            priorityValueCents: Number(prev.currentBalanceCents || prev.amountCents || 0),
            status: 'em_cobranca',
            conversationSummary: `Atribuído pela Coordenação para ${collab.name}.`,
          });
        }
      }

      deps.broadcast('collection:payment', {
        type: transferredCount > 0 ? 'transfer' : 'assign',
        count: updatedRows.length,
        assignedCount,
        transferredCount,
        collaboratorName: collab.name,
        operator: req.authUser?.name || 'Coordenação',
      });

      res.json({
        updatedCount: updatedRows.length,
        assignedCount,
        transferredCount,
        collaborator: collab,
        titles: updatedRows,
      });
    } catch (error) {
      console.error('POST /api/collection/coordinator/assign error:', error);
      res.status(500).json({ error: 'Erro ao atribuir/transferir colaborador aos títulos.' });
    }
  });

  // ---------------------------------------------------------------------------
  // 4. OPERACIONAL: Baixar pagamento (via case ou diretamente via titleId vencido)
  // ---------------------------------------------------------------------------
  app.post('/api/collection/cases/:id/settle', requireAuth, requireModule('collection'), async (req: AuthRequest, res) => {
    try {
      const caseId = parsePositiveIntId(req.params.id);
      if (!caseId) return res.status(400).json({ error: 'ID de caso de cobrança inválido.' });
      const body = (req.body || {}) as { categoryId?: number; receiptDocId?: number };
      const categoryId = body.categoryId ? parsePositiveIntId(body.categoryId) : undefined;
      const receiptDocId = body.receiptDocId ? parsePositiveIntId(body.receiptDocId) : undefined;

      const rows = await db.select().from(collectionCases).where(eq(collectionCases.id, caseId)).limit(1);
      const colCase = rows[0];
      if (!colCase) return res.status(404).json({ error: 'Caso de cobrança não encontrado.' });
      if (!isUnitPermitted(req, colCase.unitId)) {
        return res.status(403).json({ error: 'Sem permissão para baixar casos desta unidade.' });
      }

      const [titleRow] = await db
        .select()
        .from(financialTitles)
        .where(eq(financialTitles.id, colCase.titleId))
        .limit(1);
      if (!titleRow) return res.status(404).json({ error: 'Título vinculado não encontrado.' });
      if (!isUnitPermitted(req, titleRow.unitId)) {
        return res.status(403).json({ error: 'Sem permissão para baixar títulos desta unidade.' });
      }
      if (normStatusUpper(titleRow.status) === 'PAGO' || normStatusUpper(titleRow.status) === 'CANCELADO') {
        return res.status(409).json({ error: `O título já se encontra com status "${normStatusUpper(titleRow.status)}".` });
      }

      const existingSettlements = await db
        .select()
        .from(titleSettlements)
        .where(eq(titleSettlements.titleId, titleRow.id));
      const alreadySettledCents = existingSettlements.reduce(
        (sum, s) => sum + Number(s.amountCents || 0),
        0
      );
      const remainingBalanceCents = Math.max(
        0,
        Number(
          titleRow.currentBalanceCents ??
            Math.max(0, Number(titleRow.amountCents || 0) - alreadySettledCents)
        )
      );

      let categoryLabel = 'BOLETO';
      if (categoryId) {
        const [catRow] = await db
          .select()
          .from(paymentCategories)
          .where(eq(paymentCategories.id, categoryId))
          .limit(1);
        if (catRow?.name) categoryLabel = catRow.name;
      }

      const points = 25;
      const now = new Date();
      const updatedCase = await db.transaction(async (tx) => {
        await tx
          .update(financialTitles)
          .set({
            status: 'PAGO',
            currentBalanceCents: 0,
            paidAt: now,
            ...(categoryId ? { categoryId } : {}),
            ...(receiptDocId ? { receiptDocId } : {}),
            collectorId: req.authUser!.id,
            updatedAt: now,
          })
          .where(eq(financialTitles.id, colCase.titleId));

        if (remainingBalanceCents > 0) {
          const origCents = Number(titleRow.originalValueCents || titleRow.amountCents || remainingBalanceCents);
          await tx.insert(titleSettlements).values({
            titleId: titleRow.id,
            settlementDate: now,
            principalCents: Math.min(remainingBalanceCents, origCents),
            interestCents: Number(titleRow.interestCents || 0),
            fineCents: Number(titleRow.fineCents || 0),
            discountCents: Number(titleRow.discountCents || 0),
            amountCents: remainingBalanceCents,
            origin: 'COBRANCA_OPERACIONAL',
            paymentMethod: categoryLabel,
            history: `Baixa operacional registrada por ${req.authUser!.name}`,
            createdByName: req.authUser!.name,
          });
        }

        await tx.insert(auditLogs).values({
          userId: req.authUser!.id,
          userName: req.authUser!.name,
          action: 'SETTLE_COLLECTION',
          entityType: 'CONTA_RECEBER',
          entityId: String(titleRow.id),
          details: {
            changes: [
              {
                field: 'Baixa em Cobrança Operacional',
                from: titleRow.status || 'ABERTO',
                to: `PAGO (${(remainingBalanceCents / 100).toLocaleString('pt-BR', {
                  style: 'currency',
                  currency: 'BRL',
                })})`,
              },
            ],
            caseId,
            settledAmountCents: remainingBalanceCents,
            paymentMethod: categoryLabel,
          },
          unitId: titleRow.unitId,
        });

        const [savedCase] = await tx
          .update(collectionCases)
          .set({ status: 'pago', pointsAwarded: colCase.pointsAwarded + points, updatedAt: now })
          .where(eq(collectionCases.id, caseId))
          .returning();

        await tx
          .update(users)
          .set({ points: sql`${users.points} + ${points}` })
          .where(eq(users.id, req.authUser!.id));

        return savedCase;
      });

      deps.broadcast('collection:payment', {
        caseId,
        titleId: titleRow.id,
        operator: req.authUser!.name,
        points,
      });
      res.json({ case: updatedCase, pointsAwarded: points, settledAmountCents: remainingBalanceCents });
    } catch (error) {
      console.error('Settle collection error:', error);
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao baixar título em cobrança.') });
    }
  });

  app.post('/api/collection/titles/:titleId/ensure-case', requireAuth, requireModule('collection'), async (req: AuthRequest, res) => {
    try {
      const titleId = parsePositiveIntId(req.params.titleId);
      if (!titleId) return res.status(400).json({ error: 'ID de título inválido.' });
      const existing = await db
        .select()
        .from(collectionCases)
        .where(eq(collectionCases.titleId, titleId))
        .limit(1);
      if (existing[0]) {
        if (!isUnitPermitted(req, existing[0].unitId)) {
          return res.status(403).json({ error: 'Sem permissão para acessar tratativa desta unidade.' });
        }
        return res.json({ case: existing[0] });
      }

      const [titleRow] = await db
        .select()
        .from(financialTitles)
        .where(eq(financialTitles.id, titleId))
        .limit(1);
      if (!titleRow) return res.status(404).json({ error: 'Título não encontrado.' });
      if (!isUnitPermitted(req, titleRow.unitId)) {
        return res.status(403).json({ error: 'Sem permissão para abrir tratativa nesta unidade.' });
      }

      const [cl] = await db.select().from(clients).where(eq(clients.id, titleRow.clientId)).limit(1);
      let linkedUserId: number | null = req.authUser?.id ?? null;
      if (titleRow.assignedCollaboratorId) {
        const [collab] = await db
          .select({ userId: collaborators.userId })
          .from(collaborators)
          .where(eq(collaborators.id, titleRow.assignedCollaboratorId))
          .limit(1);
        if (collab?.userId) linkedUserId = collab.userId;
      }

      const [created] = await db
        .insert(collectionCases)
        .values({
          titleId: titleRow.id,
          clientId: titleRow.clientId,
          unitId: titleRow.unitId,
          assignedCollectorId: linkedUserId,
          stateCode: (cl?.state || 'PE').toUpperCase().slice(0, 2),
          priorityValueCents: Number(titleRow.currentBalanceCents || titleRow.amountCents || 0),
          status: normStatusUpper(titleRow.status) === 'PAGO' ? 'pago' : 'em_cobranca',
          conversationSummary: '',
        })
        .returning();

      res.json({ case: created });
    } catch (error) {
      console.error('POST /api/collection/titles/:titleId/ensure-case error:', error);
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao abrir tratativa do título vencido.') });
    }
  });

  // ---------------------------------------------------------------------------
  // 5. SUSPENSÃO / CANCELAMENTO / REATIVAÇÃO INTEGRADA AO JURÍDICO & ESCAVADOR
  // ---------------------------------------------------------------------------
  app.post('/api/collection/clients/:clientId/status', requireAuth, requireModule('collection'), async (req: AuthRequest, res) => {
    try {
      const clientId = parsePositiveIntId(req.params.clientId);
      if (!clientId) return res.status(400).json({ error: 'ID de cliente inválido.' });
      const { status, reason, cancelFutureTitles } = (req.body || {}) as {
        status: 'suspenso' | 'cancelado' | 'ativo';
        reason?: string;
        cancelFutureTitles?: boolean;
      };
      if (!['suspenso', 'cancelado', 'ativo'].includes(String(status))) {
        return res.status(400).json({ error: 'Status alvo inválido.' });
      }
      if ((status === 'suspenso' || status === 'cancelado') && !reason?.trim()) {
        return res.status(400).json({ error: 'Informe a causa da suspensão/cancelamento.' });
      }

      const [cl] = await db.select({ id: clients.id, unitId: clients.unitId }).from(clients).where(eq(clients.id, clientId)).limit(1);
      if (!cl) return res.status(404).json({ error: 'Cliente não encontrado.' });
      if (!isUnitPermitted(req, cl.unitId)) {
        return res.status(403).json({ error: 'Sem permissão para alterar clientes desta unidade.' });
      }

      const synced = await syncClientLegalAndEscavadorStatus({
        clientId,
        targetStatus: status,
        reason:
          reason?.trim() ||
          (status === 'ativo' ? 'Retorno ao status normal registrado em Cobrança.' : ''),
        actorUserId: req.authUser!.id,
        actorUserName: req.authUser!.name,
        unitId: req.activeUnitId,
        originLabel: 'Cobrança',
        cancelFutureTitles: Boolean(cancelFutureTitles),
      });
      if (!synced) return res.status(404).json({ error: 'Cliente não encontrado.' });

      deps.broadcast('legal:update', {
        clientId,
        status,
        escavadorMonitored: synced.escavadorMonitored,
        affectedProcessesCount: synced.affectedProcessesCount,
      });
      deps.broadcast('collection:payment', {
        clientId,
        status,
        operator: req.authUser!.name,
      });

      res.json({
        client: synced.client,
        affectedProcessesCount: synced.affectedProcessesCount,
        escavadorMonitored: synced.escavadorMonitored,
        escavadorActionSummary: synced.escavadorActionSummary,
      });
    } catch (error) {
      console.error('Client status error:', error);
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao atualizar status do cliente.') });
    }
  });

  // ---------------------------------------------------------------------------
  // 6. NOTAS DE COBRANÇA & SOLICITAÇÕES DE CANCELAMENTO (PostgreSQL)
  // ---------------------------------------------------------------------------
  app.get('/api/collection-notes', requireAuth, requireModule('collection'), async (req: AuthRequest, res) => {
    try {
      await ensureCollectionNotesColumns();
      const clientId = req.query.clientId ? parsePositiveIntId(req.query.clientId) : null;
      const collaboratorId = req.query.collaboratorId ? parsePositiveIntId(req.query.collaboratorId) : null;
      const titleId = req.query.titleId ? parsePositiveIntId(req.query.titleId) : null;
      if (req.query.clientId && !clientId) return res.status(400).json({ error: 'clientId inválido.' });
      if (req.query.collaboratorId && !collaboratorId) return res.status(400).json({ error: 'collaboratorId inválido.' });
      if (req.query.titleId && !titleId) return res.status(400).json({ error: 'titleId inválido.' });

      const negotiationStatus = req.query.negotiationStatus ? String(req.query.negotiationStatus) : null;
      const allowedUnits = getAllowedUnitIds(req);

      const conditions = [];
      if (clientId) conditions.push(eq(collectionNotes.clientId, clientId));
      if (collaboratorId) conditions.push(eq(collectionNotes.collaboratorId, collaboratorId));
      if (titleId) conditions.push(eq(collectionNotes.titleId, titleId));
      if (negotiationStatus) conditions.push(eq(collectionNotes.negotiationStatus, negotiationStatus));
      if (allowedUnits !== null) conditions.push(inArray(collectionNotes.unitId, allowedUnits));

      const rows =
        conditions.length > 0
          ? await db
              .select()
              .from(collectionNotes)
              .where(and(...conditions))
              .orderBy(desc(collectionNotes.createdAt))
          : await db.select().from(collectionNotes).orderBy(desc(collectionNotes.createdAt));

      res.json({ notes: rows });
    } catch (error) {
      console.error('GET /api/collection-notes error:', error);
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao listar notas de cobrança.') });
    }
  });

  app.post('/api/collection-notes', requireAuth, requireModule('collection'), async (req: AuthRequest, res) => {
    try {
      await ensureCollectionNotesColumns();
      const b = req.body as {
        titleId?: number | null;
        clientId?: number;
        collaboratorId?: number | null;
        collaboratorName?: string;
        contactDate?: string;
        contactTime?: string;
        channel?: string;
        negotiationStatus?: string;
        otherStatusDetail?: string;
        nextContactDate?: string;
        note?: string;
        debtSnapshotJson?: CollectionDebtSnapshot | null;
        attachmentsJson?: CollectionNoteAttachment[];
        cancelRequest?: CollectionCancelRequestInfo | null;
      };

      const clientId = parsePositiveIntId(b.clientId);
      const noteText = String(b.note || '').trim();
      if (!clientId) return res.status(400).json({ error: 'Cliente válido é obrigatório para registrar a nota.' });
      if (!noteText) return res.status(400).json({ error: 'Informe a descrição da nota/tratativa.' });

      const [clientRow] = await db.select().from(clients).where(eq(clients.id, clientId)).limit(1);
      if (!clientRow) return res.status(404).json({ error: 'Cliente não encontrado.' });
      if (!isUnitPermitted(req, clientRow.unitId)) {
        return res.status(403).json({ error: 'Sem permissão para registrar notas para clientes desta unidade.' });
      }

      let resolvedCollabName = String(b.collaboratorName || '').trim() || req.authUser?.name || 'Equipe';
      let resolvedCollabUserId: number | null = req.authUser?.id ?? null;
      const numericCollabId = b.collaboratorId ? parsePositiveIntId(b.collaboratorId) : null;

      if (numericCollabId) {
        const [collabRow] = await db
          .select()
          .from(collaborators)
          .where(eq(collaborators.id, numericCollabId))
          .limit(1);
        if (collabRow) {
          resolvedCollabName = collabRow.name;
          if (collabRow.userId) resolvedCollabUserId = collabRow.userId;
        }
      }

      const validNegotiations = new Set([
        'FECHADA',
        'AGUARDANDO_CONTATO',
        'ENCAMINHOU_BOLETO',
        'RECUSA_DIVIDA',
        'OUTROS',
        'SOLICITA_CANCELAMENTO',
      ]);
      const negotiationStatus = validNegotiations.has(String(b.negotiationStatus || ''))
        ? String(b.negotiationStatus)
        : 'AGUARDANDO_CONTATO';

      const otherStatusDetail =
        negotiationStatus === 'OUTROS' ? String(b.otherStatusDetail || '').trim() : '';
      if (negotiationStatus === 'OUTROS' && !otherStatusDetail) {
        return res.status(400).json({ error: 'Especifique o detalhe quando o status for "Outros".' });
      }

      const rawNextDate = String(b.nextContactDate || '').trim();
      const nextContactDate = /^\d{4}-\d{2}-\d{2}$/.test(rawNextDate) ? rawNextDate : '';

      const nowLocal = new Date();
      const todayIso = `${nowLocal.getFullYear()}-${String(nowLocal.getMonth() + 1).padStart(2, '0')}-${String(
        nowLocal.getDate()
      ).padStart(2, '0')}`;
      const currentTime = `${String(nowLocal.getHours()).padStart(2, '0')}:${String(
        nowLocal.getMinutes()
      ).padStart(2, '0')}`;

      const cancelRequestPayload: CollectionCancelRequestInfo | null =
        negotiationStatus === 'SOLICITA_CANCELAMENTO'
          ? {
              requestDate: b.cancelRequest?.requestDate || todayIso,
              admissionId: b.cancelRequest?.admissionId ?? null,
              admissionContract: b.cancelRequest?.admissionContract || '',
              notes: b.cancelRequest?.notes ?? noteText,
            }
          : b.cancelRequest || null;

      const sanitizedAttachments: CollectionNoteAttachment[] = Array.isArray(b.attachmentsJson)
        ? b.attachmentsJson
            .filter((att) => att && typeof att === 'object' && att.name)
            .map((att, idx) => ({
              id: String(att.id || `att-${Date.now()}-${idx}`),
              name: String(att.name),
              mimeType: String(att.mimeType || 'application/octet-stream'),
              ...(att.sizeBytes !== undefined ? { sizeBytes: Number(att.sizeBytes) } : {}),
              ...(att.documentId !== undefined ? { documentId: att.documentId ? Number(att.documentId) : null } : {}),
              ...(att.storageUri ? { storageUri: String(att.storageUri) } : {}),
              ...(att.dataUrl ? { dataUrl: String(att.dataUrl) } : {}),
            }))
        : [];

      const debtSnapshot: CollectionDebtSnapshot | null =
        b.debtSnapshotJson && typeof b.debtSnapshotJson === 'object'
          ? {
              originalCents: Math.round(Number(b.debtSnapshotJson.originalCents || 0)),
              interestCents: Math.round(Number(b.debtSnapshotJson.interestCents || 0)),
              fineCents: Math.round(Number(b.debtSnapshotJson.fineCents || 0)),
              discountCents: Math.round(Number(b.debtSnapshotJson.discountCents || 0)),
              balanceCents: Math.round(Number(b.debtSnapshotJson.balanceCents || 0)),
            }
          : null;

      const targetUnitId = clientRow.unitId || req.activeUnitId || 1;
      const numericTitleId = b.titleId ? Number(b.titleId) : null;
      const channelUpper = String(b.channel || 'TELEFONE').toUpperCase();

      const [created] = await db
        .insert(collectionNotes)
        .values({
          titleId: numericTitleId,
          clientId,
          collaboratorId: numericCollabId,
          collaboratorName: resolvedCollabName,
          userId: req.authUser?.id ?? null,
          unitId: targetUnitId,
          contactDate: b.contactDate || todayIso,
          contactTime: b.contactTime || currentTime,
          channel: channelUpper,
          negotiationStatus,
          otherStatusDetail,
          nextContactDate: negotiationStatus === 'SOLICITA_CANCELAMENTO' ? '' : nextContactDate,
          note: noteText,
          debtSnapshotJson: debtSnapshot,
          attachmentsJson: sanitizedAttachments,
          cancelRequest: cancelRequestPayload,
        })
        .returning();

      // Auditoria vinculada ao título (para aparecer em Histórico de Movimentações)
      await db.insert(auditLogs).values({
        userId: req.authUser?.id ?? null,
        userName: req.authUser?.name || resolvedCollabName,
        action:
          negotiationStatus === 'SOLICITA_CANCELAMENTO'
            ? 'CANCEL_REQUEST_COLLECTION'
            : 'COLLECTION_NOTE_CREATED',
        entityType: numericTitleId ? 'CONTA_RECEBER' : 'NOTA_COBRANCA',
        entityId: String(numericTitleId || created.id),
        details: {
          changes: [
            {
              field:
                negotiationStatus === 'SOLICITA_CANCELAMENTO'
                  ? 'Solicitação de Cancelamento'
                  : 'Contato de Cobrança',
              from: '—',
              to: `${channelUpper} · ${negotiationStatus}${
                otherStatusDetail ? ` (${otherStatusDetail})` : ''
              }${nextContactDate ? ` · Próx: ${nextContactDate}` : ''} — ${noteText.slice(0, 140)}`,
            },
          ],
          noteId: created.id,
          clientId,
          channel: channelUpper,
          negotiationStatus,
          nextContactDate,
        },
        unitId: targetUnitId,
      });

      // Integrações reais: Notificações internas + Agendamento de Retorno
      let appointmentCreated = false;
      let appointmentId: number | null = null;
      let appointmentError: string | null = null;
      let notificationsSentCount = 0;

      if (negotiationStatus === 'SOLICITA_CANCELAMENTO') {
        try {
          const [allUsersRows, allGroupsRows] = await Promise.all([
            db.select({ id: users.id, role: users.role, groupId: users.groupId, active: users.active }).from(users),
            db.select().from(userGroups),
          ]);
          const groupMap = new Map(allGroupsRows.map((g) => [g.id, g]));
          const targetUserIds = allUsersRows
            .filter((u) => {
              if (!u.active || u.id === req.authUser?.id) return false;
              const roleLower = String(u.role || '').toLowerCase();
              if (roleLower === 'admin' || roleLower === 'coordinator' || roleLower === 'manager') {
                return true;
              }
              const grp = u.groupId ? groupMap.get(u.groupId) : undefined;
              const perms = grp?.modulePermissions || {};
              return Boolean(
                perms.collection_coordenacao ||
                  perms.managerial ||
                  perms.fin_cobranca_coord_visualizar ||
                  perms.collection
              );
            })
            .map((u) => u.id);

          const contractRef = cancelRequestPayload?.admissionContract
            ? ` (Ficha/Contrato ${cancelRequestPayload.admissionContract})`
            : '';
          const msgSubject = `Solicitação de Cancelamento — ${clientRow.fullName}`;
          const msgBody = `${resolvedCollabName} registrou solicitação de cancelamento para ${clientRow.fullName}${contractRef}. Data: ${
            cancelRequestPayload?.requestDate || todayIso
          }. Observações: ${cancelRequestPayload?.notes || noteText}`;

          if (targetUserIds.length > 0) {
            for (const recipientId of targetUserIds) {
              await dispatchIviSectorNotification(
                {
                  targetSector: 'cobranca',
                  targetUnitId: targetUnitId,
                  recipientId,
                  relatedEntityType: 'collection_note',
                  relatedEntityId: created.id,
                  senderName: 'Ivi IA · Cobrança',
                  subject: msgSubject,
                  body: msgBody,
                },
                db,
                deps.broadcast
              );
              notificationsSentCount += 1;
            }
          } else {
            await dispatchIviSectorNotification(
              {
                targetSector: 'cobranca',
                targetUnitId: targetUnitId,
                relatedEntityType: 'collection_note',
                relatedEntityId: created.id,
                senderName: 'Ivi IA · Cobrança',
                subject: msgSubject,
                body: msgBody,
              },
              db,
              deps.broadcast
            );
            notificationsSentCount = 1;
          }
          await dispatchIviSectorNotification(
            {
              targetSector: 'admissao',
              targetUnitId: targetUnitId,
              relatedEntityType: 'collection_note',
              relatedEntityId: created.id,
              senderName: 'Ivi IA · Cobrança',
              subject: `Solicitação de Cancelamento — ${clientRow.fullName}`,
              body: `Cobrança sinalizou solicitação de cancelamento para ${clientRow.fullName}${contractRef}. Verificar histórico comercial.`,
            },
            db,
            deps.broadcast
          );
        } catch (notifErr) {
          console.error('Cancel request notification warning:', notifErr);
        }
      } else if (nextContactDate) {
        try {
          let consultantUserId = resolvedCollabUserId;
          if (!consultantUserId) {
            const [fallbackUser] = await db
              .select({ id: users.id })
              .from(users)
              .orderBy(asc(users.id))
              .limit(1);
            consultantUserId = fallbackUser?.id ?? null;
          }
          if (!consultantUserId) {
            appointmentError = 'Nenhum usuário consultor vinculado para criar o agendamento.';
          } else {
            const scheduledStart = new Date(`${nextContactDate}T12:00:00`);
            const scheduledEnd = new Date(scheduledStart.getTime() + 30 * 60_000);
            const modalityVal =
              channelUpper === 'TELEFONE'
                ? 'telefone'
                : channelUpper === 'PRESENCIAL'
                ? 'presencial'
                : 'online';

            const [appt] = await db
              .insert(appointments)
              .values({
                clientId,
                clientName: clientRow.fullName,
                clientPhone: clientRow.whatsapp || clientRow.phone || '0000000000',
                unitId: targetUnitId,
                attendantId: req.authUser?.id ?? consultantUserId,
                consultantId: consultantUserId,
                collaboratorId: numericCollabId,
                serviceId: null,
                serviceName: 'Retorno de Cobrança',
                modality: modalityVal,
                scheduledFor: scheduledStart,
                endAt: scheduledEnd,
                status: 'agendado',
                notes: `[Cobrança] ${noteText} — Canal: ${channelUpper}`,
                createdByName: req.authUser?.name || resolvedCollabName,
                updatedByName: req.authUser?.name || resolvedCollabName,
              })
              .returning();

            appointmentCreated = true;
            appointmentId = appt.id;
            deps.broadcast('appointments:update', { action: 'created', appointmentId: appt.id });

            const brDate = nextContactDate.split('-').reverse().join('/');
            await dispatchIviSectorNotification(
              {
                targetSector: 'agendamentos',
                targetUnitId: targetUnitId,
                recipientId: consultantUserId,
                relatedEntityType: 'appointment',
                relatedEntityId: appt.id,
                senderName: 'Ivi IA · Cobrança',
                subject: `Retorno de Cobrança Agendado — ${clientRow.fullName}`,
                body: `Agendado retorno de cobrança para ${brDate} (${channelUpper}) por ${resolvedCollabName}: ${noteText}`,
              },
              db,
              deps.broadcast
            );
            await dispatchIviSectorNotification(
              {
                targetSector: 'cobranca',
                targetUnitId: targetUnitId,
                recipientId: consultantUserId,
                relatedEntityType: 'collection_note',
                relatedEntityId: created.id,
                senderName: 'Ivi IA · Cobrança',
                subject: `Cobrança — ${clientRow.fullName}`,
                body: `Retorno de cobrança agendado para ${brDate} (${channelUpper}): ${noteText}`,
              },
              db,
              deps.broadcast
            );
            notificationsSentCount += 2;
          }
        } catch (apptErr) {
          console.error('Collection nextContactDate appointment error:', apptErr);
          appointmentError =
            apptErr instanceof Error ? apptErr.message : 'Falha ao criar agendamento automático.';
        }
      }

      deps.broadcast('collection:note', { action: 'created', note: created });
      res.status(201).json({
        note: created,
        appointmentCreated,
        appointmentId,
        appointmentError,
        notificationsSentCount,
      });
    } catch (error) {
      console.error('POST /api/collection-notes error:', error);
      res.status(500).json({ error: 'Erro ao salvar nota de cobrança.' });
    }
  });

  app.put('/api/collection-notes/:id', requireAuth, requireModule('collection'), async (req: AuthRequest, res) => {
    try {
      await ensureCollectionNotesColumns();
      const id = parsePositiveIntId(req.params.id);
      if (!id) return res.status(400).json({ error: 'ID de nota inválido.' });
      const [existing] = await db.select().from(collectionNotes).where(eq(collectionNotes.id, id)).limit(1);
      if (!existing) return res.status(404).json({ error: 'Nota não encontrada.' });
      if (!isUnitPermitted(req, existing.unitId)) {
        return res.status(403).json({ error: 'Sem permissão para editar notas desta unidade.' });
      }

      const b = req.body as Partial<{
        negotiationStatus: string;
        otherStatusDetail: string;
        nextContactDate: string;
        note: string;
        channel: string;
        debtSnapshotJson: CollectionDebtSnapshot | null;
        attachmentsJson: CollectionNoteAttachment[];
        cancelRequest: CollectionCancelRequestInfo | null;
      }>;
      if (b.note !== undefined && !String(b.note).trim()) {
        return res.status(400).json({ error: 'O texto da nota não pode ser vazio.' });
      }
      const nextNegStatus = b.negotiationStatus || existing.negotiationStatus;
      const nextOtherDetail =
        nextNegStatus === 'OUTROS'
          ? b.otherStatusDetail !== undefined
            ? String(b.otherStatusDetail).trim()
            : existing.otherStatusDetail
          : '';
      if (nextNegStatus === 'OUTROS' && !nextOtherDetail) {
        return res.status(400).json({ error: 'Especifique o detalhe quando o status for "Outros".' });
      }

      const [updated] = await db
        .update(collectionNotes)
        .set({
          ...(b.negotiationStatus ? { negotiationStatus: b.negotiationStatus } : {}),
          otherStatusDetail: nextOtherDetail,
          ...(b.nextContactDate !== undefined
            ? {
                nextContactDate: /^\d{4}-\d{2}-\d{2}$/.test(String(b.nextContactDate || '').trim())
                  ? String(b.nextContactDate).trim()
                  : '',
              }
            : {}),
          ...(b.note !== undefined ? { note: String(b.note).trim() } : {}),
          ...(b.channel ? { channel: String(b.channel).toUpperCase() } : {}),
          ...(b.debtSnapshotJson !== undefined ? { debtSnapshotJson: b.debtSnapshotJson } : {}),
          ...(b.attachmentsJson !== undefined ? { attachmentsJson: b.attachmentsJson } : {}),
          ...(b.cancelRequest !== undefined ? { cancelRequest: b.cancelRequest } : {}),
          updatedAt: new Date(),
        })
        .where(eq(collectionNotes.id, id))
        .returning();

      await db.insert(auditLogs).values({
        userId: req.authUser?.id ?? null,
        userName: req.authUser?.name || 'Sistema',
        action: 'COLLECTION_NOTE_UPDATED',
        entityType: existing.titleId ? 'CONTA_RECEBER' : 'NOTA_COBRANCA',
        entityId: String(existing.titleId || existing.id),
        details: {
          changes: [
            {
              field: 'Edição de Nota de Cobrança',
              from: `${existing.channel} · ${existing.negotiationStatus} — ${existing.note.slice(0, 100)}`,
              to: `${updated.channel} · ${updated.negotiationStatus} — ${updated.note.slice(0, 100)}`,
            },
          ],
          noteId: updated.id,
        },
        unitId: existing.unitId || req.activeUnitId || 1,
      });

      deps.broadcast('collection:note', { action: 'updated', note: updated });
      res.json({ note: updated });
    } catch (error) {
      console.error('PUT /api/collection-notes/:id error:', error);
      res.status(500).json({ error: 'Erro ao atualizar nota de cobrança.' });
    }
  });

  app.delete('/api/collection-notes/:id', requireAuth, requireModule('collection'), async (req: AuthRequest, res) => {
    try {
      await ensureCollectionNotesColumns();
      const id = parsePositiveIntId(req.params.id);
      if (!id) return res.status(400).json({ error: 'ID de nota inválido.' });
      const [existing] = await db.select().from(collectionNotes).where(eq(collectionNotes.id, id)).limit(1);
      if (!existing) return res.status(404).json({ error: 'Nota não encontrada.' });
      if (!isUnitPermitted(req, existing.unitId)) {
        return res.status(403).json({ error: 'Sem permissão para excluir notas desta unidade.' });
      }

      await db.delete(collectionNotes).where(eq(collectionNotes.id, id));

      await db.insert(auditLogs).values({
        userId: req.authUser?.id ?? null,
        userName: req.authUser?.name || 'Sistema',
        action: 'COLLECTION_NOTE_DELETED',
        entityType: existing.titleId ? 'CONTA_RECEBER' : 'NOTA_COBRANCA',
        entityId: String(existing.titleId || existing.id),
        details: {
          changes: [
            {
              field: 'Exclusão de Nota de Cobrança',
              from: `${existing.channel} · ${existing.negotiationStatus} — ${existing.note.slice(0, 100)}`,
              to: 'REMOVIDA',
            },
          ],
          noteId: existing.id,
        },
        unitId: existing.unitId || req.activeUnitId || 1,
      });

      deps.broadcast('collection:note', { action: 'deleted', id });
      res.json({ ok: true });
    } catch (error) {
      console.error('DELETE /api/collection-notes/:id error:', error);
      res.status(500).json({ error: 'Não foi possível excluir a solicitação.' });
    }
  });

  // ---------------------------------------------------------------------------
  // 7. DETALHE DO CLIENTE / FICHAS E ADITIVOS PARA MODAL DA COORDENAÇÃO (§3.3 / §4.5)
  // ---------------------------------------------------------------------------
  const requireAdmView = requireAnyModule('collection', 'audit', 'admission', 'legal');

  app.post('/api/admissions/collection-summary', requireAuth, requireAdmView, async (req: AuthRequest, res) => {
    try {
      const clientIds = parsePositiveIntArray(req.body?.clientIds);
      if (clientIds.length === 0) return res.json({ summary: {} });

      const allowedUnits = getAllowedUnitIds(req);
      const [rawClientAdmissions, rawDocs] = await Promise.all([
        db.select().from(admissions).where(inArray(admissions.clientId, clientIds)),
        db
          .select()
          .from(documentObjects)
          .where(and(inArray(documentObjects.clientId, clientIds), eq(documentObjects.docCategory, 'aditivo'), isNull(documentObjects.deletedAt))),
      ]);
      const clientAdmissions =
        allowedUnits === null ? rawClientAdmissions : rawClientAdmissions.filter((a) => allowedUnits.includes(a.unitId));
      const docs =
        allowedUnits === null ? rawDocs : rawDocs.filter((d) => d.unitId != null && allowedUnits.includes(d.unitId));

      const summary: Record<number, { fichas: number; aditivos: number; latestAddendumDate: string | null }> = {};
      for (const cid of clientIds) {
        const eligibleAdms = clientAdmissions.filter(
          (a) => a.clientId === cid && ELIGIBLE_ADMISSION_STATUSES.has(String(a.status || '').toLowerCase())
        );
        const admIdSet = new Set(eligibleAdms.map((a) => a.id));
        const clientAddendums = docs.filter((d) => d.admissionId && admIdSet.has(d.admissionId));
        let latest: string | null = null;
        for (const ad of clientAddendums) {
          const iso = ad.createdAt ? new Date(ad.createdAt).toISOString() : null;
          if (iso && (!latest || iso > latest)) latest = iso;
        }
        summary[cid] = {
          fichas: eligibleAdms.length,
          aditivos: clientAddendums.length,
          latestAddendumDate: latest,
        };
      }
      res.json({ summary });
    } catch (error) {
      console.error('POST /api/admissions/collection-summary error:', error);
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao calcular resumo de fichas e aditivos.') });
    }
  });

  app.get('/api/admissions/client-detail/:clientId', requireAuth, requireAdmView, async (req: AuthRequest, res) => {
    try {
      const clientId = parsePositiveIntId(req.params.clientId);
      if (!clientId) return res.status(400).json({ error: 'ID de cliente inválido.' });
      const [cl] = await db.select({ id: clients.id, unitId: clients.unitId }).from(clients).where(eq(clients.id, clientId)).limit(1);
      if (!cl) return res.status(404).json({ error: 'Cliente não encontrado.' });
      if (!isUnitPermitted(req, cl.unitId)) {
        return res.status(403).json({ error: 'Sem permissão para consultar detalhes desta unidade.' });
      }

      const clientAdmissions = await db
        .select()
        .from(admissions)
        .where(eq(admissions.clientId, clientId))
        .orderBy(desc(admissions.createdAt))
        .limit(50);

      const eligibleAdmissions = clientAdmissions.filter((a) =>
        ELIGIBLE_ADMISSION_STATUSES.has(String(a.status || '').toLowerCase())
      );

      const admIds = clientAdmissions.map((a) => a.id);
      const [docs, linkedTitles] = await Promise.all([
        admIds.length > 0
          ? db
              .select()
              .from(documentObjects)
              .where(and(inArray(documentObjects.admissionId, admIds), isNull(documentObjects.deletedAt)))
          : Promise.resolve([]),
        db
          .select()
          .from(financialTitles)
          .where(and(eq(financialTitles.clientId, clientId), eq(financialTitles.scope, 'RECEBER')))
          .orderBy(asc(financialTitles.dueDate), asc(financialTitles.id))
          .limit(200),
      ]);

      const admissionsDetail = eligibleAdmissions.map((adm) => {
        const admAddendums = docs.filter((d) => d.admissionId === adm.id && d.docCategory === 'aditivo');
        const latestAddendumDate = admAddendums
          .map((d) => (d.createdAt ? new Date(d.createdAt).toISOString() : ''))
          .filter(Boolean)
          .sort()
          .reverse()[0] || null;
        const parcelas = linkedTitles.filter((t) => t.admissionId === adm.id);
        return {
          admissionId: adm.id,
          contractNumber: adm.contractNumber,
          protocolCode: adm.protocolCode,
          status: adm.status,
          addendumsCount: admAddendums.length,
          hasAddendum: admAddendums.length > 0,
          latestAddendumDate,
          addendums: admAddendums,
          parcelas,
        };
      });

      res.json({
        admissionsDetail,
        allClientTitles: linkedTitles,
      });
    } catch (error) {
      console.error('GET /api/admissions/client-detail/:clientId error:', error);
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao consultar detalhamento do cliente.') });
    }
  });

  // Consulta histórica jurídica / auditoria para Ficha (sem disparar nova varredura Escavador)
  app.get('/api/admissions/:id/legal-scan', requireAuth, requireAdmView, async (req: AuthRequest, res) => {
    try {
      const admissionId = parsePositiveIntId(req.params.id);
      if (!admissionId) return res.status(400).json({ error: 'ID de admissão inválido.' });
      const [adm] = await db.select().from(admissions).where(eq(admissions.id, admissionId)).limit(1);
      if (!adm) return res.status(404).json({ error: 'Ficha de admissão não encontrada.' });
      if (!isUnitPermitted(req, adm.unitId)) {
        return res.status(403).json({ error: 'Sem permissão para acessar fichas desta unidade.' });
      }

      const processes = await db
        .select()
        .from(legalProcesses)
        .where(eq(legalProcesses.admissionId, admissionId))
        .orderBy(desc(legalProcesses.lastMovementAt));

      const procIds = processes.map((p) => p.id);
      const movements =
        procIds.length > 0
          ? await db
              .select()
              .from(legalMovements)
              .where(inArray(legalMovements.processId, procIds))
              .orderBy(desc(legalMovements.createdAt))
          : [];

      const lastProcess = processes[0] || null;
      const lastMovement = movements[0] || null;
      res.json({
        legalScan: {
          performed: processes.length > 0 || adm.escavadorAlert,
          lastUpdate: lastProcess?.escavadorUpdatedAt || lastProcess?.lastMovementAt || adm.auditedAt || null,
          found: processes.length > 0,
          processNumber: lastProcess?.processNumber || null,
          courtName: lastProcess?.courtName || null,
          lastMovement: lastMovement?.originalDispatch || lastProcess?.escavadorLastActionNote || null,
          allProcesses: processes.map((p) => {
            const pMov = movements.find((m) => m.processId === p.id);
            return {
              id: p.id,
              numeroProcesso: p.processNumber,
              tribunal: p.courtName,
              classe: p.actionType,
              status: p.status,
              hasSearchSeizure: p.hasSearchSeizure,
              vehicleSeized: p.vehicleSeized,
              ultimaMovimentacao: pMov?.originalDispatch || p.escavadorLastActionNote || null,
              lastMovementAt: p.lastMovementAt,
            };
          }),
        },
        critiques: adm.auditCritiquesJson || [],
      });
    } catch (error) {
      console.error('GET /api/admissions/:id/legal-scan error:', error);
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao carregar histórico jurídico da ficha.') });
    }
  });

  // ---------------------------------------------------------------------------
  // 8. COMPROVANTE DE PAGAMENTO NO BUCKET DA INVICTA (Anexar e Vincular ao Título)
  // ---------------------------------------------------------------------------
  app.post(
    '/api/financial-titles/:id/receipt',
    requireAuth,
    requireAnyModule('finance', 'collection'),
    receiptUpload.single('file'),
    async (req: AuthRequest, res) => {
      try {
        const titleId = parsePositiveIntId(req.params.id);
        if (!titleId) return res.status(400).json({ error: 'ID de título inválido.' });
        const [titleRow] = await db
          .select()
          .from(financialTitles)
          .where(eq(financialTitles.id, titleId))
          .limit(1);
        if (!titleRow) return res.status(404).json({ error: 'Título financeiro não encontrado.' });
        if (!isUnitPermitted(req, titleRow.unitId)) {
          return res.status(403).json({ error: 'Sem permissão para anexar comprovante neste título.' });
        }

        const file = req.file;
        if (!file) return res.status(400).json({ error: 'Selecione um arquivo de comprovante.' });

        const validationErr = validateUploadFile(file.originalname, file.mimetype, file.size);
        if (validationErr) return res.status(400).json({ error: validationErr });

        const safeFileName = sanitizeFileName(file.originalname);
        const targetUnitId = titleRow.unitId || req.activeUnitId || 1;
        const folderPath = `bucketdainvicta/U${targetUnitId}/C${titleRow.clientId}/COMPROVANTES`;

        const stored = await putBucketObject(file.buffer, {
          folderPath,
          mimeType: file.mimetype,
          originalName: safeFileName,
        });

        const [doc] = await db
          .insert(documentObjects)
          .values({
            clientId: titleRow.clientId,
            admissionId: titleRow.admissionId ?? null,
            folderPath,
            fileName: safeFileName,
            docCategory: 'comprovante',
            mimeType: file.mimetype || 'application/octet-stream',
            sizeBytes: stored.sizeBytes,
            sha256Hash: stored.sha256Hash,
            storageUri: stored.storageUri,
            uploadedBy: req.authUser?.name || 'Coordenação',
            unitId: targetUnitId,
          })
          .returning();

        const [updatedTitle] = await db
          .update(financialTitles)
          .set({
            receiptDocId: doc.id,
            updatedAt: new Date(),
          })
          .where(eq(financialTitles.id, titleId))
          .returning();

        await db.insert(auditLogs).values({
          userId: req.authUser?.id ?? null,
          userName: req.authUser?.name || 'Sistema',
          action: 'ATTACH_RECEIPT',
          entityType: 'CONTA_RECEBER',
          entityId: String(titleId),
          details: {
            changes: [
              {
                field: 'Comprovante (Bucket da Invicta)',
                from: titleRow.receiptDocId ? `Doc #${titleRow.receiptDocId}` : 'Sem comprovante',
                to: `${doc.fileName} (#${doc.id})`,
              },
            ],
            documentId: doc.id,
            sha256Hash: stored.sha256Hash,
            backend: stored.backend,
          },
          unitId: targetUnitId,
        });

        deps.broadcast('collection:payment', {
          type: 'receipt_attached',
          titleId,
          docId: doc.id,
          operator: req.authUser?.name || 'Coordenação',
        });

        res.json({
          document: doc,
          title: updatedTitle,
          backend: stored.backend,
          deduplicated: stored.deduplicated,
        });
      } catch (error) {
        console.error('POST /api/financial-titles/:id/receipt error:', error);
        res.status(500).json({ error: 'Erro ao gravar comprovante no bucket da Invicta.' });
      }
    }
  );

  // ---------------------------------------------------------------------------
  // 9. ESPELHAMENTO SILENCIOSO DA TELA DO OPERADOR (Somente Leitura — ZERO Notificações)
  // ---------------------------------------------------------------------------
  app.get('/api/collection/coordinator/operator-mirror/:collaboratorId', requireAuth, requireModule('collection'), async (req: AuthRequest, res) => {
    try {
      const collaboratorId = parsePositiveIntId(req.params.collaboratorId);
      if (!collaboratorId) return res.status(400).json({ error: 'ID de colaborador inválido.' });
      const [collab] = await db
        .select()
        .from(collaborators)
        .where(eq(collaborators.id, collaboratorId))
        .limit(1);
      if (!collab) return res.status(404).json({ error: 'Colaborador não encontrado.' });

      const allowedUnits = getAllowedUnitIds(req);
      const allowUnit = (uId: number | null | undefined) =>
        allowedUnits === null || (uId != null && allowedUnits.includes(uId));

      const [rawTitles, rawCases, rawClients, rawNotes, allUsers] = await Promise.all([
        db
          .select()
          .from(financialTitles)
          .where(eq(financialTitles.scope, 'RECEBER'))
          .orderBy(asc(financialTitles.dueDate), asc(financialTitles.id)),
        db.select().from(collectionCases),
        db.select().from(clients),
        db.select().from(collectionNotes).orderBy(desc(collectionNotes.createdAt)),
        db
          .select({
            id: users.id,
            name: users.name,
            email: users.email,
            role: users.role,
            points: users.points,
          })
          .from(users),
      ]);
      const allTitles = allowedUnits === null ? rawTitles : rawTitles.filter((t) => allowUnit(t.unitId));
      const allCases = allowedUnits === null ? rawCases : rawCases.filter((c) => allowUnit(c.unitId));
      const allClients = allowedUnits === null ? rawClients : rawClients.filter((c) => allowUnit(c.unitId));
      const allNotes = allowedUnits === null ? rawNotes : rawNotes.filter((n) => allowUnit(n.unitId));

      const rankingUsers = [...allUsers].sort((a, b) => b.points - a.points);
      const linkedUserIndex = collab.userId ? rankingUsers.findIndex((u) => u.id === collab.userId) : -1;
      const linkedUser = linkedUserIndex >= 0 ? rankingUsers[linkedUserIndex] : null;

      const clientMap = new Map(allClients.map((c) => [c.id, c]));
      const caseByTitle = new Map(allCases.map((c) => [c.titleId, c]));

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const calcAging = (due: Date | string) => {
        const d = new Date(due);
        if (Number.isNaN(d.getTime())) return 0;
        d.setHours(0, 0, 0, 0);
        return Math.floor((today.getTime() - d.getTime()) / 86_400_000);
      };

      const operatorTitles = allTitles.filter((t) => {
        if (String(t.titleType || 'PADRAO').toUpperCase() !== 'PADRAO') return false;
        const st = normStatusUpper(t.status);
        if (st === 'CANCELADO' || st === 'AGRUPADO' || st === 'FATURA_GERADA') return false;
        const c = caseByTitle.get(t.id);
        return (
          t.assignedCollaboratorId === collaboratorId ||
          (collab.userId != null && c?.assignedCollectorId === collab.userId)
        );
      });

      const queue = operatorTitles
        .map((t) => {
          const cl = clientMap.get(t.clientId);
          const colCase = caseByTitle.get(t.id);
          const agingDays = calcAging(t.dueDate);
          const st = normStatusUpper(t.status);
          const effectiveCaseStatus =
            st === 'PAGO'
              ? 'pago'
              : cl?.status === 'suspenso'
              ? 'suspenso'
              : cl?.status === 'cancelado'
              ? 'cancelado'
              : colCase?.status || 'em_cobranca';
          return {
            titleId: t.id,
            caseId: colCase?.id ?? null,
            clientId: t.clientId,
            clientName: cl?.fullName || t.clientName || `Cliente #${t.clientId}`,
            clientCpfCnpj: cl?.cpfCnpj || '',
            clientStatus: cl?.status || 'ativo',
            documentNumber: t.documentNumber || t.titleCode,
            titleCode: t.titleCode,
            description: t.description || '',
            dueDate: t.dueDate ? new Date(t.dueDate).toISOString() : '',
            agingDays,
            amountCents: Number(t.originalValueCents || t.amountCents || 0),
            currentBalanceCents: Number(st === 'PAGO' ? 0 : t.currentBalanceCents ?? t.amountCents ?? 0),
            status: t.status,
            collectionStatus: t.collectionStatus || 'COBRAR',
            stateCode: (colCase?.stateCode || cl?.state || 'PE').toUpperCase(),
            conversationSummary: colCase?.conversationSummary || '',
            pointsAwarded: colCase?.pointsAwarded || 0,
            _sortStatus: effectiveCaseStatus,
          };
        })
        .sort((a, b) => {
          if (a._sortStatus === 'em_cobranca' && b._sortStatus !== 'em_cobranca') return -1;
          if (b._sortStatus === 'em_cobranca' && a._sortStatus !== 'em_cobranca') return 1;
          if (b.agingDays !== a.agingDays) return b.agingDays - a.agingDays;
          return b.currentBalanceCents - a.currentBalanceCents;
        })
        .map(({ _sortStatus: _unused, ...rest }) => rest);

      const titleIdSet = new Set(operatorTitles.map((t) => t.id));
      const operatorNotes = allNotes.filter(
        (n) =>
          n.collaboratorId === collaboratorId ||
          (collab.userId != null && n.userId === collab.userId) ||
          (n.titleId != null && titleIdSet.has(n.titleId))
      );

      const openQueue = queue.filter((q) => normStatusUpper(q.status) !== 'PAGO');
      const paidQueue = queue.filter((q) => normStatusUpper(q.status) === 'PAGO');
      const overdueQueue = openQueue.filter((q) => q.agingDays > 0);

      res.json({
        collaborator: collab,
        linkedUser: linkedUser
          ? {
              ...linkedUser,
              rankPosition: linkedUserIndex + 1,
            }
          : null,
        metrics: {
          totalAssignedCount: openQueue.length,
          overdueCount: overdueQueue.length,
          openBalanceCents: openQueue.reduce((s, q) => s + q.currentBalanceCents, 0),
          overdueBalanceCents: overdueQueue.reduce((s, q) => s + q.currentBalanceCents, 0),
          paidCount: paidQueue.length,
          recoveredCents: paidQueue.reduce((s, q) => s + q.amountCents, 0),
          notesCount: operatorNotes.length,
          cancelRequestsCount: operatorNotes.filter((n) => n.negotiationStatus === 'SOLICITA_CANCELAMENTO').length,
        },
        queue,
        notes: operatorNotes,
      });
    } catch (error) {
      console.error('GET /api/collection/coordinator/operator-mirror error:', error);
      res.status(500).json({ error: 'Erro ao carregar visão silenciosa do operador.' });
    }
  });

  // ---------------------------------------------------------------------------
  // 10. IVI COBRANÇA: Resumo WhatsApp (3-Colunas), Insights Proativos e Relatórios Salvos
  // ---------------------------------------------------------------------------
  app.post('/api/collection/coordinator/whatsapp-summary', requireAuth, requireModule('collection'), async (req: AuthRequest, res) => {
    try {
      const { clientId, threadId } = (req.body || {}) as { clientId?: number; threadId?: number };
      const validClientId = parsePositiveIntId(clientId);
      if (!validClientId) return res.status(400).json({ error: 'clientId inválido.' });

      const [clientRows, threads, clientTitles] = await Promise.all([
        db.select().from(clients).where(eq(clients.id, validClientId)).limit(1),
        db.select().from(whatsappThreads).orderBy(desc(whatsappThreads.updatedAt)),
        db
          .select()
          .from(financialTitles)
          .where(and(eq(financialTitles.clientId, validClientId), eq(financialTitles.scope, 'RECEBER'))),
      ]);
      const cl = clientRows[0];
      if (!cl) return res.status(404).json({ error: 'Cliente não encontrado.' });
      if (!isUnitPermitted(req, cl.unitId)) {
        return res.status(403).json({ error: 'Sem permissão para resumir conversas desta unidade.' });
      }

      const phoneDigits = (cl.whatsapp || cl.phone || '').replace(/\D/g, '').slice(-8);
      const clientThreads = threads.filter(
        (th) =>
          th.clientId === cl.id ||
          (phoneDigits.length >= 8 && th.contactPhone.replace(/\D/g, '').endsWith(phoneDigits))
      );
      const targetThreads = threadId
        ? clientThreads.filter((th) => th.id === Number(threadId))
        : clientThreads;
      const effectiveThreads = targetThreads.length > 0 ? targetThreads : clientThreads;
      const threadIds = effectiveThreads.map((t) => t.id);
      const messages =
        threadIds.length > 0
          ? await db
              .select()
              .from(whatsappMessages)
              .where(inArray(whatsappMessages.threadId, threadIds))
              .orderBy(asc(whatsappMessages.createdAt))
          : [];

      const threadProviderMap = new Map(effectiveThreads.map((t) => [t.id, t.provider]));
      const activeThread = effectiveThreads[0] || null;
      const openBalanceCents = clientTitles
        .filter((t) => !EXCLUDED_PORTFOLIO_STATUSES.has(normStatusUpper(t.status)))
        .reduce((s, t) => s + Number(t.currentBalanceCents ?? t.amountCents ?? 0), 0);

      const providerSet = [...new Set(effectiveThreads.map((t) => t.provider.toUpperCase()))];
      const summary = await iviSummarizeCollectionWhatsapp({
        clientName: cl.fullName,
        cpfCnpj: cl.cpfCnpj,
        operatorName: activeThread?.operatorName || 'Operador da Equipe',
        providerLabel: providerSet.join(' + ') || 'WhatsApp',
        openBalanceFormatted: (openBalanceCents / 100).toLocaleString('pt-BR', {
          style: 'currency',
          currency: 'BRL',
        }),
        messages: messages.map((m) => ({
          direction: m.direction,
          senderName: m.senderName,
          contentType: m.contentType,
          body: m.body,
          audioTranscript: m.iviAudioTranscript,
          createdAt: m.createdAt ? new Date(m.createdAt).toLocaleString('pt-BR') : '',
          provider: threadProviderMap.get(m.threadId) || 'gotalk',
        })),
      });

      res.json(summary);
    } catch (error) {
      console.error('POST /api/collection/coordinator/whatsapp-summary error:', error);
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao gerar resumo da Ivi para conversa WhatsApp.') });
    }
  });

  app.post('/api/collection/coordinator/ivi-insights', requireAuth, requireModule('collection'), async (req: AuthRequest, res) => {
    try {
      const allowedUnits = getAllowedUnitIds(req);
      const allowUnit = (uId: number | null | undefined) =>
        allowedUnits === null || (uId != null && allowedUnits.includes(uId));
      const [rawReceberTitles, rawAllClients, allCollabs, rawNotesRows] = await Promise.all([
        db.select().from(financialTitles).where(eq(financialTitles.scope, 'RECEBER')),
        db.select().from(clients),
        db.select().from(collaborators),
        db.select().from(collectionNotes),
      ]);
      const receberTitles = allowedUnits === null ? rawReceberTitles : rawReceberTitles.filter((t) => allowUnit(t.unitId));
      const allClients = allowedUnits === null ? rawAllClients : rawAllClients.filter((c) => allowUnit(c.unitId));
      const notesRows = allowedUnits === null ? rawNotesRows : rawNotesRows.filter((n) => allowUnit(n.unitId));

      const clientMap = new Map(allClients.map((c) => [c.id, c]));
      const collabMap = new Map(allCollabs.map((c) => [c.id, c]));

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const calcAging = (due: Date | string) => {
        const d = new Date(due);
        if (Number.isNaN(d.getTime())) return 0;
        d.setHours(0, 0, 0, 0);
        return Math.floor((today.getTime() - d.getTime()) / 86_400_000);
      };

      const padraoTitles = receberTitles.filter(
        (t) => String(t.titleType || 'PADRAO').toUpperCase() === 'PADRAO'
      );
      const activeTitles = padraoTitles.filter(
        (t) => !EXCLUDED_PORTFOLIO_STATUSES.has(normStatusUpper(t.status))
      );
      const paidTitles = padraoTitles.filter((t) => normStatusUpper(t.status) === 'PAGO');
      const partialTitles = activeTitles.filter((t) => normStatusUpper(t.status) === 'PARCIAL');

      let overdueCount = 0;
      let overdueBalanceCents = 0;
      let unassignedOverdueCount = 0;
      let unassignedOverdueCents = 0;
      let over60DaysCount = 0;
      let over60DaysCents = 0;
      let blockedWithOpenTitlesCount = 0;

      const byUf = new Map<string, { uf: string; overdueCents: number; count: number }>();
      const byOp = new Map<number, { collaboratorId: number; name: string; count: number; overdueCents: number }>();

      for (const t of activeTitles) {
        const bal = Number(t.currentBalanceCents ?? t.amountCents ?? 0);
        const days = calcAging(t.dueDate);
        const cl = clientMap.get(t.clientId);
        if (cl && (cl.status === 'suspenso' || cl.status === 'cancelado')) {
          blockedWithOpenTitlesCount += 1;
        }
        if (days > 0) {
          overdueCount += 1;
          overdueBalanceCents += bal;
          if (!t.assignedCollaboratorId) {
            unassignedOverdueCount += 1;
            unassignedOverdueCents += bal;
          }
          if (days > 60) {
            over60DaysCount += 1;
            over60DaysCents += bal;
          }
          const uf = (cl?.state || 'N/I').toUpperCase();
          const ufEntry = byUf.get(uf) || { uf, overdueCents: 0, count: 0 };
          ufEntry.overdueCents += bal;
          ufEntry.count += 1;
          byUf.set(uf, ufEntry);

          if (t.assignedCollaboratorId) {
            const opEntry = byOp.get(t.assignedCollaboratorId) || {
              collaboratorId: t.assignedCollaboratorId,
              name: collabMap.get(t.assignedCollaboratorId)?.name || `#${t.assignedCollaboratorId}`,
              count: 0,
              overdueCents: 0,
            };
            opEntry.count += 1;
            opEntry.overdueCents += bal;
            byOp.set(t.assignedCollaboratorId, opEntry);
          }
        }
      }

      const payload = await iviAnalyzeCollectionInsights({
        totalActiveCount: activeTitles.length,
        overdueCount,
        partialCount: partialTitles.length,
        paidCount: paidTitles.length,
        totalOpenCents: activeTitles.reduce((s, t) => s + Number(t.currentBalanceCents ?? t.amountCents ?? 0), 0),
        overdueBalanceCents,
        recoveredCents: paidTitles.reduce((s, t) => s + Number(t.originalValueCents || t.amountCents || 0), 0),
        unassignedOverdueCount,
        unassignedOverdueCents,
        over60DaysCount,
        over60DaysCents,
        blockedWithOpenTitlesCount,
        pendingCancelRequestsCount: notesRows.filter(
          (n) => n.negotiationStatus === 'SOLICITA_CANCELAMENTO' && Boolean(n.cancelRequest)
        ).length,
        partialMissingReceiptCount: partialTitles.filter((t) => !t.receiptDocId).length,
        paidMissingReceiptCount: paidTitles.filter((t) => !t.receiptDocId).length,
        topBanks: [],
        topUfs: [...byUf.values()].sort((a, b) => b.overdueCents - a.overdueCents).slice(0, 5),
        operatorLoad: [...byOp.values()].sort((a, b) => b.overdueCents - a.overdueCents).slice(0, 8),
      });

      res.json(payload);
    } catch (error) {
      console.error('POST /api/collection/coordinator/ivi-insights error:', error);
      res.status(500).json({ error: 'Erro ao gerar insights da Ivi.' });
    }
  });

  app.post('/api/collection/coordinator/reports', requireAuth, requireModule('collection'), async (req: AuthRequest, res) => {
    try {
      const { reportType, customPrompt } = (req.body || {}) as {
        reportType?: 'carteira_vencida' | 'ranking_operadores' | 'recebimentos' | 'inadimplencia_uf' | 'custom_ivi';
        customPrompt?: string;
      };
      const allowedUnits = getAllowedUnitIds(req);
      const allowUnit = (uId: number | null | undefined) =>
        allowedUnits === null || (uId != null && allowedUnits.includes(uId));

      const [rawReceberTitles, settlementsRows, rawAllClients, allCollabs, allUsers, rawNotesRows] = await Promise.all([
        db.select().from(financialTitles).where(eq(financialTitles.scope, 'RECEBER')),
        db.select().from(titleSettlements),
        db.select().from(clients),
        db.select().from(collaborators),
        db.select({ id: users.id, name: users.name, role: users.role, points: users.points }).from(users),
        db.select().from(collectionNotes),
      ]);
      const receberTitles = allowedUnits === null ? rawReceberTitles : rawReceberTitles.filter((t) => allowUnit(t.unitId));
      const allClients = allowedUnits === null ? rawAllClients : rawAllClients.filter((c) => allowUnit(c.unitId));
      const notesRows = allowedUnits === null ? rawNotesRows : rawNotesRows.filter((n) => allowUnit(n.unitId));

      const clientMap = new Map(allClients.map((c) => [c.id, c]));
      const collabMap = new Map(allCollabs.map((c) => [c.id, c]));
      const collabByUserId = new Map<number, typeof allCollabs[number]>();
      for (const c of allCollabs) {
        if (c.userId != null) collabByUserId.set(c.userId, c);
      }
      const userMap = new Map(allUsers.map((u) => [u.id, u]));

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const calcAging = (due: Date | string) => {
        const d = new Date(due);
        if (Number.isNaN(d.getTime())) return 0;
        d.setHours(0, 0, 0, 0);
        return Math.floor((today.getTime() - d.getTime()) / 86_400_000);
      };

      const eligibleTitles = receberTitles.filter((t) => {
        if (String(t.titleType || 'PADRAO').toUpperCase() !== 'PADRAO') return false;
        const st = normStatusUpper(t.status);
        if (st === 'PAGO') return true;
        return !EXCLUDED_PORTFOLIO_STATUSES.has(st);
      });

      const titleInputs = eligibleTitles.map((t) => {
        const cl = clientMap.get(t.clientId);
        const st = normStatusUpper(t.status);
        const agingDays = st === 'PAGO' ? 0 : calcAging(t.dueDate);
        return {
          id: t.id,
          documentNumber: t.documentNumber || t.titleCode,
          titleCode: t.titleCode,
          clientId: t.clientId,
          clientName: cl?.fullName || t.clientName || `Cliente #${t.clientId}`,
          clientUf: (cl?.state || 'N/I').toUpperCase(),
          bankName: '',
          dueDateIso: t.dueDate ? new Date(t.dueDate).toISOString().slice(0, 10) : '',
          agingDays,
          originalValueCents: Number(t.originalValueCents || t.amountCents || 0),
          currentBalanceCents: Number(st === 'PAGO' ? 0 : t.currentBalanceCents ?? t.amountCents ?? 0),
          status: t.status,
          collectionStatus: t.collectionStatus || 'EM_DIA',
          collaboratorName: t.assignedCollaboratorId
            ? collabMap.get(t.assignedCollaboratorId)?.name || `#${t.assignedCollaboratorId}`
            : 'Sem atribuição',
          hasReceipt: Boolean(t.receiptDocId),
        };
      });

      const settlementsByTitle = new Map<number, number>();
      for (const s of settlementsRows) {
        settlementsByTitle.set(
          s.titleId,
          (settlementsByTitle.get(s.titleId) || 0) + Number(s.amountCents || 0)
        );
      }

      const operatorsRanking = allCollabs.map((collab) => {
        const linkedUser = collab.userId ? userMap.get(collab.userId) : undefined;
        const cTitles = eligibleTitles.filter(
          (t) =>
            t.assignedCollaboratorId === collab.id ||
            (!t.assignedCollaboratorId && t.collectorId != null && collabByUserId.get(t.collectorId)?.id === collab.id)
        );
        const openTitles = cTitles.filter((t) => normStatusUpper(t.status) !== 'PAGO');
        const paidTitles = cTitles.filter((t) => normStatusUpper(t.status) === 'PAGO');
        const overdueTitles = openTitles.filter((t) => calcAging(t.dueDate) > 0);
        const cNotes = notesRows.filter(
          (n) => n.collaboratorId === collab.id || (collab.userId != null && n.userId === collab.userId)
        );
        const closedTitleIds = new Set<number>();
        let recoveredCents = 0;
        for (const t of cTitles) {
          const st = normStatusUpper(t.status);
          const orig = Number(t.originalValueCents || t.amountCents || 0);
          const bal = Number(t.currentBalanceCents ?? t.amountCents ?? 0);
          const settled = settlementsByTitle.get(t.id) || 0;
          if (st === 'PAGO') {
            closedTitleIds.add(t.id);
            recoveredCents += settled > 0 ? settled : orig;
          } else if (settled > 0 || (st === 'PARCIAL' && orig > bal)) {
            closedTitleIds.add(t.id);
            recoveredCents += settled > 0 ? settled : Math.max(0, orig - bal);
          }
        }
        const closedNotes = cNotes.filter((n) => n.negotiationStatus === 'FECHADA');
        const extraClosedAgreements = closedNotes.filter((n) => !n.titleId || !closedTitleIds.has(n.titleId)).length;
        const closedRecoveriesCount = closedTitleIds.size + extraClosedAgreements;
        return {
          name: collab.name,
          role: collab.jobTitle || linkedUser?.role || 'Cobrança',
          points: linkedUser?.points || 0,
          closedRecoveriesCount,
          assignedCount: openTitles.length,
          overdueCount: overdueTitles.length,
          openBalanceCents: openTitles.reduce((s, t) => s + Number(t.currentBalanceCents ?? t.amountCents ?? 0), 0),
          recoveredCount: paidTitles.length,
          recoveredCents,
          notesCount: cNotes.length,
        };
      }).sort((a, b) => b.closedRecoveriesCount - a.closedRecoveriesCount || b.recoveredCents - a.recoveredCents);

      const built = await iviBuildCollectionReport({
        reportType: reportType || 'carteira_vencida',
        customPrompt,
        titles: titleInputs,
        operatorsRanking,
      });

      const [saved] = await db
        .insert(collectionReports)
        .values({
          title: built.title,
          reportType: built.reportType,
          prompt: built.prompt,
          executiveSummary: built.executiveSummary,
          insightsJson: built.insightsJson,
          columnsJson: built.columnsJson,
          rowsJson: built.rowsJson,
          chartSeriesJson: built.chartSeriesJson,
          provider: built.provider,
          createdByUserId: req.authUser?.id ?? null,
          createdByName: req.authUser?.name || 'Coordenação',
          unitId: req.activeUnitId || 1,
        })
        .returning();

      res.status(201).json({ report: saved });
    } catch (error) {
      console.error('POST /api/collection/coordinator/reports error:', error);
      res.status(500).json({ error: 'Erro ao montar e salvar relatório da Ivi.' });
    }
  });

  app.delete('/api/collection/coordinator/reports/:id', requireAuth, requireModule('collection'), async (req: AuthRequest, res) => {
    try {
      const id = parsePositiveIntId(req.params.id);
      if (!id) return res.status(400).json({ error: 'ID de relatório inválido.' });
      const [existing] = await db
        .select()
        .from(collectionReports)
        .where(eq(collectionReports.id, id))
        .limit(1);
      if (!existing) return res.status(404).json({ error: 'Relatório não encontrado.' });
      if (!isUnitPermitted(req, existing.unitId)) {
        return res.status(403).json({ error: 'Sem permissão para excluir relatórios desta unidade.' });
      }
      await db.delete(collectionReports).where(eq(collectionReports.id, id));
      res.json({ ok: true });
    } catch (error) {
      console.error('DELETE /api/collection/coordinator/reports/:id error:', error);
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao remover relatório salvo.') });
    }
  });

  app.post('/api/collection/coordinator/ivi-state-analysis', requireAuth, requireModule('collection'), async (req: AuthRequest, res) => {
    try {
      const body = (req.body || {}) as {
        month?: string;
        monthLabel?: string;
        collaboratorLabel?: string;
        monthlyTotals?: {
          monthDebtCents: number;
          monthOverdueDebtCents: number;
          monthRecoveredCents: number;
          monthRecoveryRatePct: number;
          monthOpenCount: number;
          monthSettledCount: number;
        };
        stateBreakdown?: Array<{
          uf: string;
          clientsCount: number;
          openTitlesCount: number;
          debtBalanceCents: number;
          overdueDebtCents: number;
          recoveredTotalCents: number;
          recoveryRatePct: number;
          monthDebtCents: number;
          monthRecoveredCents: number;
          monthRecoveryRatePct: number;
        }>;
      };

      const month = String(body.month || new Date().toISOString().slice(0, 7));
      const monthLabel = String(body.monthLabel || month);
      const states = Array.isArray(body.stateBreakdown) ? body.stateBreakdown : [];
      const totals = body.monthlyTotals || {
        monthDebtCents: 0,
        monthOverdueDebtCents: 0,
        monthRecoveredCents: 0,
        monthRecoveryRatePct: 0,
        monthOpenCount: 0,
        monthSettledCount: 0,
      };

      const topDebtUf = [...states].sort((a, b) => b.debtBalanceCents - a.debtBalanceCents)[0];
      const topRecUf = [...states].sort((a, b) => b.recoveredTotalCents - a.recoveredTotalCents)[0];
      const worstOverdueUf = [...states].sort((a, b) => b.overdueDebtCents - a.overdueDebtCents)[0];

      const fmtBRL = (cents: number) =>
        (Number(cents || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

      const fallbackSummary =
        states.length === 0
          ? `Sem registros estaduais ativos para ${monthLabel} com os filtros atuais.`
          : `No recorte de ${monthLabel} (${body.collaboratorLabel || 'Carteira Global'}), o endividamento acumulado do mês soma ${fmtBRL(totals.monthDebtCents)} (com ${fmtBRL(totals.monthOverdueDebtCents)} já vencido) frente a ${fmtBRL(totals.monthRecoveredCents)} recuperados no mês (eficiência mensal de ${totals.monthRecoveryRatePct.toFixed(1)}%). A maior concentração de saldo devedor está em ${topDebtUf?.uf || 'N/I'} (${fmtBRL(topDebtUf?.debtBalanceCents || 0)}), enquanto ${topRecUf?.uf || 'N/I'} lidera em recuperação acumulada (${fmtBRL(topRecUf?.recoveredTotalCents || 0)}).`;

      const fallbackHighlights: string[] = [];
      if (topDebtUf) {
        fallbackHighlights.push(
          `Concentração estadual: ${topDebtUf.uf} concentra ${fmtBRL(topDebtUf.debtBalanceCents)} em aberto (${topDebtUf.openTitlesCount} títulos de ${topDebtUf.clientsCount} clientes), exigindo cadência prioritária.`
        );
      }
      if (worstOverdueUf && worstOverdueUf.overdueDebtCents > 0) {
        fallbackHighlights.push(
          `Risco vencido em ${worstOverdueUf.uf}: ${fmtBRL(worstOverdueUf.overdueDebtCents)} já vencidos na carteira geral; avaliar escalonamento jurídico ou campanha de acordo.`
        );
      }
      if (topRecUf) {
        fallbackHighlights.push(
          `Melhor tração de caixa: ${topRecUf.uf} registra ${fmtBRL(topRecUf.recoveredTotalCents)} recuperados no total (${topRecUf.recoveryRatePct.toFixed(1)}% de conversão estadual).`
        );
      }
      fallbackHighlights.push(
        `Acumulado de ${monthLabel}: ${fmtBRL(totals.monthRecoveredCents)} recuperados sobre ${fmtBRL(totals.monthDebtCents)} previstos no mês (${totals.monthSettledCount} liquidação/baixa registrada).`
      );

      const fallbackFocusUfs = [...states]
        .filter((s) => s.overdueDebtCents > 0 || s.debtBalanceCents > 0)
        .sort((a, b) => b.overdueDebtCents - a.overdueDebtCents || b.debtBalanceCents - a.debtBalanceCents)
        .slice(0, 3)
        .map((s) => s.uf);

      try {
        const promptData = {
          month: monthLabel,
          filtro: body.collaboratorLabel || 'Carteira Global',
          acumuladoMes: {
            endividamentoMes: fmtBRL(totals.monthDebtCents),
            vencidoMes: fmtBRL(totals.monthOverdueDebtCents),
            recuperadoMes: fmtBRL(totals.monthRecoveredCents),
            taxaRecuperacaoMesPct: Number(totals.monthRecoveryRatePct.toFixed(1)),
          },
          estadosTop: states.slice(0, 10).map((s) => ({
            uf: s.uf,
            clientes: s.clientsCount,
            titulosAbertos: s.openTitlesCount,
            endividamentoTotal: fmtBRL(s.debtBalanceCents),
            vencidoTotal: fmtBRL(s.overdueDebtCents),
            recuperadoTotal: fmtBRL(s.recoveredTotalCents),
            taxaRecuperacaoGeralPct: Number(s.recoveryRatePct.toFixed(1)),
            endividamentoMes: fmtBRL(s.monthDebtCents),
            recuperadoMes: fmtBRL(s.monthRecoveredCents),
            taxaRecuperacaoMesPct: Number(s.monthRecoveryRatePct.toFixed(1)),
          })),
        };

        const aiResult = await runIviOrchestrator(
          'Você é Ivi, analista executiva de cobrança do FinancePro. Analise os indicadores de endividamento e recuperação por Estado (UF) e os indicadores acumulados para o mês. Responda EXCLUSIVAMENTE em JSON válido: {"executiveSummary": "texto executivo conciso em PT-BR (máx 3 frases)", "highlights": ["insight 1", "insight 2", "insight 3", "insight 4"], "focusUfs": ["UF1", "UF2"]}.',
          JSON.stringify(promptData)
        );

        const cleaned = aiResult.text.replace(/```json\s*|\s*```/g, '').trim();
        const parsed = JSON.parse(cleaned) as {
          executiveSummary?: string;
          highlights?: string[];
          focusUfs?: string[];
        };

        return res.json({
          month,
          executiveSummary: parsed.executiveSummary || fallbackSummary,
          highlights:
            Array.isArray(parsed.highlights) && parsed.highlights.length > 0
              ? parsed.highlights
              : fallbackHighlights,
          focusUfs:
            Array.isArray(parsed.focusUfs) && parsed.focusUfs.length > 0
              ? parsed.focusUfs
              : fallbackFocusUfs,
          provider: aiResult.provider,
          generatedAt: new Date().toISOString(),
        });
      } catch {
        return res.json({
          month,
          executiveSummary: fallbackSummary,
          highlights: fallbackHighlights,
          focusUfs: fallbackFocusUfs,
          provider: 'ivi_heuristica_local',
          generatedAt: new Date().toISOString(),
        });
      }
    } catch (error) {
      console.error('POST /api/collection/coordinator/ivi-state-analysis error:', error);
      res.status(500).json({ error: 'Erro ao gerar análise estadual e mensal da Ivi.' });
    }
  });
}
