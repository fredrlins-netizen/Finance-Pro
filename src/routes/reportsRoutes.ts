import type { Express, Response } from 'express';
import { asc, eq } from 'drizzle-orm';
import { db, pool } from '../db/index.ts';
import { auditLogs, reportTemplates, userGroups, users } from '../db/schema.ts';
import { EMBEDDED_REPORT_TEMPLATES } from '../lib/reportCatalogs.ts';
import { requireAdmin, requireAuth, requireModule, type AuthRequest } from '../middleware/auth.ts';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUuid(id: string): boolean {
  return UUID_REGEX.test(String(id || '').trim());
}

/**
 * Strip single-line and block SQL comments so keyword checks analyze executable SQL tokens.
 */
function stripSqlComments(raw: string): string {
  return raw
    .replace(/--[^\n\r]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .trim();
}

/**
 * Enforce strict read-only SELECT / WITH validation matching reportSecurity contract.
 */
export function validateReportSql(sqlText: string): string | null {
  if (!sqlText || typeof sqlText !== 'string') {
    return 'A consulta SQL é obrigatória.';
  }
  if (sqlText.length > 100_000) {
    return 'A consulta SQL excede o limite de 100.000 caracteres.';
  }
  const clean = stripSqlComments(sqlText);
  if (!clean) {
    return 'A consulta SQL não pode estar vazia.';
  }

  // Allow optional single trailing semicolon, reject multiple statements
  const withoutTrailingSemi = clean.replace(/;\s*$/, '');
  // Replace single-quoted string literals before checking for stray semicolons
  const withoutStrings = withoutTrailingSemi.replace(/'(?:''|[^'])*'/g, "''");
  if (withoutStrings.includes(';')) {
    return 'Múltiplas instruções SQL separadas por ponto e vírgula não são permitidas.';
  }

  if (!/^(SELECT|WITH)\b/i.test(withoutStrings.trim())) {
    return 'Apenas consultas SELECT ou CTEs (WITH ... SELECT) são permitidas.';
  }

  const forbiddenKeywords =
    /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|GRANT|REVOKE|COPY|EXECUTE|CALL|DO|VACUUM|REINDEX|CLUSTER|LOCK)\b/i;
  if (forbiddenKeywords.test(withoutStrings)) {
    return 'Comandos de escrita ou alteração de schema (INSERT, UPDATE, DELETE, DROP, ALTER, etc.) são proibidos.';
  }

  if (/\bSELECT\b[\s\S]*?\bINTO\b\s+(?:TEMP|TEMPORARY|UNLOGGED)?\s*[a-zA-Z_"]/i.test(withoutStrings)) {
    return 'SELECT INTO não é permitido em relatórios somente leitura.';
  }

  if (/\bFOR\s+(?:UPDATE|NO\s+KEY\s+UPDATE|SHARE|KEY\s+SHARE)\b/i.test(withoutStrings)) {
    return 'Cláusulas de bloqueio de linha (FOR UPDATE/SHARE) não são permitidas.';
  }

  const forbiddenFunctions =
    /\b(nextval|setval|pg_sleep|pg_read_file|pg_read_binary_file|pg_ls_dir|lo_import|lo_export|dblink|dblink_exec|pg_terminate_backend|pg_cancel_backend|pg_advisory_lock|pg_try_advisory_lock)\s*\(/i;
  if (forbiddenFunctions.test(withoutStrings)) {
    return 'Função de sistema restrita não permitida em consultas de relatório.';
  }

  return null;
}

export function validateReportDefinition(body: Record<string, any>): string | null {
  if (body.target_layout !== undefined && !['responsive', 'web', 'mobile'].includes(String(body.target_layout))) {
    return 'target_layout inválido. Use responsive, web ou mobile.';
  }
  if (body.content_mode !== undefined && !['data', 'charts', 'both'].includes(String(body.content_mode))) {
    return 'content_mode inválido. Use data, charts ou both.';
  }

  if (body.filters !== undefined) {
    if (!Array.isArray(body.filters)) return 'filters deve ser uma lista.';
    if (body.filters.length > 50) return 'Máximo de 50 filtros por modelo.';
    const seenIds = new Set<string>();
    for (const f of body.filters) {
      const fid = String(f?.id || '').trim();
      const ph = String(f?.placeholder || '').trim();
      if (!fid || seenIds.has(fid)) return 'Cada filtro precisa de um id único não vazio.';
      seenIds.add(fid);
      if (!ph || !ph.split('.').every((seg) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(seg))) {
        return `Placeholder de filtro inválido: "${ph}".`;
      }
      if (!['text', 'date', 'number', 'select'].includes(String(f?.type))) {
        return `Tipo de filtro inválido: "${String(f?.type)}".`;
      }
    }
  }

  if (body.subreports !== undefined) {
    if (!Array.isArray(body.subreports)) return 'subreports deve ser uma lista.';
    if (body.subreports.length > 25) return 'Máximo de 25 subrelatórios por modelo.';
    for (const sr of body.subreports) {
      if (!String(sr?.id || '').trim()) return 'Todo subrelatório precisa de um id não vazio.';
      if (!['query', 'summary'].includes(String(sr?.type))) return 'Tipo de subrelatório deve ser query ou summary.';
      if (sr.type === 'query') {
        const sqlErr = validateReportSql(String(sr.sql_query || ''));
        if (sqlErr) return `Subrelatório "${sr.title || sr.id}": ${sqlErr}`;
      } else if (!sr.summary_config || typeof sr.summary_config !== 'object') {
        return `Subrelatório "${sr.title || sr.id}" exige summary_config.`;
      }
    }
  }

  if (body.charts !== undefined && (!Array.isArray(body.charts) || body.charts.length > 20)) {
    return 'charts deve ser uma lista com no máximo 20 gráficos.';
  }

  return null;
}

export function wrapReadOnlyQueryWithLimit(sqlText: string, limit: number): string {
  const clean = stripSqlComments(sqlText).replace(/;\s*$/, '');
  return `SELECT * FROM (${clean}) AS _report_result LIMIT ${limit}`;
}

function extractAutoFiltersFromSql(sqlText: string, existingFilters: any[] = []): any[] {
  const existing = Array.isArray(existingFilters) ? [...existingFilters] : [];
  const seen = new Set(existing.map((f) => String(f?.placeholder || '').trim()).filter(Boolean));
  const re = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_.]*)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sqlText)) !== null) {
    const ph = m[1].trim();
    if (ph && !seen.has(ph)) {
      seen.add(ph);
      existing.push({ id: ph, placeholder: ph, type: 'text', defaultValue: '' });
    }
  }
  return existing;
}

export function buildParameterizedQueryServer(
  sqlText: string,
  filters: any[],
  filterValues: Record<string, any> | undefined
): { sql: string; params: any[]; appliedFilterIds: string[] } {
  const vals = filterValues && typeof filterValues === 'object' ? filterValues : {};
  const params: any[] = [];
  const placeholderIdx = new Map<string, number>();
  const appliedFilterIds: string[] = [];
  let out = String(sqlText || '');

  for (const f of Array.isArray(filters) ? filters : []) {
    const ph = String(f?.placeholder || '').trim();
    if (!ph) continue;
    const escaped = ph.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const curlyRegex = new RegExp(`\\{\\{\\s*${escaped}\\s*\\}\\}`, 'g');
    const colonRegex = new RegExp(`(?<!:):${escaped}\\b`, 'g');
    const hasCurly = curlyRegex.test(out);
    const hasColon = !hasCurly && colonRegex.test(out);
    if (!hasCurly && !hasColon) continue;

    if (f?.id) appliedFilterIds.push(String(f.id));
    const rawVal = vals[f.id] !== undefined ? vals[f.id] : vals[ph] !== undefined ? vals[ph] : f.defaultValue ?? '';
    const coerce = () => {
      if (rawVal === null || rawVal === undefined || rawVal === '') return '';
      if (f.type === 'number' && !Number.isNaN(Number(rawVal))) return Number(rawVal);
      return String(rawVal);
    };

    const getRef = () => {
      if (placeholderIdx.has(ph)) return `$${placeholderIdx.get(ph)}`;
      params.push(coerce());
      const idx = params.length;
      placeholderIdx.set(ph, idx);
      return `$${idx}`;
    };

    if (hasCurly) {
      out = out.replace(new RegExp(`\\{\\{\\s*${escaped}\\s*\\}\\}`, 'g'), () => getRef());
    } else if (hasColon) {
      out = out.replace(new RegExp(`(?<!:):${escaped}\\b`, 'g'), () => getRef());
    }
  }

  return { sql: out, params, appliedFilterIds };
}

function mapTemplateRow(row: typeof reportTemplates.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    category: row.category || 'Outros',
    target_layout: row.targetLayout || 'responsive',
    content_mode: row.contentMode || 'both',
    sql_query: row.sqlQuery,
    layout: row.layout || {},
    filters: row.filters || [],
    subreports: row.subreports || [],
    charts: row.charts || [],
    allowed_users: row.allowedUsers ?? null,
    allowed_groups: row.allowedGroups ?? null,
    created_by: row.createdBy ?? null,
    created_at: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    updated_at: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt),
    is_active: row.isActive,
  };
}

function canUserSeeTemplate(
  tpl: typeof reportTemplates.$inferSelect,
  authUser: NonNullable<AuthRequest['authUser']>
): boolean {
  if (!tpl.isActive) return false;
  if (authUser.role === 'admin') return true;
  const usersArr = Array.isArray(tpl.allowedUsers) && tpl.allowedUsers.length > 0 ? tpl.allowedUsers : null;
  const groupsArr = Array.isArray(tpl.allowedGroups) && tpl.allowedGroups.length > 0 ? tpl.allowedGroups : null;
  if (!usersArr && !groupsArr) return true;
  if (usersArr && usersArr.includes(authUser.id)) return true;
  if (groupsArr && authUser.groupId && groupsArr.includes(authUser.groupId)) return true;
  return false;
}

let reportSeedPromise: Promise<void> | null = null;

async function ensureReportTemplatesSeed(): Promise<void> {
  if (reportSeedPromise) return reportSeedPromise;
  reportSeedPromise = (async () => {
    try {
      const existing = await db.select({ id: reportTemplates.id }).from(reportTemplates).limit(1);
      if (existing.length > 0) return;

      await db.insert(reportTemplates).values(
        EMBEDDED_REPORT_TEMPLATES.map((tpl) => ({
          name: tpl.name,
          description: tpl.description,
          category: tpl.category,
          targetLayout: tpl.target_layout,
          contentMode: tpl.content_mode,
          sqlQuery: tpl.sql_query,
          layout: tpl.layout as unknown as Record<string, any>,
          filters: tpl.filters as unknown as any[],
          subreports: tpl.subreports as unknown as any[],
          charts: tpl.charts as unknown as any[],
          allowedUsers: null,
          allowedGroups: null,
          isActive: true,
        }))
      );
    } catch (err) {
      reportSeedPromise = null;
      console.error('ensureReportTemplatesSeed error:', err);
    }
  })();
  return reportSeedPromise;
}

async function runReadOnlySql(sqlText: string, params: any[], maxLimit: number) {
  const wrapped = wrapReadOnlyQueryWithLimit(sqlText, maxLimit + 1);
  const start = Date.now();
  const client = await pool.connect();
  try {
    let result;
    try {
      await client.query('BEGIN READ ONLY');
      await client.query("SET LOCAL statement_timeout = '15s'");
      result = await client.query(wrapped, Array.isArray(params) ? params : []);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    }
    const duration = Date.now() - start;
    const truncated = result.rows.length > maxLimit;
    const rows = result.rows.slice(0, maxLimit);
    const fields = (result.fields || []).map((f) => ({
      name: f.name,
      dataTypeID: f.dataTypeID,
    }));
    const columns = fields.map((f) => f.name);
    return { rows, columns, fields, rowCount: rows.length, limit: maxLimit, truncated, duration };
  } finally {
    client.release();
  }
}

export function registerReportsRoutes(
  app: Express,
  deps: { broadcast: (event: string, payload: unknown) => void }
) {
  // 1. Schema explorer: tables (Admin)
  app.get('/api/reports/schema/tables', requireAuth, requireAdmin, async (_req: AuthRequest, res: Response) => {
    try {
      const result = await pool.query(`
        SELECT table_name, table_type
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type IN ('BASE TABLE', 'VIEW')
        ORDER BY table_name
      `);
      res.json({ tables: result.rows });
    } catch (err) {
      console.error('GET /api/reports/schema/tables error:', err);
      res.status(500).json({ error: 'Erro ao listar tabelas do esquema public.' });
    }
  });

  // 2. Schema explorer: columns of one or more tables (Admin)
  app.get('/api/reports/schema/columns', requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
    const tablesParam = String(req.query.tables || req.query.table || '').trim();
    const tableList = tablesParam
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (tableList.length === 0) {
      return res.status(400).json({ error: 'Parâmetro tables ou table é obrigatório.' });
    }
    try {
      const result = await pool.query(
        `SELECT table_name, column_name, data_type, is_nullable, column_default, ordinal_position,
                character_maximum_length, numeric_precision, numeric_scale
         FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = ANY($1::text[])
         ORDER BY table_name, ordinal_position`,
        [tableList]
      );
      res.json({ columns: result.rows });
    } catch (err) {
      console.error('GET /api/reports/schema/columns error:', err);
      res.status(500).json({ error: 'Erro ao listar colunas das tabelas.' });
    }
  });

  // 3. Schema explorer: foreign keys (Admin)
  app.get('/api/reports/schema/foreign-keys', requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
    const tablesParam = String(req.query.tables || '').trim();
    const tableList = tablesParam
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    try {
      const result = await pool.query(
        tableList.length > 0
          ? `
            SELECT
              tc.table_name AS table_name,
              kcu.column_name AS column_name,
              ccu.table_name AS foreign_table_name,
              ccu.column_name AS foreign_column_name
            FROM information_schema.table_constraints AS tc
            JOIN information_schema.key_column_usage AS kcu
              ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
            JOIN information_schema.constraint_column_usage AS ccu
              ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
            WHERE tc.constraint_type = 'FOREIGN KEY'
              AND tc.table_schema = 'public'
              AND (tc.table_name = ANY($1::text[]) OR ccu.table_name = ANY($1::text[]))
            ORDER BY tc.table_name, kcu.column_name
          `
          : `
            SELECT
              tc.table_name AS table_name,
              kcu.column_name AS column_name,
              ccu.table_name AS foreign_table_name,
              ccu.column_name AS foreign_column_name
            FROM information_schema.table_constraints AS tc
            JOIN information_schema.key_column_usage AS kcu
              ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
            JOIN information_schema.constraint_column_usage AS ccu
              ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
            WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
            ORDER BY tc.table_name, kcu.column_name
          `,
        tableList.length > 0 ? [tableList] : []
      );
      res.json({ foreignKeys: result.rows });
    } catch (err) {
      console.error('GET /api/reports/schema/foreign-keys error:', err);
      res.status(500).json({ error: 'Erro ao listar chaves estrangeiras.' });
    }
  });

  // 4. Preview SQL in builder (Admin only, default 50, max 500)
  app.post('/api/reports/preview-query', requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
    const { sql, params, filters, filterValues, limit } = req.body as {
      sql?: string;
      params?: any[];
      filters?: any[];
      filterValues?: Record<string, any>;
      limit?: number;
    };
    if (!sql || typeof sql !== 'string') {
      return res.status(400).json({ error: 'Consulta SQL é obrigatória.' });
    }
    const sqlErr = validateReportSql(sql);
    if (sqlErr) {
      return res.status(403).json({ error: sqlErr });
    }
    const requestedLimit = Number.parseInt(String(limit ?? ''), 10);
    const maxLimit = Number.isInteger(requestedLimit) ? Math.max(1, Math.min(requestedLimit, 500)) : 50;

    let sqlToRun = sql;
    let paramsToRun: any[] = [];
    if (Array.isArray(params)) {
      paramsToRun = params;
    } else {
      const effectiveFilters = extractAutoFiltersFromSql(sql, filters || []);
      const built = buildParameterizedQueryServer(sql, effectiveFilters, filterValues);
      sqlToRun = built.sql;
      paramsToRun = built.params;
    }

    try {
      const data = await runReadOnlySql(sqlToRun, paramsToRun, maxLimit);
      res.json(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro ao executar pré-visualização.';
      res.status(400).json({ error: msg });
    }
  });

  // 5. Execute report query (Admin can test drafts or saved templates; non-admin executes only authorized stored template/subreport SQL)
  app.post('/api/reports/execute-query', requireAuth, requireModule('reports'), async (req: AuthRequest, res: Response) => {
    const authUser = req.authUser!;
    const isAdmin = authUser.role === 'admin';
    const { sql, params, filters, templateId, subreportId, filterValues, limit } = req.body as {
      sql?: string;
      params?: any[];
      filters?: any[];
      templateId?: string;
      subreportId?: string;
      filterValues?: Record<string, any>;
      limit?: number;
    };

    let sqlToRun = '';
    let paramsToRun: any[] = [];
    let appliedFilterIds: string[] | undefined;

    if (!isAdmin || (templateId && !sql)) {
      if (!templateId || !isValidUuid(templateId)) {
        return res.status(403).json({
          error: 'Apenas administradores podem executar SQL arbitrário. Informe um template autorizado.',
        });
      }
      const [tpl] = await db.select().from(reportTemplates).where(eq(reportTemplates.id, templateId)).limit(1);
      if (!tpl || !canUserSeeTemplate(tpl, authUser)) {
        return res.status(403).json({ error: 'Acesso não autorizado a este relatório.' });
      }
      let storedSql = tpl.sqlQuery;
      if (subreportId) {
        const sr = (Array.isArray(tpl.subreports) ? tpl.subreports : []).find((s) => s?.id === subreportId);
        if (!sr || sr.type !== 'query' || typeof sr.sql_query !== 'string') {
          return res.status(403).json({ error: 'Subrelatório não pertence ao modelo informado.' });
        }
        storedSql = sr.sql_query;
      }
      const sqlErr = validateReportSql(storedSql);
      if (sqlErr) {
        return res.status(403).json({ error: 'SQL armazenado do modelo é inválido.' });
      }
      const effectiveFilters = extractAutoFiltersFromSql(storedSql, Array.isArray(tpl.filters) ? tpl.filters : []);
      const built = buildParameterizedQueryServer(storedSql, effectiveFilters, filterValues);
      sqlToRun = built.sql;
      paramsToRun = built.params;
      appliedFilterIds = built.appliedFilterIds;
    } else {
      if (!sql || typeof sql !== 'string') {
        return res.status(400).json({ error: 'Consulta SQL é obrigatória.' });
      }
      const sqlErr = validateReportSql(sql);
      if (sqlErr) {
        return res.status(403).json({ error: sqlErr });
      }
      if (Array.isArray(params)) {
        sqlToRun = sql;
        paramsToRun = params;
      } else {
        const effectiveFilters = extractAutoFiltersFromSql(sql, Array.isArray(filters) ? filters : []);
        const built = buildParameterizedQueryServer(sql, effectiveFilters, filterValues);
        sqlToRun = built.sql;
        paramsToRun = built.params;
        appliedFilterIds = built.appliedFilterIds;
      }
    }

    const requestedLimit = Number.parseInt(String(limit ?? ''), 10);
    const maxLimit = Number.isInteger(requestedLimit) ? Math.max(1, Math.min(requestedLimit, 500)) : 500;

    try {
      const data = await runReadOnlySql(sqlToRun, paramsToRun, maxLimit);
      res.json({
        ...data,
        ...(appliedFilterIds ? { appliedFilterIds } : {}),
      });
    } catch (err) {
      console.error('POST /api/reports/execute-query error:', err instanceof Error ? err.message : err);
      res.status(400).json({
        error: isAdmin && err instanceof Error
          ? err.message
          : 'Erro ao executar consulta. Verifique os parâmetros informados.',
      });
    }
  });

  // 6. List visible active report templates (+ admin ACL options)
  app.get('/api/reports/templates', requireAuth, requireModule('reports'), async (req: AuthRequest, res: Response) => {
    try {
      await ensureReportTemplatesSeed();
      const authUser = req.authUser!;
      const rows = await db
        .select()
        .from(reportTemplates)
        .where(eq(reportTemplates.isActive, true))
        .orderBy(asc(reportTemplates.category), asc(reportTemplates.name));

      const visible = rows.filter((r) => canUserSeeTemplate(r, authUser)).map(mapTemplateRow);

      let aclOptions: { users: Array<{ id: number; name: string; role: string }>; groups: Array<{ id: number; name: string }> } | undefined;
      if (authUser.role === 'admin') {
        const [uRows, gRows] = await Promise.all([
          db.select({ id: users.id, name: users.name, role: users.role }).from(users).where(eq(users.active, true)).orderBy(asc(users.name)),
          db.select({ id: userGroups.id, name: userGroups.name }).from(userGroups).orderBy(asc(userGroups.name)),
        ]);
        aclOptions = { users: uRows, groups: gRows };
      }

      res.json({ templates: visible, aclOptions });
    } catch (err) {
      console.error('GET /api/reports/templates error:', err);
      res.status(500).json({ error: 'Erro ao carregar modelos de relatórios.' });
    }
  });

  // 7. Get single report template
  app.get('/api/reports/templates/:id', requireAuth, requireModule('reports'), async (req: AuthRequest, res: Response) => {
    const id = String(req.params.id || '').trim();
    if (!isValidUuid(id)) return res.status(400).json({ error: 'UUID inválido.' });
    try {
      const [row] = await db.select().from(reportTemplates).where(eq(reportTemplates.id, id)).limit(1);
      if (!row || !canUserSeeTemplate(row, req.authUser!)) {
        return res.status(404).json({ error: 'Template não encontrado.' });
      }
      res.json({ template: mapTemplateRow(row) });
    } catch (err) {
      console.error('GET /api/reports/templates/:id error:', err);
      res.status(500).json({ error: 'Erro ao buscar template.' });
    }
  });

  // 8. Create report template (Admin only)
  app.post('/api/reports/templates', requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
    const body = req.body as Record<string, any>;
    const name = String(body.name || '').trim();
    const sqlQuery = String(body.sql_query || '').trim();
    if (!name || !sqlQuery) {
      return res.status(400).json({ error: 'Nome e consulta SQL são obrigatórios.' });
    }
    if (name.length > 255) {
      return res.status(400).json({ error: 'O nome do relatório deve ter no máximo 255 caracteres.' });
    }

    const sqlErr = validateReportSql(sqlQuery);
    if (sqlErr) return res.status(400).json({ error: sqlErr });

    const defErr = validateReportDefinition(body);
    if (defErr) return res.status(400).json({ error: defErr });

    const allowedUsers = Array.isArray(body.allowed_users) && body.allowed_users.length > 0
      ? body.allowed_users.map(Number).filter(Number.isInteger)
      : null;
    const allowedGroups = Array.isArray(body.allowed_groups) && body.allowed_groups.length > 0
      ? body.allowed_groups.map(Number).filter(Number.isInteger)
      : null;

    try {
      const [created] = await db
        .insert(reportTemplates)
        .values({
          name,
          description: String(body.description || '').trim(),
          category: String(body.category || 'Outros'),
          targetLayout: String(body.target_layout || 'responsive'),
          contentMode: String(body.content_mode || 'both'),
          sqlQuery,
          layout: body.layout && typeof body.layout === 'object' ? body.layout : {},
          filters: Array.isArray(body.filters) ? body.filters : [],
          subreports: Array.isArray(body.subreports) ? body.subreports : [],
          charts: Array.isArray(body.charts) ? body.charts : [],
          allowedUsers,
          allowedGroups,
          createdBy: req.authUser!.id,
          isActive: true,
        })
        .returning();

      await db.insert(auditLogs).values({
        userId: req.authUser!.id,
        userName: req.authUser!.name,
        action: 'CREATE_REPORT_TEMPLATE',
        entityType: 'report_templates',
        entityId: created.id,
        details: { name: created.name, category: created.category },
        unitId: req.activeUnitId || 1,
      });

      deps.broadcast('reports_updated', { action: 'created', templateId: created.id });
      res.status(201).json({ template: mapTemplateRow(created) });
    } catch (err) {
      console.error('POST /api/reports/templates error:', err);
      res.status(500).json({ error: 'Erro interno ao salvar modelo de relatório.' });
    }
  });

  // 9. Update report template (Admin only)
  app.put('/api/reports/templates/:id', requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
    const id = String(req.params.id || '').trim();
    if (!isValidUuid(id)) return res.status(400).json({ error: 'UUID inválido.' });

    const body = req.body as Record<string, any>;
    if (body.sql_query !== undefined) {
      const sqlErr = validateReportSql(String(body.sql_query || ''));
      if (sqlErr) return res.status(400).json({ error: sqlErr });
    }
    const defErr = validateReportDefinition(body);
    if (defErr) return res.status(400).json({ error: defErr });

    try {
      const [existing] = await db.select().from(reportTemplates).where(eq(reportTemplates.id, id)).limit(1);
      if (!existing || !existing.isActive) {
        return res.status(404).json({ error: 'Template não encontrado.' });
      }

      const nextName = body.name !== undefined ? String(body.name || '').trim() : existing.name;
      if (!nextName) return res.status(400).json({ error: 'O nome do relatório é obrigatório.' });
      if (nextName.length > 255) return res.status(400).json({ error: 'O nome deve ter no máximo 255 caracteres.' });

      const nextAllowedUsers =
        body.allowed_users !== undefined
          ? Array.isArray(body.allowed_users) && body.allowed_users.length > 0
            ? body.allowed_users.map(Number).filter(Number.isInteger)
            : null
          : existing.allowedUsers;

      const nextAllowedGroups =
        body.allowed_groups !== undefined
          ? Array.isArray(body.allowed_groups) && body.allowed_groups.length > 0
            ? body.allowed_groups.map(Number).filter(Number.isInteger)
            : null
          : existing.allowedGroups;

      const [updated] = await db
        .update(reportTemplates)
        .set({
          name: nextName,
          ...(body.description !== undefined ? { description: String(body.description || '') } : {}),
          ...(body.category !== undefined ? { category: String(body.category || 'Outros') } : {}),
          ...(body.target_layout !== undefined ? { targetLayout: String(body.target_layout) } : {}),
          ...(body.content_mode !== undefined ? { contentMode: String(body.content_mode) } : {}),
          ...(body.sql_query !== undefined ? { sqlQuery: String(body.sql_query) } : {}),
          ...(body.layout !== undefined ? { layout: body.layout || {} } : {}),
          ...(body.filters !== undefined ? { filters: Array.isArray(body.filters) ? body.filters : [] } : {}),
          ...(body.subreports !== undefined ? { subreports: Array.isArray(body.subreports) ? body.subreports : [] } : {}),
          ...(body.charts !== undefined ? { charts: Array.isArray(body.charts) ? body.charts : [] } : {}),
          allowedUsers: nextAllowedUsers,
          allowedGroups: nextAllowedGroups,
          updatedAt: new Date(),
        })
        .where(eq(reportTemplates.id, id))
        .returning();

      await db.insert(auditLogs).values({
        userId: req.authUser!.id,
        userName: req.authUser!.name,
        action: 'UPDATE_REPORT_TEMPLATE',
        entityType: 'report_templates',
        entityId: updated.id,
        details: { name: updated.name, category: updated.category },
        unitId: req.activeUnitId || 1,
      });

      deps.broadcast('reports_updated', { action: 'updated', templateId: updated.id });
      res.json({ template: mapTemplateRow(updated) });
    } catch (err) {
      console.error('PUT /api/reports/templates/:id error:', err);
      res.status(500).json({ error: 'Erro interno ao atualizar modelo de relatório.' });
    }
  });

  // 10. Soft-delete report template (Admin only, is_active = false)
  app.delete('/api/reports/templates/:id', requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
    const id = String(req.params.id || '').trim();
    if (!isValidUuid(id)) return res.status(400).json({ error: 'UUID inválido.' });

    try {
      const [existing] = await db.select().from(reportTemplates).where(eq(reportTemplates.id, id)).limit(1);
      if (!existing || !existing.isActive) {
        return res.status(404).json({ error: 'Template não encontrado.' });
      }

      await db
        .update(reportTemplates)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(reportTemplates.id, id));

      await db.insert(auditLogs).values({
        userId: req.authUser!.id,
        userName: req.authUser!.name,
        action: 'DELETE_REPORT_TEMPLATE',
        entityType: 'report_templates',
        entityId: id,
        details: { name: existing.name },
        unitId: req.activeUnitId || 1,
      });

      deps.broadcast('reports_updated', { action: 'deleted', templateId: id });
      res.json({ success: true });
    } catch (err) {
      console.error('DELETE /api/reports/templates/:id error:', err);
      res.status(500).json({ error: 'Erro ao excluir modelo de relatório.' });
    }
  });
}
