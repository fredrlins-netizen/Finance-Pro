import type {
  ReportAggregationOp,
  ReportChartDef,
  ReportColumnFormat,
  ReportFilterDef,
  ReportLayoutConfig,
  ReportSubreportDef,
  ReportTemplateItem,
} from '../types.ts';

export const REPORT_CATEGORIES = [
  'Cadastrais',
  'Financeiro',
  'Comercial',
  'Jurídico',
  'Negociação',
  'Cobrança',
  'Administrativo',
  'Gerenciais',
  'Outros',
] as const;

export const COLUMN_FORMATS: Array<{ value: ReportColumnFormat; label: string }> = [
  { value: 'text', label: 'Texto' },
  { value: 'number', label: 'Número' },
  { value: 'currency_brl', label: 'Moeda BRL' },
  { value: 'date', label: 'Data' },
  { value: 'cpf_cnpj', label: 'CPF/CNPJ' },
  { value: 'percent', label: 'Percentual' },
];

export const AGGREGATION_OPTIONS: Array<{ value: ReportAggregationOp; label: string }> = [
  { value: 'nenhum', label: 'Nenhum' },
  { value: 'soma', label: 'Soma' },
  { value: 'contagem', label: 'Contagem' },
  { value: 'media', label: 'Média' },
  { value: 'min', label: 'Mín' },
  { value: 'max', label: 'Máx' },
];

export const COLOR_PALETTES: Record<
  'padrao' | 'pastel' | 'escuro' | 'monocromatico',
  string[]
> = {
  padrao: ['#3B82F6', '#EF4444', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899', '#06B6D4', '#F97316'],
  pastel: ['#93C5FD', '#FCA5A5', '#6EE7B7', '#FDE68A', '#C4B5FD', '#FBCFE8', '#67E8F9', '#FDBA74'],
  escuro: ['#1E3A5F', '#7F1D1D', '#064E3B', '#78350F', '#4C1D95', '#831843', '#164E63', '#9A3412'],
  monocromatico: ['#1E40AF', '#2563EB', '#3B82F6', '#60A5FA', '#93C5FD', '#BFDBFE', '#DBEAFE', '#EFF6FF'],
};

export const CHART_TYPES: Array<{ value: ReportChartDef['type']; label: string }> = [
  { value: 'bar', label: 'Barra' },
  { value: 'pie', label: 'Pizza' },
  { value: 'line', label: 'Linhas' },
  { value: 'mixed', label: 'Misto (Barra+Linha)' },
];

export const CHART_SUBTYPES: Record<ReportChartDef['type'], Array<{ value: string; label: string }>> = {
  bar: [
    { value: 'vertical', label: 'Vertical' },
    { value: 'horizontal', label: 'Horizontal' },
    { value: 'stacked', label: 'Empilhado' },
  ],
  pie: [
    { value: 'pizza', label: 'Pizza' },
    { value: 'donut', label: 'Rosca (Donut)' },
  ],
  line: [
    { value: 'line', label: 'Linha' },
    { value: 'area', label: 'Área (preenchido)' },
  ],
  mixed: [],
};

export const Y_OPERATIONS: Array<{ value: 'direto' | 'soma' | 'contagem' | 'media'; label: string }> = [
  { value: 'direto', label: 'Valor direto' },
  { value: 'soma', label: 'Soma' },
  { value: 'contagem', label: 'Contagem' },
  { value: 'media', label: 'Média' },
];

export const WHERE_OPERATORS = [
  '=',
  '!=',
  '>',
  '<',
  '>=',
  '<=',
  'LIKE',
  'ILIKE',
  'IN',
  'BETWEEN',
  'IS NULL',
  'IS NOT NULL',
] as const;

export const SUBREPORT_FORMAT_OPTIONS: Array<{
  value: '' | 'text' | 'number' | 'currency' | 'percent' | 'date' | 'datetime';
  label: string;
}> = [
  { value: '', label: 'Nenhum' },
  { value: 'text', label: 'Texto' },
  { value: 'number', label: 'Número' },
  { value: 'currency', label: 'Moeda (R$)' },
  { value: 'percent', label: 'Percentual (%)' },
  { value: 'date', label: 'Data' },
  { value: 'datetime', label: 'Data/Hora' },
];

export const SUBREPORT_OPERATION_OPTIONS: Array<{
  value: 'none' | 'sum' | 'count' | 'avg' | 'min' | 'max';
  label: string;
}> = [
  { value: 'none', label: 'Nenhum' },
  { value: 'sum', label: 'Soma' },
  { value: 'count', label: 'Contagem' },
  { value: 'avg', label: 'Média' },
  { value: 'min', label: 'Mín' },
  { value: 'max', label: 'Máx' },
];

export const GUIDE_SECTIONS = [
  { id: 'visao_geral', label: 'Visão Geral' },
  { id: 'fonte_dados', label: 'Fonte de Dados' },
  { id: 'layout', label: 'Layout' },
  { id: 'graficos', label: 'Gráficos' },
  { id: 'subreports', label: 'Sub-relatórios' },
  { id: 'preview', label: 'Preview e Exportação' },
  { id: 'modelos', label: 'Modelos de Relatórios' },
  { id: 'tabelas', label: 'Tabelas do Banco' },
  { id: 'sql_ref', label: 'Referência SQL' },
  { id: 'dicas', label: 'Dicas e Soluções' },
] as const;

export function createDefaultLayout(): ReportLayoutConfig {
  return {
    header: {
      show: true,
      title: '',
      subtitle: '',
      logo: '',
      alignment: 'left',
      showDate: true,
      showLogo: true,
    },
    columns: [],
    grouping: null,
    footer: {
      show: true,
      showTotals: false,
      totalizers: [],
      showPageNumbers: true,
      showDateTime: false,
      customText: '',
    },
    general: {
      pageSize: 'A4',
      orientation: 'portrait',
      fontSize: 12,
      fontFamily: 'Arial',
      zebra: true,
      margins: { top: 20, bottom: 20, left: 15, right: 15 },
    },
  };
}

export function createEmptyReportTemplate(): ReportTemplateItem {
  const now = new Date().toISOString();
  return {
    id: '',
    name: '',
    description: '',
    category: 'Outros',
    target_layout: 'responsive',
    content_mode: 'both',
    sql_query: '',
    layout: createDefaultLayout(),
    filters: [],
    subreports: [],
    charts: [],
    allowed_users: null,
    allowed_groups: null,
    created_by: null,
    created_at: now,
    updated_at: now,
    is_active: true,
  };
}

export function createUid(prefix = 'id'): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
  }
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function createEmptyChart(): ReportChartDef {
  return {
    id: createUid('chart'),
    type: 'bar',
    subType: 'vertical',
    title: '',
    xField: '',
    yFields: [],
    colors: [...COLOR_PALETTES.padrao],
    palette: 'padrao',
    position: 'after',
    width: '100%',
    showLegend: true,
    showDataLabels: false,
    showGrid: true,
  };
}

export function createEmptyFilter(defaultPlaceholder = 'campo'): ReportFilterDef {
  return {
    id: createUid('flt'),
    placeholder: defaultPlaceholder,
    label: '',
    type: 'text',
    defaultValue: '',
    options: [],
  };
}

export function createEmptySubreport(): ReportSubreportDef {
  return {
    id: createUid('sub'),
    type: 'summary',
    title: '',
    sql_query: '',
    summary_config: { groupField: '', operations: [] },
    columns: [],
    totalizers: [],
  };
}

export function normalizeLayoutConfig(raw: any): ReportLayoutConfig {
  const def = createDefaultLayout();
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    header: { ...def.header, ...(src.header || {}) },
    columns: Array.isArray(src.columns) ? src.columns : [],
    grouping: src.grouping
      ? {
          fields: Array.isArray(src.grouping.fields) ? src.grouping.fields : [],
          headerTemplate: String(src.grouping.headerTemplate || ''),
          showSubtotals: Boolean(src.grouping.showSubtotals),
          totalizers: Array.isArray(src.grouping.totalizers) ? src.grouping.totalizers : [],
        }
      : null,
    footer: {
      ...def.footer,
      ...(src.footer || {}),
      totalizers: Array.isArray(src.footer?.totalizers) ? src.footer.totalizers : [],
    },
    general: {
      ...def.general,
      ...(src.general || {}),
      margins: { ...def.general.margins, ...(src.general?.margins || {}) },
    },
  };
}

export function parseNumericValue(val: unknown): number | null {
  if (val === null || val === undefined || val === '') return null;
  if (typeof val === 'number') return Number.isFinite(val) ? val : null;
  let str = String(val).trim();
  if (!str) return null;
  str = str.replace(/R\$\s*/g, '').replace(/%/g, '').trim();
  if (/^-?\d{1,3}(\.\d{3})*(,\d+)?$/.test(str)) {
    str = str.replace(/\./g, '').replace(',', '.');
  } else if (/^-?\d+(,\d+)$/.test(str)) {
    str = str.replace(',', '.');
  }
  const n = Number(str);
  return Number.isFinite(n) ? n : null;
}

export function formatReportValue(
  val: unknown,
  format: ReportColumnFormat | '' | 'currency' | 'datetime'
): string {
  if (val === null || val === undefined || val === '') return '';
  if (format === 'currency_brl' || format === 'currency') {
    const num = parseNumericValue(val);
    if (num === null) return String(val);
    return num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }
  if (format === 'number') {
    const num = parseNumericValue(val);
    if (num === null) return String(val);
    return num.toLocaleString('pt-BR');
  }
  if (format === 'percent') {
    const num = parseNumericValue(val);
    if (num === null) return String(val);
    return `${num.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
  }
  if (format === 'date') {
    const s = String(val).trim();
    const iso = s.slice(0, 10);
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (m) return `${m[3]}/${m[2]}/${m[1]}`;
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString('pt-BR');
  }
  if (format === 'datetime') {
    const d = new Date(String(val));
    return Number.isNaN(d.getTime()) ? String(val) : d.toLocaleString('pt-BR');
  }
  if (format === 'cpf_cnpj') {
    const digits = String(val).replace(/\D/g, '');
    if (digits.length === 11) {
      return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
    }
    if (digits.length === 14) {
      return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
    }
    return String(val);
  }
  if (typeof val === 'boolean') return val ? 'Sim' : 'Não';
  return String(val);
}

export function normalizeAggOp(op: string): 'nenhum' | 'soma' | 'contagem' | 'media' | 'min' | 'max' {
  const m = String(op || '').toLowerCase();
  if (m === 'sum' || m === 'soma') return 'soma';
  if (m === 'count' || m === 'contagem') return 'contagem';
  if (m === 'avg' || m === 'media') return 'media';
  if (m === 'min' || m === 'minimo') return 'min';
  if (m === 'max' || m === 'maximo') return 'max';
  return 'nenhum';
}

export function computeNumericAggregate(
  rows: Array<Record<string, any>>,
  field: string,
  operation: string
): number {
  const op = normalizeAggOp(operation);
  if (op === 'nenhum') return 0;
  if (op === 'contagem') return rows.length;
  const nums = rows
    .map((r) => parseNumericValue(r[field]))
    .filter((n): n is number => n !== null);
  if (nums.length === 0) return 0;
  if (op === 'soma') return nums.reduce((a, b) => a + b, 0);
  if (op === 'media') return nums.reduce((a, b) => a + b, 0) / nums.length;
  if (op === 'min') return Math.min(...nums);
  if (op === 'max') return Math.max(...nums);
  return 0;
}

export function buildParameterizedQueryClient(
  sql: string,
  filters: ReportFilterDef[],
  filterValues: Record<string, string>
): { sql: string; params: any[]; appliedFilterIds: string[] } {
  const params: any[] = [];
  const placeholderIndex = new Map<string, number>();
  const appliedFilterIds: string[] = [];

  let processedSql = String(sql || '');

  for (const f of filters) {
    const rawPh = String(f.placeholder || '').trim();
    if (!rawPh) continue;
    const escaped = rawPh.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const curlyRegex = new RegExp(`\\{\\{\\s*${escaped}\\s*\\}\\}`, 'g');
    const colonRegex = new RegExp(`(?<!:):${escaped}\\b`, 'g');

    const hasCurly = curlyRegex.test(processedSql);
    const hasColon = !hasCurly && colonRegex.test(processedSql);
    if (!hasCurly && !hasColon) continue;

    appliedFilterIds.push(f.id);
    const val = filterValues[f.id] ?? f.defaultValue ?? '';

    const getParamRef = () => {
      if (placeholderIndex.has(rawPh)) return `$${placeholderIndex.get(rawPh)}`;
      params.push(val === '' ? '' : f.type === 'number' && !Number.isNaN(Number(val)) ? Number(val) : val);
      const idx = params.length;
      placeholderIndex.set(rawPh, idx);
      return `$${idx}`;
    };

    if (hasCurly) {
      processedSql = processedSql.replace(new RegExp(`\\{\\{\\s*${escaped}\\s*\\}\\}`, 'g'), () => getParamRef());
    } else if (hasColon) {
      processedSql = processedSql.replace(new RegExp(`(?<!:):${escaped}\\b`, 'g'), () => getParamRef());
    }
  }

  return { sql: processedSql, params, appliedFilterIds };
}

export function applyClientFilters(
  rows: Array<Record<string, any>>,
  filters: ReportFilterDef[],
  filterValues: Record<string, string>,
  appliedFilterIds: string[]
): Array<Record<string, any>> {
  const localFilters = filters.filter((f) => {
    if (appliedFilterIds.includes(f.id)) return false;
    const val = (filterValues[f.id] ?? f.defaultValue ?? '').trim();
    return val !== '';
  });

  if (localFilters.length === 0) return rows;

  return rows.filter((row) => {
    for (const f of localFilters) {
      const val = (filterValues[f.id] ?? f.defaultValue ?? '').trim();
      const rawCell = row[f.placeholder];
      if (f.type === 'select') {
        if (String(rawCell ?? '') !== val) return false;
      } else if (f.type === 'date') {
        const cellDate = String(rawCell ?? '').slice(0, 10);
        if (cellDate !== val.slice(0, 10)) return false;
      } else if (f.type === 'number') {
        const a = parseNumericValue(rawCell);
        const b = parseNumericValue(val);
        if (a === null || b === null || a !== b) return false;
      } else {
        if (!String(rawCell ?? '').toLowerCase().includes(val.toLowerCase())) return false;
      }
    }
    return true;
  });
}

export function computeSummaryRows(
  rows: Array<Record<string, any>>,
  subreport: ReportSubreportDef
): Array<Record<string, any>> {
  const cfg = subreport.summary_config;
  if (!cfg || !cfg.groupField) return [];

  const groups = new Map<string, Array<Record<string, any>>>();
  for (const r of rows) {
    const keyVal = r[cfg.groupField];
    const key = keyVal === null || keyVal === undefined || String(keyVal).trim() === '' ? '(vazio)' : String(keyVal);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }

  const out: Array<Record<string, any>> = [];
  for (const [groupKey, groupRows] of groups.entries()) {
    const rowObj: Record<string, any> = { [cfg.groupField]: groupKey };
    for (const op of cfg.operations || []) {
      if (!op.field || op.operation === 'none') continue;
      const outKey = `${op.field}_${op.operation}`;
      rowObj[outKey] = computeNumericAggregate(groupRows, op.field, op.operation);
      rowObj[op.field] = rowObj[outKey];
    }
    out.push(rowObj);
  }
  return out;
}

export function aggregateChartSeries(
  rows: Array<Record<string, any>>,
  chart: ReportChartDef
): { data: Array<Record<string, any>>; seriesKeys: Array<{ key: string; label: string; color: string; seriesType: 'bar' | 'line'; secondaryAxis: boolean }> } {
  if (!chart.xField || chart.yFields.length === 0) return { data: [], seriesKeys: [] };

  const hasDirectOnly = chart.yFields.every((y) => y.operation === 'direto');
  const seriesKeys = chart.yFields.map((y, idx) => ({
    key: `${y.field}__${y.operation}__${idx}`,
    label: y.label || y.field,
    color: y.color || chart.colors[idx % chart.colors.length] || '#3B82F6',
    seriesType: y.seriesType || 'bar',
    secondaryAxis: Boolean(y.secondaryAxis),
  }));

  if (hasDirectOnly && rows.length <= 40) {
    const directData = rows.map((r, rIdx) => {
      const item: Record<string, any> = {
        __x: String(r[chart.xField] ?? `#${rIdx + 1}`),
      };
      chart.yFields.forEach((y, idx) => {
        const k = seriesKeys[idx].key;
        item[k] = parseNumericValue(r[y.field]) ?? 0;
      });
      return item;
    });
    return { data: directData, seriesKeys };
  }

  const groups = new Map<string, Array<Record<string, any>>>();
  for (const r of rows) {
    const xVal = r[chart.xField];
    const xKey = xVal === null || xVal === undefined || String(xVal).trim() === '' ? '(vazio)' : String(xVal);
    if (!groups.has(xKey)) groups.set(xKey, []);
    groups.get(xKey)!.push(r);
  }

  const data: Array<Record<string, any>> = [];
  for (const [xKey, gRows] of groups.entries()) {
    const point: Record<string, any> = { __x: xKey };
    chart.yFields.forEach((y, idx) => {
      const k = seriesKeys[idx].key;
      const op = y.operation === 'direto' ? 'soma' : y.operation;
      point[k] = computeNumericAggregate(gRows, y.field, op);
    });
    data.push(point);
  }

  return { data, seriesKeys };
}

export interface VisualJoinConfig {
  id: string;
  leftTable: string;
  leftColumn: string;
  joinType: 'INNER JOIN' | 'LEFT JOIN' | 'RIGHT JOIN' | 'FULL JOIN';
  rightTable: string;
  rightColumn: string;
}

export interface VisualWhereConfig {
  id: string;
  field: string;
  operator: string;
  value: string;
  connector: 'AND' | 'OR';
}

const VALID_IDENT = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const ALLOWED_JOIN_TYPES = new Set(['INNER JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'FULL JOIN']);
const ALLOWED_WHERE_OPS = new Set([
  '=',
  '!=',
  '<>',
  '>',
  '<',
  '>=',
  '<=',
  'LIKE',
  'ILIKE',
  'IN',
  'BETWEEN',
  'IS NULL',
  'IS NOT NULL',
]);

export function buildVisualSql(params: {
  selectedTables: string[];
  selectedColumns: Array<{ table: string; column: string }>;
  joins: VisualJoinConfig[];
  wheres: VisualWhereConfig[];
  groupBy: string[];
  orderBy: string[];
}): string {
  const { selectedTables, selectedColumns, joins, wheres, groupBy, orderBy } = params;
  if (selectedTables.length === 0 || selectedColumns.length === 0) return '';

  for (const t of selectedTables) {
    if (!VALID_IDENT.test(t)) return '';
  }

  const selectCols = selectedColumns
    .filter((c) => VALID_IDENT.test(c.table) && VALID_IDENT.test(c.column))
    .map((c) => `"${c.table}"."${c.column}" AS "${c.table}__${c.column}"`);

  if (selectCols.length === 0) return '';

  const baseTable = selectedTables[0];
  let sql = `SELECT\n  ${selectCols.join(',\n  ')}\nFROM "${baseTable}"`;

  for (const j of joins) {
    if (
      !j.leftTable ||
      !j.leftColumn ||
      !j.rightTable ||
      !j.rightColumn ||
      !VALID_IDENT.test(j.leftTable) ||
      !VALID_IDENT.test(j.leftColumn) ||
      !VALID_IDENT.test(j.rightTable) ||
      !VALID_IDENT.test(j.rightColumn) ||
      !ALLOWED_JOIN_TYPES.has(j.joinType)
    ) {
      continue;
    }
    sql += `\n${j.joinType} "${j.rightTable}" ON "${j.leftTable}"."${j.leftColumn}" = "${j.rightTable}"."${j.rightColumn}"`;
  }

  const whereClauses: string[] = [];
  for (let idx = 0; idx < wheres.length; idx++) {
    const w = wheres[idx];
    const [tbl, col] = String(w.field || '').split('.');
    if (!tbl || !col || !VALID_IDENT.test(tbl) || !VALID_IDENT.test(col)) continue;
    if (!ALLOWED_WHERE_OPS.has(w.operator)) continue;

    const qField = `"${tbl}"."${col}"`;
    let expr = '';
    const rawVal = String(w.value || '').trim();
    const isToken = (v: string) => /^\{\{[a-zA-Z_][a-zA-Z0-9_.]*\}\}$/.test(v.trim());

    if (w.operator === 'IS NULL' || w.operator === 'IS NOT NULL') {
      expr = `${qField} ${w.operator}`;
    } else if (w.operator === 'IN') {
      const items = rawVal
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (items.length === 0) continue;
      const mapped = items.map((it) => (isToken(it) ? it : `'${it.replace(/'/g, "''")}'`));
      expr = `${qField} IN (${mapped.join(', ')})`;
    } else if (w.operator === 'BETWEEN') {
      const andTokens = rawVal.split(/\s+AND\s+/i).map((s) => s.trim());
      const parts = andTokens.length === 2 ? andTokens : rawVal.split(',').map((s) => s.trim());
      if (parts.length !== 2) continue;
      const p1 = isToken(parts[0]) ? parts[0] : `'${parts[0].replace(/'/g, "''")}'`;
      const p2 = isToken(parts[1]) ? parts[1] : `'${parts[1].replace(/'/g, "''")}'`;
      expr = `${qField} BETWEEN ${p1} AND ${p2}`;
    } else {
      const rhs = isToken(rawVal) ? rawVal : `'${rawVal.replace(/'/g, "''")}'`;
      expr = `${qField} ${w.operator} ${rhs}`;
    }

    const conn = idx === 0 ? '' : w.connector === 'OR' ? 'OR ' : 'AND ';
    whereClauses.push(`${conn}${expr}`);
  }

  if (whereClauses.length > 0) {
    sql += `\nWHERE ${whereClauses.join('\n  ')}`;
  }

  const validGroup = groupBy
    .map((g) => g.split('.'))
    .filter(([t, c]) => t && c && VALID_IDENT.test(t) && VALID_IDENT.test(c))
    .map(([t, c]) => `"${t}"."${c}"`);
  if (validGroup.length > 0) {
    sql += `\nGROUP BY ${validGroup.join(', ')}`;
  }

  const validOrder = orderBy
    .map((o) => o.split('.'))
    .filter(([t, c]) => t && c && VALID_IDENT.test(t) && VALID_IDENT.test(c))
    .map(([t, c]) => `"${t}"."${c}"`);
  if (validOrder.length > 0) {
    sql += `\nORDER BY ${validOrder.join(', ')}`;
  }

  return sql;
}

export interface EmbeddedReportTemplateSeed {
  name: string;
  description: string;
  category: string;
  target_layout: 'responsive' | 'web' | 'mobile';
  content_mode: 'data' | 'charts' | 'both';
  sql_query: string;
  layout: ReportLayoutConfig;
  filters: ReportFilterDef[];
  subreports: ReportSubreportDef[];
  charts: ReportChartDef[];
}

export const EMBEDDED_REPORT_TEMPLATES: EmbeddedReportTemplateSeed[] = [
  {
    name: 'Carteira de Admissões por Banco e Status',
    description: 'Visão consolidada de contratos admitidos, passivo original e taxa de serviços por instituição financeira.',
    category: 'Comercial',
    target_layout: 'responsive',
    content_mode: 'both',
    sql_query: `SELECT
  a.protocol_code AS protocolo,
  c.full_name AS cliente,
  c.cpf_cnpj AS documento,
  a.bank_name AS banco,
  a.modality AS modalidade,
  a.status AS status,
  ROUND(a.debt_amount_cents / 100.0, 2) AS passivo_reais,
  ROUND(a.service_fee_cents / 100.0, 2) AS honorarios_reais,
  a.created_at::date AS data_admissao
FROM admissions a
JOIN clients c ON c.id = a.client_id
WHERE (NULLIF({{status}}, '') IS NULL OR a.status = {{status}})
  AND (NULLIF({{banco}}, '') IS NULL OR a.bank_name ILIKE '%' || {{banco}} || '%')
ORDER BY a.id DESC`,
    layout: {
      ...createDefaultLayout(),
      header: {
        show: true,
        title: 'Relatório de Admissões Bancárias',
        subtitle: 'Passivo contratado, honorários e status de tramitação',
        logo: '',
        alignment: 'left',
        showDate: true,
        showLogo: true,
      },
      columns: [
        { field: 'protocolo', label: 'Protocolo', visible: true, width: '12', align: 'left', format: 'text' },
        { field: 'cliente', label: 'Cliente', visible: true, width: '24', align: 'left', format: 'text' },
        { field: 'documento', label: 'CPF/CNPJ', visible: true, width: '15', align: 'left', format: 'cpf_cnpj' },
        { field: 'banco', label: 'Banco', visible: true, width: '14', align: 'left', format: 'text' },
        { field: 'status', label: 'Status', visible: true, width: '11', align: 'center', format: 'text' },
        { field: 'passivo_reais', label: 'Passivo (R$)', visible: true, width: '12', align: 'right', format: 'currency_brl' },
        { field: 'honorarios_reais', label: 'Honorários (R$)', visible: true, width: '12', align: 'right', format: 'currency_brl' },
      ],
      grouping: {
        fields: ['banco'],
        headerTemplate: 'Instituição: {{grupo}}',
        showSubtotals: true,
        totalizers: [
          { field: 'passivo_reais', operation: 'soma' },
          { field: 'honorarios_reais', operation: 'soma' },
        ],
      },
      footer: {
        show: true,
        showTotals: true,
        totalizers: [
          { field: 'passivo_reais', operation: 'soma' },
          { field: 'honorarios_reais', operation: 'soma' },
        ],
        showPageNumbers: true,
        showDateTime: true,
        customText: 'FinancePro Assessoria · Documento Gerencial Interno',
      },
    },
    filters: [
      {
        id: 'flt_adm_status',
        placeholder: 'status',
        label: 'Status da Admissão',
        type: 'select',
        defaultValue: '',
        options: ['aguardando_auditoria', 'em_andamento', 'aprovada', 'devolvida_admissao', 'suspensa'],
      },
      {
        id: 'flt_adm_banco',
        placeholder: 'banco',
        label: 'Banco Credor',
        type: 'text',
        defaultValue: '',
        options: [],
      },
    ],
    subreports: [
      {
        id: 'sub_adm_resumo_status',
        type: 'summary',
        title: 'Resumo Consolidado por Status',
        summary_config: {
          groupField: 'status',
          operations: [
            { field: 'passivo_reais', label: 'Passivo Total', operation: 'sum', format: 'currency' },
            { field: 'honorarios_reais', label: 'Honorários', operation: 'sum', format: 'currency' },
            { field: 'protocolo', label: 'Qtd. Contratos', operation: 'count', format: 'number' },
          ],
        },
        columns: [
          { field: 'status', label: 'Status', width: 30, format: 'text', align: 'left' },
          { field: 'protocolo_count', label: 'Qtd.', width: 15, format: 'number', align: 'right' },
          { field: 'passivo_reais_sum', label: 'Passivo Total', width: 28, format: 'currency', align: 'right' },
          { field: 'honorarios_reais_sum', label: 'Honorários', width: 27, format: 'currency', align: 'right' },
        ],
        totalizers: [
          { field: 'passivo_reais_sum', operation: 'sum' },
          { field: 'honorarios_reais_sum', operation: 'sum' },
        ],
      },
    ],
    charts: [
      {
        id: 'cht_adm_banco',
        type: 'bar',
        subType: 'vertical',
        title: 'Passivo e Honorários por Banco (R$)',
        xField: 'banco',
        yFields: [
          { field: 'passivo_reais', label: 'Passivo (R$)', operation: 'soma', color: '#3B82F6', seriesType: 'bar' },
          { field: 'honorarios_reais', label: 'Honorários (R$)', operation: 'soma', color: '#10B981', seriesType: 'bar' },
        ],
        colors: [...COLOR_PALETTES.padrao],
        palette: 'padrao',
        position: 'before',
        width: '50%',
        showLegend: true,
        showDataLabels: true,
        showGrid: true,
      },
      {
        id: 'cht_adm_status',
        type: 'pie',
        subType: 'donut',
        title: 'Distribuição do Passivo por Status',
        xField: 'status',
        yFields: [
          { field: 'passivo_reais', label: 'Passivo (R$)', operation: 'soma', color: '#8B5CF6' },
        ],
        colors: [...COLOR_PALETTES.padrao],
        palette: 'padrao',
        position: 'before',
        width: '50%',
        showLegend: true,
        showDataLabels: true,
        showGrid: false,
      },
    ],
  },
  {
    name: 'Posição de Contas a Receber e Inadimplência',
    description: 'Títulos financeiros em aberto, vencidos e recebidos por cliente, unidade e status.',
    category: 'Financeiro',
    target_layout: 'responsive',
    content_mode: 'both',
    sql_query: `SELECT
  ft.id AS titulo_id,
  COALESCE(c.full_name, ft.client_name) AS cliente,
  ft.title_type AS tipo,
  ft.status AS status,
  ft.due_date::date AS vencimento,
  ROUND(COALESCE(ft.original_value_cents, ft.amount_cents, 0) / 100.0, 2) AS valor_original,
  ROUND(COALESCE(ft.current_balance_cents, CASE WHEN LOWER(ft.status) = 'pago' THEN 0 ELSE ft.amount_cents END, 0) / 100.0, 2) AS saldo_aberto,
  ROUND(GREATEST(0, COALESCE(ft.original_value_cents, ft.amount_cents, 0) - COALESCE(ft.current_balance_cents, CASE WHEN LOWER(ft.status) = 'pago' THEN 0 ELSE ft.amount_cents END, 0)) / 100.0, 2) AS valor_pago
FROM financial_titles ft
LEFT JOIN clients c ON c.id = ft.client_id
WHERE UPPER(COALESCE(ft.scope, 'RECEBER')) = 'RECEBER'
  AND (NULLIF({{status}}, '') IS NULL OR LOWER(ft.status) = LOWER({{status}}))
  AND (NULLIF({{cliente}}, '') IS NULL OR COALESCE(c.full_name, ft.client_name) ILIKE '%' || {{cliente}} || '%')
ORDER BY ft.due_date ASC`,
    layout: {
      ...createDefaultLayout(),
      header: {
        show: true,
        title: 'Posição Financeira · Contas a Receber',
        subtitle: 'Saldo em aberto, valores liquidados e vencimentos',
        logo: '',
        alignment: 'left',
        showDate: true,
        showLogo: true,
      },
      columns: [
        { field: 'titulo_id', label: 'ID', visible: true, width: '8', align: 'center', format: 'number' },
        { field: 'cliente', label: 'Cliente / Sacado', visible: true, width: '28', align: 'left', format: 'text' },
        { field: 'status', label: 'Situação', visible: true, width: '14', align: 'center', format: 'text' },
        { field: 'vencimento', label: 'Vencimento', visible: true, width: '14', align: 'center', format: 'date' },
        { field: 'valor_original', label: 'Valor (R$)', visible: true, width: '12', align: 'right', format: 'currency_brl' },
        { field: 'saldo_aberto', label: 'Em Aberto (R$)', visible: true, width: '12', align: 'right', format: 'currency_brl' },
        { field: 'valor_pago', label: 'Pago (R$)', visible: true, width: '12', align: 'right', format: 'currency_brl' },
      ],
      footer: {
        show: true,
        showTotals: true,
        totalizers: [
          { field: 'valor_original', operation: 'soma' },
          { field: 'saldo_aberto', operation: 'soma' },
          { field: 'valor_pago', operation: 'soma' },
        ],
        showPageNumbers: true,
        showDateTime: true,
        customText: 'Conferência Financeira · Contas a Receber',
      },
    },
    filters: [
      {
        id: 'flt_fin_status',
        placeholder: 'status',
        label: 'Situação do Título',
        type: 'select',
        defaultValue: '',
        options: ['aberto', 'vencido', 'pago', 'cancelado'],
      },
      {
        id: 'flt_fin_cliente',
        placeholder: 'cliente',
        label: 'Cliente / Sacado',
        type: 'text',
        defaultValue: '',
        options: [],
      },
    ],
    subreports: [
      {
        id: 'sub_fin_resumo_status',
        type: 'summary',
        title: 'Resumo Financeiro por Situação',
        summary_config: {
          groupField: 'status',
          operations: [
            { field: 'titulo_id', label: 'Qtd. Títulos', operation: 'count', format: 'number' },
            { field: 'valor_original', label: 'Valor Original', operation: 'sum', format: 'currency' },
            { field: 'saldo_aberto', label: 'Em Aberto', operation: 'sum', format: 'currency' },
            { field: 'valor_pago', label: 'Valor Pago', operation: 'sum', format: 'currency' },
          ],
        },
        columns: [
          { field: 'status', label: 'Situação', width: 24, format: 'text', align: 'left' },
          { field: 'titulo_id_count', label: 'Qtd.', width: 12, format: 'number', align: 'right' },
          { field: 'valor_original_sum', label: 'Valor Original', width: 22, format: 'currency', align: 'right' },
          { field: 'saldo_aberto_sum', label: 'Em Aberto', width: 21, format: 'currency', align: 'right' },
          { field: 'valor_pago_sum', label: 'Valor Pago', width: 21, format: 'currency', align: 'right' },
        ],
        totalizers: [
          { field: 'valor_original_sum', operation: 'sum' },
          { field: 'saldo_aberto_sum', operation: 'sum' },
          { field: 'valor_pago_sum', operation: 'sum' },
        ],
      },
    ],
    charts: [
      {
        id: 'cht_fin_status',
        type: 'pie',
        subType: 'donut',
        title: 'Distribuição por Situação (R$)',
        xField: 'status',
        yFields: [
          { field: 'valor_original', label: 'Valor Original (R$)', operation: 'soma', color: '#3B82F6' },
        ],
        colors: [...COLOR_PALETTES.padrao],
        palette: 'padrao',
        position: 'before',
        width: '50%',
        showLegend: true,
        showDataLabels: true,
        showGrid: false,
      },
      {
        id: 'cht_fin_cliente',
        type: 'bar',
        subType: 'vertical',
        title: 'Liquidado vs Em Aberto por Cliente (R$)',
        xField: 'cliente',
        yFields: [
          { field: 'saldo_aberto', label: 'Em Aberto (R$)', operation: 'soma', color: '#EF4444', seriesType: 'bar' },
          { field: 'valor_pago', label: 'Pago (R$)', operation: 'soma', color: '#10B981', seriesType: 'bar' },
        ],
        colors: [...COLOR_PALETTES.padrao],
        palette: 'padrao',
        position: 'before',
        width: '50%',
        showLegend: true,
        showDataLabels: true,
        showGrid: true,
      },
    ],
  },
  {
    name: 'Processos Jurídicos e Alertas de Busca e Apreensão',
    description: 'Acompanhamento de processos monitorados pelo Escavador com sinalização de risco e status.',
    category: 'Jurídico',
    target_layout: 'responsive',
    content_mode: 'both',
    sql_query: `SELECT
  lp.process_number AS numero_processo,
  c.full_name AS cliente,
  lp.court_name AS tribunal_vara,
  lp.action_type AS tipo_acao,
  lp.status AS status,
  CASE WHEN lp.has_search_seizure THEN 'Sim' ELSE 'Não' END AS busca_apreensao,
  CASE WHEN lp.vehicle_seized THEN 'Apreendido' ELSE 'Regular' END AS situacao_veiculo
FROM legal_processes lp
JOIN clients c ON c.id = lp.client_id
WHERE (NULLIF({{status}}, '') IS NULL OR lp.status = {{status}})
  AND (NULLIF({{tipo_acao}}, '') IS NULL OR lp.action_type = {{tipo_acao}})
ORDER BY lp.has_search_seizure DESC, lp.id DESC`,
    layout: {
      ...createDefaultLayout(),
      header: {
        show: true,
        title: 'Painel de Processos Jurídicos',
        subtitle: 'Monitoramento Escavador e risco de Busca e Apreensão',
        logo: '',
        alignment: 'left',
        showDate: true,
        showLogo: true,
      },
      columns: [
        { field: 'numero_processo', label: 'Nº Processo', visible: true, width: '22', align: 'left', format: 'text' },
        { field: 'cliente', label: 'Cliente', visible: true, width: '22', align: 'left', format: 'text' },
        { field: 'tribunal_vara', label: 'Tribunal / Vara', visible: true, width: '20', align: 'left', format: 'text' },
        { field: 'tipo_acao', label: 'Ação', visible: true, width: '14', align: 'left', format: 'text' },
        { field: 'status', label: 'Status', visible: true, width: '10', align: 'center', format: 'text' },
        { field: 'busca_apreensao', label: 'Busca/Apreensão', visible: true, width: '12', align: 'center', format: 'text' },
      ],
      general: {
        ...createDefaultLayout().general,
        orientation: 'landscape',
      },
    },
    filters: [
      {
        id: 'flt_jur_status',
        placeholder: 'status',
        label: 'Status do Processo',
        type: 'select',
        defaultValue: '',
        options: ['em_acompanhamento', 'alerta_movimentacao', 'apreendido', 'suspenso', 'encerrado'],
      },
      {
        id: 'flt_jur_acao',
        placeholder: 'tipo_acao',
        label: 'Tipo de Ação',
        type: 'select',
        defaultValue: '',
        options: ['busca_apreensao', 'revisional'],
      },
    ],
    subreports: [
      {
        id: 'sub_jur_resumo_status',
        type: 'summary',
        title: 'Resumo Processual por Status',
        summary_config: {
          groupField: 'status',
          operations: [
            { field: 'numero_processo', label: 'Qtd. Processos', operation: 'count', format: 'number' },
          ],
        },
        columns: [
          { field: 'status', label: 'Status', width: 65, format: 'text', align: 'left' },
          { field: 'numero_processo_count', label: 'Qtd. Processos', width: 35, format: 'number', align: 'right' },
        ],
        totalizers: [{ field: 'numero_processo_count', operation: 'sum' }],
      },
    ],
    charts: [
      {
        id: 'cht_jur_tipo',
        type: 'bar',
        subType: 'horizontal',
        title: 'Processos por Tipo de Ação',
        xField: 'tipo_acao',
        yFields: [
          { field: 'numero_processo', label: 'Quantidade', operation: 'contagem', color: '#8B5CF6' },
        ],
        colors: [...COLOR_PALETTES.padrao],
        palette: 'padrao',
        position: 'before',
        width: '50%',
        showLegend: false,
        showDataLabels: true,
        showGrid: true,
      },
      {
        id: 'cht_jur_status',
        type: 'pie',
        subType: 'donut',
        title: 'Distribuição por Status Processual',
        xField: 'status',
        yFields: [
          { field: 'numero_processo', label: 'Qtd. Processos', operation: 'contagem', color: '#F59E0B' },
        ],
        colors: [...COLOR_PALETTES.padrao],
        palette: 'padrao',
        position: 'before',
        width: '50%',
        showLegend: true,
        showDataLabels: true,
        showGrid: false,
      },
    ],
  },
  {
    name: 'Performance de Negociações Bancárias e Deságios',
    description: 'Comparativo entre dívida original, valor acordado e economia obtida por banco negociado.',
    category: 'Negociação',
    target_layout: 'responsive',
    content_mode: 'both',
    sql_query: `SELECT
  n.id AS negociacao_id,
  COALESCE(c.full_name, n.client_name) AS cliente,
  n.bank_name AS banco,
  n.status AS status,
  ROUND(COALESCE(n.original_debt_cents, 0) / 100.0, 2) AS divida_original,
  ROUND(COALESCE(n.closed_value_cents, GREATEST(0, COALESCE(n.original_debt_cents, 0) - COALESCE(n.estimated_savings_cents, 0))) / 100.0, 2) AS valor_acordo,
  ROUND(COALESCE(n.estimated_savings_cents, 0) / 100.0, 2) AS economia_reais
FROM negotiations n
LEFT JOIN clients c ON c.id = n.client_id
WHERE (NULLIF({{status}}, '') IS NULL OR n.status = {{status}})
  AND (NULLIF({{banco}}, '') IS NULL OR n.bank_name ILIKE '%' || {{banco}} || '%')
ORDER BY COALESCE(n.estimated_savings_cents, 0) DESC, n.id DESC`,
    layout: {
      ...createDefaultLayout(),
      header: {
        show: true,
        title: 'Relatório de Negociações e Deságio Bancário',
        subtitle: 'Economia apurada na mesa de negociação por instituição credora',
        logo: '',
        alignment: 'left',
        showDate: true,
        showLogo: true,
      },
      columns: [
        { field: 'cliente', label: 'Cliente', visible: true, width: '28', align: 'left', format: 'text' },
        { field: 'banco', label: 'Banco', visible: true, width: '18', align: 'left', format: 'text' },
        { field: 'status', label: 'Status', visible: true, width: '15', align: 'center', format: 'text' },
        { field: 'divida_original', label: 'Dívida Original', visible: true, width: '13', align: 'right', format: 'currency_brl' },
        { field: 'valor_acordo', label: 'Valor Acordo', visible: true, width: '13', align: 'right', format: 'currency_brl' },
        { field: 'economia_reais', label: 'Economia', visible: true, width: '13', align: 'right', format: 'currency_brl' },
      ],
      footer: {
        show: true,
        showTotals: true,
        totalizers: [
          { field: 'divida_original', operation: 'soma' },
          { field: 'valor_acordo', operation: 'soma' },
          { field: 'economia_reais', operation: 'soma' },
        ],
        showPageNumbers: true,
        showDateTime: true,
        customText: '',
      },
    },
    filters: [
      {
        id: 'flt_neg_status',
        placeholder: 'status',
        label: 'Status da Negociação',
        type: 'select',
        defaultValue: '',
        options: ['meta_alcancada', 'proxima_meta', 'em_negociacao', 'prazo_critico', 'encerrada'],
      },
      {
        id: 'flt_neg_banco',
        placeholder: 'banco',
        label: 'Banco Credor',
        type: 'text',
        defaultValue: '',
        options: [],
      },
    ],
    subreports: [
      {
        id: 'sub_neg_resumo_banco',
        type: 'summary',
        title: 'Consolidado por Instituição Financeira',
        summary_config: {
          groupField: 'banco',
          operations: [
            { field: 'negociacao_id', label: 'Qtd.', operation: 'count', format: 'number' },
            { field: 'divida_original', label: 'Dívida Original', operation: 'sum', format: 'currency' },
            { field: 'valor_acordo', label: 'Valor Acordo', operation: 'sum', format: 'currency' },
            { field: 'economia_reais', label: 'Economia', operation: 'sum', format: 'currency' },
          ],
        },
        columns: [
          { field: 'banco', label: 'Banco', width: 26, format: 'text', align: 'left' },
          { field: 'negociacao_id_count', label: 'Qtd.', width: 10, format: 'number', align: 'right' },
          { field: 'divida_original_sum', label: 'Dívida Original', width: 22, format: 'currency', align: 'right' },
          { field: 'valor_acordo_sum', label: 'Valor Acordo', width: 21, format: 'currency', align: 'right' },
          { field: 'economia_reais_sum', label: 'Economia', width: 21, format: 'currency', align: 'right' },
        ],
        totalizers: [
          { field: 'divida_original_sum', operation: 'sum' },
          { field: 'valor_acordo_sum', operation: 'sum' },
          { field: 'economia_reais_sum', operation: 'sum' },
        ],
      },
    ],
    charts: [
      {
        id: 'cht_neg_banco',
        type: 'bar',
        subType: 'vertical',
        title: 'Dívida Original vs Economia por Banco (R$)',
        xField: 'banco',
        yFields: [
          { field: 'divida_original', label: 'Dívida Original', operation: 'soma', color: '#EF4444' },
          { field: 'economia_reais', label: 'Economia', operation: 'soma', color: '#10B981' },
        ],
        colors: [...COLOR_PALETTES.padrao],
        palette: 'padrao',
        position: 'before',
        width: '50%',
        showLegend: true,
        showDataLabels: true,
        showGrid: true,
      },
      {
        id: 'cht_neg_status',
        type: 'pie',
        subType: 'donut',
        title: 'Dívida em Negociação por Status (R$)',
        xField: 'status',
        yFields: [
          { field: 'divida_original', label: 'Dívida Original (R$)', operation: 'soma', color: '#3B82F6' },
        ],
        colors: [...COLOR_PALETTES.padrao],
        palette: 'padrao',
        position: 'before',
        width: '50%',
        showLegend: true,
        showDataLabels: true,
        showGrid: false,
      },
    ],
  },
  {
    name: 'Base Cadastral de Clientes por UF e Situação',
    description: 'Listagem cadastral completa de clientes ativos, suspensos e cancelados por unidade federativa.',
    category: 'Cadastrais',
    target_layout: 'responsive',
    content_mode: 'both',
    sql_query: `SELECT
  c.id AS codigo,
  c.full_name AS nome_completo,
  c.cpf_cnpj AS cpf_cnpj,
  c.phone AS telefone,
  c.city AS cidade,
  c.state AS uf,
  c.status AS situacao
FROM clients c
WHERE (NULLIF({{uf}}, '') IS NULL OR UPPER(c.state) = UPPER({{uf}}))
  AND (NULLIF({{situacao}}, '') IS NULL OR LOWER(c.status) = LOWER({{situacao}}))
ORDER BY c.full_name ASC`,
    layout: {
      ...createDefaultLayout(),
      header: {
        show: true,
        title: 'Relatório Cadastral de Clientes',
        subtitle: 'Contatos, localização e situação contratual',
        logo: '',
        alignment: 'left',
        showDate: true,
        showLogo: true,
      },
      columns: [
        { field: 'codigo', label: 'Cód.', visible: true, width: '8', align: 'center', format: 'number' },
        { field: 'nome_completo', label: 'Nome Completo', visible: true, width: '32', align: 'left', format: 'text' },
        { field: 'cpf_cnpj', label: 'CPF/CNPJ', visible: true, width: '16', align: 'left', format: 'cpf_cnpj' },
        { field: 'telefone', label: 'Telefone', visible: true, width: '14', align: 'left', format: 'text' },
        { field: 'cidade', label: 'Cidade', visible: true, width: '14', align: 'left', format: 'text' },
        { field: 'uf', label: 'UF', visible: true, width: '6', align: 'center', format: 'text' },
        { field: 'situacao', label: 'Situação', visible: true, width: '10', align: 'center', format: 'text' },
      ],
    },
    filters: [
      {
        id: 'flt_cli_uf',
        placeholder: 'uf',
        label: 'Estado (UF)',
        type: 'select',
        defaultValue: '',
        options: ['BA', 'CE', 'PE', 'SP'],
      },
      {
        id: 'flt_cli_situacao',
        placeholder: 'situacao',
        label: 'Situação Cadastral',
        type: 'select',
        defaultValue: '',
        options: ['ativo', 'suspenso', 'cancelado'],
      },
    ],
    subreports: [
      {
        id: 'sub_cli_resumo_uf',
        type: 'summary',
        title: 'Distribuição Cadastral por Estado (UF)',
        summary_config: {
          groupField: 'uf',
          operations: [
            { field: 'codigo', label: 'Qtd. Clientes', operation: 'count', format: 'number' },
          ],
        },
        columns: [
          { field: 'uf', label: 'Estado (UF)', width: 55, format: 'text', align: 'left' },
          { field: 'codigo_count', label: 'Qtd. Clientes', width: 45, format: 'number', align: 'right' },
        ],
        totalizers: [{ field: 'codigo_count', operation: 'sum' }],
      },
    ],
    charts: [
      {
        id: 'cht_cli_uf',
        type: 'bar',
        subType: 'vertical',
        title: 'Distribuição de Clientes por UF',
        xField: 'uf',
        yFields: [
          { field: 'codigo', label: 'Qtd. Clientes', operation: 'contagem', color: '#3B82F6' },
        ],
        colors: [...COLOR_PALETTES.padrao],
        palette: 'padrao',
        position: 'before',
        width: '50%',
        showLegend: false,
        showDataLabels: true,
        showGrid: true,
      },
      {
        id: 'cht_cli_situacao',
        type: 'pie',
        subType: 'donut',
        title: 'Clientes por Situação Cadastral',
        xField: 'situacao',
        yFields: [
          { field: 'codigo', label: 'Qtd. Clientes', operation: 'contagem', color: '#10B981' },
        ],
        colors: [...COLOR_PALETTES.padrao],
        palette: 'padrao',
        position: 'before',
        width: '50%',
        showLegend: true,
        showDataLabels: true,
        showGrid: false,
      },
    ],
  },
  {
    name: 'Carteira de Cobrança Ativa e Recuperação',
    description: 'Casos em cobrança por operador, UF/regional, dias em atraso e saldo pendente.',
    category: 'Cobrança',
    target_layout: 'responsive',
    content_mode: 'both',
    sql_query: `SELECT
  cc.id AS caso_id,
  c.full_name AS cliente,
  COALESCE(u.name, 'Não atribuído') AS operador,
  COALESCE(cc.state_code, c.state, '—') AS fase_regua,
  GREATEST(0, COALESCE((CURRENT_DATE - ft.due_date::date), 0)) AS dias_atraso,
  ROUND(COALESCE(cc.priority_value_cents, ft.current_balance_cents, ft.amount_cents, 0) / 100.0, 2) AS saldo_vencido,
  cc.status AS status
FROM collection_cases cc
JOIN clients c ON c.id = cc.client_id
LEFT JOIN users u ON u.id = cc.assigned_collector_id
LEFT JOIN financial_titles ft ON ft.id = cc.title_id
WHERE (NULLIF({{status}}, '') IS NULL OR cc.status = {{status}})
  AND (NULLIF({{uf}}, '') IS NULL OR UPPER(COALESCE(cc.state_code, c.state, '')) = UPPER({{uf}}))
ORDER BY dias_atraso DESC, cc.id DESC`,
    layout: {
      ...createDefaultLayout(),
      header: {
        show: true,
        title: 'Carteira de Cobrança e Inadimplência',
        subtitle: 'Distribuição por UF/regional e operador responsável',
        logo: '',
        alignment: 'left',
        showDate: true,
        showLogo: true,
      },
      columns: [
        { field: 'cliente', label: 'Cliente', visible: true, width: '28', align: 'left', format: 'text' },
        { field: 'operador', label: 'Operador', visible: true, width: '18', align: 'left', format: 'text' },
        { field: 'fase_regua', label: 'UF / Regional', visible: true, width: '18', align: 'left', format: 'text' },
        { field: 'dias_atraso', label: 'Dias Atraso', visible: true, width: '12', align: 'right', format: 'number' },
        { field: 'saldo_vencido', label: 'Saldo Vencido', visible: true, width: '14', align: 'right', format: 'currency_brl' },
        { field: 'status', label: 'Status', visible: true, width: '10', align: 'center', format: 'text' },
      ],
      footer: {
        show: true,
        showTotals: true,
        totalizers: [{ field: 'saldo_vencido', operation: 'soma' }],
        showPageNumbers: true,
        showDateTime: false,
        customText: '',
      },
    },
    filters: [
      {
        id: 'flt_cob_status',
        placeholder: 'status',
        label: 'Status do Caso',
        type: 'select',
        defaultValue: '',
        options: ['em_cobranca', 'acordo', 'quitado', 'pendente'],
      },
      {
        id: 'flt_cob_uf',
        placeholder: 'uf',
        label: 'UF / Regional',
        type: 'select',
        defaultValue: '',
        options: ['BA', 'CE', 'PE', 'SP'],
      },
    ],
    subreports: [
      {
        id: 'sub_cob_resumo_uf',
        type: 'summary',
        title: 'Resumo da Carteira por UF / Regional',
        summary_config: {
          groupField: 'fase_regua',
          operations: [
            { field: 'caso_id', label: 'Qtd. Casos', operation: 'count', format: 'number' },
            { field: 'saldo_vencido', label: 'Saldo Vencido', operation: 'sum', format: 'currency' },
          ],
        },
        columns: [
          { field: 'fase_regua', label: 'UF / Regional', width: 40, format: 'text', align: 'left' },
          { field: 'caso_id_count', label: 'Qtd. Casos', width: 25, format: 'number', align: 'right' },
          { field: 'saldo_vencido_sum', label: 'Saldo Vencido', width: 35, format: 'currency', align: 'right' },
        ],
        totalizers: [
          { field: 'caso_id_count', operation: 'sum' },
          { field: 'saldo_vencido_sum', operation: 'sum' },
        ],
      },
    ],
    charts: [
      {
        id: 'cht_cob_uf',
        type: 'bar',
        subType: 'vertical',
        title: 'Saldo em Cobrança por UF / Regional (R$)',
        xField: 'fase_regua',
        yFields: [
          { field: 'saldo_vencido', label: 'Saldo Vencido (R$)', operation: 'soma', color: '#F59E0B' },
        ],
        colors: [...COLOR_PALETTES.padrao],
        palette: 'padrao',
        position: 'before',
        width: '50%',
        showLegend: false,
        showDataLabels: true,
        showGrid: true,
      },
      {
        id: 'cht_cob_atraso',
        type: 'mixed',
        subType: 'vertical',
        title: 'Saldo Vencido e Dias em Atraso por Cliente',
        xField: 'cliente',
        yFields: [
          { field: 'saldo_vencido', label: 'Saldo Vencido (R$)', operation: 'direto', color: '#3B82F6', seriesType: 'bar', secondaryAxis: false },
          { field: 'dias_atraso', label: 'Dias em Atraso', operation: 'direto', color: '#EF4444', seriesType: 'line', secondaryAxis: true },
        ],
        colors: [...COLOR_PALETTES.padrao],
        palette: 'padrao',
        position: 'before',
        width: '50%',
        showLegend: true,
        showDataLabels: true,
        showGrid: true,
      },
    ],
  },
];
