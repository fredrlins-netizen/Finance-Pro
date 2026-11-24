import crypto from 'node:crypto';
import type { Express, NextFunction, Response } from 'express';
import express from 'express';
import { and, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import {
  admissions,
  auditLogs,
  clients,
  documentObjects,
  financialTitles,
  units,
  vaultMigrationBatches,
  vaultMigrationItems,
} from '../db/schema.ts';
import { AuthRequest, requireAdmin, requireAuth } from '../middleware/auth.ts';
import { parsePositiveIntId, sanitizeErrorMessage } from '../utils/validation.ts';
import {
  canPreviewInline,
  completeR2MultipartUpload,
  createR2PresignedUrl,
  getActiveR2ConfigForMigration,
  getBucketObjectBuffer,
  getBucketRuntimeStats,
  initiateR2MultipartUpload,
  purgeAllBucketObjects,
  putBucketObject,
  sanitizeFileName,
  validateUploadFile,
} from '../services/bucketStorage.ts';
import {
  assignIntegrativeCodesBatch,
  extractClientNameFromFolder,
  extractContractCandidates,
  extractUnitCodeCandidates,
  generateIntegrativeCode,
  inferDocCategoryFromPath,
  normalizeCodeToken,
  parseIntegrativeCode,
  scoreClientNameMatch,
  verifyIntegrativeCodeAgainstRecord,
} from '../services/integrativeVaultService.ts';
import {
  evaluateDocumentAccess,
  loadFolderRulesForUser,
  normalizeFolderPath,
} from '../services/documentAccessService.ts';
import { buildWindowsBatchLauncher, buildWindowsR2AgentScript } from '../services/windowsR2AgentBuilder.ts';

function sha256Hex(raw: string): string {
  return crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
}

function generateAgentToken(): { rawToken: string; tokenHash: string; expiresAt: Date } {
  const rawToken = `inv_mig_${crypto.randomBytes(24).toString('hex')}`;
  return {
    rawToken,
    tokenHash: sha256Hex(rawToken),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  };
}

function normalizeContractKey(raw: string): string {
  return String(raw || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, '')
    .trim();
}

export function registerMigrationRoutes(
  app: Express,
  deps: { broadcast: (event: string, payload: unknown) => void }
) {
  // Middleware allowing either Admin JWT OR Scoped Migration Agent Token for a specific batch
  const requireAdminOrBatchAgent = async (req: AuthRequest, res: Response, next: NextFunction) => {
    const agentHeader = String(req.headers['x-migration-agent-token'] || '').trim();
    const batchId = parsePositiveIntId(req.params.id);
    if (agentHeader && batchId) {
      const [batch] = await db
        .select()
        .from(vaultMigrationBatches)
        .where(eq(vaultMigrationBatches.id, batchId))
        .limit(1);
      if (!batch || !batch.agentSessionTokenHash) {
        return res.status(401).json({ error: 'Sessão de migração inválida.' });
      }
      if (batch.tokenExpiresAt && new Date(batch.tokenExpiresAt).getTime() < Date.now()) {
        return res.status(401).json({ error: 'Token do agente expirado. Gere um novo token no painel.' });
      }
      if (sha256Hex(agentHeader) !== batch.agentSessionTokenHash) {
        return res.status(401).json({ error: 'Token do agente CLI não autorizado para este lote.' });
      }
      return next();
    }
    return requireAuth(req, res, () => requireAdmin(req, res, next));
  };

  // List batches + R2 runtime status + Integrative codes stats
  app.get('/api/migration/batches', requireAuth, requireAdmin, async (_req: AuthRequest, res) => {
    try {
      const [batches, bucketStats, [admAgg], [docAgg]] = await Promise.all([
        db.select().from(vaultMigrationBatches).orderBy(desc(vaultMigrationBatches.createdAt)).limit(30),
        getBucketRuntimeStats(),
        db
          .select({
            total: sql<number>`count(*)::int`,
            withCode: sql<number>`count(*) filter (where ${admissions.integrativeCode} is not null and ${admissions.integrativeCode} <> '')::int`,
          })
          .from(admissions),
        db
          .select({
            total: sql<number>`count(*)::int`,
            withCode: sql<number>`count(*) filter (where ${documentObjects.integrativeCode} is not null and ${documentObjects.integrativeCode} <> '')::int`,
            totalBytes: sql<string>`coalesce(sum(${documentObjects.sizeBytes}), 0)::text`,
          })
          .from(documentObjects)
          .where(isNull(documentObjects.deletedAt)),
      ]);

      const totalObjects = Number(docAgg?.total || 0);
      const totalLogicalBytes = Number(docAgg?.totalBytes || 0);
      const integrativeStats = {
        admissionsTotal: Number(admAgg?.total || 0),
        admissionsWithCode: Number(admAgg?.withCode || 0),
        documentsTotal: totalObjects,
        documentsWithCode: Number(docAgg?.withCode || 0),
      };

      res.json({
        batches: batches.map((b) => ({
          ...b,
          agentSessionTokenHash: undefined,
          hasActiveToken: Boolean(
            b.agentSessionTokenHash && (!b.tokenExpiresAt || new Date(b.tokenExpiresAt).getTime() > Date.now())
          ),
        })),
        bucketStats: {
          ...bucketStats,
          activeBackend: bucketStats.backend === 'cloudflare_r2' ? 'CLOUDFLARE_R2' : 'LOCAL_AES256',
          totalObjects,
          totalLogicalBytes,
        },
        integrativeStats,
      });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Erro ao consultar lotes de migração.' });
    }
  });

  // Agent preflight handshake (verifies direct API JSON reachability before scanning 100k+ files)
  app.get('/api/migration/batches/:id/agent-handshake', requireAdminOrBatchAgent, async (req: AuthRequest, res) => {
    try {
      const batchId = parsePositiveIntId(req.params.id);
      if (!batchId) return res.status(400).json({ error: 'ID do lote inválido.' });
      const [batch] = await db
        .select({
          id: vaultMigrationBatches.id,
          batchCode: vaultMigrationBatches.batchCode,
          status: vaultMigrationBatches.status,
          targetUnitIds: vaultMigrationBatches.targetUnitIds,
        })
        .from(vaultMigrationBatches)
        .where(eq(vaultMigrationBatches.id, batchId))
        .limit(1);
      if (!batch) return res.status(404).json({ error: 'Lote não encontrado.' });
      const [r2Cfg, unitRows] = await Promise.all([
        getActiveR2ConfigForMigration(),
        db
          .select({ id: units.id, code: units.code, name: units.name, city: units.city, state: units.state })
          .from(units),
      ]);
      res.json({
        ok: true,
        batchId: batch.id,
        batchCode: batch.batchCode,
        status: batch.status,
        targetUnitIds: batch.targetUnitIds || [],
        units: unitRows,
        r2Configured: Boolean(r2Cfg),
      });
    } catch (error) {
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro no handshake do agente.') });
    }
  });

  // Create new migration / incremental sync batch
  app.post('/api/migration/batches', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { title, syncMode, sourceRootPath, targetUnitIds } = (req.body || {}) as {
        title?: string;
        syncMode?: string;
        sourceRootPath?: string;
        targetUnitIds?: number[];
      };
      const cleanSyncMode = syncMode === 'mirror_review' ? 'mirror_review' : 'incremental';
      const batchCode = `MIG-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${crypto
        .randomBytes(2)
        .toString('hex')
        .toUpperCase()}`;
      const { rawToken, tokenHash, expiresAt } = generateAgentToken();

      const [created] = await db
        .insert(vaultMigrationBatches)
        .values({
          batchCode,
          title: String(title || '').trim() || `Sincronização Base Local (${cleanSyncMode})`,
          sourceRootPath: String(sourceRootPath || '').trim(),
          syncMode: cleanSyncMode,
          status: 'aguardando_agente',
          agentSessionTokenHash: tokenHash,
          tokenExpiresAt: expiresAt,
          targetUnitIds: Array.isArray(targetUnitIds) ? targetUnitIds.map(Number).filter(Boolean) : [],
          createdByUserId: req.authUser!.id,
          createdByName: req.authUser!.name,
        })
        .returning();

      await db.insert(auditLogs).values({
        userId: req.authUser!.id,
        userName: req.authUser!.name,
        action: 'MIGRATION_BATCH_CREATED',
        entityType: 'vault_migration_batch',
        entityId: String(created.id),
        details: { batchCode, syncMode: cleanSyncMode },
        unitId: req.activeUnitId ?? null,
      });

      res.json({
        batch: { ...created, agentSessionTokenHash: undefined, hasActiveToken: true },
        agentToken: rawToken,
      });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Erro ao criar lote de migração.' });
    }
  });

  // Rotate token (returns new raw token once)
  app.post('/api/migration/batches/:id/rotate-token', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const batchId = parsePositiveIntId(req.params.id);
      if (!batchId) return res.status(400).json({ error: 'ID do lote inválido.' });
      const { rawToken, tokenHash, expiresAt } = generateAgentToken();
      const [updated] = await db
        .update(vaultMigrationBatches)
        .set({ agentSessionTokenHash: tokenHash, tokenExpiresAt: expiresAt, updatedAt: new Date() })
        .where(eq(vaultMigrationBatches.id, batchId))
        .returning();
      if (!updated) return res.status(404).json({ error: 'Lote não encontrado.' });
      res.json({ ok: true, agentToken: rawToken, tokenExpiresAt: expiresAt });
    } catch (error) {
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao rotacionar token.') });
    }
  });

  // Download pre-configured Windows CLI script (.mjs) or .bat launcher
  app.get('/api/migration/batches/:id/agent-script', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const batchId = parsePositiveIntId(req.params.id);
      if (!batchId) return res.status(400).json({ error: 'ID do lote inválido.' });
      const kind = String(req.query.kind || 'mjs');
      const [batch] = await db
        .select()
        .from(vaultMigrationBatches)
        .where(eq(vaultMigrationBatches.id, batchId))
        .limit(1);
      if (!batch) return res.status(404).json({ error: 'Lote não encontrado.' });

      const scriptFileName = `invicta-r2-sync-${batch.batchCode}.mjs`;
      if (kind === 'bat') {
        const bat = buildWindowsBatchLauncher({
          scriptFileName,
          batchCode: batch.batchCode,
          defaultRootDir: batch.sourceRootPath || '',
        });
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="executar-${batch.batchCode}.bat"`);
        return res.send(bat);
      }

      // Rotate token cleanly upon script download so downloaded script always carries a valid active credential
      const { rawToken, tokenHash, expiresAt } = generateAgentToken();
      await db
        .update(vaultMigrationBatches)
        .set({ agentSessionTokenHash: tokenHash, tokenExpiresAt: expiresAt, updatedAt: new Date() })
        .where(eq(vaultMigrationBatches.id, batchId));

      const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'https';
      const host = (req.headers['x-forwarded-host'] as string) || req.get('host') || 'localhost:3000';
      const serverUrl = `${proto}://${host}`;

      const script = buildWindowsR2AgentScript({
        serverUrl,
        batchId: batch.id,
        batchCode: batch.batchCode,
        agentToken: rawToken,
        syncMode: batch.syncMode,
      });

      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${scriptFileName}"`);
      return res.send(script);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Erro ao gerar script do agente.' });
    }
  });

  // List items inside a migration batch with SQL filter
  app.get('/api/migration/batches/:id/items', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const batchId = parsePositiveIntId(req.params.id);
      if (!batchId) return res.status(400).json({ error: 'ID do lote inválido.' });
      const filter = String(req.query.filter || 'all');
      const limit = Math.min(200, Math.max(10, Number(req.query.limit || 100) || 100));

      const conditions = [eq(vaultMigrationItems.batchId, batchId)];
      if (filter === 'unit') conditions.push(eq(vaultMigrationItems.itemScope, 'unit'));
      else if (filter === 'interlinked') conditions.push(eq(vaultMigrationItems.itemScope, 'interlinked'));
      else if (filter === 'unmatched') conditions.push(eq(vaultMigrationItems.status, 'unmatched'));
      else if (filter === 'updated') {
        conditions.push(
          sql`${vaultMigrationItems.action} in ('update_content', 'update_path')`
        );
      } else if (filter === 'created') conditions.push(eq(vaultMigrationItems.action, 'create'));
      else if (filter === 'blocked') conditions.push(eq(vaultMigrationItems.status, 'blocked'));
      else if (filter === 'failed') conditions.push(eq(vaultMigrationItems.status, 'failed'));

      const items = await db
        .select()
        .from(vaultMigrationItems)
        .where(and(...conditions))
        .orderBy(desc(vaultMigrationItems.id))
        .limit(limit);

      res.json({
        items,
        totalMatching: items.length,
      });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Erro ao listar itens do lote.' });
    }
  });

  // Core Incremental & Initial Manifest Diff + Presigned R2 S3 URL Issuer
  app.post('/api/migration/batches/:id/manifest-diff', requireAdminOrBatchAgent, async (req: AuthRequest, res) => {
    try {
      const batchId = parsePositiveIntId(req.params.id);
      if (!batchId) return res.status(400).json({ error: 'ID do lote inválido.' });
      const [batch] = await db
        .select()
        .from(vaultMigrationBatches)
        .where(eq(vaultMigrationBatches.id, batchId))
        .limit(1);
      if (!batch) return res.status(404).json({ error: 'Lote de migração não encontrado.' });

      const { sourceRootPath, dryRun, fallbackUnitId, preferServerFallback, files } = (req.body || {}) as {
        sourceRootPath?: string;
        dryRun?: boolean;
        fallbackUnitId?: number;
        preferServerFallback?: boolean;
        files: Array<{
          unitFolderName: string;
          pathSegmentsFromUnit?: string[];
          relativeSubpath?: string;
          contractFolderName?: string;
          extractedContractNumber?: string;
          extractedUnitCode?: string;
          fileName: string;
          legacySourcePath: string;
          mimeType: string;
          sizeBytes: number;
          sha256Hash: string;
        }>;
      };

      if (!Array.isArray(files)) return res.status(400).json({ error: 'Manifesto inválido.' });

      const [allUnits, allAdmissions, allClients, allDocs, pendingResolvedItems, r2Cfg] = await Promise.all([
        db.select().from(units),
        db
          .select({
            id: admissions.id,
            unitId: admissions.unitId,
            clientId: admissions.clientId,
            contractNumber: admissions.contractNumber,
            protocolCode: admissions.protocolCode,
            legacyProtocolCode: admissions.legacyProtocolCode,
          })
          .from(admissions),
        db.select({ id: clients.id, fullName: clients.fullName }).from(clients),
        db
          .select({
            id: documentObjects.id,
            unitId: documentObjects.unitId,
            clientId: documentObjects.clientId,
            admissionId: documentObjects.admissionId,
            scope: documentObjects.scope,
            unitFolderPath: documentObjects.unitFolderPath,
            relativeSubpath: documentObjects.relativeSubpath,
            fileName: documentObjects.fileName,
            sha256Hash: documentObjects.sha256Hash,
            storageUri: documentObjects.storageUri,
            integrativeCode: documentObjects.integrativeCode,
            isInterlinked: documentObjects.isInterlinked,
            versionNumber: documentObjects.versionNumber,
            legacySourcePath: documentObjects.legacySourcePath,
            mimeType: documentObjects.mimeType,
          })
          .from(documentObjects)
          .where(isNull(documentObjects.deletedAt)),
        db
          .select()
          .from(vaultMigrationItems)
          .where(and(eq(vaultMigrationItems.batchId, batchId), eq(vaultMigrationItems.status, 'pending'))),
        getActiveR2ConfigForMigration(),
      ]);

      const unitById = new Map(allUnits.map((u) => [u.id, u]));
      const admById = new Map(allAdmissions.map((a) => [a.id, a]));
      const clientById = new Map(allClients.map((c) => [c.id, c]));
      const manualBySourcePath = new Map<string, (typeof pendingResolvedItems)[number]>();
      const manualByFolderPair = new Map<string, (typeof pendingResolvedItems)[number]>();
      const manualUnitOnlyByFolder = new Map<string, number>();
      const supersededPendingItemIds: number[] = [];
      for (const pItem of pendingResolvedItems) {
        if (pItem.legacySourcePath && pItem.admissionId) {
          manualBySourcePath.set(pItem.legacySourcePath.toLowerCase(), pItem);
        }
        if (pItem.unitFolderName && pItem.contractFolderName && pItem.admissionId) {
          manualByFolderPair.set(`${pItem.unitFolderName}::${pItem.contractFolderName}`, pItem);
        }
        if (pItem.unitFolderName && pItem.unitId) {
          manualUnitOnlyByFolder.set(pItem.unitFolderName, pItem.unitId);
        }
      }

      // Unit lookup by normalized unit code (primary) and unit name/city (secondary)
      const unitByCodeNorm = new Map<string, (typeof allUnits)[number]>();
      for (const u of allUnits) {
        unitByCodeNorm.set(normalizeCodeToken(u.code), u);
      }
      for (const u of allUnits) {
        const nCity = normalizeCodeToken(u.city);
        const nName = normalizeCodeToken(u.name);
        if (nCity && !unitByCodeNorm.has(nCity)) unitByCodeNorm.set(nCity, u);
        if (nName && !unitByCodeNorm.has(nName)) unitByCodeNorm.set(nName, u);
      }

      // Admission lookup by unit + contractNumber/protocol, plus list per unit for deep client-name fallback
      const admByUnitAndContract = new Map<string, (typeof allAdmissions)[number]>();
      const admByContractGlobal = new Map<string, Array<(typeof allAdmissions)[number]>>();
      const admListByUnit = new Map<number, Array<(typeof allAdmissions)[number]>>();
      for (const a of allAdmissions) {
        const unitArr = admListByUnit.get(a.unitId) || [];
        unitArr.push(a);
        admListByUnit.set(a.unitId, unitArr);

        for (const rawKey of [a.contractNumber, a.protocolCode, a.legacyProtocolCode]) {
          const ck = normalizeContractKey(rawKey || '');
          if (!ck) continue;
          const variants = [ck];
          if (/^0+\d{2,}$/.test(ck)) {
            variants.push(ck.replace(/^0+/, ''));
          }
          for (const vk of variants) {
            if (!admByUnitAndContract.has(`${a.unitId}::${vk}`)) {
              admByUnitAndContract.set(`${a.unitId}::${vk}`, a);
            }
            const list = admByContractGlobal.get(vk) || [];
            if (!list.some((x) => x.id === a.id)) {
              list.push(a);
            }
            admByContractGlobal.set(vk, list);
          }
        }
      }

      // Existing document indexes (Clients + Unit Files):
      const docByLogicalKey = new Map<string, (typeof allDocs)[number]>();
      const docByAdmAndHash = new Map<string, (typeof allDocs)[number]>();
      const docByUnitLogicalKey = new Map<string, (typeof allDocs)[number]>();
      const docByUnitAndHash = new Map<string, (typeof allDocs)[number]>();
      const storageUriBySha = new Map<string, string>();
      for (const d of allDocs) {
        if (d.sha256Hash && d.storageUri && !d.storageUri.endsWith('pending-sync')) {
          storageUriBySha.set(d.sha256Hash, d.storageUri);
        }
        if (d.scope === 'unit' || !d.clientId) {
          const uPath = normalizeFolderPath(d.unitFolderPath || d.relativeSubpath || '');
          const uKey = `UNIT::${d.unitId}::${uPath.toLowerCase()}::${d.fileName.toLowerCase()}`;
          docByUnitLogicalKey.set(uKey, d);
          if (d.sha256Hash) {
            docByUnitAndHash.set(`UNIT::${d.unitId}::${d.sha256Hash}`, d);
          }
        } else if (d.admissionId) {
          const rel = (d.relativeSubpath || d.fileName).toLowerCase();
          docByLogicalKey.set(`${d.unitId}::${d.admissionId}::${rel}`, d);
          if (d.sha256Hash) {
            docByAdmAndHash.set(`${d.admissionId}::${d.sha256Hash}`, d);
          }
        }
      }

      const decisions: Array<Record<string, unknown>> = [];
      let incScanned = 0;
      let incBytes = 0;
      let incCreated = 0;
      let incUpdatedPath = 0;
      let incDedup = 0;
      let incSavedBytes = 0;
      let incUnmatched = 0;
      let incUnitFiles = 0;
      let incInterlinked = 0;
      let incBlocked = 0;

      for (const f of files) {
        incScanned++;
        incBytes += Number(f.sizeBytes || 0);
        const safeName = sanitizeFileName(f.fileName);

        let segments: string[];
        if (Array.isArray(f.pathSegmentsFromUnit) && f.pathSegmentsFromUnit.length > 0) {
          segments = f.pathSegmentsFromUnit.map((s) => String(s || '').trim()).filter(Boolean);
        } else if (typeof f.relativeSubpath === 'string' && f.relativeSubpath.trim()) {
          const parts = f.relativeSubpath
            .replace(/\\/g, '/')
            .split('/')
            .map((s) => s.trim())
            .filter(Boolean);
          const lastLower = (parts[parts.length - 1] || '').toLowerCase();
          if (parts.length > 0 && (lastLower === safeName.toLowerCase() || lastLower === String(f.fileName || '').trim().toLowerCase())) {
            segments = parts;
          } else {
            segments = [...parts, safeName];
          }
        } else if (typeof f.contractFolderName === 'string' && f.contractFolderName.trim()) {
          segments = [f.contractFolderName.trim(), safeName];
        } else {
          segments = [safeName];
        }
        if (segments.length === 0) segments = [safeName];

        // 1. Security check: block executables & active scripts only
        const secErr = validateUploadFile(safeName, f.mimeType || 'application/octet-stream', Math.max(1, Number(f.sizeBytes || 1)));
        const isZeroByte = Number(f.sizeBytes || 0) <= 0;
        if (secErr && !isZeroByte) {
          incBlocked++;
          if (!dryRun) {
            await db.insert(vaultMigrationItems).values({
              batchId,
              unitFolderName: f.unitFolderName,
              relativeSubpath: segments.join('/'),
              fileName: safeName,
              legacySourcePath: f.legacySourcePath || '',
              mimeType: f.mimeType || 'application/octet-stream',
              sizeBytes: Number(f.sizeBytes || 0),
              sha256Hash: f.sha256Hash || '',
              action: 'blocked_ext',
              status: 'blocked',
              errorMessage: secErr,
            });
          }
          decisions.push({ legacySourcePath: f.legacySourcePath, action: 'blocked_ext', errorMessage: secErr });
          continue;
        }

        // 2. Resolve Unit by leading Unit Code in unitFolderName (or manual resolution override)
        const folderSegments = segments.slice(0, Math.max(0, segments.length - 1));
        const rawSourceLower = String(f.legacySourcePath || '').toLowerCase();
        const manualExactHit = rawSourceLower ? manualBySourcePath.get(rawSourceLower) : undefined;
        const manualPairHit =
          manualExactHit ||
          (folderSegments[0] ? manualByFolderPair.get(`${f.unitFolderName}::${folderSegments[0]}`) : undefined);

        const parsedFallbackUnitId = fallbackUnitId ? parsePositiveIntId(fallbackUnitId) : null;
        const validFallbackUnit = parsedFallbackUnitId ? unitById.get(parsedFallbackUnitId) : undefined;

        const unitCandidates = [
          ...extractUnitCodeCandidates(f.unitFolderName),
          ...(f.extractedUnitCode ? [String(f.extractedUnitCode).trim()] : []),
        ].filter(Boolean);
        let matchedUnit: (typeof allUnits)[number] | undefined =
          manualPairHit?.unitId ? unitById.get(manualPairHit.unitId) : undefined;
        if (!matchedUnit && manualUnitOnlyByFolder.has(f.unitFolderName)) {
          matchedUnit = unitById.get(manualUnitOnlyByFolder.get(f.unitFolderName)!);
        }
        let extractedUnitCode = matchedUnit?.code || unitCandidates[0] || '';
        if (!matchedUnit) {
          for (const uc of unitCandidates) {
            const hit = unitByCodeNorm.get(normalizeCodeToken(uc));
            if (hit) {
              matchedUnit = hit;
              extractedUnitCode = hit.code;
              break;
            }
          }
        }
        if (!matchedUnit) {
          const folderTokenNorm = normalizeCodeToken(f.unitFolderName);
          if (folderTokenNorm) {
            const subHit = allUnits.find((u) => {
              const cCity = normalizeCodeToken(u.city);
              const cName = normalizeCodeToken(u.name);
              return (
                (cCity.length >= 4 && folderTokenNorm.includes(cCity)) ||
                (cName.length >= 4 && folderTokenNorm.includes(cName))
              );
            });
            if (subHit) {
              matchedUnit = subHit;
              extractedUnitCode = subHit.code;
            }
          }
        }
        if (!matchedUnit && validFallbackUnit) {
          matchedUnit = validFallbackUnit;
          extractedUnitCode = validFallbackUnit.code;
        }

        if (!matchedUnit) {
          incUnmatched++;
          if (!dryRun) {
            await db.insert(vaultMigrationItems).values({
              batchId,
              unitFolderName: f.unitFolderName,
              extractedUnitCode,
              relativeSubpath: segments.join('/'),
              fileName: safeName,
              legacySourcePath: f.legacySourcePath || '',
              mimeType: f.mimeType || 'application/octet-stream',
              sizeBytes: Number(f.sizeBytes || 0),
              sha256Hash: f.sha256Hash || '',
              action: 'unmatched_unit',
              status: 'unmatched',
              errorMessage: `Unidade não localizada pelo prefixo "${extractedUnitCode || f.unitFolderName}"`,
            });
          }
          decisions.push({ legacySourcePath: f.legacySourcePath, action: 'unmatched_unit' });
          continue;
        }

        // 3. Verificação profunda de cada subpasta (ex: ADMINISTRAÇÃO, MODELOS DE CONTRATOS, COMERCIAL, PC GERAL)
        // procurando pastas iniciadas com Número do Contrato e/ou Nome do Cliente.
        let matchedAdm: (typeof allAdmissions)[number] | undefined =
          manualPairHit?.admissionId ? admById.get(manualPairHit.admissionId) : undefined;
        let contractFolderName = matchedAdm ? (folderSegments[0] || '') : '';
        let extractedContractNumber = matchedAdm?.contractNumber || '';
        let matchedSegmentIndex = 0;
        const unitFolderPath = normalizeFolderPath(folderSegments.join('/'));

        if (matchedAdm && manualExactHit) {
          supersededPendingItemIds.push(manualExactHit.id);
        }

        if (!matchedAdm) {
          for (let idx = 0; idx < folderSegments.length; idx++) {
            const seg = folderSegments[idx];
            const cands = [
              ...extractContractCandidates(seg),
              ...(idx === folderSegments.length - 1 && f.extractedContractNumber ? [String(f.extractedContractNumber).trim()] : []),
            ];
            const segClientName = extractClientNameFromFolder(seg);

            // 3a. Correspondência direta por Número do Contrato / Protocolo (prioridade na Unidade)
            for (const cand of cands) {
              const ckRaw = normalizeContractKey(cand);
              if (!ckRaw) continue;
              const ckVariants = /^0+\d{2,}$/.test(ckRaw) ? [ckRaw, ckRaw.replace(/^0+/, '')] : [ckRaw];
              for (const ck of ckVariants) {
                const hitUnit = admByUnitAndContract.get(`${matchedUnit.id}::${ck}`);
                if (hitUnit) {
                  matchedAdm = hitUnit;
                  contractFolderName = seg;
                  extractedContractNumber = hitUnit.contractNumber;
                  matchedSegmentIndex = idx;
                  break;
                }
                const globalList = admByContractGlobal.get(ck);
                if (globalList && globalList.length === 1) {
                  matchedAdm = globalList[0];
                  contractFolderName = seg;
                  extractedContractNumber = globalList[0].contractNumber;
                  matchedSegmentIndex = idx;
                  break;
                }
                if (globalList && globalList.length > 1) {
                  if (segClientName) {
                    const scored = globalList.find((a) => {
                      const cl = clientById.get(a.clientId);
                      return cl ? scoreClientNameMatch(segClientName, cl.fullName) >= 0.75 : false;
                    });
                    if (scored) {
                      matchedAdm = scored;
                      contractFolderName = seg;
                      extractedContractNumber = scored.contractNumber;
                      matchedSegmentIndex = idx;
                      break;
                    }
                  }
                  const unitCodePrefix = normalizeCodeToken(matchedUnit.code);
                  const protoUnitHit = globalList.filter((a) =>
                    normalizeCodeToken(a.protocolCode || a.legacyProtocolCode || '').startsWith(unitCodePrefix)
                  );
                  if (protoUnitHit.length === 1) {
                    matchedAdm = protoUnitHit[0];
                    contractFolderName = seg;
                    extractedContractNumber = protoUnitHit[0].contractNumber;
                    matchedSegmentIndex = idx;
                    break;
                  }
                }
              }
              if (matchedAdm) break;
            }
            if (matchedAdm) break;

            // 3b. Verificação combinada Contrato + Nome do Cliente dentro de subpastas (ADMINISTRAÇÃO, COMERCIAL, PC GERAL, MODELOS)
            if (segClientName && cands.length > 0) {
              const unitAdms = admListByUnit.get(matchedUnit.id) || [];
              let bestAdm: (typeof allAdmissions)[number] | undefined;
              let bestScore = 0;
              for (const adm of unitAdms) {
                const cl = clientById.get(adm.clientId);
                if (!cl) continue;
                const nameScore = scoreClientNameMatch(segClientName, cl.fullName);
                if (nameScore < 0.8) continue;
                const admContractDigits = normalizeContractKey(adm.contractNumber).replace(/\D/g, '');
                const candMatchesDigits = cands.some((c) => {
                  const cd = normalizeContractKey(c).replace(/\D/g, '');
                  return cd.length >= 2 && admContractDigits.includes(cd);
                });
                const combinedScore = nameScore + (candMatchesDigits ? 0.5 : 0);
                if (combinedScore > bestScore && (candMatchesDigits || nameScore >= 0.92)) {
                  bestScore = combinedScore;
                  bestAdm = adm;
                }
              }
              if (bestAdm) {
                matchedAdm = bestAdm;
                contractFolderName = seg;
                extractedContractNumber = bestAdm.contractNumber;
                matchedSegmentIndex = idx;
                break;
              }
            }
          }
        }

        // Classificação:
        //  - matchedAdm dentro de subpasta departamental (idx > 0) => 'interlinked' (Cliente + Admissão + Caminho da Unidade)
        //  - matchedAdm direto na raiz (idx === 0) => 'client'
        //  - sem matchedAdm => 'unit' (Pasta Geral da Unidade em Arquivos da Unidade)
        const isInterlinked = Boolean(matchedAdm && matchedSegmentIndex > 0);
        const itemScope: 'client' | 'unit' | 'interlinked' = matchedAdm
          ? isInterlinked
            ? 'interlinked'
            : 'client'
          : 'unit';
        const docScope: 'client' | 'unit' = matchedAdm ? 'client' : 'unit';

        if (itemScope === 'unit') incUnitFiles++;
        if (itemScope === 'interlinked') incInterlinked++;

        const relInsideContract =
          matchedAdm && folderSegments.length > matchedSegmentIndex + 1
            ? [...folderSegments.slice(matchedSegmentIndex + 1), safeName].join('/')
            : matchedAdm
            ? safeName
            : unitFolderPath
            ? `${unitFolderPath}/${safeName}`
            : safeName;

        const subDirPart = relInsideContract.includes('/') ? `/${relInsideContract.slice(0, relInsideContract.lastIndexOf('/'))}` : '';
        const targetFolderPath = matchedAdm
          ? `bucketdainvicta/U${matchedUnit.id}/C${matchedAdm.clientId}/ADM-${matchedAdm.id}${subDirPart}`
          : `bucketdainvicta/U${matchedUnit.id}/UNIT${unitFolderPath ? `/${unitFolderPath}` : ''}`;

        const logicalKey = matchedAdm
          ? `${matchedUnit.id}::${matchedAdm.id}::${relInsideContract.toLowerCase()}`
          : `UNIT::${matchedUnit.id}::${unitFolderPath.toLowerCase()}::${safeName.toLowerCase()}`;
        const existingAtPath = matchedAdm
          ? docByLogicalKey.get(logicalKey)
          : docByUnitLogicalKey.get(logicalKey);

        // Case A: Same logical path & same SHA-256 -> Unchanged (0 bytes)
        if (existingAtPath && existingAtPath.sha256Hash === f.sha256Hash && existingAtPath.storageUri && !existingAtPath.storageUri.endsWith('pending-sync')) {
          incDedup++;
          incSavedBytes += Number(f.sizeBytes || 0);
          if (!dryRun) {
            await db
              .update(documentObjects)
              .set({
                lastSyncedAt: new Date(),
                legacySourcePath: f.legacySourcePath || existingAtPath.legacySourcePath,
                unitFolderPath,
                isInterlinked: isInterlinked || existingAtPath.isInterlinked,
                scope: docScope,
                migrationBatchId: batchId,
              })
              .where(eq(documentObjects.id, existingAtPath.id));
            await db.insert(vaultMigrationItems).values({
              batchId,
              unitFolderName: f.unitFolderName,
              extractedUnitCode,
              unitId: matchedUnit.id,
              itemScope,
              unitFolderPath,
              contractFolderName,
              extractedContractNumber,
              clientId: matchedAdm?.clientId ?? null,
              admissionId: matchedAdm?.id ?? null,
              documentObjectId: existingAtPath.id,
              relativeSubpath: relInsideContract,
              fileName: safeName,
              legacySourcePath: f.legacySourcePath || '',
              mimeType: f.mimeType || 'application/octet-stream',
              sizeBytes: Number(f.sizeBytes || 0),
              sha256Hash: f.sha256Hash || '',
              storageUri: existingAtPath.storageUri,
              action: 'unchanged',
              status: 'completed',
              integrativeCode: existingAtPath.integrativeCode || '',
            });
          }
          decisions.push({ legacySourcePath: f.legacySourcePath, action: 'unchanged', itemScope, unitId: matchedUnit.id });
          continue;
        }

        // Case B: Moved/renamed folder within same scope with identical SHA-256 -> Update folderPath without re-upload
        const existingMoved = !existingAtPath
          ? matchedAdm
            ? docByAdmAndHash.get(`${matchedAdm.id}::${f.sha256Hash}`)
            : docByUnitAndHash.get(`UNIT::${matchedUnit.id}::${f.sha256Hash}`)
          : undefined;
        if (existingMoved) {
          incUpdatedPath++;
          incSavedBytes += Number(f.sizeBytes || 0);
          if (!dryRun) {
            await db
              .update(documentObjects)
              .set({
                folderPath: targetFolderPath,
                relativeSubpath: relInsideContract,
                unitFolderPath,
                isInterlinked,
                scope: docScope,
                fileName: safeName,
                legacySourcePath: f.legacySourcePath || '',
                lastSyncedAt: new Date(),
                migrationBatchId: batchId,
              })
              .where(eq(documentObjects.id, existingMoved.id));
            await db.insert(vaultMigrationItems).values({
              batchId,
              unitFolderName: f.unitFolderName,
              extractedUnitCode,
              unitId: matchedUnit.id,
              itemScope,
              unitFolderPath,
              contractFolderName,
              extractedContractNumber,
              clientId: matchedAdm?.clientId ?? null,
              admissionId: matchedAdm?.id ?? null,
              documentObjectId: existingMoved.id,
              relativeSubpath: relInsideContract,
              fileName: safeName,
              legacySourcePath: f.legacySourcePath || '',
              mimeType: f.mimeType || 'application/octet-stream',
              sizeBytes: Number(f.sizeBytes || 0),
              sha256Hash: f.sha256Hash || '',
              storageUri: existingMoved.storageUri,
              action: 'update_path',
              status: 'completed',
              integrativeCode: existingMoved.integrativeCode || '',
            });
          }
          decisions.push({ legacySourcePath: f.legacySourcePath, action: 'update_path', itemScope, unitId: matchedUnit.id });
          continue;
        }

        // Case C: Global CAS deduplication hit (content already stored in R2/CAS)
        const existingStorageUri = f.sha256Hash ? storageUriBySha.get(f.sha256Hash) : undefined;
        const actionType: 'create' | 'update_content' = existingAtPath ? 'update_content' : 'create';
        if (existingStorageUri) {
          if (dryRun) {
            decisions.push({ legacySourcePath: f.legacySourcePath, action: actionType, itemScope, unitId: matchedUnit.id, deduplicatedInstant: true });
            continue;
          }
          incDedup++;
          incSavedBytes += Number(f.sizeBytes || 0);
          let docId: number;
          let intCode = existingAtPath?.integrativeCode || '';
          if (existingAtPath) {
            await db
              .update(documentObjects)
              .set({
                previousSha256: existingAtPath.sha256Hash,
                sha256Hash: f.sha256Hash,
                storageUri: existingStorageUri,
                sizeBytes: Number(f.sizeBytes || 0),
                mimeType: f.mimeType || existingAtPath.mimeType,
                folderPath: targetFolderPath,
                relativeSubpath: relInsideContract,
                unitFolderPath,
                isInterlinked,
                scope: docScope,
                legacySourcePath: f.legacySourcePath || '',
                versionNumber: (existingAtPath.versionNumber || 1) + 1,
                lastSyncedAt: new Date(),
                migrationBatchId: batchId,
              })
              .where(eq(documentObjects.id, existingAtPath.id));
            docId = existingAtPath.id;
          } else {
            incCreated++;
            const [insDoc] = await db
              .insert(documentObjects)
              .values({
                clientId: matchedAdm?.clientId ?? null,
                admissionId: matchedAdm?.id ?? null,
                scope: docScope,
                unitFolderPath,
                isInterlinked,
                unitId: matchedUnit.id,
                folderPath: targetFolderPath,
                relativeSubpath: relInsideContract,
                legacySourcePath: f.legacySourcePath || '',
                fileName: safeName,
                docCategory: matchedAdm ? inferDocCategoryFromPath(relInsideContract, safeName) : 'arquivo_unidade',
                mimeType: f.mimeType || 'application/octet-stream',
                sizeBytes: Number(f.sizeBytes || 0),
                sha256Hash: f.sha256Hash,
                storageUri: existingStorageUri,
                uploadedBy: `Agente R2 (${batch.batchCode})`,
                versionNumber: 1,
                lastSyncedAt: new Date(),
                migrationBatchId: batchId,
              })
              .returning();
            docId = insDoc.id;
            intCode = generateIntegrativeCode({
              unitCode: matchedUnit.code,
              entityType: docScope === 'unit' ? 'UNID' : 'DOC',
              entityId: docId,
              referenceSeed: f.sha256Hash || safeName,
            });
            await db.update(documentObjects).set({ integrativeCode: intCode }).where(eq(documentObjects.id, docId));
            if (matchedAdm) {
              docByLogicalKey.set(logicalKey, insDoc);
            } else {
              docByUnitLogicalKey.set(logicalKey, insDoc);
            }
          }
          await db.insert(vaultMigrationItems).values({
            batchId,
            unitFolderName: f.unitFolderName,
            extractedUnitCode,
            unitId: matchedUnit.id,
            itemScope,
            unitFolderPath,
            contractFolderName,
            extractedContractNumber,
            clientId: matchedAdm?.clientId ?? null,
            admissionId: matchedAdm?.id ?? null,
            documentObjectId: docId,
            relativeSubpath: relInsideContract,
            fileName: safeName,
            legacySourcePath: f.legacySourcePath || '',
            mimeType: f.mimeType || 'application/octet-stream',
            sizeBytes: Number(f.sizeBytes || 0),
            sha256Hash: f.sha256Hash,
            storageUri: existingStorageUri,
            action: actionType,
            status: 'completed',
            integrativeCode: intCode,
          });
          decisions.push({ legacySourcePath: f.legacySourcePath, action: actionType, itemScope, unitId: matchedUnit.id, deduplicatedInstant: true });
          continue;
        }

        // Case D: Needs binary upload (create or update_content)
        if (dryRun) {
          decisions.push({ legacySourcePath: f.legacySourcePath, action: actionType, itemScope, unitId: matchedUnit.id });
          continue;
        }

        const [migItem] = await db
          .insert(vaultMigrationItems)
          .values({
            batchId,
            unitFolderName: f.unitFolderName,
            extractedUnitCode,
            unitId: matchedUnit.id,
            itemScope,
            unitFolderPath,
            contractFolderName,
            extractedContractNumber,
            clientId: matchedAdm?.clientId ?? null,
            admissionId: matchedAdm?.id ?? null,
            documentObjectId: existingAtPath?.id ?? null,
            relativeSubpath: relInsideContract,
            fileName: safeName,
            legacySourcePath: f.legacySourcePath || '',
            mimeType: f.mimeType || 'application/octet-stream',
            sizeBytes: Number(f.sizeBytes || 0),
            sha256Hash: f.sha256Hash || '',
            action: actionType,
            status: 'awaiting_upload',
          })
          .returning();

        const cleanHash = String(f.sha256Hash || '').toLowerCase();
        const objectKey = `bucketdainvicta/objects/${cleanHash.slice(0, 2) || '00'}/${cleanHash || migItem.id}.bin`;

        if (r2Cfg) {
          const storageUri = `r2-s3://${r2Cfg.bucketName}/${objectKey}`;
          if (Number(f.sizeBytes || 0) >= 28 * 1024 * 1024) {
            const uploadId = await initiateR2MultipartUpload(r2Cfg, objectKey, {
              sha256: cleanHash,
              originalName: safeName,
              originalMime: f.mimeType || 'application/octet-stream',
              logicalFolder: targetFolderPath,
            });
            decisions.push({
              legacySourcePath: f.legacySourcePath,
              action: actionType,
              itemScope,
              itemId: migItem.id,
              uploadMode: 'r2_multipart',
              objectKey,
              uploadId,
              storageUri,
            });
          } else if (preferServerFallback) {
            decisions.push({
              legacySourcePath: f.legacySourcePath,
              action: actionType,
              itemScope,
              itemId: migItem.id,
              uploadMode: 'server_fallback',
            });
          } else {
            const presignedPutUrl = createR2PresignedUrl({
              method: 'PUT',
              endpoint: r2Cfg.endpoint,
              bucketName: r2Cfg.bucketName,
              objectKey,
              expiresSeconds: 3600,
              accessKeyId: r2Cfg.accessKeyId,
              secretAccessKey: r2Cfg.secretAccessKey,
            });
            decisions.push({
              legacySourcePath: f.legacySourcePath,
              action: actionType,
              itemScope,
              itemId: migItem.id,
              uploadMode: 'r2_presigned',
              objectKey,
              presignedPutUrl,
              storageUri,
            });
          }
        } else {
          decisions.push({
            legacySourcePath: f.legacySourcePath,
            action: actionType,
            itemScope,
            itemId: migItem.id,
            uploadMode: 'server_fallback',
          });
        }
      }

      if (!dryRun) {
        if (supersededPendingItemIds.length > 0) {
          await db
            .delete(vaultMigrationItems)
            .where(inArray(vaultMigrationItems.id, supersededPendingItemIds));
        }

        await db
          .update(vaultMigrationBatches)
          .set({
            status: 'em_andamento',
            sourceRootPath: sourceRootPath || batch.sourceRootPath,
            totalFilesScanned: sql`${vaultMigrationBatches.totalFilesScanned} + ${incScanned}`,
            totalBytesScanned: sql`${vaultMigrationBatches.totalBytesScanned} + ${incBytes}`,
            createdCount: sql`${vaultMigrationBatches.createdCount} + ${incCreated}`,
            updatedPathCount: sql`${vaultMigrationBatches.updatedPathCount} + ${incUpdatedPath}`,
            deduplicatedCount: sql`${vaultMigrationBatches.deduplicatedCount} + ${incDedup}`,
            savedBytesByDedup: sql`${vaultMigrationBatches.savedBytesByDedup} + ${incSavedBytes}`,
            unmatchedCount: sql`${vaultMigrationBatches.unmatchedCount} + ${incUnmatched}`,
            unitFilesCount: sql`${vaultMigrationBatches.unitFilesCount} + ${incUnitFiles}`,
            interlinkedCount: sql`${vaultMigrationBatches.interlinkedCount} + ${incInterlinked}`,
            blockedCount: sql`${vaultMigrationBatches.blockedCount} + ${incBlocked}`,
            lastHeartbeatAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(vaultMigrationBatches.id, batchId));

        deps.broadcast('migration:progress', { batchId, batchCode: batch.batchCode });
      }

      res.json({ ok: true, decisions });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Erro no diff do manifesto.' });
    }
  });

  // Sign R2 Multipart UploadPart URLs
  app.post('/api/migration/batches/:id/multipart/sign-parts', requireAdminOrBatchAgent, async (req: AuthRequest, res) => {
    try {
      const batchId = parsePositiveIntId(req.params.id);
      if (!batchId) return res.status(400).json({ error: 'ID do lote inválido.' });
      const [batch] = await db.select({ id: vaultMigrationBatches.id }).from(vaultMigrationBatches).where(eq(vaultMigrationBatches.id, batchId)).limit(1);
      if (!batch) return res.status(404).json({ error: 'Lote não encontrado.' });

      const r2Cfg = await getActiveR2ConfigForMigration();
      if (!r2Cfg) return res.status(400).json({ error: 'Cloudflare R2 não configurado.' });
      const { objectKey, uploadId, partNumbers } = (req.body || {}) as {
        objectKey: string;
        uploadId: string;
        partNumbers: number[];
      };
      if (!objectKey || !uploadId || !Array.isArray(partNumbers) || !String(objectKey).startsWith('bucketdainvicta/objects/')) {
        return res.status(400).json({ error: 'Parâmetros multipart inválidos.' });
      }
      const partUrls: Record<string, string> = {};
      for (const pn of partNumbers.slice(0, 10000)) {
        partUrls[String(pn)] = createR2PresignedUrl({
          method: 'PUT',
          endpoint: r2Cfg.endpoint,
          bucketName: r2Cfg.bucketName,
          objectKey,
          query: { partNumber: String(pn), uploadId },
          expiresSeconds: 7200,
          accessKeyId: r2Cfg.accessKeyId,
          secretAccessKey: r2Cfg.secretAccessKey,
        });
      }
      res.json({ partUrls });
    } catch (error) {
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao assinar partes multipart.') });
    }
  });

  // Server-proxied R2 Multipart UploadPart fallback (bypasses browser CORS while keeping chunks <= 16 MB)
  app.put(
    '/api/migration/batches/:id/multipart/proxy-part',
    requireAdminOrBatchAgent,
    express.raw({ type: '*/*', limit: '16mb' }),
    async (req: AuthRequest, res) => {
      try {
        const batchId = parsePositiveIntId(req.params.id);
        if (!batchId) return res.status(400).json({ error: 'ID do lote inválido.' });
        const [batch] = await db
          .select({ id: vaultMigrationBatches.id })
          .from(vaultMigrationBatches)
          .where(eq(vaultMigrationBatches.id, batchId))
          .limit(1);
        if (!batch) return res.status(404).json({ error: 'Lote não encontrado.' });

        const r2Cfg = await getActiveR2ConfigForMigration();
        if (!r2Cfg) return res.status(400).json({ error: 'Cloudflare R2 não configurado.' });

        const objectKey = String(req.query.objectKey || '').trim();
        const uploadId = String(req.query.uploadId || '').trim();
        const partNumber = parsePositiveIntId(req.query.partNumber);
        if (!objectKey || !uploadId || !partNumber || !objectKey.startsWith('bucketdainvicta/objects/')) {
          return res.status(400).json({ error: 'Parâmetros multipart proxy inválidos.' });
        }

        const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '');
        const signedUrl = createR2PresignedUrl({
          method: 'PUT',
          endpoint: r2Cfg.endpoint,
          bucketName: r2Cfg.bucketName,
          objectKey,
          query: { partNumber: String(partNumber), uploadId },
          expiresSeconds: 600,
          accessKeyId: r2Cfg.accessKeyId,
          secretAccessKey: r2Cfg.secretAccessKey,
        });

        const r2Resp = await fetch(signedUrl, {
          method: 'PUT',
          body: new Uint8Array(buf),
          signal: AbortSignal.timeout(120_000),
        });
        if (!r2Resp.ok) {
          const txt = await r2Resp.text().catch(() => '');
          return res.status(502).json({ error: `R2 UploadPart #${partNumber} HTTP ${r2Resp.status}: ${txt.slice(0, 160)}` });
        }
        const etag = r2Resp.headers.get('etag') || r2Resp.headers.get('ETag') || '';
        return res.json({ ok: true, partNumber, etag });
      } catch (error) {
        return res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao enviar parte multipart ao R2.') });
      }
    }
  );

  // Complete R2 Multipart Upload
  app.post('/api/migration/batches/:id/multipart/complete', requireAdminOrBatchAgent, async (req: AuthRequest, res) => {
    try {
      const batchId = parsePositiveIntId(req.params.id);
      if (!batchId) return res.status(400).json({ error: 'ID do lote inválido.' });
      const [batch] = await db.select({ id: vaultMigrationBatches.id }).from(vaultMigrationBatches).where(eq(vaultMigrationBatches.id, batchId)).limit(1);
      if (!batch) return res.status(404).json({ error: 'Lote não encontrado.' });

      const r2Cfg = await getActiveR2ConfigForMigration();
      if (!r2Cfg) return res.status(400).json({ error: 'Cloudflare R2 não configurado.' });
      const { objectKey, uploadId, parts } = (req.body || {}) as {
        objectKey: string;
        uploadId: string;
        parts: Array<{ partNumber: number; etag: string }>;
      };
      if (!objectKey || !uploadId || !String(objectKey).startsWith('bucketdainvicta/objects/')) {
        return res.status(400).json({ error: 'Parâmetros multipart inválidos.' });
      }
      await completeR2MultipartUpload(r2Cfg, objectKey, uploadId, parts || []);
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao concluir multipart R2.') });
    }
  });

  // Local Encrypted CAS Upload Fallback (when R2 credentials are absent in preview)
  app.put(
    '/api/migration/batches/:id/upload-fallback/:itemId',
    requireAdminOrBatchAgent,
    express.raw({ type: '*/*', limit: '30mb' }),
    async (req: AuthRequest, res) => {
      try {
        const batchId = parsePositiveIntId(req.params.id);
        const itemId = parsePositiveIntId(req.params.itemId);
        if (!batchId || !itemId) return res.status(400).json({ error: 'Identificadores de lote/item inválidos.' });
        const [item] = await db
          .select()
          .from(vaultMigrationItems)
          .where(and(eq(vaultMigrationItems.id, itemId), eq(vaultMigrationItems.batchId, batchId)))
          .limit(1);
        if (!item) return res.status(404).json({ error: 'Item de migração não encontrado.' });

        const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '');
        const isUnitOnly = item.itemScope === 'unit' || !item.clientId;
        const unitFolderClean = normalizeFolderPath(item.unitFolderPath || '');
        const subDir = item.relativeSubpath.includes('/')
          ? `/${item.relativeSubpath.slice(0, item.relativeSubpath.lastIndexOf('/'))}`
          : '';
        const folderPath = isUnitOnly
          ? `bucketdainvicta/U${item.unitId || 1}/UNIT${unitFolderClean ? `/${unitFolderClean}` : ''}`
          : `bucketdainvicta/U${item.unitId || 1}/C${item.clientId}/ADM-${item.admissionId || 0}${subDir}`;
        const stored = await putBucketObject(buf, {
          folderPath,
          mimeType: item.mimeType,
          originalName: item.fileName,
        });

        await finalizeSingleCommittedItem({
          batchId,
          item,
          storageUri: stored.storageUri,
          actualSha256: stored.sha256Hash,
          actualBytes: stored.sizeBytes,
        });

        deps.broadcast('migration:progress', { batchId });
        res.json({ ok: true, storageUri: stored.storageUri });
      } catch (error) {
        res.status(500).json({ error: error instanceof Error ? error.message : 'Erro no upload fallback.' });
      }
    }
  );

  async function finalizeSingleCommittedItem(params: {
    batchId: number;
    item: typeof vaultMigrationItems.$inferSelect;
    storageUri: string;
    actualSha256?: string;
    actualBytes?: number;
  }) {
    const { item, batchId, storageUri } = params;
    const [batch] = await db
      .select()
      .from(vaultMigrationBatches)
      .where(eq(vaultMigrationBatches.id, batchId))
      .limit(1);
    const [unitRow] = item.unitId
      ? await db.select().from(units).where(eq(units.id, item.unitId)).limit(1)
      : [undefined];
    const unitCode = unitRow?.code || `U${item.unitId || 1}`;
    const isUnitOnly = item.itemScope === 'unit' || !item.clientId;
    const isInterlinked = item.itemScope === 'interlinked';
    const docScope: 'unit' | 'client' = isUnitOnly ? 'unit' : 'client';
    const unitFolderClean = normalizeFolderPath(item.unitFolderPath || '');

    const subDir = item.relativeSubpath.includes('/')
      ? `/${item.relativeSubpath.slice(0, item.relativeSubpath.lastIndexOf('/'))}`
      : '';
    const folderPath = isUnitOnly
      ? `bucketdainvicta/U${item.unitId || 1}/UNIT${unitFolderClean ? `/${unitFolderClean}` : ''}`
      : `bucketdainvicta/U${item.unitId || 1}/C${item.clientId}${
          item.admissionId ? `/ADM-${item.admissionId}` : '/GERAL'
        }${subDir}`;
    const sha = params.actualSha256 || item.sha256Hash;
    const size = params.actualBytes ?? item.sizeBytes;

    let docId = item.documentObjectId;
    let integrativeCode = item.integrativeCode || '';

    if (item.action === 'update_content' && docId) {
      const [existingDoc] = await db.select().from(documentObjects).where(eq(documentObjects.id, docId)).limit(1);
      if (existingDoc) {
        integrativeCode =
          existingDoc.integrativeCode ||
          generateIntegrativeCode({
            unitCode,
            entityType: docScope === 'unit' ? 'UNID' : 'DOC',
            entityId: docId,
            referenceSeed: sha || item.fileName,
          });
        await db
          .update(documentObjects)
          .set({
            previousSha256: existingDoc.sha256Hash,
            sha256Hash: sha,
            storageUri,
            sizeBytes: size,
            mimeType: item.mimeType,
            folderPath,
            relativeSubpath: item.relativeSubpath,
            unitFolderPath: unitFolderClean,
            isInterlinked,
            scope: docScope,
            legacySourcePath: item.legacySourcePath,
            versionNumber: (existingDoc.versionNumber || 1) + 1,
            integrativeCode,
            lastSyncedAt: new Date(),
            migrationBatchId: batchId,
          })
          .where(eq(documentObjects.id, docId));
      }
      await db
        .update(vaultMigrationBatches)
        .set({
          updatedContentCount: sql`${vaultMigrationBatches.updatedContentCount} + 1`,
          uploadedBytes: sql`${vaultMigrationBatches.uploadedBytes} + ${size}`,
          lastHeartbeatAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(vaultMigrationBatches.id, batchId));
    } else {
      const [insDoc] = await db
        .insert(documentObjects)
        .values({
          clientId: isUnitOnly ? null : item.clientId,
          admissionId: isUnitOnly ? null : item.admissionId ?? null,
          scope: docScope,
          unitFolderPath: unitFolderClean,
          isInterlinked,
          unitId: item.unitId || 1,
          folderPath,
          relativeSubpath: item.relativeSubpath,
          legacySourcePath: item.legacySourcePath,
          fileName: item.fileName,
          docCategory: isUnitOnly ? 'arquivo_unidade' : inferDocCategoryFromPath(item.relativeSubpath, item.fileName),
          mimeType: item.mimeType,
          sizeBytes: size,
          sha256Hash: sha,
          storageUri,
          uploadedBy: `Agente R2 (${batch?.batchCode || batchId})`,
          versionNumber: 1,
          lastSyncedAt: new Date(),
          migrationBatchId: batchId,
        })
        .returning();
      docId = insDoc.id;
      integrativeCode = generateIntegrativeCode({
        unitCode,
        entityType: docScope === 'unit' ? 'UNID' : 'DOC',
        entityId: docId,
        referenceSeed: sha || item.fileName,
      });
      await db.update(documentObjects).set({ integrativeCode }).where(eq(documentObjects.id, docId));

      await db
        .update(vaultMigrationBatches)
        .set({
          createdCount: sql`${vaultMigrationBatches.createdCount} + 1`,
          uploadedBytes: sql`${vaultMigrationBatches.uploadedBytes} + ${size}`,
          lastHeartbeatAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(vaultMigrationBatches.id, batchId));
    }

    await db
      .update(vaultMigrationItems)
      .set({
        documentObjectId: docId ?? null,
        storageUri,
        integrativeCode,
        status: 'completed',
        updatedAt: new Date(),
      })
      .where(eq(vaultMigrationItems.id, item.id));
  }

  // Commit batch of direct R2 presigned / multipart uploads
  app.post('/api/migration/batches/:id/commit-items', requireAdminOrBatchAgent, async (req: AuthRequest, res) => {
    try {
      const batchId = parsePositiveIntId(req.params.id);
      if (!batchId) return res.status(400).json({ error: 'ID do lote inválido.' });
      const { items } = (req.body || {}) as {
        items: Array<{ itemId: number; storageUri?: string; success: boolean; errorMessage?: string }>;
      };
      if (!Array.isArray(items)) return res.status(400).json({ error: 'Lista de itens inválida.' });

      let committed = 0;
      let failed = 0;
      for (const entry of items) {
        const parsedEntryId = parsePositiveIntId(entry?.itemId);
        if (!parsedEntryId) continue;
        const [item] = await db
          .select()
          .from(vaultMigrationItems)
          .where(and(eq(vaultMigrationItems.id, parsedEntryId), eq(vaultMigrationItems.batchId, batchId)))
          .limit(1);
        if (!item) continue;

        if (!entry.success) {
          failed++;
          await db
            .update(vaultMigrationItems)
            .set({ status: 'failed', errorMessage: entry.errorMessage || 'Falha no upload', updatedAt: new Date() })
            .where(eq(vaultMigrationItems.id, item.id));
          await db
            .update(vaultMigrationBatches)
            .set({ failedCount: sql`${vaultMigrationBatches.failedCount} + 1`, updatedAt: new Date() })
            .where(eq(vaultMigrationBatches.id, batchId));
          continue;
        }

        if (entry.storageUri) {
          await finalizeSingleCommittedItem({ batchId, item, storageUri: entry.storageUri });
          committed++;
        }
      }

      deps.broadcast('migration:progress', { batchId });
      res.json({ ok: true, committed, failed });
    } catch (error) {
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao confirmar itens do lote.') });
    }
  });

  // Finalize batch status
  app.post('/api/migration/batches/:id/finalize', requireAdminOrBatchAgent, async (req: AuthRequest, res) => {
    try {
      const batchId = parsePositiveIntId(req.params.id);
      if (!batchId) return res.status(400).json({ error: 'ID do lote inválido.' });
      const [batch] = await db
        .select()
        .from(vaultMigrationBatches)
        .where(eq(vaultMigrationBatches.id, batchId))
        .limit(1);
      if (!batch) return res.status(404).json({ error: 'Lote não encontrado.' });

      const batchItems = await db
        .select({ status: vaultMigrationItems.status })
        .from(vaultMigrationItems)
        .where(eq(vaultMigrationItems.batchId, batchId));
      const actualUnmatched = batchItems.filter((i) => i.status === 'unmatched').length;
      const actualFailed = batchItems.filter((i) => i.status === 'failed').length;

      const nextStatus =
        actualUnmatched > 0 || actualFailed > 0 ? 'concluido_com_pendencias' : 'concluido';
      const [updated] = await db
        .update(vaultMigrationBatches)
        .set({
          unmatchedCount: actualUnmatched,
          failedCount: actualFailed,
          status: nextStatus,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(vaultMigrationBatches.id, batchId))
        .returning();

      deps.broadcast('migration:progress', { batchId, status: nextStatus });
      res.json({ ok: true, batch: { ...updated, agentSessionTokenHash: undefined } });
    } catch (error) {
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao finalizar lote.') });
    }
  });

  // Cancel active/pending batch
  app.post('/api/migration/batches/:id/cancel', requireAdminOrBatchAgent, async (req: AuthRequest, res) => {
    try {
      const batchId = parsePositiveIntId(req.params.id);
      if (!batchId) return res.status(400).json({ error: 'ID do lote inválido.' });
      const [batch] = await db
        .select()
        .from(vaultMigrationBatches)
        .where(eq(vaultMigrationBatches.id, batchId))
        .limit(1);
      if (!batch) return res.status(404).json({ error: 'Lote não encontrado.' });

      await db
        .update(vaultMigrationItems)
        .set({
          status: 'cancelled',
          errorMessage: 'Processo cancelado pelo usuário.',
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(vaultMigrationItems.batchId, batchId),
            eq(vaultMigrationItems.status, 'awaiting_upload')
          )
        );

      const [updated] = await db
        .update(vaultMigrationBatches)
        .set({
          status: 'cancelado',
          updatedAt: new Date(),
        })
        .where(eq(vaultMigrationBatches.id, batchId))
        .returning();

      deps.broadcast('migration:progress', { batchId, status: 'cancelado' });
      res.json({ ok: true, batch: { ...updated, agentSessionTokenHash: undefined } });
    } catch (error) {
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao cancelar lote.') });
    }
  });

  // Lookup targets for resolving unmatched folders in the UI
  app.get('/api/migration/lookup-targets', requireAuth, requireAdmin, async (_req: AuthRequest, res) => {
    try {
      const [unitRows, admRows, clientRows] = await Promise.all([
        db.select().from(units),
        db.select().from(admissions),
        db.select().from(clients),
      ]);
      const clientById = new Map(clientRows.map((c) => [c.id, c]));
      const unitById = new Map(unitRows.map((u) => [u.id, u]));
      res.json({
        units: unitRows.map((u) => ({
          id: u.id,
          code: u.code,
          name: u.name,
          city: u.city,
          state: u.state,
          active: u.active,
        })),
        admissions: admRows.map((a) => ({
          id: a.id,
          unitId: a.unitId,
          unitCode: unitById.get(a.unitId)?.code || `U${a.unitId}`,
          clientId: a.clientId,
          clientName: clientById.get(a.clientId)?.fullName || `Cliente #${a.clientId}`,
          contractNumber: a.contractNumber,
          protocolCode: a.protocolCode,
          integrativeCode: a.integrativeCode || '',
        })),
      });
    } catch (error) {
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao carregar alvos para vínculo.') });
    }
  });

  // Manual resolution of unmatched folder/item -> links unit or admission across matching items
  app.post('/api/migration/batches/:id/resolve-unmatched', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const batchId = parsePositiveIntId(req.params.id);
      if (!batchId) return res.status(400).json({ error: 'ID do lote inválido.' });
      const { itemId, unitId, admissionId, applyToFolder = true } = (req.body || {}) as {
        itemId: number;
        unitId?: number;
        admissionId?: number;
        applyToFolder?: boolean;
      };
      const parsedItemId = parsePositiveIntId(itemId);
      if (!parsedItemId) return res.status(400).json({ error: 'ID do item inválido.' });

      let parsedUnitId: number | null = null;
      if (unitId !== undefined && unitId !== null) {
        parsedUnitId = parsePositiveIntId(unitId);
        if (!parsedUnitId) return res.status(400).json({ error: 'ID da unidade inválido.' });
      }
      let parsedAdmissionId: number | null = null;
      if (admissionId !== undefined && admissionId !== null) {
        parsedAdmissionId = parsePositiveIntId(admissionId);
        if (!parsedAdmissionId) return res.status(400).json({ error: 'ID da admissão inválido.' });
      }

      const [item] = await db
        .select()
        .from(vaultMigrationItems)
        .where(and(eq(vaultMigrationItems.id, parsedItemId), eq(vaultMigrationItems.batchId, batchId)))
        .limit(1);
      if (!item) return res.status(404).json({ error: 'Item não encontrado.' });

      let resolvedAdmission: typeof admissions.$inferSelect | undefined;
      if (parsedAdmissionId) {
        const [adm] = await db.select().from(admissions).where(eq(admissions.id, parsedAdmissionId)).limit(1);
        if (!adm) return res.status(404).json({ error: 'Admissão informada não encontrada.' });
        resolvedAdmission = adm;
      }

      const targetUnitId = resolvedAdmission?.unitId || parsedUnitId || item.unitId;
      const targetClientId = resolvedAdmission?.clientId || item.clientId;
      const targetAdmissionId = resolvedAdmission?.id || item.admissionId;

      const resolvedCount = await db.transaction(async (tx) => {
        const batchUnmatched = await tx
          .select()
          .from(vaultMigrationItems)
          .where(and(eq(vaultMigrationItems.batchId, batchId), eq(vaultMigrationItems.status, 'unmatched')));

        const matchingIds = applyToFolder
          ? batchUnmatched
              .filter((row) => {
                if (item.action === 'unmatched_unit' && item.unitFolderName) {
                  return row.unitFolderName === item.unitFolderName;
                }
                if (item.contractFolderName) {
                  return row.unitFolderName === item.unitFolderName && row.contractFolderName === item.contractFolderName;
                }
                return row.id === item.id;
              })
              .map((r) => r.id)
          : [item.id];

        const idsToUpdate = matchingIds.length > 0 ? matchingIds : [item.id];

        await tx
          .update(vaultMigrationItems)
          .set({
            unitId: targetUnitId ?? null,
            clientId: targetClientId ?? null,
            admissionId: targetAdmissionId ?? null,
            status: targetAdmissionId ? 'pending' : 'unmatched',
            action: targetAdmissionId ? 'create' : 'unmatched_contract',
            errorMessage: targetAdmissionId ? 'Vínculo resolvido manualmente — pronto para re-sync' : 'Unidade associada, aguardando contrato',
            updatedAt: new Date(),
          })
          .where(inArray(vaultMigrationItems.id, idsToUpdate));

        if (targetAdmissionId) {
          const remainingUnmatched = await tx
            .select({ id: vaultMigrationItems.id })
            .from(vaultMigrationItems)
            .where(and(eq(vaultMigrationItems.batchId, batchId), eq(vaultMigrationItems.status, 'unmatched')));
          await tx
            .update(vaultMigrationBatches)
            .set({ unmatchedCount: remainingUnmatched.length, updatedAt: new Date() })
            .where(eq(vaultMigrationBatches.id, batchId));
        }

        return idsToUpdate.length;
      });

      deps.broadcast('migration:progress', { batchId });
      res.json({ ok: true, resolvedCount });
    } catch (error) {
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao resolver pendência de vínculo.') });
    }
  });

  // Assign/Standardize Integrative HMAC Codes across matched admissions & documents
  app.post('/api/vault/integrative-codes/assign', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { unitId, overwrite, batchId } = (req.body || {}) as {
        unitId?: number | null;
        overwrite?: boolean;
        batchId?: number | null;
      };
      let parsedUnitId: number | null = null;
      if (unitId !== undefined && unitId !== null) {
        parsedUnitId = parsePositiveIntId(unitId);
        if (!parsedUnitId) return res.status(400).json({ error: 'ID da unidade inválido.' });
      }
      let parsedBatchId: number | null = null;
      if (batchId !== undefined && batchId !== null) {
        parsedBatchId = parsePositiveIntId(batchId);
        if (!parsedBatchId) return res.status(400).json({ error: 'ID do lote inválido.' });
      }
      const result = await assignIntegrativeCodesBatch({
        unitId: parsedUnitId,
        overwrite: Boolean(overwrite),
        actorUserId: req.authUser!.id,
        actorName: req.authUser!.name,
      });

      if (parsedBatchId) {
        await db
          .update(vaultMigrationBatches)
          .set({ integrativeSealedAt: new Date(), updatedAt: new Date() })
          .where(eq(vaultMigrationBatches.id, parsedBatchId));
      }

      deps.broadcast('vault:integrative_sealed', result);
      res.json({ ok: true, ...result });
    } catch (error) {
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao gerar códigos seguros integrativos.') });
    }
  });

  // Cryptographic HMAC Resolver for Integrative Vault Codes (Dossier OR Document)
  app.get('/api/vault/i/:integrativeCode', requireAuth, async (req: AuthRequest, res) => {
    try {
      const code = String(req.params.integrativeCode || '').trim().toUpperCase();
      const parsed = parseIntegrativeCode(code);
      if (!parsed) {
        return res.status(400).json({ error: 'Formato de Código Seguro Integrativo inválido.' });
      }

      const isAdmin = req.authUser!.role === 'admin';
      const allowedUnits = req.authUser!.allowedUnitIds || [];

      if (parsed.entityType === 'DOSS') {
        const [adm] = await db.select().from(admissions).where(eq(admissions.id, parsed.entityId)).limit(1);
        if (!adm) return res.status(404).json({ error: 'Dossiê não encontrado.' });
        if (!isAdmin && !allowedUnits.includes(adm.unitId)) {
          return res.status(403).json({ error: 'ACL negada para esta unidade.' });
        }
        const [unitRow] = await db.select().from(units).where(eq(units.id, adm.unitId)).limit(1);
        const unitCode = unitRow?.code || `U${adm.unitId}`;
        const valid = verifyIntegrativeCodeAgainstRecord({
          code,
          unitCode,
          entityType: 'DOSS',
          entityId: adm.id,
          referenceSeed: adm.contractNumber || adm.protocolCode,
        });
        if (!valid) return res.status(403).json({ error: 'Assinatura HMAC do Código Integrativo inválida.' });

        const docs = await db
          .select()
          .from(documentObjects)
          .where(and(eq(documentObjects.admissionId, adm.id), isNull(documentObjects.deletedAt)));
        return res.json({
          type: 'DOSS',
          integrativeCode: code,
          admission: {
            id: adm.id,
            protocolCode: adm.protocolCode,
            contractNumber: adm.contractNumber,
            unitCode,
            status: adm.status,
          },
          documentsCount: docs.length,
          documents: docs.map((d) => ({
            id: d.id,
            fileName: d.fileName,
            relativeSubpath: d.relativeSubpath,
            folderPath: d.folderPath,
            integrativeCode: d.integrativeCode,
            versionNumber: d.versionNumber,
            sizeBytes: d.sizeBytes,
          })),
        });
      }

      // DOC or UNID resolver with granular RBAC enforcement
      const [doc] = await db.select().from(documentObjects).where(eq(documentObjects.id, parsed.entityId)).limit(1);
      if (!doc || doc.deletedAt) return res.status(404).json({ error: 'Documento não encontrado.' });
      if (!isAdmin && !allowedUnits.includes(doc.unitId)) {
        return res.status(403).json({ error: 'ACL negada para esta unidade.' });
      }
      const [unitRow] = await db.select().from(units).where(eq(units.id, doc.unitId)).limit(1);
      const unitCode = unitRow?.code || `U${doc.unitId}`;
      const expectedEntityType = doc.scope === 'unit' || !doc.clientId ? 'UNID' : 'DOC';
      if (parsed.entityType !== expectedEntityType) {
        return res.status(403).json({ error: 'Tipo do Código Integrativo incompatível com o escopo do documento.' });
      }
      const valid = verifyIntegrativeCodeAgainstRecord({
        code,
        unitCode,
        entityType: parsed.entityType,
        entityId: doc.id,
        referenceSeed: doc.sha256Hash || doc.fileName,
      });
      if (!valid) return res.status(403).json({ error: 'Assinatura HMAC do Código Integrativo inválida.' });

      const folderRules = await loadFolderRulesForUser(doc.unitId);
      const effPerms = evaluateDocumentAccess({
        authUser: req.authUser!,
        doc,
        folderRules,
        context: 'direct',
      });
      if (!effPerms.view) {
        return res.status(403).json({ error: 'Permissão de visualização negada para este arquivo.' });
      }

      if (req.query.meta === '1') {
        return res.json({
          type: parsed.entityType,
          integrativeCode: code,
          permissions: effPerms,
          document: {
            id: doc.id,
            scope: doc.scope,
            unitId: doc.unitId,
            unitFolderPath: doc.unitFolderPath,
            isInterlinked: doc.isInterlinked,
            clientId: doc.clientId,
            admissionId: doc.admissionId,
            fileName: doc.fileName,
            relativeSubpath: doc.relativeSubpath,
            folderPath: doc.folderPath,
            mimeType: doc.mimeType,
            sizeBytes: doc.sizeBytes,
            versionNumber: doc.versionNumber,
            sha256Hash: doc.sha256Hash,
          },
        });
      }

      const isPreview = req.query.preview === '1';
      if (!isPreview && !effPerms.download) {
        return res.status(403).json({ error: 'Permissão de download negada para este usuário ou grupo.' });
      }

      const buf = await getBucketObjectBuffer(doc.sha256Hash, doc.storageUri);
      if (!buf) return res.status(404).json({ error: 'Conteúdo binário não localizado no bucket.' });

      const safeName = sanitizeFileName(doc.fileName);
      const disposition = isPreview && canPreviewInline(doc.mimeType) ? 'inline' : 'attachment';
      res.setHeader('Content-Type', doc.mimeType || 'application/octet-stream');
      res.setHeader('Content-Length', String(buf.length));
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Integrative-Code', code);
      res.setHeader('Content-Disposition', `${disposition}; filename="${safeName}"`);
      return res.send(buf);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Erro ao resolver código integrativo.' });
    }
  });

  // Full purge of ALL bucket folders/objects (Cloudflare R2 + local bucket + document index + migration history)
  app.post('/api/migration/purge-bucket', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { confirmPhrase } = (req.body || {}) as { confirmPhrase?: string };
      if (String(confirmPhrase || '').trim().toUpperCase() !== 'APAGAR BUCKET R2') {
        return res.status(400).json({
          error: 'Frase de confirmação inválida. Digite exatamente "APAGAR BUCKET R2" para confirmar.',
        });
      }

      const storageResult = await purgeAllBucketObjects();
      if (storageResult.r2Configured && !storageResult.r2Purged) {
        return res.status(502).json({
          error:
            storageResult.r2Error ||
            `Não foi possível concluir a limpeza no Cloudflare R2 (${storageResult.bucketName}). Nenhuma referência do banco foi apagada.`,
        });
      }

      const dbCounts = await db.transaction(async (tx) => {
        await tx
          .update(financialTitles)
          .set({ receiptDocId: null })
          .where(isNotNull(financialTitles.receiptDocId));

        const delItems = await tx.delete(vaultMigrationItems);
        const delBatches = await tx.delete(vaultMigrationBatches);
        const delDocs = await tx.delete(documentObjects);

        const counts = {
          dbItemsDeleted: Number(delItems?.rowCount ?? 0),
          dbBatchesDeleted: Number(delBatches?.rowCount ?? 0),
          dbDocumentsDeleted: Number(delDocs?.rowCount ?? 0),
        };

        await tx.insert(auditLogs).values({
          userId: req.authUser!.id,
          userName: req.authUser!.name,
          action: 'R2_BUCKET_FULL_PURGE',
          entityType: 'vault_migration_batch',
          entityId: storageResult.bucketName,
          details: {
            ...storageResult,
            ...counts,
          },
          unitId: req.activeUnitId ?? null,
        });

        return counts;
      });

      deps.broadcast('migration:progress', { purged: true, bucketName: storageResult.bucketName });
      deps.broadcast('vault:purged', { bucketName: storageResult.bucketName });

      return res.json({
        ok: true,
        ...storageResult,
        ...dbCounts,
      });
    } catch (error) {
      return res
        .status(500)
        .json({ error: sanitizeErrorMessage(error, 'Erro ao apagar pastas e arquivos do bucket R2.') });
    }
  });
}
