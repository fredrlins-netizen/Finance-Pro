import { drizzle } from 'drizzle-orm/node-postgres';
import { Client, Pool, type PoolClient, type QueryConfig, type QueryResult } from 'pg';
import * as schema from './schema.ts';
import { auditContextStorage } from '../utils/auditContext.ts';

declare global {
  var _postgresPool: Pool | undefined;
}

const MUTATING_SQL_RE = /^\s*(INSERT|UPDATE|DELETE|WITH|MERGE)\b/i;
const CONTROL_OR_AUDIT_SQL_RE =
  /^\s*(BEGIN|START\s+TRANSACTION|COMMIT|ROLLBACK|SAVEPOINT|RELEASE|SET\b|SELECT\s+set_config|SHOW\b)/i;
const AUDIT_TABLE_TARGET_RE = /\bINTO\s+(?:"?public"?\.)?"?audit_logs"?\b/i;

function extractSqlText(queryTextOrConfig: string | QueryConfig): string {
  if (typeof queryTextOrConfig === 'string') return queryTextOrConfig;
  if (queryTextOrConfig && typeof queryTextOrConfig.text === 'string') return queryTextOrConfig.text;
  return '';
}

function isTrackableMutation(sqlText: string): boolean {
  if (!sqlText) return false;
  if (CONTROL_OR_AUDIT_SQL_RE.test(sqlText)) return false;
  if (AUDIT_TABLE_TARGET_RE.test(sqlText)) return false;
  return MUTATING_SQL_RE.test(sqlText);
}

function attachAuditPoolHooks(pool: Pool) {
  const txStateMap = new WeakMap<PoolClient, { inTx: boolean; txConfigured: boolean }>();
  const hookedClients = new WeakSet<PoolClient>();

  const getState = (client: PoolClient) => {
    let st = txStateMap.get(client);
    if (!st) {
      st = { inTx: false, txConfigured: false };
      txStateMap.set(client, st);
    }
    return st;
  };

  pool.on('acquire', (client: PoolClient) => {
    txStateMap.set(client, { inTx: false, txConfigured: false });
  });

  pool.on('release', (_err: Error | undefined, client: PoolClient) => {
    txStateMap.set(client, { inTx: false, txConfigured: false });
  });

  pool.on('connect', (client: PoolClient) => {
    if (hookedClients.has(client)) return;
    hookedClients.add(client);

    // Prevent Node.js crash ("Unhandled 'error' event") if backend drops connection while checked out
    client.on('error', (err) => {
      console.error('SQL PoolClient error:', err?.message || err);
    });

    const origClientQuery = client.query.bind(client) as (...args: unknown[]) => unknown;

    const applySessionAuditSettings = async () => {
      const ctx = auditContextStorage.getStore();
      if (!ctx) return;
      await (origClientQuery(
        `SELECT
          set_config('app.audit_user_id', $1, true),
          set_config('app.audit_user_name', $2, true),
          set_config('app.audit_unit_id', $3, true),
          set_config('app.audit_route', $4, true)`,
        [
          ctx.userId !== null && ctx.userId !== undefined ? String(ctx.userId) : '',
          ctx.userName || 'Sistema',
          ctx.unitId !== null && ctx.unitId !== undefined ? String(ctx.unitId) : '',
          `${ctx.method || ''} ${ctx.route || ''}`.trim(),
        ]
      ) as Promise<QueryResult>);
    };

    const runPromised = async (argsWithoutCb: unknown[], sqlText: string): Promise<QueryResult> => {
      const state = getState(client);
      const ctx = auditContextStorage.getStore();

      if (/^\s*(BEGIN|START\s+TRANSACTION)\b/i.test(sqlText)) {
        state.inTx = true;
        state.txConfigured = false;
        const res = await (origClientQuery(...argsWithoutCb) as Promise<QueryResult>);
        if (ctx) {
          await applySessionAuditSettings();
          state.txConfigured = true;
        }
        return res;
      }

      if (/^\s*(COMMIT|ROLLBACK)\b/i.test(sqlText)) {
        state.inTx = false;
        state.txConfigured = false;
        return (await origClientQuery(...argsWithoutCb)) as QueryResult;
      }

      if (ctx && isTrackableMutation(sqlText)) {
        ctx.dbMutationsCount += 1;
        if (state.inTx) {
          if (!state.txConfigured) {
            await applySessionAuditSettings();
            state.txConfigured = true;
          }
          return (await origClientQuery(...argsWithoutCb)) as QueryResult;
        }

        await (origClientQuery('BEGIN') as Promise<unknown>);
        try {
          await applySessionAuditSettings();
          const res = await (origClientQuery(...argsWithoutCb) as Promise<QueryResult>);
          await (origClientQuery('COMMIT') as Promise<unknown>);
          return res;
        } catch (err) {
          await (origClientQuery('ROLLBACK') as Promise<unknown>).catch(() => {});
          throw err;
        }
      }

      return (await origClientQuery(...argsWithoutCb)) as QueryResult;
    };

    (client as unknown as { query: (...args: unknown[]) => unknown }).query = (...args: unknown[]) => {
      const firstArg = args[0] as (string | QueryConfig) & { submit?: unknown };
      // Preserve Submittable Query objects directly
      if (firstArg && typeof firstArg === 'object' && typeof firstArg.submit === 'function') {
        return origClientQuery(...args);
      }

      const sqlText = extractSqlText(firstArg);
      const ctx = auditContextStorage.getStore();
      const state = getState(client);

      const needsAuditHook =
        /^\s*(BEGIN|START\s+TRANSACTION|COMMIT|ROLLBACK)\b/i.test(sqlText) ||
        (Boolean(ctx) && isTrackableMutation(sqlText));

      if (!needsAuditHook && state.inTx === false) {
        return origClientQuery(...args);
      }

      const lastArg = args[args.length - 1];
      if (typeof lastArg === 'function') {
        const cb = lastArg as (err: unknown, res?: QueryResult) => void;
        const argsWithoutCb = args.slice(0, -1);
        runPromised(argsWithoutCb, sqlText).then(
          (res) => cb(undefined, res),
          (err) => cb(err)
        );
        return;
      }

      return runPromised(args, sqlText);
    };
  });
}

export const createPool = () => {
  if (!global._postgresPool) {
    const instance = new Pool({
      host: process.env.SQL_HOST,
      user: process.env.SQL_USER,
      password: process.env.SQL_PASSWORD,
      database: process.env.SQL_DB_NAME,
      max: 10,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 12000,
      keepAlive: true,
    });

    instance.on('error', (err) => {
      console.error('Unexpected error on idle SQL pool client:', err);
    });

    attachAuditPoolHooks(instance);
    global._postgresPool = instance;
  }
  return global._postgresPool;
};

export async function probeDatabaseHealth(timeoutMs = 3500): Promise<boolean> {
  const client = new Client({
    host: process.env.SQL_HOST,
    user: process.env.SQL_USER,
    password: process.env.SQL_PASSWORD,
    database: process.env.SQL_DB_NAME,
    connectionTimeoutMillis: timeoutMs,
  });
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      (async () => {
        await client.connect();
        await client.query('SELECT 1');
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('SQL health probe timeout')), timeoutMs + 500);
      }),
    ]);
    return true;
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
    await client.end().catch(() => {});
  }
}

export function isTransientSqlError(err: unknown): boolean {
  const seen = new Set<unknown>();
  let cur: unknown = err;
  while (cur && typeof cur === 'object' && !seen.has(cur)) {
    seen.add(cur);
    const rec = cur as { message?: unknown; code?: unknown; cause?: unknown };
    const text = `${String(rec.message || '')} ${String(rec.code || '')}`;
    if (
      /connection terminated|timeout expired|econnrefused|enoent|etimedout|epipe|57p01|terminating connection|socket hang up/i.test(
        text
      )
    ) {
      return true;
    }
    cur = rec.cause;
  }
  return false;
}

const pool = createPool();

export const db = drizzle(pool, { schema });
export { pool };
