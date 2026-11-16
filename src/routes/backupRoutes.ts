import type { Express } from 'express';
import { asc, desc, eq } from 'drizzle-orm';
import multer from 'multer';
import { db } from '../db/index.ts';
import { auditLogs, backupExecutions, backupSchedules } from '../db/schema.ts';
import { AuthRequest, requireAdmin, requireAuth } from '../middleware/auth.ts';
import { getBucketObjectBuffer } from '../services/bucketStorage.ts';
import {
  computeNextRunAt,
  executeBackupSchedule,
  getNowInSaoPaulo,
} from '../services/backupScheduler.ts';
import {
  createFullDatabaseBackup,
  getDatabaseInventory,
  inspectBackupBuffer,
  restoreFullDatabaseBackup,
} from '../services/databaseBackup.ts';
import { parsePositiveIntId, sanitizeErrorMessage } from '../utils/validation.ts';

const backupUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
});

export function registerBackupRoutes(
  app: Express,
  broadcast: (event: string, payload: unknown) => void
) {
  // 1. Overview: live DB inventory + schedules + execution history
  app.get('/api/admin/backup/overview', requireAuth, requireAdmin, async (_req: AuthRequest, res) => {
    try {
      const [inventory, schedules, executions] = await Promise.all([
        getDatabaseInventory(),
        db.select().from(backupSchedules).orderBy(asc(backupSchedules.id)),
        db.select().from(backupExecutions).orderBy(desc(backupExecutions.startedAt)).limit(60),
      ]);

      const nowBrt = getNowInSaoPaulo();
      res.json({
        inventory,
        schedules,
        executions,
        timezone: 'America/Sao_Paulo',
        serverTimeBRT: nowBrt.slotKey,
      });
    } catch (error) {
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao carregar painel de backup.') });
    }
  });

  // 2. Export Full Database Backup (returns binary .fpbackup.json.gz or .fpbackup.json + creates execution log)
  app.post('/api/admin/backup/export', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const body = (req.body || {}) as {
        includeUsersAndGroups?: boolean;
        includeAuditLogs?: boolean;
        compressGzip?: boolean;
        cloudProvider?: string;
        driveFolderId?: string;
        saveToLocalVault?: boolean;
      };

      const includeUsersAndGroups = body.includeUsersAndGroups !== false;
      const includeAuditLogs = body.includeAuditLogs !== false;
      const compressGzip = body.compressGzip !== false;
      const cloudProvider = String(body.cloudProvider || 'google_drive');

      const artifact = await createFullDatabaseBackup({
        createdBy: req.authUser!.name,
        includeUsersAndGroups,
        includeAuditLogs,
        compressGzip,
        saveToLocalVault: body.saveToLocalVault !== false,
      });

      const [execution] = await db
        .insert(backupExecutions)
        .values({
          operationType: 'backup',
          triggerType: 'manual',
          cloudProvider,
          fileName: artifact.fileName,
          driveFolderId: String(body.driveFolderId || ''),
          localVaultSha256: artifact.localVaultSha256,
          localVaultUri: artifact.localVaultUri,
          sizeBytes: artifact.sizeBytes,
          sha256Hash: artifact.sha256Hash,
          totalTables: artifact.totalTables,
          totalRows: artifact.totalRows,
          usersCount: artifact.usersCount,
          userGroupsCount: artifact.userGroupsCount,
          includesUsersAndGroups: includeUsersAndGroups,
          tablesSummaryJson: artifact.tableRowCounts,
          status: 'concluido',
          driveSyncStatus: cloudProvider === 'google_drive' ? 'pendente_sync' : 'nao_aplicavel',
          executedByUserId: req.authUser!.id,
          executedByName: req.authUser!.name,
          startedAt: new Date(),
          completedAt: new Date(),
        })
        .returning();

      await db.insert(auditLogs).values({
        userId: req.authUser!.id,
        userName: req.authUser!.name,
        action: 'DATABASE_BACKUP_GENERATED',
        entityType: 'backup_execution',
        entityId: String(execution.id),
        details: {
          fileName: artifact.fileName,
          cloudProvider,
          totalTables: artifact.totalTables,
          totalRows: artifact.totalRows,
          usersCount: artifact.usersCount,
          userGroupsCount: artifact.userGroupsCount,
          sizeBytes: artifact.sizeBytes,
        },
      });

      res.setHeader('Content-Type', artifact.mimeType);
      res.setHeader('Content-Disposition', `attachment; filename="${artifact.fileName}"`);
      res.setHeader('X-Backup-Execution-Id', String(execution.id));
      res.setHeader('X-Backup-File-Name', artifact.fileName);
      res.setHeader('X-Backup-Sha256', artifact.sha256Hash);
      res.setHeader('X-Backup-Tables', String(artifact.totalTables));
      res.setHeader('X-Backup-Rows', String(artifact.totalRows));
      res.setHeader('X-Backup-Users', String(artifact.usersCount));
      res.setHeader('X-Backup-Groups', String(artifact.userGroupsCount));
      res.setHeader(
        'Access-Control-Expose-Headers',
        'X-Backup-Execution-Id, X-Backup-File-Name, X-Backup-Sha256, X-Backup-Tables, X-Backup-Rows, X-Backup-Users, X-Backup-Groups'
      );
      res.send(artifact.buffer);
    } catch (error) {
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao gerar backup completo da base.') });
    }
  });

  // 3. Mark execution synced with Google Drive metadata
  app.post(
    '/api/admin/backup/executions/:id/drive-metadata',
    requireAuth,
    requireAdmin,
    async (req: AuthRequest, res) => {
      try {
        const execId = parsePositiveIntId(req.params.id);
        if (!execId) return res.status(400).json({ error: 'ID de execução inválido.' });

        const body = (req.body || {}) as {
          driveFileId?: string;
          driveFolderId?: string;
          driveWebViewLink?: string;
          driveSyncStatus?: string;
          errorMessage?: string;
        };

        const [updated] = await db
          .update(backupExecutions)
          .set({
            cloudProvider: 'google_drive',
            driveFileId: String(body.driveFileId || ''),
            driveFolderId: String(body.driveFolderId || ''),
            driveWebViewLink: String(body.driveWebViewLink || ''),
            driveSyncStatus: String(body.driveSyncStatus || 'sincronizado'),
            errorMessage: String(body.errorMessage || ''),
          })
          .where(eq(backupExecutions.id, execId))
          .returning();

        if (!updated) return res.status(404).json({ error: 'Registro de execução não encontrado.' });
        res.json({ ok: true, execution: updated });
      } catch (error) {
        res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao atualizar metadados do Google Drive.') });
      }
    }
  );

  // 4. Download stored backup snapshot from server vault (for manual download or Drive sync)
  app.get(
    '/api/admin/backup/executions/:id/download',
    requireAuth,
    requireAdmin,
    async (req: AuthRequest, res) => {
      try {
        const execId = parsePositiveIntId(req.params.id);
        if (!execId) return res.status(400).json({ error: 'ID de execução inválido.' });

        const [execution] = await db
          .select()
          .from(backupExecutions)
          .where(eq(backupExecutions.id, execId))
          .limit(1);
        if (!execution) return res.status(404).json({ error: 'Execução de backup não encontrada.' });
        if (!execution.localVaultSha256) {
          return res.status(404).json({ error: 'Este registro não possui snapshot armazenado no cofre do servidor.' });
        }

        const buffer = await getBucketObjectBuffer(execution.localVaultSha256, execution.localVaultUri);
        if (!buffer) {
          return res.status(404).json({ error: 'Arquivo físico do snapshot não localizado no cofre.' });
        }

        const isGzip = execution.fileName.endsWith('.gz');
        res.setHeader('Content-Type', isGzip ? 'application/gzip' : 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="${execution.fileName}"`);
        res.send(buffer);
      } catch (error) {
        res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao baixar snapshot de backup.') });
      }
    }
  );

  // 5. Inspect backup file (dry-run validation before restore)
  app.post(
    '/api/admin/backup/inspect',
    requireAuth,
    requireAdmin,
    backupUpload.single('file'),
    async (req: AuthRequest, res) => {
      try {
        let buffer: Buffer | null = null;
        if (req.file?.buffer) {
          buffer = req.file.buffer;
        } else if (req.body?.executionId) {
          const execId = parsePositiveIntId(req.body.executionId);
          if (!execId) return res.status(400).json({ error: 'ID de execução inválido.' });
          const [exec] = await db
            .select()
            .from(backupExecutions)
            .where(eq(backupExecutions.id, execId))
            .limit(1);
          if (!exec?.localVaultSha256) {
            return res.status(404).json({ error: 'Snapshot não encontrado no servidor.' });
          }
          buffer = await getBucketObjectBuffer(exec.localVaultSha256, exec.localVaultUri);
        }

        if (!buffer) {
          return res.status(400).json({ error: 'Envie um arquivo de backup (.fpbackup.json ou .json.gz) para validação.' });
        }

        const { inspection } = await inspectBackupBuffer(buffer);
        res.json({ inspection });
      } catch (error) {
        res.status(400).json({ error: sanitizeErrorMessage(error, 'Arquivo de backup inválido ou corrompido.') });
      }
    }
  );

  // 6. Execute Full Transactional Restore
  app.post(
    '/api/admin/backup/restore',
    requireAuth,
    requireAdmin,
    backupUpload.single('file'),
    async (req: AuthRequest, res) => {
      try {
        let buffer: Buffer | null = null;
        let sourceLabel = String(req.body?.sourceLabel || 'Arquivo enviado');
        let fileName = req.file?.originalname || String(req.body?.fileName || 'restore_backup.fpbackup.json.gz');
        let driveFileId = String(req.body?.driveFileId || '');

        if (req.file?.buffer) {
          buffer = req.file.buffer;
        } else if (req.body?.executionId) {
          const execId = parsePositiveIntId(req.body.executionId);
          if (!execId) return res.status(400).json({ error: 'ID de execução inválido.' });
          const [exec] = await db
            .select()
            .from(backupExecutions)
            .where(eq(backupExecutions.id, execId))
            .limit(1);
          if (!exec?.localVaultSha256) {
            return res.status(404).json({ error: 'Snapshot não encontrado no cofre do servidor.' });
          }
          buffer = await getBucketObjectBuffer(exec.localVaultSha256, exec.localVaultUri);
          fileName = exec.fileName;
          sourceLabel = 'Snapshot do Servidor';
        }

        if (!buffer) {
          return res.status(400).json({ error: 'Nenhum arquivo de backup foi fornecido para restauração.' });
        }

        const restoreUsersAndGroups =
          req.body?.restoreUsersAndGroups === undefined
            ? true
            : String(req.body.restoreUsersAndGroups) !== 'false';
        const preserveBackupConfig =
          req.body?.preserveBackupConfig === undefined
            ? true
            : String(req.body.preserveBackupConfig) !== 'false';

        const result = await restoreFullDatabaseBackup(buffer, {
          actorName: req.authUser!.name,
          actorUserId: req.authUser!.id,
          restoreUsersAndGroups,
          preserveBackupConfig,
        });

        const [restoreExec] = await db
          .insert(backupExecutions)
          .values({
            operationType: 'restore',
            triggerType: 'manual',
            cloudProvider: driveFileId ? 'google_drive' : 'local_download',
            fileName,
            driveFileId,
            sizeBytes: buffer.length,
            totalTables: result.restoredTables,
            totalRows: result.restoredRows,
            usersCount: result.usersRestored,
            userGroupsCount: result.userGroupsRestored,
            includesUsersAndGroups: restoreUsersAndGroups,
            status: 'concluido',
            driveSyncStatus: 'nao_aplicavel',
            executedByName: req.authUser!.name,
            startedAt: new Date(),
            completedAt: new Date(),
          })
          .returning();

        await db.insert(auditLogs).values({
          userName: req.authUser!.name,
          action: 'DATABASE_FULL_RESTORE_EXECUTED',
          entityType: 'backup_execution',
          entityId: String(restoreExec.id),
          details: {
            sourceLabel,
            fileName,
            driveFileId,
            restoredTables: result.restoredTables,
            restoredRows: result.restoredRows,
            usersRestored: result.usersRestored,
            userGroupsRestored: result.userGroupsRestored,
            preRestoreSnapshotFileName: result.preRestoreSnapshotFileName,
          },
        });

        broadcast('backup:restored', {
          fileName,
          restoredTables: result.restoredTables,
          restoredRows: result.restoredRows,
          by: req.authUser!.name,
        });

        res.json({
          ok: true,
          ...result,
          restoreExecutionId: restoreExec.id,
        });
      } catch (error) {
        res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao executar restauração da base de dados.') });
      }
    }
  );

  // 7. Automatic Backup Schedules CRUD
  app.post('/api/admin/backup/schedules', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const body = (req.body || {}) as {
        name?: string;
        cloudProvider?: string;
        targetFolderId?: string;
        targetFolderName?: string;
        daysOfWeek?: number[];
        executionTime?: string;
        includeUsersAndGroups?: boolean;
        includeAuditLogs?: boolean;
        compressGzip?: boolean;
        retentionCount?: number;
        active?: boolean;
      };

      const name = String(body.name || '').trim();
      const executionTime = String(body.executionTime || '02:00').trim();
      const daysOfWeek = Array.isArray(body.daysOfWeek)
        ? [...new Set(body.daysOfWeek.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort()
        : [1, 2, 3, 4, 5];

      if (!name) return res.status(400).json({ error: 'Informe um nome para o agendamento de backup.' });
      if (daysOfWeek.length === 0) return res.status(400).json({ error: 'Selecione pelo menos um dia da semana.' });
      if (!/^\d{2}:\d{2}$/.test(executionTime)) {
        return res.status(400).json({ error: 'Horário de execução inválido (use formato HH:MM).' });
      }

      const active = body.active !== false;
      const nextRunAt = computeNextRunAt(daysOfWeek, executionTime, active);

      const [created] = await db
        .insert(backupSchedules)
        .values({
          name,
          cloudProvider: String(body.cloudProvider || 'google_drive'),
          targetFolderId: String(body.targetFolderId || '').trim(),
          targetFolderName: String(body.targetFolderName || 'FinancePro_Backups').trim() || 'FinancePro_Backups',
          daysOfWeek,
          executionTime,
          includeUsersAndGroups: body.includeUsersAndGroups !== false,
          includeAuditLogs: body.includeAuditLogs !== false,
          compressGzip: body.compressGzip !== false,
          retentionCount: Math.max(1, Math.min(100, Number(body.retentionCount || 10))),
          active,
          nextRunAt,
          createdByUserId: req.authUser!.id,
          createdByName: req.authUser!.name,
        })
        .returning();

      await db.insert(auditLogs).values({
        userId: req.authUser!.id,
        userName: req.authUser!.name,
        action: 'BACKUP_SCHEDULE_CREATED',
        entityType: 'backup_schedule',
        entityId: String(created.id),
        details: { name: created.name, daysOfWeek, executionTime, cloudProvider: created.cloudProvider },
      });

      res.json({ ok: true, schedule: created });
    } catch (error) {
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao criar agendamento de backup.') });
    }
  });

  app.put('/api/admin/backup/schedules/:id', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const id = parsePositiveIntId(req.params.id);
      if (!id) return res.status(400).json({ error: 'ID de agendamento inválido.' });

      const body = (req.body || {}) as {
        name?: string;
        cloudProvider?: string;
        targetFolderId?: string;
        targetFolderName?: string;
        daysOfWeek?: number[];
        executionTime?: string;
        includeUsersAndGroups?: boolean;
        includeAuditLogs?: boolean;
        compressGzip?: boolean;
        retentionCount?: number;
        active?: boolean;
      };

      const name = String(body.name || '').trim();
      const executionTime = String(body.executionTime || '02:00').trim();
      const daysOfWeek = Array.isArray(body.daysOfWeek)
        ? [...new Set(body.daysOfWeek.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort()
        : [1, 2, 3, 4, 5];

      if (!name) return res.status(400).json({ error: 'Informe o nome do agendamento.' });
      if (daysOfWeek.length === 0) return res.status(400).json({ error: 'Selecione pelo menos um dia da semana.' });
      if (!/^\d{2}:\d{2}$/.test(executionTime)) {
        return res.status(400).json({ error: 'Horário de execução inválido (use formato HH:MM).' });
      }

      const active = body.active !== false;
      const nextRunAt = computeNextRunAt(daysOfWeek, executionTime, active);

      const [updated] = await db
        .update(backupSchedules)
        .set({
          name,
          cloudProvider: String(body.cloudProvider || 'google_drive'),
          targetFolderId: String(body.targetFolderId || '').trim(),
          targetFolderName: String(body.targetFolderName || 'FinancePro_Backups').trim() || 'FinancePro_Backups',
          daysOfWeek,
          executionTime,
          includeUsersAndGroups: body.includeUsersAndGroups !== false,
          includeAuditLogs: body.includeAuditLogs !== false,
          compressGzip: body.compressGzip !== false,
          retentionCount: Math.max(1, Math.min(100, Number(body.retentionCount || 10))),
          active,
          nextRunAt,
          updatedAt: new Date(),
        })
        .where(eq(backupSchedules.id, id))
        .returning();

      if (!updated) return res.status(404).json({ error: 'Agendamento não encontrado.' });

      await db.insert(auditLogs).values({
        userId: req.authUser!.id,
        userName: req.authUser!.name,
        action: 'BACKUP_SCHEDULE_UPDATED',
        entityType: 'backup_schedule',
        entityId: String(id),
        details: { name, daysOfWeek, executionTime, active },
      });

      res.json({ ok: true, schedule: updated });
    } catch (error) {
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao atualizar agendamento de backup.') });
    }
  });

  app.patch('/api/admin/backup/schedules/:id/toggle', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const id = parsePositiveIntId(req.params.id);
      if (!id) return res.status(400).json({ error: 'ID de agendamento inválido.' });

      const [existing] = await db
        .select()
        .from(backupSchedules)
        .where(eq(backupSchedules.id, id))
        .limit(1);
      if (!existing) return res.status(404).json({ error: 'Agendamento não localizado.' });

      const nextActive = !existing.active;
      const nextRunAt = computeNextRunAt(existing.daysOfWeek || [], existing.executionTime, nextActive);

      const [updated] = await db
        .update(backupSchedules)
        .set({ active: nextActive, nextRunAt, updatedAt: new Date() })
        .where(eq(backupSchedules.id, id))
        .returning();

      res.json({ ok: true, schedule: updated });
    } catch (error) {
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao alternar status do agendamento.') });
    }
  });

  app.post('/api/admin/backup/schedules/:id/run-now', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const id = parsePositiveIntId(req.params.id);
      if (!id) return res.status(400).json({ error: 'ID de agendamento inválido.' });

      const execution = await executeBackupSchedule(id, {
        triggerType: 'manual',
        executedByUserId: req.authUser!.id,
        executedByName: req.authUser!.name,
        broadcast,
      });

      res.json({ ok: true, execution });
    } catch (error) {
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao executar agendamento de backup.') });
    }
  });

  app.delete('/api/admin/backup/schedules/:id', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const id = parsePositiveIntId(req.params.id);
      if (!id) return res.status(400).json({ error: 'ID de agendamento inválido.' });

      const [deleted] = await db
        .delete(backupSchedules)
        .where(eq(backupSchedules.id, id))
        .returning();
      if (!deleted) return res.status(404).json({ error: 'Agendamento não localizado.' });

      await db.insert(auditLogs).values({
        userId: req.authUser!.id,
        userName: req.authUser!.name,
        action: 'BACKUP_SCHEDULE_DELETED',
        entityType: 'backup_schedule',
        entityId: String(id),
        details: { name: deleted.name },
      });

      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao excluir agendamento.') });
    }
  });
}
