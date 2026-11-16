import React, { useMemo, useState } from 'react';
import {
  ArrowDownUp,
  ArrowLeft,
  Building2,
  Camera,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  History,
  Maximize2,
  Minimize2,
  Pencil,
  Plus,
  Save,
  Search,
  Settings2,
  Trash2,
  Upload,
  UserCheck,
  X,
} from 'lucide-react';
import { apiFetch } from '../../../lib/api.ts';
import { CollaboratorItem, DepartmentItem, RoleCatalogItem, Unit } from '../../../types.ts';
import {
  BRAZILIAN_UFS,
  CameraCaptureModal,
  ConfirmDeleteModal,
  EntityAuditModal,
  formatCepMask,
  formatPhoneMask,
  MaritalStatusModal,
} from './CadastrosShared.tsx';

// =============================================================================
// 2. CARGOS (roles_catalog)
// =============================================================================
export const RolesCrudView: React.FC<{
  roles: RoleCatalogItem[];
  onRefresh: () => Promise<void>;
}> = ({ roles, onRefresh }) => {
  const [mode, setMode] = useState<'list' | 'form'>('list');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [participates, setParticipates] = useState(true);
  const [sortOrder, setSortOrder] = useState('0');
  const [active, setActive] = useState(true);

  const [search, setSearch] = useState('');
  const [sortAsc, setSortAsc] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<RoleCatalogItem | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteErr, setDeleteErr] = useState('');
  const [auditTarget, setAuditTarget] = useState<{ id: number; label: string } | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = roles.filter((r) => !q || r.name.toLowerCase().includes(q));
    list.sort((a, b) => (sortAsc ? a.name.localeCompare(b.name, 'pt-BR') : b.name.localeCompare(a.name, 'pt-BR')));
    return list;
  }, [roles, search, sortAsc]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paged = filtered.slice((page - 1) * pageSize, page * pageSize);

  const openForm = (r?: RoleCatalogItem, isDup = false) => {
    setErrorMsg('');
    setFeedback('');
    if (r) {
      setEditingId(isDup ? null : r.id);
      setName(isDup ? `${r.name} (Cópia)` : r.name);
      setParticipates(r.participatesInScheduleQueue);
      setSortOrder(String(r.sortOrder || 0));
      setActive(r.active);
    } else {
      setEditingId(null);
      setName('');
      setParticipates(true);
      setSortOrder('0');
      setActive(true);
    }
    setMode('form');
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setErrorMsg('Nome do cargo é obrigatório.');
      return;
    }
    setSaving(true);
    setErrorMsg('');
    try {
      const payload = {
        name: name.trim(),
        participatesInScheduleQueue: participates,
        sortOrder: Number(sortOrder || 0),
        active,
      };
      if (editingId) {
        await apiFetch(`/api/cadastros/roles/${editingId}`, { method: 'PUT', body: JSON.stringify(payload) });
        setFeedback(`Cargo "${payload.name}" atualizado.`);
      } else {
        await apiFetch('/api/cadastros/roles', { method: 'POST', body: JSON.stringify(payload) });
        setFeedback(`Cargo "${payload.name}" cadastrado.`);
      }
      await onRefresh();
      setMode('list');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao salvar cargo.');
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    setDeleteErr('');
    try {
      await apiFetch(`/api/cadastros/roles/${deleteTarget.id}`, { method: 'DELETE' });
      setDeleteTarget(null);
      setFeedback(`Cargo "${deleteTarget.name}" excluído.`);
      await onRefresh();
    } catch (err) {
      setDeleteErr(err instanceof Error ? err.message : 'Erro ao excluir cargo.');
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {feedback && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-medium text-emerald-900 flex items-center justify-between dark:border-emerald-800/70 dark:bg-emerald-950/50 dark:text-emerald-300">
          <span>{feedback}</span>
          <button type="button" onClick={() => setFeedback('')}>
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      {errorMsg && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-xs font-medium text-red-800 flex items-center justify-between dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300">
          <span>{errorMsg}</span>
          <button type="button" onClick={() => setErrorMsg('')}>
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {mode === 'list' ? (
        <>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h1 className="font-display text-xl font-bold text-slate-900 dark:text-slate-100">Cadastros Comuns · Cargos</h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Catálogo de funções e participação automática na Fila de Agendamento &amp; Consultores
              </p>
            </div>
            <button
              type="button"
              onClick={() => openForm()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-emerald-600 dark:hover:bg-emerald-500"
            >
              <Plus className="w-3.5 h-3.5" /> Novo Cargo
            </button>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-3.5 flex flex-wrap items-center justify-between gap-2 dark:border-slate-700 dark:bg-slate-900">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 dark:text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder="Buscar cargo pelo nome..."
                className="w-full rounded-lg border border-slate-200 pl-8 pr-3 py-2 text-xs dark:border-slate-700"
              />
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
              <span>Itens/pág:</span>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(1);
                }}
                className="rounded-lg border border-slate-200 px-2 py-1.5 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              >
                <option value={10}>10</option>
                <option value={20}>20</option>
                <option value={50}>50</option>
              </select>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden dark:border-slate-700 dark:bg-slate-900">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-300">
                  <th className="py-3 px-4">
                    <button type="button" onClick={() => setSortAsc((s) => !s)} className="inline-flex items-center gap-1">
                      Nome do Cargo <ArrowDownUp className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="py-3 px-4">Fila de Agendamento</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {paged.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-8 text-center text-slate-500 dark:text-slate-400">
                      Nenhum cargo localizado.
                    </td>
                  </tr>
                ) : (
                  paged.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800">
                      <td className="py-3 px-4 font-semibold text-slate-900 dark:text-slate-100">{r.name}</td>
                      <td className="py-3 px-4 font-semibold">
                        <span className={r.participatesInScheduleQueue ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-500 dark:text-slate-400'}>
                          {r.participatesInScheduleQueue ? 'Sim (Participa)' : 'Não'}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span className={r.active ? 'text-emerald-700 font-semibold dark:text-emerald-300' : 'text-slate-400 dark:text-slate-400'}>
                          {r.active ? 'Ativo' : 'Inativo'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setAuditTarget({ id: r.id, label: r.name })}
                            className="rounded-md border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                            title="Auditoria"
                          >
                            <History className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => openForm(r, false)}
                            className="rounded-md border border-slate-200 p-1.5 text-blue-700 hover:bg-blue-50 dark:border-slate-700 dark:text-blue-300 dark:hover:bg-blue-950/60"
                            title="Editar"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => openForm(r, true)}
                            className="rounded-md border border-slate-200 p-1.5 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                            title="Duplicar"
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setDeleteErr('');
                              setDeleteTarget(r);
                            }}
                            className="rounded-md border border-red-200 p-1.5 text-red-600 hover:bg-red-50 dark:border-red-800/70 dark:text-red-400 dark:hover:bg-red-950/60"
                            title="Excluir"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>

            <div className="px-4 py-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-600 dark:border-slate-800 dark:text-slate-300">
              <span>
                Total: {filtered.length} cargo(s) · Página {page} de {totalPages}
              </span>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1 disabled:opacity-40 dark:border-slate-700"
                >
                  <ChevronLeft className="w-3.5 h-3.5" /> Anterior
                </button>
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1 disabled:opacity-40 dark:border-slate-700"
                >
                  Próxima <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        </>
      ) : (
        <form onSubmit={handleSave} className="rounded-2xl border border-slate-200 bg-white p-6 space-y-4 text-xs dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-3 dark:border-slate-800">
            <button type="button" onClick={() => setMode('list')} className="rounded-lg border border-slate-200 p-1.5 text-slate-600 dark:border-slate-700 dark:text-slate-300">
              <ArrowLeft className="w-4 h-4" />
            </button>
            <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
              {editingId ? 'Editar Cargo' : 'Novo Cargo'}
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-2">
              <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Nome do Cargo *</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex: Consultor Sênior"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 font-semibold dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Ordem de Exibição</label>
              <input
                type="number"
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-6 pt-2">
            <label className="inline-flex items-center gap-2 font-semibold text-slate-800 cursor-pointer dark:text-slate-100">
              <input
                type="checkbox"
                checked={participates}
                onChange={(e) => setParticipates(e.target.checked)}
              />
              Participa da Fila de Agendamento &amp; Consultores
            </label>
            <label className="inline-flex items-center gap-2 font-semibold text-slate-800 cursor-pointer dark:text-slate-100">
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
              Cargo Ativo
            </label>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
            <button type="button" onClick={() => setMode('list')} className="rounded-lg border border-slate-200 px-4 py-2 font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200">
              Cancelar
            </button>
            <button type="submit" disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-5 py-2 font-semibold text-white hover:bg-emerald-700">
              <Save className="w-3.5 h-3.5" /> {saving ? 'Salvando...' : 'Salvar Cargo'}
            </button>
          </div>
        </form>
      )}

      <ConfirmDeleteModal
        open={Boolean(deleteTarget)}
        title={`Excluir Cargo "${deleteTarget?.name || ''}"`}
        description="A exclusão será bloqueada se houver colaboradores vinculados a este cargo."
        busy={deleteBusy}
        error={deleteErr}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleConfirmDelete}
      />

      <EntityAuditModal
        open={Boolean(auditTarget)}
        title={auditTarget?.label || ''}
        entityType="role"
        entityId={auditTarget?.id || 0}
        onClose={() => setAuditTarget(null)}
      />
    </div>
  );
};

// =============================================================================
// 3. COLABORADORES (Árvore Expansível Unidade -> Cargo + Câmera + ViaCEP)
// =============================================================================
export const CollaboratorsCrudView: React.FC<{
  collaborators: CollaboratorItem[];
  roles: RoleCatalogItem[];
  departments: DepartmentItem[];
  units: Unit[];
  activeUnitId: number;
  maritalStatuses: string[];
  onMaritalStatusesChange: (next: string[]) => void;
  onRefresh: () => Promise<void>;
}> = ({
  collaborators,
  roles,
  departments,
  units,
  activeUnitId,
  maritalStatuses,
  onMaritalStatusesChange,
  onRefresh,
}) => {
  const [mode, setMode] = useState<'tree' | 'form'>('tree');
  const [search, setSearch] = useState('');
  const [collapsedUnits, setCollapsedUnits] = useState<Record<number, boolean>>({});
  const [collapsedRoles, setCollapsedRoles] = useState<Record<string, boolean>>({});

  // Form state
  const [editingId, setEditingId] = useState<number | null>(null);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [active, setActive] = useState(true);
  const [participatesInScheduleQueue, setParticipatesInScheduleQueue] = useState(false);
  const [unitId, setUnitId] = useState(activeUnitId || units[0]?.id || 1);
  const [roleId, setRoleId] = useState<number | ''>('');
  const [departmentId, setDepartmentId] = useState<number | ''>('');
  const [userId, setUserId] = useState<number | ''>('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [isWhatsapp, setIsWhatsapp] = useState(true);
  const [birthDate, setBirthDate] = useState('');
  const [maritalStatus, setMaritalStatus] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');
  const [zipCode, setZipCode] = useState('');
  const [address, setAddress] = useState('');
  const [addressNumber, setAddressNumber] = useState('');
  const [complement, setComplement] = useState('');
  const [neighborhood, setNeighborhood] = useState('');
  const [city, setCity] = useState('');
  const [stateUf, setStateUf] = useState('');
  const [notes, setNotes] = useState('');

  const [cameraOpen, setCameraOpen] = useState(false);
  const [maritalOpen, setMaritalOpen] = useState(false);
  const [cepLoading, setCepLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<CollaboratorItem | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteErr, setDeleteErr] = useState('');
  const [auditTarget, setAuditTarget] = useState<{ id: number; label: string } | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return collaborators.filter((c) => {
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        (c.jobTitle || '').toLowerCase().includes(q) ||
        (c.email || '').toLowerCase().includes(q) ||
        (c.code || '').toLowerCase().includes(q)
      );
    });
  }, [collaborators, search]);

  // Organize tree: Unit -> Role -> Collaborators
  const groupedTree = useMemo(() => {
    const unitMap = new Map<number, { unitName: string; total: number; roles: Map<string, CollaboratorItem[]> }>();
    for (const c of filtered) {
      const u = units.find((x) => x.id === c.unitId);
      const uName = u ? `${u.code} · ${u.name}` : `Unidade #${c.unitId}`;
      if (!unitMap.has(c.unitId)) {
        unitMap.set(c.unitId, { unitName: uName, total: 0, roles: new Map() });
      }
      const bucket = unitMap.get(c.unitId)!;
      bucket.total += 1;
      const roleLabel = c.jobTitle || 'Sem Cargo Definido';
      if (!bucket.roles.has(roleLabel)) bucket.roles.set(roleLabel, []);
      bucket.roles.get(roleLabel)!.push(c);
    }
    return Array.from(unitMap.entries()).map(([uId, data]) => ({
      unitId: uId,
      unitName: data.unitName,
      total: data.total,
      roles: Array.from(data.roles.entries()).sort((a, b) => a[0].localeCompare(b[0], 'pt-BR')),
    }));
  }, [filtered, units]);

  const expandAll = () => {
    setCollapsedUnits({});
    setCollapsedRoles({});
  };

  const collapseAll = () => {
    const uState: Record<number, boolean> = {};
    const rState: Record<string, boolean> = {};
    groupedTree.forEach((u) => {
      uState[u.unitId] = true;
      u.roles.forEach(([rName]) => {
        rState[`${u.unitId}:${rName}`] = true;
      });
    });
    setCollapsedUnits(uState);
    setCollapsedRoles(rState);
  };

  const openForm = (c?: CollaboratorItem, isDup = false) => {
    setErrorMsg('');
    setFeedback('');
    if (c) {
      setEditingId(isDup ? null : c.id);
      setCode(isDup ? '' : c.code || '');
      setName(isDup ? `${c.name} (Cópia)` : c.name);
      setActive(c.active);
      setParticipatesInScheduleQueue(Boolean(c.participatesInScheduleQueue));
      setUnitId(c.unitId || activeUnitId || 1);
      setRoleId(c.roleId || roles.find((r) => r.name.toLowerCase() === (c.jobTitle || '').toLowerCase())?.id || '');
      setDepartmentId(c.departmentId || '');
      setUserId(isDup ? '' : c.userId || '');
      setEmail(isDup ? '' : c.email || '');
      setPhone(c.phone || '');
      setIsWhatsapp(Boolean(c.isWhatsapp));
      setBirthDate(c.birthDate || '');
      setMaritalStatus(c.maritalStatus || '');
      setPhotoUrl(isDup ? '' : c.photoUrl || '');
      setZipCode(c.zipCode || '');
      setAddress(c.address || '');
      setAddressNumber(c.addressNumber || '');
      setComplement(c.complement || '');
      setNeighborhood(c.neighborhood || '');
      setCity(c.city || '');
      setStateUf(c.state || '');
      setNotes(c.notes || '');
    } else {
      setEditingId(null);
      setCode('');
      setName('');
      setActive(true);
      setParticipatesInScheduleQueue(false);
      setUnitId(activeUnitId || units[0]?.id || 1);
      setRoleId(roles[0]?.id || '');
      setDepartmentId(departments[0]?.id || '');
      setUserId('');
      setEmail('');
      setPhone('');
      setIsWhatsapp(true);
      setBirthDate('');
      setMaritalStatus('');
      setPhotoUrl('');
      setZipCode('');
      setAddress('');
      setAddressNumber('');
      setComplement('');
      setNeighborhood('');
      setCity('');
      setStateUf('');
      setNotes('');
    }
    setMode('form');
  };

  const handlePhotoFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (f.size > 1_500_000) {
      setErrorMsg('Imagem excede 1,5 MB. Selecione uma foto menor ou use a câmera.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') setPhotoUrl(reader.result);
    };
    reader.readAsDataURL(f);
  };

  const handleLookupCep = async () => {
    const clean = zipCode.replace(/\D/g, '');
    if (clean.length !== 8) {
      setErrorMsg('Informe um CEP válido com 8 dígitos.');
      return;
    }
    setCepLoading(true);
    setErrorMsg('');
    try {
      const res = await apiFetch<{ address: string; complement?: string; neighborhood: string; city: string; state: string }>(
        `/api/cadastros/cep/${clean}`
      );
      if (res.address) setAddress(res.address);
      if (res.complement && !complement) setComplement(res.complement);
      if (res.neighborhood) setNeighborhood(res.neighborhood);
      if (res.city) setCity(res.city);
      if (res.state) setStateUf(res.state);
      setFeedback('Endereço preenchido via ViaCEP.');
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'CEP não localizado.');
    } finally {
      setCepLoading(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    if (!name.trim() || !unitId || !roleId || !departmentId) {
      setErrorMsg('Preencha Nome completo, Unidade, Cargo e Setor/Departamento.');
      return;
    }
    const chosenRole = roles.find((r) => r.id === Number(roleId));
    setSaving(true);
    try {
      const payload = {
        code: code.trim(),
        name: name.trim(),
        active,
        participatesInScheduleQueue,
        unitId: Number(unitId),
        roleId: Number(roleId),
        jobTitle: chosenRole?.name || '',
        departmentId: Number(departmentId),
        userId: userId ? Number(userId) : null,
        email: email.trim(),
        phone: phone.trim(),
        isWhatsapp,
        birthDate,
        maritalStatus,
        photoUrl,
        zipCode: zipCode.trim(),
        address: address.trim(),
        addressNumber: addressNumber.trim(),
        complement: complement.trim(),
        neighborhood: neighborhood.trim(),
        city: city.trim(),
        state: stateUf.trim().toUpperCase(),
        notes: notes.trim(),
      };
      if (editingId) {
        await apiFetch(`/api/cadastros/collaborators/${editingId}`, { method: 'PUT', body: JSON.stringify(payload) });
        setFeedback(`Colaborador "${payload.name}" atualizado.`);
      } else {
        await apiFetch('/api/cadastros/collaborators', { method: 'POST', body: JSON.stringify(payload) });
        setFeedback(`Colaborador "${payload.name}" cadastrado.`);
      }
      await onRefresh();
      setMode('tree');
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Erro ao salvar colaborador.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleQueueFlag = async (m: CollaboratorItem) => {
    const nextVal = !Boolean(m.participatesInScheduleQueue);
    setErrorMsg('');
    try {
      await apiFetch(`/api/cadastros/collaborators/${m.id}/queue-flag`, {
        method: 'PATCH',
        body: JSON.stringify({ participatesInScheduleQueue: nextVal }),
      });
      setFeedback(
        `${m.name}: "Participa da Fila" ${nextVal ? 'marcado (T — visível em Agendamentos)' : 'desmarcado (F)'}.`
      );
      await onRefresh();
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Erro ao atualizar flag Participa da Fila.');
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    setDeleteErr('');
    try {
      await apiFetch(`/api/cadastros/collaborators/${deleteTarget.id}`, { method: 'DELETE' });
      setDeleteTarget(null);
      setFeedback(`Colaborador "${deleteTarget.name}" excluído.`);
      await onRefresh();
    } catch (e) {
      setDeleteErr(e instanceof Error ? e.message : 'Erro ao excluir colaborador.');
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {feedback && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-medium text-emerald-900 flex items-center justify-between dark:border-emerald-800/70 dark:bg-emerald-950/50 dark:text-emerald-300">
          <span>{feedback}</span>
          <button type="button" onClick={() => setFeedback('')}>
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      {errorMsg && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-xs font-medium text-red-800 flex items-center justify-between dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300">
          <span>{errorMsg}</span>
          <button type="button" onClick={() => setErrorMsg('')}>
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {mode === 'tree' ? (
        <>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h1 className="font-display text-xl font-bold text-slate-900 dark:text-slate-100">Cadastros Comuns · Colaboradores</h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Árvore organizacional por Unidade e Cargo — alimenta seleção de Consultores em Admissão &amp; Agenda
              </p>
            </div>
            <button
              type="button"
              onClick={() => openForm()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-emerald-600 dark:hover:bg-emerald-500"
            >
              <Plus className="w-3.5 h-3.5" /> Novo Colaborador
            </button>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-3.5 flex flex-wrap items-center justify-between gap-2 text-xs dark:border-slate-700 dark:bg-slate-900">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 dark:text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar colaborador por nome, cargo, código ou e-mail..."
                className="w-full rounded-lg border border-slate-200 pl-8 pr-3 py-2 dark:border-slate-700"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={expandAll}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <Maximize2 className="w-3.5 h-3.5" /> Expandir Todos
              </button>
              <button
                type="button"
                onClick={collapseAll}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <Minimize2 className="w-3.5 h-3.5" /> Recolher Todos
              </button>
            </div>
          </div>

          {/* Árvore Expansível: Unidade -> Cargo -> Pessoas */}
          <div className="space-y-3 text-xs">
            {groupedTree.length === 0 ? (
              <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
                Nenhum colaborador encontrado.
              </div>
            ) : (
              groupedTree.map((uGrp) => {
                const uCollapsed = Boolean(collapsedUnits[uGrp.unitId]);
                return (
                  <div key={uGrp.unitId} className="rounded-xl border border-slate-200 bg-white overflow-hidden dark:border-slate-700 dark:bg-slate-900">
                    <button
                      type="button"
                      onClick={() => setCollapsedUnits((p) => ({ ...p, [uGrp.unitId]: !p[uGrp.unitId] }))}
                      className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 border-b border-slate-200 font-bold text-slate-900 hover:bg-slate-100 dark:bg-slate-800/70 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800"
                    >
                      <span className="flex items-center gap-2">
                        {uCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        <Building2 className="w-4 h-4 text-slate-600 dark:text-slate-300" />
                        <span>{uGrp.unitName}</span>
                      </span>
                      <span className="font-mono text-[11px] text-slate-600 dark:text-slate-300">{uGrp.total} colaborador(es)</span>
                    </button>

                    {!uCollapsed && (
                      <div className="divide-y divide-slate-100 dark:divide-slate-800">
                        {uGrp.roles.map(([roleName, members]) => {
                          const rKey = `${uGrp.unitId}:${roleName}`;
                          const rCollapsed = Boolean(collapsedRoles[rKey]);
                          return (
                            <div key={rKey} className="bg-white dark:bg-slate-900">
                              <button
                                type="button"
                                onClick={() => setCollapsedRoles((p) => ({ ...p, [rKey]: !p[rKey] }))}
                                className="w-full flex items-center justify-between px-6 py-2.5 bg-slate-50/40 font-semibold text-slate-800 hover:bg-slate-50 dark:text-slate-100 dark:hover:bg-slate-800"
                              >
                                <span className="flex items-center gap-2">
                                  {rCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                                  <UserCheck className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-300" />
                                  <span>{roleName}</span>
                                </span>
                                <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">{members.length} pessoa(s)</span>
                              </button>

                              {!rCollapsed && (
                                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                                  {members.map((m) => {
                                    const dept = departments.find((d) => d.id === m.departmentId);
                                    const initials = m.name
                                      .split(' ')
                                      .slice(0, 2)
                                      .map((p) => p[0] || '')
                                      .join('')
                                      .toUpperCase();
                                    return (
                                      <div key={m.id} className="flex flex-wrap items-center justify-between gap-3 px-8 py-3 hover:bg-slate-50/70 dark:hover:bg-slate-800">
                                        <div className="flex items-center gap-3 min-w-0">
                                          {m.photoUrl ? (
                                            <img
                                              src={m.photoUrl}
                                              alt={m.name}
                                              className="w-9 h-9 rounded-full object-cover border border-slate-200 shrink-0 dark:border-slate-700"
                                            />
                                          ) : (
                                            <div className="w-9 h-9 rounded-full bg-slate-900 text-white font-bold flex items-center justify-center shrink-0 dark:bg-emerald-600">
                                              {initials || 'CL'}
                                            </div>
                                          )}
                                          <div className="min-w-0">
                                            <div className="flex flex-wrap items-center gap-2">
                                              <span className="font-semibold text-slate-900 truncate dark:text-slate-100">{m.name}</span>
                                              {m.code && <span className="font-mono text-[10px] text-slate-400 dark:text-slate-400">{m.code}</span>}
                                              <span className={`text-[10px] font-bold uppercase ${m.active ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-600 dark:text-red-400'}`}>
                                                {m.active ? 'Ativo' : 'Inativo'}
                                              </span>
                                              {Boolean(m.participatesInScheduleQueue) && (
                                                <span className="text-[10px] font-semibold uppercase text-blue-700 dark:text-blue-300">
                                                  · Participa da Fila (T)
                                                </span>
                                              )}
                                            </div>
                                            <div className="text-[11px] text-slate-500 truncate dark:text-slate-400">
                                              Setor: {dept?.name || '—'} · Tel: {m.phone || '—'} · E-mail: {m.email || '—'}
                                            </div>
                                          </div>
                                        </div>

                                        <div className="inline-flex flex-wrap items-center gap-2 shrink-0">
                                          <label
                                            className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50 cursor-pointer select-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                                            title="Quando marcado (T), exibe o colaborador na fila de Agendamentos"
                                          >
                                            <input
                                              type="checkbox"
                                              checked={Boolean(m.participatesInScheduleQueue)}
                                              onChange={() => void handleToggleQueueFlag(m)}
                                              className="w-3.5 h-3.5 rounded accent-slate-900"
                                            />
                                            <span>Participa da Fila</span>
                                          </label>
                                          <button
                                            type="button"
                                            onClick={() => setAuditTarget({ id: m.id, label: m.name })}
                                            className="rounded-md border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                                            title="Auditoria"
                                          >
                                            <History className="w-3.5 h-3.5" />
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => openForm(m, false)}
                                            className="rounded-md border border-slate-200 p-1.5 text-blue-700 hover:bg-blue-50 dark:border-slate-700 dark:text-blue-300 dark:hover:bg-blue-950/60"
                                            title="Editar"
                                          >
                                            <Pencil className="w-3.5 h-3.5" />
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => openForm(m, true)}
                                            className="rounded-md border border-slate-200 p-1.5 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                                            title="Duplicar"
                                          >
                                            <Copy className="w-3.5 h-3.5" />
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => {
                                              setDeleteErr('');
                                              setDeleteTarget(m);
                                            }}
                                            className="rounded-md border border-red-200 p-1.5 text-red-600 hover:bg-red-50 dark:border-red-800/70 dark:text-red-400 dark:hover:bg-red-950/60"
                                            title="Excluir"
                                          >
                                            <Trash2 className="w-3.5 h-3.5" />
                                          </button>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })
            )}
            <div className="text-right text-[11px] text-slate-500 dark:text-slate-400">
              Total exibido na árvore: <strong>{filtered.length}</strong> colaborador(es)
            </div>
          </div>
        </>
      ) : (
        <form onSubmit={handleSave} className="rounded-2xl border border-slate-200 bg-white p-6 space-y-5 text-xs dark:border-slate-700 dark:bg-slate-900">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setMode('tree')} className="rounded-lg border border-slate-200 p-1.5 text-slate-600 dark:border-slate-700 dark:text-slate-300">
                <ArrowLeft className="w-4 h-4" />
              </button>
              <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                {editingId ? 'Editar Colaborador' : 'Novo Colaborador'}
              </h2>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <label
                className="inline-flex items-center gap-2 font-semibold text-slate-800 cursor-pointer dark:text-slate-100"
                title="Padrão desmarcado (F). Se marcado (T), este colaborador será apresentado na fila de colaboradores da opção Agendamentos."
              >
                <input
                  type="checkbox"
                  checked={participatesInScheduleQueue}
                  onChange={(e) => setParticipatesInScheduleQueue(e.target.checked)}
                />
                <span>Participa da Fila</span>
                <span className="text-[10px] font-normal text-slate-500 dark:text-slate-400">
                  (Fila de Agendamentos)
                </span>
              </label>
              <label className="inline-flex items-center gap-2 font-semibold text-slate-800 cursor-pointer dark:text-slate-100">
                <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
                Colaborador Ativo
              </label>
            </div>
          </div>

          {/* Foto (Câmera, Arquivo, Remover) */}
          <div className="flex flex-wrap items-center gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/70">
            {photoUrl ? (
              <img src={photoUrl} alt="Foto" className="w-16 h-16 rounded-full object-cover border border-slate-300 dark:border-slate-600" />
            ) : (
              <div className="w-16 h-16 rounded-full bg-slate-200 text-slate-500 flex items-center justify-center font-bold dark:bg-slate-700 dark:text-slate-400">
                FOTO
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setCameraOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 font-semibold text-white hover:bg-slate-800 dark:bg-emerald-600 dark:hover:bg-emerald-500"
              >
                <Camera className="w-3.5 h-3.5" /> Capturar pela Câmera
              </button>
              <label className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 font-semibold text-slate-700 hover:bg-slate-100 cursor-pointer dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800">
                <Upload className="w-3.5 h-3.5" /> Enviar Arquivo
                <input type="file" accept="image/*" className="hidden" onChange={handlePhotoFile} />
              </label>
              {photoUrl && (
                <button
                  type="button"
                  onClick={() => setPhotoUrl('')}
                  className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-white px-3 py-2 font-semibold text-red-600 hover:bg-red-50 dark:border-red-800/70 dark:bg-slate-900 dark:text-red-400 dark:hover:bg-red-950/60"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Remover
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3.5">
            <div className="lg:col-span-2">
              <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">Código</label>
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="COL-007"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
            <div className="lg:col-span-4">
              <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">Nome Completo *</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 font-semibold dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
            <div className="lg:col-span-2">
              <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">Unidade *</label>
              <select
                required
                value={unitId}
                onChange={(e) => setUnitId(Number(e.target.value))}
                className="w-full rounded-lg border border-slate-200 px-2.5 py-2 font-semibold dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              >
                {units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.code} · {u.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="lg:col-span-2">
              <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">Cargo / Função *</label>
              <select
                required
                value={roleId}
                onChange={(e) => setRoleId(e.target.value ? Number(e.target.value) : '')}
                className="w-full rounded-lg border border-slate-200 px-2.5 py-2 font-semibold dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              >
                <option value="">Selecione...</option>
                {roles.filter((r) => r.active || r.id === roleId).map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="lg:col-span-2">
              <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">Setor / Depto *</label>
              <select
                required
                value={departmentId}
                onChange={(e) => setDepartmentId(e.target.value ? Number(e.target.value) : '')}
                className="w-full rounded-lg border border-slate-200 px-2.5 py-2 font-semibold dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              >
                <option value="">Selecione...</option>
                {departments.filter((d) => d.status === 'ATIVO' || d.id === departmentId).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3.5">
            <div className="lg:col-span-4">
              <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">E-mail Corporativo</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
            <div className="lg:col-span-3">
              <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">Telefone</label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={phone}
                  onChange={(e) => setPhone(formatPhoneMask(e.target.value))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
                <label className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 whitespace-nowrap cursor-pointer dark:text-emerald-300">
                  <input type="checkbox" checked={isWhatsapp} onChange={(e) => setIsWhatsapp(e.target.checked)} />
                  Zap
                </label>
              </div>
            </div>
            <div className="lg:col-span-2">
              <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">Nascimento</label>
              <input
                type="date"
                value={birthDate}
                onChange={(e) => setBirthDate(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
            <div className="lg:col-span-3">
              <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">Estado Civil</label>
              <div className="flex gap-1.5">
                <select
                  value={maritalStatus}
                  onChange={(e) => setMaritalStatus(e.target.value)}
                  className="flex-1 rounded-lg border border-slate-200 px-2.5 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                >
                  <option value="">Selecione...</option>
                  {maritalStatuses.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setMaritalOpen(true)}
                  className="rounded-lg border border-slate-200 px-2.5 py-2 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  <Settings2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3.5 pt-2 border-t border-slate-100 dark:border-slate-800">
            <div className="lg:col-span-3">
              <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">CEP (ViaCEP)</label>
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={zipCode}
                  onChange={(e) => setZipCode(formatCepMask(e.target.value))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
                <button
                  type="button"
                  disabled={cepLoading}
                  onClick={handleLookupCep}
                  className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-200"
                >
                  {cepLoading ? '...' : 'Buscar'}
                </button>
              </div>
            </div>
            <div className="lg:col-span-5">
              <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">Endereço</label>
              <input
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
            <div className="lg:col-span-2">
              <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">Número</label>
              <input
                type="text"
                value={addressNumber}
                onChange={(e) => setAddressNumber(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
            <div className="lg:col-span-2">
              <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">Complemento</label>
              <input
                type="text"
                value={complement}
                onChange={(e) => setComplement(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
            <div className="lg:col-span-4">
              <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">Bairro</label>
              <input
                type="text"
                value={neighborhood}
                onChange={(e) => setNeighborhood(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
            <div className="lg:col-span-6">
              <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">Cidade</label>
              <input
                type="text"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
            <div className="lg:col-span-2">
              <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">UF</label>
              <select
                value={stateUf}
                onChange={(e) => setStateUf(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              >
                <option value="">UF</option>
                {BRAZILIAN_UFS.map((uf) => (
                  <option key={uf} value={uf}>
                    {uf}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">Anotações</label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full rounded-lg border border-slate-200 p-2.5 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
            <button type="button" onClick={() => setMode('tree')} className="rounded-lg border border-slate-200 px-4 py-2 font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200">
              Voltar para Árvore
            </button>
            <button type="submit" disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-5 py-2 font-semibold text-white hover:bg-emerald-700">
              <Save className="w-3.5 h-3.5" /> {saving ? 'Salvando...' : 'Salvar Colaborador'}
            </button>
          </div>
        </form>
      )}

      <CameraCaptureModal
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onCapture={(dataUrl) => {
          setPhotoUrl(dataUrl);
          setCameraOpen(false);
        }}
      />

      <MaritalStatusModal
        open={maritalOpen}
        options={maritalStatuses}
        onClose={() => setMaritalOpen(false)}
        onUpdated={onMaritalStatusesChange}
      />

      <ConfirmDeleteModal
        open={Boolean(deleteTarget)}
        title={`Excluir Colaborador "${deleteTarget?.name || ''}"`}
        description="Se este colaborador já possuir admissões, agendamentos ou bloqueios de agenda, a exclusão será bloqueada — utilize a opção Inativo nesse caso."
        busy={deleteBusy}
        error={deleteErr}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleConfirmDelete}
      />

      <EntityAuditModal
        open={Boolean(auditTarget)}
        title={auditTarget?.label || ''}
        entityType="collaborator"
        entityId={auditTarget?.id || 0}
        onClose={() => setAuditTarget(null)}
      />
    </div>
  );
};

// =============================================================================
// 4. DEPARTAMENTOS (Fonte única PostgreSQL: sincroniza Tela + Colaboradores)
// =============================================================================
export const DepartmentsCrudView: React.FC<{
  departments: DepartmentItem[];
  onRefresh: () => Promise<void>;
}> = ({ departments, onRefresh }) => {
  const [mode, setMode] = useState<'list' | 'form'>('list');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [managerName, setManagerName] = useState('');
  const [status, setStatus] = useState<'ATIVO' | 'INATIVO'>('ATIVO');

  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<DepartmentItem | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteErr, setDeleteErr] = useState('');
  const [auditTarget, setAuditTarget] = useState<{ id: number; label: string } | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return departments.filter(
      (d) =>
        !q ||
        d.name.toLowerCase().includes(q) ||
        (d.code || '').toLowerCase().includes(q) ||
        (d.managerName || '').toLowerCase().includes(q)
    );
  }, [departments, search]);

  const openForm = (d?: DepartmentItem) => {
    setErrorMsg('');
    setFeedback('');
    if (d) {
      setEditingId(d.id);
      setCode(d.code || '');
      setName(d.name || '');
      setManagerName(d.managerName || '');
      setStatus(d.status === 'INATIVO' ? 'INATIVO' : 'ATIVO');
    } else {
      setEditingId(null);
      setCode('');
      setName('');
      setManagerName('');
      setStatus('ATIVO');
    }
    setMode('form');
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setErrorMsg('Nome do departamento é obrigatório.');
      return;
    }
    setSaving(true);
    setErrorMsg('');
    try {
      const payload = {
        code: code.trim(),
        name: name.trim().toUpperCase(),
        managerName: managerName.trim(),
        status,
      };
      if (editingId) {
        await apiFetch(`/api/cadastros/departments/${editingId}`, { method: 'PUT', body: JSON.stringify(payload) });
        setFeedback(`Departamento "${payload.name}" atualizado e sincronizado com Colaboradores.`);
      } else {
        await apiFetch('/api/cadastros/departments', { method: 'POST', body: JSON.stringify(payload) });
        setFeedback(`Departamento "${payload.name}" cadastrado e sincronizado com Colaboradores.`);
      }
      await onRefresh();
      setMode('list');
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Erro ao salvar departamento.');
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    setDeleteErr('');
    try {
      await apiFetch(`/api/cadastros/departments/${deleteTarget.id}`, { method: 'DELETE' });
      setDeleteTarget(null);
      setFeedback(`Departamento "${deleteTarget.name}" excluído.`);
      await onRefresh();
    } catch (e) {
      setDeleteErr(e instanceof Error ? e.message : 'Erro ao excluir departamento.');
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {feedback && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-medium text-emerald-900 flex items-center justify-between dark:border-emerald-800/70 dark:bg-emerald-950/50 dark:text-emerald-300">
          <span>{feedback}</span>
          <button type="button" onClick={() => setFeedback('')}>
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      {errorMsg && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-xs font-medium text-red-800 flex items-center justify-between dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300">
          <span>{errorMsg}</span>
          <button type="button" onClick={() => setErrorMsg('')}>
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {mode === 'list' ? (
        <>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h1 className="font-display text-xl font-bold text-slate-900 dark:text-slate-100">Cadastros Comuns · Departamentos</h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Setores organizacionais sincronizados em tempo real com Colaboradores no Cloud SQL
              </p>
            </div>
            <button
              type="button"
              onClick={() => openForm()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-emerald-600 dark:hover:bg-emerald-500"
            >
              <Plus className="w-3.5 h-3.5" /> Novo Departamento
            </button>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-700 dark:bg-slate-900">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 dark:text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por nome, código ou responsável..."
                className="w-full rounded-lg border border-slate-200 pl-8 pr-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden dark:border-slate-700 dark:bg-slate-900">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-300">
                  <th className="py-3 px-4">Descrição</th>
                  <th className="py-3 px-4">Responsável / Gerente</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-8 text-center text-slate-500 dark:text-slate-400">
                      Nenhum departamento localizado.
                    </td>
                  </tr>
                ) : (
                  filtered.map((d) => (
                    <tr key={d.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800">
                      <td className="py-3 px-4 font-bold text-slate-900 dark:text-slate-100">{d.name}</td>
                      <td className="py-3 px-4 text-slate-700 dark:text-slate-200">{d.managerName || '—'}</td>
                      <td className="py-3 px-4">
                        <span className={d.status === 'ATIVO' ? 'text-emerald-700 font-semibold dark:text-emerald-300' : 'text-slate-400 font-semibold dark:text-slate-400'}>
                          {d.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setAuditTarget({ id: d.id, label: d.name })}
                            className="rounded-md border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                            title="Auditoria"
                          >
                            <History className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => openForm(d)}
                            className="rounded-md border border-slate-200 p-1.5 text-blue-700 hover:bg-blue-50 dark:border-slate-700 dark:text-blue-300 dark:hover:bg-blue-950/60"
                            title="Editar"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setDeleteErr('');
                              setDeleteTarget(d);
                            }}
                            className="rounded-md border border-red-200 p-1.5 text-red-600 hover:bg-red-50 dark:border-red-800/70 dark:text-red-400 dark:hover:bg-red-950/60"
                            title="Excluir"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <form onSubmit={handleSave} className="rounded-2xl border border-slate-200 bg-white p-6 space-y-4 text-xs dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-3 dark:border-slate-800">
            <button type="button" onClick={() => setMode('list')} className="rounded-lg border border-slate-200 p-1.5 text-slate-600 dark:border-slate-700 dark:text-slate-300">
              <ArrowLeft className="w-4 h-4" />
            </button>
            <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
              {editingId ? 'Editar Departamento' : 'Novo Departamento'}
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Código</label>
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="DEP-COM"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
            <div className="lg:col-span-2">
              <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Nome do Departamento *</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value.toUpperCase())}
                placeholder="COMERCIAL"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 uppercase font-bold dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as 'ATIVO' | 'INATIVO')}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 font-semibold dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              >
                <option value="ATIVO">ATIVO</option>
                <option value="INATIVO">INATIVO</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Responsável / Gerente</label>
            <input
              type="text"
              value={managerName}
              onChange={(e) => setManagerName(e.target.value)}
              placeholder="Nome do responsável pela área"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
            <button type="button" onClick={() => setMode('list')} className="rounded-lg border border-slate-200 px-4 py-2 font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200">
              Cancelar
            </button>
            <button type="submit" disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-5 py-2 font-semibold text-white hover:bg-emerald-700">
              <Save className="w-3.5 h-3.5" /> {saving ? 'Salvando...' : 'Salvar Departamento'}
            </button>
          </div>
        </form>
      )}

      <ConfirmDeleteModal
        open={Boolean(deleteTarget)}
        title={`Excluir Departamento "${deleteTarget?.name || ''}"`}
        description="A exclusão será bloqueada se houver colaboradores vinculados a este setor."
        busy={deleteBusy}
        error={deleteErr}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleConfirmDelete}
      />

      <EntityAuditModal
        open={Boolean(auditTarget)}
        title={auditTarget?.label || ''}
        entityType="department"
        entityId={auditTarget?.id || 0}
        onClose={() => setAuditTarget(null)}
      />
    </div>
  );
};
