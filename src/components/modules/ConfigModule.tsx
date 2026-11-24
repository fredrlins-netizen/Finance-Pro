import React, { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft,
  BookOpen,
  Building2,
  ClipboardCheck,
  Clock,
  CloudUpload,
  Database,
  Download,
  Edit3,
  FileSpreadsheet,
  FolderOpen,
  HardDrive,
  History,
  KeyRound,
  Lock,
  MessageSquare,
  Palette,
  Play,
  Plus,
  QrCode,
  Shield,
  ShieldAlert,
  Sliders,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { apiFetch, getActiveUnitHeader, getAuthToken } from '../../lib/api.ts';
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
  ModuleId,
  NavigationIntent,
  PortalBrandingConfig,
  UazapiInstancePublic,
  UazapiStatus,
  Unit,
  UserGroup,
} from '../../types.ts';
import { ConfirmDeleteModal, EntityAuditModal } from './cadastros/CadastrosShared.tsx';
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
import { ConfigDataHubView } from './config/ConfigDataHubView.tsx';
import { ConfigR2MigrationView } from './config/ConfigR2MigrationView.tsx';
import { ConfigBackupRestoreView } from './config/ConfigBackupRestoreView.tsx';
import { ConfigUnitFilesView } from './config/ConfigUnitFilesView.tsx';
import {
  ProductionModeBannerCard,
  ProductionModeConfirmModal,
  ProductionModeStatusData,
} from './config/ConfigProductionModeView.tsx';

interface ConfigModuleProps {
  currentUser: AuthUser;
  wsTick?: number;
  initialTab?: ConfigTab | string;
  hasFullConfigAccess?: boolean;
  canBrowseUnitFiles?: boolean;
  unitsFallback?: Unit[];
  onUnitsUpdated: () => void;
  onBrandingUpdated?: (branding: PortalBrandingConfig) => void;
  onNavigate?: (mod: ModuleId, intent?: NavigationIntent) => void;
  onGoBack?: () => void;
  previousScreenLabel?: string;
  onActiveTabChange?: (tab: string) => void;
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
  | 'unit_files'
  | 'r2_migration'
  | 'backup_restore'
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
  wsTick,
  initialTab,
  hasFullConfigAccess,
  canBrowseUnitFiles,
  unitsFallback,
  onUnitsUpdated,
  onBrandingUpdated,
  onNavigate,
  onGoBack,
  previousScreenLabel,
  onActiveTabChange,
}) => {
  const isAdmin = currentUser.role === 'admin';
  const fullConfigAllowed = isAdmin || hasFullConfigAccess !== false;
  const unitFilesAllowed = isAdmin || fullConfigAllowed || canBrowseUnitFiles === true;

  const resolvedInitialTab: ConfigTab =
    initialTab === 'unit_files' && unitFilesAllowed
      ? 'unit_files'
      : !fullConfigAllowed && unitFilesAllowed
      ? 'unit_files'
      : initialTab === 'backup_restore' && isAdmin
      ? 'backup_restore'
      : initialTab === 'r2_migration' && isAdmin
      ? 'r2_migration'
      : initialTab === 'sql' && isAdmin
      ? 'sql'
      : 'units';
  const [tab, setTab] = useState<ConfigTab>(resolvedInitialTab);
  const [tabHistory, setTabHistory] = useState<ConfigTab[]>([]);
  const tabRef = React.useRef<ConfigTab>(resolvedInitialTab);

  useEffect(() => {
    onActiveTabChange?.(tab);
  }, [tab, onActiveTabChange]);

  useEffect(() => {
    if (!initialTab) {
      if (!fullConfigAllowed && unitFilesAllowed && tabRef.current !== 'unit_files') {
        tabRef.current = 'unit_files';
        setTab('unit_files');
      }
      return;
    }
    if (!fullConfigAllowed) {
      if (unitFilesAllowed) {
        tabRef.current = 'unit_files';
        setTab('unit_files');
        setTabHistory([]);
      }
      return;
    }
    if (initialTab === 'backup_restore' && !isAdmin) return;
    if ((initialTab === 'r2_migration' || initialTab === 'sql') && !isAdmin) return;
    if (initialTab === 'unit_files' && !unitFilesAllowed) return;
    const validTabs: ConfigTab[] = [
      'units',
      'uazapi',
      'gotalk',
      'groups',
      'audit_checklist',
      'schedules',
      'fields_categories',
      'help_center',
      'branding',
      'ai_regua',
      'import',
      'unit_files',
      'r2_migration',
      'backup_restore',
      'sql',
    ];
    if (validTabs.includes(initialTab as ConfigTab)) {
      tabRef.current = initialTab as ConfigTab;
      setTab(initialTab as ConfigTab);
      setTabHistory([]);
    }
  }, [initialTab, isAdmin, fullConfigAllowed, unitFilesAllowed]);

  const switchTab = useCallback((nextTab: ConfigTab) => {
    const curr = tabRef.current;
    if (curr !== nextTab) {
      setTabHistory((h) => [...h.slice(-15), curr]);
      tabRef.current = nextTab;
    }
    setTab(nextTab);
  }, []);

  const handleBackClick = useCallback(() => {
    if (tabHistory.length > 0) {
      const prevTab = tabHistory[tabHistory.length - 1];
      setTabHistory((h) => h.slice(0, -1));
      tabRef.current = prevTab;
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
  const [routineAuditOpen, setRoutineAuditOpen] = useState(false);
  const [productionStatus, setProductionStatus] = useState<ProductionModeStatusData | null>(null);
  const [productionLoading, setProductionLoading] = useState(false);
  const [productionModalOpen, setProductionModalOpen] = useState(false);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
  }, []);

  const loadProductionStatus = useCallback(async () => {
    if (!isAdmin) return;
    setProductionLoading(true);
    try {
      const data = await apiFetch<ProductionModeStatusData>('/api/admin/production-mode/status');
      setProductionStatus(data);
    } catch {
      // ignore non-fatal status read error
    } finally {
      setProductionLoading(false);
    }
  }, [isAdmin]);

  const loadAll = useCallback(async () => {
    if (!fullConfigAllowed) {
      if (unitsFallback && unitsFallback.length > 0) {
        setUnits(unitsFallback);
      }
      return;
    }

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
  }, [fullConfigAllowed, unitsFallback]);

  useEffect(() => {
    loadAll();
    loadProductionStatus();
  }, [loadAll, loadProductionStatus, wsTick]);

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
    try {
      const token = getAuthToken();
      const res = await fetch(`/api/export?table=${encodeURIComponent(exportTable)}`, {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          'x-unit-id': String(getActiveUnitHeader()),
        },
      });
      if (!res.ok) {
        const rawText = await res.text();
        let errMsg = `Falha na exportação (${res.status}).`;
        try {
          const parsed = JSON.parse(rawText) as { error?: string };
          if (parsed?.error) errMsg = parsed.error;
        } catch {
          // keep default message
        }
        showToast(errMsg);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `financepro_${exportTable}.csv`;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
      showToast(`Exportação operacional (${exportTable}) concluída e auditada.`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erro ao exportar dados.');
    }
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

  const tabs: Array<{ id: ConfigTab; label: string; icon: React.FC<{ className?: string }> }> =
    fullConfigAllowed
      ? [
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
          { id: 'import', label: 'Modelos & Importação Excel', icon: FileSpreadsheet },
          ...(unitFilesAllowed ? [{ id: 'unit_files' as ConfigTab, label: 'Arquivos da Unidade', icon: FolderOpen }] : []),
          ...(isAdmin ? [{ id: 'r2_migration' as ConfigTab, label: 'Migração R2 (64 GB)', icon: CloudUpload }] : []),
          ...(isAdmin ? [{ id: 'backup_restore' as ConfigTab, label: 'Backup & Restore (Google Drive)', icon: HardDrive }] : []),
          ...(isAdmin ? [{ id: 'sql' as ConfigTab, label: 'Console SQL Admin', icon: Database }] : []),
        ]
      : unitFilesAllowed
      ? [{ id: 'unit_files' as ConfigTab, label: 'Arquivos da Unidade', icon: FolderOpen }]
      : [];

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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 pb-4 dark:border-slate-700">
        <div>
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            {fullConfigAllowed
              ? 'Governança Corporativa · Unidades & Custos · Canais Multi-Grupo UaZapi & GoTalk · RBAC · Arquivos da Unidade'
              : 'Governança Corporativa · Repositório Geral & Subpastas Autorizadas por Unidade'}
          </p>
          <h1 className="mt-1 font-display text-2xl font-bold text-slate-900 dark:text-slate-100">
            {fullConfigAllowed ? 'Configurações Corporativas & Segurança' : 'Arquivos da Unidade'}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2 self-start sm:self-center shrink-0">
          {isAdmin && (
            <button
              type="button"
              onClick={() => {
                loadProductionStatus();
                setProductionModalOpen(true);
              }}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold shadow-xs min-h-[38px] ${
                productionStatus?.locked
                  ? 'border border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 dark:border-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                  : 'bg-rose-600 text-white hover:bg-rose-700'
              }`}
            >
              {productionStatus?.locked ? (
                <Lock className="w-3.5 h-3.5" />
              ) : (
                <ShieldAlert className="w-3.5 h-3.5" />
              )}
              <span>
                {productionStatus?.locked
                  ? 'Modo Produção Ativo (Travado)'
                  : 'Limpar Dados Fictícios / Modo Produção'}
              </span>
            </button>
          )}
          {isAdmin && (
            <button
              type="button"
              onClick={() => {
                switchTab('import');
                setTimeout(() => {
                  document.getElementById('ivi-folha-rosto-500mb-card')?.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start',
                  });
                }, 80);
              }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800 shadow-xs min-h-[38px]"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Ivi · Importar PDF Folhas de Rosto (500 MB)</span>
            </button>
          )}
          {fullConfigAllowed && (
            <button
              type="button"
              onClick={() => setRoutineAuditOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 min-h-[38px]"
            >
              <History className="w-3.5 h-3.5" />
              <span>Auditoria</span>
            </button>
          )}
          {(tabHistory.length > 0 || onGoBack) && (
            <button
              type="button"
              onClick={handleBackClick}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-700 min-h-[38px] shrink-0"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Voltar para a tela anterior</span>
              {tabHistory.length === 0 && previousScreenLabel && (
                <span className="hidden sm:inline text-slate-400 font-normal dark:text-slate-400">({previousScreenLabel})</span>
              )}
            </button>
          )}
        </div>
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
                  ? 'border-slate-900 bg-slate-900 text-white dark:border-emerald-500 dark:bg-emerald-600'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>

      {toast && (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-medium text-emerald-900 dark:border-emerald-800/70 dark:bg-emerald-950/50 dark:text-emerald-300">
          <span>{toast}</span>
          <button
            type="button"
            onClick={() => setToast('')}
            className="text-emerald-700 hover:text-emerald-950 dark:text-emerald-300"
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
          <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
            <div>
              <div className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                Quadro de Horários &amp; Janelas de Acesso Operacional
              </div>
              <p className="text-slate-500 dark:text-slate-400">
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
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 font-semibold text-white hover:bg-slate-800 whitespace-nowrap shrink-0 dark:bg-emerald-600 dark:hover:bg-emerald-500"
              >
                <Plus className="w-3.5 h-3.5" />
                Nova Janela de Horário
              </button>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden dark:border-slate-700 dark:bg-slate-900">
            <div className="overflow-x-auto overflow-y-auto max-h-[55vh] scroll-rulers">
              <table className="w-full min-w-[640px] text-left text-xs">
                <thead className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-300">
                  <tr>
                    <th className="px-4 py-2.5">Descrição / Turno</th>
                    <th className="px-4 py-2.5 whitespace-nowrap">Escopo</th>
                    <th className="px-4 py-2.5 whitespace-nowrap">Horário Permitido</th>
                    <th className="px-4 py-2.5">Dias da Semana</th>
                    <th className="px-4 py-2.5 whitespace-nowrap">Status</th>
                    <th className="px-4 py-2.5 text-right whitespace-nowrap">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {schedules.map((s) => (
                    <tr key={s.id} className="hover:bg-slate-50/80">
                      <td className="px-4 py-2.5 font-semibold text-slate-900 dark:text-slate-100">{s.targetLabel}</td>
                      <td className="px-4 py-2.5 uppercase text-[11px] text-slate-600 dark:text-slate-300">{s.targetType}</td>
                      <td className="px-4 py-2.5 font-mono font-semibold text-slate-900 tabular-nums dark:text-slate-100">
                        {s.startTime} às {s.endTime}
                      </td>
                      <td className="px-4 py-2.5 text-slate-600 dark:text-slate-300">
                        {(s.allowedDays || []).map((d) => dayNames[d] || d).join(' · ')}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={s.active ? 'font-semibold text-emerald-700 dark:text-emerald-300' : 'text-slate-400 dark:text-slate-400'}>
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
                              className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleteSchedId(s.id)}
                              className="rounded-md p-1.5 text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/60"
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
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 dark:bg-slate-950/80">
              <form
                onSubmit={handleSaveSchedule}
                className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl space-y-4 text-xs dark:border-slate-700 dark:bg-slate-900"
              >
                <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
                  <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                    {editSchedId ? 'Editar Regra de Horário' : 'Nova Regra de Horário'}
                  </h3>
                  <button
                    type="button"
                    onClick={() => setSchedModalOpen(false)}
                    className="text-slate-400 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Alvo</label>
                    <select
                      value={schedTargetType}
                      onChange={(e) => setSchedTargetType(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    >
                      <option value="unit">Unidade</option>
                      <option value="group">Grupo RBAC</option>
                      <option value="user">Colaborador</option>
                    </select>
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Descrição *</label>
                    <input
                      type="text"
                      required
                      value={schedTargetLabel}
                      onChange={(e) => setSchedTargetLabel(e.target.value)}
                      placeholder="Ex: Turno Comercial Matriz"
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Início</label>
                      <input
                        type="time"
                        value={schedStart}
                        onChange={(e) => setSchedStart(e.target.value)}
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Fim</label>
                      <input
                        type="time"
                        value={schedEnd}
                        onChange={(e) => setSchedEnd(e.target.value)}
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Dias Liberados</label>
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
                  <label className="flex items-center gap-2 cursor-pointer font-medium text-slate-800 dark:text-slate-100">
                    <input
                      type="checkbox"
                      checked={schedActive}
                      onChange={(e) => setSchedActive(e.target.checked)}
                    />
                    <span>Regra ativa</span>
                  </label>
                </div>

                <div className="flex justify-end gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={() => setSchedModalOpen(false)}
                    className="rounded-lg border border-slate-200 px-3.5 py-2 font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={busy}
                    className="rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white hover:bg-slate-800 dark:bg-emerald-600 dark:hover:bg-emerald-500"
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
          <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-4 dark:border-slate-700 dark:bg-slate-900">
            <div className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
              Campos Dinâmicos por Módulo
            </div>

            {isAdmin && (
              <form onSubmit={handleSaveCustomField} className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <select
                  value={fieldModule}
                  onChange={(e) => setFieldModule(e.target.value)}
                  className="rounded-lg border border-slate-200 px-2.5 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                >
                  <option value="admission">Admissão / Contrato</option>
                  <option value="client">Cadastro do Cliente</option>
                  <option value="legal">Jurídico</option>
                </select>
                <select
                  value={fieldType}
                  onChange={(e) => setFieldType(e.target.value)}
                  className="rounded-lg border border-slate-200 px-2.5 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                >
                  <option value="text">Texto</option>
                  <option value="number">Número</option>
                  <option value="date">Data</option>
                </select>
                <input
                  value={fieldKey}
                  onChange={(e) => setFieldKey(e.target.value)}
                  placeholder="Chave técnica (ex: chassi_extra)"
                  className="rounded-lg border border-slate-200 px-3 py-2 font-mono dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
                <input
                  value={fieldLabel}
                  onChange={(e) => setFieldLabel(e.target.value)}
                  placeholder="Rótulo visível"
                  className="rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
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
                      className="rounded-lg border border-slate-200 px-3 py-1.5 font-semibold text-slate-600 dark:border-slate-700 dark:text-slate-300"
                    >
                      Cancelar Edição
                    </button>
                  )}
                  <button
                    type="submit"
                    disabled={busy}
                    className="rounded-lg bg-slate-900 px-3.5 py-1.5 font-semibold text-white hover:bg-slate-800 dark:bg-emerald-600 dark:hover:bg-emerald-500"
                  >
                    {editFieldId ? 'Atualizar Campo' : 'Adicionar Campo'}
                  </button>
                </div>
              </form>
            )}

            <div className="divide-y divide-slate-100 border-t border-slate-100 pt-2 dark:divide-slate-800 dark:border-slate-800">
              {customFields.map((f) => (
                <div key={f.id} className="py-2.5 flex items-center justify-between gap-2">
                  <div>
                    <div className="font-semibold text-slate-900 dark:text-slate-100">{f.label}</div>
                    <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
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
                        className="rounded p-1.5 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteFieldId(f.id)}
                        className="rounded p-1.5 text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/60"
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
          <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-4 dark:border-slate-700 dark:bg-slate-900">
            <div className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
              Categorias de Pagamento &amp; Recebimento
            </div>

            {isAdmin && (
              <form onSubmit={handleSavePaymentCategory} className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <input
                  value={catName}
                  onChange={(e) => setCatName(e.target.value)}
                  placeholder="Nome da categoria..."
                  className="sm:col-span-2 rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
                <input
                  value={catProvider}
                  onChange={(e) => setCatProvider(e.target.value)}
                  placeholder="Provedor (santander/pix)"
                  className="rounded-lg border border-slate-200 px-3 py-2 font-mono dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
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
                      className="rounded-lg border border-slate-200 px-3 py-1.5 font-semibold text-slate-600 dark:border-slate-700 dark:text-slate-300"
                    >
                      Cancelar
                    </button>
                  )}
                  <button
                    type="submit"
                    disabled={busy}
                    className="rounded-lg bg-slate-900 px-3.5 py-1.5 font-semibold text-white hover:bg-slate-800 dark:bg-emerald-600 dark:hover:bg-emerald-500"
                  >
                    {editCatId ? 'Atualizar Categoria' : 'Adicionar Categoria'}
                  </button>
                </div>
              </form>
            )}

            <div className="divide-y divide-slate-100 border-t border-slate-100 pt-2 dark:divide-slate-800 dark:border-slate-800">
              {paymentCategories.map((c) => (
                <div key={c.id} className="py-2.5 flex items-center justify-between gap-2">
                  <div>
                    <span className="font-semibold text-slate-900 dark:text-slate-100">{c.name}</span>
                    <span className="font-mono text-[11px] text-slate-500 ml-2 dark:text-slate-400">· {c.providerCode}</span>
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
                        className="rounded p-1.5 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setDeleteCatErr('');
                          setDeleteCatId(c.id);
                        }}
                        className="rounded p-1.5 text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/60"
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
        <div className="space-y-4 text-xs">
          {isAdmin && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 dark:border-emerald-800/70 dark:bg-emerald-950/40">
              <div className="space-y-1">
                <div className="flex items-center gap-2 font-display text-sm font-bold text-emerald-900 dark:text-emerald-200">
                  <Sparkles className="w-4 h-4" />
                  Leitura &amp; Importação Ivi de Folhas de Rosto em PDF (até 500 MB)
                </div>
                <p className="text-emerald-800/90 dark:text-emerald-300">
                  Envie arquivos <strong>PDF (.pdf)</strong> de até 500 MB (ou planilhas .xlsx/.csv) para que a Ivi compare com <strong>Folha de Rosto - Veículo</strong> e <strong>Folha de Rosto - Cartão de Crédito</strong> e cadastre Clientes, Titulares, Bancos, Colaboradores e Admissões.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  switchTab('import');
                  setTimeout(() => {
                    document.getElementById('ivi-folha-rosto-500mb-card')?.scrollIntoView({
                      behavior: 'smooth',
                      block: 'start',
                    });
                  }, 80);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-4 py-2 font-semibold text-white hover:bg-emerald-800 whitespace-nowrap shrink-0"
              >
                <Upload className="w-3.5 h-3.5" />
                Abrir Importação PDF Ivi (500 MB)
              </button>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3 dark:border-slate-700 dark:bg-slate-900">
            <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
              Cadeia de Fallback IA — Agente Ivi
            </h3>
            <p className="text-slate-600 dark:text-slate-300">
              Ordem executiva configurada: <strong>Claude Code → OpenAI → Gemini → DeepSeek</strong>. O servidor tenta cada provedor em sequência e armazena o aprendizado na base de conhecimento.
            </p>
            <div className="space-y-2">
              {['claude_code', 'openai', 'gemini', 'deepseek'].map((prov, idx) => (
                <div
                  key={prov}
                  className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-800/70"
                >
                  <span className="font-mono font-bold text-slate-800 dark:text-slate-100">
                    {idx + 1}º · {prov.toUpperCase()}
                  </span>
                  <span
                    className={
                      iviConfig?.configuredProviders?.[prov]
                        ? 'text-emerald-700 font-semibold dark:text-emerald-300'
                        : 'text-amber-700 dark:text-amber-300'
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

          <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3 dark:border-slate-700 dark:bg-slate-900">
            <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
              Parâmetros da Régua de Cobrança Ivi &amp; Escavador
            </h3>
            <pre className="rounded-lg bg-slate-900 text-slate-100 p-3 font-mono text-[11px] overflow-x-auto max-h-64 dark:bg-slate-950 dark:border-slate-700">
              {JSON.stringify(settings, null, 2)}
            </pre>
          </div>
          </div>
        </div>
      )}

      {/* 11. HUB SIMÉTRICO DE MODELOS EXCEL & IMPORTAÇÃO POR PRECEDÊNCIA */}
      {tab === 'import' && (
        <ConfigDataHubView
          onToast={showToast}
          onDataImported={async () => {
            await loadAll();
            onUnitsUpdated();
          }}
          legacyCsvSection={
            <div className="space-y-4">
              <div className="space-y-3 text-xs">
                <div className="font-bold text-slate-900 dark:text-slate-100">
                  Importação em Lote CSV com Pré-Validação &amp; Desambiguação
                </div>
                <p className="text-slate-500 dark:text-slate-400">
                  Formato CSV (;): Nome Completo;CPF/CNPJ;Telefone;Email;Cidade;UF;Unidade. Execute a pré-validação antes de gravar no Cloud SQL.
                </p>
                <textarea
                  rows={5}
                  value={importCsvText}
                  onChange={(e) => setImportCsvText(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-xs dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-100"
                />
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handlePreviewImport}
                    className="rounded-lg border border-slate-300 bg-white px-4 py-2 font-semibold text-slate-800 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
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
                  <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2 dark:border-slate-700 dark:bg-slate-800/70">
                    <div className="font-semibold text-slate-800 dark:text-slate-100">
                      Pré-validação: {importPreview.validCount} válida(s) · {importPreview.conflictCount} conflito(s)/aviso(s)
                    </div>
                    {importPreview.rows.map((r) => (
                      <div
                        key={r.rowNumber}
                        className="flex flex-wrap items-center justify-between gap-2 bg-white rounded border border-slate-100 px-3 py-2 dark:bg-slate-900 dark:border-slate-800"
                      >
                        <span className="font-mono">
                          Linha #{r.rowNumber}: {r.fullName} ({r.cpfCnpj})
                        </span>
                        <span
                          className={r.valid ? 'text-emerald-700 font-semibold dark:text-emerald-300' : 'text-amber-700 font-semibold dark:text-amber-300'}
                        >
                          {r.valid ? `OK (Unidade #${r.resolvedUnitId})` : r.issues.join(' | ')}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="border-t border-slate-100 pt-4 space-y-3 text-xs dark:border-slate-800">
                <div className="font-bold text-slate-900 dark:text-slate-100">
                  Exportação Operacional Parcial CSV
                </div>
                <div className="flex flex-wrap gap-2">
                  <select
                    value={exportTable}
                    onChange={(e) => setExportTable(e.target.value)}
                    className="rounded-lg border border-slate-200 px-3 py-2 font-semibold text-slate-800 dark:border-slate-700 dark:text-slate-100 dark:bg-slate-950"
                  >
                    <option value="clients">Clientes (Unidade Ativa)</option>
                    <option value="admissions">Admissões / Contratos</option>
                    <option value="financial_titles">Títulos Financeiros</option>
                    <option value="legal_processes">Processos Jurídicos</option>
                  </select>
                  <button
                    type="button"
                    onClick={handleExportScoped}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white hover:bg-slate-800 dark:bg-emerald-600 dark:hover:bg-emerald-500"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Exportar CSV (UTF-8 Excel)
                  </button>
                </div>
              </div>
            </div>
          }
        />
      )}

      {/* 11A. ARQUIVOS DA UNIDADE & PERMISSÕES GRANULARES */}
      {tab === 'unit_files' && unitFilesAllowed && (
        <ConfigUnitFilesView
          currentUser={currentUser}
          units={units.length > 0 ? units : unitsFallback || []}
          groups={groups}
          usersList={usersList}
          wsTick={wsTick}
          onToast={showToast}
          onNavigate={onNavigate}
        />
      )}

      {/* 11B. MIGRAÇÃO R2 (64 GB) & CÓDIGO SEGURO INTEGRATIVO */}
      {tab === 'r2_migration' && isAdmin && (
        <ConfigR2MigrationView wsTick={wsTick} onToast={showToast} />
      )}

      {/* 11C. BACKUP & RESTORE COMPLETO (CLOUD / GOOGLE DRIVE + AGENDAMENTO AUTOMÁTICO) */}
      {tab === 'backup_restore' && isAdmin && (
        <ConfigBackupRestoreView
          wsTick={wsTick}
          onToast={showToast}
          onDatabaseRestored={async () => {
            await loadAll();
            onUnitsUpdated();
          }}
        />
      )}

      {/* 12. ADMIN POSTGRESQL SQL CONSOLE */}
      {tab === 'sql' && isAdmin && (
        <div className="space-y-4">
          <ProductionModeBannerCard
            status={productionStatus}
            loading={productionLoading}
            onRefresh={loadProductionStatus}
            onOpenModal={() => {
              loadProductionStatus();
              setProductionModalOpen(true);
            }}
          />

        <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4 dark:border-slate-700 dark:bg-slate-900">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                Console Interativo PostgreSQL (Cloud SQL Administrador)
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
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
                className="rounded-md border border-slate-200 px-2.5 py-1 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
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
                className="rounded-md border border-slate-200 px-2.5 py-1 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
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
                className="rounded-md border border-slate-200 px-2.5 py-1 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
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
              className="w-full rounded-xl border border-slate-300 bg-slate-900 text-emerald-300 p-3.5 font-mono text-xs focus:outline-none dark:border-slate-600 dark:bg-emerald-600 dark:text-slate-100"
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
            <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-mono text-red-700 dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300">
              {sqlError}
            </div>
          )}

          {sqlResult && (
            <div className="space-y-2">
              <div className="text-[11px] font-mono text-slate-500 tabular-nums dark:text-slate-400">
                {sqlResult.rows.length} linha(s) retornada(s) · {sqlResult.durationMs}ms
              </div>
              <div className="overflow-x-auto overflow-y-auto max-h-[55vh] scroll-rulers rounded-lg border border-slate-200 dark:border-slate-700">
                <table className="w-full text-left text-xs font-mono">
                  <thead className="sticky top-0 z-10 bg-slate-50 text-[11px] text-slate-600 border-b border-slate-200 dark:bg-slate-800/70 dark:text-slate-300 dark:border-slate-700">
                    <tr>
                      {sqlResult.columns.map((col) => (
                        <th key={col} className="px-3 py-2 whitespace-nowrap">
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {sqlResult.rows.map((row, idx) => (
                      <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-800">
                        {sqlResult.columns.map((col) => (
                          <td key={col} className="px-3 py-2 whitespace-nowrap text-slate-800 dark:text-slate-100">
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
        </div>
      )}

      {/* Modal de Limpeza Definitiva / Modo Produção */}
      {isAdmin && (
        <ProductionModeConfirmModal
          open={productionModalOpen}
          status={productionStatus}
          onClose={() => setProductionModalOpen(false)}
          onToast={showToast}
          onActivated={async (nextStatus) => {
            setProductionStatus(nextStatus);
            await loadAll();
            onUnitsUpdated();
          }}
        />
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

      {(() => {
        const configAuditMap: Record<ConfigTab, { entityType: string; title: string }> = {
          units: { entityType: 'units', title: 'Unidades & Custos' },
          uazapi: { entityType: 'unit_whatsapp_credentials,user_groups', title: 'WhatsApp UaZapi & Grupos' },
          gotalk: { entityType: 'gotalk_channels,gotalk_operators,gotalk_hsm_templates', title: 'Canais, Operadores & HSM GoTalk' },
          groups: { entityType: 'user_groups,users,units', title: 'Grupos, Usuários & RBAC' },
          audit_checklist: { entityType: 'audit_checklist_items,modalities', title: 'Checklist & Modalidades' },
          schedules: { entityType: 'access_schedules', title: 'Quadro de Horários' },
          fields_categories: { entityType: 'custom_fields,payment_categories', title: 'Campos Customizados & Categorias' },
          help_center: { entityType: 'help_center_topics', title: 'Central de Ajuda' },
          branding: { entityType: 'system_settings', title: 'Portal & Identidade Visual' },
          ai_regua: { entityType: 'system_settings', title: 'IA Ivi & Régua' },
          import: { entityType: 'clients,admissions,legal_processes', title: 'Importação & Exportação' },
          unit_files: { entityType: 'document_objects,folder_permission_rules', title: 'Arquivos da Unidade' },
          r2_migration: { entityType: 'vault_migration_items,document_objects', title: 'Migração R2' },
          backup_restore: { entityType: 'backup_schedules,backup_executions', title: 'Backup & Restore (Google Drive)' },
          sql: { entityType: 'all', title: 'Auditoria Global & Console SQL' },
        };
        const currentAudit = configAuditMap[tab] || { entityType: 'all', title: 'Configurações Corporativas' };
        return (
          <EntityAuditModal
            open={routineAuditOpen}
            title={`Configurações · ${currentAudit.title}`}
            entityType={currentAudit.entityType}
            entityId="all"
            onClose={() => setRoutineAuditOpen(false)}
          />
        );
      })()}
    </div>
  );
};
