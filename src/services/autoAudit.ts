import type { NextFunction, Request, Response } from 'express';
import { Pool } from 'pg';
import { pool } from '../db/index.ts';
import {
  auditContextStorage,
  type AuditRequestContext,
  markManualAuditLogged,
} from '../utils/auditContext.ts';
import { humanizeFieldLabel } from '../utils/auditDiff.ts';

let initializedPromise: Promise<void> | null = null;

type QueryExecutor = { query: Pool['query'] };

export async function attachMissingAutoAuditTriggers(executor: QueryExecutor = pool): Promise<number> {
  const res = await executor.query<{ tablename: string }>(
    `SELECT t.tablename
     FROM pg_tables t
     WHERE t.schemaname = 'public'
       AND t.tablename <> 'audit_logs'
       AND NOT EXISTS (
         SELECT 1
         FROM pg_trigger tr
         JOIN pg_class c ON c.oid = tr.tgrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public'
           AND c.relname = t.tablename
           AND tr.tgname = 'trg_fp_auto_audit'
           AND NOT tr.tgisinternal
       )
     ORDER BY t.tablename`
  );

  let attachedCount = 0;
  for (const row of res.rows) {
    const safeName = row.tablename.replace(/"/g, '""');
    await executor.query(
      `DROP TRIGGER IF EXISTS trg_fp_auto_audit ON public."${safeName}";
       CREATE TRIGGER trg_fp_auto_audit
       AFTER INSERT OR UPDATE OR DELETE ON public."${safeName}"
       FOR EACH ROW EXECUTE FUNCTION public.fn_financepro_auto_audit();`
    );
    attachedCount += 1;
  }
  return attachedCount;
}

export async function ensureSecuritySchemaAndAutoAudit(): Promise<void> {
  if (initializedPromise) return initializedPromise;

  initializedPromise = (async () => {
    const adminUser = process.env.SQL_ADMIN_USER;
    const adminPassword = process.env.SQL_ADMIN_PASSWORD;
    let adminPool: Pool | null = null;
    const exec: QueryExecutor =
      adminUser && adminPassword
        ? (adminPool = new Pool({
            host: process.env.SQL_HOST,
            user: adminUser,
            password: adminPassword,
            database: process.env.SQL_DB_NAME,
            max: 2,
            connectionTimeoutMillis: 15000,
          }))
        : pool;

    try {
      // 1. Idempotent DDL for User Suspension & Work Schedules Multi-Scope + 15m Warning
      await exec.query(`
        ALTER TABLE public.users
          ADD COLUMN IF NOT EXISTS suspended boolean NOT NULL DEFAULT false,
          ADD COLUMN IF NOT EXISTS suspended_reason text NOT NULL DEFAULT '',
          ADD COLUMN IF NOT EXISTS suspended_at timestamp without time zone,
          ADD COLUMN IF NOT EXISTS suspended_by text NOT NULL DEFAULT '';

        ALTER TABLE public.work_schedules
          ADD COLUMN IF NOT EXISTS unit_id integer,
          ADD COLUMN IF NOT EXISTS group_id integer,
          ADD COLUMN IF NOT EXISTS closing_warning_message text NOT NULL DEFAULT '';
      `);

      // 2. Helper value formatter for PostgreSQL field-level audit diffs (masks secrets cleanly)
      await exec.query(`
      CREATE OR REPLACE FUNCTION public.fn_fp_audit_fmt(val jsonb, col_name text)
      RETURNS text
      LANGUAGE plpgsql
      IMMUTABLE
      AS $$
      DECLARE
        v_col text := lower(coalesce(col_name, ''));
        v_type text;
        v_txt text;
      BEGIN
        IF v_col IN (
          'password',
          'password_hash',
          'temp_password',
          'uazapi_token_encrypted',
          'agent_session_token_hash',
          'api_key',
          'client_secret'
        ) OR v_col LIKE '%password%' OR v_col LIKE '%secret%' OR v_col LIKE '%token_encrypted%' THEN
          RETURN '[PROTEGIDO]';
        END IF;

        IF val IS NULL THEN
          RETURN '—';
        END IF;

        v_type := jsonb_typeof(val);
        IF v_type = 'null' THEN
          RETURN '—';
        ELSIF v_type = 'boolean' THEN
          RETURN CASE WHEN (val #>> '{}') = 'true' THEN 'Sim' ELSE 'Não' END;
        ELSIF v_type = 'string' THEN
          v_txt := btrim(val #>> '{}');
          IF v_txt = '' THEN
            RETURN '—';
          END IF;
          RETURN left(v_txt, 500);
        ELSE
          RETURN left(val::text, 500);
        END IF;
      END;
      $$;
    `);

    // 3. Universal PostgreSQL trigger for ALL current & future tables
    await exec.query(`
      CREATE OR REPLACE FUNCTION public.fn_financepro_auto_audit()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      DECLARE
        v_skip text;
        v_user_id integer;
        v_user_name text;
        v_unit_id integer;
        v_route text;
        v_old jsonb;
        v_new jsonb;
        v_ref jsonb;
        v_key text;
        v_prev_txt text;
        v_next_txt text;
        v_changes jsonb := '[]'::jsonb;
        v_entity_id text;
      BEGIN
        v_skip := current_setting('app.audit_skip', true);
        IF v_skip = '1' OR TG_TABLE_NAME = 'audit_logs' THEN
          RETURN NULL;
        END IF;

        BEGIN
          v_user_id := NULLIF(current_setting('app.audit_user_id', true), '')::integer;
        EXCEPTION WHEN OTHERS THEN
          v_user_id := NULL;
        END;

        v_user_name := COALESCE(NULLIF(current_setting('app.audit_user_name', true), ''), 'Sistema');

        BEGIN
          v_unit_id := NULLIF(current_setting('app.audit_unit_id', true), '')::integer;
        EXCEPTION WHEN OTHERS THEN
          v_unit_id := NULL;
        END;

        v_route := NULLIF(current_setting('app.audit_route', true), '');

        IF TG_OP = 'UPDATE' THEN
          v_old := to_jsonb(OLD);
          v_new := to_jsonb(NEW);
          v_ref := v_new;

          IF (v_old - 'updated_at') IS NOT DISTINCT FROM (v_new - 'updated_at') THEN
            RETURN NULL;
          END IF;

          FOR v_key IN
            SELECT k FROM (
              SELECT jsonb_object_keys(v_old) AS k
              UNION
              SELECT jsonb_object_keys(v_new) AS k
            ) keys_union
          LOOP
            IF v_key = 'updated_at' THEN
              CONTINUE;
            END IF;
            IF (v_old -> v_key) IS DISTINCT FROM (v_new -> v_key) THEN
              v_prev_txt := public.fn_fp_audit_fmt(v_old -> v_key, v_key);
              v_next_txt := public.fn_fp_audit_fmt(v_new -> v_key, v_key);
              v_changes := v_changes || jsonb_build_array(
                jsonb_build_object(
                  'field', v_key,
                  'previousValue', v_prev_txt,
                  'newValue', v_next_txt,
                  'from', v_prev_txt,
                  'to', v_next_txt
                )
              );
            END IF;
          END LOOP;

          IF jsonb_array_length(v_changes) = 0 THEN
            RETURN NULL;
          END IF;

        ELSIF TG_OP = 'INSERT' THEN
          v_new := to_jsonb(NEW);
          v_ref := v_new;

          FOR v_key IN SELECT jsonb_object_keys(v_new)
          LOOP
            v_next_txt := public.fn_fp_audit_fmt(v_new -> v_key, v_key);
            IF v_next_txt = '—' THEN
              CONTINUE;
            END IF;
            v_changes := v_changes || jsonb_build_array(
              jsonb_build_object(
                'field', v_key,
                'previousValue', '— (Novo registro)',
                'newValue', v_next_txt,
                'from', '— (Novo registro)',
                'to', v_next_txt
              )
            );
          END LOOP;

        ELSIF TG_OP = 'DELETE' THEN
          v_old := to_jsonb(OLD);
          v_ref := v_old;

          FOR v_key IN SELECT jsonb_object_keys(v_old)
          LOOP
            v_prev_txt := public.fn_fp_audit_fmt(v_old -> v_key, v_key);
            IF v_prev_txt = '—' THEN
              CONTINUE;
            END IF;
            v_changes := v_changes || jsonb_build_array(
              jsonb_build_object(
                'field', v_key,
                'previousValue', v_prev_txt,
                'newValue', '— (Registro removido)',
                'from', v_prev_txt,
                'to', '— (Registro removido)'
              )
            );
          END LOOP;
        END IF;

        v_entity_id := COALESCE(
          NULLIF(v_ref ->> 'id', ''),
          NULLIF(v_ref ->> 'key', ''),
          NULLIF(v_ref ->> 'code', ''),
          NULLIF(v_ref ->> 'uid', ''),
          '0'
        );

        IF v_unit_id IS NULL THEN
          BEGIN
            v_unit_id := COALESCE(
              NULLIF(v_ref ->> 'unit_id', '')::integer,
              NULLIF(v_ref ->> 'default_unit_id', '')::integer
            );
          EXCEPTION WHEN OTHERS THEN
            v_unit_id := NULL;
          END;
        END IF;

        INSERT INTO public.audit_logs (
          user_id,
          user_name,
          action,
          entity_type,
          entity_id,
          details,
          unit_id,
          created_at
        ) VALUES (
          v_user_id,
          v_user_name,
          'AUTO_' || TG_OP,
          TG_TABLE_NAME,
          v_entity_id,
          jsonb_build_object(
            'autoAudit', true,
            'tableName', TG_TABLE_NAME,
            'operation', TG_OP,
            'route', v_route,
            'changes', v_changes
          ),
          v_unit_id,
          now()
        );

        RETURN NULL;
      END;
      $$;
    `);

      // 4. Attach triggers to ALL existing tables in public schema
      await attachMissingAutoAuditTriggers(exec);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/must be owner|permission denied|42501/i.test(msg)) {
        console.warn('AutoAudit DDL skipped for non-owner role (schema already managed via Drizzle):', msg);
        return;
      }
      throw err;
    } finally {
      if (adminPool) {
        await adminPool.end().catch(() => {});
      }
    }
  })().catch((err) => {
    initializedPromise = null;
    throw err;
  });

  return initializedPromise;
}

const IGNORED_FALLBACK_ROUTES_RE =
  /^\/api\/(health|auth\/captcha|auth\/schedule-status|public\/|audit|cadastros\/audit)/i;

export function autoAuditRequestMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!req.path.startsWith('/api/')) {
    return next();
  }

  const headerUnitRaw = req.headers['x-unit-id'];
  const parsedUnit =
    headerUnitRaw && !Number.isNaN(Number(headerUnitRaw)) ? Number(headerUnitRaw) : null;

  const ctx: AuditRequestContext = {
    userId: null,
    userName: 'Visitante / Sistema',
    unitId: parsedUnit,
    route: req.path,
    method: req.method,
    dbMutationsCount: 0,
    manualAuditLogged: false,
  };

  res.on('finish', () => {
    const isMutatingMethod = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method.toUpperCase());
    if (
      isMutatingMethod &&
      res.statusCode >= 200 &&
      res.statusCode < 300 &&
      ctx.dbMutationsCount === 0 &&
      !ctx.manualAuditLogged &&
      !IGNORED_FALLBACK_ROUTES_RE.test(req.path) &&
      ctx.userId !== null
    ) {
      // Automatic fallback audit for any current or future API routine that succeeds without direct table writes
      const segments = req.path.replace(/^\/api\//, '').split('/').filter(Boolean);
      const entityType = segments[0] || 'api_routine';
      const entityId = segments.find((s) => /^\d+$/.test(s)) || segments[1] || '0';
      const bodyKeys =
        req.body && typeof req.body === 'object' && !Array.isArray(req.body)
          ? Object.entries(req.body as Record<string, unknown>)
              .slice(0, 12)
              .map(([k, v]) => ({
                field: k,
                label: humanizeFieldLabel(k),
                previousValue: '—',
                newValue:
                  k.toLowerCase().includes('password') || k.toLowerCase().includes('secret')
                    ? '[PROTEGIDO]'
                    : typeof v === 'object'
                    ? JSON.stringify(v).slice(0, 200)
                    : String(v ?? '—').slice(0, 200),
                from: '—',
                to:
                  k.toLowerCase().includes('password') || k.toLowerCase().includes('secret')
                    ? '[PROTEGIDO]'
                    : typeof v === 'object'
                    ? JSON.stringify(v).slice(0, 200)
                    : String(v ?? '—').slice(0, 200),
              }))
          : [];

      markManualAuditLogged();
      pool
        .query(
          `INSERT INTO public.audit_logs (user_id, user_name, action, entity_type, entity_id, details, unit_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            ctx.userId,
            ctx.userName,
            `AUTO_API_${req.method.toUpperCase()}`,
            entityType,
            entityId,
            JSON.stringify({
              autoAudit: true,
              route: req.path,
              method: req.method,
              changes: bodyKeys,
            }),
            ctx.unitId,
          ]
        )
        .catch(() => {});
    }
  });

  auditContextStorage.run(ctx, () => next());
}
