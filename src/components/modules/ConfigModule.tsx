import React, { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft,
  BookOpen,
  Building2,
  ClipboardCheck,
  Clock,
  Database,
  Download,
  Edit3,
  FileSpreadsheet,
  KeyRound,
  MessageSquare,
  Palette,
  Play,
  Plus,
  QrCode,
  Shield,
  Sliders,
  Trash2,
  X,
} from 'lucide-react';
import { apiFetch, getAuthToken } from '../../lib/api.ts';
import {
  AuditChecklistItem,
  AuthUser,
  CollaboratorItem,
  ConfigUserItem,
  GotalkChannelPublic,
  GotalkHsmTemplate,
  GotalkOperatorPublic,
  HelpCenterTopic,
  ModalityItem,
  PortalBrandingConfig,
  UazapiInstancePublic,
  UazapiStatus,
  Unit,
  UserGroup,
} from '../../types.ts';
import { ConfirmDeleteModal } from './cadastros/CadastrosShared.tsx';
import {
  ConfigUazapiView,
  ConfigUnitsView,
  UazapiQrModal,
} from './config/ConfigUnitsAndUazapiView.tsx';
import { ConfigGotalkView, GotalkStatusSummary } from './config/ConfigGotalkView.tsx';
import {
  ConfigAuditAndChecklistView,
  ConfigGroupsAndUsersView,
  ConfigHelpCenterView,
  ConfigPortalBrandingView,
} from './config/ConfigGovernanceViews.tsx';

interface ConfigModuleProps {
  currentUser: AuthUser;
  onUnitsUpdated: () => void;
  onBrandingUpdated?: (branding: PortalBrandingConfig) => void;
  onGoBack?: () => void;
}

type ConfigTab =
  | 'units'
  | 'uazapi'
  | 'gotalk'
  | 'groups'
  | 'audit_checklist'
  | 'schedules'
  | 'fields_categories'
  | 'help_center'
  | 'branding'
  | 'ai_regua'
  | 'import'
  | 'sql';

const DEFAULT_PORTAL_BRANDING_FALLBACK: PortalBrandingConfig = {
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

export const ConfigModule: React.FC<ConfigModuleProps> = ({
  currentUser,
  onUnitsUpdated,
  onBrandingUpdated,
  onGoBack,
}) => {
  const isAdmin = currentUser.role === 'admin';
  const [tab, setTab] = useState<ConfigTab>('units');
  const [tabHistory, setTabHistory] = useState<ConfigTab[]>([]);

  const switchTab = useCallback((nextTab: ConfigTab) => {
    setTab((prev) => {
      if (prev !== nextTab) {
        setTabHistory((h) => [...h.slice(-15), prev]);
      }
      return nextTab;
    });
  }, []);

  const handleBackClick = useCallback(() => {
    if (tabHistory.length > 0) {
      const prevTab = tabHistory[tabHistory.length - 1];
      setTabHistory((h) => h.slice(0, -1));
      setTab(prevTab);
      return;
    }
    onGoBack?.();
  }, [tabHistory, onGoBack]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [groups, setGroups] = useState<UserGroup[]>([]);
  const [usersList, setUsersList] = useState<ConfigUserItem[]>([]);
  const [schedules, setSchedules] = useState<
    Array<{
      id: number;
      targetType: string;
      targetId?: number;
      targetLabel: string;
      startTime: string;
      endTime: string;
      allowedDays: number[];
      active: boolean;
    }>
  >([]);
  const [customFields, setCustomFields] = useState<
    Array<{ id: number; module: string; fieldKey: string; label: string; fieldType: string; required?: boolean }>
  >([]);
  const [paymentCategories, setPaymentCategories] = useState<
    Array<{ id: number; name: string; providerCode: string; active?: boolean }>
  >([]);
  const [settings, setSettings] = useState<Record<string, Record<string, unknown>>>({});
  const [iviConfig, setIviConfig] = useState<{
    chainOrder: string[];
    configuredProviders: Record<string, boolean>;
  } | null>(null);
  const [gotalkConfig, setGotalkConfig] = useState<GotalkStatusSummary | null>(null);
  const [gotalkChannels, setGotalkChannels] = useState<GotalkChannelPublic[]>([]);
  const [gotalkOperators, setGotalkOperators] = useState<GotalkOperatorPublic[]>([]);
  const [gotalkTemplates, setGotalkTemplates] = useState<GotalkHsmTemplate[]>([]);
  const [uazapiConfig, setUazapiConfig] = useState<UazapiStatus | null>(null);
  const [auditLogs, setAuditLogs] = useState<
    Array<{ id: number; userName: string; action: string; entityType: string; entityId: string; createdAt: string }>
  >([]);

  // Governance Bootstrap State
  const [portalBranding, setPortalBranding] = useState<PortalBrandingConfig>(DEFAULT_PORTAL_BRANDING_FALLBACK);
  const [checklistItems, setChecklistItems] = useState<AuditChecklistItem[]>([]);
  const [helpTopics, setHelpTopics] = useState<HelpCenterTopic[]>([]);
  const [modalities, setModalities] = useState<ModalityItem[]>([]);
  const [collaborators, setCollaborators] = useState<CollaboratorItem[]>([]);

  // Cross-tab UaZapi Filter & QR Modal
  const [uazapiUnitFilter, setUazapiUnitFilter] = useState<number | null>(null);
  const [qrModalInstance, setQrModalInstance] = useState<UazapiInstancePublic | null>(null);

  // Schedules CRUD State
  const [schedModalOpen, setSchedModalOpen] = useState(false);
  const [editSchedId, setEditSchedId] = useState<number | null>(null);
  const [schedTargetType, setSchedTargetType] = useState('unit');
  const [schedTargetLabel, setSchedTargetLabel] = useState('');
  const [schedStart, setSchedStart] = useState('08:00');
  const [schedEnd, setSchedEnd] = useState('19:00');
  const [schedDays, setSchedDays] = useState<number[]>([1, 2, 3, 4, 5, 6]);
  const [schedActive, setSchedActive] = useState(true);
  const [deleteSchedId, setDeleteSchedId] = useState<number | null>(null);

  // Custom Fields & Categories CRUD State
  const [editFieldId, setEditFieldId] = useState<number | null>(null);
  const [fieldModule, setFieldModule] = useState('admission');
  const [fieldKey, setFieldKey] = useState('');
  const [fieldLabel, setFieldLabel] = useState('');
  const [fieldType, setFieldType] = useState('text');
  const [deleteFieldId, setDeleteFieldId] = useState<number | null>(null);

  const [editCatId, setEditCatId] = useState<number | null>(null);
  const [catName, setCatName] = useState('');
  const [catProvider, setCatProvider] = useState('custom');
  const [deleteCatId, setDeleteCatId] = useState<number | null>(null);
  const [deleteCatErr, setDeleteCatErr] = useState('');

  // Bulk Import & Export
  const [importCsvText, setImportCsvText] = useState(
    'Nome Completo;CPF/CNPJ;Telefone;Email;Cidade;UF;Unidade\nRoberto Almeida Silva;123.456.789-00;(81) 99988-7766;roberto@email.com;Recife;PE;Matriz'
  );
  const [importPreview, setImportPreview] = useState<{
    total: number;
    validCount: number;
    conflictCount: number;
    rows: Array<{
      rowNumber: number;
      fullName: string;
      cpfCnpj: string;
      resolvedUnitId: number;
      valid: boolean;
      issues: string[];
    }>;
  } | null>(null);
  const [exportTable, setExportTable] = useState('clients');

  // Admin PostgreSQL SQL Console
  const [sqlText, setSqlText] = useState(
    'SELECT u.code, u.name, u.legal_name, u.state, (u.min_admission_cost_cents / 100.0) AS custo_minimo_brl FROM units u ORDER BY u.id;'
  );
  const [sqlResult, setSqlResult] = useState<{
    columns: string[];
    rows: Array<Record<string, unknown>>;
    rowCount: number | null;
    durationMs: number;
  } | null>(null);
  const [sqlError, setSqlError] = useState('');

  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(false);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
  }, []);

  const loadAll = useCallback(async () => {
    const [cfg, gov] = await Promise.all([
      apiFetch<{
        units: Unit[];
        groups: UserGroup[];
        users: ConfigUserItem[];
        schedules: Array<{
          id: number;
          targetType: string;
          targetId?: number;
          targetLabel: string;
          startTime: string;
          endTime: string;
          allowedDays: number[];
          active: boolean;
        }>;
        customFields: Array<{
          id: number;
          module: string;
          fieldKey: string;
          label: string;
          fieldType: string;
          required?: boolean;
        }>;
        paymentCategories: Array<{ id: number; name: string; providerCode: string; active?: boolean }>;
        settings: Record<string, Record<string, unknown>>;
        iviConfig: { chainOrder: string[]; configuredProviders: Record<string, boolean> };
        gotalkConfig?: GotalkStatusSummary;
        gotalkResources?: {
          channels: GotalkChannelPublic[];
          operators: GotalkOperatorPublic[];
          templates: GotalkHsmTemplate[];
        };
        uazapiConfig?: UazapiStatus;
        auditLogs: Array<{
          id: number;
          userName: string;
          action: string;
          entityType: string;
          entityId: string;
          createdAt: string;
        }>;
      }>('/api/config'),
      apiFetch<{
        portalBranding: PortalBrandingConfig;
        auditChecklist: AuditChecklistItem[];
        helpTopics: HelpCenterTopic[];
        modalities: ModalityItem[];
        collaborators: CollaboratorItem[];
      }>('/api/config/governance-bootstrap'),
    ]);

    setUnits(cfg.units || []);
    setGroups(cfg.groups || []);
    setUsersList(cfg.users || []);
    setSchedules(cfg.schedules || []);
    setCustomFields(cfg.customFields || []);
    setPaymentCategories(cfg.paymentCategories || []);
    setSettings(cfg.settings || {});
    setIviConfig(cfg.iviConfig || null);
    setGotalkConfig(cfg.gotalkConfig || null);
    setGotalkChannels(cfg.gotalkResources?.channels || []);
    setGotalkOperators(cfg.gotalkResources?.operators || []);
    setGotalkTemplates(cfg.gotalkResources?.templates || []);
    setUazapiConfig(cfg.uazapiConfig || null);
    setAuditLogs(cfg.auditLogs || []);

    if (gov.portalBranding) setPortalBranding(gov.portalBranding);
    setChecklistItems(gov.auditChecklist || []);
    setHelpTopics(gov.helpTopics || []);
    setModalities(gov.modalities || []);
    setCollaborators(gov.collaborators || []);
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const handleSaveSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!schedTargetLabel.trim()) return;
    setBusy(true);
    try {
      const payload = {
        targetType: schedTargetType,
        targetId: 1,
        targetLabel: schedTargetLabel.trim(),
        startTime: schedStart,
        endTime: schedEnd,
        allowedDays: schedDays,
        active: schedActive,
      };
      if (editSchedId) {
        await apiFetch(`/api/config/schedules/${editSchedId}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        showToast('Regra do Quadro de Horários atualizada.');
      } else {
        await apiFetch('/api/config/schedules', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        showToast('Nova regra adicionada ao Quadro de Horários.');
      }
      setSchedModalOpen(false);
      await loadAll();
    } finally {
      setBusy(false);
    }
  };

  const handleSaveCustomField = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fieldKey.trim() || !fieldLabel.trim()) return;
    setBusy(true);
    try {
      const payload = {
        module: fieldModule,
        fieldKey: fieldKey.trim(),
        label: fieldLabel.trim(),
        fieldType,
      };
      if (editFieldId) {
        await apiFetch(`/api/config/custom-fields/${editFieldId}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        showToast('Campo customizado atualizado.');
      } else {
        await apiFetch('/api/config/custom-fields', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        showToast('Campo customizado criado.');
      }
      setEditFieldId(null);
      setFieldKey('');
      setFieldLabel('');
      await loadAll();
    } finally {
      setBusy(false);
    }
  };

  const handleSavePaymentCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!catName.trim()) return;
    setBusy(true);
    try {
      const payload = { name: catName.trim(), providerCode: catProvider.trim() || 'custom' };
      if (editCatId) {
        await apiFetch(`/api/config/payment-categories/${editCatId}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        showToast('Categoria de pagamento atualizada.');
      } else {
        await apiFetch('/api/config/payment-categories', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        showToast('Categoria de pagamento adicionada.');
      }
      setEditCatId(null);
      setCatName('');
      setCatProvider('custom');
      await loadAll();
    } finally {
      setBusy(false);
    }
  };

  const parseCsvRows = () => {
    const lines = importCsvText.trim().split('\n').slice(1);
    return lines
      .map((line) => {
        const [fullName, cpfCnpj, phone, email, city, state, unitName] = line
          .split(';')
          .map((s) => (s || '').trim());
        return { fullName, cpfCnpj, phone, email, city, state, unitName };
      })
      .filter((r) => r.fullName || r.cpfCnpj);
  };

  const handlePreviewImport = async () => {
    const rows = parseCsvRows();
    setBusy(true);
    try {
      const res = await apiFetch<{
        total: number;
        validCount: number;
        conflictCount: number;
        rows: Array<{
          rowNumber: number;
          fullName: string;
          cpfCnpj: string;
          resolvedUnitId: number;
          valid: boolean;
          issues: string[];
        }>;
      }>('/api/import/preview', {
        method: 'POST',
        body: JSON.stringify({ rows }),
      });
      setImportPreview(res);
    } finally {
      setBusy(false);
    }
  };

  const handleImportCsv = async () => {
    const rows = parseCsvRows().filter((r) => r.fullName && r.cpfCnpj);
    setBusy(true);
    try {
      const res = await apiFetch<{ imported: number }>('/api/import', {
        method: 'POST',
        body: JSON.stringify({ rows }),
      });
      setImportPreview(null);
      showToast(`Importação concluída: ${res.imported} registro(s) gravados.`);
      await loadAll();
    } finally {
      setBusy(false);
    }
  };

  const handleExportScoped = async () => {
    const token = getAuthToken();
    const res = await fetch(`/api/export?table=${exportTable}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `financepro_${exportTable}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`Exportação operacional (${exportTable}) concluída e auditada.`);
  };

  const handleExecuteSql = async (e: React.FormEvent) => {
    e.preventDefault();
    setSqlError('');
    setBusy(true);
    try {
      const res = await apiFetch<{
        columns: string[];
        rows: Array<Record<string, unknown>>;
        rowCount: number | null;
        durationMs: number;
      }>('/api/admin/sql', {
        method: 'POST',
        body: JSON.stringify({ queryText: sqlText }),
      });
      setSqlResult(res);
    } catch (err) {
      setSqlError(err instanceof Error ? err.message : 'Erro SQL');
    } finally {
      setBusy(false);
    }
  };

  const tabs: Array<{ id: ConfigTab; label: string; icon: React.FC<{ className?: string }> }> = [
    { id: 'units', label: 'Unidades & Custos', icon: Building2 },
    { id: 'uazapi', label: 'WhatsApp UaZapi & Grupos', icon: QrCode },
    { id: 'gotalk', label: 'Mensagens & Canais GoTalk', icon: MessageSquare },
    { id: 'groups', label: 'Grupos, Usuários & RBAC', icon: Shield },
    { id: 'audit_checklist', label: 'Checklist & Auditoria', icon: ClipboardCheck },
    { id: 'schedules', label: 'Quadro de Horários', icon: Clock },
    { id: 'fields_categories', label: 'Campos & Categorias', icon: Sliders },
    { id: 'help_center', label: 'Central de Ajuda', icon: BookOpen },
    { id: 'branding', label: 'Portal & Identidade', icon: Palette },
    { id: 'ai_regua', label: 'IA Ivi & Régua', icon: KeyRound },
    { id: 'import', label: 'Importação & CSV', icon: FileSpreadsheet },
    ...(isAdmin ? [{ id: 'sql' as ConfigTab, label: 'Console SQL Admin', icon: Database }] : []),
  ];

  const dayNames: Record<number, string> = {
    1: 'Seg',
    2: 'Ter',
    3: 'Qua',
    4: 'Qui',
    5: 'Sex',
    6: 'Sáb',
    0: 'Dom',
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 pb-4">
        <div>
          <p className="text-xs font-medium text-slate-500">
            Governança Corporativa · Unidades &amp; Custos · Canais Multi-Grupo UaZapi &amp; GoTalk · RBAC · Checklist Condicional · Identidade Visual
          </p>
          <h1 className="mt-1 font-display text-2xl font-bold text-slate-900">
            Configurações Corporativas &amp; Segurança
          </h1>
        </div>
        {(tabHistory.length > 0 || onGoBack) && (
          <button
            type="button"
            onClick={handleBackClick}
            className="inline-flex items-center gap-1.5 self-start sm:self-center rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 min-h-[38px] shrink-0"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Voltar para a tela anterior
          </button>
        )}
      </div>

      {/* Sub-navigation with horizontal scroll ruler on mobile/tablet */}
      <div className="flex items-center gap-1.5 overflow-x-auto sm:flex-wrap pb-1.5 scroll-rulers">
        {tabs.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => switchTab(t.id)}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 min-h-[38px] ${
                active
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>

      {toast && (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-medium text-emerald-900">
          <span>{toast}</span>
          <button
            type="button"
            onClick={() => setToast('')}
            className="text-emerald-700 hover:text-emerald-950"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* 1. UNIDADES & CUSTOS */}
      {tab === 'units' && (
        <ConfigUnitsView
          units={units}
          uazapiInstances={uazapiConfig?.instances || []}
          currentUser={currentUser}
          onRefresh={async () => {
            await loadAll();
            onUnitsUpdated();
          }}
          onOpenUazapiForUnit={(unitId) => {
            setUazapiUnitFilter(unitId);
            switchTab('uazapi');
          }}
          onPairInstanceQr={(inst) => setQrModalInstance(inst)}
          onToast={showToast}
        />
      )}

      {/* 2. WHATSAPP UAZAPI & ASSOCIAÇÃO POR GRUPOS */}
      {tab === 'uazapi' && (
        <ConfigUazapiView
          units={units}
          groups={groups}
          collaborators={collaborators}
          uazapiConfig={uazapiConfig}
          currentUser={currentUser}
          initialUnitFilter={uazapiUnitFilter}
          onClearUnitFilter={() => setUazapiUnitFilter(null)}
          onRefresh={loadAll}
          onPairInstanceQr={(inst) => setQrModalInstance(inst)}
          onToast={showToast}
        />
      )}

      {/* 3. MENSAGENS, CANAIS, MENUS & ATENDIMENTOS GOTALK */}
      {tab === 'gotalk' && (
        <ConfigGotalkView
          currentUser={currentUser}
          units={units}
          gotalkConfig={gotalkConfig}
          channels={gotalkChannels}
          operators={gotalkOperators}
          templates={gotalkTemplates}
          onRefreshConfig={loadAll}
          onToast={showToast}
        />
      )}

      {/* 4. GRUPOS, USUÁRIOS & RBAC */}
      {tab === 'groups' && (
        <ConfigGroupsAndUsersView
          currentUser={currentUser}
          groups={groups}
          usersList={usersList}
          units={units}
          uazapiInstances={uazapiConfig?.instances || []}
          onRefresh={async () => {
            await loadAll();
            onUnitsUpdated();
          }}
          onToast={showToast}
        />
      )}

      {/* 5. CHECKLIST DE AUDITORIA & EXCEÇÕES */}
      {tab === 'audit_checklist' && (
        <ConfigAuditAndChecklistView
          currentUser={currentUser}
          checklistItems={checklistItems}
          modalities={modalities}
          auditLogs={auditLogs}
          onRefresh={loadAll}
          onToast={showToast}
        />
      )}

      {/* 6. QUADRO DE HORÁRIOS (DATA GRID CRUD) */}
      {tab === 'schedules' && (
        <div className="space-y-4 text-xs">
          <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-4">
            <div>
              <div className="font-display text-sm font-bold text-slate-900">
                Quadro de Horários &amp; Janelas de Acesso Operacional
              </div>
              <p className="text-slate-500">
                Restrição automática de jornada por Unidade, Grupo RBAC ou Colaborador.
              </p>
            </div>
            {isAdmin && (
              <button
                type="button"
                onClick={() => {
                  setEditSchedId(null);
                  setSchedTargetType('unit');
                  setSchedTargetLabel('');
                  setSchedStart('08:00');
                  setSchedEnd('19:00');
                  setSchedDays([1, 2, 3, 4, 5, 6]);
                  setSchedActive(true);
                  setSchedModalOpen(true);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 font-semibold text-white hover:bg-slate-800 whitespace-nowrap shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                Nova Janela de Horário
              </button>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <div className="overflow-x-auto overflow-y-auto max-h-[55vh] scroll-rulers">
              <table className="w-full min-w-[640px] text-left text-xs">
                <thead className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600">
                  <tr>
                    <th className="px-4 py-2.5">Descrição / Turno</th>
                    <th className="px-4 py-2.5 whitespace-nowrap">Escopo</th>
                    <th className="px-4 py-2.5 whitespace-nowrap">Horário Permitido</th>
                    <th className="px-4 py-2.5">Dias da Semana</th>
                    <th className="px-4 py-2.5 whitespace-nowrap">Status</th>
                    <th className="px-4 py-2.5 text-right whitespace-nowrap">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {schedules.map((s) => (
                    <tr key={s.id} className="hover:bg-slate-50/80">
                      <td className="px-4 py-2.5 font-semibold text-slate-900">{s.targetLabel}</td>
                      <td className="px-4 py-2.5 uppercase text-[11px] text-slate-600">{s.targetType}</td>
                      <td className="px-4 py-2.5 font-mono font-semibold text-slate-900 tabular-nums">
                        {s.startTime} às {s.endTime}
                      </td>
                      <td className="px-4 py-2.5 text-slate-600">
                        {(s.allowedDays || []).map((d) => dayNames[d] || d).join(' · ')}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={s.active ? 'font-semibold text-emerald-700' : 'text-slate-400'}>
                          {s.active ? 'Ativa' : 'Inativa'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        {isAdmin && (
                          <div className="inline-flex gap-1">
                            <button
                              type="button"
                              onClick={() => {
                                setEditSchedId(s.id);
                                setSchedTargetType(s.targetType);
                                setSchedTargetLabel(s.targetLabel);
                                setSchedStart(s.startTime);
                                setSchedEnd(s.endTime);
                                setSchedDays(s.allowedDays || [1, 2, 3, 4, 5]);
                                setSchedActive(s.active !== false);
                                setSchedModalOpen(true);
                              }}
                              className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleteSchedId(s.id)}
                              className="rounded-md p-1.5 text-red-600 hover:bg-red-50"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {schedModalOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
              <form
                onSubmit={handleSaveSchedule}
                className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl space-y-4 text-xs"
              >
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <h3 className="font-display text-sm font-bold text-slate-900">
                    {editSchedId ? 'Editar Regra de Horário' : 'Nova Regra de Horário'}
                  </h3>
                  <button
                    type="button"
                    onClick={() => setSchedModalOpen(false)}
                    className="text-slate-400 hover:text-slate-700"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Alvo</label>
                    <select
                      value={schedTargetType}
                      onChange={(e) => setSchedTargetType(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2"
                    >
                      <option value="unit">Unidade</option>
                      <option value="group">Grupo RBAC</option>
                      <option value="user">Colaborador</option>
                    </select>
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Descrição *</label>
                    <input
                      type="text"
                      required
                      value={schedTargetLabel}
                      onChange={(e) => setSchedTargetLabel(e.target.value)}
                      placeholder="Ex: Turno Comercial Matriz"
                      className="w-full rounded-lg border border-slate-200 px-3 py-2"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">Início</label>
                      <input
                        type="time"
                        value={schedStart}
                        onChange={(e) => setSchedStart(e.target.value)}
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">Fim</label>
                      <input
                        type="time"
                        value={schedEnd}
                        onChange={(e) => setSchedEnd(e.target.value)}
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Dias Liberados</label>
                    <div className="flex flex-wrap gap-2">
                      {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                        <label key={d} className="flex items-center gap-1 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={schedDays.includes(d)}
                            onChange={() =>
                              setSchedDays((prev) =>
                                prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]
                              )
                            }
                          />
                          <span>{dayNames[d]}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer font-medium text-slate-800">
                    <input
                      type="checkbox"
                      checked={schedActive}
                      onChange={(e) => setSchedActive(e.target.checked)}
                    />
                    <span>Regra ativa</span>
                  </label>
                </div>

                <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
                  <button
                    type="button"
                    onClick={() => setSchedModalOpen(false)}
                    className="rounded-lg border border-slate-200 px-3.5 py-2 font-semibold text-slate-700"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={busy}
                    className="rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white hover:bg-slate-800"
                  >
                    Salvar
                  </button>
                </div>
              </form>
            </div>
          )}

          <ConfirmDeleteModal
            open={Boolean(deleteSchedId)}
            title="Remover Regra de Horário?"
            description="A janela selecionada será excluída do Quadro de Horários."
            onCancel={() => setDeleteSchedId(null)}
            onConfirm={async () => {
              if (!deleteSchedId) return;
              await apiFetch(`/api/config/schedules/${deleteSchedId}`, { method: 'DELETE' });
              setDeleteSchedId(null);
              await loadAll();
              showToast('Regra removida.');
            }}
          />
        </div>
      )}

      {/* 7. CAMPOS DINÂMICOS & CATEGORIAS DE PAGAMENTO CRUD */}
      {tab === 'fields_categories' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 text-xs">
          {/* Campos Dinâmicos */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-4">
            <div className="font-display text-sm font-bold text-slate-900">
              Campos Dinâmicos por Módulo
            </div>

            {isAdmin && (
              <form onSubmit={handleSaveCustomField} className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <select
                  value={fieldModule}
                  onChange={(e) => setFieldModule(e.target.value)}
                  className="rounded-lg border border-slate-200 px-2.5 py-2"
                >
                  <option value="admission">Admissão / Contrato</option>
                  <option value="client">Cadastro do Cliente</option>
                  <option value="legal">Jurídico</option>
                </select>
                <select
                  value={fieldType}
                  onChange={(e) => setFieldType(e.target.value)}
                  className="rounded-lg border border-slate-200 px-2.5 py-2"
                >
                  <option value="text">Texto</option>
                  <option value="number">Número</option>
                  <option value="date">Data</option>
                </select>
                <input
                  value={fieldKey}
                  onChange={(e) => setFieldKey(e.target.value)}
                  placeholder="Chave técnica (ex: chassi_extra)"
                  className="rounded-lg border border-slate-200 px-3 py-2 font-mono"
                />
                <input
                  value={fieldLabel}
                  onChange={(e) => setFieldLabel(e.target.value)}
                  placeholder="Rótulo visível"
                  className="rounded-lg border border-slate-200 px-3 py-2"
                />
                <div className="sm:col-span-2 flex justify-end gap-2">
                  {editFieldId && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditFieldId(null);
                        setFieldKey('');
                        setFieldLabel('');
                      }}
                      className="rounded-lg border border-slate-200 px-3 py-1.5 font-semibold text-slate-600"
                    >
                      Cancelar Edição
                    </button>
                  )}
                  <button
                    type="submit"
                    disabled={busy}
                    className="rounded-lg bg-slate-900 px-3.5 py-1.5 font-semibold text-white hover:bg-slate-800"
                  >
                    {editFieldId ? 'Atualizar Campo' : 'Adicionar Campo'}
                  </button>
                </div>
              </form>
            )}

            <div className="divide-y divide-slate-100 border-t border-slate-100 pt-2">
              {customFields.map((f) => (
                <div key={f.id} className="py-2.5 flex items-center justify-between gap-2">
                  <div>
                    <div className="font-semibold text-slate-900">{f.label}</div>
                    <div className="font-mono text-[11px] text-slate-500">
                      {f.module} · {f.fieldKey} ({f.fieldType})
                    </div>
                  </div>
                  {isAdmin && (
                    <div className="inline-flex gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          setEditFieldId(f.id);
                          setFieldModule(f.module);
                          setFieldKey(f.fieldKey);
                          setFieldLabel(f.label);
                          setFieldType(f.fieldType || 'text');
                        }}
                        className="rounded p-1.5 text-slate-600 hover:bg-slate-100"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteFieldId(f.id)}
                        className="rounded p-1.5 text-red-600 hover:bg-red-50"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Categorias de Pagamento */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-4">
            <div className="font-display text-sm font-bold text-slate-900">
              Categorias de Pagamento &amp; Recebimento
            </div>

            {isAdmin && (
              <form onSubmit={handleSavePaymentCategory} className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <input
                  value={catName}
                  onChange={(e) => setCatName(e.target.value)}
                  placeholder="Nome da categoria..."
                  className="sm:col-span-2 rounded-lg border border-slate-200 px-3 py-2"
                />
                <input
                  value={catProvider}
                  onChange={(e) => setCatProvider(e.target.value)}
                  placeholder="Provedor (santander/pix)"
                  className="rounded-lg border border-slate-200 px-3 py-2 font-mono"
                />
                <div className="sm:col-span-3 flex justify-end gap-2">
                  {editCatId && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditCatId(null);
                        setCatName('');
                        setCatProvider('custom');
                      }}
                      className="rounded-lg border border-slate-200 px-3 py-1.5 font-semibold text-slate-600"
                    >
                      Cancelar
                    </button>
                  )}
                  <button
                    type="submit"
                    disabled={busy}
                    className="rounded-lg bg-slate-900 px-3.5 py-1.5 font-semibold text-white hover:bg-slate-800"
                  >
                    {editCatId ? 'Atualizar Categoria' : 'Adicionar Categoria'}
                  </button>
                </div>
              </form>
            )}

            <div className="divide-y divide-slate-100 border-t border-slate-100 pt-2">
              {paymentCategories.map((c) => (
                <div key={c.id} className="py-2.5 flex items-center justify-between gap-2">
                  <div>
                    <span className="font-semibold text-slate-900">{c.name}</span>
                    <span className="font-mono text-[11px] text-slate-500 ml-2">· {c.providerCode}</span>
                  </div>
                  {isAdmin && (
                    <div className="inline-flex gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          setEditCatId(c.id);
                          setCatName(c.name);
                          setCatProvider(c.providerCode);
                        }}
                        className="rounded p-1.5 text-slate-600 hover:bg-slate-100"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setDeleteCatErr('');
                          setDeleteCatId(c.id);
                        }}
                        className="rounded p-1.5 text-red-600 hover:bg-red-50"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          <ConfirmDeleteModal
            open={Boolean(deleteFieldId)}
            title="Excluir Campo Customizado?"
            description="O metadado do campo será removido da configuração do módulo."
            onCancel={() => setDeleteFieldId(null)}
            onConfirm={async () => {
              if (!deleteFieldId) return;
              await apiFetch(`/api/config/custom-fields/${deleteFieldId}`, { method: 'DELETE' });
              setDeleteFieldId(null);
              await loadAll();
              showToast('Campo removido.');
            }}
          />

          <ConfirmDeleteModal
            open={Boolean(deleteCatId)}
            title="Excluir Categoria de Pagamento?"
            description="Categorias vinculadas a títulos financeiros existentes não podem ser excluídas."
            error={deleteCatErr}
            onCancel={() => setDeleteCatId(null)}
            onConfirm={async () => {
              if (!deleteCatId) return;
              try {
                await apiFetch(`/api/config/payment-categories/${deleteCatId}`, { method: 'DELETE' });
                setDeleteCatId(null);
                await loadAll();
                showToast('Categoria removida.');
              } catch (err) {
                setDeleteCatErr(err instanceof Error ? err.message : 'Erro ao excluir categoria.');
              }
            }}
          />
        </div>
      )}

      {/* 8. CENTRAL DE AJUDA */}
      {tab === 'help_center' && (
        <ConfigHelpCenterView
          currentUser={currentUser}
          topics={helpTopics}
          onRefresh={loadAll}
          onToast={showToast}
        />
      )}

      {/* 9. PORTAL & IDENTIDADE VISUAL */}
      {tab === 'branding' && (
        <ConfigPortalBrandingView
          currentUser={currentUser}
          initialBranding={portalBranding}
          onBrandingSaved={(next) => {
            setPortalBranding(next);
            onBrandingUpdated?.(next);
          }}
          onToast={showToast}
        />
      )}

      {/* 10. CADEIA IA IVI & PARÂMETROS DA RÉGUA */}
      {tab === 'ai_regua' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
            <h3 className="font-display text-sm font-bold text-slate-900">
              Cadeia de Fallback IA — Agente Ivi
            </h3>
            <p className="text-slate-600">
              Ordem executiva configurada: <strong>Claude Code → OpenAI → Gemini → DeepSeek</strong>. O servidor tenta cada provedor em sequência e armazena o aprendizado na base de conhecimento.
            </p>
            <div className="space-y-2">
              {['claude_code', 'openai', 'gemini', 'deepseek'].map((prov, idx) => (
                <div
                  key={prov}
                  className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-3 py-2"
                >
                  <span className="font-mono font-bold text-slate-800">
                    {idx + 1}º · {prov.toUpperCase()}
                  </span>
                  <span
                    className={
                      iviConfig?.configuredProviders?.[prov]
                        ? 'text-emerald-700 font-semibold'
                        : 'text-amber-700'
                    }
                  >
                    {iviConfig?.configuredProviders?.[prov]
                      ? 'Chave API Ativa (Env)'
                      : 'Fallback Automático'}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
            <h3 className="font-display text-sm font-bold text-slate-900">
              Parâmetros da Régua de Cobrança Ivi &amp; Escavador
            </h3>
            <pre className="rounded-lg bg-slate-900 text-slate-100 p-3 font-mono text-[11px] overflow-x-auto max-h-64">
              {JSON.stringify(settings, null, 2)}
            </pre>
          </div>
        </div>
      )}

      {/* 11. IMPORTAÇÃO EM LOTE & EXPORTAÇÃO CSV */}
      {tab === 'import' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3 text-xs">
            <div className="font-bold text-slate-900">
              Importação em Lote com Pré-Validação &amp; Desambiguação
            </div>
            <p className="text-slate-500">
              Formato CSV (;): Nome Completo;CPF/CNPJ;Telefone;Email;Cidade;UF;Unidade. Execute a pré-validação antes de gravar no Cloud SQL.
            </p>
            <textarea
              rows={5}
              value={importCsvText}
              onChange={(e) => setImportCsvText(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-xs"
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={handlePreviewImport}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 font-semibold text-slate-800 hover:bg-slate-50"
              >
                1. Pré-Validar Lote (Dry-Run)
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={handleImportCsv}
                className="rounded-lg bg-emerald-600 px-4 py-2 font-semibold text-white hover:bg-emerald-700"
              >
                2. Confirmar Importação
              </button>
            </div>

            {importPreview && (
              <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
                <div className="font-semibold text-slate-800">
                  Pré-validação: {importPreview.validCount} válida(s) · {importPreview.conflictCount} conflito(s)/aviso(s)
                </div>
                {importPreview.rows.map((r) => (
                  <div
                    key={r.rowNumber}
                    className="flex flex-wrap items-center justify-between gap-2 bg-white rounded border border-slate-100 px-3 py-2"
                  >
                    <span className="font-mono">
                      Linha #{r.rowNumber}: {r.fullName} ({r.cpfCnpj})
                    </span>
                    <span
                      className={r.valid ? 'text-emerald-700 font-semibold' : 'text-amber-700 font-semibold'}
                    >
                      {r.valid ? `OK (Unidade #${r.resolvedUnitId})` : r.issues.join(' | ')}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3 text-xs">
            <div className="font-bold text-slate-900">
              Exportação Operacional Parcial Compatível com Excel
            </div>
            <p className="text-slate-500">
              Escopo estritamente filtrado pela unidade ativa e registrado em trilha de auditoria.
            </p>
            <div className="flex flex-wrap gap-2">
              <select
                value={exportTable}
                onChange={(e) => setExportTable(e.target.value)}
                className="rounded-lg border border-slate-200 px-3 py-2 font-semibold text-slate-800"
              >
                <option value="clients">Clientes (Unidade Ativa)</option>
                <option value="admissions">Admissões / Contratos</option>
                <option value="financial_titles">Títulos Financeiros</option>
                <option value="legal_processes">Processos Jurídicos</option>
              </select>
              <button
                type="button"
                onClick={handleExportScoped}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white hover:bg-slate-800"
              >
                <Download className="w-3.5 h-3.5" />
                Exportar CSV (UTF-8 Excel)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 12. ADMIN POSTGRESQL SQL CONSOLE */}
      {tab === 'sql' && isAdmin && (
        <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h2 className="font-display text-base font-bold text-slate-900">
                Console Interativo PostgreSQL (Cloud SQL Administrador)
              </h2>
              <p className="text-xs text-slate-500">
                Consulte tabelas, faça auditoria direta de dados ou atualizações controladas. Comandos DROP/TRUNCATE são bloqueados.
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5 text-[11px]">
              <button
                type="button"
                onClick={() =>
                  setSqlText(
                    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;"
                  )
                }
                className="rounded-md border border-slate-200 px-2.5 py-1 hover:bg-slate-50"
              >
                Listar Tabelas
              </button>
              <button
                type="button"
                onClick={() =>
                  setSqlText(
                    'SELECT id, label, uazapi_instance_id, unit_id, allowed_group_ids, allowed_modules, is_connected FROM unit_whatsapp_credentials ORDER BY id;'
                  )
                }
                className="rounded-md border border-slate-200 px-2.5 py-1 hover:bg-slate-50"
              >
                Instâncias UaZapi
              </button>
              <button
                type="button"
                onClick={() =>
                  setSqlText(
                    'SELECT sort_order, title, modality_condition, active FROM audit_checklist_items ORDER BY sort_order;'
                  )
                }
                className="rounded-md border border-slate-200 px-2.5 py-1 hover:bg-slate-50"
              >
                Checklist Auditoria
              </button>
            </div>
          </div>

          <form onSubmit={handleExecuteSql} className="space-y-3">
            <textarea
              rows={4}
              value={sqlText}
              onChange={(e) => setSqlText(e.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-slate-900 text-emerald-300 p-3.5 font-mono text-xs focus:outline-none"
            />
            <button
              type="submit"
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
            >
              <Play className="w-3.5 h-3.5" />
              Executar Consulta PostgreSQL
            </button>
          </form>

          {sqlError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-mono text-red-700">
              {sqlError}
            </div>
          )}

          {sqlResult && (
            <div className="space-y-2">
              <div className="text-[11px] font-mono text-slate-500 tabular-nums">
                {sqlResult.rows.length} linha(s) retornada(s) · {sqlResult.durationMs}ms
              </div>
              <div className="overflow-x-auto overflow-y-auto max-h-[55vh] scroll-rulers rounded-lg border border-slate-200">
                <table className="w-full text-left text-xs font-mono">
                  <thead className="sticky top-0 z-10 bg-slate-50 text-[11px] text-slate-600 border-b border-slate-200">
                    <tr>
                      {sqlResult.columns.map((col) => (
                        <th key={col} className="px-3 py-2 whitespace-nowrap">
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {sqlResult.rows.map((row, idx) => (
                      <tr key={idx} className="hover:bg-slate-50">
                        {sqlResult.columns.map((col) => (
                          <td key={col} className="px-3 py-2 whitespace-nowrap text-slate-800">
                            {row[col] === null || row[col] === undefined
                              ? 'NULL'
                              : typeof row[col] === 'object'
                              ? JSON.stringify(row[col])
                              : String(row[col])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Modal Global de Pareamento QR Code UaZapi */}
      <UazapiQrModal
        open={Boolean(qrModalInstance)}
        instance={qrModalInstance}
        onClose={() => setQrModalInstance(null)}
        onConnected={() => {
          loadAll();
        }}
      />
    </div>
  );
};
