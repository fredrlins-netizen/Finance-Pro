import { desc, eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { auditLogs, backupExecutions, backupSchedules } from '../db/schema.ts';
import { createFullDatabaseBackup } from './databaseBackup.ts';

const BRT_TIMEZONE = 'America/Sao_Paulo';

export function getNowInSaoPaulo(refDate = new Date()): {
  year: number;
  month: number;
  day: number;
  weekday: number;
  hhmm: string;
  slotKey: string;
} {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BRT_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    weekday: 'short',
  }).formatToParts(refDate);

  const get = (type: string) => parts.find((p) => p.type === type)?.value || '';
  const year = Number(get('year'));
  const month = Number(get('month'));
  const day = Number(get('day'));
  const rawHour = get('hour');
  const hour = rawHour === '24' ? '00' : rawHour.padStart(2, '0');
  const minute = get('minute').padStart(2, '0');
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const weekday = weekdayMap[get('weekday')] ?? refDate.getDay();
  const hhmm = `${hour}:${minute}`;
  const slotKey = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')} ${hhmm}`;

  return { year, month, day, weekday, hhmm, slotKey };
}

export function computeNextRunAt(daysOfWeek: number[], executionTime: string, active = true): Date | null {
  if (!active || !Array.isArray(daysOfWeek) || daysOfWeek.length === 0) return null;
  const match = /^(\d{2}):(\d{2})$/.exec((executionTime || '').trim());
  if (!match) return null;
  const targetHour = Number(match[1]);
  const targetMin = Number(match[2]);
  if (targetHour > 23 || targetMin > 59) return null;

  const now = new Date();
  const nowBrt = getNowInSaoPaulo(now);
  const daysSet = new Set(daysOfWeek);

  // America/Sao_Paulo is fixed UTC-3
  for (let offsetDays = 0; offsetDays <= 8; offsetDays++) {
    const candidateUtc = new Date(
      Date.UTC(nowBrt.year, nowBrt.month - 1, nowBrt.day + offsetDays, targetHour + 3, targetMin, 0, 0)
    );
    const candidateBrt = getNowInSaoPaulo(candidateUtc);
    if (daysSet.has(candidateBrt.weekday) && candidateUtc.getTime() > now.getTime() + 10_000) {
      return candidateUtc;
    }
  }
  return null;
}

const runningSchedules = new Set<number>();
const lastSlotBySchedule = new Map<number, string>();

export async function executeBackupSchedule(
  scheduleId: number,
  opts?: {
    triggerType?: 'agendado' | 'manual';
    executedByUserId?: number | null;
    executedByName?: string;
    broadcast?: (event: string, payload: unknown) => void;
  }
) {
  if (runningSchedules.has(scheduleId)) {
    throw new Error('Este agendamento já está em execução no momento.');
  }
  runningSchedules.add(scheduleId);

  try {
    const [schedule] = await db
      .select()
      .from(backupSchedules)
      .where(eq(backupSchedules.id, scheduleId))
      .limit(1);
    if (!schedule) {
      throw new Error('Agendamento de backup não encontrado.');
    }

    await db
      .update(backupSchedules)
      .set({ lastRunStatus: 'executando', updatedAt: new Date() })
      .where(eq(backupSchedules.id, scheduleId));

    const triggerType = opts?.triggerType || 'agendado';
    const actorName = opts?.executedByName || `Agendador (${schedule.name})`;

    const artifact = await createFullDatabaseBackup({
      createdBy: actorName,
      includeUsersAndGroups: schedule.includeUsersAndGroups,
      includeAuditLogs: schedule.includeAuditLogs,
      compressGzip: schedule.compressGzip,
      saveToLocalVault: true,
      fileNamePrefix: `financepro_sched_${schedule.id}`,
    });

    const needsDriveSync = schedule.cloudProvider === 'google_drive';

    const [execution] = await db
      .insert(backupExecutions)
      .values({
        scheduleId: schedule.id,
        operationType: 'backup',
        triggerType,
        cloudProvider: schedule.cloudProvider,
        fileName: artifact.fileName,
        driveFolderId: schedule.targetFolderId || '',
        localVaultSha256: artifact.localVaultSha256,
        localVaultUri: artifact.localVaultUri,
        sizeBytes: artifact.sizeBytes,
        sha256Hash: artifact.sha256Hash,
        totalTables: artifact.totalTables,
        totalRows: artifact.totalRows,
        usersCount: artifact.usersCount,
        userGroupsCount: artifact.userGroupsCount,
        includesUsersAndGroups: schedule.includeUsersAndGroups,
        tablesSummaryJson: artifact.tableRowCounts,
        status: 'concluido',
        driveSyncStatus: needsDriveSync ? 'pendente_sync' : 'nao_aplicavel',
        executedByUserId: opts?.executedByUserId ?? null,
        executedByName: actorName,
        startedAt: new Date(),
        completedAt: new Date(),
      })
      .returning();

    const nextRun = computeNextRunAt(schedule.daysOfWeek || [], schedule.executionTime, schedule.active);

    await db
      .update(backupSchedules)
      .set({
        lastRunAt: new Date(),
        lastRunStatus: 'sucesso',
        lastRunMessage: `${artifact.totalTables} tabelas · ${artifact.totalRows} registros (${artifact.usersCount} usuários, ${artifact.userGroupsCount} grupos)`,
        nextRunAt: nextRun,
        updatedAt: new Date(),
      })
      .where(eq(backupSchedules.id, schedule.id));

    await db.insert(auditLogs).values({
      userId: opts?.executedByUserId ?? null,
      userName: actorName,
      action: triggerType === 'agendado' ? 'BACKUP_AGENDADO_EXECUTADO' : 'BACKUP_AGENDAMENTO_MANUAL',
      entityType: 'backup_execution',
      entityId: String(execution.id),
      details: {
        scheduleId: schedule.id,
        scheduleName: schedule.name,
        fileName: artifact.fileName,
        totalTables: artifact.totalTables,
        totalRows: artifact.totalRows,
        usersCount: artifact.usersCount,
        userGroupsCount: artifact.userGroupsCount,
        cloudProvider: schedule.cloudProvider,
      },
    });

    opts?.broadcast?.('backup:scheduled_executed', {
      executionId: execution.id,
      scheduleId: schedule.id,
      scheduleName: schedule.name,
      fileName: artifact.fileName,
      cloudProvider: schedule.cloudProvider,
      driveSyncStatus: execution.driveSyncStatus,
    });

    return execution;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro ao executar backup agendado.';
    await db
      .update(backupSchedules)
      .set({
        lastRunAt: new Date(),
        lastRunStatus: 'erro',
        lastRunMessage: msg.slice(0, 400),
        updatedAt: new Date(),
      })
      .where(eq(backupSchedules.id, scheduleId))
      .catch(() => {});
    throw err;
  } finally {
    runningSchedules.delete(scheduleId);
  }
}

let schedulerTimer: NodeJS.Timeout | null = null;

export function startBackupScheduler(
  broadcast: (event: string, payload: unknown) => void,
  ensureConnection?: () => Promise<void>
) {
  if (schedulerTimer) return;

  const isSocketConnErr = (err: unknown): boolean => {
    const visited = new Set<unknown>();
    let cur: unknown = err;
    while (cur && typeof cur === 'object' && !visited.has(cur)) {
      visited.add(cur);
      const code = (cur as { code?: unknown }).code;
      const msg = (cur as { message?: unknown }).message;
      if (code === 'ECONNREFUSED' || code === 'ENOENT') return true;
      if (typeof msg === 'string' && (msg.includes('ECONNREFUSED') || msg.includes('ENOENT'))) return true;
      cur = (cur as { cause?: unknown }).cause;
    }
    return false;
  };

  const tick = async () => {
    try {
      const nowBrt = getNowInSaoPaulo();
      const schedules = await db
        .select()
        .from(backupSchedules)
        .where(eq(backupSchedules.active, true))
        .orderBy(desc(backupSchedules.id));

      for (const sched of schedules) {
        const days = Array.isArray(sched.daysOfWeek) ? sched.daysOfWeek : [];
        if (!days.includes(nowBrt.weekday)) continue;
        if (sched.executionTime !== nowBrt.hhmm) continue;

        if (lastSlotBySchedule.get(sched.id) === nowBrt.slotKey) continue;
        if (sched.lastRunAt) {
          const lastRunBrt = getNowInSaoPaulo(new Date(sched.lastRunAt));
          if (lastRunBrt.slotKey === nowBrt.slotKey) {
            lastSlotBySchedule.set(sched.id, nowBrt.slotKey);
            continue;
          }
        }

        lastSlotBySchedule.set(sched.id, nowBrt.slotKey);
        void executeBackupSchedule(sched.id, {
          triggerType: 'agendado',
          executedByName: `Agendador Automático (${sched.name})`,
          broadcast,
        }).catch((err) => {
          console.error(`[BackupScheduler] Falha no agendamento #${sched.id}:`, err);
        });
      }
    } catch (err) {
      if (ensureConnection && isSocketConnErr(err)) {
        await ensureConnection().catch(() => {});
        return;
      }
      console.error('[BackupScheduler] Tick error:', err);
    }
  };

  // Run check every 25 seconds so no minute boundary is ever missed
  schedulerTimer = setInterval(tick, 25_000);
}
