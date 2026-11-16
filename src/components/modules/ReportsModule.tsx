import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  BookOpen,
  ChevronDown,
  ChevronRight,
  CopyPlus,
  Database,
  Eye,
  FileBarChart2,
  Filter,
  Folder,
  FolderOpen,
  GraduationCap,
  History,
  Layers,
  Layout,
  Lock,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import { apiFetch } from '../../lib/api.ts';
import {
  ensurePortalBrandingLoaded,
  getCachedLogoNeedsDarkBackdrop,
  getCachedPortalBranding,
  setCachedPortalBranding,
  subscribePortalBranding,
} from '../../lib/portalBrandingCache.ts';
import type {
  AuthUser,
  PortalBrandingConfig,
  ReportColumnDef,
  ReportTemplateItem,
  Unit,
} from '../../types.ts';
import {
  COLOR_PALETTES,
  createEmptyReportTemplate,
  normalizeLayoutConfig,
  REPORT_CATEGORIES,
} from '../../lib/reportCatalogs.ts';
import { ConfirmDeleteModal } from './CollectionCoordinatorModalViews.tsx';
import { EntityAuditModal } from './cadastros/CadastrosShared.tsx';
import { ReportDataSourceTab } from './reports/ReportDataSourceTab.tsx';
import { ReportLayoutTab } from './reports/ReportLayoutTab.tsx';
import { ReportChartsTab } from './reports/ReportChartsTab.tsx';
import { ReportFiltersTab } from './reports/ReportFiltersTab.tsx';
import { ReportSubreportsTab } from './reports/ReportSubreportsTab.tsx';
import { ReportGuideTab } from './reports/ReportGuideTab.tsx';
import { ReportRenderer } from './reports/ReportRenderer.tsx';
import { GUIDED_STARTER_SQL, ReportTrainingModal } from './reports/ReportTrainingModal.tsx';

type EditorTabId = 'datasource' | 'layout' | 'charts' | 'filters' | 'subreports' | 'guide';

interface AclOptionUser {
  id: number;
  name: string;
  email: string;
  role: string;
}

interface AclOptionGroup {
  id: number;
  name: string;
}

export const ReportsModule: React.FC<{
  currentUser: AuthUser;
  units?: Unit[];
  wsTick?: number;
  branding?: PortalBrandingConfig | null;
}> = ({ currentUser, wsTick, branding }) => {
  const isAdmin = currentUser.role === 'admin';
  const [fetchedBranding, setFetchedBranding] = useState<PortalBrandingConfig | null>(() =>
    getCachedPortalBranding()
  );
  const [darkBackdrop, setDarkBackdrop] = useState<boolean>(() =>
    getCachedLogoNeedsDarkBackdrop()
  );

  useEffect(() => {
    if (branding) {
      setCachedPortalBranding(branding);
    } else {
      void ensurePortalBrandingLoaded();
    }
    return subscribePortalBranding((nextB, nextDark) => {
      setFetchedBranding(nextB);
      setDarkBackdrop(nextDark);
    });
  }, [branding]);

  const activeBranding = branding || fetchedBranding;

  const [templates, setTemplates] = useState<ReportTemplateItem[]>([]);
  const [aclOptions, setAclOptions] = useState<{
    users: AclOptionUser[];
    groups: AclOptionGroup[];
  }>({ users: [], groups: [] });
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarSearch, setSidebarSearch] = useState('');
  const [expandedCats, setExpandedCats] = useState<Record<string, boolean>>(() => {
    const map: Record<string, boolean> = {};
    for (const c of REPORT_CATEGORIES) map[c] = true;
    return map;
  });

  // Active working draft
  const [draft, setDraft] = useState<ReportTemplateItem>(() => createEmptyReportTemplate());
  const [originalSnapshot, setOriginalSnapshot] = useState<string>(() =>
    JSON.stringify(createEmptyReportTemplate())
  );
  const [viewMode, setViewMode] = useState<'editor' | 'preview'>(isAdmin ? 'editor' : 'preview');
  const [activeTab, setActiveTab] = useState<EditorTabId>('datasource');
  const [previewRows, setPreviewRows] = useState<Array<Record<string, any>>>([]);
  const [previewColumns, setPreviewColumns] = useState<string[]>([]);

  // Modals & notifications
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [saveAsNew, setSaveAsNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<ReportTemplateItem | null>(null);
  const [auditTarget, setAuditTarget] = useState<ReportTemplateItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [pendingAction, setPendingAction] = useState<null | (() => void)>(null);
  const [trainingModalOpen, setTrainingModalOpen] = useState(false);
  const [toastMsg, setToastMsg] = useState('');

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    window.setTimeout(() => setToastMsg((curr) => (curr === msg ? '' : curr)), 3500);
  }, []);

  const isDirty = useMemo(() => {
    if (!isAdmin) return false;
    return JSON.stringify(draft) !== originalSnapshot;
  }, [draft, originalSnapshot, isAdmin]);

  const selectTemplateDirect = useCallback(
    (tpl: ReportTemplateItem) => {
      const cloned: ReportTemplateItem = JSON.parse(
        JSON.stringify({
          ...tpl,
          layout: normalizeLayoutConfig(tpl.layout),
          filters: Array.isArray(tpl.filters) ? tpl.filters : [],
          subreports: Array.isArray(tpl.subreports) ? tpl.subreports : [],
          charts: Array.isArray(tpl.charts) ? tpl.charts : [],
        })
      );
      setDraft(cloned);
      setOriginalSnapshot(JSON.stringify(cloned));
      setPreviewRows([]);
      setPreviewColumns(cloned.layout.columns.map((c) => c.field));
      if (!isAdmin) {
        setViewMode('preview');
      }
    },
    [isAdmin]
  );

  const loadTemplates = useCallback(
    async (silent = false, preferSelectId?: string) => {
      if (!silent) setLoading(true);
      try {
        const res = await apiFetch<{
          templates: ReportTemplateItem[];
          aclOptions?: { users: AclOptionUser[]; groups: AclOptionGroup[] };
        }>('/api/reports/templates');
        const list = res.templates || [];
        setTemplates(list);
        if (res.aclOptions) setAclOptions(res.aclOptions);

        if (list.length > 0) {
          const target =
            (preferSelectId ? list.find((t) => t.id === preferSelectId) : null) ||
            (draft.id ? list.find((t) => t.id === draft.id) : null) ||
            list[0];
          if (target && (!silent || preferSelectId || !draft.id)) {
            selectTemplateDirect(target);
          }
        }
      } catch (err) {
        console.error('Erro ao carregar modelos de relatório:', err);
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectTemplateDirect]
  );

  useEffect(() => {
    void loadTemplates();
  }, [loadTemplates]);

  const prevWsRef = useRef(wsTick);
  useEffect(() => {
    if (prevWsRef.current === wsTick) return;
    prevWsRef.current = wsTick;
    const t = window.setTimeout(() => void loadTemplates(true), 500);
    return () => window.clearTimeout(t);
  }, [wsTick, loadTemplates]);

  const guardUnsaved = (action: () => void) => {
    if (isDirty) {
      setPendingAction(() => action);
      return;
    }
    action();
  };

  const handleNewTemplate = () => {
    guardUnsaved(() => {
      const fresh = createEmptyReportTemplate();
      setDraft(fresh);
      setOriginalSnapshot(JSON.stringify(fresh));
      setPreviewRows([]);
      setPreviewColumns([]);
      setActiveTab('datasource');
      setViewMode('editor');
    });
  };

  const handleStartGuidedStarter = () => {
    guardUnsaved(() => {
      const base = createEmptyReportTemplate();
      const guided: ReportTemplateItem = {
        ...base,
        name: 'Novo Relatório · Passivo por Cliente e UF',
        description: 'Modelo inicial guiado criado no treinamento prático.',
        category: 'Gerenciais',
        content_mode: 'both',
        sql_query: GUIDED_STARTER_SQL,
        layout: {
          ...base.layout,
          header: {
            ...base.layout.header,
            title: 'Passivo por Cliente e UF',
            subtitle: 'Consulta guiada criada do zero',
          },
          columns: [
            { field: 'codigo', label: 'Cód.', visible: true, width: '8', align: 'center', format: 'number' },
            { field: 'cliente', label: 'Cliente', visible: true, width: '30', align: 'left', format: 'text' },
            { field: 'cidade', label: 'Cidade', visible: true, width: '18', align: 'left', format: 'text' },
            { field: 'uf', label: 'UF', visible: true, width: '8', align: 'center', format: 'text' },
            { field: 'situacao', label: 'Situação', visible: true, width: '12', align: 'center', format: 'text' },
            { field: 'qtd_contratos', label: 'Contratos', visible: true, width: '10', align: 'right', format: 'number' },
            { field: 'passivo_total', label: 'Passivo Total', visible: true, width: '14', align: 'right', format: 'currency_brl' },
          ],
          footer: {
            ...base.layout.footer,
            showTotals: true,
            totalizers: [{ field: 'passivo_total', operation: 'soma' }],
          },
        },
        filters: [
          {
            id: 'flt_guided_uf',
            placeholder: 'uf',
            label: 'Estado (UF)',
            type: 'select',
            defaultValue: '',
            options: ['BA', 'CE', 'PE', 'SP'],
          },
        ],
        charts: [
          {
            id: 'cht_guided_uf',
            type: 'bar',
            subType: 'vertical',
            title: 'Passivo Total por UF (R$)',
            xField: 'uf',
            yFields: [{ field: 'passivo_total', label: 'Passivo (R$)', operation: 'soma', color: '#3B82F6' }],
            colors: [...COLOR_PALETTES.padrao],
            palette: 'padrao',
            position: 'before',
            width: '50%',
            showLegend: false,
            showDataLabels: true,
            showGrid: true,
          },
          {
            id: 'cht_guided_sit',
            type: 'pie',
            subType: 'donut',
            title: 'Clientes por Situação',
            xField: 'situacao',
            yFields: [{ field: 'codigo', label: 'Qtd. Clientes', operation: 'contagem', color: '#10B981' }],
            colors: [...COLOR_PALETTES.padrao],
            palette: 'padrao',
            position: 'before',
            width: '50%',
            showLegend: true,
            showDataLabels: true,
            showGrid: false,
          },
        ],
      };
      setDraft(guided);
      setOriginalSnapshot(JSON.stringify(base));
      setPreviewRows([]);
      setPreviewColumns(['codigo', 'cliente', 'cidade', 'uf', 'situacao', 'qtd_contratos', 'passivo_total']);
      setActiveTab('datasource');
      setViewMode('editor');
      showToast('Modelo guiado carregado! Clique em "Testar SQL" e explore as abas.');
    });
  };

  const handleSelectTemplate = (tpl: ReportTemplateItem) => {
    if (tpl.id === draft.id && !isDirty) return;
    guardUnsaved(() => {
      selectTemplateDirect(tpl);
    });
  };

  const patchDraft = useCallback((patch: Partial<ReportTemplateItem>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
  }, []);

  const syncColumnsFromCols = useCallback((cols: string[]) => {
    setDraft((prev) => {
      const currentLayout = normalizeLayoutConfig(prev.layout);
      const existingByField = new Map(currentLayout.columns.map((c) => [c.field, c]));
      const nextCols: ReportColumnDef[] = cols.map((field) => {
        const existing = existingByField.get(field);
        if (existing) return existing;
        return {
          field,
          label: field.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase()),
          visible: true,
          width: 'auto',
          align: 'left',
          format: 'text',
        };
      });
      return {
        ...prev,
        layout: {
          ...currentLayout,
          columns: nextCols,
        },
      };
    });
  }, []);

  const handlePreviewResult = useCallback(
    (rows: Array<Record<string, any>>, cols: string[]) => {
      setPreviewRows(rows);
      setPreviewColumns(cols);
      if (cols.length > 0 && draft.layout.columns.length === 0) {
        syncColumnsFromCols(cols);
      }
    },
    [draft.layout.columns.length, syncColumnsFromCols]
  );

  const openSaveDialog = (asCopy = false) => {
    setSaveAsNew(asCopy);
    setSaveError('');
    if (asCopy && draft.name) {
      setDraft((prev) => ({ ...prev, name: `${prev.name} (Cópia)` }));
    }
    setSaveModalOpen(true);
  };

  const handleSaveSubmit = async () => {
    if (!draft.name.trim()) {
      setSaveError('Informe o nome do relatório.');
      return;
    }
    if (!draft.sql_query.trim()) {
      setSaveError('Informe a consulta SQL SELECT na aba Fonte de Dados antes de salvar.');
      return;
    }

    setSaving(true);
    setSaveError('');
    try {
      const isUpdating = Boolean(draft.id) && !saveAsNew;
      const endpoint = isUpdating
        ? `/api/reports/templates/${draft.id}`
        : '/api/reports/templates';
      const method = isUpdating ? 'PUT' : 'POST';

      const payload = {
        name: draft.name.trim(),
        description: draft.description || '',
        category: draft.category || 'Outros',
        target_layout: draft.target_layout || 'responsive',
        content_mode: draft.content_mode || 'both',
        sql_query: draft.sql_query,
        layout: normalizeLayoutConfig(draft.layout),
        filters: draft.filters || [],
        subreports: draft.subreports || [],
        charts: draft.charts || [],
        allowed_users:
          draft.allowed_users && draft.allowed_users.length > 0 ? draft.allowed_users : null,
        allowed_groups:
          draft.allowed_groups && draft.allowed_groups.length > 0 ? draft.allowed_groups : null,
      };

      const res = await apiFetch<{ template: ReportTemplateItem }>(endpoint, {
        method,
        body: JSON.stringify(payload),
      });

      setSaveModalOpen(false);
      await loadTemplates(true, res.template.id);
      showToast(isUpdating ? 'Relatório atualizado com sucesso.' : 'Relatório criado com sucesso.');
    } catch (err: any) {
      setSaveError(err?.message || 'Erro ao salvar modelo de relatório.');
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiFetch(`/api/reports/templates/${deleteTarget.id}`, { method: 'DELETE' });
      const deletedId = deleteTarget.id;
      setDeleteTarget(null);
      const remaining = templates.filter((t) => t.id !== deletedId);
      setTemplates(remaining);
      if (draft.id === deletedId) {
        if (remaining[0]) {
          selectTemplateDirect(remaining[0]);
        } else {
          const fresh = createEmptyReportTemplate();
          setDraft(fresh);
          setOriginalSnapshot(JSON.stringify(fresh));
        }
      }
      showToast('Relatório removido.');
    } catch (err: any) {
      showToast(err?.message || 'Erro ao remover relatório.');
    } finally {
      setDeleting(false);
    }
  };

  const groupedTemplates = useMemo(() => {
    const q = sidebarSearch.trim().toLowerCase();
    const byCat = new Map<string, ReportTemplateItem[]>();
    for (const c of REPORT_CATEGORIES) byCat.set(c, []);

    for (const tpl of templates) {
      if (
        q &&
        !tpl.name.toLowerCase().includes(q) &&
        !(tpl.description || '').toLowerCase().includes(q) &&
        !(tpl.category || '').toLowerCase().includes(q)
      ) {
        continue;
      }
      const cat = REPORT_CATEGORIES.includes(tpl.category as any) ? tpl.category : 'Outros';
      byCat.get(cat)!.push(tpl);
    }
    return Array.from(byCat.entries()).filter(([, items]) => items.length > 0 || !q);
  }, [templates, sidebarSearch]);

  const availableColumns = useMemo(() => {
    const set = new Set<string>([
      ...previewColumns,
      ...draft.layout.columns.map((c) => c.field),
    ]);
    return Array.from(set).filter(Boolean);
  }, [previewColumns, draft.layout.columns]);

  return (
    <div className="space-y-4">
      {/* Header Bar */}
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={() => setSidebarOpen((v) => !v)}
            title={sidebarOpen ? 'Recolher biblioteca' : 'Expandir biblioteca'}
            className="rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-50 shrink-0 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            {sidebarOpen ? (
              <PanelLeftClose className="w-4 h-4" />
            ) : (
              <PanelLeftOpen className="w-4 h-4" />
            )}
          </button>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <FileBarChart2 className="w-4 h-4 text-blue-600 shrink-0 dark:text-blue-400" />
              <h1 className="font-display text-base font-bold text-slate-900 truncate dark:text-slate-100">
                {draft.name || 'Novo Relatório'}
              </h1>
              {isDirty && (
                <span className="text-[11px] font-semibold text-amber-600 shrink-0 dark:text-amber-400">
                  · Alterações não salvas
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 truncate dark:text-slate-400">
              {draft.description || `${draft.category} · Formulários & Relatórios`}
            </p>
          </div>
        </div>

        {/* Centered Company Logo from Portal & Identidade */}
        <div className="flex items-center justify-center justify-self-center">
          {activeBranding?.logoDataUrl ? (
            <div
              className={`inline-flex items-center justify-center rounded-xl border px-3.5 py-1.5 ${
                darkBackdrop
                  ? 'bg-slate-900 border-slate-800 dark:bg-slate-950 dark:border-slate-700'
                  : 'bg-white border-slate-200 dark:bg-slate-900 dark:border-slate-700'
              }`}
            >
              <img
                src={activeBranding.logoDataUrl}
                alt={activeBranding.companyName || 'Logomarca da Empresa'}
                title={activeBranding.companyName || 'Logomarca da Empresa'}
                referrerPolicy="no-referrer"
                className="h-10 max-w-[200px] w-auto object-contain"
              />
            </div>
          ) : (
            <div className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-700 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-200">
              <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <span>{activeBranding?.companyName?.trim() || 'FinancePro'}</span>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 xl:justify-self-end">
          <button
            type="button"
            onClick={() => setTrainingModalOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100 dark:border-blue-800/70 dark:bg-blue-950/50 dark:text-blue-300 dark:hover:bg-blue-900/60"
          >
            <GraduationCap className="w-3.5 h-3.5" />
            Treinamento: Montar do Zero
          </button>

          {isAdmin && (
            <>
              <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 dark:border-slate-700 dark:bg-slate-800/70">
                <button
                  type="button"
                  onClick={() => setViewMode('editor')}
                  className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold ${
                    viewMode === 'editor'
                      ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-slate-100'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
                  }`}
                >
                  <Pencil className="w-3.5 h-3.5" />
                  Editor
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('preview')}
                  className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold ${
                    viewMode === 'preview'
                      ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-slate-100'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
                  }`}
                >
                  <Eye className="w-3.5 h-3.5" />
                  Preview / Exportar
                </button>
              </div>

              <button
                type="button"
                onClick={() => openSaveDialog(false)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-emerald-600 dark:hover:bg-emerald-500"
              >
                <Save className="w-3.5 h-3.5" />
                Salvar
              </button>

              {draft.id && (
                <>
                  <button
                    type="button"
                    onClick={() => setAuditTarget(draft)}
                    title="Auditoria de alterações do modelo de relatório"
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    <History className="w-3.5 h-3.5" />
                    Auditoria
                  </button>
                  <button
                    type="button"
                    onClick={() => openSaveDialog(true)}
                    title="Salvar como novo modelo"
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    <CopyPlus className="w-3.5 h-3.5" />
                    Duplicar
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteTarget(draft)}
                    title="Excluir modelo"
                    className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 dark:border-red-800/70 dark:bg-slate-900 dark:text-red-400 dark:hover:bg-red-950/60"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </>
              )}
            </>
          )}
        </div>
      </div>

      {/* Main Split Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        {/* Left Category Tree Sidebar */}
        {sidebarOpen && (
          <aside className="lg:col-span-3 rounded-xl border border-slate-200 bg-white p-3 space-y-3 dark:border-slate-700 dark:bg-slate-900">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wide text-slate-700 dark:text-slate-200">
                Biblioteca ({templates.length})
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => void loadTemplates()}
                  title="Recarregar modelos"
                  className="p-1 text-slate-400 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                </button>
                {isAdmin && (
                  <button
                    type="button"
                    onClick={handleNewTemplate}
                    className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-blue-700"
                  >
                    <Plus className="w-3 h-3" />
                    Novo
                  </button>
                )}
              </div>
            </div>

            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5 dark:text-slate-400" />
              <input
                type="text"
                value={sidebarSearch}
                onChange={(e) => setSidebarSearch(e.target.value)}
                placeholder="Buscar relatórios..."
                className="w-full rounded-lg border border-slate-200 pl-8 pr-3 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>

            <div className="max-h-[68vh] overflow-y-auto space-y-1 pr-0.5">
              {loading && templates.length === 0 ? (
                <div className="py-6 text-center text-xs text-slate-400 dark:text-slate-400">Carregando modelos...</div>
              ) : groupedTemplates.length === 0 ? (
                <div className="py-6 text-center text-xs text-slate-400 dark:text-slate-400">
                  Nenhum relatório encontrado.
                </div>
              ) : (
                groupedTemplates.map(([cat, items]) => {
                  const isOpen = expandedCats[cat] ?? true;
                  return (
                    <div key={cat} className="space-y-0.5">
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedCats((prev) => ({ ...prev, [cat]: !isOpen }))
                        }
                        className="w-full flex items-center justify-between rounded-lg px-2 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"
                      >
                        <span className="flex items-center gap-1.5 truncate">
                          {isOpen ? (
                            <ChevronDown className="w-3.5 h-3.5 text-slate-400 dark:text-slate-400" />
                          ) : (
                            <ChevronRight className="w-3.5 h-3.5 text-slate-400 dark:text-slate-400" />
                          )}
                          {isOpen ? (
                            <FolderOpen className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                          ) : (
                            <Folder className="w-3.5 h-3.5 text-slate-400 dark:text-slate-400" />
                          )}
                          <span className="truncate">{cat}</span>
                        </span>
                        <span className="text-[11px] font-normal text-slate-400 tabular-nums dark:text-slate-400">
                          {items.length}
                        </span>
                      </button>

                      {isOpen && (
                        <div className="pl-5 space-y-0.5">
                          {items.length === 0 ? (
                            <div className="px-2 py-1 text-[11px] text-slate-400 italic dark:text-slate-400">
                              Vazio
                            </div>
                          ) : (
                            items.map((tpl) => {
                              const active = draft.id === tpl.id;
                              const restricted =
                                (tpl.allowed_users && tpl.allowed_users.length > 0) ||
                                (tpl.allowed_groups && tpl.allowed_groups.length > 0);
                              return (
                                <button
                                  key={tpl.id}
                                  type="button"
                                  onClick={() => handleSelectTemplate(tpl)}
                                  className={`w-full text-left flex items-center justify-between gap-1.5 rounded-lg px-2.5 py-1.5 text-xs transition-colors ${
                                    active
                                      ? 'bg-slate-900 text-white font-semibold dark:bg-emerald-600'
                                      : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                                  }`}
                                >
                                  <span className="truncate">{tpl.name}</span>
                                  {restricted && (
                                    <Lock
                                      className={`w-3 h-3 shrink-0 ${
                                        active ? 'text-slate-300' : 'text-slate-400 dark:text-slate-400'
                                      }`}
                                    />
                                  )}
                                </button>
                              );
                            })
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </aside>
        )}

        {/* Right Workspace */}
        <div className={sidebarOpen ? 'lg:col-span-9 space-y-4' : 'lg:col-span-12 space-y-4'}>
          {viewMode === 'preview' || !isAdmin ? (
            !draft.sql_query?.trim() && !draft.id ? (
              <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
                Selecione um relatório na biblioteca ao lado para visualizar e exportar os dados.
              </div>
            ) : (
              <ReportRenderer
                template={draft}
                isAdmin={isAdmin}
                isDirtyDraft={isDirty || !draft.id}
                branding={activeBranding}
                onRowsLoaded={handlePreviewResult}
                onNotify={showToast}
              />
            )
          ) : (
            <div className="space-y-4">
              {/* 6 Editor Tabs */}
              <div className="flex flex-wrap items-center gap-1 rounded-xl border border-slate-200 bg-white p-1.5 dark:border-slate-700 dark:bg-slate-900">
                {[
                  { id: 'datasource', label: 'Fonte de Dados', icon: Database },
                  { id: 'layout', label: 'Layout', icon: Layout },
                  { id: 'charts', label: `Gráficos (${draft.charts.length})`, icon: BarChart3 },
                  { id: 'filters', label: `Filtros (${draft.filters.length})`, icon: Filter },
                  {
                    id: 'subreports',
                    label: `Sub-relatórios (${draft.subreports.length})`,
                    icon: Layers,
                  },
                  { id: 'guide', label: 'Guia', icon: BookOpen },
                ].map((tab) => {
                  const Icon = tab.icon;
                  const active = activeTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setActiveTab(tab.id as EditorTabId)}
                      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                        active
                          ? 'bg-slate-900 text-white dark:bg-emerald-600'
                          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      {tab.label}
                    </button>
                  );
                })}
              </div>

              {activeTab === 'datasource' && (
                <ReportDataSourceTab
                  sqlQuery={draft.sql_query}
                  onChangeSql={(sql) => patchDraft({ sql_query: sql })}
                  previewRows={previewRows}
                  previewColumns={previewColumns}
                  onPreviewResult={handlePreviewResult}
                  onNotify={showToast}
                />
              )}

              {activeTab === 'layout' && (
                <ReportLayoutTab
                  template={draft}
                  previewColumns={previewColumns}
                  onChangeTemplate={patchDraft}
                  onSyncColumnsFromPreview={() => {
                    syncColumnsFromCols(previewColumns);
                    showToast('Colunas sincronizadas com o último preview SQL.');
                  }}
                />
              )}

              {activeTab === 'charts' && (
                <ReportChartsTab
                  charts={draft.charts}
                  availableColumns={availableColumns}
                  previewRows={previewRows}
                  onChangeCharts={(charts) => patchDraft({ charts })}
                />
              )}

              {activeTab === 'filters' && (
                <ReportFiltersTab
                  filters={draft.filters}
                  sqlQuery={draft.sql_query}
                  availableColumns={availableColumns}
                  onChangeFilters={(filters) => patchDraft({ filters })}
                />
              )}

              {activeTab === 'subreports' && (
                <ReportSubreportsTab
                  subreports={draft.subreports}
                  availableColumns={availableColumns}
                  previewRows={previewRows}
                  onChangeSubreports={(subreports) => patchDraft({ subreports })}
                />
              )}

              {activeTab === 'guide' && (
                <ReportGuideTab
                  onApplySnippet={(sql) => {
                    patchDraft({ sql_query: sql });
                    setActiveTab('datasource');
                    showToast('Exemplo SQL aplicado ao Editor.');
                  }}
                />
              )}
            </div>
          )}
        </div>
      </div>

      {/* Save / ACL Modal */}
      {saveModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 dark:bg-slate-950/80"
          onClick={() => !saving && setSaveModalOpen(false)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              void handleSaveSubmit();
            } else if (e.key === 'Escape' && !saving) {
              setSaveModalOpen(false);
            }
          }}
        >
          <div
            className="w-full max-w-2xl rounded-xl border border-slate-200 bg-white shadow-2xl overflow-hidden dark:border-slate-700 dark:bg-slate-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-5 py-3.5 dark:border-slate-700 dark:bg-slate-800/70">
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                {draft.id && !saveAsNew ? 'Salvar Modelo de Relatório' : 'Salvar Novo Relatório'}
              </h3>
              <button
                type="button"
                disabled={saving}
                onClick={() => setSaveModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1 dark:text-slate-300">
                    Nome do Relatório *
                  </label>
                  <input
                    type="text"
                    autoFocus
                    value={draft.name}
                    onChange={(e) => patchDraft({ name: e.target.value })}
                    placeholder="Ex: Dossiês por Unidade"
                    className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs dark:border-slate-700"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1 dark:text-slate-300">
                    Categoria *
                  </label>
                  <select
                    value={draft.category}
                    onChange={(e) => patchDraft({ category: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  >
                    {REPORT_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="md:col-span-2">
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1 dark:text-slate-300">
                    Descrição
                  </label>
                  <input
                    type="text"
                    value={draft.description}
                    onChange={(e) => patchDraft({ description: e.target.value })}
                    placeholder="Objetivo gerencial ou filtros recomendados..."
                    className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs dark:border-slate-700"
                  />
                </div>
              </div>

              {/* ACL Users & Groups */}
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 space-y-3 dark:border-slate-700 dark:bg-slate-800/60">
                <div>
                  <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800 dark:text-slate-100">
                    <Lock className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                    Controle de Acesso (ACL)
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5 dark:text-slate-400">
                    Se nenhum usuário e nenhum grupo forem marcados, todos os colaboradores com permissão no módulo poderão visualizar este relatório.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <div className="text-[11px] font-semibold text-slate-700 mb-1 dark:text-slate-200">
                      Grupos Autorizados ({draft.allowed_groups?.length || 0})
                    </div>
                    <div className="max-h-36 overflow-y-auto rounded-lg border border-slate-200 bg-white p-2 space-y-1 dark:border-slate-700 dark:bg-slate-900">
                      {aclOptions.groups.map((grp) => {
                        const checked = (draft.allowed_groups || []).includes(grp.id);
                        return (
                          <label
                            key={grp.id}
                            className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer hover:bg-slate-50 px-1.5 py-1 rounded dark:text-slate-200 dark:hover:bg-slate-800"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => {
                                const curr = draft.allowed_groups || [];
                                const next = checked
                                  ? curr.filter((id) => id !== grp.id)
                                  : [...curr, grp.id];
                                patchDraft({ allowed_groups: next.length ? next : null });
                              }}
                              className="rounded border-slate-300 text-blue-600 dark:border-slate-600 dark:text-blue-400"
                            />
                            <span className="truncate">{grp.name}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <div className="text-[11px] font-semibold text-slate-700 mb-1 dark:text-slate-200">
                      Usuários Específicos ({draft.allowed_users?.length || 0})
                    </div>
                    <div className="max-h-36 overflow-y-auto rounded-lg border border-slate-200 bg-white p-2 space-y-1 dark:border-slate-700 dark:bg-slate-900">
                      {aclOptions.users.map((usr) => {
                        const checked = (draft.allowed_users || []).includes(usr.id);
                        return (
                          <label
                            key={usr.id}
                            className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer hover:bg-slate-50 px-1.5 py-1 rounded dark:text-slate-200 dark:hover:bg-slate-800"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => {
                                const curr = draft.allowed_users || [];
                                const next = checked
                                  ? curr.filter((id) => id !== usr.id)
                                  : [...curr, usr.id];
                                patchDraft({ allowed_users: next.length ? next : null });
                              }}
                              className="rounded border-slate-300 text-blue-600 dark:border-slate-600 dark:text-blue-400"
                            />
                            <span className="truncate">
                              {usr.name} <span className="text-slate-400 dark:text-slate-400">({usr.role})</span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>

              {saveError && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300">
                  {saveError}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3 dark:border-slate-700 dark:bg-slate-800/70">
              <button
                type="button"
                disabled={saving}
                onClick={() => setSaveModalOpen(false)}
                className="rounded-lg border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleSaveSubmit()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-emerald-600 dark:hover:bg-emerald-500"
              >
                <Save className="w-3.5 h-3.5" />
                {saving ? 'Salvando...' : 'Confirmar e Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Dirty Draft Guard Modal (never window.confirm) */}
      {pendingAction && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 dark:bg-slate-950/80"
          onClick={() => setPendingAction(null)}
        >
          <div
            className="w-full max-w-md rounded-xl border border-slate-200 bg-white shadow-2xl p-5 space-y-4 dark:border-slate-700 dark:bg-slate-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 shrink-0 dark:bg-amber-950/50 dark:border-amber-800/70 dark:text-amber-300">
                <AlertTriangle className="w-4 h-4" />
              </div>
              <div>
                <h3 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                  Alterações não salvas
                </h3>
                <p className="mt-1 text-xs text-slate-600 leading-relaxed dark:text-slate-300">
                  Você possui edições pendentes no relatório atual. Deseja descartar essas alterações e continuar?
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setPendingAction(null)}
                className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Continuar Editando
              </button>
              <button
                type="button"
                onClick={() => {
                  const fn = pendingAction;
                  setPendingAction(null);
                  fn();
                }}
                className="rounded-lg bg-amber-600 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-700"
              >
                Descartar e Prosseguir
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Soft Delete Confirmation Modal */}
      <ConfirmDeleteModal
        open={Boolean(deleteTarget)}
        title="Excluir Relatório"
        message={`Deseja desativar o relatório "${deleteTarget?.name || ''}"? Ele será removido da biblioteca de consultas.`}
        busy={deleting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleConfirmDelete}
      />

      {/* Training Modal */}
      <ReportTrainingModal
        open={trainingModalOpen}
        isAdmin={isAdmin}
        onClose={() => setTrainingModalOpen(false)}
        onStartBlank={handleNewTemplate}
        onStartGuidedStarter={handleStartGuidedStarter}
      />

      {/* Toast Notification */}
      {toastMsg && (
        <div className="fixed bottom-5 right-5 z-50 rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white shadow-lg dark:bg-emerald-600">
          {toastMsg}
        </div>
      )}
      <EntityAuditModal
        open={Boolean(auditTarget)}
        title={auditTarget ? `Relatório · ${auditTarget.name}` : 'Relatório'}
        entityType="report_templates"
        entityId={auditTarget?.id || ''}
        onClose={() => setAuditTarget(null)}
      />
    </div>
  );
};
