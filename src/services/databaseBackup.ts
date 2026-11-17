import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { pool } from '../db/index.ts';
import { putBucketObject } from './bucketStorage.ts';

export interface ColumnTypeMeta {
  dataType: string;
  udtName: string;
}

export interface BackupSequenceMeta {
  tableName: string;
  columnName: string;
  sequenceName: string;
  lastValue: number;
}

export interface FullDatabaseBackupPayload {
  format: 'financepro-full-db-backup';
  version: '1.0';
  createdAt: string;
  createdBy: string;
  databaseName: string;
  includesUsersAndGroups: boolean;
  includesAuditLogs: boolean;
  tableOrder: string[];
  sequences: BackupSequenceMeta[];
  tableRowCounts: Record<string, number>;
  columnTypes: Record<string, Record<string, ColumnTypeMeta>>;
  tables: Record<string, Array<Record<string, unknown>>>;
  checksumSha256: string;
}

export interface BackupInspectionResult {
  valid: boolean;
  format: string;
  version: string;
  createdAt: string;
  createdBy: string;
  databaseName: string;
  includesUsersAndGroups: boolean;
  includesAuditLogs: boolean;
  checksumValid: boolean;
  checksumSha256: string;
  totalTables: number;
  totalRows: number;
  usersCount: number;
  userGroupsCount: number;
  tableRowCounts: Record<string, number>;
  missingInTargetSchema: string[];
  warnings: string[];
}

export interface CreatedBackupArtifact {
  fileName: string;
  mimeType: string;
  compressed: boolean;
  buffer: Buffer;
  sizeBytes: number;
  sha256Hash: string;
  totalTables: number;
  totalRows: number;
  usersCount: number;
  userGroupsCount: number;
  tableRowCounts: Record<string, number>;
  localVaultSha256: string;
  localVaultUri: string;
}

function quoteIdent(name: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(`Identificador SQL inválido: ${name}`);
  }
  return `"${name}"`;
}

async function getPublicBaseTables(): Promise<string[]> {
  const res = await pool.query<{ table_name: string }>(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
     ORDER BY table_name ASC;`
  );
  return res.rows.map((r) => r.table_name);
}

async function resolveTopologicalTableOrder(tableNames: string[]): Promise<string[]> {
  const tableSet = new Set(tableNames);
  const fkRes = await pool.query<{ child_table: string; parent_table: string }>(
    `SELECT DISTINCT
       c_child.relname AS child_table,
       c_parent.relname AS parent_table
     FROM pg_constraint con
     JOIN pg_class c_child ON c_child.oid = con.conrelid
     JOIN pg_class c_parent ON c_parent.oid = con.confrelid
     WHERE con.contype = 'f'
       AND con.connamespace = 'public'::regnamespace
       AND c_child.relkind = 'r'
       AND c_parent.relkind = 'r';`
  );

  // parent -> children adjacency list
  const childrenMap = new Map<string, Set<string>>();
  const inDegree = new Map<string, number>();

  for (const t of tableNames) {
    childrenMap.set(t, new Set());
    inDegree.set(t, 0);
  }

  for (const edge of fkRes.rows) {
    const parent = edge.parent_table;
    const child = edge.child_table;
    if (!tableSet.has(parent) || !tableSet.has(child) || parent === child) continue;
    const set = childrenMap.get(parent)!;
    if (!set.has(child)) {
      set.add(child);
      inDegree.set(child, (inDegree.get(child) || 0) + 1);
    }
  }

  // Prefer core identity tables first among 0-indegree roots
  const priorityWeight = (t: string): number => {
    if (t === 'units') return 0;
    if (t === 'user_groups') return 1;
    if (t === 'users') return 2;
    if (t === 'roles_catalog' || t === 'departments') return 3;
    return 10;
  };

  const queue = tableNames
    .filter((t) => (inDegree.get(t) || 0) === 0)
    .sort((a, b) => priorityWeight(a) - priorityWeight(b) || a.localeCompare(b));

  const ordered: string[] = [];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    ordered.push(current);

    const kids = Array.from(childrenMap.get(current) || []).sort();
    for (const child of kids) {
      const nextDeg = (inDegree.get(child) || 0) - 1;
      inDegree.set(child, nextDeg);
      if (nextDeg <= 0 && !visited.has(child)) {
        queue.push(child);
        queue.sort((a, b) => priorityWeight(a) - priorityWeight(b) || a.localeCompare(b));
      }
    }
  }

  // Fallback for any cyclic edges
  for (const t of tableNames) {
    if (!visited.has(t)) ordered.push(t);
  }

  return ordered;
}

async function getColumnsMetadataByTable(): Promise<Record<string, Record<string, ColumnTypeMeta>>> {
  const res = await pool.query<{
    table_name: string;
    column_name: string;
    data_type: string;
    udt_name: string;
  }>(
    `SELECT table_name, column_name, data_type, udt_name
     FROM information_schema.columns
     WHERE table_schema = 'public'
     ORDER BY table_name, ordinal_position;`
  );

  const map: Record<string, Record<string, ColumnTypeMeta>> = {};
  for (const row of res.rows) {
    if (!map[row.table_name]) map[row.table_name] = {};
    map[row.table_name][row.column_name] = {
      dataType: row.data_type,
      udtName: row.udt_name,
    };
  }
  return map;
}

async function getAllPublicSerialSequences(
  runner: { query: typeof pool.query } = pool
): Promise<Array<{ tableName: string; columnName: string; sequenceName: string }>> {
  const res = await runner.query<{
    table_name: string;
    column_name: string;
    seq_name: string;
  }>(
    `SELECT
       table_name,
       column_name,
       pg_get_serial_sequence(quote_ident(table_schema) || '.' || quote_ident(table_name), column_name) AS seq_name
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND pg_get_serial_sequence(quote_ident(table_schema) || '.' || quote_ident(table_name), column_name) IS NOT NULL
     ORDER BY table_name ASC, column_name ASC;`
  );
  return res.rows.map((r) => ({
    tableName: r.table_name,
    columnName: r.column_name,
    sequenceName: r.seq_name,
  }));
}

export async function getDatabaseInventory(): Promise<{
  databaseName: string;
  totalTables: number;
  totalRows: number;
  usersCount: number;
  userGroupsCount: number;
  tables: Array<{ tableName: string; rowCount: number }>;
}> {
  const tableNames = await getPublicBaseTables();
  const dbRes = await pool.query<{ db: string }>('SELECT current_database() AS db;');
  const databaseName = dbRes.rows[0]?.db || 'financepro';

  const countMap = new Map<string, number>();
  if (tableNames.length > 0) {
    const unionSql = tableNames
      .map((t) => `SELECT '${t}'::text AS table_name, COUNT(*)::bigint AS cnt FROM ${quoteIdent(t)}`)
      .join(' UNION ALL ');
    const cntRes = await pool.query<{ table_name: string; cnt: string }>(unionSql);
    for (const row of cntRes.rows) {
      countMap.set(row.table_name, Number(row.cnt || 0));
    }
  }

  const tables: Array<{ tableName: string; rowCount: number }> = [];
  let totalRows = 0;
  let usersCount = 0;
  let userGroupsCount = 0;

  for (const tableName of tableNames) {
    const rowCount = countMap.get(tableName) ?? 0;
    tables.push({ tableName, rowCount });
    totalRows += rowCount;
    if (tableName === 'users') usersCount = rowCount;
    if (tableName === 'user_groups') userGroupsCount = rowCount;
  }

  return {
    databaseName,
    totalTables: tables.length,
    totalRows,
    usersCount,
    userGroupsCount,
    tables,
  };
}

function serializeRowForBackup(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (Buffer.isBuffer(v)) {
      out[k] = { __fpByteaBase64: v.toString('base64') };
    } else {
      out[k] = v;
    }
  }
  return out;
}

export async function createFullDatabaseBackup(options?: {
  createdBy?: string;
  includeUsersAndGroups?: boolean;
  includeAuditLogs?: boolean;
  compressGzip?: boolean;
  saveToLocalVault?: boolean;
  fileNamePrefix?: string;
}): Promise<CreatedBackupArtifact> {
  const createdBy = options?.createdBy || 'Sistema';
  const includeUsersAndGroups = options?.includeUsersAndGroups !== false;
  const includeAuditLogs = options?.includeAuditLogs !== false;
  const compressGzip = options?.compressGzip !== false;
  const saveToLocalVault = options?.saveToLocalVault !== false;

  const [allTables, columnTypes, dbRes, serialSequences] = await Promise.all([
    getPublicBaseTables(),
    getColumnsMetadataByTable(),
    pool.query<{ db: string }>('SELECT current_database() AS db;'),
    getAllPublicSerialSequences(pool),
  ]);
  const tableOrder = await resolveTopologicalTableOrder(allTables);
  const databaseName = dbRes.rows[0]?.db || 'financepro';

  const seqByTable = new Map<string, Array<{ columnName: string; sequenceName: string }>>();
  for (const seq of serialSequences) {
    const arr = seqByTable.get(seq.tableName) || [];
    arr.push({ columnName: seq.columnName, sequenceName: seq.sequenceName });
    seqByTable.set(seq.tableName, arr);
  }

  const tables: Record<string, Array<Record<string, unknown>>> = {};
  const tableRowCounts: Record<string, number> = {};
  const sequences: BackupSequenceMeta[] = [];

  let totalRows = 0;
  let usersCount = 0;
  let userGroupsCount = 0;

  // Read tables in bounded concurrent chunks to keep Cloud SQL round-trips fast without exhausting pool
  const CHUNK_SIZE = 5;
  for (let i = 0; i < tableOrder.length; i += CHUNK_SIZE) {
    const batchTables = tableOrder.slice(i, i + CHUNK_SIZE);
    await Promise.all(
      batchTables.map(async (tableName) => {
        const skipRows =
          (!includeUsersAndGroups && (tableName === 'users' || tableName === 'user_groups')) ||
          (!includeAuditLogs && tableName === 'audit_logs');

        const cols = Object.keys(columnTypes[tableName] || {});
        const tableSeqs = seqByTable.get(tableName) || [];

        if (skipRows) {
          tables[tableName] = [];
          tableRowCounts[tableName] = 0;
          for (const seq of tableSeqs) {
            const maxRes = await pool.query<{ max_val: string | null }>(
              `SELECT COALESCE(MAX(${quoteIdent(seq.columnName)}), 0)::text AS max_val FROM ${quoteIdent(tableName)};`
            );
            sequences.push({
              tableName,
              columnName: seq.columnName,
              sequenceName: seq.sequenceName,
              lastValue: Number(maxRes.rows[0]?.max_val || 0),
            });
          }
          return;
        }

        const orderCol = cols.includes('id') ? ' ORDER BY "id" ASC' : '';
        const dataRes = await pool.query<Record<string, unknown>>(
          `SELECT * FROM ${quoteIdent(tableName)}${orderCol};`
        );

        const rows = dataRes.rows.map(serializeRowForBackup);
        tables[tableName] = rows;
        tableRowCounts[tableName] = rows.length;
        totalRows += rows.length;

        if (tableName === 'users') usersCount = rows.length;
        if (tableName === 'user_groups') userGroupsCount = rows.length;

        for (const seq of tableSeqs) {
          let maxVal = 0;
          for (const row of rows) {
            const num = Number(row[seq.columnName] || 0);
            if (Number.isFinite(num) && num > maxVal) maxVal = num;
          }
          sequences.push({
            tableName,
            columnName: seq.columnName,
            sequenceName: seq.sequenceName,
            lastValue: maxVal,
          });
        }
      })
    );
  }

  const canonicalData = JSON.stringify({ tableOrder, tables });
  const checksumSha256 = crypto.createHash('sha256').update(canonicalData, 'utf8').digest('hex');

  const payload: FullDatabaseBackupPayload = {
    format: 'financepro-full-db-backup',
    version: '1.0',
    createdAt: new Date().toISOString(),
    createdBy,
    databaseName,
    includesUsersAndGroups: includeUsersAndGroups,
    includesAuditLogs: includeAuditLogs,
    tableOrder,
    sequences,
    tableRowCounts,
    columnTypes,
    tables,
    checksumSha256,
  };

  const jsonBuffer = Buffer.from(JSON.stringify(payload), 'utf8');
  const buffer = compressGzip ? zlib.gzipSync(jsonBuffer, { level: 6 }) : jsonBuffer;
  const sha256Hash = crypto.createHash('sha256').update(buffer).digest('hex');

  const stamp = new Date()
    .toISOString()
    .replace(/[:.]/g, '-')
    .replace('T', '_')
    .slice(0, 19);
  const prefix = (options?.fileNamePrefix || 'financepro_full_backup').replace(/[^a-zA-Z0-9_-]/g, '_');
  const ext = compressGzip ? 'fpbackup.json.gz' : 'fpbackup.json';
  const fileName = `${prefix}_${stamp}.${ext}`;
  const mimeType = compressGzip ? 'application/gzip' : 'application/json';

  let localVaultSha256 = '';
  let localVaultUri = '';
  if (saveToLocalVault) {
    const stored = await putBucketObject(buffer, {
      folderPath: 'bucketdainvicta/GOVERNANCE/BACKUPS',
      mimeType,
      originalName: fileName,
    });
    localVaultSha256 = stored.sha256Hash;
    localVaultUri = stored.storageUri;
  }

  return {
    fileName,
    mimeType,
    compressed: compressGzip,
    buffer,
    sizeBytes: buffer.length,
    sha256Hash,
    totalTables: tableOrder.length,
    totalRows,
    usersCount,
    userGroupsCount,
    tableRowCounts,
    localVaultSha256,
    localVaultUri,
  };
}

export function decodeBackupBuffer(rawBuffer: Buffer): FullDatabaseBackupPayload {
  let text: string;
  // Check gzip magic bytes 0x1f 0x8b
  if (rawBuffer.length >= 2 && rawBuffer[0] === 0x1f && rawBuffer[1] === 0x8b) {
    text = zlib.gunzipSync(rawBuffer).toString('utf8');
  } else {
    text = rawBuffer.toString('utf8');
  }

  const parsed = JSON.parse(text) as FullDatabaseBackupPayload;
  if (!parsed || parsed.format !== 'financepro-full-db-backup' || !parsed.tables || !Array.isArray(parsed.tableOrder)) {
    throw new Error('Arquivo de backup inválido ou incompatível com o formato FinancePro.');
  }
  return parsed;
}

export async function inspectBackupBuffer(rawBuffer: Buffer): Promise<{
  payload: FullDatabaseBackupPayload;
  inspection: BackupInspectionResult;
}> {
  const payload = decodeBackupBuffer(rawBuffer);
  const canonicalData = JSON.stringify({ tableOrder: payload.tableOrder, tables: payload.tables });
  const computedChecksum = crypto.createHash('sha256').update(canonicalData, 'utf8').digest('hex');
  const checksumValid = Boolean(payload.checksumSha256 && payload.checksumSha256 === computedChecksum);

  const existingTables = new Set(await getPublicBaseTables());
  const missingInTargetSchema = payload.tableOrder.filter((t) => !existingTables.has(t));

  const tableRowCounts: Record<string, number> = {};
  let totalRows = 0;
  for (const t of payload.tableOrder) {
    const count = Array.isArray(payload.tables[t]) ? payload.tables[t].length : 0;
    tableRowCounts[t] = count;
    totalRows += count;
  }

  const usersCount = tableRowCounts.users || 0;
  const userGroupsCount = tableRowCounts.user_groups || 0;

  const warnings: string[] = [];
  if (!checksumValid) {
    warnings.push('O checksum SHA-256 interno do backup não confere. O arquivo pode ter sido alterado.');
  }
  if (missingInTargetSchema.length > 0) {
    warnings.push(`Tabelas ausentes no schema atual (serão ignoradas): ${missingInTargetSchema.join(', ')}`);
  }
  if (!payload.includesUsersAndGroups || (usersCount === 0 && userGroupsCount === 0)) {
    warnings.push('Este backup não contém registros de usuários ou grupos RBAC.');
  }

  return {
    payload,
    inspection: {
      valid: checksumValid && payload.tableOrder.length > 0,
      format: payload.format,
      version: payload.version,
      createdAt: payload.createdAt,
      createdBy: payload.createdBy,
      databaseName: payload.databaseName,
      includesUsersAndGroups: payload.includesUsersAndGroups,
      includesAuditLogs: payload.includesAuditLogs,
      checksumValid,
      checksumSha256: payload.checksumSha256,
      totalTables: payload.tableOrder.length,
      totalRows,
      usersCount,
      userGroupsCount,
      tableRowCounts,
      missingInTargetSchema,
      warnings,
    },
  };
}

function buildInsertSqlAndParams(
  tableName: string,
  cols: string[],
  rows: Array<Record<string, unknown>>,
  colMeta: Record<string, ColumnTypeMeta>
): { sql: string; values: unknown[] } {
  const values: unknown[] = [];
  const rowPlaceholders: string[] = [];
  let paramIdx = 1;

  for (const row of rows) {
    const colPlaceholders: string[] = [];
    for (const col of cols) {
      const meta = colMeta[col];
      const rawVal = row[col] === undefined ? null : row[col];

      if (rawVal !== null && typeof rawVal === 'object' && '__fpByteaBase64' in (rawVal as Record<string, unknown>)) {
        const b64 = String((rawVal as { __fpByteaBase64: string }).__fpByteaBase64 || '');
        values.push(Buffer.from(b64, 'base64'));
        colPlaceholders.push(`$${paramIdx++}`);
      } else if (meta && (meta.udtName === 'jsonb' || meta.udtName === 'json')) {
        values.push(rawVal === null ? null : JSON.stringify(rawVal));
        colPlaceholders.push(`$${paramIdx++}::${meta.udtName}`);
      } else {
        values.push(rawVal);
        colPlaceholders.push(`$${paramIdx++}`);
      }
    }
    rowPlaceholders.push(`(${colPlaceholders.join(', ')})`);
  }

  const colList = cols.map(quoteIdent).join(', ');
  const sql = `INSERT INTO ${quoteIdent(tableName)} (${colList}) VALUES ${rowPlaceholders.join(', ')};`;
  return { sql, values };
}

export async function restoreFullDatabaseBackup(
  rawBuffer: Buffer,
  options: {
    actorName: string;
    actorUserId?: number | null;
    restoreUsersAndGroups?: boolean;
    preserveBackupConfig?: boolean;
  }
): Promise<{
  restoredTables: number;
  restoredRows: number;
  usersRestored: number;
  userGroupsRestored: number;
  preRestoreSnapshotFileName: string;
  preRestoreSnapshotSha256: string;
  preRestoreSnapshotUri: string;
  warnings: string[];
}> {
  const restoreUsersAndGroups = options.restoreUsersAndGroups !== false;
  const preserveBackupConfig = options.preserveBackupConfig !== false;

  const { payload, inspection } = await inspectBackupBuffer(rawBuffer);
  if (!inspection.checksumValid) {
    throw new Error('Restauração abortada: falha na verificação de integridade SHA-256 do arquivo de backup.');
  }

  // 1. Automatic pre-restore safety snapshot before altering any table
  const safetySnapshot = await createFullDatabaseBackup({
    createdBy: `${options.actorName} (Pré-Restore Automático)`,
    includeUsersAndGroups: true,
    includeAuditLogs: true,
    compressGzip: true,
    saveToLocalVault: true,
    fileNamePrefix: 'financepro_pre_restore_snapshot',
  });

  const currentTables = await getPublicBaseTables();
  const currentTableSet = new Set(currentTables);
  const currentColumnsByTable = await getColumnsMetadataByTable();
  const currentTopoOrder = await resolveTopologicalTableOrder(currentTables);

  // Preserve backup_schedules / backup_executions and optionally users/user_groups if requested
  const client = await pool.connect();
  try {
    let preservedSchedules: Array<Record<string, unknown>> = [];
    let preservedExecutions: Array<Record<string, unknown>> = [];
    let preservedGroups: Array<Record<string, unknown>> = [];
    let preservedUsers: Array<Record<string, unknown>> = [];

    if (preserveBackupConfig) {
      if (currentTableSet.has('backup_schedules')) {
        preservedSchedules = (await client.query('SELECT * FROM "backup_schedules" ORDER BY id ASC')).rows;
      }
      if (currentTableSet.has('backup_executions')) {
        preservedExecutions = (await client.query('SELECT * FROM "backup_executions" ORDER BY id ASC')).rows;
      }
    }

    if (!restoreUsersAndGroups) {
      if (currentTableSet.has('user_groups')) {
        preservedGroups = (await client.query('SELECT * FROM "user_groups" ORDER BY id ASC')).rows;
      }
      if (currentTableSet.has('users')) {
        preservedUsers = (await client.query('SELECT * FROM "users" ORDER BY id ASC')).rows;
      }
    }

    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.audit_skip', '1', true);`);

    // Delete in reverse topological order (children before parents) using DELETE FROM
    // so non-owner Cloud SQL runtime roles (which lack TRUNCATE privilege) can restore cleanly.
    const deleteOrder = [...currentTopoOrder].reverse();
    if (deleteOrder.length > 0) {
      const deleteStatements = deleteOrder.map((t) => `DELETE FROM ${quoteIdent(t)};`).join('\n        ');
      await client.query(`DO $$\n      BEGIN\n        ${deleteStatements}\n      END $$;`);
    }

    // Build insertion order: prefer current DB topological order intersected with backup tables
    const backupTableSet = new Set(payload.tableOrder);
    const insertOrder = currentTopoOrder.filter((t) => backupTableSet.has(t));

    let restoredTables = 0;
    let restoredRows = 0;
    let usersRestored = 0;
    let userGroupsRestored = 0;

    for (const tableName of insertOrder) {
      if (preserveBackupConfig && (tableName === 'backup_schedules' || tableName === 'backup_executions')) {
        continue;
      }
      if (!restoreUsersAndGroups && (tableName === 'users' || tableName === 'user_groups')) {
        continue;
      }

      const rows = Array.isArray(payload.tables[tableName]) ? payload.tables[tableName] : [];
      const colMeta = currentColumnsByTable[tableName] || {};
      const validCols = Object.keys(colMeta);
      if (validCols.length === 0) continue;

      restoredTables++;
      if (rows.length === 0) continue;

      // Keep only columns that exist in current DB table
      const sampleKeys = Object.keys(rows[0] || {});
      const cols = sampleKeys.filter((c) => c in colMeta);
      if (cols.length === 0) continue;

      const maxRowsPerBatch = Math.max(1, Math.min(200, Math.floor(25000 / cols.length)));
      for (let i = 0; i < rows.length; i += maxRowsPerBatch) {
        const chunk = rows.slice(i, i + maxRowsPerBatch);
        const { sql, values } = buildInsertSqlAndParams(tableName, cols, chunk, colMeta);
        await client.query(sql, values);
      }

      restoredRows += rows.length;
      if (tableName === 'users') usersRestored = rows.length;
      if (tableName === 'user_groups') userGroupsRestored = rows.length;
    }

    // Re-insert preserved user_groups & users if restoreUsersAndGroups === false
    if (!restoreUsersAndGroups) {
      const restoredUnitsRes = await client.query<{ id: number }>('SELECT id FROM "units" ORDER BY id ASC');
      const unitIds = new Set(restoredUnitsRes.rows.map((r) => r.id));
      const fallbackUnitId = restoredUnitsRes.rows[0]?.id ?? null;

      if (preservedGroups.length > 0 && currentColumnsByTable.user_groups) {
        const cols = Object.keys(currentColumnsByTable.user_groups);
        const { sql, values } = buildInsertSqlAndParams('user_groups', cols, preservedGroups, currentColumnsByTable.user_groups);
        await client.query(sql, values);
        userGroupsRestored = preservedGroups.length;
      }
      if (preservedUsers.length > 0 && currentColumnsByTable.users) {
        const groupIdsRes = await client.query<{ id: number }>('SELECT id FROM "user_groups"');
        const validGroupIds = new Set(groupIdsRes.rows.map((r) => r.id));
        const sanitizedUsers = preservedUsers.map((u) => ({
          ...u,
          group_id: u.group_id && validGroupIds.has(Number(u.group_id)) ? u.group_id : null,
          default_unit_id:
            u.default_unit_id && unitIds.has(Number(u.default_unit_id)) ? u.default_unit_id : fallbackUnitId,
        }));
        const cols = Object.keys(currentColumnsByTable.users);
        const { sql, values } = buildInsertSqlAndParams('users', cols, sanitizedUsers, currentColumnsByTable.users);
        await client.query(sql, values);
        usersRestored = sanitizedUsers.length;
      }
    }

    // Re-insert preserved backup_schedules & backup_executions if preserveBackupConfig === true
    if (preserveBackupConfig) {
      const validUsersRes = await client.query<{ id: number }>('SELECT id FROM "users"');
      const validUserIds = new Set(validUsersRes.rows.map((r) => r.id));

      if (preservedSchedules.length > 0 && currentColumnsByTable.backup_schedules) {
        const sanitizedSchedules = preservedSchedules.map((s) => ({
          ...s,
          created_by_user_id:
            s.created_by_user_id && validUserIds.has(Number(s.created_by_user_id))
              ? s.created_by_user_id
              : null,
        }));
        const cols = Object.keys(currentColumnsByTable.backup_schedules);
        const { sql, values } = buildInsertSqlAndParams(
          'backup_schedules',
          cols,
          sanitizedSchedules,
          currentColumnsByTable.backup_schedules
        );
        await client.query(sql, values);
      }

      if (preservedExecutions.length > 0 && currentColumnsByTable.backup_executions) {
        const validSchedsRes = await client.query<{ id: number }>('SELECT id FROM "backup_schedules"');
        const validSchedIds = new Set(validSchedsRes.rows.map((r) => r.id));
        const sanitizedExecs = preservedExecutions.map((e) => ({
          ...e,
          schedule_id:
            e.schedule_id && validSchedIds.has(Number(e.schedule_id)) ? e.schedule_id : null,
          executed_by_user_id:
            e.executed_by_user_id && validUserIds.has(Number(e.executed_by_user_id))
              ? e.executed_by_user_id
              : null,
        }));
        const cols = Object.keys(currentColumnsByTable.backup_executions);
        const { sql, values } = buildInsertSqlAndParams(
          'backup_executions',
          cols,
          sanitizedExecs,
          currentColumnsByTable.backup_executions
        );
        await client.query(sql, values);
      }
    }

    // Reset all serial/identity sequences across public schema in a single server-side block
    await client.query(`
      DO $$
      DECLARE
        rec RECORD;
        max_val BIGINT;
      BEGIN
        FOR rec IN
          SELECT
            table_name,
            column_name,
            pg_get_serial_sequence(quote_ident(table_schema) || '.' || quote_ident(table_name), column_name) AS seq_name
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND pg_get_serial_sequence(quote_ident(table_schema) || '.' || quote_ident(table_name), column_name) IS NOT NULL
        LOOP
          EXECUTE format('SELECT COALESCE(MAX(%I), 0) FROM %I', rec.column_name, rec.table_name) INTO max_val;
          IF max_val > 0 THEN
            PERFORM setval(rec.seq_name, max_val, true);
          ELSE
            PERFORM setval(rec.seq_name, 1, false);
          END IF;
        END LOOP;
      END $$;
    `);

    await client.query('COMMIT');

    return {
      restoredTables,
      restoredRows,
      usersRestored,
      userGroupsRestored,
      preRestoreSnapshotFileName: safetySnapshot.fileName,
      preRestoreSnapshotSha256: safetySnapshot.sha256Hash,
      preRestoreSnapshotUri: safetySnapshot.localVaultUri,
      warnings: inspection.warnings,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
