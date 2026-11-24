import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express, { type Express } from 'express';
import multer from 'multer';
import { AuthRequest, requireAdmin, requireAuth } from '../middleware/auth.ts';
import {
  DATA_HUB_ENTITIES,
  DATA_HUB_PACKAGES,
  TIER_LABELS,
} from '../services/dataHubRegistry.ts';
import {
  exportExcelWorkbook,
  finalizeExcelImportWork,
  prepareExcelImportWork,
  processExcelImport,
  processExcelImportBatch,
} from '../services/dataHubExcelService.ts';
import {
  analyzeSpreadsheetWithFolhaRosto,
  commitSpreadsheetWithFolhaRosto,
  finalizeIviCommitWork,
  finalizeIviSpreadsheetAnalyze,
  getFolhaRostoReferenceForms,
  prepareIviCommitWork,
  prepareIviSpreadsheetWork,
  processIviCommitBatch,
  processIviSpreadsheetAnalyzeBatch,
} from '../services/iviFolhaRostoImportService.ts';
import {
  finalizeFolhaRostoPdfBatches,
  inspectFolhaRostoPdfInfo,
  PDF_PAGE_BATCH_SIZE,
  processFolhaRostoPdfBatch,
} from '../services/iviFolhaRostoPdfParser.ts';
import { db } from '../db/index.ts';
import { units } from '../db/schema.ts';
import { parsePositiveIntId, sanitizeErrorMessage } from '../utils/validation.ts';

export const MAX_EXCEL_UPLOAD_BYTES = 500 * 1024 * 1024; // 500 MB

const UPLOAD_TMP_DIR = path.join(os.tmpdir(), 'invicta-excel-hub');
const SESSION_TMP_DIR = path.join(UPLOAD_TMP_DIR, 'sessions');

function ensureUploadDirs() {
  fs.mkdirSync(UPLOAD_TMP_DIR, { recursive: true });
  fs.mkdirSync(SESSION_TMP_DIR, { recursive: true });
}
ensureUploadDirs();

interface UploadSessionEntry {
  id: string;
  filePath: string;
  fileName: string;
  expectedSizeBytes: number;
  receivedBytes: number;
  userId: number;
  createdAt: number;
}

const uploadSessions = new Map<string, UploadSessionEntry>();

function cleanupExpiredSessions() {
  const cutoff = Date.now() - 3 * 60 * 60 * 1000; // 3h
  for (const [id, entry] of uploadSessions.entries()) {
    if (entry.createdAt < cutoff) {
      uploadSessions.delete(id);
      removeFileSafe(entry.filePath);
    }
  }
}

function removeFileSafe(filePath?: string | null) {
  if (!filePath) return;
  fs.promises.unlink(filePath).catch(() => {});
  fs.promises.unlink(`${filePath}.parsed.json`).catch(() => {});
  fs.promises.rm(`${filePath}.batches`, { recursive: true, force: true }).catch(() => {});
  fs.promises.rm(`${filePath}.excel-work`, { recursive: true, force: true }).catch(() => {});
  fs.promises.rm(`${filePath}.ivi-work`, { recursive: true, force: true }).catch(() => {});
}

function registerSessionForDirectFile(req: AuthRequest): {
  filePath: string;
  fileName: string;
  fileSizeBytes: number;
  uploadSessionId: string;
} | null {
  if (!req.file?.path) return null;
  const id = crypto.randomUUID();
  const entry: UploadSessionEntry = {
    id,
    filePath: req.file.path,
    fileName: req.file.originalname || path.basename(req.file.path),
    expectedSizeBytes: req.file.size,
    receivedBytes: req.file.size,
    userId: req.authUser!.id,
    createdAt: Date.now(),
  };
  uploadSessions.set(id, entry);
  return {
    filePath: entry.filePath,
    fileName: entry.fileName,
    fileSizeBytes: entry.expectedSizeBytes,
    uploadSessionId: id,
  };
}

function parseNonNegInt(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) return null;
  return n;
}

const ALLOWED_DATA_HUB_EXTS = ['.pdf', '.xlsx', '.xls', '.xlsm', '.xlsb', '.csv'];

const excelUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      ensureUploadDirs();
      cb(null, UPLOAD_TMP_DIR);
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase() || '.xlsx';
      const safeExt = ALLOWED_DATA_HUB_EXTS.includes(ext) ? ext : '.xlsx';
      cb(null, `upload-${Date.now()}-${crypto.randomUUID()}${safeExt}`);
    },
  }),
  limits: { fileSize: MAX_EXCEL_UPLOAD_BYTES },
});

function parseMappingsOverride(raw: unknown): Record<string, string> | undefined {
  if (!raw) return undefined;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : undefined;
    } catch {
      return undefined;
    }
  }
  if (typeof raw === 'object') {
    return raw as Record<string, string>;
  }
  return undefined;
}

function resolveIncomingSpreadsheet(req: AuthRequest): {
  filePath: string;
  fileName: string;
  fileSizeBytes: number;
  uploadSessionId?: string;
  isDirectUpload: boolean;
} | null {
  if (req.file?.path) {
    return {
      filePath: req.file.path,
      fileName: req.file.originalname || path.basename(req.file.path),
      fileSizeBytes: req.file.size,
      isDirectUpload: true,
    };
  }
  const sessionId = String(req.body?.uploadSessionId || '').trim();
  if (sessionId) {
    const sess = uploadSessions.get(sessionId);
    if (!sess || sess.userId !== req.authUser!.id || !fs.existsSync(sess.filePath)) {
      return null;
    }
    const stat = fs.statSync(sess.filePath);
    return {
      filePath: sess.filePath,
      fileName: sess.fileName,
      fileSizeBytes: stat.size,
      uploadSessionId: sessionId,
      isDirectUpload: false,
    };
  }
  return null;
}

export function registerDataHubRoutes(
  app: Express,
  deps: { broadcast: (event: string, payload: unknown) => void }
) {
  app.get('/api/data-hub/layouts', requireAuth, requireAdmin, async (_req: AuthRequest, res) => {
    try {
      const unitRows = await db.select().from(units);
      res.json({
        tiers: TIER_LABELS,
        entities: DATA_HUB_ENTITIES,
        packages: DATA_HUB_PACKAGES,
        units: unitRows.map((u) => ({ id: u.id, code: u.code, name: u.name, active: u.active })),
        maxUploadBytes: MAX_EXCEL_UPLOAD_BYTES,
      });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Erro ao listar layouts Excel.' });
    }
  });

  // =========================================================================
  // CHUNKED UPLOAD SESSIONS (ATÉ 500 MB · CONTORNA LIMITES DE PROXY HTTP)
  // =========================================================================
  app.post('/api/data-hub/upload-session/init', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      cleanupExpiredSessions();
      ensureUploadDirs();
      const fileName = String(req.body?.fileName || 'planilha.xlsx').trim();
      const fileSizeBytes = Number(req.body?.fileSizeBytes || 0);
      if (!Number.isFinite(fileSizeBytes) || fileSizeBytes <= 0) {
        return res.status(400).json({ error: 'Tamanho do arquivo inválido.' });
      }
      if (fileSizeBytes > MAX_EXCEL_UPLOAD_BYTES) {
        return res.status(413).json({
          error: 'O arquivo excede o limite máximo suportado de 500 MB.',
        });
      }
      const ext = path.extname(fileName).toLowerCase() || '.pdf';
      if (!ALLOWED_DATA_HUB_EXTS.includes(ext)) {
        return res.status(400).json({
          error: 'Formato não suportado. Envie PDF (.pdf) de Folhas de Rosto ou planilhas (.xlsx, .xls, .xlsm, .xlsb, .csv) até 500 MB.',
        });
      }
      const id = crypto.randomUUID();
      const filePath = path.join(SESSION_TMP_DIR, `${id}${ext}`);
      await fs.promises.writeFile(filePath, Buffer.alloc(0));
      uploadSessions.set(id, {
        id,
        filePath,
        fileName,
        expectedSizeBytes: fileSizeBytes,
        receivedBytes: 0,
        userId: req.authUser!.id,
        createdAt: Date.now(),
      });
      return res.json({
        uploadId: id,
        maxUploadBytes: MAX_EXCEL_UPLOAD_BYTES,
      });
    } catch (error) {
      return res.status(400).json({ error: sanitizeErrorMessage(error, 'Erro ao iniciar sessão de upload.') });
    }
  });

  app.post(
    '/api/data-hub/upload-session/:uploadId/chunk',
    requireAuth,
    requireAdmin,
    express.raw({ type: 'application/octet-stream', limit: '16mb' }),
    async (req: AuthRequest, res) => {
      try {
        const uploadId = String(req.params.uploadId || '').trim();
        const sess = uploadSessions.get(uploadId);
        if (!sess || sess.userId !== req.authUser!.id) {
          return res.status(404).json({ error: 'Sessão de upload não encontrada ou expirada.' });
        }
        const chunkBuf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
        if (chunkBuf.length === 0) {
          return res.status(400).json({ error: 'Parte do arquivo vazia.' });
        }
        if (sess.receivedBytes + chunkBuf.length > MAX_EXCEL_UPLOAD_BYTES) {
          uploadSessions.delete(uploadId);
          removeFileSafe(sess.filePath);
          return res.status(413).json({
            error: 'Arquivo excede o limite máximo suportado de 500 MB.',
          });
        }
        await fs.promises.appendFile(sess.filePath, chunkBuf);
        sess.receivedBytes += chunkBuf.length;
        return res.json({
          uploadId,
          receivedBytes: sess.receivedBytes,
          expectedSizeBytes: sess.expectedSizeBytes,
        });
      } catch (error) {
        return res.status(400).json({ error: sanitizeErrorMessage(error, 'Erro ao gravar parte do arquivo.') });
      }
    }
  );

  app.delete('/api/data-hub/upload-session/:uploadId', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    const uploadId = String(req.params.uploadId || '').trim();
    const sess = uploadSessions.get(uploadId);
    if (sess && sess.userId === req.authUser!.id) {
      uploadSessions.delete(uploadId);
      removeFileSafe(sess.filePath);
    }
    res.json({ ok: true });
  });

  // =========================================================================
  // EXPORT & IMPORTAÇÃO PADRÃO POR PRECEDÊNCIA (ATÉ 500 MB)
  // =========================================================================
  app.get('/api/data-hub/export-xlsx', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const scopeType = String(req.query.scopeType || 'entity') === 'package' ? 'package' : 'entity';
      const key = String(req.query.key || 'clients');
      const mode = String(req.query.mode || 'data') === 'template' ? 'template' : 'data';
      const rawUnitId = String(req.query.unitId || '').trim();
      let unitId: number | null = null;
      if (rawUnitId && rawUnitId !== 'all') {
        unitId = parsePositiveIntId(rawUnitId);
        if (!unitId) return res.status(400).json({ error: 'Parâmetro unitId inválido.' });
      }

      const out = await exportExcelWorkbook({
        scopeType,
        key,
        mode,
        unitId,
        actorUserId: req.authUser!.id,
        actorName: req.authUser!.name,
      });

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${out.fileName}"`);
      res.setHeader('X-DataHub-Rows', String(out.totalRows));
      res.setHeader('X-DataHub-Sheets', String(out.sheetsCount));
      res.send(out.buffer);
    } catch (error) {
      res.status(400).json({ error: sanitizeErrorMessage(error, 'Erro ao gerar planilha Excel.') });
    }
  });

  app.post(
    '/api/data-hub/import-xlsx/prepare',
    requireAuth,
    requireAdmin,
    excelUpload.single('file'),
    async (req: AuthRequest, res) => {
      req.setTimeout(0);
      res.setTimeout(0);
      try {
        let source = resolveIncomingSpreadsheet(req);
        if (source?.isDirectUpload) {
          const reg = registerSessionForDirectFile(req);
          if (reg) {
            source = { ...reg, isDirectUpload: false };
          }
        }
        if (!source) {
          return res.status(400).json({ error: 'Arquivo ou sessão de upload expirada.' });
        }
        const expectedLayoutKey = String(req.body?.expectedLayoutKey || '').trim() || undefined;
        const prep = await prepareExcelImportWork({
          filePath: source.filePath,
          originalFileName: source.fileName,
          expectedLayoutKey,
        });
        return res.json({
          ...prep,
          uploadSessionId: source.uploadSessionId,
          fileName: source.fileName,
          fileSizeBytes: source.fileSizeBytes,
        });
      } catch (error) {
        return res.status(400).json({ error: sanitizeErrorMessage(error, 'Falha ao preparar leitura em lotes da planilha.') });
      }
    }
  );

  app.post(
    '/api/data-hub/import-xlsx/process-batch',
    requireAuth,
    requireAdmin,
    async (req: AuthRequest, res) => {
      req.setTimeout(0);
      res.setTimeout(0);
      try {
        const source = resolveIncomingSpreadsheet(req);
        if (!source) {
          return res.status(400).json({ error: 'Sessão de upload não encontrada ou expirada.' });
        }
        const mode: 'dry_run' | 'commit' =
          String(req.body?.mode || 'dry_run') === 'commit' ? 'commit' : 'dry_run';
        const startChunk = parseNonNegInt(req.body?.startChunk);
        if (startChunk === null) {
          return res.status(400).json({ error: 'Parâmetro startChunk inválido.' });
        }
        const batchCountRaw = parsePositiveIntId(req.body?.batchCount) ?? 1;
        const batchCount = Math.min(4, Math.max(1, batchCountRaw));

        let unitFallbackId: number | null = req.activeUnitId || null;
        if (req.body?.unitFallbackId !== undefined && String(req.body.unitFallbackId).trim() !== '') {
          unitFallbackId = parsePositiveIntId(req.body.unitFallbackId);
          if (!unitFallbackId) return res.status(400).json({ error: 'unitFallbackId inválido.' });
        }

        const result = await processExcelImportBatch({
          filePath: source.filePath,
          mode,
          startChunk,
          batchCount,
          unitFallbackId,
          assignIntegrative: req.body?.assignIntegrative !== 'false' && req.body?.assignIntegrative !== false,
          actorName: req.authUser!.name,
        });
        return res.json(result);
      } catch (error) {
        return res.status(400).json({ error: sanitizeErrorMessage(error, 'Falha ao processar lote da planilha.') });
      }
    }
  );

  app.post(
    '/api/data-hub/import-xlsx/finalize',
    requireAuth,
    requireAdmin,
    async (req: AuthRequest, res) => {
      req.setTimeout(0);
      res.setTimeout(0);
      const source = resolveIncomingSpreadsheet(req);
      const mode: 'dry_run' | 'commit' =
        String(req.body?.mode || 'dry_run') === 'commit' ? 'commit' : 'dry_run';
      try {
        if (!source) {
          return res.status(400).json({ error: 'Sessão de upload não encontrada ou expirada.' });
        }
        let unitFallbackId: number | null = req.activeUnitId || null;
        if (req.body?.unitFallbackId !== undefined && String(req.body.unitFallbackId).trim() !== '') {
          unitFallbackId = parsePositiveIntId(req.body.unitFallbackId);
          if (!unitFallbackId) return res.status(400).json({ error: 'unitFallbackId inválido.' });
        }

        const result = await finalizeExcelImportWork({
          filePath: source.filePath,
          mode,
          unitFallbackId,
          actorUserId: req.authUser!.id,
          actorName: req.authUser!.name,
        });

        if (mode === 'commit') {
          deps.broadcast('data_hub:imported', {
            inserts: result.totals.inserts,
            updates: result.totals.updates,
            actor: req.authUser!.name,
          });
        }

        return res.json(result);
      } catch (error) {
        return res.status(400).json({ error: sanitizeErrorMessage(error, 'Falha ao finalizar importação da planilha.') });
      } finally {
        if (mode === 'commit' && source?.uploadSessionId) {
          uploadSessions.delete(source.uploadSessionId);
          removeFileSafe(source.filePath);
        }
      }
    }
  );

  app.post(
    '/api/data-hub/import-xlsx/dry-run',
    requireAuth,
    requireAdmin,
    excelUpload.single('file'),
    async (req: AuthRequest, res) => {
      req.setTimeout(0);
      res.setTimeout(0);
      const source = resolveIncomingSpreadsheet(req);
      try {
        if (!source) {
          return res.status(400).json({ error: 'Arquivo de planilha (.xlsx/.xls/.csv até 500 MB) obrigatório.' });
        }
        const expectedLayoutKey = String(req.body?.expectedLayoutKey || '').trim() || undefined;
        let unitFallbackId: number | null = req.activeUnitId || null;
        if (req.body?.unitFallbackId !== undefined && String(req.body.unitFallbackId).trim() !== '') {
          unitFallbackId = parsePositiveIntId(req.body.unitFallbackId);
          if (!unitFallbackId) return res.status(400).json({ error: 'unitFallbackId inválido.' });
        }

        const result = await processExcelImport({
          filePath: source.filePath,
          expectedLayoutKey,
          mode: 'dry_run',
          unitFallbackId,
          assignIntegrative: req.body?.assignIntegrative !== 'false' && req.body?.assignIntegrative !== false,
          actorUserId: req.authUser!.id,
          actorName: req.authUser!.name,
        });
        res.json(result);
      } catch (error) {
        res.status(400).json({ error: sanitizeErrorMessage(error, 'Falha na pré-validação da planilha.') });
      } finally {
        if (source?.isDirectUpload) removeFileSafe(source.filePath);
      }
    }
  );

  app.post(
    '/api/data-hub/import-xlsx/commit',
    requireAuth,
    requireAdmin,
    excelUpload.single('file'),
    async (req: AuthRequest, res) => {
      req.setTimeout(0);
      res.setTimeout(0);
      const source = resolveIncomingSpreadsheet(req);
      try {
        if (!source) {
          return res.status(400).json({ error: 'Arquivo de planilha (.xlsx/.xls/.csv até 500 MB) obrigatório.' });
        }
        const expectedLayoutKey = String(req.body?.expectedLayoutKey || '').trim() || undefined;
        let unitFallbackId: number | null = req.activeUnitId || null;
        if (req.body?.unitFallbackId !== undefined && String(req.body.unitFallbackId).trim() !== '') {
          unitFallbackId = parsePositiveIntId(req.body.unitFallbackId);
          if (!unitFallbackId) return res.status(400).json({ error: 'unitFallbackId inválido.' });
        }

        const result = await processExcelImport({
          filePath: source.filePath,
          expectedLayoutKey,
          mode: 'commit',
          unitFallbackId,
          assignIntegrative: req.body?.assignIntegrative !== 'false' && req.body?.assignIntegrative !== false,
          actorUserId: req.authUser!.id,
          actorName: req.authUser!.name,
        });

        deps.broadcast('data_hub:imported', {
          inserts: result.totals.inserts,
          updates: result.totals.updates,
          actor: req.authUser!.name,
        });

        res.json(result);
      } catch (error) {
        res.status(400).json({ error: sanitizeErrorMessage(error, 'Erro ao executar importação Excel.') });
      } finally {
        if (source?.isDirectUpload) {
          removeFileSafe(source.filePath);
        } else if (source?.uploadSessionId) {
          uploadSessions.delete(source.uploadSessionId);
          removeFileSafe(source.filePath);
        }
      }
    }
  );

  // =========================================================================
  // LEITURA INTELIGENTE IVI COMPARANDO FOLHA DE ROSTO - VEÍCULO & CARTÃO (ATÉ 500 MB)
  // =========================================================================
  app.get('/api/data-hub/ivi-folha-rosto/forms', requireAuth, requireAdmin, async (_req: AuthRequest, res) => {
    try {
      const refPayload = await getFolhaRostoReferenceForms();
      res.json(refPayload);
    } catch (error) {
      res.status(500).json({
        error: sanitizeErrorMessage(error, 'Erro ao carregar formulários Folha de Rosto.'),
      });
    }
  });

  app.post(
    '/api/data-hub/ivi-folha-rosto/prepare',
    requireAuth,
    requireAdmin,
    excelUpload.single('file'),
    async (req: AuthRequest, res) => {
      req.setTimeout(0);
      res.setTimeout(0);
      try {
        let source = resolveIncomingSpreadsheet(req);
        if (source?.isDirectUpload) {
          const reg = registerSessionForDirectFile(req);
          if (reg) {
            source = { ...reg, isDirectUpload: false };
          }
        }
        if (!source) {
          return res.status(400).json({
            error: 'Sessão de upload não encontrada ou expirada. Selecione o arquivo novamente.',
          });
        }
        const isPdf = source.fileName.toLowerCase().endsWith('.pdf');
        if (!isPdf) {
          const columnMappingsOverride = parseMappingsOverride(req.body?.columnMappingsOverride);
          const prep = await prepareIviSpreadsheetWork({
            filePath: source.filePath,
            originalFileName: source.fileName,
            fileSizeBytes: source.fileSizeBytes,
            uploadSessionId: source.uploadSessionId,
            columnMappingsOverride,
          });
          return res.json({
            ...prep,
            uploadSessionId: source.uploadSessionId,
          });
        }
        const info = await inspectFolhaRostoPdfInfo(source.filePath);
        return res.json({
          isPdf: true,
          uploadSessionId: source.uploadSessionId,
          pageCount: info.pageCount,
          batchSize: info.batchSize,
          totalBatches: info.totalBatches,
        });
      } catch (error) {
        return res.status(400).json({
          error: sanitizeErrorMessage(error, 'Falha ao inspecionar estrutura do arquivo enviado.'),
        });
      }
    }
  );

  app.post(
    '/api/data-hub/ivi-folha-rosto/analyze-batch',
    requireAuth,
    requireAdmin,
    async (req: AuthRequest, res) => {
      req.setTimeout(0);
      res.setTimeout(0);
      try {
        const source = resolveIncomingSpreadsheet(req);
        if (!source) {
          return res.status(400).json({
            error: 'Sessão de upload não encontrada ou expirada. Envie o arquivo novamente.',
          });
        }

        const isPdf = source.fileName.toLowerCase().endsWith('.pdf');
        if (isPdf) {
          const startPage = parsePositiveIntId(req.body?.startPage);
          const endPageRaw = parsePositiveIntId(req.body?.endPage);
          if (!startPage) {
            return res.status(400).json({ error: 'Parâmetro startPage inválido.' });
          }
          const boundedEnd = Math.min(
            endPageRaw && endPageRaw >= startPage ? endPageRaw : startPage + PDF_PAGE_BATCH_SIZE - 1,
            startPage + PDF_PAGE_BATCH_SIZE - 1
          );

          const batchResult = await processFolhaRostoPdfBatch({
            filePath: source.filePath,
            startPage,
            endPage: boundedEnd,
          });
          return res.json(batchResult);
        }

        const startChunk = parseNonNegInt(req.body?.startChunk);
        if (startChunk === null) {
          return res.status(400).json({ error: 'Parâmetro startChunk inválido.' });
        }
        const batchCountRaw = parsePositiveIntId(req.body?.batchCount) ?? 2;
        const batchCount = Math.min(4, Math.max(1, batchCountRaw));
        const rawForce = String(req.body?.forceForm || 'auto');
        const forceForm: 'auto' | 'veiculo' | 'cartao' =
          rawForce === 'veiculo' || rawForce === 'cartao' ? rawForce : 'auto';
        const columnMappingsOverride = parseMappingsOverride(req.body?.columnMappingsOverride);

        const batchRes = await processIviSpreadsheetAnalyzeBatch({
          filePath: source.filePath,
          startChunk,
          batchCount,
          reset: req.body?.reset === true || req.body?.reset === 'true',
          forceForm,
          columnMappingsOverride,
        });
        return res.json(batchRes);
      } catch (error) {
        return res.status(400).json({
          error: sanitizeErrorMessage(error, 'Erro ao processar lote de análise da Ivi.'),
        });
      }
    }
  );

  app.post(
    '/api/data-hub/ivi-folha-rosto/analyze-finalize',
    requireAuth,
    requireAdmin,
    async (req: AuthRequest, res) => {
      req.setTimeout(0);
      res.setTimeout(0);
      try {
        const source = resolveIncomingSpreadsheet(req);
        if (!source) {
          return res.status(400).json({
            error: 'Sessão de upload não encontrada ou expirada. Envie o arquivo novamente.',
          });
        }
        let unitFallbackId: number | null = req.activeUnitId || null;
        if (req.body?.unitFallbackId !== undefined && String(req.body.unitFallbackId).trim() !== '') {
          unitFallbackId = parsePositiveIntId(req.body.unitFallbackId);
          if (!unitFallbackId) return res.status(400).json({ error: 'unitFallbackId inválido.' });
        }
        const rawForce = String(req.body?.forceForm || 'auto');
        const forceForm: 'auto' | 'veiculo' | 'cartao' =
          rawForce === 'veiculo' || rawForce === 'cartao' ? rawForce : 'auto';
        const columnMappingsOverride = parseMappingsOverride(req.body?.columnMappingsOverride);
        const pageCountHint = parsePositiveIntId(req.body?.pageCount) || undefined;

        if (source.fileName.toLowerCase().endsWith('.pdf')) {
          await finalizeFolhaRostoPdfBatches(source.filePath, pageCountHint);
          const result = await analyzeSpreadsheetWithFolhaRosto({
            filePath: source.filePath,
            originalFileName: source.fileName,
            fileSizeBytes: source.fileSizeBytes,
            uploadSessionId: source.uploadSessionId,
            unitFallbackId,
            forceForm,
            columnMappingsOverride,
          });
          return res.json(result);
        }

        const result = await finalizeIviSpreadsheetAnalyze({
          filePath: source.filePath,
          columnMappingsOverride,
        });
        return res.json(result);
      } catch (error) {
        return res.status(400).json({
          error: sanitizeErrorMessage(error, 'Falha ao consolidar análise comparativa com Folha de Rosto.'),
        });
      }
    }
  );

  app.post(
    '/api/data-hub/ivi-folha-rosto/commit-prepare',
    requireAuth,
    requireAdmin,
    async (req: AuthRequest, res) => {
      req.setTimeout(0);
      res.setTimeout(0);
      try {
        const source = resolveIncomingSpreadsheet(req);
        if (!source) {
          return res.status(400).json({
            error: 'Sessão de upload não encontrada ou expirada. Envie o arquivo novamente.',
          });
        }
        let unitFallbackId: number | null = req.activeUnitId || null;
        if (req.body?.unitFallbackId !== undefined && String(req.body.unitFallbackId).trim() !== '') {
          unitFallbackId = parsePositiveIntId(req.body.unitFallbackId);
          if (!unitFallbackId) return res.status(400).json({ error: 'unitFallbackId inválido.' });
        }
        const columnMappingsOverride = parseMappingsOverride(req.body?.columnMappingsOverride);

        const prep = await prepareIviCommitWork({
          filePath: source.filePath,
          originalFileName: source.fileName,
          fileSizeBytes: source.fileSizeBytes,
          uploadSessionId: source.uploadSessionId,
          unitFallbackId,
          columnMappingsOverride,
        });
        return res.json(prep);
      } catch (error) {
        return res.status(400).json({
          error: sanitizeErrorMessage(error, 'Falha ao preparar gravação em lotes no banco de dados.'),
        });
      }
    }
  );

  app.post(
    '/api/data-hub/ivi-folha-rosto/commit-batch',
    requireAuth,
    requireAdmin,
    async (req: AuthRequest, res) => {
      req.setTimeout(0);
      res.setTimeout(0);
      try {
        const source = resolveIncomingSpreadsheet(req);
        if (!source) {
          return res.status(400).json({
            error: 'Sessão de upload não encontrada ou expirada. Envie o arquivo novamente.',
          });
        }
        const startChunk = parseNonNegInt(req.body?.startChunk);
        if (startChunk === null) {
          return res.status(400).json({ error: 'Parâmetro startChunk inválido.' });
        }
        const batchCountRaw = parsePositiveIntId(req.body?.batchCount) ?? 1;
        const batchCount = Math.min(2, Math.max(1, batchCountRaw));

        let unitFallbackId: number | null = req.activeUnitId || null;
        if (req.body?.unitFallbackId !== undefined && String(req.body.unitFallbackId).trim() !== '') {
          unitFallbackId = parsePositiveIntId(req.body.unitFallbackId);
          if (!unitFallbackId) return res.status(400).json({ error: 'unitFallbackId inválido.' });
        }
        const rawForce = String(req.body?.forceForm || 'auto');
        const forceForm: 'auto' | 'veiculo' | 'cartao' =
          rawForce === 'veiculo' || rawForce === 'cartao' ? rawForce : 'auto';
        const columnMappingsOverride = parseMappingsOverride(req.body?.columnMappingsOverride);

        const batchRes = await processIviCommitBatch({
          filePath: source.filePath,
          startChunk,
          batchCount,
          unitFallbackId,
          forceForm,
          columnMappingsOverride,
          actorUserId: req.authUser!.id,
          actorName: req.authUser!.name,
        });
        return res.json(batchRes);
      } catch (error) {
        return res.status(400).json({
          error: sanitizeErrorMessage(error, 'Erro ao gravar lote de cadastros da Ivi no PostgreSQL.'),
        });
      }
    }
  );

  app.post(
    '/api/data-hub/ivi-folha-rosto/commit-finalize',
    requireAuth,
    requireAdmin,
    async (req: AuthRequest, res) => {
      req.setTimeout(0);
      res.setTimeout(0);
      const source = resolveIncomingSpreadsheet(req);
      try {
        if (!source) {
          return res.status(400).json({
            error: 'Sessão de upload não encontrada ou expirada. Envie o arquivo novamente.',
          });
        }
        let unitFallbackId: number | null = req.activeUnitId || null;
        if (req.body?.unitFallbackId !== undefined && String(req.body.unitFallbackId).trim() !== '') {
          unitFallbackId = parsePositiveIntId(req.body.unitFallbackId);
          if (!unitFallbackId) return res.status(400).json({ error: 'unitFallbackId inválido.' });
        }

        const result = await finalizeIviCommitWork({
          filePath: source.filePath,
          originalFileName: source.fileName,
          unitFallbackId,
          actorUserId: req.authUser!.id,
          actorName: req.authUser!.name,
        });

        deps.broadcast('data_hub:imported', {
          inserts:
            result.totals.clientsCreated +
            result.totals.titularesCreated +
            result.totals.banksCreated +
            result.totals.collaboratorsCreated +
            result.totals.admissionsCreated,
          updates:
            result.totals.clientsUpdated +
            result.totals.titularesUpdated +
            result.totals.admissionsUpdated,
          actor: req.authUser!.name,
        });

        return res.json(result);
      } catch (error) {
        return res.status(400).json({
          error: sanitizeErrorMessage(error, 'Erro ao finalizar cadastros da Ivi e gerar planilha de retorno.'),
        });
      } finally {
        if (source?.uploadSessionId) {
          uploadSessions.delete(source.uploadSessionId);
          removeFileSafe(source.filePath);
        }
      }
    }
  );

  app.post(
    '/api/data-hub/ivi-folha-rosto/analyze',
    requireAuth,
    requireAdmin,
    excelUpload.single('file'),
    async (req: AuthRequest, res) => {
      req.setTimeout(0);
      res.setTimeout(0);
      const source = resolveIncomingSpreadsheet(req);
      try {
        if (!source) {
          return res.status(400).json({
            error: 'Arquivo PDF (.pdf) de Folhas de Rosto ou planilha (.xlsx, .xls, .csv) até 500 MB obrigatório para leitura da Ivi.',
          });
        }
        let unitFallbackId: number | null = req.activeUnitId || null;
        if (req.body?.unitFallbackId !== undefined && String(req.body.unitFallbackId).trim() !== '') {
          unitFallbackId = parsePositiveIntId(req.body.unitFallbackId);
          if (!unitFallbackId) return res.status(400).json({ error: 'unitFallbackId inválido.' });
        }
        const rawForce = String(req.body?.forceForm || 'auto');
        const forceForm: 'auto' | 'veiculo' | 'cartao' =
          rawForce === 'veiculo' || rawForce === 'cartao' ? rawForce : 'auto';
        const columnMappingsOverride = parseMappingsOverride(req.body?.columnMappingsOverride);

        const result = await analyzeSpreadsheetWithFolhaRosto({
          filePath: source.filePath,
          originalFileName: source.fileName,
          fileSizeBytes: source.fileSizeBytes,
          uploadSessionId: source.uploadSessionId,
          unitFallbackId,
          forceForm,
          columnMappingsOverride,
        });
        return res.json(result);
      } catch (error) {
        return res.status(400).json({
          error: sanitizeErrorMessage(error, 'Falha na análise comparativa da Ivi sobre o arquivo.'),
        });
      } finally {
        if (source?.isDirectUpload) removeFileSafe(source.filePath);
      }
    }
  );

  app.post(
    '/api/data-hub/ivi-folha-rosto/commit',
    requireAuth,
    requireAdmin,
    excelUpload.single('file'),
    async (req: AuthRequest, res) => {
      req.setTimeout(0);
      res.setTimeout(0);
      const source = resolveIncomingSpreadsheet(req);
      try {
        if (!source) {
          return res.status(400).json({
            error: 'Arquivo ou sessão de upload expirada. Envie o PDF ou planilha novamente.',
          });
        }
        let unitFallbackId: number | null = req.activeUnitId || null;
        if (req.body?.unitFallbackId !== undefined && String(req.body.unitFallbackId).trim() !== '') {
          unitFallbackId = parsePositiveIntId(req.body.unitFallbackId);
          if (!unitFallbackId) return res.status(400).json({ error: 'unitFallbackId inválido.' });
        }
        const rawForce = String(req.body?.forceForm || 'auto');
        const forceForm: 'auto' | 'veiculo' | 'cartao' =
          rawForce === 'veiculo' || rawForce === 'cartao' ? rawForce : 'auto';
        const columnMappingsOverride = parseMappingsOverride(req.body?.columnMappingsOverride);

        const result = await commitSpreadsheetWithFolhaRosto({
          filePath: source.filePath,
          originalFileName: source.fileName,
          unitFallbackId,
          forceForm,
          columnMappingsOverride,
          actorUserId: req.authUser!.id,
          actorName: req.authUser!.name,
        });

        deps.broadcast('data_hub:imported', {
          inserts:
            result.totals.clientsCreated +
            result.totals.titularesCreated +
            result.totals.banksCreated +
            result.totals.collaboratorsCreated +
            result.totals.admissionsCreated,
          updates:
            result.totals.clientsUpdated +
            result.totals.titularesUpdated +
            result.totals.admissionsUpdated,
          actor: req.authUser!.name,
        });

        return res.json(result);
      } catch (error) {
        return res.status(400).json({
          error: sanitizeErrorMessage(error, 'Erro ao efetivar cadastros da Ivi no banco de dados.'),
        });
      } finally {
        if (source?.isDirectUpload) {
          removeFileSafe(source.filePath);
        } else if (source?.uploadSessionId) {
          uploadSessions.delete(source.uploadSessionId);
          removeFileSafe(source.filePath);
        }
      }
    }
  );
}
