import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Building2,
  ChevronDown,
  ChevronRight,
  Download,
  ExternalLink,
  Eye,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Link2,
  Lock,
  Pencil,
  Plus,
  Printer,
  RefreshCw,
  Search,
  Shield,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  apiFetch,
  formatBytes,
  formatDateTimeBR,
  getActiveUnitHeader,
  getAuthToken,
} from '../../../lib/api.ts';
import {
  AuthUser,
  ConfigUserItem,
  DocumentActionPermissionSet,
  FolderPermissionRule,
  ModuleId,
  NavigationIntent,
  PermissionTriState,
  Unit,
  UnitFileEntry,
  UserDocPermissionSummary,
  UserGroup,
} from '../../../types.ts';
import { ProtectedDocumentViewerModal } from '../../common/ProtectedDocumentViewerModal.tsx';

interface FolderTreeNode {
  path: string;
  name: string;
  parentPath: string;
  depth: number;
  unitId: number;
  unitCode: string;
  nodeKind: 'unit' | 'branch_clients' | 'client' | 'admission' | 'branch_unit' | 'unit_folder';
  rawFolderPrefix: string;
  clientId?: number | null;
  admissionId?: number | null;
  directCount: number;
  recursiveCount: number;
  unitFilesCount: number;
  clientDocsCount: number;
  interlinkedCount: number;
  totalSizeBytes: number;
}

interface TreeUnitOption {
  id: number;
  code: string;
  name: string;
  city: string;
  state: string;
  summary: UserDocPermissionSummary;
}

interface ConfigUnitFilesViewProps {
  currentUser: AuthUser;
  units: Unit[];
  groups: UserGroup[];
  usersList: ConfigUserItem[];
  wsTick?: number;
  onToast: (msg: string) => void;
  onNavigate?: (mod: ModuleId, intent?: NavigationIntent) => void;
}

const DEFAULT_EMPTY_PERMS: DocumentActionPermissionSet = {
  view: false,
  print: false,
  download: false,
  edit: false,
  delete: false,
};

export const ConfigUnitFilesView: React.FC<ConfigUnitFilesViewProps> = ({
  currentUser,
  units: fallbackUnits,
  groups,
  usersList,
  wsTick,
  onToast,
  onNavigate,
}) => {
  const isAdmin = currentUser.role === 'admin';

  // 0 = Todas as unidades permitidas (Unidades -> Clientes & Pastas da Unidade)
  const [selectedUnitId, setSelectedUnitId] = useState<number>(0);
  const [treeUnits, setTreeUnits] = useState<TreeUnitOption[]>([]);
  const [summary, setSummary] = useState<UserDocPermissionSummary | null>(null);
  const [folders, setFolders] = useState<FolderTreeNode[]>([]);
  const [totals, setTotals] = useState({ files: 0, unitFiles: 0, clientDocs: 0, interlinked: 0, totalSizeBytes: 0 });

  const [selectedNodePath, setSelectedNodePath] = useState<string>('');
  const [includeSubfolders, setIncludeSubfolders] = useState<boolean>(true);
  const [scopeFilter, setScopeFilter] = useState<'all' | 'unit' | 'client' | 'interlinked'>('all');
  const [searchInput, setSearchInput] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);

  const [files, setFiles] = useState<UnitFileEntry[]>([]);
  const [folderPerms, setFolderPerms] = useState<DocumentActionPermissionSet>(DEFAULT_EMPTY_PERMS);
  const [loadingTree, setLoadingTree] = useState(false);
  const [loadingList, setLoadingList] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});

  // Viewer
  const [viewerDoc, setViewerDoc] = useState<UnitFileEntry | null>(null);

  // Upload modal
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadUnitId, setUploadUnitId] = useState<number>(currentUser.defaultUnitId || fallbackUnits[0]?.id || 1);
  const [uploadFolder, setUploadFolder] = useState('ADMINISTRAÇÃO');
  const [uploadCategory, setUploadCategory] = useState('arquivo_unidade');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  // Rename / Replace modal
  const [editTarget, setEditTarget] = useState<UnitFileEntry | null>(null);
  const [editFileName, setEditFileName] = useState('');
  const [editFolderPath, setEditFolderPath] = useState('');
  const [replaceFile, setReplaceFile] = useState<File | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const replaceInputRef = useRef<HTMLInputElement | null>(null);

  // Delete confirmation modal
  const [deleteTarget, setDeleteTarget] = useState<UnitFileEntry | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Folder Permissions Manager Modal (Admin)
  const [permModalOpen, setPermModalOpen] = useState(false);
  const [permUnitId, setPermUnitId] = useState<number>(currentUser.defaultUnitId || fallbackUnits[0]?.id || 1);
  const [folderRules, setFolderRules] = useState<FolderPermissionRule[]>([]);
  const [loadingRules, setLoadingRules] = useState(false);
  const [ruleEditId, setRuleEditId] = useState<number | null>(null);
  const [rulePrefix, setRulePrefix] = useState('');
  const [ruleScope, setRuleScope] = useState<'unit' | 'client' | 'all'>('unit');
  const [ruleTargetType, setRuleTargetType] = useState<'group' | 'user'>('group');
  const [ruleTargetId, setRuleTargetId] = useState<number>(groups[0]?.id || 1);
  const [ruleView, setRuleView] = useState<PermissionTriState>('allow');
  const [rulePrint, setRulePrint] = useState<PermissionTriState>('inherit');
  const [ruleDownload, setRuleDownload] = useState<PermissionTriState>('inherit');
  const [ruleEdit, setRuleEdit] = useState<PermissionTriState>('inherit');
  const [ruleDelete, setRuleDelete] = useState<PermissionTriState>('inherit');
  const [savingRule, setSavingRule] = useState(false);

  const selectedNode = useMemo(
    () => folders.find((f) => f.path === selectedNodePath) || null,
    [folders, selectedNodePath]
  );

  useEffect(() => {
    const t = setTimeout(() => {
      setSearchDebounced(searchInput.trim());
      setPage(1);
    }, 260);
    return () => clearTimeout(t);
  }, [searchInput]);

  const loadTree = useCallback(
    async (unitIdToLoad?: number) => {
      const targetId = unitIdToLoad !== undefined ? unitIdToLoad : selectedUnitId;
      setLoadingTree(true);
      try {
        const res = await apiFetch<{
          units: TreeUnitOption[];
          activeUnitId: number;
          summary: UserDocPermissionSummary;
          folders: FolderTreeNode[];
          totals: { files: number; unitFiles: number; clientDocs: number; interlinked: number; totalSizeBytes: number };
        }>(`/api/unit-files/tree?unitId=${targetId === 0 ? 'all' : targetId}`);
        setTreeUnits(res.units || []);
        setSummary(res.summary || null);
        const fetchedFolders = res.folders || [];
        setFolders(fetchedFolders);
        setTotals(
          res.totals || { files: 0, unitFiles: 0, clientDocs: 0, interlinked: 0, totalSizeBytes: 0 }
        );
        // Auto-expande unidades que possuem arquivos ou a unidade única selecionada
        setExpandedFolders((prev) => {
          const next = { ...prev };
          for (const node of fetchedFolders) {
            if (node.depth === 0 && (fetchedFolders.filter((f) => f.depth === 0).length <= 2 || node.recursiveCount > 0)) {
              if (next[node.path] === undefined) next[node.path] = true;
            }
            if ((node.nodeKind === 'branch_unit' || node.nodeKind === 'branch_clients') && node.recursiveCount > 0) {
              if (next[node.path] === undefined) next[node.path] = true;
            }
          }
          return next;
        });
      } catch (err) {
        onToast(err instanceof Error ? err.message : 'Erro ao carregar árvore de pastas.');
      } finally {
        setLoadingTree(false);
      }
    },
    [selectedUnitId, onToast]
  );

  const loadList = useCallback(async () => {
    setLoadingList(true);
    try {
      const qs = new URLSearchParams({
        unitId: selectedUnitId === 0 ? 'all' : String(selectedUnitId),
        includeSubfolders: String(includeSubfolders),
        scopeFilter,
        page: String(page),
        limit: '60',
      });
      if (selectedNodePath) qs.set('nodePath', selectedNodePath);
      if (selectedNode?.rawFolderPrefix) qs.set('folderPrefix', selectedNode.rawFolderPrefix);
      if (searchDebounced) qs.set('search', searchDebounced);

      const res = await apiFetch<{
        folderPermissions: DocumentActionPermissionSet;
        total: number;
        totalPages: number;
        items: UnitFileEntry[];
      }>(`/api/unit-files/list?${qs.toString()}`);

      setFiles(res.items || []);
      setTotalItems(res.total || 0);
      setTotalPages(res.totalPages || 1);
      setFolderPerms(res.folderPermissions || DEFAULT_EMPTY_PERMS);
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Erro ao carregar arquivos da unidade.');
    } finally {
      setLoadingList(false);
    }
  }, [selectedUnitId, selectedNodePath, selectedNode, includeSubfolders, scopeFilter, searchDebounced, page, onToast]);

  useEffect(() => {
    loadTree(selectedUnitId);
  }, [selectedUnitId, wsTick, loadTree]);

  useEffect(() => {
    loadList();
  }, [loadList, wsTick]);

  const loadFolderRules = useCallback(
    async (targetPermUnitId?: number) => {
      if (!isAdmin) return;
      const uid = targetPermUnitId || permUnitId || fallbackUnits[0]?.id || 1;
      setLoadingRules(true);
      try {
        const res = await apiFetch<{ rules: FolderPermissionRule[] }>(
          `/api/config/folder-permissions?unitId=${uid}`
        );
        setFolderRules(res.rules || []);
      } catch (err) {
        onToast(err instanceof Error ? err.message : 'Erro ao carregar regras de pasta.');
      } finally {
        setLoadingRules(false);
      }
    },
    [isAdmin, permUnitId, fallbackUnits, onToast]
  );

  const visibleFolders = useMemo(() => {
    const nodeMap = new Map(folders.map((n) => [n.path, n]));
    const out: FolderTreeNode[] = [];
    for (const node of folders) {
      if (node.depth === 0 || !node.parentPath) {
        out.push(node);
        continue;
      }
      // Exibe filhos apenas se todos os ancestrais estiverem expandidos
      let ancestorsOpen = true;
      let cursor = node.parentPath;
      while (cursor) {
        if (!expandedFolders[cursor]) {
          ancestorsOpen = false;
          break;
        }
        cursor = nodeMap.get(cursor)?.parentPath || '';
      }
      if (ancestorsOpen) out.push(node);
    }
    return out;
  }, [folders, expandedFolders]);

  const hasChildFolder = useMemo(() => {
    const parents = new Set<string>();
    for (const f of folders) {
      if (f.parentPath) parents.add(f.parentPath);
    }
    return parents;
  }, [folders]);

  const handleDownloadDirect = async (doc: UnitFileEntry) => {
    if (!doc.effectivePermissions.download) return;
    try {
      const token = getAuthToken();
      const res = await fetch(`/api/documents/${doc.id}/download?context=unit_browser`, {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          'x-unit-id': String(getActiveUnitHeader()),
        },
      });
      if (!res.ok) {
        const parsed = (await res.json().catch(() => ({}))) as { error?: string };
        onToast(parsed.error || 'Download negado.');
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = doc.fileName;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Erro ao baixar arquivo.');
    }
  };

  const handlePrintDirect = async (doc: UnitFileEntry) => {
    if (!doc.effectivePermissions.print) return;
    try {
      const token = getAuthToken();
      const res = await fetch(`/api/documents/${doc.id}/download?mode=print&context=unit_browser`, {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          'x-unit-id': String(getActiveUnitHeader()),
        },
      });
      if (!res.ok) {
        const parsed = (await res.json().catch(() => ({}))) as { error?: string };
        onToast(parsed.error || 'Impressão bloqueada.');
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const iframe = document.createElement('iframe');
      iframe.className = 'hidden';
      iframe.src = url;
      iframe.onload = () => {
        try {
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();
        } catch {
          window.print();
        }
        window.setTimeout(() => {
          URL.revokeObjectURL(url);
          iframe.remove();
        }, 60_000);
      };
      document.body.appendChild(iframe);
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Erro ao imprimir arquivo.');
    }
  };

  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadFile || !uploadFolder.trim()) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('unitId', String(uploadUnitId));
      fd.append('unitFolderPath', uploadFolder.trim());
      fd.append('docCategory', uploadCategory);
      fd.append('file', uploadFile);

      const token = getAuthToken();
      const res = await fetch('/api/unit-files/upload', {
        method: 'POST',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          'x-unit-id': String(uploadUnitId),
        },
        body: fd,
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        onToast(json.error || 'Falha ao enviar arquivo.');
        return;
      }
      setUploadOpen(false);
      setUploadFile(null);
      setSelectedNodePath(`U${uploadUnitId}/UNIDADE/${uploadFolder.trim()}`);
      onToast(`Arquivo enviado para "${uploadFolder.trim()}".`);
      await Promise.all([loadTree(selectedUnitId), loadList()]);
    } finally {
      setUploading(false);
    }
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editTarget) return;
    setSavingEdit(true);
    try {
      if (replaceFile) {
        const fd = new FormData();
        fd.append('file', replaceFile);
        const token = getAuthToken();
        const res = await fetch(`/api/documents/${editTarget.id}/replace`, {
          method: 'POST',
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            'x-unit-id': String(editTarget.unitId || selectedUnitId || 1),
          },
          body: fd,
        });
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          onToast(json.error || 'Erro ao substituir arquivo.');
          return;
        }
      }
      if (
        editFileName.trim() !== editTarget.fileName ||
        editFolderPath.trim() !== (editTarget.unitFolderPath || '')
      ) {
        await apiFetch(`/api/documents/${editTarget.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            fileName: editFileName.trim(),
            unitFolderPath: editFolderPath.trim(),
          }),
        });
      }
      setEditTarget(null);
      setReplaceFile(null);
      onToast('Arquivo atualizado com auditoria registrada.');
      await Promise.all([loadTree(selectedUnitId), loadList()]);
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Erro ao atualizar arquivo.');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiFetch(`/api/documents/${deleteTarget.id}`, { method: 'DELETE' });
      onToast(`"${deleteTarget.fileName}" movido para a lixeira.`);
      setDeleteTarget(null);
      await Promise.all([loadTree(selectedUnitId), loadList()]);
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Erro ao excluir arquivo.');
    } finally {
      setDeleting(false);
    }
  };

  const handleSaveFolderRule = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingRule(true);
    try {
      await apiFetch('/api/config/folder-permissions/save', {
        method: 'POST',
        body: JSON.stringify({
          id: ruleEditId,
          unitId: permUnitId,
          scope: ruleScope,
          folderPrefix: rulePrefix.trim(),
          targetType: ruleTargetType,
          targetId: ruleTargetId,
          canView: ruleView,
          canPrint: rulePrint,
          canDownload: ruleDownload,
          canEdit: ruleEdit,
          canDelete: ruleDelete,
        }),
      });
      setRuleEditId(null);
      onToast('Regra de permissão por pasta salva.');
      await Promise.all([loadFolderRules(permUnitId), loadTree(selectedUnitId), loadList()]);
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Erro ao salvar regra.');
    } finally {
      setSavingRule(false);
    }
  };

  const handleDeleteRule = async (id: number) => {
    try {
      await apiFetch(`/api/config/folder-permissions/${id}`, { method: 'DELETE' });
      onToast('Regra removida.');
      await Promise.all([loadFolderRules(permUnitId), loadTree(selectedUnitId), loadList()]);
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Erro ao remover regra.');
    }
  };

  const canUploadSelected = isAdmin || folderPerms.edit || Boolean(summary?.unitFiles.edit);

  return (
    <div className="space-y-4 text-xs">
      {/* Barra superior de controle e filtro */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
              Arquivos da Unidade · Clientes &amp; Subpastas Departamentais
            </h2>
            <p className="text-[11px] text-slate-600 dark:text-slate-400">
              Árvore unificada: Unidades → Clientes/Admissões e Pastas da Unidade (ADMINISTRAÇÃO, MODELOS DE CONTRATOS, COMERCIAL, PC GERAL) com RBAC granular.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <select
              value={selectedUnitId}
              onChange={(e) => {
                setSelectedUnitId(Number(e.target.value));
                setSelectedNodePath('');
                setPage(1);
              }}
              aria-label="Selecionar unidade"
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs font-semibold text-slate-900 dark:text-slate-100"
            >
              <option value={0}>Todas as Unidades (Visão Corporativa)</option>
              {(treeUnits.length > 0
                ? treeUnits
                : fallbackUnits.map((u) => ({ id: u.id, code: u.code, name: u.name }))
              ).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.code} · {u.name}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={() => {
                loadTree(selectedUnitId);
                loadList();
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 whitespace-nowrap shrink-0"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingTree || loadingList ? 'animate-spin' : ''}`} />
              Atualizar
            </button>

            {canUploadSelected && (
              <button
                type="button"
                onClick={() => {
                  const defaultUid =
                    selectedNode?.unitId ||
                    (selectedUnitId > 0 ? selectedUnitId : currentUser.defaultUnitId || fallbackUnits[0]?.id || 1);
                  setUploadUnitId(defaultUid);
                  setUploadFolder(selectedNode?.rawFolderPrefix || 'ADMINISTRAÇÃO');
                  setUploadFile(null);
                  setUploadOpen(true);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 dark:bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800 dark:hover:bg-emerald-500 whitespace-nowrap shrink-0"
              >
                <Upload className="w-3.5 h-3.5" />
                Enviar Arquivo
              </button>
            )}

            {isAdmin && (
              <button
                type="button"
                onClick={() => {
                  const defaultUid =
                    selectedNode?.unitId ||
                    (selectedUnitId > 0 ? selectedUnitId : currentUser.defaultUnitId || fallbackUnits[0]?.id || 1);
                  setPermUnitId(defaultUid);
                  setRulePrefix(selectedNode?.rawFolderPrefix || '');
                  setRuleEditId(null);
                  setPermModalOpen(true);
                  loadFolderRules(defaultUid);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-700 whitespace-nowrap shrink-0"
              >
                <Shield className="w-3.5 h-3.5" />
                Permissões por Pasta
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
          <div className="relative flex-1 min-w-[220px] max-w-md">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Buscar arquivo, subpasta, contrato, cliente ou selo..."
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 pl-8 pr-3 py-1.5 text-slate-900 dark:text-slate-100"
            />
          </div>

          <div className="inline-flex items-center rounded-lg bg-slate-100 dark:bg-slate-800 p-1 overflow-x-auto">
            {(
              [
                { id: 'all', label: 'Todos' },
                { id: 'unit', label: 'Pastas da Unidade' },
                { id: 'client', label: 'Clientes & Admissões' },
                { id: 'interlinked', label: 'Interligados' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => {
                  setScopeFilter(opt.id);
                  setPage(1);
                }}
                className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors whitespace-nowrap shrink-0 ${
                  scopeFilter === opt.id
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <label className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-700 dark:text-slate-300 cursor-pointer ml-auto">
            <input
              type="checkbox"
              checked={includeSubfolders}
              onChange={(e) => {
                setIncludeSubfolders(e.target.checked);
                setPage(1);
              }}
            />
            Incluir subpastas
          </label>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3.5">
          <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Arquivos Acessíveis</div>
          <div className="mt-1 font-mono text-xl font-bold text-slate-900 dark:text-slate-100 tabular-nums">
            {totals.files}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3.5">
          <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Pastas da Unidade</div>
          <div className="mt-1 font-mono text-xl font-bold text-slate-900 dark:text-slate-100 tabular-nums">
            {totals.unitFiles}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3.5">
          <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Clientes &amp; Admissões</div>
          <div className="mt-1 font-mono text-xl font-bold text-blue-700 dark:text-blue-400 tabular-nums">
            {totals.clientDocs}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3.5">
          <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Contratos Interligados</div>
          <div className="mt-1 font-mono text-xl font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">
            {totals.interlinked}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3.5">
          <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Volume Visível</div>
          <div className="mt-1 font-mono text-xl font-bold text-slate-900 dark:text-slate-100 tabular-nums">
            {formatBytes(totals.totalSizeBytes)}
          </div>
        </div>
      </div>

      {/* Dual Pane */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        {/* Árvore de Pastas (Unidades -> Clientes & Pastas da Unidade) */}
        <div className="lg:col-span-4 xl:col-span-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-hidden">
          <div className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 px-3.5 py-2.5 flex items-center justify-between">
            <span className="font-semibold text-slate-800 dark:text-slate-100 inline-flex items-center gap-1.5">
              <Building2 className="w-3.5 h-3.5" />
              Unidades → Pastas &amp; Clientes
            </span>
            <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
              {folders.length} nós
            </span>
          </div>

          <div className="p-2 max-h-[560px] overflow-y-auto space-y-0.5">
            <button
              type="button"
              onClick={() => {
                setSelectedNodePath('');
                setPage(1);
              }}
              className={`w-full flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left transition-colors ${
                selectedNodePath === ''
                  ? 'bg-slate-900 text-white dark:bg-emerald-700'
                  : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <span className="inline-flex items-center gap-2 font-semibold truncate">
                <FolderOpen className="w-3.5 h-3.5 shrink-0" />
                Todas as Unidades e Pastas
              </span>
              <span className="font-mono text-[11px] opacity-80 tabular-nums">{totals.files}</span>
            </button>

            {visibleFolders.length === 0 ? (
              <div className="px-3 py-5 text-center text-[11px] text-slate-500 dark:text-slate-400">
                Nenhuma pasta visível para o seu perfil.
              </div>
            ) : (
              visibleFolders.map((node) => {
                const isSelected = selectedNodePath === node.path;
                const isExpandable = hasChildFolder.has(node.path);
                const isExpanded = Boolean(expandedFolders[node.path]);
                const padClass =
                  node.depth === 0
                    ? 'pl-2'
                    : node.depth === 1
                    ? 'pl-5'
                    : node.depth === 2
                    ? 'pl-8'
                    : node.depth === 3
                    ? 'pl-11'
                    : 'pl-14';

                const isUnitNode = node.nodeKind === 'unit';
                const isBranchHeader = node.nodeKind === 'branch_clients' || node.nodeKind === 'branch_unit';

                return (
                  <div
                    key={node.path}
                    className={`flex items-center gap-1 rounded-lg pr-2 py-1.5 transition-colors ${padClass} ${
                      isSelected
                        ? 'bg-slate-900 text-white dark:bg-emerald-700'
                        : isUnitNode
                        ? 'text-slate-900 dark:text-slate-100 bg-slate-50/70 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800'
                        : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    {isExpandable ? (
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedFolders((prev) => ({ ...prev, [node.path]: !prev[node.path] }))
                        }
                        className="p-0.5 shrink-0 opacity-80 hover:opacity-100"
                        title={isExpanded ? 'Recolher subpastas' : 'Expandir subpastas'}
                      >
                        {isExpanded ? (
                          <ChevronDown className="w-3.5 h-3.5" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5" />
                        )}
                      </button>
                    ) : (
                      <span className="w-4 shrink-0" />
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        setSelectedNodePath(node.path);
                        if (isExpandable && !isExpanded) {
                          setExpandedFolders((prev) => ({ ...prev, [node.path]: true }));
                        }
                        setPage(1);
                      }}
                      className="flex-1 min-w-0 flex items-center justify-between gap-2 text-left"
                    >
                      <span className="inline-flex items-center gap-1.5 min-w-0">
                        {isUnitNode ? (
                          <Building2 className="w-3.5 h-3.5 shrink-0 opacity-85" />
                        ) : isSelected ? (
                          <FolderOpen className="w-3.5 h-3.5 shrink-0" />
                        ) : (
                          <Folder className="w-3.5 h-3.5 shrink-0" />
                        )}
                        <span
                          className={`truncate ${
                            isUnitNode || isBranchHeader ? 'font-bold' : 'font-medium'
                          }`}
                          title={node.path}
                        >
                          {node.name}
                        </span>
                      </span>
                      <span
                        className={`font-mono text-[10px] tabular-nums shrink-0 ${
                          node.recursiveCount > 0 ? 'font-bold opacity-95' : 'opacity-50'
                        }`}
                      >
                        {node.recursiveCount}
                      </span>
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Lista de Arquivos */}
        <div className="lg:col-span-8 xl:col-span-8 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-hidden">
          <div className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 px-4 py-2.5 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                {selectedNode
                  ? `${selectedNode.unitCode} · ${selectedNode.name}`
                  : 'Todos os diretórios autorizados'}
              </span>
              <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                ({totalItems})
              </span>
            </div>

            {selectedNode && selectedNode.rawFolderPrefix && (
              <div className="flex items-center gap-2 text-[11px] text-slate-600 dark:text-slate-300">
                <span>
                  Direitos na pasta:{' '}
                  {[
                    folderPerms.view && 'Visualizar',
                    folderPerms.print && 'Imprimir',
                    folderPerms.download && 'Baixar',
                    folderPerms.edit && 'Alterar',
                    folderPerms.delete && 'Excluir',
                  ]
                    .filter(Boolean)
                    .join(' · ') || 'Personalizado por subpasta'}
                </span>
              </div>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/40 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                <tr>
                  <th className="px-4 py-2.5">Arquivo &amp; Caminho na Árvore</th>
                  <th className="px-4 py-2.5">Unidade · Vínculo</th>
                  <th className="px-4 py-2.5">Selo HMAC</th>
                  <th className="px-4 py-2.5 text-right whitespace-nowrap">Tamanho · Ver.</th>
                  <th className="px-4 py-2.5 text-right whitespace-nowrap">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {files.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-slate-500 dark:text-slate-400">
                      {loadingList
                        ? 'Carregando arquivos autorizados...'
                        : 'Nenhum arquivo encontrado nesta pasta para os filtros atuais.'}
                    </td>
                  </tr>
                ) : (
                  files.map((doc) => {
                    const p = doc.effectivePermissions;
                    const readOnlyNotice = !p.download && !p.print;
                    return (
                      <tr key={doc.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                        <td className="px-4 py-2.5 max-w-md">
                          <div className="flex items-start gap-2">
                            <FileText className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
                            <div className="min-w-0">
                              <button
                                type="button"
                                onClick={() => setViewerDoc(doc)}
                                className="font-semibold text-slate-900 dark:text-slate-100 hover:underline text-left break-words"
                              >
                                {doc.fileName}
                              </button>
                              <div
                                className="text-[11px] font-mono text-slate-500 dark:text-slate-400 truncate"
                                title={doc.unitFolderPath || doc.folderPath}
                              >
                                {doc.unitFolderPath || doc.relativeSubpath || doc.folderPath || 'Raiz da Unidade'}
                              </div>
                              <div className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">
                                Enviado por {doc.uploadedBy} em {formatDateTimeBR(doc.createdAt)}
                              </div>
                            </div>
                          </div>
                        </td>

                        <td className="px-4 py-2.5">
                          <div className="text-[10px] font-mono font-bold text-slate-500 dark:text-slate-400 mb-0.5">
                            {doc.unitCode || `U${doc.unitId}`}
                          </div>
                          {doc.clientId ? (
                            <div className="space-y-0.5">
                              <div
                                className={`inline-flex items-center gap-1 font-semibold ${
                                  doc.isInterlinked
                                    ? 'text-emerald-700 dark:text-emerald-400'
                                    : 'text-blue-700 dark:text-blue-400'
                                }`}
                              >
                                <Link2 className="w-3 h-3 shrink-0" />
                                <span className="truncate max-w-[200px]">{doc.clientName || `Cliente #${doc.clientId}`}</span>
                              </div>
                              <div className="font-mono text-[11px] text-slate-600 dark:text-slate-300">
                                {doc.contractNumber
                                  ? `Contrato ${doc.contractNumber}`
                                  : doc.protocolCode || (doc.admissionId ? `Admissão #${doc.admissionId}` : 'Acervo do Cliente')}
                              </div>
                              {onNavigate && (
                                <div className="flex flex-wrap items-center gap-2 pt-0.5">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      onNavigate('cad_clientes', {
                                        clientId: doc.clientId || undefined,
                                        tab: 'documentos',
                                      })
                                    }
                                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-700 dark:text-slate-200 hover:underline"
                                  >
                                    <ExternalLink className="w-3 h-3" />
                                    Cliente
                                  </button>
                                  {doc.admissionId && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        onNavigate('admission', {
                                          clientId: doc.clientId || undefined,
                                          admissionId: doc.admissionId || undefined,
                                        })
                                      }
                                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-700 dark:text-blue-300 hover:underline"
                                    >
                                      <ExternalLink className="w-3 h-3" />
                                      Admissão
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          ) : (
                            <span className="text-[11px] font-medium text-slate-600 dark:text-slate-300">
                              Pasta da Unidade
                            </span>
                          )}
                        </td>

                        <td className="px-4 py-2.5 whitespace-nowrap">
                          <div className="font-mono text-[11px] text-slate-800 dark:text-slate-200">
                            {doc.integrativeCode || 'Pendente'}
                          </div>
                          {readOnlyNotice && (
                            <div className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 dark:text-amber-400 mt-0.5">
                              <Lock className="w-2.5 h-2.5" />
                              Somente Leitura Protegida
                            </div>
                          )}
                        </td>

                        <td className="px-4 py-2.5 text-right whitespace-nowrap font-mono tabular-nums text-slate-700 dark:text-slate-200">
                          <div>{formatBytes(doc.sizeBytes)}</div>
                          <div className="text-[10px] text-slate-400">v{doc.versionNumber || 1}</div>
                        </td>

                        <td className="px-4 py-2.5 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => setViewerDoc(doc)}
                              title="Visualizar no Leitor Interno"
                              className="inline-flex items-center gap-1 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-[11px] font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700"
                            >
                              <Eye className="w-3 h-3" />
                              Ver
                            </button>

                            {p.print && (
                              <button
                                type="button"
                                onClick={() => handlePrintDirect(doc)}
                                title="Imprimir arquivo"
                                className="rounded-md p-1.5 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                              >
                                <Printer className="w-3.5 h-3.5" />
                              </button>
                            )}

                            {p.download && (
                              <button
                                type="button"
                                onClick={() => handleDownloadDirect(doc)}
                                title="Baixar arquivo"
                                className="rounded-md p-1.5 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                              >
                                <Download className="w-3.5 h-3.5" />
                              </button>
                            )}

                            {p.edit && (
                              <button
                                type="button"
                                onClick={() => {
                                  setEditTarget(doc);
                                  setEditFileName(doc.fileName);
                                  setEditFolderPath(doc.unitFolderPath || '');
                                  setReplaceFile(null);
                                }}
                                title="Renomear / Substituir versão"
                                className="rounded-md p-1.5 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                            )}

                            {p.delete && (
                              <button
                                type="button"
                                onClick={() => setDeleteTarget(doc)}
                                title="Mover para lixeira"
                                className="rounded-md p-1.5 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/60"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="border-t border-slate-200 dark:border-slate-700 px-4 py-2.5 flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-400">
              <span className="font-mono tabular-nums">
                Página {page} de {totalPages} · {totalItems} arquivos
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="rounded-md border border-slate-200 dark:border-slate-700 px-2.5 py-1 font-semibold disabled:opacity-40"
                >
                  Anterior
                </button>
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  className="rounded-md border border-slate-200 dark:border-slate-700 px-2.5 py-1 font-semibold disabled:opacity-40"
                >
                  Próxima
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Leitor Interno Protegido */}
      <ProtectedDocumentViewerModal
        open={Boolean(viewerDoc)}
        documentId={viewerDoc?.id || null}
        fileName={viewerDoc?.fileName || ''}
        mimeType={viewerDoc?.mimeType || ''}
        subtitle={
          viewerDoc
            ? `${viewerDoc.unitFolderPath || 'Unidade'} · ${viewerDoc.integrativeCode || 'Selo pendente'}`
            : undefined
        }
        context="unit_browser"
        canPrint={Boolean(viewerDoc?.effectivePermissions.print)}
        canDownload={Boolean(viewerDoc?.effectivePermissions.download)}
        onClose={() => setViewerDoc(null)}
      />

      {/* Modal Upload Direto */}
      {uploadOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 dark:bg-slate-950/80">
          <form
            onSubmit={handleUploadSubmit}
            className="w-full max-w-lg rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 shadow-2xl space-y-4 text-xs"
          >
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2 font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                <FolderPlus className="w-4 h-4" />
                Enviar Arquivo para Pasta da Unidade
              </div>
              <button type="button" onClick={() => setUploadOpen(false)} className="text-slate-400 hover:text-slate-700">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-200 mb-1">
                Unidade de Destino *
              </label>
              <select
                value={uploadUnitId}
                onChange={(e) => setUploadUnitId(Number(e.target.value))}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-slate-900 dark:text-slate-100"
              >
                {(treeUnits.length > 0
                  ? treeUnits
                  : fallbackUnits.map((u) => ({ id: u.id, code: u.code, name: u.name }))
                ).map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.code} · {u.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-200 mb-1">
                Pasta / Subpasta de Destino *
              </label>
              <input
                type="text"
                required
                value={uploadFolder}
                onChange={(e) => setUploadFolder(e.target.value)}
                placeholder="Ex: ADMINISTRAÇÃO ou MODELOS DE CONTRATOS/FINANCEIRO"
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-slate-900 dark:text-slate-100"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-200 mb-1">Categoria</label>
              <select
                value={uploadCategory}
                onChange={(e) => setUploadCategory(e.target.value)}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-slate-900 dark:text-slate-100"
              >
                <option value="arquivo_unidade">Arquivo Administrativo / Geral da Unidade</option>
                <option value="contrato">Modelo de Contrato</option>
                <option value="comprovante">Financeiro / Comprovante</option>
                <option value="ficha_admissao">Formulário / Ficha Modelo</option>
              </select>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-200 mb-1">Arquivo *</label>
              <input
                type="file"
                required
                onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-slate-700 dark:text-slate-200"
              />
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-100 dark:border-slate-800 pt-3">
              <button
                type="button"
                onClick={() => setUploadOpen(false)}
                className="rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-2 font-semibold text-slate-700 dark:text-slate-200"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={uploading || !uploadFile}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 dark:bg-emerald-600 px-4 py-2 font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
              >
                <Upload className="w-3.5 h-3.5" />
                {uploading ? 'Enviando...' : 'Gravar no Cofre'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal Alterar / Renomear / Substituir Arquivo */}
      {editTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 dark:bg-slate-950/80">
          <form
            onSubmit={handleSaveEdit}
            className="w-full max-w-lg rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 shadow-2xl space-y-4 text-xs"
          >
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                Alterar Arquivo ou Substituir Versão
              </div>
              <button type="button" onClick={() => setEditTarget(null)} className="text-slate-400 hover:text-slate-700">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-200 mb-1">Nome do Arquivo *</label>
              <input
                type="text"
                required
                value={editFileName}
                onChange={(e) => setEditFileName(e.target.value)}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-slate-900 dark:text-slate-100"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-200 mb-1">Subpasta da Unidade</label>
              <input
                type="text"
                value={editFolderPath}
                onChange={(e) => setEditFolderPath(e.target.value)}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-slate-900 dark:text-slate-100"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-200 mb-1">
                Substituir Binário (Opcional · gera nova versão v{(editTarget.versionNumber || 1) + 1})
              </label>
              <input
                ref={replaceInputRef}
                type="file"
                onChange={(e) => setReplaceFile(e.target.files?.[0] || null)}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-slate-700 dark:text-slate-200"
              />
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-100 dark:border-slate-800 pt-3">
              <button
                type="button"
                onClick={() => setEditTarget(null)}
                className="rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-2 font-semibold text-slate-700 dark:text-slate-200"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={savingEdit}
                className="rounded-lg bg-slate-900 dark:bg-emerald-600 px-4 py-2 font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {savingEdit ? 'Salvando...' : 'Salvar Alterações'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal Confirmar Exclusão */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 dark:bg-slate-950/80">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 shadow-2xl space-y-4 text-xs">
            <div className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
              Confirmar Exclusão do Arquivo
            </div>
            <p className="text-slate-600 dark:text-slate-300">
              Deseja mover <strong>{deleteTarget.fileName}</strong> para a lixeira? A ação será registrada na trilha de auditoria.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-2 font-semibold text-slate-700 dark:text-slate-200"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={handleConfirmDelete}
                className="rounded-lg bg-red-600 px-4 py-2 font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? 'Movendo...' : 'Mover para Lixeira'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Gerenciar Permissões por Pasta (Admin) */}
      {permModalOpen && isAdmin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 dark:bg-slate-950/80">
          <div className="w-full max-w-4xl rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 shadow-2xl space-y-4 text-xs max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2 font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                <Shield className="w-4 h-4" />
                Permissões Granulares por Pasta e Subpasta
              </div>
              <button type="button" onClick={() => setPermModalOpen(false)} className="text-slate-400 hover:text-slate-700">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form
              onSubmit={handleSaveFolderRule}
              className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 p-4 space-y-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-semibold text-slate-800 dark:text-slate-100">
                  {ruleEditId ? 'Editar Regra Existente' : 'Nova Regra / Exceção por Pasta'}
                </div>
                <select
                  value={permUnitId}
                  onChange={(e) => {
                    const nextUid = Number(e.target.value);
                    setPermUnitId(nextUid);
                    loadFolderRules(nextUid);
                  }}
                  aria-label="Unidade da regra de pasta"
                  className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1 text-xs font-semibold text-slate-900 dark:text-slate-100"
                >
                  {fallbackUnits.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.code} · {u.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    Prefixo da Pasta (vazio = unidade inteira)
                  </label>
                  <input
                    type="text"
                    value={rulePrefix}
                    onChange={(e) => setRulePrefix(e.target.value)}
                    placeholder="Ex: ADMINISTRAÇÃO"
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-slate-900 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    Escopo
                  </label>
                  <select
                    value={ruleScope}
                    onChange={(e) => setRuleScope(e.target.value as 'unit' | 'client' | 'all')}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-slate-900 dark:text-slate-100"
                  >
                    <option value="unit">Arquivos da Unidade</option>
                    <option value="client">Docs de Clientes / Contratos</option>
                    <option value="all">Ambos (Unidade + Clientes)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    Aplicar para
                  </label>
                  <select
                    value={ruleTargetType}
                    onChange={(e) => {
                      const next = e.target.value as 'group' | 'user';
                      setRuleTargetType(next);
                      setRuleTargetId(next === 'group' ? groups[0]?.id || 1 : usersList[0]?.id || 1);
                    }}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-slate-900 dark:text-slate-100"
                  >
                    <option value="group">Grupo de Usuários</option>
                    <option value="user">Usuário Individual</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    {ruleTargetType === 'group' ? 'Grupo Alvo' : 'Usuário Alvo'}
                  </label>
                  <select
                    value={ruleTargetId}
                    onChange={(e) => setRuleTargetId(Number(e.target.value))}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-slate-900 dark:text-slate-100"
                  >
                    {ruleTargetType === 'group'
                      ? groups.map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.name}
                          </option>
                        ))
                      : usersList.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name} ({u.email})
                          </option>
                        ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
                {(
                  [
                    { label: 'Visualizar', val: ruleView, set: setRuleView },
                    { label: 'Imprimir', val: rulePrint, set: setRulePrint },
                    { label: 'Baixar', val: ruleDownload, set: setRuleDownload },
                    { label: 'Alterar', val: ruleEdit, set: setRuleEdit },
                    { label: 'Excluir', val: ruleDelete, set: setRuleDelete },
                  ] as const
                ).map((item) => (
                  <div key={item.label}>
                    <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                      {item.label}
                    </label>
                    <select
                      value={item.val}
                      onChange={(e) => item.set(e.target.value as PermissionTriState)}
                      className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1.5 text-slate-900 dark:text-slate-100"
                    >
                      <option value="inherit">Herdar</option>
                      <option value="allow">Permitir</option>
                      <option value="deny">Negar</option>
                    </select>
                  </div>
                ))}
              </div>

              <div className="flex justify-end gap-2">
                {ruleEditId && (
                  <button
                    type="button"
                    onClick={() => setRuleEditId(null)}
                    className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 font-semibold text-slate-700 dark:text-slate-200"
                  >
                    Limpar Seleção
                  </button>
                )}
                <button
                  type="submit"
                  disabled={savingRule}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 dark:bg-emerald-600 px-4 py-1.5 font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  <Plus className="w-3.5 h-3.5" />
                  {savingRule ? 'Salvando...' : ruleEditId ? 'Atualizar Regra' : 'Adicionar Regra'}
                </button>
              </div>
            </form>

            <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                  <tr>
                    <th className="px-3 py-2">Pasta</th>
                    <th className="px-3 py-2">Escopo</th>
                    <th className="px-3 py-2">Alvo</th>
                    <th className="px-3 py-2">Ver</th>
                    <th className="px-3 py-2">Imp.</th>
                    <th className="px-3 py-2">Baixar</th>
                    <th className="px-3 py-2">Alt.</th>
                    <th className="px-3 py-2">Exc.</th>
                    <th className="px-3 py-2 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {loadingRules ? (
                    <tr>
                      <td colSpan={9} className="px-3 py-4 text-center text-slate-500">
                        Carregando regras...
                      </td>
                    </tr>
                  ) : folderRules.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-3 py-6 text-center text-slate-500">
                        Nenhuma exceção por pasta configurada nesta unidade. As permissões seguem o Grupo RBAC e Exceções por Usuário.
                      </td>
                    </tr>
                  ) : (
                    folderRules.map((r) => {
                      const targetLabel =
                        r.targetType === 'group'
                          ? `Grupo: ${groups.find((g) => g.id === r.targetId)?.name || `#${r.targetId}`}`
                          : `Usuário: ${usersList.find((u) => u.id === r.targetId)?.name || `#${r.targetId}`}`;
                      const renderTri = (tri: string) =>
                        tri === 'allow' ? (
                          <span className="font-semibold text-emerald-700 dark:text-emerald-400">Sim</span>
                        ) : tri === 'deny' ? (
                          <span className="font-semibold text-red-600 dark:text-red-400">Não</span>
                        ) : (
                          <span className="text-slate-400">Herdar</span>
                        );

                      return (
                        <tr key={r.id}>
                          <td className="px-3 py-2 font-mono text-[11px]">{r.folderPrefix || '(Toda Unidade)'}</td>
                          <td className="px-3 py-2">{r.scope}</td>
                          <td className="px-3 py-2">{targetLabel}</td>
                          <td className="px-3 py-2">{renderTri(r.canView)}</td>
                          <td className="px-3 py-2">{renderTri(r.canPrint)}</td>
                          <td className="px-3 py-2">{renderTri(r.canDownload)}</td>
                          <td className="px-3 py-2">{renderTri(r.canEdit)}</td>
                          <td className="px-3 py-2">{renderTri(r.canDelete)}</td>
                          <td className="px-3 py-2 text-right whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => {
                                setRuleEditId(r.id);
                                setRulePrefix(r.folderPrefix);
                                setRuleScope(r.scope as 'unit' | 'client' | 'all');
                                setRuleTargetType(r.targetType as 'group' | 'user');
                                setRuleTargetId(r.targetId);
                                setRuleView(r.canView);
                                setRulePrint(r.canPrint);
                                setRuleDownload(r.canDownload);
                                setRuleEdit(r.canEdit);
                                setRuleDelete(r.canDelete);
                              }}
                              className="rounded p-1 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 mr-1"
                              title="Editar regra"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteRule(r.id)}
                              className="rounded p-1 text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/60"
                              title="Excluir regra"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
