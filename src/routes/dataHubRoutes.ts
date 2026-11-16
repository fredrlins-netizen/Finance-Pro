import type { Express } from 'express';
import multer from 'multer';
import { AuthRequest, requireAdmin, requireAuth } from '../middleware/auth.ts';
import {
  DATA_HUB_ENTITIES,
  DATA_HUB_PACKAGES,
  TIER_LABELS,
} from '../services/dataHubRegistry.ts';
import { exportExcelWorkbook, processExcelImport } from '../services/dataHubExcelService.ts';
import { db } from '../db/index.ts';
import { units } from '../db/schema.ts';

const excelUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

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
      });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Erro ao listar layouts Excel.' });
    }
  });

  app.get('/api/data-hub/export-xlsx', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const scopeType = String(req.query.scopeType || 'entity') === 'package' ? 'package' : 'entity';
      const key = String(req.query.key || 'clients');
      const mode = String(req.query.mode || 'data') === 'template' ? 'template' : 'data';
      const rawUnitId = String(req.query.unitId || '').trim();
      const unitId = rawUnitId && rawUnitId !== 'all' ? Number(rawUnitId) : null;

      const out = await exportExcelWorkbook({
        scopeType,
        key,
        mode,
        unitId: unitId && Number.isFinite(unitId) ? unitId : null,
        actorUserId: req.authUser!.id,
        actorName: req.authUser!.name,
      });

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${out.fileName}"`);
      res.setHeader('X-DataHub-Rows', String(out.totalRows));
      res.setHeader('X-DataHub-Sheets', String(out.sheetsCount));
      res.send(out.buffer);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Erro ao gerar planilha Excel.' });
    }
  });

  app.post(
    '/api/data-hub/import-xlsx/dry-run',
    requireAuth,
    requireAdmin,
    excelUpload.single('file'),
    async (req: AuthRequest, res) => {
      try {
        if (!req.file?.buffer) {
          return res.status(400).json({ error: 'Arquivo .xlsx obrigatório.' });
        }
        const expectedLayoutKey = String(req.body?.expectedLayoutKey || '').trim() || undefined;
        const unitFallbackId = req.body?.unitFallbackId ? Number(req.body.unitFallbackId) : req.activeUnitId || null;

        const result = await processExcelImport({
          buffer: req.file.buffer,
          expectedLayoutKey,
          mode: 'dry_run',
          unitFallbackId,
          assignIntegrative: req.body?.assignIntegrative !== 'false',
          actorUserId: req.authUser!.id,
          actorName: req.authUser!.name,
        });
        res.json(result);
      } catch (error) {
        res.status(400).json({ error: error instanceof Error ? error.message : 'Falha na pré-validação da planilha.' });
      }
    }
  );

  app.post(
    '/api/data-hub/import-xlsx/commit',
    requireAuth,
    requireAdmin,
    excelUpload.single('file'),
    async (req: AuthRequest, res) => {
      try {
        if (!req.file?.buffer) {
          return res.status(400).json({ error: 'Arquivo .xlsx obrigatório.' });
        }
        const expectedLayoutKey = String(req.body?.expectedLayoutKey || '').trim() || undefined;
        const unitFallbackId = req.body?.unitFallbackId ? Number(req.body.unitFallbackId) : req.activeUnitId || null;

        const result = await processExcelImport({
          buffer: req.file.buffer,
          expectedLayoutKey,
          mode: 'commit',
          unitFallbackId,
          assignIntegrative: req.body?.assignIntegrative !== 'false',
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
        res.status(400).json({ error: error instanceof Error ? error.message : 'Erro ao executar importação Excel.' });
      }
    }
  );
}
