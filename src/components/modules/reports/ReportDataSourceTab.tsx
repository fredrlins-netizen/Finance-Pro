import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Check,
  Code2,
  Database,
  History,
  Link2,
  Play,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Table2,
  Trash2,
  Wand2,
} from 'lucide-react';
import { apiFetch } from '../../../lib/api.ts';
import {
  buildVisualSql,
  WHERE_OPERATORS,
  type VisualJoinConfig,
  type VisualWhereConfig,
} from '../../../lib/reportCatalogs.ts';

export interface DbColumnMeta {
  table_name: string;
  column_name: string;
  data_type: string;
  is_nullable: string;
}

export interface DbForeignKeyMeta {
  table_name: string;
  column_name: string;
  foreign_table_name: string;
  foreign_column_name: string;
}

export interface SqlHistoryEntry {
  id: string;
  sql: string;
  executedAt: string;
  rowCount: number;
}

interface ReportDataSourceTabProps {
  sqlQuery: string;
  onChangeSql: (sql: string) => void;
  previewRows: Array<Record<string, any>>;
  previewColumns: string[];
  onPreviewResult: (rows: Array<Record<string, any>>, columns: string[]) => void;
  onNotify: (msg: string) => void;
}

const HISTORY_STORAGE_KEY = 'fp_reports_sql_history_v1';

export const ReportDataSourceTab: React.FC<ReportDataSourceTabProps> = ({
  sqlQuery,
  onChangeSql,
  previewRows,
  previewColumns,
  onPreviewResult,
  onNotify,
}) => {
  const [mode, setMode] = useState<'sql' | 'visual'>('sql');
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState('');
  const [truncated, setTruncated] = useState(false);
  const [totalReturned, setTotalReturned] = useState<number>(0);

  // History
  const [history, setHistory] = useState<SqlHistoryEntry[]>(() => {
    try {
      const raw = sessionStorage.getItem(HISTORY_STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch {
      // ignore storage errors
    }
    return [];
  });
  const [selectedHistoryId, setSelectedHistoryId] = useState('');

  // Schema Explorer & Visual Builder state
  const [tables, setTables] = useState<Array<{ table_name: string; table_type: string }>>([]);
  const [loadingSchema, setLoadingSchema] = useState(false);
  const [tableSearch, setTableSearch] = useState('');
  const [selectedTables, setSelectedTables] = useState<string[]>([]);
  const [columnsByTable, setColumnsByTable] = useState<Record<string, DbColumnMeta[]>>({});
  const [foreignKeys, setForeignKeys] = useState<DbForeignKeyMeta[]>([]);
  const [selectedColumns, setSelectedColumns] = useState<Array<{ table: string; column: string }>>([]);
  const [joins, setJoins] = useState<VisualJoinConfig[]>([]);
  const [wheres, setWheres] = useState<VisualWhereConfig[]>([]);
  const [groupBy, setGroupBy] = useState<string[]>([]);
  const [orderBy, setOrderBy] = useState<string[]>([]);

  const loadTables = useCallback(async () => {
    setLoadingSchema(true);
    try {
      const res = await apiFetch<{ tables: Array<{ table_name: string; table_type: string }> }>(
        '/api/reports/schema/tables'
      );
      setTables(res.tables || []);
    } catch (err: any) {
      setTestError(err?.message || 'Erro ao carregar tabelas do PostgreSQL.');
    } finally {
      setLoadingSchema(false);
    }
  }, []);

  useEffect(() => {
    void loadTables();
  }, [loadTables]);

  const loadTableDetails = useCallback(async (tableList: string[]) => {
    if (tableList.length === 0) {
      setForeignKeys([]);
      return;
    }
    try {
      const param = encodeURIComponent(tableList.join(','));
      const [colRes, fkRes] = await Promise.all([
        apiFetch<{ columns: DbColumnMeta[] }>(`/api/reports/schema/columns?tables=${param}`),
        apiFetch<{ foreignKeys: DbForeignKeyMeta[] }>(`/api/reports/schema/foreign-keys?tables=${param}`),
      ]);
      const grouped: Record<string, DbColumnMeta[]> = {};
      for (const c of colRes.columns || []) {
        if (!grouped[c.table_name]) grouped[c.table_name] = [];
        grouped[c.table_name].push(c);
      }
      setColumnsByTable(grouped);
      setForeignKeys(fkRes.foreignKeys || []);
    } catch (err) {
      console.error('Erro ao buscar metadados das tabelas:', err);
    }
  }, []);

  useEffect(() => {
    void loadTableDetails(selectedTables);
  }, [selectedTables, loadTableDetails]);

  const toggleTable = (tableName: string) => {
    setSelectedTables((prev) => {
      if (prev.includes(tableName)) {
        const next = prev.filter((t) => t !== tableName);
        setSelectedColumns((cols) => cols.filter((c) => c.table !== tableName));
        setJoins((js) => js.filter((j) => j.leftTable !== tableName && j.rightTable !== tableName));
        setWheres((ws) => ws.filter((w) => !w.field.startsWith(`${tableName}.`)));
        setGroupBy((gs) => gs.filter((g) => !g.startsWith(`${tableName}.`)));
        setOrderBy((os) => os.filter((o) => !o.startsWith(`${tableName}.`)));
        return next;
      }
      return [...prev, tableName];
    });
  };

  const toggleColumn = (table: string, column: string) => {
    setSelectedColumns((prev) => {
      const exists = prev.some((c) => c.table === table && c.column === column);
      if (exists) return prev.filter((c) => !(c.table === table && c.column === column));
      return [...prev, { table, column }];
    });
  };

  const suggestJoinsFromFk = () => {
    if (selectedTables.length < 2) {
      onNotify('Selecione ao menos 2 tabelas para sugerir relacionamentos JOIN.');
      return;
    }
    const existingKeys = new Set(
      joins.map((j) => `${j.leftTable}.${j.leftColumn}=${j.rightTable}.${j.rightColumn}`)
    );
    const added: VisualJoinConfig[] = [];
    for (const fk of foreignKeys) {
      if (selectedTables.includes(fk.table_name) && selectedTables.includes(fk.foreign_table_name)) {
        const sig = `${fk.table_name}.${fk.column_name}=${fk.foreign_table_name}.${fk.foreign_column_name}`;
        if (!existingKeys.has(sig)) {
          added.push({
            id: `join_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            leftTable: fk.table_name,
            leftColumn: fk.column_name,
            joinType: 'LEFT JOIN',
            rightTable: fk.foreign_table_name,
            rightColumn: fk.foreign_column_name,
          });
          existingKeys.add(sig);
        }
      }
    }
    if (added.length === 0) {
      onNotify('Nenhuma nova chave estrangeira encontrada entre as tabelas selecionadas.');
      return;
    }
    setJoins((prev) => [...prev, ...added]);
    onNotify(`${added.length} relacionamento(s) JOIN sugerido(s) automaticamente.`);
  };

  const visualGeneratedSql = useMemo(() => {
    return buildVisualSql({
      selectedTables,
      selectedColumns,
      joins,
      wheres,
      groupBy,
      orderBy,
    });
  }, [selectedTables, selectedColumns, joins, wheres, groupBy, orderBy]);

  const allSelectedTableFields = useMemo(() => {
    const out: string[] = [];
    for (const t of selectedTables) {
      for (const c of columnsByTable[t] || []) {
        out.push(`${t}.${c.column_name}`);
      }
    }
    return out;
  }, [selectedTables, columnsByTable]);

  const filteredTables = useMemo(() => {
    const q = tableSearch.trim().toLowerCase();
    if (!q) return tables;
    return tables.filter((t) => t.table_name.toLowerCase().includes(q));
  }, [tables, tableSearch]);

  const pushHistory = (sql: string, rowCount: number) => {
    const trimmed = sql.trim();
    if (!trimmed) return;
    setHistory((prev) => {
      const next: SqlHistoryEntry[] = [
        {
          id: `hist_${Date.now()}`,
          sql: trimmed,
          executedAt: new Date().toLocaleTimeString('pt-BR'),
          rowCount,
        },
        ...prev.filter((h) => h.sql !== trimmed),
      ].slice(0, 10);
      try {
        sessionStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore quota errors
      }
      return next;
    });
  };

  const runPreview = async (sqlToTest = sqlQuery) => {
    if (!sqlToTest.trim()) {
      setTestError('Informe uma consulta SQL SELECT para testar.');
      return;
    }
    setTesting(true);
    setTestError('');
    try {
      const res = await apiFetch<{
        rows: Array<Record<string, any>>;
        columns: string[];
        rowCount: number;
        truncated: boolean;
      }>('/api/reports/preview-query', {
        method: 'POST',
        body: JSON.stringify({ sql: sqlToTest, limit: 50 }),
      });
      const cols = res.columns && res.columns.length > 0 ? res.columns : Object.keys(res.rows?.[0] || {});
      onPreviewResult(res.rows || [], cols);
      setTruncated(Boolean(res.truncated));
      setTotalReturned(res.rowCount || res.rows?.length || 0);
      pushHistory(sqlToTest, res.rowCount || res.rows?.length || 0);
      onNotify(`Consulta executada: ${res.rows?.length || 0} linha(s) retornada(s) no preview.`);
    } catch (err: any) {
      setTestError(err?.message || 'Erro ao executar preview SQL.');
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
        <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 dark:border-slate-700 dark:bg-slate-800/70">
          <button
            type="button"
            onClick={() => setMode('sql')}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
              mode === 'sql' ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-slate-100' : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
            }`}
          >
            <Code2 className="w-3.5 h-3.5" />
            Editor SQL
          </button>
          <button
            type="button"
            onClick={() => setMode('visual')}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
              mode === 'visual' ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-slate-100' : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
            }`}
          >
            <Wand2 className="w-3.5 h-3.5" />
            Construtor Visual
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {history.length > 0 && (
            <div className="flex items-center gap-1.5">
              <History className="w-3.5 h-3.5 text-slate-400 dark:text-slate-400" />
              <select
                value={selectedHistoryId}
                onChange={(e) => {
                  const id = e.target.value;
                  setSelectedHistoryId(id);
                  const found = history.find((h) => h.id === id);
                  if (found) {
                    onChangeSql(found.sql);
                    setMode('sql');
                  }
                }}
                className="max-w-[230px] rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
              >
                <option value="">Histórico SQL ({history.length})</option>
                {history.map((h) => (
                  <option key={h.id} value={h.id}>
                    [{h.executedAt}] ({h.rowCount} lin.) {h.sql.replace(/\s+/g, ' ').slice(0, 42)}
                  </option>
                ))}
              </select>
            </div>
          )}

          <button
            type="button"
            disabled={testing}
            onClick={() => void runPreview()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-emerald-600 dark:hover:bg-emerald-500"
          >
            {testing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            Testar Consulta (Preview)
          </button>
        </div>
      </div>

      {/* Mode: Visual Builder */}
      {mode === 'visual' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Schema Explorer */}
          <div className="lg:col-span-5 rounded-xl border border-slate-200 bg-white p-3.5 space-y-3 dark:border-slate-700 dark:bg-slate-900">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Database className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                <h4 className="text-xs font-bold uppercase tracking-wide text-slate-800 dark:text-slate-100">
                  Schema Explorer (public)
                </h4>
              </div>
              <button
                type="button"
                onClick={() => void loadTables()}
                className="text-xs text-slate-500 hover:text-slate-800 inline-flex items-center gap-1 dark:text-slate-400 dark:hover:text-white"
              >
                <RefreshCw className={`w-3 h-3 ${loadingSchema ? 'animate-spin' : ''}`} />
                Atualizar
              </button>
            </div>

            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5 dark:text-slate-400" />
              <input
                type="text"
                value={tableSearch}
                onChange={(e) => setTableSearch(e.target.value)}
                placeholder="Filtrar tabelas (ex: clients, admissions...)"
                className="w-full rounded-lg border border-slate-200 pl-8 pr-3 py-1.5 text-xs text-slate-800 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:text-slate-100"
              />
            </div>

            <div className="max-h-[420px] overflow-y-auto space-y-1.5 pr-1">
              {filteredTables.map((tbl) => {
                const isSelected = selectedTables.includes(tbl.table_name);
                const cols = columnsByTable[tbl.table_name] || [];
                return (
                  <div
                    key={tbl.table_name}
                    className={`rounded-lg border ${
                      isSelected ? 'border-blue-300 bg-blue-50/40 dark:border-blue-800/70 dark:bg-blue-950/50' : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900'
                    }`}
                  >
                    <label className="flex items-center justify-between px-2.5 py-2 cursor-pointer">
                      <span className="flex items-center gap-2 text-xs font-semibold text-slate-800 dark:text-slate-100">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleTable(tbl.table_name)}
                          className="rounded border-slate-300 text-blue-600 dark:border-slate-600 dark:text-blue-400"
                        />
                        <Table2 className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
                        <span className="font-mono">{tbl.table_name}</span>
                      </span>
                      <span className="text-[11px] text-slate-400 dark:text-slate-400">
                        {tbl.table_type === 'VIEW' ? 'VIEW' : 'TABELA'}
                      </span>
                    </label>

                    {isSelected && cols.length > 0 && (
                      <div className="border-t border-slate-200/80 px-2.5 py-2 space-y-1 max-h-48 overflow-y-auto bg-white rounded-b-lg dark:bg-slate-900">
                        <div className="flex items-center justify-between pb-1">
                          <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                            Colunas ({cols.length})
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              const tableCols = cols.map((c) => ({ table: tbl.table_name, column: c.column_name }));
                              setSelectedColumns((prev) => {
                                const others = prev.filter((p) => p.table !== tbl.table_name);
                                const allChecked = tableCols.every((tc) =>
                                  prev.some((p) => p.table === tc.table && p.column === tc.column)
                                );
                                return allChecked ? others : [...others, ...tableCols];
                              });
                            }}
                            className="text-[11px] font-semibold text-blue-600 hover:underline dark:text-blue-400"
                          >
                            Marcar/Desmarcar todas
                          </button>
                        </div>
                        {cols.map((col) => {
                          const checked = selectedColumns.some(
                            (c) => c.table === tbl.table_name && c.column === col.column_name
                          );
                          return (
                            <label
                              key={col.column_name}
                              className="flex items-center justify-between text-xs py-0.5 cursor-pointer hover:bg-slate-50 px-1 rounded dark:hover:bg-slate-800"
                            >
                              <span className="flex items-center gap-1.5 text-slate-700 font-mono text-[11px] dark:text-slate-200">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => toggleColumn(tbl.table_name, col.column_name)}
                                  className="rounded border-slate-300 text-blue-600 dark:border-slate-600 dark:text-blue-400"
                                />
                                {col.column_name}
                              </span>
                              <span className="text-[10px] text-slate-400 dark:text-slate-400">{col.data_type}</span>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Joins, Filters, Ordering & Generated SQL */}
          <div className="lg:col-span-7 space-y-3">
            {/* JOINs */}
            <div className="rounded-xl border border-slate-200 bg-white p-3.5 space-y-2.5 dark:border-slate-700 dark:bg-slate-900">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-xs font-bold uppercase tracking-wide text-slate-800 flex items-center gap-1.5 dark:text-slate-100">
                  <Link2 className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                  Relacionamentos (JOIN)
                </h4>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={suggestJoinsFromFk}
                    className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    <Sparkles className="w-3 h-3 text-blue-600 dark:text-blue-400" />
                    Sugerir via FK
                  </button>
                  <button
                    type="button"
                    disabled={selectedTables.length < 2}
                    onClick={() =>
                      setJoins((prev) => [
                        ...prev,
                        {
                          id: `j_${Date.now()}`,
                          leftTable: selectedTables[0] || '',
                          leftColumn: columnsByTable[selectedTables[0]]?.[0]?.column_name || 'id',
                          joinType: 'LEFT JOIN',
                          rightTable: selectedTables[1] || selectedTables[0] || '',
                          rightColumn: columnsByTable[selectedTables[1]]?.[0]?.column_name || 'id',
                        },
                      ])
                    }
                    className="inline-flex items-center gap-1 rounded-md bg-slate-900 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-slate-800 disabled:opacity-40 dark:bg-emerald-600 dark:hover:bg-emerald-500"
                  >
                    <Plus className="w-3 h-3" />
                    JOIN
                  </button>
                </div>
              </div>

              {joins.length === 0 ? (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Selecione 2 ou mais tabelas para configurar JOINs manuais ou automáticos via chave estrangeira.
                </p>
              ) : (
                <div className="space-y-2">
                  {joins.map((j) => (
                    <div key={j.id} className="grid grid-cols-1 md:grid-cols-6 gap-1.5 items-center">
                      <select
                        value={j.joinType}
                        onChange={(e) =>
                          setJoins((prev) =>
                            prev.map((x) => (x.id === j.id ? { ...x, joinType: e.target.value as any } : x))
                          )
                        }
                        className="rounded border border-slate-200 px-2 py-1 text-xs dark:border-slate-700"
                      >
                        <option value="INNER JOIN">INNER JOIN</option>
                        <option value="LEFT JOIN">LEFT JOIN</option>
                        <option value="RIGHT JOIN">RIGHT JOIN</option>
                        <option value="FULL JOIN">FULL JOIN</option>
                      </select>
                      <select
                        value={`${j.leftTable}.${j.leftColumn}`}
                        onChange={(e) => {
                          const [lt, lc] = e.target.value.split('.');
                          setJoins((prev) =>
                            prev.map((x) => (x.id === j.id ? { ...x, leftTable: lt, leftColumn: lc } : x))
                          );
                        }}
                        className="md:col-span-2 rounded border border-slate-200 px-2 py-1 text-xs font-mono dark:border-slate-700"
                      >
                        {allSelectedTableFields.map((f) => (
                          <option key={f} value={f}>
                            {f}
                          </option>
                        ))}
                      </select>
                      <select
                        value={`${j.rightTable}.${j.rightColumn}`}
                        onChange={(e) => {
                          const [rt, rc] = e.target.value.split('.');
                          setJoins((prev) =>
                            prev.map((x) => (x.id === j.id ? { ...x, rightTable: rt, rightColumn: rc } : x))
                          );
                        }}
                        className="md:col-span-2 rounded border border-slate-200 px-2 py-1 text-xs font-mono dark:border-slate-700"
                      >
                        {allSelectedTableFields.map((f) => (
                          <option key={f} value={f}>
                            {f}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => setJoins((prev) => prev.filter((x) => x.id !== j.id))}
                        className="inline-flex justify-center rounded border border-slate-200 p-1.5 text-slate-400 hover:text-red-600 dark:border-slate-700 dark:text-slate-400"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* WHERE */}
            <div className="rounded-xl border border-slate-200 bg-white p-3.5 space-y-2.5 dark:border-slate-700 dark:bg-slate-900">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold uppercase tracking-wide text-slate-800 dark:text-slate-100">
                  Condições (WHERE)
                </h4>
                <button
                  type="button"
                  disabled={allSelectedTableFields.length === 0}
                  onClick={() =>
                    setWheres((prev) => [
                      ...prev,
                      {
                        id: `w_${Date.now()}`,
                        field: allSelectedTableFields[0] || '',
                        operator: '=',
                        value: '{{filtro}}',
                        connector: 'AND',
                      },
                    ])
                  }
                  className="inline-flex items-center gap-1 rounded-md bg-slate-900 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-slate-800 disabled:opacity-40 dark:bg-emerald-600 dark:hover:bg-emerald-500"
                >
                  <Plus className="w-3 h-3" />
                  Condição
                </button>
              </div>
              {wheres.length === 0 ? (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Use <code className="bg-slate-100 px-1 rounded dark:bg-slate-800">{'{{nome_filtro}}'}</code> no valor para criar filtros dinâmicos parametrizados.
                </p>
              ) : (
                <div className="space-y-2">
                  {wheres.map((w, idx) => (
                    <div key={w.id} className="grid grid-cols-1 md:grid-cols-12 gap-1.5 items-center">
                      <div className="md:col-span-2">
                        {idx === 0 ? (
                          <span className="text-[11px] font-bold text-slate-500 px-2 dark:text-slate-400">WHERE</span>
                        ) : (
                          <select
                            value={w.connector}
                            onChange={(e) =>
                              setWheres((prev) =>
                                prev.map((x) => (x.id === w.id ? { ...x, connector: e.target.value as any } : x))
                              )
                            }
                            className="w-full rounded border border-slate-200 px-2 py-1 text-xs dark:border-slate-700"
                          >
                            <option value="AND">AND</option>
                            <option value="OR">OR</option>
                          </select>
                        )}
                      </div>
                      <select
                        value={w.field}
                        onChange={(e) =>
                          setWheres((prev) => prev.map((x) => (x.id === w.id ? { ...x, field: e.target.value } : x)))
                        }
                        className="md:col-span-4 rounded border border-slate-200 px-2 py-1 text-xs font-mono dark:border-slate-700"
                      >
                        {allSelectedTableFields.map((f) => (
                          <option key={f} value={f}>
                            {f}
                          </option>
                        ))}
                      </select>
                      <select
                        value={w.operator}
                        onChange={(e) =>
                          setWheres((prev) =>
                            prev.map((x) => (x.id === w.id ? { ...x, operator: e.target.value } : x))
                          )
                        }
                        className="md:col-span-2 rounded border border-slate-200 px-2 py-1 text-xs dark:border-slate-700"
                      >
                        {WHERE_OPERATORS.map((op) => (
                          <option key={op} value={op}>
                            {op}
                          </option>
                        ))}
                      </select>
                      <input
                        type="text"
                        disabled={w.operator === 'IS NULL' || w.operator === 'IS NOT NULL'}
                        value={w.value}
                        onChange={(e) =>
                          setWheres((prev) => prev.map((x) => (x.id === w.id ? { ...x, value: e.target.value } : x)))
                        }
                        placeholder="Valor ou {{param}}"
                        className="md:col-span-3 rounded border border-slate-200 px-2 py-1 text-xs font-mono disabled:bg-slate-50 dark:border-slate-700"
                      />
                      <button
                        type="button"
                        onClick={() => setWheres((prev) => prev.filter((x) => x.id !== w.id))}
                        className="md:col-span-1 inline-flex justify-center rounded border border-slate-200 p-1.5 text-slate-400 hover:text-red-600 dark:border-slate-700 dark:text-slate-400"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* GROUP BY & ORDER BY */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-1.5 dark:border-slate-700 dark:bg-slate-900">
                <span className="text-[11px] font-bold uppercase tracking-wide text-slate-700 dark:text-slate-200">GROUP BY</span>
                <select
                  multiple
                  value={groupBy}
                  onChange={(e) => setGroupBy(Array.from(e.target.selectedOptions).map((o) => o.value))}
                  className="w-full h-24 rounded border border-slate-200 p-1 text-xs font-mono dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                >
                  {selectedColumns.map((c) => {
                    const key = `${c.table}.${c.column}`;
                    return (
                      <option key={key} value={key}>
                        {key}
                      </option>
                    );
                  })}
                </select>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-1.5 dark:border-slate-700 dark:bg-slate-900">
                <span className="text-[11px] font-bold uppercase tracking-wide text-slate-700 dark:text-slate-200">ORDER BY</span>
                <select
                  multiple
                  value={orderBy}
                  onChange={(e) => setOrderBy(Array.from(e.target.selectedOptions).map((o) => o.value))}
                  className="w-full h-24 rounded border border-slate-200 p-1 text-xs font-mono dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                >
                  {allSelectedTableFields.flatMap((f) => [
                    <option key={`${f} ASC`} value={`${f} ASC`}>
                      {f} ASC
                    </option>,
                    <option key={`${f} DESC`} value={`${f} DESC`}>
                      {f} DESC
                    </option>,
                  ])}
                </select>
              </div>
            </div>

            {/* Visual SQL Preview + Apply */}
            <div className="rounded-xl border border-slate-200 bg-slate-950 p-3.5 space-y-2.5 text-slate-100 dark:border-slate-700">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wide text-slate-300">
                  SQL Gerado Automaticamente
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={!visualGeneratedSql}
                    onClick={() => {
                      onChangeSql(visualGeneratedSql);
                      setMode('sql');
                      onNotify('SQL gerado aplicado ao Editor.');
                    }}
                    className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-40"
                  >
                    <Check className="w-3.5 h-3.5" />
                    Aplicar no Editor SQL
                  </button>
                </div>
              </div>
              <pre className="text-[11px] font-mono text-emerald-300 whitespace-pre-wrap max-h-40 overflow-y-auto">
                {visualGeneratedSql || '-- Selecione uma tabela e ao menos uma coluna ao lado para gerar a consulta.'}
              </pre>
            </div>
          </div>
        </div>
      )}

      {/* Mode: SQL Editor */}
      {mode === 'sql' && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3 dark:border-slate-700 dark:bg-slate-900">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wide text-slate-800 dark:text-slate-100">
                Consulta SQL Somente Leitura (SELECT / WITH)
              </h4>
              <p className="text-xs text-slate-500 mt-0.5 dark:text-slate-400">
                Use parâmetros dinâmicos com <code className="bg-slate-100 px-1 rounded dark:bg-slate-800">{'{{nome_filtro}}'}</code>{' '}
                (ex.: <code className="bg-slate-100 px-1 rounded dark:bg-slate-800">{"WHERE NULLIF({{status}}, '') IS NULL OR status = {{status}}"}</code>).
              </p>
            </div>
          </div>

          <textarea
            value={sqlQuery}
            onChange={(e) => onChangeSql(e.target.value)}
            rows={11}
            spellCheck={false}
            placeholder="SELECT id, name, status FROM clients ORDER BY created_at DESC"
            className="w-full rounded-lg border border-slate-300 bg-slate-950 p-3.5 font-mono text-xs text-emerald-300 focus:border-blue-500 focus:outline-none leading-relaxed dark:border-slate-600"
          />

          {testError && (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{testError}</span>
            </div>
          )}
        </div>
      )}

      {/* Preview Data Table */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden dark:border-slate-700 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2.5 dark:border-slate-700 dark:bg-slate-800/70">
          <span className="text-xs font-bold text-slate-800 dark:text-slate-100">
            Preview dos Dados ({previewRows.length} linha(s), {previewColumns.length} coluna(s))
          </span>
          {truncated && (
            <span className="text-[11px] font-medium text-amber-700 dark:text-amber-300">
              Exibindo amostra limitada ao preview ({totalReturned} linhas carregadas).
            </span>
          )}
        </div>

        {previewRows.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">
            Clique em <strong>Testar Consulta (Preview)</strong> para validar a query e detectar as colunas automaticamente.
          </div>
        ) : (
          <div className="overflow-x-auto max-h-72">
            <table className="w-full text-left border-collapse text-xs tabular-nums">
              <thead className="sticky top-0 bg-slate-100 text-slate-700 border-b border-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700">
                <tr>
                  {previewColumns.map((col) => (
                    <th key={col} className="px-3 py-2 font-semibold whitespace-nowrap border-r border-slate-200/60">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {previewRows.slice(0, 50).map((row, rIdx) => (
                  <tr key={rIdx} className="hover:bg-slate-50 dark:hover:bg-slate-800">
                    {previewColumns.map((col) => (
                      <td
                        key={col}
                        className="px-3 py-1.5 text-slate-700 whitespace-nowrap max-w-[260px] truncate border-r border-slate-100 dark:text-slate-200 dark:border-slate-800"
                        title={row[col] == null ? '' : String(row[col])}
                      >
                        {row[col] == null ? <span className="text-slate-300">NULL</span> : String(row[col])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
