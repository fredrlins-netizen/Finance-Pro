import React, { useCallback, useEffect, useState } from 'react';
import {
  Download,
  Eye,
  FolderLock,
  History,
  Lock,
  RotateCcw,
  Search,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import { apiFetch, formatDateTimeBR, getAuthToken } from '../../../lib/api.ts';
import { DossierDocumentPreviewModal } from '../../DossierDocumentViewer.tsx';
import { EntityAuditModal } from '../cadastros/CadastrosShared.tsx';

interface SharedPartnerDoc {
  id: number;
  unitId: number;
  clientId: number;
  fileName: string;
  folderPath: string;
  docCategory: string;
  module: string;
  mimeType: string;
  sizeBytes: number;
  sha256Hash: string;
  uploadedBy: string;
  createdAt: string;
  hasAcl: boolean;
  hasFileOverride: boolean;
  isLegacyProtected: boolean;
  isProtectedContract: boolean;
}

interface AclGroupOption {
  id: number;
  name: string;
}

interface AclUserOption {
  id: number;
  name: string;
  email: string;
  role: string;
}

interface LegacyProtectionRecord {
  docId: number;
  fileName: string;
  module: string;
  category: string;
  protectedBy: string;
  protectedAt: string;
}

interface CompanyLegalSharedPartnerDocsProps {
  clientId: number;
  clientName: string;
  isAdmin: boolean;
}

export const CompanyLegalSharedPartnerDocs: React.FC<CompanyLegalSharedPartnerDocsProps> = ({
  clientId,
  clientName,
  isAdmin,
}) => {
  const [items, setItems] = useState<SharedPartnerDoc[]>([]);
  const [filterCat, setFilterCat] = useState('');
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [page, setPage] = useState(1);
  const [cursors, setCursors] = useState<number[]>([0]);
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [pendingDelete, setPendingDelete] = useState<SharedPartnerDoc[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [previewDoc, setPreviewDoc] = useState<{
    doc: SharedPartnerDoc;
    blobUrl: string;
  } | null>(null);

  // Admin ACL options
  const [aclReady, setAclReady] = useState(false);
  const [aclGroups, setAclGroups] = useState<AclGroupOption[]>([]);
  const [aclUsers, setAclUsers] = useState<AclUserOption[]>([]);
  const [aclSearch, setAclSearch] = useState('');
  const [aclUserPage, setAclUserPage] = useState(1);
  const [aclHasMoreUsers, setAclHasMoreUsers] = useState(false);

  // Folder / File ACL modal
  const [aclModal, setAclModal] = useState<{ mode: 'folder' | 'file'; doc?: SharedPartnerDoc } | null>(null);
  const [aclOverride, setAclOverride] = useState(false);
  const [aclDraftGroups, setAclDraftGroups] = useState<number[]>([]);
  const [aclDraftUsers, setAclDraftUsers] = useState<number[]>([]);
  const [aclLoading, setAclLoading] = useState(false);
  const [aclSaving, setAclSaving] = useState(false);
  const [aclError, setAclError] = useState('');

  // Legacy protection modals
  const [legacyOptInOpen, setLegacyOptInOpen] = useState(false);
  const [legacyImpact, setLegacyImpact] = useState<{
    legacyCount: number;
    folderConfigured: boolean;
    groupsCount: number;
    usersCount: number;
    files: Array<{ id: number; fileName: string; module: string; category: string }>;
  } | null>(null);
  const [legacyImpactLoading, setLegacyImpactLoading] = useState(false);
  const [legacySaving, setLegacySaving] = useState(false);
  const [legacyError, setLegacyError] = useState('');

  const [legacyHistoryOpen, setLegacyHistoryOpen] = useState(false);
  const [legacyHistoryLoading, setLegacyHistoryLoading] = useState(false);
  const [legacyHistoryItems, setLegacyHistoryItems] = useState<LegacyProtectionRecord[]>([]);
  const [legacyHistoryPage, setLegacyHistoryPage] = useState(1);
  const [legacyHistoryTotal, setLegacyHistoryTotal] = useState(0);
  const [pendingUndo, setPendingUndo] = useState<LegacyProtectionRecord | null>(null);
  const [undoSaving, setUndoSaving] = useState(false);
  const [docAuditOpen, setDocAuditOpen] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setDebouncedQuery(query);
      setPage(1);
      setCursors([0]);
    }, 300);
    return () => window.clearTimeout(t);
  }, [query]);

  const loadDocs = useCallback(async () => {
    if (!clientId) return;
    setLoading(true);
    setError('');
    try {
      const currentCursor = cursors[page - 1] ?? 0;
      const params = new URLSearchParams({
        clientId: String(clientId),
        cursor: String(currentCursor),
        limit: '25',
      });
      if (debouncedQuery.trim()) params.set('search', debouncedQuery.trim());
      if (filterCat) params.set('category', filterCat);
      const res = await apiFetch<{
        items: SharedPartnerDoc[];
        total: number;
        hasMore: boolean;
        nextCursor: number | null;
      }>(`/api/company-legal/partner-documents?${params.toString()}`);
      setItems(Array.isArray(res.items) ? res.items : []);
      setTotal(Number(res.total || 0));
      setHasMore(Boolean(res.hasMore));
      setNextCursor(res.nextCursor ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao listar documentos do parceiro.');
    } finally {
      setLoading(false);
    }
  }, [clientId, cursors, page, debouncedQuery, filterCat]);

  useEffect(() => {
    void loadDocs();
  }, [loadDocs]);

  const loadAclOptions = useCallback(
    async (searchTerm: string, nextPage: number, append: boolean) => {
      if (!isAdmin) return;
      try {
        const params = new URLSearchParams({ page: String(nextPage) });
        if (searchTerm.trim()) params.set('search', searchTerm.trim());
        const res = await apiFetch<{
          groups: AclGroupOption[];
          users: AclUserOption[];
          hasMoreUsers: boolean;
        }>(`/api/company-legal/acl/options?${params.toString()}`);
        setAclGroups(res.groups || []);
        setAclUsers((prev) => (append ? [...prev, ...(res.users || [])] : res.users || []));
        setAclHasMoreUsers(Boolean(res.hasMoreUsers));
        setAclReady(true);
      } catch {
        setAclReady(false);
      }
    },
    [isAdmin]
  );

  useEffect(() => {
    if (isAdmin) {
      void loadAclOptions('', 1, false);
    }
  }, [isAdmin, loadAclOptions]);

  useEffect(() => {
    if (!aclModal) return;
    const t = window.setTimeout(() => {
      setAclUserPage(1);
      void loadAclOptions(aclSearch, 1, false);
    }, 250);
    return () => window.clearTimeout(t);
  }, [aclSearch, aclModal, loadAclOptions]);

  const handleOpenSecureFile = async (doc: SharedPartnerDoc, preview: boolean) => {
    try {
      const token = getAuthToken();
      const resp = await fetch(`/api/documents/${doc.id}/download${preview ? '?preview=1' : ''}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || 'Falha ao acessar arquivo.');
      }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      if (preview) {
        setPreviewDoc((prev) => {
          if (prev?.blobUrl) URL.revokeObjectURL(prev.blobUrl);
          return { doc, blobUrl: url };
        });
      } else {
        const a = document.createElement('a');
        a.href = url;
        a.download = doc.fileName;
        a.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao abrir documento.');
    }
  };

  const handleConfirmDelete = async () => {
    if (pendingDelete.length === 0) return;
    setDeleting(true);
    setError('');
    setSuccess('');
    let okCount = 0;
    const errors: string[] = [];
    for (const doc of pendingDelete) {
      try {
        await apiFetch(`/api/company-legal/partner-documents/${doc.id}`, { method: 'DELETE' });
        okCount += 1;
      } catch (err) {
        errors.push(`${doc.fileName}: ${err instanceof Error ? err.message : 'erro ao excluir'}`);
      }
    }
    setDeleting(false);
    setPendingDelete([]);
    setSelectedIds(new Set());
    if (okCount > 0) setSuccess(`${okCount} arquivo(s) movido(s) para a lixeira.`);
    if (errors.length > 0) setError(errors.join(' | '));
    await loadDocs();
  };

  const openAclModal = async (mode: 'folder' | 'file', doc?: SharedPartnerDoc) => {
    setAclModal({ mode, doc });
    setAclLoading(true);
    setAclError('');
    setAclSearch('');
    try {
      if (mode === 'folder') {
        const res = await apiFetch<{ groupIds: number[]; userIds: number[] }>(
          `/api/company-legal/acl/folders/${clientId}`
        );
        setAclOverride(true);
        setAclDraftGroups(res.groupIds || []);
        setAclDraftUsers(res.userIds || []);
      } else if (doc) {
        const res = await apiFetch<{ overrideEnabled: boolean; groupIds: number[]; userIds: number[] }>(
          `/api/company-legal/acl/files/${doc.id}`
        );
        setAclOverride(Boolean(res.overrideEnabled));
        setAclDraftGroups(res.groupIds || []);
        setAclDraftUsers(res.userIds || []);
      }
    } catch (err) {
      setAclError(err instanceof Error ? err.message : 'Erro ao carregar regra ACL.');
    } finally {
      setAclLoading(false);
    }
  };

  const saveAclModal = async () => {
    if (!aclModal) return;
    setAclSaving(true);
    setAclError('');
    try {
      if (aclModal.mode === 'folder') {
        await apiFetch(`/api/company-legal/acl/folders/${clientId}`, {
          method: 'PUT',
          body: JSON.stringify({ groupIds: aclDraftGroups, userIds: aclDraftUsers }),
        });
      } else if (aclModal.doc) {
        await apiFetch(`/api/company-legal/acl/files/${aclModal.doc.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            overrideEnabled: aclOverride,
            groupIds: aclOverride ? aclDraftGroups : [],
            userIds: aclOverride ? aclDraftUsers : [],
          }),
        });
      }
      setAclModal(null);
      setSuccess('Permissões ACL atualizadas.');
      await loadDocs();
    } catch (err) {
      setAclError(err instanceof Error ? err.message : 'Erro ao salvar permissões.');
    } finally {
      setAclSaving(false);
    }
  };

  const openLegacyProtect = async () => {
    const ids = Array.from(selectedIds).slice(0, 500);
    if (ids.length === 0) return;
    setLegacyOptInOpen(true);
    setLegacyImpactLoading(true);
    setLegacyError('');
    try {
      const res = await apiFetch<NonNullable<typeof legacyImpact>>(
        `/api/company-legal/acl/legacy/${clientId}/impact`,
        { method: 'POST', body: JSON.stringify({ attachmentIds: ids }) }
      );
      setLegacyImpact(res);
    } catch (err) {
      setLegacyError(err instanceof Error ? err.message : 'Erro ao analisar impacto.');
    } finally {
      setLegacyImpactLoading(false);
    }
  };

  const confirmLegacyProtect = async () => {
    const ids = Array.from(selectedIds).slice(0, 500);
    setLegacySaving(true);
    setLegacyError('');
    try {
      await apiFetch(`/api/company-legal/acl/legacy/${clientId}/protect`, {
        method: 'POST',
        body: JSON.stringify({ attachmentIds: ids }),
      });
      setLegacyOptInOpen(false);
      setSelectedIds(new Set());
      setSuccess('Anexos legados protegidos pela regra da pasta.');
      await loadDocs();
    } catch (err) {
      setLegacyError(err instanceof Error ? err.message : 'Erro ao proteger anexos.');
    } finally {
      setLegacySaving(false);
    }
  };

  const loadLegacyHistory = async (targetPage = 1) => {
    setLegacyHistoryOpen(true);
    setLegacyHistoryLoading(true);
    setLegacyHistoryPage(targetPage);
    try {
      const res = await apiFetch<{
        items: LegacyProtectionRecord[];
        total: number;
      }>(`/api/company-legal/acl/legacy/${clientId}/protected?page=${targetPage}`);
      setLegacyHistoryItems(res.items || []);
      setLegacyHistoryTotal(Number(res.total || 0));
    } catch {
      setLegacyHistoryItems([]);
    } finally {
      setLegacyHistoryLoading(false);
    }
  };

  const confirmUndoLegacy = async () => {
    if (!pendingUndo) return;
    setUndoSaving(true);
    try {
      await apiFetch(`/api/company-legal/acl/legacy/${clientId}/protect/${pendingUndo.docId}`, {
        method: 'DELETE',
      });
      setPendingUndo(null);
      await loadLegacyHistory(legacyHistoryPage);
      await loadDocs();
    } finally {
      setUndoSaving(false);
    }
  };

  const allOnPageSelected = items.length > 0 && items.every((it) => selectedIds.has(it.id));

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 space-y-3 dark:border-slate-700 dark:bg-slate-800/60">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800 flex items-center gap-1.5 dark:text-slate-100">
            <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            Documentos Compartilhados do Parceiro · {clientName}
          </h4>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Pasta privada no Bucket da Invicta ({total} arquivo(s) localizado(s))
          </p>
        </div>

        {isAdmin && aclReady && (
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => void openAclModal('folder')}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <FolderLock className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
              Acesso da pasta
            </button>
            <button
              type="button"
              onClick={() => {
                const legacyIds = items.filter((d) => !d.hasAcl).map((d) => d.id);
                setSelectedIds(new Set(legacyIds));
              }}
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Selecionar legados exibidos
            </button>
            {selectedIds.size > 0 && (
              <button
                type="button"
                onClick={() => void openLegacyProtect()}
                className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-slate-800 dark:bg-emerald-600 dark:hover:bg-emerald-500"
              >
                <Lock className="w-3 h-3 text-emerald-400" />
                Proteger selecionados ({selectedIds.size})
              </button>
            )}
            <button
              type="button"
              onClick={() => void loadLegacyHistory(1)}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <History className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
              Histórico ACL legado
            </button>
          </div>
        )}
      </div>

      {/* Filter & Bulk bar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5 dark:text-slate-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar arquivo, pasta ou categoria..."
            className="w-full rounded-lg border border-slate-200 bg-white pl-8 pr-3 py-1.5 text-xs focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
        </div>
        <select
          value={filterCat}
          onChange={(e) => {
            setFilterCat(e.target.value);
            setPage(1);
            setCursors([0]);
          }}
          className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        >
          <option value="">Todas categorias</option>
          <option value="contrato">Contrato</option>
          <option value="rg_cnh">RG / CNH</option>
          <option value="comprovante">Comprovante</option>
          <option value="juridico">Jurídico</option>
          <option value="geral">Geral</option>
        </select>
        <button
          type="button"
          onClick={() => setDocAuditOpen(true)}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          <History className="w-3.5 h-3.5" />
          Auditoria
        </button>
        {selectedIds.size > 0 && (
          <button
            type="button"
            onClick={() => setPendingDelete(items.filter((i) => selectedIds.has(i.id)))}
            className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100 dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300 dark:hover:bg-red-900/60"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Excluir selecionados ({selectedIds.size})
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300">{error}</div>
      )}
      {success && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:border-emerald-800/70 dark:bg-emerald-950/50 dark:text-emerald-300">
          {success}
        </div>
      )}

      {/* Inline Delete Confirmation */}
      {pendingDelete.length > 0 && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-3 space-y-2 text-xs dark:border-red-800/70 dark:bg-red-950/50">
          <div className="font-bold text-red-800 dark:text-red-300">
            Confirmar exclusão de {pendingDelete.length} documento(s) de {clientName}?
          </div>
          <div className="text-red-700 dark:text-red-300">
            Os arquivos selecionados ({pendingDelete.map((d) => d.fileName).join(', ')}) serão movidos para a lixeira.
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={deleting}
              onClick={() => void handleConfirmDelete()}
              className="rounded-lg bg-red-600 px-3 py-1.5 font-semibold text-white hover:bg-red-700 disabled:opacity-50"
            >
              {deleting ? 'Excluindo...' : 'Confirmar exclusão'}
            </button>
            <button
              type="button"
              onClick={() => setPendingDelete([])}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Documents Table */}
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] font-semibold text-slate-500 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-400">
              <th className="px-2.5 py-2 w-8">
                <input
                  type="checkbox"
                  checked={allOnPageSelected}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setSelectedIds(new Set(items.map((i) => i.id)));
                    } else {
                      setSelectedIds(new Set());
                    }
                  }}
                />
              </th>
              <th className="px-2.5 py-2">Arquivo</th>
              <th className="px-2.5 py-2">Categoria / Pasta</th>
              <th className="px-2.5 py-2">Enviado</th>
              <th className="px-2.5 py-2 text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {loading ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-slate-400 dark:text-slate-400">
                  Carregando documentos do parceiro...
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-slate-400 dark:text-slate-400">
                  Nenhum documento compartilhado encontrado para este parceiro.
                </td>
              </tr>
            ) : (
              items.map((doc) => (
                <tr key={doc.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800">
                  <td className="px-2.5 py-2">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(doc.id)}
                      onChange={(e) => {
                        const next = new Set(selectedIds);
                        if (e.target.checked) next.add(doc.id);
                        else next.delete(doc.id);
                        setSelectedIds(next);
                      }}
                    />
                  </td>
                  <td className="px-2.5 py-2">
                    <div className="font-semibold text-slate-800 flex items-center gap-1.5 dark:text-slate-100">
                      <span>{doc.fileName}</span>
                      {doc.hasAcl && (
                        <span className="rounded border border-blue-200 bg-blue-50 px-1 py-0.5 text-[9px] font-bold text-blue-700 dark:border-blue-800/70 dark:bg-blue-950/50 dark:text-blue-300">
                          ACL
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-2.5 py-2 text-slate-600 dark:text-slate-300">
                    {doc.docCategory} · <span className="text-slate-400 dark:text-slate-400">{doc.folderPath}</span>
                  </td>
                  <td className="px-2.5 py-2 text-slate-500 whitespace-nowrap dark:text-slate-400">
                    {formatDateTimeBR(doc.createdAt)}
                  </td>
                  <td className="px-2.5 py-2 text-right whitespace-nowrap space-x-1">
                    <button
                      type="button"
                      onClick={() => void handleOpenSecureFile(doc, true)}
                      title="Ver"
                      className="inline-flex items-center gap-1 rounded border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                    >
                      <Eye className="w-3 h-3" /> Ver
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleOpenSecureFile(doc, false)}
                      title="Baixar"
                      className="inline-flex items-center gap-1 rounded border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                    >
                      <Download className="w-3 h-3" /> Baixar
                    </button>
                    {isAdmin && aclReady && (
                      <button
                        type="button"
                        onClick={() => void openAclModal('file', doc)}
                        title="Acesso do arquivo"
                        className="inline-flex items-center gap-1 rounded border border-slate-200 px-2 py-1 text-[11px] font-medium text-blue-700 hover:bg-blue-50 dark:border-slate-700 dark:text-blue-300 dark:hover:bg-blue-950/60"
                      >
                        <Lock className="w-3 h-3" /> Acesso
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setPendingDelete([doc])}
                      title="Excluir"
                      className="inline-flex items-center gap-1 rounded border border-red-200 px-2 py-1 text-[11px] font-medium text-red-700 hover:bg-red-50 dark:border-red-800/70 dark:text-red-300 dark:hover:bg-red-950/60"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {(page > 1 || hasMore) && (
        <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-300">
          <span>
            Página {page} · Mostrando {items.length} de {total}
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="rounded border border-slate-200 bg-white px-2.5 py-1 hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
            >
              Anterior
            </button>
            <button
              type="button"
              disabled={!hasMore || nextCursor === null}
              onClick={() => {
                if (nextCursor === null) return;
                setCursors((prev) => {
                  const copy = [...prev];
                  copy[page] = nextCursor;
                  return copy;
                });
                setPage((p) => p + 1);
              }}
              className="rounded border border-slate-200 bg-white px-2.5 py-1 hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
            >
              Próxima
            </button>
          </div>
        </div>
      )}

      {/* ACL Folder / File Modal */}
      {aclModal && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 p-4 dark:bg-slate-950/80"
          role="dialog"
          aria-modal="true"
          onClick={() => !aclSaving && setAclModal(null)}
        >
          <div
            className="w-full max-w-2xl rounded-2xl bg-white border border-slate-200 shadow-2xl overflow-hidden flex flex-col max-h-[85vh] dark:bg-slate-900 dark:border-slate-700"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between bg-slate-50 dark:border-slate-700 dark:bg-slate-800/70">
              <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                {aclModal.mode === 'folder'
                  ? `Acesso à pasta do cliente: ${clientName}`
                  : `Acesso: ${aclModal.doc?.fileName}`}
              </h4>
              <button
                type="button"
                onClick={() => !aclSaving && setAclModal(null)}
                className="p-1 text-slate-400 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 overflow-y-auto space-y-3 text-xs">
              {aclModal.mode === 'file' && (
                <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-semibold text-slate-800 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-100">
                  <input
                    type="checkbox"
                    checked={aclOverride}
                    onChange={(e) => {
                      const next = e.target.checked;
                      setAclOverride(next);
                      if (!next) {
                        setAclDraftGroups([]);
                        setAclDraftUsers([]);
                      }
                    }}
                  />
                  Ativar exceção para este arquivo e substituir a regra da pasta
                </label>
              )}

              {(aclModal.mode === 'folder' || aclOverride) && aclDraftGroups.length === 0 && aclDraftUsers.length === 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800 dark:border-amber-800/70 dark:bg-amber-950/50 dark:text-amber-300">
                  Nenhum grupo ou usuário selecionado: o acesso será exclusivo de administradores.
                </div>
              )}

              {aclError && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-700 dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300">{aclError}</div>
              )}

              {aclLoading ? (
                <div className="py-8 text-center text-slate-500 dark:text-slate-400">Carregando regras...</div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 opacity-100">
                  <div className="rounded-xl border border-slate-200 p-3 space-y-2 dark:border-slate-700">
                    <div className="font-bold text-slate-700 dark:text-slate-200">Grupos Autorizados</div>
                    <div className="max-h-48 overflow-y-auto space-y-1">
                      {aclGroups.map((g) => (
                        <label key={g.id} className="flex items-center gap-2 py-1">
                          <input
                            type="checkbox"
                            disabled={aclModal.mode === 'file' && !aclOverride}
                            checked={aclDraftGroups.includes(g.id)}
                            onChange={(e) => {
                              setAclDraftGroups((prev) =>
                                e.target.checked ? [...prev, g.id] : prev.filter((id) => id !== g.id)
                              );
                            }}
                          />
                          <span>{g.name}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 p-3 space-y-2 dark:border-slate-700">
                    <div className="font-bold text-slate-700 dark:text-slate-200">Usuários Autorizados</div>
                    <input
                      type="text"
                      value={aclSearch}
                      onChange={(e) => setAclSearch(e.target.value)}
                      placeholder="Buscar usuário..."
                      className="w-full rounded border border-slate-200 px-2.5 py-1 text-xs dark:border-slate-700"
                    />
                    <div className="max-h-40 overflow-y-auto space-y-1">
                      {aclUsers.map((u) => (
                        <label key={u.id} className="flex items-center gap-2 py-1">
                          <input
                            type="checkbox"
                            disabled={aclModal.mode === 'file' && !aclOverride}
                            checked={aclDraftUsers.includes(u.id)}
                            onChange={(e) => {
                              setAclDraftUsers((prev) =>
                                e.target.checked ? [...prev, u.id] : prev.filter((id) => id !== u.id)
                              );
                            }}
                          />
                          <span className="truncate">{u.name}</span>
                        </label>
                      ))}
                    </div>
                    {aclHasMoreUsers && (
                      <button
                        type="button"
                        onClick={() => {
                          const np = aclUserPage + 1;
                          setAclUserPage(np);
                          void loadAclOptions(aclSearch, np, true);
                        }}
                        className="text-[11px] font-semibold text-blue-600 hover:underline dark:text-blue-400"
                      >
                        Carregar mais usuários
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
            <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex justify-end gap-2 text-xs dark:border-slate-700 dark:bg-slate-800/70">
              <button
                type="button"
                disabled={aclSaving}
                onClick={() => setAclModal(null)}
                className="rounded-lg border border-slate-300 bg-white px-4 py-1.5 font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={aclLoading || aclSaving}
                onClick={() => void saveAclModal()}
                className="rounded-lg bg-slate-900 px-4 py-1.5 font-semibold text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-emerald-600 dark:hover:bg-emerald-500"
              >
                {aclSaving ? 'Salvando...' : 'Salvar permissões'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Legacy Protection Opt-in Modal */}
      {legacyOptInOpen && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 p-4 dark:bg-slate-950/80"
          role="dialog"
          aria-modal="true"
          onClick={() => !legacySaving && setLegacyOptInOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-2xl bg-white border border-slate-200 shadow-2xl overflow-hidden dark:bg-slate-900 dark:border-slate-700"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between bg-slate-50 dark:border-slate-700 dark:bg-slate-800/70">
              <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100">Confirmar proteção de anexos legados</h4>
              <button
                type="button"
                onClick={() => !legacySaving && setLegacyOptInOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-3 text-xs">
              {legacyImpactLoading ? (
                <div className="py-6 text-center text-slate-500 dark:text-slate-400">Calculando impacto...</div>
              ) : legacyImpact ? (
                <>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-1 dark:border-slate-700 dark:bg-slate-800/70">
                    <div>Arquivos selecionados: <strong>{legacyImpact.legacyCount}</strong></div>
                    <div>Regra da pasta configurada: <strong>{legacyImpact.folderConfigured ? 'Sim' : 'Não'}</strong></div>
                    <div>Grupos autorizados: <strong>{legacyImpact.groupsCount}</strong> · Usuários: <strong>{legacyImpact.usersCount}</strong></div>
                  </div>
                  {!legacyImpact.folderConfigured && (
                    <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-700 dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300">
                      Nenhuma regra da pasta configurada. Clique em &quot;Configurar regra da pasta&quot; primeiro.
                    </div>
                  )}
                  <div className="max-h-40 overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-lg dark:divide-slate-800 dark:border-slate-700">
                    {legacyImpact.files.map((f) => (
                      <div key={f.id} className="px-3 py-1.5 flex items-center justify-between">
                        <span className="font-medium truncate">{f.fileName}</span>
                        <span className="text-[10px] text-slate-500 dark:text-slate-400">{f.module} · {f.category}</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : null}
              {legacyError && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-700 dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300">{legacyError}</div>
              )}
            </div>
            <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex justify-end gap-2 text-xs dark:border-slate-700 dark:bg-slate-800/70">
              {!legacyImpact?.folderConfigured && (
                <button
                  type="button"
                  onClick={() => {
                    setLegacyOptInOpen(false);
                    void openAclModal('folder');
                  }}
                  className="rounded-lg border border-blue-300 bg-blue-50 px-3 py-1.5 font-semibold text-blue-700 dark:border-blue-800/70 dark:bg-blue-950/50 dark:text-blue-300"
                >
                  Configurar regra da pasta
                </button>
              )}
              <button
                type="button"
                disabled={legacySaving}
                onClick={() => setLegacyOptInOpen(false)}
                className="rounded-lg border border-slate-300 bg-white px-4 py-1.5 font-semibold text-slate-700 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={legacySaving || !legacyImpact?.folderConfigured}
                onClick={() => void confirmLegacyProtect()}
                className="rounded-lg bg-slate-900 px-4 py-1.5 font-semibold text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-emerald-600 dark:hover:bg-emerald-500"
              >
                {legacySaving ? 'Protegendo...' : 'Confirmar proteção'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Legacy History Modal */}
      {legacyHistoryOpen && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 p-4 dark:bg-slate-950/80"
          role="dialog"
          aria-modal="true"
          onClick={() => setLegacyHistoryOpen(false)}
        >
          <div
            className="w-full max-w-3xl rounded-2xl bg-white border border-slate-200 shadow-2xl overflow-hidden flex flex-col max-h-[85vh] dark:bg-slate-900 dark:border-slate-700"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between bg-slate-50 dark:border-slate-700 dark:bg-slate-800/70">
              <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                Histórico de proteção dos anexos legados ({legacyHistoryTotal})
              </h4>
              <button
                type="button"
                onClick={() => setLegacyHistoryOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 overflow-auto flex-1 text-xs">
              {legacyHistoryLoading ? (
                <div className="py-8 text-center text-slate-500 dark:text-slate-400">Carregando histórico...</div>
              ) : legacyHistoryItems.length === 0 ? (
                <div className="py-8 text-center text-slate-400 dark:text-slate-400">Nenhuma proteção legada registrada.</div>
              ) : (
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-[11px] font-semibold text-slate-500 dark:border-slate-700 dark:text-slate-400">
                      <th className="py-2 pr-3">Arquivo</th>
                      <th className="py-2 pr-3">Módulo / Categoria</th>
                      <th className="py-2 pr-3">Responsável</th>
                      <th className="py-2 pr-3">Data/Hora</th>
                      <th className="py-2 text-right">Ação</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {legacyHistoryItems.map((rec) => (
                      <tr key={rec.docId}>
                        <td className="py-2 pr-3 font-medium text-slate-800 dark:text-slate-100">{rec.fileName}</td>
                        <td className="py-2 pr-3 text-slate-500 dark:text-slate-400">{rec.module} · {rec.category}</td>
                        <td className="py-2 pr-3 text-slate-700 dark:text-slate-200">{rec.protectedBy || 'Usuário removido'}</td>
                        <td className="py-2 pr-3 text-slate-500 whitespace-nowrap dark:text-slate-400">{formatDateTimeBR(rec.protectedAt)}</td>
                        <td className="py-2 text-right">
                          <button
                            type="button"
                            onClick={() => setPendingUndo(rec)}
                            className="inline-flex items-center gap-1 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-800 hover:bg-amber-100 dark:border-amber-800/70 dark:bg-amber-950/50 dark:text-amber-300 dark:hover:bg-amber-900/60"
                          >
                            <RotateCcw className="w-3 h-3" /> Reverter proteção
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex justify-end text-xs dark:border-slate-700 dark:bg-slate-800/70">
              <button
                type="button"
                onClick={() => setLegacyHistoryOpen(false)}
                className="rounded-lg border border-slate-300 bg-white px-4 py-1.5 font-semibold text-slate-700 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Undo Legacy Protection Alertdialog */}
      {pendingUndo && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/65 p-4"
          role="alertdialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-2xl bg-white border border-slate-200 p-5 shadow-2xl space-y-3 text-xs dark:bg-slate-900 dark:border-slate-700">
            <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100">Reverter a proteção deste anexo?</h4>
            <p className="text-slate-600 dark:text-slate-300">
              O arquivo <strong>{pendingUndo.fileName}</strong> retornará às regras anteriores à adesão. O arquivo e seu registro físico permanecerão intactos.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={undoSaving}
                onClick={() => setPendingUndo(null)}
                className="rounded-lg border border-slate-300 bg-white px-3.5 py-1.5 font-semibold text-slate-700 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={undoSaving}
                onClick={() => void confirmUndoLegacy()}
                className="rounded-lg bg-amber-600 px-3.5 py-1.5 font-semibold text-white hover:bg-amber-700"
              >
                {undoSaving ? 'Revertendo...' : 'Confirmar reversão'}
              </button>
            </div>
          </div>
        </div>
      )}
      <DossierDocumentPreviewModal
        open={Boolean(previewDoc)}
        title={previewDoc?.doc.fileName || ''}
        subtitle={
          previewDoc ? `${previewDoc.doc.folderPath} · SHA256:${previewDoc.doc.sha256Hash}` : ''
        }
        mimeType={previewDoc?.doc.mimeType || ''}
        blobUrl={previewDoc?.blobUrl || ''}
        onDownload={previewDoc ? () => void handleOpenSecureFile(previewDoc.doc, false) : undefined}
        onClose={() => {
          if (previewDoc?.blobUrl) URL.revokeObjectURL(previewDoc.blobUrl);
          setPreviewDoc(null);
        }}
      />

      <EntityAuditModal
        open={docAuditOpen}
        title={`Documentos do Parceiro · ${clientName}`}
        entityType="company_legal_process_attachments,document_objects"
        entityId="all"
        onClose={() => setDocAuditOpen(false)}
      />
    </div>
  );
};
