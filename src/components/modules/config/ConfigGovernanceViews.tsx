import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  BookOpen,
  Check,
  Edit3,
  Eye,
  History,
  KeyRound,
  Palette,
  Plus,
  RotateCcw,
  Search,
  Shield,
  Trash2,
  Upload,
  UserPlus,
  X,
} from 'lucide-react';
import { apiFetch, formatDateTimeBR } from '../../../lib/api.ts';
import {
  AuditChecklistItem,
  AuthUser,
  ConfigUserItem,
  HelpCenterTopic,
  ModalityItem,
  PortalBrandingConfig,
  UazapiInstancePublic,
  Unit,
  UserGroup,
} from '../../../types.ts';
import {
  ConfirmDeleteModal,
  EntityAuditModal,
  formatPhoneMask,
} from '../cadastros/CadastrosShared.tsx';

export function sanitizeHelpHtml(rawHtml: string): string {
  if (!rawHtml) return '';
  return rawHtml
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<(iframe|object|embed|form|meta|link)\b[^>]*>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript:/gi, '');
}

const RBAC_MODULE_LIST: Array<{ key: string; label: string }> = [
  { key: 'overview', label: 'Visão Executiva' },
  { key: 'managerial_dashboard', label: 'Dashboard Gerencial' },
  { key: 'cad_clientes', label: 'Cadastros · Clientes' },
  { key: 'cad_colaboradores', label: 'Cadastros · Colaboradores' },
  { key: 'cad_bancos', label: 'Cadastros · Bancos & Modalidades' },
  { key: 'prospection', label: 'Prospecção & Agenda' },
  { key: 'appointments', label: 'Agendamentos' },
  { key: 'admission', label: 'Admissão & Dossiês' },
  { key: 'audit', label: 'Auditoria & Boletos' },
  { key: 'legal', label: 'Jurídico & Escavador' },
  { key: 'negotiations', label: 'Negociações Bancárias' },
  { key: 'finance', label: 'Financeiro & Régua' },
  { key: 'collection', label: 'Cobrança & Ranking' },
  { key: 'forms', label: 'Formulários & Relatórios · Formulários' },
  { key: 'reports', label: 'Formulários & Relatórios · Relatórios Gerais' },
  { key: 'jur_dashboard', label: 'Governança · Acomp. Jurídico (Dashboard)' },
  { key: 'jur_processos', label: 'Governança · Acomp. Jurídico (Processos)' },
  { key: 'jur_prazos', label: 'Governança · Acomp. Jurídico (Prazos e Audiências)' },
  { key: 'config', label: 'Governança · Configurações & SQL' },
];

// =============================================================================
// 1. GRUPOS DE ACESSO (RBAC + VÍNCULO DE NÚMEROS UAZAPI) & USUÁRIOS CRUD
// =============================================================================
export const ConfigGroupsAndUsersView: React.FC<{
  currentUser: AuthUser;
  groups: UserGroup[];
  usersList: ConfigUserItem[];
  units: Unit[];
  uazapiInstances: UazapiInstancePublic[];
  onRefresh: () => Promise<void>;
  onToast: (msg: string) => void;
}> = ({
  currentUser,
  groups,
  usersList,
  units,
  uazapiInstances,
  onRefresh,
  onToast,
}) => {
  const isAdmin = currentUser.role === 'admin';
  const [subView, setSubView] = useState<'groups' | 'users'>('groups');
  const [userSearch, setUserSearch] = useState('');
  const [userGroupFilter, setUserGroupFilter] = useState('all');

  // Group Modal
  const [grpModalOpen, setGrpModalOpen] = useState(false);
  const [editGrpId, setEditGrpId] = useState<number | null>(null);
  const [grpName, setGrpName] = useState('');
  const [grpDesc, setGrpDesc] = useState('');
  const [grpPerms, setGrpPerms] = useState<Record<string, boolean>>({});
  const [grpUazapiIds, setGrpUazapiIds] = useState<number[]>([]);
  const [grpFeeFieldPerm, setGrpFeeFieldPerm] = useState<'edit' | 'read' | 'hidden'>('edit');
  const [grpSaving, setGrpSaving] = useState(false);
  const [grpErr, setGrpErr] = useState('');
  const [deleteGrpTarget, setDeleteGrpTarget] = useState<UserGroup | null>(null);
  const [deleteGrpErr, setDeleteGrpErr] = useState('');
  const [deleteGrpBusy, setDeleteGrpBusy] = useState(false);

  // User Modal
  const [usrModalOpen, setUsrModalOpen] = useState(false);
  const [editUsrId, setEditUsrId] = useState<number | null>(null);
  const [usrName, setUsrName] = useState('');
  const [usrEmail, setUsrEmail] = useState('');
  const [usrRole, setUsrRole] = useState('consultant');
  const [usrGroupId, setUsrGroupId] = useState<string>('');
  const [usrDefaultUnitId, setUsrDefaultUnitId] = useState<number>(units[0]?.id || 1);
  const [usrAllowedUnits, setUsrAllowedUnits] = useState<number[]>([]);
  const [usrPhone, setUsrPhone] = useState('');
  const [usrPassword, setUsrPassword] = useState('');
  const [usrMustChangePwd, setUsrMustChangePwd] = useState(true);
  const [usrActive, setUsrActive] = useState(true);
  const [usrSaving, setUsrSaving] = useState(false);
  const [usrErr, setUsrErr] = useState('');

  const [auditEntity, setAuditEntity] = useState<{ type: string; id: number; title: string } | null>(null);

  const openNewGroup = () => {
    setEditGrpId(null);
    setGrpName('');
    setGrpDesc('');
    setGrpPerms({
      overview: true,
      managerial_dashboard: true,
      cad_clientes: true,
      prospection: true,
      admission: true,
      audit: false,
      legal: false,
      negotiations: false,
      finance: false,
      collection: false,
      forms: true,
      reports: true,
      config: false,
    });
    setGrpUazapiIds([]);
    setGrpFeeFieldPerm('edit');
    setGrpErr('');
    setGrpModalOpen(true);
  };

  const openEditGroup = (grp: UserGroup) => {
    setEditGrpId(grp.id);
    setGrpName(grp.name);
    setGrpDesc(grp.description || '');
    setGrpPerms({ ...(grp.modulePermissions || {}) });
    const boundInstIds = uazapiInstances
      .filter((inst) => (inst.allowedGroupIds || []).includes(grp.id))
      .map((inst) => inst.id);
    setGrpUazapiIds(boundInstIds);
    setGrpFeeFieldPerm(grp.fieldPermissions?.admission?.serviceFeeCents || 'edit');
    setGrpErr('');
    setGrpModalOpen(true);
  };

  const handleSaveGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!grpName.trim()) {
      setGrpErr('Informe o nome do grupo de acesso.');
      return;
    }
    setGrpSaving(true);
    setGrpErr('');
    try {
      await apiFetch('/api/config/groups/save', {
        method: 'POST',
        body: JSON.stringify({
          id: editGrpId,
          name: grpName.trim(),
          description: grpDesc.trim(),
          modulePermissions: grpPerms,
          fieldPermissions: {
            admission: { serviceFeeCents: grpFeeFieldPerm },
          },
          uazapiInstanceIds: grpUazapiIds,
        }),
      });
      setGrpModalOpen(false);
      onToast(`Grupo "${grpName}" salvo com permissões e vínculo UaZapi.`);
      await onRefresh();
    } catch (err) {
      setGrpErr(err instanceof Error ? err.message : 'Erro ao salvar grupo.');
    } finally {
      setGrpSaving(false);
    }
  };

  const openNewUser = () => {
    setEditUsrId(null);
    setUsrName('');
    setUsrEmail('');
    setUsrRole('consultant');
    setUsrGroupId(groups[0] ? String(groups[0].id) : '');
    const firstUnit = units[0]?.id || 1;
    setUsrDefaultUnitId(firstUnit);
    setUsrAllowedUnits([firstUnit]);
    setUsrPhone('');
    setUsrPassword('');
    setUsrMustChangePwd(true);
    setUsrActive(true);
    setUsrErr('');
    setUsrModalOpen(true);
  };

  const openEditUser = (u: ConfigUserItem) => {
    setEditUsrId(u.id);
    setUsrName(u.name);
    setUsrEmail(u.email);
    setUsrRole(u.role);
    setUsrGroupId(u.groupId ? String(u.groupId) : '');
    const defU = u.defaultUnitId || units[0]?.id || 1;
    setUsrDefaultUnitId(defU);
    setUsrAllowedUnits(u.allowedUnitIds && u.allowedUnitIds.length > 0 ? u.allowedUnitIds : [defU]);
    setUsrPhone(u.whatsappPhone || '');
    setUsrPassword('');
    setUsrMustChangePwd(false);
    setUsrActive(u.active !== false);
    setUsrErr('');
    setUsrModalOpen(true);
  };

  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!usrName.trim() || !usrEmail.trim()) {
      setUsrErr('Nome e e-mail corporativo são obrigatórios.');
      return;
    }
    setUsrSaving(true);
    setUsrErr('');
    try {
      await apiFetch('/api/config/users/save', {
        method: 'POST',
        body: JSON.stringify({
          id: editUsrId,
          name: usrName.trim(),
          email: usrEmail.trim(),
          role: usrRole,
          groupId: usrGroupId ? Number(usrGroupId) : null,
          defaultUnitId: usrDefaultUnitId,
          allowedUnitIds: usrAllowedUnits.length > 0 ? usrAllowedUnits : [usrDefaultUnitId],
          whatsappPhone: usrPhone.trim(),
          password: usrPassword.trim() || undefined,
          mustChangePassword: usrMustChangePwd,
          active: usrActive,
        }),
      });
      setUsrModalOpen(false);
      onToast(editUsrId ? `Usuário ${usrName} atualizado.` : `Usuário ${usrName} criado.`);
      await onRefresh();
    } catch (err) {
      setUsrErr(err instanceof Error ? err.message : 'Erro ao salvar usuário.');
    } finally {
      setUsrSaving(false);
    }
  };

  const filteredUsers = useMemo(() => {
    const q = userSearch.trim().toLowerCase();
    return usersList.filter((u) => {
      if (userGroupFilter !== 'all' && String(u.groupId || '') !== userGroupFilter) return false;
      if (!q) return true;
      return (
        u.name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.role.toLowerCase().includes(q)
      );
    });
  }, [usersList, userSearch, userGroupFilter]);

  return (
    <div className="space-y-4 text-xs">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 w-fit dark:bg-slate-800">
          <button
            type="button"
            onClick={() => setSubView('groups')}
            className={`rounded-md px-3 py-1.5 font-semibold transition-colors whitespace-nowrap shrink-0 ${
              subView === 'groups' ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-slate-100' : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
            }`}
          >
            Grupos RBAC &amp; Números UaZapi ({groups.length})
          </button>
          <button
            type="button"
            onClick={() => setSubView('users')}
            className={`rounded-md px-3 py-1.5 font-semibold transition-colors whitespace-nowrap shrink-0 ${
              subView === 'users' ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-slate-100' : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
            }`}
          >
            Usuários &amp; Sessões ({usersList.length})
          </button>
        </div>

        {isAdmin && (
          <div>
            {subView === 'groups' ? (
              <button
                type="button"
                onClick={openNewGroup}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 font-semibold text-white hover:bg-slate-800 whitespace-nowrap shrink-0 dark:bg-emerald-600 dark:hover:bg-emerald-500"
              >
                <Plus className="w-3.5 h-3.5" />
                Novo Grupo de Acesso
              </button>
            ) : (
              <button
                type="button"
                onClick={openNewUser}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 font-semibold text-white hover:bg-slate-800 whitespace-nowrap shrink-0 dark:bg-emerald-600 dark:hover:bg-emerald-500"
              >
                <UserPlus className="w-3.5 h-3.5" />
                Novo Usuário
              </button>
            )}
          </div>
        )}
      </div>

      {subView === 'groups' ? (
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden dark:border-slate-700 dark:bg-slate-900">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-300">
                <tr>
                  <th className="px-4 py-2.5">Grupo &amp; Finalidade</th>
                  <th className="px-4 py-2.5">Módulos Habilitados</th>
                  <th className="px-4 py-2.5">Linhas WhatsApp UaZapi Vinculadas</th>
                  <th className="px-4 py-2.5 text-right whitespace-nowrap">Usuários</th>
                  <th className="px-4 py-2.5 text-right whitespace-nowrap">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {groups.map((grp) => {
                  const enabledMods = Object.entries(grp.modulePermissions || {})
                    .filter(([, v]) => Boolean(v))
                    .map(([k]) => RBAC_MODULE_LIST.find((m) => m.key === k)?.label.split(' ')[0] || k);
                  const groupInsts = uazapiInstances.filter(
                    (inst) =>
                      !inst.allowedGroupIds ||
                      inst.allowedGroupIds.length === 0 ||
                      inst.allowedGroupIds.includes(grp.id)
                  );
                  const memberCount = usersList.filter((u) => u.groupId === grp.id).length;
                  return (
                    <tr key={grp.id} className="hover:bg-slate-50/80">
                      <td className="px-4 py-2.5">
                        <div className="font-semibold text-slate-900 dark:text-slate-100">{grp.name}</div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">{grp.description || '—'}</div>
                      </td>
                      <td className="px-4 py-2.5 max-w-xs">
                        <div className="text-[11px] text-slate-700 truncate dark:text-slate-200">
                          {enabledMods.join(' · ') || 'Nenhum'}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 max-w-xs">
                        <div className="text-[11px] text-slate-700 truncate dark:text-slate-200">
                          {groupInsts.length > 0
                            ? groupInsts.map((i) => i.label).join(' · ')
                            : 'Nenhuma linha associada'}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono font-bold text-slate-900 tabular-nums dark:text-slate-100">
                        {memberCount}
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() =>
                              setAuditEntity({ type: 'user_group', id: grp.id, title: `Grupo ${grp.name}` })
                            }
                            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                            title="Histórico de Auditoria"
                          >
                            <History className="w-3.5 h-3.5" />
                          </button>
                          {isAdmin && (
                            <>
                              <button
                                type="button"
                                onClick={() => openEditGroup(grp)}
                                className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                                title="Editar Permissões & Linhas UaZapi"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setDeleteGrpErr('');
                                  setDeleteGrpTarget(grp);
                                }}
                                className="rounded-md p-1.5 text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/60"
                                title="Excluir Grupo"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2.5 rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-700 dark:bg-slate-900">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5 dark:text-slate-400" />
              <input
                type="text"
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                placeholder="Buscar usuário por nome, e-mail ou perfil..."
                className="w-full rounded-lg border border-slate-200 pl-8 pr-3 py-1.5 dark:border-slate-700"
              />
            </div>
            <select
              value={userGroupFilter}
              onChange={(e) => setUserGroupFilter(e.target.value)}
              className="rounded-lg border border-slate-200 px-2.5 py-1.5 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            >
              <option value="all">Todos os Grupos</option>
              {groups.map((g) => (
                <option key={g.id} value={String(g.id)}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden dark:border-slate-700 dark:bg-slate-900">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-300">
                  <tr>
                    <th className="px-4 py-2.5">Nome &amp; E-mail</th>
                    <th className="px-4 py-2.5 whitespace-nowrap">Perfil · Grupo RBAC</th>
                    <th className="px-4 py-2.5 whitespace-nowrap">Unidade Padrão &amp; Acesso</th>
                    <th className="px-4 py-2.5 whitespace-nowrap">WhatsApp</th>
                    <th className="px-4 py-2.5 text-right whitespace-nowrap">Pontos</th>
                    <th className="px-4 py-2.5 whitespace-nowrap">Status</th>
                    <th className="px-4 py-2.5 text-right whitespace-nowrap">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {filteredUsers.map((u) => {
                    const grp = u.groupId ? groups.find((g) => g.id === u.groupId) : null;
                    const defUnit = u.defaultUnitId ? units.find((x) => x.id === u.defaultUnitId) : null;
                    return (
                      <tr key={u.id} className="hover:bg-slate-50/80">
                        <td className="px-4 py-2.5">
                          <div className="font-semibold text-slate-900 dark:text-slate-100">{u.name}</div>
                          <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400">{u.email}</div>
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          <div className="font-medium text-slate-800 uppercase text-[11px] dark:text-slate-100">{u.role}</div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400">{grp?.name || 'Sem grupo'}</div>
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          <div className="text-slate-800 dark:text-slate-100">{defUnit ? `${defUnit.code} · ${defUnit.name}` : '—'}</div>
                          <div className="text-[11px] text-slate-500 font-mono tabular-nums dark:text-slate-400">
                            {(u.allowedUnitIds || []).length} unidade(s) liberada(s)
                          </div>
                        </td>
                        <td className="px-4 py-2.5 font-mono text-[11px] text-slate-700 tabular-nums whitespace-nowrap dark:text-slate-200">
                          {u.whatsappPhone || '—'}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono font-bold text-slate-900 tabular-nums dark:text-slate-100">
                          {u.points}
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          <span className={u.active ? 'font-semibold text-emerald-700 dark:text-emerald-300' : 'text-slate-400 dark:text-slate-400'}>
                            {u.active ? 'Ativo' : 'Inativo'}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1">
                            {isAdmin && (
                              <>
                                <button
                                  type="button"
                                  onClick={async () => {
                                    await apiFetch(`/api/config/users/${u.id}/revoke-sessions`, {
                                      method: 'POST',
                                    });
                                    onToast(`Sessões ativas de ${u.name} revogadas.`);
                                  }}
                                  title="Revogar Sessões Imediatamente"
                                  className="rounded-md border border-red-200 px-2 py-1 text-[11px] font-semibold text-red-700 hover:bg-red-50 dark:border-red-800/70 dark:text-red-300 dark:hover:bg-red-950/60"
                                >
                                  Revogar
                                </button>
                                <button
                                  type="button"
                                  onClick={() => openEditUser(u)}
                                  title="Editar Usuário"
                                  className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                                >
                                  <Edit3 className="w-3.5 h-3.5" />
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Modal Criar / Editar Grupo RBAC + Números UaZapi */}
      {grpModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 dark:bg-slate-950/80">
          <form
            onSubmit={handleSaveGroup}
            className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl space-y-4 text-xs max-h-[90vh] overflow-y-auto dark:border-slate-700 dark:bg-slate-900"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-slate-800 dark:text-slate-100" />
                <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                  {editGrpId ? 'Editar Grupo RBAC & Linhas UaZapi' : 'Novo Grupo de Acesso RBAC'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setGrpModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {grpErr && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-700 dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300">{grpErr}</div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Nome do Grupo *</label>
                <input
                  type="text"
                  required
                  value={grpName}
                  onChange={(e) => setGrpName(e.target.value)}
                  placeholder="Ex: Consultores Comerciais Senior"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Permissão Campo Honorários</label>
                <select
                  value={grpFeeFieldPerm}
                  onChange={(e) => setGrpFeeFieldPerm(e.target.value as 'edit' | 'read' | 'hidden')}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                >
                  <option value="edit">Editar e Visualizar</option>
                  <option value="read">Somente Leitura</option>
                  <option value="hidden">Ocultar Valor</option>
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Descrição</label>
                <input
                  type="text"
                  value={grpDesc}
                  onChange={(e) => setGrpDesc(e.target.value)}
                  placeholder="Atribuições operacionais deste grupo..."
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="block font-semibold text-slate-800 dark:text-slate-100">Módulos Liberados no Menu</label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/70">
                {RBAC_MODULE_LIST.map((mod) => (
                  <label key={mod.key} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(grpPerms[mod.key])}
                      onChange={() => setGrpPerms((p) => ({ ...p, [mod.key]: !p[mod.key] }))}
                    />
                    <span className="font-medium text-slate-800 dark:text-slate-100">{mod.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="block font-semibold text-slate-800 dark:text-slate-100">
                Números / Instâncias WhatsApp UaZapi Associadas a este Grupo
              </label>
              {uazapiInstances.length === 0 ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-slate-500 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-400">
                  Nenhuma instância UaZapi cadastrada ainda. Cadastre em &ldquo;WhatsApp UaZapi &amp; Grupos&rdquo;.
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/70">
                  {uazapiInstances.map((inst) => (
                    <label key={inst.id} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={grpUazapiIds.includes(inst.id)}
                        onChange={() =>
                          setGrpUazapiIds((prev) =>
                            prev.includes(inst.id)
                              ? prev.filter((id) => id !== inst.id)
                              : [...prev, inst.id]
                          )
                        }
                      />
                      <span className="text-slate-800 dark:text-slate-100">
                        <strong>{inst.label}</strong>{' '}
                        <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                          ({inst.connectedPhone || inst.defaultPhone || inst.uazapiInstanceId})
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setGrpModalOpen(false)}
                className="rounded-lg border border-slate-200 px-4 py-2 font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={grpSaving}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-emerald-600 dark:hover:bg-emerald-500"
              >
                <Check className="w-3.5 h-3.5" />
                {grpSaving ? 'Salvando...' : 'Salvar Grupo'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal Criar / Editar Usuário */}
      {usrModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 dark:bg-slate-950/80">
          <form
            onSubmit={handleSaveUser}
            className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl space-y-4 text-xs max-h-[90vh] overflow-y-auto dark:border-slate-700 dark:bg-slate-900"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-slate-800 dark:text-slate-100" />
                <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                  {editUsrId ? 'Editar Credenciais & Escopo do Usuário' : 'Cadastrar Novo Usuário Corporativo'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setUsrModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {usrErr && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-700 dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300">{usrErr}</div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Nome Completo *</label>
                <input
                  type="text"
                  required
                  value={usrName}
                  onChange={(e) => setUsrName(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">E-mail Corporativo *</label>
                <input
                  type="email"
                  required
                  value={usrEmail}
                  onChange={(e) => setUsrEmail(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Perfil Funcional</label>
                <select
                  value={usrRole}
                  onChange={(e) => setUsrRole(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                >
                  <option value="admin">Administrador Geral</option>
                  <option value="consultant">Consultor / Admissão</option>
                  <option value="auditor">Auditor de Contratos</option>
                  <option value="lawyer">Advogado / Jurídico</option>
                  <option value="financial">Analista Financeiro</option>
                  <option value="collector">Operador de Cobrança</option>
                </select>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Grupo RBAC</label>
                <select
                  value={usrGroupId}
                  onChange={(e) => setUsrGroupId(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                >
                  <option value="">Sem grupo específico</option>
                  {groups.map((g) => (
                    <option key={g.id} value={String(g.id)}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Unidade Padrão</label>
                <select
                  value={usrDefaultUnitId}
                  onChange={(e) => {
                    const id = Number(e.target.value);
                    setUsrDefaultUnitId(id);
                    if (!usrAllowedUnits.includes(id)) setUsrAllowedUnits((p) => [...p, id]);
                  }}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700"
                >
                  {units.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.code} · {u.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">WhatsApp do Usuário</label>
                <input
                  type="text"
                  value={usrPhone}
                  onChange={(e) => setUsrPhone(formatPhoneMask(e.target.value))}
                  placeholder="(81) 99988-7766"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono tabular-nums dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">
                  {editUsrId ? 'Nova Senha (Opcional — mínimo 6 caracteres)' : 'Senha Inicial (Padrão: Mudar@2026)'}
                </label>
                <input
                  type="password"
                  value={usrPassword}
                  onChange={(e) => setUsrPassword(e.target.value)}
                  placeholder={editUsrId ? 'Deixe vazio para não alterar' : 'Mudar@2026'}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono dark:border-slate-700"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="block font-semibold text-slate-800 dark:text-slate-100">Unidades Autorizadas</label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/70">
                {units.map((u) => (
                  <label key={u.id} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={usrAllowedUnits.includes(u.id)}
                      onChange={() =>
                        setUsrAllowedUnits((prev) =>
                          prev.includes(u.id) ? prev.filter((id) => id !== u.id) : [...prev, u.id]
                        )
                      }
                    />
                    <span>
                      {u.code} · {u.name}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 cursor-pointer font-medium text-slate-800 dark:text-slate-100">
                <input
                  type="checkbox"
                  checked={usrMustChangePwd}
                  onChange={(e) => setUsrMustChangePwd(e.target.checked)}
                />
                <span>Exigir troca de senha no próximo login</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer font-medium text-slate-800 dark:text-slate-100">
                <input
                  type="checkbox"
                  checked={usrActive}
                  onChange={(e) => setUsrActive(e.target.checked)}
                />
                <span>Conta ativa</span>
              </label>
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setUsrModalOpen(false)}
                className="rounded-lg border border-slate-200 px-4 py-2 font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={usrSaving}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-emerald-600 dark:hover:bg-emerald-500"
              >
                <Check className="w-3.5 h-3.5" />
                {usrSaving ? 'Salvando...' : 'Salvar Usuário'}
              </button>
            </div>
          </form>
        </div>
      )}

      <ConfirmDeleteModal
        open={Boolean(deleteGrpTarget)}
        title={`Excluir Grupo · ${deleteGrpTarget?.name || ''}`}
        description="Grupos que possuam usuários ativos vinculados não podem ser removidos até o remanejamento."
        busy={deleteGrpBusy}
        error={deleteGrpErr}
        onCancel={() => setDeleteGrpTarget(null)}
        onConfirm={async () => {
          if (!deleteGrpTarget) return;
          setDeleteGrpBusy(true);
          setDeleteGrpErr('');
          try {
            await apiFetch(`/api/config/groups/${deleteGrpTarget.id}`, { method: 'DELETE' });
            onToast(`Grupo "${deleteGrpTarget.name}" excluído.`);
            setDeleteGrpTarget(null);
            await onRefresh();
          } catch (err) {
            setDeleteGrpErr(err instanceof Error ? err.message : 'Erro ao excluir grupo.');
          } finally {
            setDeleteGrpBusy(false);
          }
        }}
      />

      <EntityAuditModal
        open={Boolean(auditEntity)}
        title={auditEntity?.title || ''}
        entityType={auditEntity?.type || 'user_group'}
        entityId={auditEntity?.id || 0}
        onClose={() => setAuditEntity(null)}
      />
    </div>
  );
};

// =============================================================================
// 2. CHECKLIST DE AUDITORIA & AUDITORIAS HISTÓRICAS SEM UNIDADE (Seção 5 Manual)
// =============================================================================
interface UnboundAuditRow {
  reasonKey: string;
  reasonLabel: string;
  entityRef: string;
  candidateUnits: string;
  firstSeenAt: string;
  lastSeenAt: string;
  occurrences: number;
}

export const ConfigAuditAndChecklistView: React.FC<{
  currentUser: AuthUser;
  checklistItems: AuditChecklistItem[];
  modalities: ModalityItem[];
  auditLogs: Array<{ id: number; userName: string; action: string; entityType: string; entityId: string; createdAt: string }>;
  onRefresh: () => Promise<void>;
  onToast: (msg: string) => void;
}> = ({
  currentUser,
  checklistItems,
  modalities,
  auditLogs,
  onRefresh,
  onToast,
}) => {
  const isAdmin = currentUser.role === 'admin';
  const [subTab, setSubTab] = useState<'checklist' | 'unbound' | 'logs'>('checklist');
  const [showInactive, setShowInactive] = useState(false);

  // Checklist Create / Edit Modal
  const [itemModalOpen, setItemModalOpen] = useState(false);
  const [editItem, setEditItem] = useState<AuditChecklistItem | null>(null);
  const [itemOrder, setItemOrder] = useState(1);
  const [itemTitle, setItemTitle] = useState('');
  const [itemDesc, setItemDesc] = useState('');
  const [itemCondition, setItemCondition] = useState('');
  const [itemActive, setItemActive] = useState(true);
  const [itemSaving, setItemSaving] = useState(false);
  const [itemErr, setItemErr] = useState('');

  // Inactivate confirmation
  const [inactivateTarget, setInactivateTarget] = useState<AuditChecklistItem | null>(null);

  // Migrate / Duplicate Modal
  const [migrateSource, setMigrateSource] = useState<AuditChecklistItem | null>(null);
  const [migrateOp, setMigrateOp] = useState<'swap' | 'overwrite' | 'duplicate'>('duplicate');
  const [migrateTargetId, setMigrateTargetId] = useState<string>('');
  const [migrateBusy, setMigrateBusy] = useState(false);

  // Audit History
  const [auditTarget, setAuditTarget] = useState<AuditChecklistItem | null>(null);

  // Unbound Audit Report (25/page)
  const [unboundReason, setUnboundReason] = useState('all');
  const [unboundPage, setUnboundPage] = useState(1);
  const [unboundTotal, setUnboundTotal] = useState(0);
  const [unboundPages, setUnboundPages] = useState(1);
  const [unboundRows, setUnboundRows] = useState<UnboundAuditRow[]>([]);
  const [unboundCounts, setUnboundCounts] = useState<Record<string, number>>({});
  const [unboundLoading, setUnboundLoading] = useState(false);

  const visibleChecklist = useMemo(
    () => checklistItems.filter((i) => showInactive || i.active),
    [checklistItems, showInactive]
  );

  const conditionOptions = useMemo(() => {
    const set = new Set<string>(['Veicular']);
    modalities.forEach((m) => {
      if (m.description) set.add(m.description);
    });
    return Array.from(set);
  }, [modalities]);

  const loadUnbound = useCallback(async () => {
    if (!isAdmin) return;
    setUnboundLoading(true);
    try {
      const res = await apiFetch<{
        total: number;
        totalPages: number;
        rows: UnboundAuditRow[];
        reasonCounts: Record<string, number>;
      }>(`/api/config/audit-unbound?page=${unboundPage}&reason=${encodeURIComponent(unboundReason)}`);
      setUnboundTotal(res.total || 0);
      setUnboundPages(res.totalPages || 1);
      setUnboundRows(res.rows || []);
      setUnboundCounts(res.reasonCounts || {});
    } finally {
      setUnboundLoading(false);
    }
  }, [isAdmin, unboundPage, unboundReason]);

  useEffect(() => {
    if (subTab === 'unbound') {
      loadUnbound();
    }
  }, [subTab, loadUnbound]);

  const openNewItem = () => {
    setEditItem(null);
    const maxO = checklistItems.reduce((m, i) => Math.max(m, i.sortOrder || 0), 0);
    setItemOrder(maxO + 1);
    setItemTitle('');
    setItemDesc('');
    setItemCondition('');
    setItemActive(true);
    setItemErr('');
    setItemModalOpen(true);
  };

  const openEditItem = (it: AuditChecklistItem) => {
    setEditItem(it);
    setItemOrder(it.sortOrder);
    setItemTitle(it.title);
    setItemDesc(it.description || '');
    setItemCondition(it.modalityCondition || '');
    setItemActive(it.active);
    setItemErr('');
    setItemModalOpen(true);
  };

  const handleSaveItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!itemTitle.trim()) {
      setItemErr('O título do item é obrigatório.');
      return;
    }
    setItemSaving(true);
    setItemErr('');
    try {
      const body = {
        sortOrder: itemOrder,
        title: itemTitle.trim(),
        description: itemDesc.trim(),
        modalityCondition: itemCondition,
        active: itemActive,
      };
      if (editItem) {
        await apiFetch(`/api/config/audit-checklist/${editItem.id}`, {
          method: 'PUT',
          body: JSON.stringify(body),
        });
        onToast('Item do checklist atualizado.');
      } else {
        await apiFetch('/api/config/audit-checklist', {
          method: 'POST',
          body: JSON.stringify(body),
        });
        onToast('Novo item adicionado ao checklist de auditoria.');
      }
      setItemModalOpen(false);
      await onRefresh();
    } catch (err) {
      setItemErr(err instanceof Error ? err.message : 'Erro ao salvar item.');
    } finally {
      setItemSaving(false);
    }
  };

  const handleMigrate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!migrateSource) return;
    setMigrateBusy(true);
    try {
      await apiFetch('/api/config/audit-checklist/migrate', {
        method: 'POST',
        body: JSON.stringify({
          operation: migrateOp,
          sourceId: migrateSource.id,
          targetId: migrateOp !== 'duplicate' ? Number(migrateTargetId) : undefined,
        }),
      });
      setMigrateSource(null);
      onToast('Operação de migração/duplicação executada.');
      await onRefresh();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Erro na operação.');
    } finally {
      setMigrateBusy(false);
    }
  };

  return (
    <div className="space-y-4 text-xs">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <div className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1 w-fit dark:bg-slate-800">
          <button
            type="button"
            onClick={() => setSubTab('checklist')}
            className={`rounded-md px-3 py-1.5 font-semibold whitespace-nowrap ${
              subTab === 'checklist' ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-slate-100' : 'text-slate-600 dark:text-slate-300'
            }`}
          >
            Checklist de Auditoria ({checklistItems.length})
          </button>
          {isAdmin && (
            <button
              type="button"
              onClick={() => setSubTab('unbound')}
              className={`rounded-md px-3 py-1.5 font-semibold whitespace-nowrap ${
                subTab === 'unbound' ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-slate-100' : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              Auditorias Históricas sem Unidade
            </button>
          )}
          <button
            type="button"
            onClick={() => setSubTab('logs')}
            className={`rounded-md px-3 py-1.5 font-semibold whitespace-nowrap ${
              subTab === 'logs' ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-slate-100' : 'text-slate-600 dark:text-slate-300'
            }`}
          >
            Eventos Recentes ({auditLogs.length})
          </button>
        </div>

        {subTab === 'checklist' && (
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 cursor-pointer font-medium text-slate-700 dark:text-slate-200">
              <input
                type="checkbox"
                checked={showInactive}
                onChange={(e) => setShowInactive(e.target.checked)}
              />
              <span>Mostrar inativos</span>
            </label>
            {isAdmin && (
              <button
                type="button"
                onClick={openNewItem}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 font-semibold text-white hover:bg-slate-800 whitespace-nowrap shrink-0 dark:bg-emerald-600 dark:hover:bg-emerald-500"
              >
                <Plus className="w-3.5 h-3.5" />
                Novo Item
              </button>
            )}
          </div>
        )}
      </div>

      {subTab === 'checklist' && (
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden dark:border-slate-700 dark:bg-slate-900">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-300">
                <tr>
                  <th className="px-4 py-2.5 w-16 whitespace-nowrap">Ordem</th>
                  <th className="px-4 py-2.5">Título &amp; Critério de Conferência</th>
                  <th className="px-4 py-2.5 whitespace-nowrap">Condição por Modalidade</th>
                  <th className="px-4 py-2.5 whitespace-nowrap">Status</th>
                  <th className="px-4 py-2.5 whitespace-nowrap">Mover</th>
                  <th className="px-4 py-2.5 text-right whitespace-nowrap">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {visibleChecklist.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-slate-500 dark:text-slate-400">
                      Nenhum item ativo no checklist.
                    </td>
                  </tr>
                ) : (
                  visibleChecklist.map((it, idx) => (
                    <tr key={it.id} className="hover:bg-slate-50/80">
                      <td className="px-4 py-2.5 font-mono font-bold text-slate-900 tabular-nums dark:text-slate-100">
                        #{it.sortOrder}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="font-semibold text-slate-900 dark:text-slate-100">{it.title}</div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">{it.description}</div>
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-slate-700 dark:text-slate-200">
                        {it.modalityCondition || 'Sempre exibir (Todas)'}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <span className={it.active ? 'font-semibold text-emerald-700 dark:text-emerald-300' : 'text-slate-400 dark:text-slate-400'}>
                          {it.active ? 'Ativo' : 'Inativo'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        {isAdmin && (
                          <div className="inline-flex gap-1">
                            <button
                              type="button"
                              disabled={idx === 0}
                              onClick={async () => {
                                await apiFetch(`/api/config/audit-checklist/${it.id}/reorder`, {
                                  method: 'PATCH',
                                  body: JSON.stringify({ direction: 'up' }),
                                });
                                await onRefresh();
                              }}
                              className="rounded border border-slate-200 p-1 text-slate-600 hover:bg-slate-100 disabled:opacity-30 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                            >
                              <ArrowUp className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              disabled={idx === visibleChecklist.length - 1}
                              onClick={async () => {
                                await apiFetch(`/api/config/audit-checklist/${it.id}/reorder`, {
                                  method: 'PATCH',
                                  body: JSON.stringify({ direction: 'down' }),
                                });
                                await onRefresh();
                              }}
                              className="rounded border border-slate-200 p-1 text-slate-600 hover:bg-slate-100 disabled:opacity-30 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                            >
                              <ArrowDown className="w-3 h-3" />
                            </button>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setAuditTarget(it)}
                            title="Histórico de Auditoria"
                            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                          >
                            <History className="w-3.5 h-3.5" />
                          </button>
                          {isAdmin && (
                            <>
                              <button
                                type="button"
                                onClick={() => {
                                  const others = checklistItems.filter((x) => x.id !== it.id);
                                  setMigrateTargetId(others[0] ? String(others[0].id) : '');
                                  setMigrateOp('duplicate');
                                  setMigrateSource(it);
                                }}
                                title="Migrar / Trocar Posição / Duplicar"
                                className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                              >
                                <ArrowLeftRight className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => openEditItem(it)}
                                title="Editar Item"
                                className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>
                              {it.active ? (
                                <button
                                  type="button"
                                  onClick={() => setInactivateTarget(it)}
                                  className="rounded-md px-2 py-1 text-[11px] font-semibold text-amber-700 hover:bg-amber-50 dark:text-amber-300 dark:hover:bg-amber-950/60"
                                >
                                  Inativar
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={async () => {
                                    await apiFetch(`/api/config/audit-checklist/${it.id}`, {
                                      method: 'PUT',
                                      body: JSON.stringify({ ...it, active: true }),
                                    });
                                    await onRefresh();
                                    onToast('Item reativado.');
                                  }}
                                  className="rounded-md px-2 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-950/60"
                                >
                                  Reativar
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {subTab === 'unbound' && isAdmin && (
        <div className="space-y-3">
          <div className="rounded-xl border border-slate-200 bg-white p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 dark:border-slate-700 dark:bg-slate-900">
            <div>
              <div className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                Relatório de Exceções: Auditorias Históricas sem Unidade Vinculada
              </div>
              <p className="text-slate-500 dark:text-slate-400">
                Registros globais ou históricos onde <code className="font-mono">unit_id</code> permanece nulo, agrupados por diagnóstico.
              </p>
            </div>
            <select
              value={unboundReason}
              onChange={(e) => {
                setUnboundReason(e.target.value);
                setUnboundPage(1);
              }}
              className="rounded-lg border border-slate-200 px-3 py-1.5 font-medium dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            >
              <option value="all">Todos os motivos ({unboundCounts.all || 0})</option>
              <option value="unsupported_entity">
                Entidade global/não vinculada ({unboundCounts.unsupported_entity || 0})
              </option>
              <option value="ambiguous_units">
                Unidades ambíguas ({unboundCounts.ambiguous_units || 0})
              </option>
              <option value="entity_without_unit">
                Entidade sem unidade ({unboundCounts.entity_without_unit || 0})
              </option>
              <option value="entity_not_found">
                Entidade não encontrada ({unboundCounts.entity_not_found || 0})
              </option>
              <option value="invalid_id">
                Identificador não numérico ({unboundCounts.invalid_id || 0})
              </option>
              <option value="missing_id">
                Identificador ausente ({unboundCounts.missing_id || 0})
              </option>
            </select>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden dark:border-slate-700 dark:bg-slate-900">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-300">
                  <tr>
                    <th className="px-4 py-2.5">Diagnóstico</th>
                    <th className="px-4 py-2.5 whitespace-nowrap">Referência</th>
                    <th className="px-4 py-2.5 whitespace-nowrap">Unidades Candidatas</th>
                    <th className="px-4 py-2.5 whitespace-nowrap">Primeira Ocorrência</th>
                    <th className="px-4 py-2.5 whitespace-nowrap">Última Ocorrência</th>
                    <th className="px-4 py-2.5 text-right whitespace-nowrap">Ocorrências</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {unboundLoading ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-slate-500 dark:text-slate-400">
                        Analisando registros históricos...
                      </td>
                    </tr>
                  ) : unboundRows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-slate-500 dark:text-slate-400">
                        Nenhuma exceção encontrada para este filtro.
                      </td>
                    </tr>
                  ) : (
                    unboundRows.map((r, i) => (
                      <tr key={`${r.entityRef}-${i}`} className="hover:bg-slate-50/80">
                        <td className="px-4 py-2.5 font-medium text-slate-900 dark:text-slate-100">{r.reasonLabel}</td>
                        <td className="px-4 py-2.5 font-mono text-slate-700 dark:text-slate-200">{r.entityRef}</td>
                        <td className="px-4 py-2.5 text-slate-600 dark:text-slate-300">{r.candidateUnits}</td>
                        <td className="px-4 py-2.5 font-mono text-[11px] text-slate-500 tabular-nums dark:text-slate-400">
                          {formatDateTimeBR(r.firstSeenAt)}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-[11px] text-slate-500 tabular-nums dark:text-slate-400">
                          {formatDateTimeBR(r.lastSeenAt)}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono font-bold text-slate-900 tabular-nums dark:text-slate-100">
                          {r.occurrences}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between border-t border-slate-100 px-4 py-2.5 text-slate-600 dark:border-slate-800 dark:text-slate-300">
              <span className="font-mono tabular-nums">
                Total: {unboundTotal} · Página {unboundPage} de {unboundPages} (25/pág)
              </span>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  disabled={unboundPage <= 1}
                  onClick={() => setUnboundPage((p) => Math.max(1, p - 1))}
                  className="rounded border border-slate-200 px-2.5 py-1 font-semibold disabled:opacity-40 dark:border-slate-700"
                >
                  Anterior
                </button>
                <button
                  type="button"
                  disabled={unboundPage >= unboundPages}
                  onClick={() => setUnboundPage((p) => Math.min(unboundPages, p + 1))}
                  className="rounded border border-slate-200 px-2.5 py-1 font-semibold disabled:opacity-40 dark:border-slate-700"
                >
                  Próxima
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {subTab === 'logs' && (
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden dark:border-slate-700 dark:bg-slate-900">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-300">
                <tr>
                  <th className="px-4 py-2.5">Evento</th>
                  <th className="px-4 py-2.5">Operador</th>
                  <th className="px-4 py-2.5">Entidade</th>
                  <th className="px-4 py-2.5 text-right">Data / Hora</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {auditLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50/80">
                    <td className="px-4 py-2.5 font-mono font-semibold text-slate-900 dark:text-slate-100">{log.action}</td>
                    <td className="px-4 py-2.5 text-slate-700 dark:text-slate-200">{log.userName}</td>
                    <td className="px-4 py-2.5 font-mono text-slate-500 dark:text-slate-400">
                      {log.entityType} #{log.entityId}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-[11px] text-slate-500 tabular-nums dark:text-slate-400">
                      {formatDateTimeBR(log.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal Criar / Editar Item Checklist */}
      {itemModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 dark:bg-slate-950/80">
          <form
            onSubmit={handleSaveItem}
            className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl space-y-4 text-xs dark:border-slate-700 dark:bg-slate-900"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
              <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                {editItem ? 'Editar Item de Checklist' : 'Novo Item de Checklist de Auditoria'}
              </h3>
              <button
                type="button"
                onClick={() => setItemModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {itemErr && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-700 dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300">{itemErr}</div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div>
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Nº Ordem</label>
                <input
                  type="number"
                  min={1}
                  value={itemOrder}
                  onChange={(e) => setItemOrder(Number(e.target.value))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono tabular-nums dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
              <div className="sm:col-span-3">
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Condição de Exibição (Modalidade)</label>
                <select
                  value={itemCondition}
                  onChange={(e) => setItemCondition(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                >
                  <option value="">Sempre exibir (Todas as modalidades)</option>
                  {conditionOptions.map((c) => (
                    <option key={c} value={c}>
                      Somente quando modalidade contiver: {c}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-4">
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Título do Item *</label>
                <input
                  type="text"
                  required
                  value={itemTitle}
                  onChange={(e) => setItemTitle(e.target.value)}
                  placeholder="Ex: Conferência de CRLV, Placa e Renavam"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700"
                />
              </div>
              <div className="sm:col-span-4">
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Descrição / Orientação ao Auditor</label>
                <textarea
                  rows={3}
                  value={itemDesc}
                  onChange={(e) => setItemDesc(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 p-2.5 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
            </div>

            <label className="flex items-center gap-2 cursor-pointer font-medium text-slate-800 dark:text-slate-100">
              <input
                type="checkbox"
                checked={itemActive}
                onChange={(e) => setItemActive(e.target.checked)}
              />
              <span>Item ativo na tela de Auditoria &amp; Boletos</span>
            </label>

            <div className="flex justify-end gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setItemModalOpen(false)}
                className="rounded-lg border border-slate-200 px-4 py-2 font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={itemSaving}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white hover:bg-slate-800 dark:bg-emerald-600 dark:hover:bg-emerald-500"
              >
                <Check className="w-3.5 h-3.5" />
                {itemSaving ? 'Salvando...' : 'Salvar Item'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal Migrar / Trocar Posição / Duplicar */}
      {migrateSource && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 dark:bg-slate-950/80">
          <form
            onSubmit={handleMigrate}
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl space-y-4 text-xs dark:border-slate-700 dark:bg-slate-900"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
              <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                Migrar / Duplicar · #{migrateSource.sortOrder} {migrateSource.title}
              </h3>
              <button
                type="button"
                onClick={() => setMigrateSource(null)}
                className="text-slate-400 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Operação</label>
              <select
                value={migrateOp}
                onChange={(e) => setMigrateOp(e.target.value as 'swap' | 'overwrite' | 'duplicate')}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              >
                <option value="duplicate">Duplicar Item (cria cópia ao final)</option>
                <option value="swap">Trocar Posição com outro item</option>
                <option value="overwrite">Sobrescrever Dados em outro item</option>
              </select>
            </div>

            {migrateOp !== 'duplicate' && (
              <div>
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Item de Destino</label>
                <select
                  value={migrateTargetId}
                  onChange={(e) => setMigrateTargetId(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                >
                  {checklistItems
                    .filter((x) => x.id !== migrateSource.id)
                    .map((x) => (
                      <option key={x.id} value={String(x.id)}>
                        #{x.sortOrder} · {x.title}
                      </option>
                    ))}
                </select>
              </div>
            )}

            <div className="flex justify-end gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setMigrateSource(null)}
                className="rounded-lg border border-slate-200 px-3.5 py-2 font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={migrateBusy}
                className="rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white hover:bg-slate-800 dark:bg-emerald-600 dark:hover:bg-emerald-500"
              >
                {migrateBusy ? 'Aplicando...' : 'Executar'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Confirmação de Inativação */}
      {inactivateTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 dark:bg-slate-950/80">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl space-y-4 text-xs dark:border-slate-700 dark:bg-slate-900">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5 dark:text-amber-400" />
              <div className="space-y-1">
                <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                  Inativar Item de Checklist?
                </h3>
                <p className="text-slate-600 dark:text-slate-300">
                  O item <strong>&ldquo;{inactivateTarget.title}&rdquo;</strong> deixará de aparecer nas novas conferências de Auditoria até ser reativado.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setInactivateTarget(null)}
                className="rounded-lg border border-slate-200 px-3.5 py-2 font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={async () => {
                  await apiFetch(`/api/config/audit-checklist/${inactivateTarget.id}`, {
                    method: 'PUT',
                    body: JSON.stringify({ ...inactivateTarget, active: false }),
                  });
                  setInactivateTarget(null);
                  await onRefresh();
                  onToast('Item inativado.');
                }}
                className="rounded-lg bg-amber-600 px-4 py-2 font-semibold text-white hover:bg-amber-700"
              >
                Confirmar Inativação
              </button>
            </div>
          </div>
        </div>
      )}

      <EntityAuditModal
        open={Boolean(auditTarget)}
        title={auditTarget?.title || ''}
        entityType="audit_checklist"
        entityId={auditTarget?.id || 0}
        onClose={() => setAuditTarget(null)}
      />
    </div>
  );
};

// =============================================================================
// 3. CENTRAL DE AJUDA CRUD + PREVIEW HTML SANITIZADO (Seção 6 do Manual)
// =============================================================================
export const ConfigHelpCenterView: React.FC<{
  currentUser: AuthUser;
  topics: HelpCenterTopic[];
  onRefresh: () => Promise<void>;
  onToast: (msg: string) => void;
}> = ({ currentUser, topics, onRefresh, onToast }) => {
  const isAdmin = currentUser.role === 'admin';
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editTopic, setEditTopic] = useState<HelpCenterTopic | null>(null);
  const [topicKey, setTopicKey] = useState('');
  const [menuPath, setMenuPath] = useState('');
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [keywordsText, setKeywordsText] = useState('');
  const [htmlContent, setHtmlContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const [previewTopic, setPreviewTopic] = useState<HelpCenterTopic | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<HelpCenterTopic | null>(null);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [auditTarget, setAuditTarget] = useState<HelpCenterTopic | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return topics;
    return topics.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.menuPath.toLowerCase().includes(q) ||
        t.summary.toLowerCase().includes(q) ||
        t.topicKey.toLowerCase().includes(q) ||
        (t.keywords || []).some((k) => k.toLowerCase().includes(q))
    );
  }, [topics, search]);

  const openNew = () => {
    setEditTopic(null);
    setTopicKey('');
    setMenuPath('Configurações > ');
    setTitle('');
    setSummary('');
    setKeywordsText('');
    setHtmlContent('<h3>Objetivo</h3><p>Descreva o procedimento passo a passo...</p>');
    setErr('');
    setModalOpen(true);
  };

  const openEdit = (t: HelpCenterTopic) => {
    setEditTopic(t);
    setTopicKey(t.topicKey);
    setMenuPath(t.menuPath);
    setTitle(t.title);
    setSummary(t.summary || '');
    setKeywordsText((t.keywords || []).join(', '));
    setHtmlContent(t.htmlContent || '');
    setErr('');
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!menuPath.trim() || !title.trim()) {
      setErr('Caminho do Menu e Título são obrigatórios.');
      return;
    }
    setSaving(true);
    setErr('');
    try {
      const payload = {
        topicKey: topicKey.trim(),
        menuPath: menuPath.trim(),
        title: title.trim(),
        summary: summary.trim(),
        keywords: keywordsText,
        htmlContent,
      };
      if (editTopic) {
        await apiFetch(`/api/config/help-center/${editTopic.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        onToast('Tópico da Central de Ajuda atualizado.');
      } else {
        await apiFetch('/api/config/help-center', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        onToast('Novo tópico publicado na Central de Ajuda.');
      }
      setModalOpen(false);
      await onRefresh();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Erro ao salvar tópico.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 text-xs">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <div className="flex flex-1 items-center gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5 dark:text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar tópico por título, caminho de menu ou palavra-chave..."
              className="w-full rounded-lg border border-slate-200 pl-8 pr-3 py-1.5 dark:border-slate-700"
            />
          </div>
          <span className="font-mono text-slate-500 tabular-nums whitespace-nowrap dark:text-slate-400">
            {filtered.length} de {topics.length} tópico(s)
          </span>
        </div>

        {isAdmin && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setRestoreOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Restaurar Padrão
            </button>
            <button
              type="button"
              onClick={openNew}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 font-semibold text-white hover:bg-slate-800 whitespace-nowrap dark:bg-emerald-600 dark:hover:bg-emerald-500"
            >
              <Plus className="w-3.5 h-3.5" />
              Novo Tópico
            </button>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden dark:border-slate-700 dark:bg-slate-900">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-300">
              <tr>
                <th className="px-4 py-2.5 whitespace-nowrap">Caminho do Menu</th>
                <th className="px-4 py-2.5 whitespace-nowrap">ID Tópico</th>
                <th className="px-4 py-2.5">Título &amp; Resumo</th>
                <th className="px-4 py-2.5">Palavras-chave</th>
                <th className="px-4 py-2.5 text-right whitespace-nowrap">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-500 dark:text-slate-400">
                    Nenhum tópico encontrado.
                  </td>
                </tr>
              ) : (
                filtered.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-50/80">
                    <td className="px-4 py-2.5 font-medium text-slate-700 whitespace-nowrap dark:text-slate-200">{t.menuPath}</td>
                    <td className="px-4 py-2.5 font-mono text-[11px] text-slate-500 whitespace-nowrap dark:text-slate-400">
                      {t.topicKey}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="font-semibold text-slate-900 dark:text-slate-100">{t.title}</div>
                      <div className="text-[11px] text-slate-500 line-clamp-1 dark:text-slate-400">{t.summary}</div>
                    </td>
                    <td className="px-4 py-2.5 text-[11px] text-slate-500 max-w-xs truncate dark:text-slate-400">
                      {(t.keywords || []).join(' · ') || '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setPreviewTopic(t)}
                          title="Ler Artigo"
                          className="rounded-md p-1.5 text-blue-700 hover:bg-blue-50 dark:text-blue-300 dark:hover:bg-blue-950/60"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setAuditTarget(t)}
                          title="Histórico"
                          className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                        >
                          <History className="w-3.5 h-3.5" />
                        </button>
                        {isAdmin && (
                          <>
                            <button
                              type="button"
                              onClick={() => openEdit(t)}
                              className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleteTarget(t)}
                              className="rounded-md p-1.5 text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/60"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal Criar / Editar Tópico com Preview HTML ao Vivo */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 dark:bg-slate-950/80">
          <form
            onSubmit={handleSave}
            className="w-full max-w-4xl rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl space-y-4 text-xs max-h-[90vh] overflow-y-auto dark:border-slate-700 dark:bg-slate-900"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-slate-800 dark:text-slate-100" />
                <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                  {editTopic ? 'Editar Tópico da Central de Ajuda' : 'Novo Tópico da Central de Ajuda'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {err && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-700 dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300">{err}</div>}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">
                  ID do Tópico {editTopic ? '(Somente leitura)' : '(Editável na criação)'}
                </label>
                <input
                  type="text"
                  readOnly={Boolean(editTopic)}
                  value={topicKey}
                  onChange={(e) => setTopicKey(e.target.value)}
                  placeholder="ex: cfg_unidades_custos"
                  className={`w-full rounded-lg border border-slate-200 px-3 py-2 font-mono dark:border-slate-700 ${
                    editTopic ? 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400' : ''
                  }`}
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Caminho do Menu *</label>
                <input
                  type="text"
                  required
                  value={menuPath}
                  onChange={(e) => setMenuPath(e.target.value)}
                  placeholder="Ex: Configurações > Unidades & Custos"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Título *</label>
                <input
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Palavras-chave (vírgula)</label>
                <input
                  type="text"
                  value={keywordsText}
                  onChange={(e) => setKeywordsText(e.target.value)}
                  placeholder="unidade, cnpj, cep, piso"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
              <div className="sm:col-span-3">
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Resumo Curto</label>
                <input
                  type="text"
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div>
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Conteúdo HTML</label>
                <textarea
                  rows={8}
                  value={htmlContent}
                  onChange={(e) => setHtmlContent(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 p-3 font-mono text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">
                  Pré-visualização Renderizada (Sanitizada)
                </label>
                <div
                  className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 min-h-[188px] space-y-2 text-slate-800 leading-relaxed dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-100"
                  dangerouslySetInnerHTML={{ __html: sanitizeHelpHtml(htmlContent) }}
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded-lg border border-slate-200 px-4 py-2 font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white hover:bg-slate-800 dark:bg-emerald-600 dark:hover:bg-emerald-500"
              >
                <Check className="w-3.5 h-3.5" />
                {saving ? 'Salvando...' : 'Salvar Tópico'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal Leitura do Tópico */}
      {previewTopic && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 dark:bg-slate-950/80">
          <div className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl space-y-4 text-xs dark:border-slate-700 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
              <div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">{previewTopic.menuPath}</div>
                <h3 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">{previewTopic.title}</h3>
              </div>
              <button
                type="button"
                onClick={() => setPreviewTopic(null)}
                className="text-slate-400 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div
              className="space-y-2 text-slate-800 leading-relaxed dark:text-slate-100"
              dangerouslySetInnerHTML={{ __html: sanitizeHelpHtml(previewTopic.htmlContent) }}
            />
          </div>
        </div>
      )}

      <ConfirmDeleteModal
        open={Boolean(deleteTarget)}
        title={`Excluir Tópico · ${deleteTarget?.title || ''}`}
        description="O artigo será removido da Central de Ajuda."
        onCancel={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return;
          await apiFetch(`/api/config/help-center/${deleteTarget.id}`, { method: 'DELETE' });
          setDeleteTarget(null);
          await onRefresh();
          onToast('Tópico excluído.');
        }}
      />

      <ConfirmDeleteModal
        open={restoreOpen}
        title="Restaurar Tópicos Padrão da Central de Ajuda?"
        description="Esta ação substitui a coleção atual pelos tópicos oficiais padrão do sistema."
        onCancel={() => setRestoreOpen(false)}
        onConfirm={async () => {
          await apiFetch('/api/config/help-center/restore-defaults', { method: 'POST' });
          setRestoreOpen(false);
          await onRefresh();
          onToast('Central de Ajuda restaurada para o padrão corporativo.');
        }}
      />

      <EntityAuditModal
        open={Boolean(auditTarget)}
        title={auditTarget?.title || ''}
        entityType="help_topic"
        entityId={auditTarget?.id || 0}
        onClose={() => setAuditTarget(null)}
      />
    </div>
  );
};

// =============================================================================
// 4. PORTAL & IDENTIDADE VISUAL (Seção 2 do Manual)
// =============================================================================
const DEFAULT_BRANDING_CLIENT: PortalBrandingConfig = {
  companyName: 'FinancePro Assessoria',
  primaryColor: '#0F172A',
  textColor: '#FFFFFF',
  logoDataUrl: '',
  marketingHeadline: 'Governança Bancária, Revisional & Recuperação de Ativos',
  marketingDescription:
    'Plataforma corporativa integrada para negociação de passivos veiculares e bancários, auditoria documental, acompanhamento processual e régua inteligente.',
  loginLeftBg: '#0F172A',
  loginLeftText: '#F8FAFC',
  loginBackgroundImageUrl: '',
  loginRightBg: '#FFFFFF',
  loginRightText: '#0F172A',
  sidebarBg: '#FFFFFF',
  sidebarText: '#334155',
  headerBg: '#FFFFFF',
  headerText: '#0F172A',
  canvasBg: '#F8FAFC',
  canvasBackgroundImageUrl: '',
};

const ColorPickerField: React.FC<{
  label: string;
  value: string;
  onChange: (hex: string) => void;
}> = ({ label, value, onChange }) => (
  <div>
    <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">{label}</label>
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={/^#[0-9A-Fa-f]{6}$/.test(value) ? value : '#0F172A'}
        onChange={(e) => onChange(e.target.value.toUpperCase())}
        className="h-9 w-11 rounded border border-slate-200 bg-white p-0.5 cursor-pointer dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
      />
      <svg className="w-5 h-5 rounded border border-slate-200 shrink-0 dark:border-slate-700" viewBox="0 0 20 20">
        <rect width="20" height="20" fill={value || '#0F172A'} />
      </svg>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 rounded-lg border border-slate-200 px-2.5 py-2 font-mono uppercase dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
      />
    </div>
  </div>
);

export const ConfigPortalBrandingView: React.FC<{
  currentUser: AuthUser;
  initialBranding: PortalBrandingConfig;
  onBrandingSaved: (next: PortalBrandingConfig) => void;
  onToast: (msg: string) => void;
}> = ({ currentUser, initialBranding, onBrandingSaved, onToast }) => {
  const isAdmin = currentUser.role === 'admin';
  const [subTab, setSubTab] = useState<'login' | 'dashboard'>('login');
  const [draft, setDraft] = useState<PortalBrandingConfig>(initialBranding);
  const [saving, setSaving] = useState(false);
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);

  useEffect(() => {
    setDraft(initialBranding);
  }, [initialBranding]);

  const isDirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(initialBranding),
    [draft, initialBranding]
  );

  const persistBranding = async (payload: PortalBrandingConfig, message: string) => {
    setSaving(true);
    try {
      const res = await apiFetch<{ branding: PortalBrandingConfig }>('/api/config/portal-branding', {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      setDraft(res.branding);
      onBrandingSaved(res.branding);
      onToast(message);
    } finally {
      setSaving(false);
    }
  };

  const handleImmediateLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      const next = { ...draft, logoDataUrl: dataUrl };
      setDraft(next);
      if (isAdmin) {
        persistBranding(next, 'Logotipo enviado e salvo imediatamente.');
      }
    };
    reader.readAsDataURL(file);
  };

  const restoreSectionDefaults = () => {
    if (subTab === 'login') {
      setDraft((prev) => ({
        ...prev,
        companyName: DEFAULT_BRANDING_CLIENT.companyName,
        primaryColor: DEFAULT_BRANDING_CLIENT.primaryColor,
        textColor: DEFAULT_BRANDING_CLIENT.textColor,
        marketingHeadline: DEFAULT_BRANDING_CLIENT.marketingHeadline,
        marketingDescription: DEFAULT_BRANDING_CLIENT.marketingDescription,
        loginLeftBg: DEFAULT_BRANDING_CLIENT.loginLeftBg,
        loginLeftText: DEFAULT_BRANDING_CLIENT.loginLeftText,
        loginRightBg: DEFAULT_BRANDING_CLIENT.loginRightBg,
        loginRightText: DEFAULT_BRANDING_CLIENT.loginRightText,
        loginBackgroundImageUrl: '',
      }));
    } else {
      setDraft((prev) => ({
        ...prev,
        sidebarBg: DEFAULT_BRANDING_CLIENT.sidebarBg,
        sidebarText: DEFAULT_BRANDING_CLIENT.sidebarText,
        headerBg: DEFAULT_BRANDING_CLIENT.headerBg,
        headerText: DEFAULT_BRANDING_CLIENT.headerText,
        canvasBg: DEFAULT_BRANDING_CLIENT.canvasBg,
        canvasBackgroundImageUrl: '',
      }));
    }
    onToast('Valores padrão carregados no rascunho. Clique em Salvar para confirmar.');
  };

  return (
    <div className="space-y-4 text-xs">
      <div className="rounded-xl border border-slate-200 bg-white p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-center gap-2">
          <Palette className="w-4 h-4 text-slate-800 dark:text-slate-100" />
          <div>
            <div className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
              Portal &amp; Identidade Visual Corporativa
            </div>
            <div className="text-slate-500 dark:text-slate-400">
              Personalize marca, logotipo, tela de autenticação e superfícies internas.
            </div>
          </div>
        </div>

        <div className="flex gap-1 rounded-lg bg-slate-100 p-1 self-start dark:bg-slate-800">
          <button
            type="button"
            onClick={() => setSubTab('login')}
            className={`rounded-md px-3 py-1.5 font-semibold whitespace-nowrap ${
              subTab === 'login' ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-slate-100' : 'text-slate-600 dark:text-slate-300'
            }`}
          >
            Login &amp; Identidade
          </button>
          <button
            type="button"
            onClick={() => setSubTab('dashboard')}
            className={`rounded-md px-3 py-1.5 font-semibold whitespace-nowrap ${
              subTab === 'dashboard' ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-slate-100' : 'text-slate-600 dark:text-slate-300'
            }`}
          >
            Layout Interno (Dashboard)
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-5 dark:border-slate-700 dark:bg-slate-900">
        {subTab === 'login' ? (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
              <div>
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Nome da Empresa / Marca</label>
                <input
                  type="text"
                  value={draft.companyName}
                  onChange={(e) => setDraft((p) => ({ ...p, companyName: e.target.value }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
              <ColorPickerField
                label="Cor Primária"
                value={draft.primaryColor}
                onChange={(hex) => setDraft((p) => ({ ...p, primaryColor: hex }))}
              />
              <ColorPickerField
                label="Texto sobre Cor Primária"
                value={draft.textColor}
                onChange={(hex) => setDraft((p) => ({ ...p, textColor: hex }))}
              />
            </div>

            {/* Upload Imediato de Logotipo */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/70">
              <div className="flex items-center gap-3">
                <div className="h-12 w-12 rounded-xl border border-slate-200 bg-white flex items-center justify-center overflow-hidden shrink-0 dark:border-slate-700 dark:bg-slate-900">
                  {draft.logoDataUrl ? (
                    <img
                      src={draft.logoDataUrl}
                      alt={draft.companyName}
                      referrerPolicy="no-referrer"
                      className="h-full w-full object-contain p-1"
                    />
                  ) : (
                    <span className="font-display font-bold text-slate-400 dark:text-slate-400">FP</span>
                  )}
                </div>
                <div>
                  <div className="font-semibold text-slate-900 dark:text-slate-100">Logotipo Institucional (Salvo Imediatamente)</div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    Exibido na barra superior e na tela de login corporativo.
                  </div>
                </div>
              </div>

              {isAdmin && (
                <div className="flex items-center gap-2">
                  <label className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-semibold text-slate-800 hover:bg-slate-100 cursor-pointer whitespace-nowrap dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800">
                    <Upload className="w-3.5 h-3.5" />
                    Enviar Logotipo
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleImmediateLogoUpload}
                      className="hidden"
                    />
                  </label>
                  {draft.logoDataUrl && (
                    <button
                      type="button"
                      onClick={() => {
                        const next = { ...draft, logoDataUrl: '' };
                        setDraft(next);
                        persistBranding(next, 'Logotipo removido imediatamente.');
                      }}
                      className="rounded-lg border border-red-200 bg-white px-3 py-1.5 font-semibold text-red-700 hover:bg-red-50 whitespace-nowrap dark:border-red-800/70 dark:bg-slate-900 dark:text-red-300 dark:hover:bg-red-950/60"
                    >
                      Remover
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Título Principal da Tela de Login</label>
                <input
                  type="text"
                  value={draft.marketingHeadline}
                  onChange={(e) => setDraft((p) => ({ ...p, marketingHeadline: e.target.value }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Texto Institucional da Tela de Login</label>
                <textarea
                  rows={2}
                  value={draft.marketingDescription}
                  onChange={(e) => setDraft((p) => ({ ...p, marketingDescription: e.target.value }))}
                  className="w-full rounded-lg border border-slate-200 p-2.5 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
              <ColorPickerField
                label="Fundo Coluna Institucional (Login)"
                value={draft.loginLeftBg}
                onChange={(hex) => setDraft((p) => ({ ...p, loginLeftBg: hex }))}
              />
              <ColorPickerField
                label="Texto Coluna Institucional (Login)"
                value={draft.loginLeftText}
                onChange={(hex) => setDraft((p) => ({ ...p, loginLeftText: hex }))}
              />
              <ColorPickerField
                label="Fundo Coluna Formulário (Login)"
                value={draft.loginRightBg}
                onChange={(hex) => setDraft((p) => ({ ...p, loginRightBg: hex }))}
              />
              <ColorPickerField
                label="Texto Coluna Formulário (Login)"
                value={draft.loginRightText}
                onChange={(hex) => setDraft((p) => ({ ...p, loginRightText: hex }))}
              />
            </div>
          </>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <ColorPickerField
              label="Fundo do Menu Lateral"
              value={draft.sidebarBg}
              onChange={(hex) => setDraft((p) => ({ ...p, sidebarBg: hex }))}
            />
            <ColorPickerField
              label="Texto do Menu Lateral"
              value={draft.sidebarText}
              onChange={(hex) => setDraft((p) => ({ ...p, sidebarText: hex }))}
            />
            <ColorPickerField
              label="Fundo da Área de Conteúdo"
              value={draft.canvasBg}
              onChange={(hex) => setDraft((p) => ({ ...p, canvasBg: hex }))}
            />
            <ColorPickerField
              label="Fundo do Cabeçalho Superior"
              value={draft.headerBg}
              onChange={(hex) => setDraft((p) => ({ ...p, headerBg: hex }))}
            />
            <ColorPickerField
              label="Texto do Cabeçalho Superior"
              value={draft.headerText}
              onChange={(hex) => setDraft((p) => ({ ...p, headerText: hex }))}
            />
          </div>
        )}

        {isAdmin && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
            <button
              type="button"
              onClick={restoreSectionDefaults}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3.5 py-2 font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Restaurar Padrão da Seção
            </button>

            <div className="flex gap-2">
              <button
                type="button"
                disabled={!isDirty || saving}
                onClick={() => setCancelConfirmOpen(true)}
                className="rounded-lg border border-slate-200 px-4 py-2 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => persistBranding(draft, 'Identidade visual salva e registrada em auditoria.')}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-emerald-600 dark:hover:bg-emerald-500"
              >
                <Check className="w-3.5 h-3.5" />
                {saving ? 'Salvando...' : 'Salvar Identidade Visual'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Confirmação de Descarte de Alterações */}
      {cancelConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 dark:bg-slate-950/80">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl space-y-4 text-xs dark:border-slate-700 dark:bg-slate-900">
            <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
              Descartar alterações não salvas?
            </h3>
            <p className="text-slate-600 dark:text-slate-300">
              As edições realizadas nos campos de cores e textos serão revertidas para a última versão salva.
            </p>
            <div className="flex justify-end gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setCancelConfirmOpen(false)}
                className="rounded-lg border border-slate-200 px-3.5 py-2 font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200"
              >
                Continuar Editando
              </button>
              <button
                type="button"
                onClick={() => {
                  setDraft(initialBranding);
                  setCancelConfirmOpen(false);
                  onToast('Alterações descartadas.');
                }}
                className="rounded-lg bg-red-600 px-4 py-2 font-semibold text-white hover:bg-red-700"
              >
                Descartar Alterações
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
