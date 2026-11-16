import React, { useCallback, useEffect, useState } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import {
  ArrowDownCircle,
  ArrowLeft,
  ArrowLeftRight,
  ArrowUpCircle,
  BadgeCheck,
  Banknote,
  BarChart3,
  BellRing,
  BookOpen,
  Bot,
  Briefcase,
  Building2,
  CalendarClock,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  FileBarChart2,
  FileStack,
  FileText,
  FolderKanban,
  FolderTree,
  Hash,
  Landmark,
  Layers,
  LayoutDashboard,
  List,
  LogOut,
  Menu,
  MessageSquare,
  Moon,
  Network,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  PhoneCall,
  Scale,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Store,
  Sun,
  TrendingDown,
  UserCog,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { auth } from './lib/firebase.ts';
import { apiFetch, setActiveUnitHeader, setAuthToken } from './lib/api.ts';
import { setCachedPortalBranding } from './lib/portalBrandingCache.ts';
import { useTheme } from './lib/theme.tsx';
import iviAvatarImg from './assets/images/ivi_avatar_1794682376813.jpg';
import {
  AuthUser,
  HelpCenterTopic,
  ModuleId,
  NavigationIntent,
  PortalBrandingConfig,
  Unit,
  UserGroup,
} from './types.ts';
import { LoginScreen } from './components/LoginScreen.tsx';
import { OfflineIndicator, PWAInstallButton } from './components/PWAControls.tsx';
import { FixedWhatsAppDock } from './components/FixedWhatsAppDock.tsx';
import { GlobalSearchModal } from './components/GlobalSearchModal.tsx';
import { OverviewModule } from './components/modules/OverviewModule.tsx';
import { CadastrosComunsModule, CadastrosSubmenuId } from './components/modules/CadastrosComunsModule.tsx';
import { ProspectionModule } from './components/modules/ProspectionModule.tsx';
import { AppointmentsModule } from './components/modules/AppointmentsModule.tsx';
import { AdmissionVaultModule } from './components/modules/AdmissionVaultModule.tsx';
import { AuditModule } from './components/modules/AuditModule.tsx';
import { LegalModule } from './components/modules/LegalModule.tsx';
import { NegotiationsModule } from './components/modules/NegotiationsModule.tsx';
import { FinanceModule } from './components/modules/FinanceModule.tsx';
import { CollectionModule } from './components/modules/CollectionModule.tsx';
import { FormsModule } from './components/modules/FormsModule.tsx';
import { ReportsModule } from './components/modules/ReportsModule.tsx';
import { ConfigModule } from './components/modules/ConfigModule.tsx';
import { ManagerialDashboardModule } from './components/modules/ManagerialDashboardModule.tsx';
import { CompanyLegalModule } from './components/modules/CompanyLegalModule.tsx';
import { sanitizeHelpHtml } from './components/modules/config/ConfigGovernanceViews.tsx';

interface NavItem {
  id: ModuleId;
  label: string;
  shortLabel: string;
  group: 'entrada' | 'operacao' | 'gestao' | 'analises' | 'governanca';
  icon: React.FC<{ className?: string }>;
}

const CADASTROS_SUBMENUS: Array<{ id: CadastrosSubmenuId; label: string; icon: React.FC<{ className?: string }> }> = [
  { id: 'cad_clientes', label: 'Clientes', icon: Users },
  { id: 'cad_cargos', label: 'Cargos', icon: BadgeCheck },
  { id: 'cad_colaboradores', label: 'Colaboradores', icon: UserCog },
  { id: 'cad_departamentos', label: 'Departamentos', icon: Network },
  { id: 'cad_bancos', label: 'Bancos', icon: Landmark },
  { id: 'cad_modalidades', label: 'Modalidades', icon: Layers },
  { id: 'cad_produtos', label: 'Produtos', icon: Package },
  { id: 'cad_series', label: 'Série/Números', icon: Hash },
];

const COMERCIAL_SUBMENUS: Array<{ id: ModuleId; label: string; icon: React.FC<{ className?: string }> }> = [
  { id: 'prospection', label: 'Prospecção & Agenda', icon: PhoneCall },
  { id: 'admission', label: 'Admissão & Dossiê', icon: FileStack },
];

const FINANCE_CADASTROS_SUBMENUS: Array<{ id: ModuleId; label: string; icon: React.FC<{ className?: string }> }> = [
  { id: 'finance_cad_fornecedores', label: 'Fornecedores', icon: Users },
  { id: 'finance_cad_documentos', label: 'Tipos de Documento', icon: FileText },
  { id: 'finance_cad_portadores', label: 'Portadores', icon: Wallet },
  { id: 'finance_cad_plano_contas', label: 'Plano de Contas', icon: FolderTree },
];

const FINANCE_ALL_SUBMENUS: Array<{ id: ModuleId; label: string }> = [
  { id: 'finance', label: 'Contas a Receber' },
  { id: 'finance_operacao', label: 'Contas a Receber' },
  { id: 'finance_receber', label: 'Contas a Receber' },
  { id: 'finance_regua', label: 'Régua de Cobrança (Ivi)' },
  { id: 'finance_pagar', label: 'Contas a Pagar' },
  { id: 'finance_conta_corrente', label: 'Conta Corrente · Cadastro · Contas Correntes' },
  { id: 'finance_movimento', label: 'Conta Corrente · Cadastro · Movimento' },
  { id: 'finance_conciliacao', label: 'Conta Corrente · Cadastro · Conciliação Bancária' },
  { id: 'finance_cadastros', label: 'Cadastros' },
  ...FINANCE_CADASTROS_SUBMENUS.map((s) => ({ id: s.id, label: `Cadastros · ${s.label}` })),
];

const COLLECTION_SUBMENUS: Array<{ id: ModuleId; label: string; icon: React.FC<{ className?: string }> }> = [
  { id: 'collection_coordenacao', label: 'Coordenação', icon: UserCog },
  { id: 'collection_operacional', label: 'Operacional', icon: Briefcase },
];

const ACOMP_JURIDICO_SUBMENUS: Array<{ id: ModuleId; label: string; icon: React.FC<{ className?: string }> }> = [
  { id: 'jur_dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'jur_processos', label: 'Processos', icon: List },
  { id: 'jur_prazos', label: 'Prazos e Audiências', icon: CalendarClock },
];

const NAV_ITEMS: NavItem[] = [
  { id: 'overview', label: 'Visão Executiva', shortLabel: 'Início', group: 'entrada', icon: LayoutDashboard },
  { id: 'managerial_dashboard', label: 'Dashboard Gerencial', shortLabel: 'Gerencial', group: 'entrada', icon: BarChart3 },
  { id: 'appointments', label: 'Agendamentos', shortLabel: 'Agendas', group: 'entrada', icon: CalendarDays },
  { id: 'audit', label: 'Auditoria & Boletos', shortLabel: 'Auditoria', group: 'operacao', icon: ClipboardCheck },
  { id: 'legal', label: 'Jurídico & Escavador', shortLabel: 'Jurídico', group: 'operacao', icon: Scale },
  { id: 'negotiations', label: 'Negociações Bancárias', shortLabel: 'Negociar', group: 'operacao', icon: TrendingDown },
  { id: 'collection', label: 'Cobrança & Ranking', shortLabel: 'Cobrança', group: 'gestao', icon: Briefcase },
  { id: 'forms', label: 'Formulários', shortLabel: 'Forms', group: 'analises', icon: ClipboardList },
  { id: 'reports', label: 'Relatórios Gerais', shortLabel: 'Relatórios', group: 'analises', icon: FileBarChart2 },
  { id: 'acomp_juridico', label: 'Acompanhamento Jurídico', shortLabel: 'Acomp. Jur.', group: 'governanca', icon: Scale },
  { id: 'config', label: 'Configurações & SQL', shortLabel: 'Config', group: 'governanca', icon: Settings },
];

const NAV_GROUPS: Array<{ key: NavItem['group']; title: string }> = [
  { key: 'entrada', title: 'Entrada & Atendimento' },
  { key: 'operacao', title: 'Operação & Tratativa' },
  { key: 'gestao', title: 'Receita' },
  { key: 'analises', title: 'Formulários & Relatórios' },
  { key: 'governanca', title: 'Governança' },
];

export default function App() {
  const { isDark, toggleTheme, sidebarCollapsed, hasOpenDossierDoc, toggleSidebar } = useTheme();
  const [tokenReady, setTokenReady] = useState(false);
  const [authChecking, setAuthChecking] = useState(true);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [units, setUnits] = useState<Unit[]>([]);
  const [allUnits, setAllUnits] = useState<Unit[]>([]);
  const [activeUnitId, setActiveUnitId] = useState<number>(1);
  const [group, setGroup] = useState<UserGroup | null>(null);
  const [activeModule, setActiveModule] = useState<ModuleId>('overview');
  const [navIntent, setNavIntent] = useState<NavigationIntent | null>(null);
  const [navHistory, setNavHistory] = useState<Array<{ mod: ModuleId; intent: NavigationIntent | null }>>([]);
  const activeModuleRef = React.useRef<ModuleId>('overview');
  const navIntentRef = React.useRef<NavigationIntent | null>(null);
  const navHistoryRef = React.useRef<Array<{ mod: ModuleId; intent: NavigationIntent | null }>>([]);
  const [cadastrosExpanded, setCadastrosExpanded] = useState(false);
  const [comercialExpanded, setComercialExpanded] = useState(false);
  const [adminFinanceExpanded, setAdminFinanceExpanded] = useState(false);
  const [financeCadastrosExpanded, setFinanceCadastrosExpanded] = useState(false);
  const [contaCorrenteExpanded, setContaCorrenteExpanded] = useState(false);
  const [contaCorrenteCadastroExpanded, setContaCorrenteCadastroExpanded] = useState(false);
  const [collectionExpanded, setCollectionExpanded] = useState(false);
  const [acompJuridicoExpanded, setAcompJuridicoExpanded] = useState(false);
  const [cadastrosVersion, setCadastrosVersion] = useState(0);

  // Live Nav Badges (real pending counts from /api/overview)
  const [navCounts, setNavCounts] = useState<Partial<Record<ModuleId, number>>>({});

  // Responsive Drawers, Search & Modals
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [mobileWaOpen, setMobileWaOpen] = useState(false);
  const [desktopWaOpen, setDesktopWaOpen] = useState(false);
  const [waUnreadCount, setWaUnreadCount] = useState(0);
  const [searchModalOpen, setSearchModalOpen] = useState(false);
  const [copiedWhatsappText, setCopiedWhatsappText] = useState('');

  // Mandatory Password Change Modal
  const [newPasswordInput, setNewPasswordInput] = useState('');
  const [passwordChangeErr, setPasswordChangeErr] = useState('');
  const [passwordSaving, setPasswordSaving] = useState(false);

  // Ivi Copilot Quick Modal
  const [iviOpen, setIviOpen] = useState(false);
  const [iviPrompt, setIviPrompt] = useState('');
  const [iviReply, setIviReply] = useState('');
  const [iviProvider, setIviProvider] = useState('');
  const [iviBusy, setIviBusy] = useState(false);

  // Real-time WebSocket Tick & Notification Banner
  const [wsTick, setWsTick] = useState(0);
  const [liveAlert, setLiveAlert] = useState('');

  // Portal Branding & Quick Help Center Modal
  const [portalBranding, setPortalBranding] = useState<PortalBrandingConfig | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpTopics, setHelpTopics] = useState<HelpCenterTopic[]>([]);
  const [helpLoading, setHelpLoading] = useState(false);
  const [helpSearch, setHelpSearch] = useState('');
  const [selectedHelpId, setSelectedHelpId] = useState<number | null>(null);

  useEffect(() => {
    if (hasOpenDossierDoc) {
      setMobileNavOpen(false);
    }
  }, [hasOpenDossierDoc]);

  useEffect(() => {
    fetch('/api/public/portal-branding')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { branding?: PortalBrandingConfig } | null) => {
        if (d?.branding) {
          setPortalBranding(d.branding);
          setCachedPortalBranding(d.branding);
        }
      })
      .catch(() => {});
  }, []);

  const refreshNavCounts = useCallback(async () => {
    try {
      const res = await apiFetch<{
        admissions: Array<{ status: string }>;
        leads: Array<{ stage: string }>;
        appointments?: Array<{ status: string }>;
        processes: Array<{ hasUnreadMovement: boolean }>;
        titles: Array<{ status: string; scope?: string; dueDate?: string }>;
        collectionCases: Array<{ status: string }>;
      }>('/api/overview');
      const todayIso = new Date().toISOString().slice(0, 10);
      const overdueReceberCount = res.titles.filter((t) => {
        if ((t.scope || 'RECEBER') !== 'RECEBER') return false;
        const st = String(t.status || '').toUpperCase();
        if (st === 'CANCELADO' || st === 'PAGO' || st === 'AGRUPADO' || st === 'FATURA_GERADA') return false;
        if (st === 'VENCIDO') return true;
        if (st === 'ABERTO' || st === 'PARCIAL' || st === 'PROTESTADO' || st === 'PROVISAO') {
          return Boolean(t.dueDate && String(t.dueDate).slice(0, 10) < todayIso);
        }
        return false;
      }).length;
      setNavCounts({
        prospection: res.leads.filter((l) => l.stage === 'escalado_humano').length,
        appointments: (res.appointments || []).filter(
          (a) => a.status === 'agendado' || a.status === 'aguardando' || a.status === 'confirmado'
        ).length,
        audit: res.admissions.filter((a) =>
          ['aguardando_auditoria', 'auditada', 'devolvida_admissao', 'retorno_auditoria'].includes(
            a.status
          )
        ).length,
        legal: res.processes.filter((p) => p.hasUnreadMovement).length,
        finance: overdueReceberCount,
        collection: Math.max(
          overdueReceberCount,
          res.collectionCases.filter((c) => c.status === 'em_cobranca').length
        ),
      });
    } catch {
      // ignore background badge refresh failure
    }
  }, []);

  const loadProfile = useCallback(async () => {
    try {
      const me = await apiFetch<{
        user: AuthUser;
        activeUnitId: number;
        units: Unit[];
        allUnits: Unit[];
        group: UserGroup | null;
      }>('/api/auth/me');
      setCurrentUser(me.user);
      setUnits(me.units);
      setAllUnits(me.allUnits);
      setGroup(me.group);
      const initialUnit = me.activeUnitId || me.units[0]?.id || 1;
      setActiveUnitId(initialUnit);
      setActiveUnitHeader(initialUnit);
      setTokenReady(true);
      await refreshNavCounts();
    } catch {
      setAuthToken(null);
      setCurrentUser(null);
      setTokenReady(false);
    } finally {
      setAuthChecking(false);
    }
  }, [refreshNavCounts]);

  useEffect(() => {
    const savedCorpToken = sessionStorage.getItem('fp_corp_token');
    if (savedCorpToken) {
      setAuthToken(savedCorpToken);
      loadProfile();
    } else {
      const unsub = onAuthStateChanged(auth, async (fbUser) => {
        if (fbUser) {
          const idToken = await fbUser.getIdToken();
          setAuthToken(idToken);
          await loadProfile();
        } else {
          setAuthChecking(false);
        }
      });
      return () => unsub();
    }
  }, [loadProfile]);

  useEffect(() => {
    if (tokenReady) {
      refreshNavCounts();
    }
  }, [tokenReady, wsTick, activeUnitId, activeModule, refreshNavCounts]);

  // Ctrl+K Global Search shortcut & Escape for Help Modal
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchModalOpen((prev) => !prev);
      } else if (e.key === 'Escape' && helpOpen) {
        setHelpOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [helpOpen]);

  const openHelpCenter = useCallback(async () => {
    setHelpOpen(true);
    setHelpLoading(true);
    try {
      const res = await apiFetch<{ topics: HelpCenterTopic[] }>('/api/help-center');
      const list = res.topics || [];
      setHelpTopics(list);
      if (list.length > 0) {
        setSelectedHelpId((prev) =>
          prev && list.some((t) => t.id === prev) ? prev : list[0].id
        );
      }
    } catch {
      // ignore load failure
    } finally {
      setHelpLoading(false);
    }
  }, []);

  // WebSocket live connection
  useEffect(() => {
    if (!tokenReady) return;
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    let ws: WebSocket | null = null;
    let disposed = false;
    try {
      ws = new WebSocket(`${proto}//${window.location.host}/ws`);
      ws.onopen = () => {
        if (disposed && ws && ws.readyState === WebSocket.OPEN) {
          ws.close();
        }
      };
      ws.onerror = () => {
        // Silencia erro transitório de WebSocket em ambiente proxy
      };
      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data) as { event: string; payload?: Record<string, unknown> };
          if (msg.event && msg.event !== 'connected') {
            setWsTick((t) => t + 1);
            if (msg.event === 'legal:update') {
              setLiveAlert(`Escavador: Nova movimentação jurídica no processo ${msg.payload?.processNumber || ''}`);
            } else if (msg.event === 'collection:payment') {
              setLiveAlert(`Cobrança: Título liquidado por ${msg.payload?.operator || 'equipe'} (+${msg.payload?.points || 25} pts)`);
            } else if (msg.event === 'internal:message') {
              setLiveAlert(`Nova mensagem interna: ${msg.payload?.subject || 'Comunicado da equipe'}`);
            } else if (msg.event === 'audit:event') {
              setLiveAlert(`Auditoria: Nova ficha ${msg.payload?.protocolCode || ''} aguardando conferência`);
            } else if (msg.event === 'appointments:update') {
              setLiveAlert('Agenda: Horário ou bloqueio atualizado em tempo real');
            }
            setTimeout(() => setLiveAlert(''), 4500);
          }
        } catch {
          // ignore invalid ws payload
        }
      };
    } catch {
      // ignore ws init issues
    }
    return () => {
      disposed = true;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    };
  }, [tokenReady]);

  const expandSidebarGroupsForModule = useCallback((mod: ModuleId) => {
    if (mod.startsWith('cad_')) {
      setCadastrosExpanded(true);
    }
    if (mod === 'prospection' || mod === 'admission') {
      setComercialExpanded(true);
    }
    if (mod === 'finance' || mod.startsWith('finance_')) {
      setAdminFinanceExpanded(true);
    }
    if (mod === 'finance_cadastros' || mod.startsWith('finance_cad_')) {
      setFinanceCadastrosExpanded(true);
    }
    if (
      mod === 'finance_conta_corrente' ||
      mod === 'finance_movimento' ||
      mod === 'finance_conciliacao'
    ) {
      setContaCorrenteExpanded(true);
      setContaCorrenteCadastroExpanded(true);
    }
    if (mod === 'collection' || mod.startsWith('collection_')) {
      setCollectionExpanded(true);
    }
    if (mod === 'acomp_juridico' || mod.startsWith('jur_')) {
      setAcompJuridicoExpanded(true);
    }
  }, []);

  const navigateTo = useCallback(
    (mod: ModuleId, intent?: NavigationIntent) => {
      const prevMod = activeModuleRef.current;
      const prevIntent = navIntentRef.current;
      const nextIntent = intent || null;
      const intentChanged =
        Boolean(nextIntent) && JSON.stringify(prevIntent) !== JSON.stringify(nextIntent);

      if (prevMod !== mod || intentChanged) {
        const nextHistory = [
          ...navHistoryRef.current.slice(-29),
          { mod: prevMod, intent: prevIntent },
        ];
        navHistoryRef.current = nextHistory;
        setNavHistory(nextHistory);
      }

      activeModuleRef.current = mod;
      navIntentRef.current = nextIntent;
      setActiveModule(mod);
      setNavIntent(nextIntent);
      expandSidebarGroupsForModule(mod);
      setMobileNavOpen(false);
    },
    [expandSidebarGroupsForModule]
  );

  const handleGoBack = useCallback(() => {
    const curr = navHistoryRef.current;
    if (curr.length === 0) {
      activeModuleRef.current = 'overview';
      navIntentRef.current = null;
      setActiveModule('overview');
      setNavIntent(null);
      return;
    }
    const target = curr[curr.length - 1];
    const nextStack = curr.slice(0, -1);
    navHistoryRef.current = nextStack;
    activeModuleRef.current = target.mod;
    navIntentRef.current = target.intent;
    setNavHistory(nextStack);
    setActiveModule(target.mod);
    setNavIntent(target.intent);
    expandSidebarGroupsForModule(target.mod);
    setMobileNavOpen(false);
  }, [expandSidebarGroupsForModule]);

  const clearIntent = useCallback(() => {
    navIntentRef.current = null;
    setNavIntent(null);
  }, []);

  const handleAuthenticated = async (token: string) => {
    if (token.startsWith('corp.')) {
      sessionStorage.setItem('fp_corp_token', token);
    }
    setAuthToken(token);
    await loadProfile();
  };

  const handleLogout = async () => {
    sessionStorage.removeItem('fp_corp_token');
    setAuthToken(null);
    setCurrentUser(null);
    setTokenReady(false);
    await signOut(auth).catch(() => {});
  };

  const handleUnitSwitch = (unitId: number) => {
    setActiveUnitId(unitId);
    setActiveUnitHeader(unitId);
    setWsTick((t) => t + 1);
  };

  const handlePasswordChangeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordChangeErr('');
    setPasswordSaving(true);
    try {
      await apiFetch('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ newPassword: newPasswordInput }),
      });
      setNewPasswordInput('');
      await loadProfile();
    } catch (err) {
      setPasswordChangeErr(err instanceof Error ? err.message : 'Erro ao atualizar senha.');
    } finally {
      setPasswordSaving(false);
    }
  };

  const handleAskIvi = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!iviPrompt.trim()) return;
    setIviBusy(true);
    try {
      const res = await apiFetch<{ text: string; provider: string }>('/api/ivi/ask', {
        method: 'POST',
        body: JSON.stringify({ prompt: iviPrompt, context: activeModule }),
      });
      setIviReply(res.text);
      setIviProvider(res.provider);
    } finally {
      setIviBusy(false);
    }
  };

  if (authChecking) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center text-sm font-medium text-slate-600 dark:text-slate-300">
        Validando sessão corporativa FinancePro...
      </div>
    );
  }

  if (!tokenReady || !currentUser) {
    return (
      <>
        <LoginScreen onAuthenticated={handleAuthenticated} branding={portalBranding} />
        <OfflineIndicator />
      </>
    );
  }

  const visibleNavItems = NAV_ITEMS.filter((item) => {
    if (currentUser.role === 'admin') return true;
    if (!group?.modulePermissions) return true;
    return group.modulePermissions[item.id] !== false;
  });

  const visibleCadastrosSubmenus = CADASTROS_SUBMENUS.filter((sub) => {
    if (currentUser.role === 'admin') return true;
    if (!group?.modulePermissions) return true;
    return group.modulePermissions[sub.id] !== false;
  });

  const canViewFinance =
    currentUser.role === 'admin' ||
    !group?.modulePermissions ||
    group.modulePermissions.finance !== false;
  const isFinanceActive = activeModule === 'finance' || activeModule.startsWith('finance_');
  const isFinanceCadActive = activeModule === 'finance_cadastros' || activeModule.startsWith('finance_cad_');
  const isContaCorrenteActive =
    activeModule === 'finance_conta_corrente' ||
    activeModule === 'finance_movimento' ||
    activeModule === 'finance_conciliacao';

  const visibleAcompJuridicoSubmenus = ACOMP_JURIDICO_SUBMENUS.filter((sub) => {
    if (currentUser.role === 'admin') return true;
    if (!group?.modulePermissions) return true;
    if (group.modulePermissions.acomp_juridico === false) return false;
    return group.modulePermissions[sub.id] !== false;
  });

  const isCollectionActive = activeModule === 'collection' || activeModule.startsWith('collection_');
  const isAcompJuridicoActive = activeModule === 'acomp_juridico' || activeModule.startsWith('jur_');
  const selectableUnits = units.length > 0 ? units : allUnits;
  const cadastrosAnchorId: ModuleId = visibleNavItems.some((i) => i.id === 'appointments')
    ? 'appointments'
    : 'overview';
  const activeCadMeta = CADASTROS_SUBMENUS.find((s) => s.id === activeModule);
  const activeFinanceMeta = FINANCE_ALL_SUBMENUS.find((s) => s.id === activeModule);
  const activeCollectionMeta = COLLECTION_SUBMENUS.find((s) => s.id === activeModule);
  const activeAcompJuridicoMeta = ACOMP_JURIDICO_SUBMENUS.find((s) => s.id === activeModule);
  const activeNavMeta = activeCadMeta
    ? { id: activeCadMeta.id, label: `Cadastros Comuns · ${activeCadMeta.label}` }
    : activeFinanceMeta
    ? { id: activeFinanceMeta.id, label: `Administração Financeira · ${activeFinanceMeta.label}` }
    : activeCollectionMeta
    ? { id: activeCollectionMeta.id, label: `Cobrança & Ranking · ${activeCollectionMeta.label}` }
    : activeAcompJuridicoMeta
    ? { id: activeAcompJuridicoMeta.id, label: `Acompanhamento Jurídico · ${activeAcompJuridicoMeta.label}` }
    : NAV_ITEMS.find((i) => i.id === activeModule);
  const previousModMeta = (() => {
    const prevMod = navHistory.length > 0 ? navHistory[navHistory.length - 1].mod : 'overview';
    const cad = CADASTROS_SUBMENUS.find((s) => s.id === prevMod);
    if (cad) return `Cadastros · ${cad.label}`;
    const com = COMERCIAL_SUBMENUS.find((s) => s.id === prevMod);
    if (com) return `Comercial · ${com.label}`;
    const fin = FINANCE_ALL_SUBMENUS.find((s) => s.id === prevMod);
    if (fin) return `Administração Financeira · ${fin.label}`;
    const col = COLLECTION_SUBMENUS.find((s) => s.id === prevMod);
    if (col) return `Cobrança & Ranking · ${col.label}`;
    const jur = ACOMP_JURIDICO_SUBMENUS.find((s) => s.id === prevMod);
    if (jur) return `Acompanhamento Jurídico · ${jur.label}`;
    return NAV_ITEMS.find((i) => i.id === prevMod)?.label || 'Visão Executiva';
  })();
  const hasDedicatedBackButton =
    activeModule === 'appointments' ||
    activeModule === 'config' ||
    activeModule === 'forms' ||
    activeModule === 'negotiations' ||
    activeModule.startsWith('cad_');

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col">
      {/* Top Bar (56px) */}
      <header className={`sticky top-0 ${hasOpenDossierDoc ? 'z-[75]' : 'z-30'} h-14 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-3 sm:px-5 flex items-center justify-between gap-2`}>
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            type="button"
            onClick={() => setMobileNavOpen(!mobileNavOpen)}
            aria-label="Menu de setores"
            className="lg:hidden p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 min-h-[44px] min-w-[44px] flex items-center justify-center"
          >
            <Menu className="w-5 h-5" />
          </button>

          <button
            type="button"
            onClick={() => navigateTo('overview')}
            className="flex items-center gap-2 min-w-0 text-left"
          >
            {portalBranding?.logoDataUrl ? (
              <img
                src={portalBranding.logoDataUrl}
                alt={portalBranding.companyName || 'FinancePro'}
                referrerPolicy="no-referrer"
                className="h-8 w-8 rounded-lg object-contain bg-slate-900 dark:bg-slate-800 p-1 shrink-0"
              />
            ) : (
              <div className="h-8 w-8 rounded-lg bg-slate-900 dark:bg-emerald-600 text-emerald-400 dark:text-white flex items-center justify-center shrink-0">
                <ShieldCheck className="w-4 h-4" />
              </div>
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-sm font-bold tracking-tight text-slate-900 dark:text-slate-100 font-display truncate">
                <span className="truncate max-w-[160px]">
                  {portalBranding?.companyName?.trim() || 'FinancePro'}
                </span>
                {activeNavMeta && activeModule !== 'overview' && (
                  <>
                    <ChevronRight className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 hidden sm:inline shrink-0" />
                    <span className="hidden sm:inline text-slate-600 dark:text-slate-300 font-semibold truncate">
                      {activeNavMeta.label}
                    </span>
                  </>
                )}
              </div>
              <div className="hidden md:block text-[10px] text-slate-500 dark:text-slate-400 truncate">
                {currentUser.name} · {currentUser.role.toUpperCase()} · {currentUser.points} pts
              </div>
            </div>
          </button>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Global Quick Search Trigger */}
          <button
            type="button"
            onClick={() => setSearchModalOpen(true)}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 sm:px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-white min-h-[38px]"
          >
            <Search className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400 shrink-0" />
            <span className="hidden md:inline">Buscar cliente / CPF / processo...</span>
            <span className="md:hidden">Buscar</span>
            <kbd className="hidden lg:inline-block rounded border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 px-1.5 py-0.5 font-mono text-[10px] text-slate-400 dark:text-slate-300">
              Ctrl+K
            </kbd>
          </button>

          {/* Active Unit Switcher */}
          <div className="hidden sm:flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1 min-h-[38px]">
            <Building2 className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400 shrink-0" />
            <select
              value={activeUnitId}
              onChange={(e) => handleUnitSwitch(Number(e.target.value))}
              aria-label="Unidade ativa"
              className="bg-transparent dark:bg-slate-800 text-xs font-semibold text-slate-800 dark:text-slate-100 focus:outline-none"
            >
              {selectableUnits.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.code} · {u.name}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={openHelpCenter}
            title="Central de Ajuda Corporativa"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-700 whitespace-nowrap min-h-[38px]"
          >
            <BookOpen className="w-3.5 h-3.5 text-slate-600 dark:text-slate-300" />
            <span className="hidden xl:inline">Ajuda</span>
          </button>

          <button
            type="button"
            onClick={() => setIviOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/60 px-2.5 py-1.5 text-xs font-semibold text-blue-800 dark:text-blue-200 hover:bg-blue-100 dark:hover:bg-blue-900/70 whitespace-nowrap min-h-[38px]"
          >
            <img src={iviAvatarImg} alt="Ivi" className="w-5 h-5 rounded-full object-cover border border-blue-300 dark:border-blue-600 shrink-0" />
            <span className="hidden sm:inline">Ivi IA</span>
          </button>

          <PWAInstallButton />

          {/* Dark / White Theme Toggle */}
          <button
            type="button"
            onClick={toggleTheme}
            title={isDark ? 'Alternar para Modo Claro (White)' : 'Alternar para Modo Escuro (Dark)'}
            aria-label={isDark ? 'Alternar para Modo Claro' : 'Alternar para Modo Escuro'}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-700 whitespace-nowrap min-h-[38px] transition-colors"
          >
            {isDark ? (
              <Sun className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            ) : (
              <Moon className="w-3.5 h-3.5 text-slate-600 shrink-0 dark:text-slate-300" />
            )}
            <span className="hidden lg:inline">{isDark ? 'Claro' : 'Escuro'}</span>
          </button>

          {/* WhatsApp Toggle (Desktop & Mobile) */}
          <button
            type="button"
            onClick={() => {
              if (window.innerWidth >= 1280) {
                setDesktopWaOpen((prev) => !prev);
              } else {
                setMobileWaOpen(true);
              }
            }}
            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold whitespace-nowrap min-h-[38px] transition-colors ${
              desktopWaOpen
                ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-950 hover:bg-slate-800 dark:hover:bg-white'
                : 'bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-500'
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">WhatsApp</span>
            {waUnreadCount > 0 && (
              <span className="font-mono text-[11px] font-bold tabular-nums">({waUnreadCount})</span>
            )}
          </button>

          <button
            type="button"
            onClick={handleLogout}
            title="Sair do sistema"
            aria-label="Sair do sistema"
            className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 min-h-[38px] min-w-[38px] flex items-center justify-center"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Live WebSocket Alert Banner */}
      {liveAlert && (
        <div className="bg-slate-900 text-emerald-300 text-xs font-medium px-4 py-2 text-center border-b border-slate-800 dark:bg-emerald-600">
          {liveAlert}
        </div>
      )}

      {/* Main Responsive Workspace */}
      <div className="flex-1 flex min-h-0">
        {/* Desktop Sidebar (10" and 21") — colapsa automaticamente para w-14 ao abrir documento do dossiê */}
        <aside
          className={`hidden lg:flex lg:flex-col shrink-0 bg-white border-r border-slate-200 justify-between sticky top-14 h-[calc(100vh-56px)] dark:bg-slate-900 dark:border-slate-700 transition-all duration-200 ${
            sidebarCollapsed ? 'w-14 px-1.5 py-2.5 items-center' : 'w-64 p-3'
          } ${hasOpenDossierDoc ? 'z-[75]' : 'z-20'}`}
        >
          {sidebarCollapsed ? (
            <>
              <div className="w-full flex flex-col items-center gap-1.5 overflow-y-auto scroll-rulers">
                <button
                  type="button"
                  onClick={toggleSidebar}
                  disabled={hasOpenDossierDoc}
                  title={hasOpenDossierDoc ? 'Menu lateral colapsado durante leitura de documento' : 'Expandir menu lateral'}
                  aria-label="Expandir menu lateral"
                  className="w-10 h-9 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
                >
                  <PanelLeftOpen className="w-4 h-4" />
                </button>
                <div className="w-7 border-t border-slate-200 dark:border-slate-800 my-0.5" />
                {canViewFinance && (
                  <button
                    type="button"
                    onClick={() => navigateTo('finance_receber')}
                    title="Administração Financeira"
                    className={`w-10 h-9 rounded-lg flex items-center justify-center transition-colors ${
                      isFinanceActive
                        ? 'bg-slate-900 text-white dark:bg-emerald-600'
                        : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                    }`}
                  >
                    <Banknote className="w-4 h-4" />
                  </button>
                )}
                {visibleNavItems.map((item) => {
                  const Icon = item.icon;
                  const active =
                    activeModule === item.id ||
                    (item.id === 'collection' && isCollectionActive) ||
                    (item.id === 'acomp_juridico' && isAcompJuridicoActive);
                  return (
                    <React.Fragment key={item.id}>
                      <button
                        type="button"
                        onClick={() => {
                          if (item.id === 'collection') navigateTo('collection_operacional');
                          else if (item.id === 'acomp_juridico') navigateTo('jur_dashboard');
                          else navigateTo(item.id);
                        }}
                        title={item.label}
                        className={`w-10 h-9 rounded-lg flex items-center justify-center transition-colors ${
                          active
                            ? 'bg-slate-900 text-white dark:bg-emerald-600'
                            : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                        }`}
                      >
                        <Icon className="w-4 h-4" />
                      </button>
                      {item.id === cadastrosAnchorId && visibleCadastrosSubmenus.length > 0 && (
                        <button
                          type="button"
                          onClick={() => navigateTo(visibleCadastrosSubmenus[0].id)}
                          title="Cadastros Comuns"
                          className={`w-10 h-9 rounded-lg flex items-center justify-center transition-colors ${
                            activeModule.startsWith('cad_')
                              ? 'bg-slate-900 text-white dark:bg-emerald-600'
                              : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                          }`}
                        >
                          <FolderKanban className="w-4 h-4" />
                        </button>
                      )}
                      {item.id === cadastrosAnchorId && (
                        <button
                          type="button"
                          onClick={() => navigateTo('admission')}
                          title="Comercial (Prospecção & Admissão)"
                          className={`w-10 h-9 rounded-lg flex items-center justify-center transition-colors ${
                            activeModule === 'prospection' || activeModule === 'admission'
                              ? 'bg-slate-900 text-white dark:bg-emerald-600'
                              : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                          }`}
                        >
                          <Store className="w-4 h-4" />
                        </button>
                      )}
                    </React.Fragment>
                  );
                })}
              </div>
              <div className="pt-2 border-t border-slate-200 dark:border-slate-700">
                <button
                  type="button"
                  onClick={handleLogout}
                  title="Sair"
                  aria-label="Sair"
                  className="w-10 h-9 rounded-lg flex items-center justify-center text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/60"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center justify-between px-2 pb-2 mb-1 border-b border-slate-100 dark:border-slate-800">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  Navegação
                </span>
                <button
                  type="button"
                  onClick={toggleSidebar}
                  title="Colapsar menu lateral"
                  aria-label="Colapsar menu lateral"
                  className="p-1 rounded-md text-slate-400 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-white dark:hover:bg-slate-800"
                >
                  <PanelLeftClose className="w-3.5 h-3.5" />
                </button>
              </div>
              <nav className="flex-1 space-y-4 overflow-y-auto overflow-x-auto scroll-rulers pr-0.5">
                {NAV_GROUPS.map((grp) => {
                  const items = visibleNavItems.filter((i) => i.group === grp.key);
                  const showFinanceBlock = grp.key === 'gestao' && canViewFinance;
                  if (items.length === 0 && !showFinanceBlock) return null;
                  const financePendingCount = navCounts.finance || 0;
                  return (
                    <div key={grp.key} className="space-y-1">
                      <div className="px-3 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-400">
                        {grp.title}
                      </div>

                  {/* Administração Financeira (no grupo Receita) */}
                  {showFinanceBlock && (
                    <div className="space-y-0.5">
                      <button
                        type="button"
                        aria-expanded={adminFinanceExpanded}
                        onClick={() => setAdminFinanceExpanded((prev) => !prev)}
                        className={`w-full flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition-colors text-left ${
                          isFinanceActive && !adminFinanceExpanded
                            ? 'bg-slate-900 text-white dark:bg-emerald-600'
                            : isFinanceActive
                            ? 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100'
                            : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800'
                        }`}
                      >
                        <span className="flex items-center gap-2.5 min-w-0">
                          <Banknote
                            className={`w-4 h-4 shrink-0 ${
                              isFinanceActive && !adminFinanceExpanded
                                ? 'text-emerald-400 dark:text-white'
                                : isFinanceActive
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : 'text-slate-500 dark:text-slate-400'
                            }`}
                          />
                          <span className="truncate">Administração Financeira</span>
                        </span>
                        <span className="flex items-center gap-1.5 shrink-0">
                          {!adminFinanceExpanded && financePendingCount > 0 && (
                            <span
                              className={`font-mono text-[11px] font-bold tabular-nums ${
                                isFinanceActive ? 'text-emerald-300 dark:text-white' : 'text-amber-700 dark:text-amber-300'
                              }`}
                            >
                              {financePendingCount}
                            </span>
                          )}
                          {adminFinanceExpanded ? (
                            <ChevronDown className="w-3.5 h-3.5 text-slate-400 dark:text-slate-400" />
                          ) : (
                            <ChevronRight className="w-3.5 h-3.5 text-slate-400 dark:text-slate-400" />
                          )}
                        </span>
                      </button>

                      {adminFinanceExpanded && (
                        <div className="ml-4 pl-2.5 border-l border-slate-200 space-y-0.5 py-0.5 dark:border-slate-700">
                          {/* Subopção 1: Cadastros e suas opções */}
                          <div className="space-y-0.5">
                            <button
                              type="button"
                              aria-expanded={financeCadastrosExpanded}
                              onClick={() => setFinanceCadastrosExpanded((prev) => !prev)}
                              className={`w-full flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition-colors text-left ${
                                isFinanceCadActive && !financeCadastrosExpanded
                                  ? 'bg-slate-900 text-white dark:bg-emerald-600'
                                  : isFinanceCadActive
                                  ? 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100'
                                  : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 dark:hover:text-white'
                              }`}
                            >
                              <span className="flex items-center gap-2 min-w-0">
                                <FolderKanban
                                  className={`w-3.5 h-3.5 shrink-0 ${
                                    isFinanceCadActive ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400'
                                  }`}
                                />
                                <span className="truncate">Cadastros</span>
                              </span>
                              {financeCadastrosExpanded ? (
                                <ChevronDown className="w-3.5 h-3.5 shrink-0 text-slate-400 dark:text-slate-400" />
                              ) : (
                                <ChevronRight className="w-3.5 h-3.5 shrink-0 text-slate-400 dark:text-slate-400" />
                              )}
                            </button>

                            {financeCadastrosExpanded && (
                              <div className="ml-3 pl-2.5 border-l border-slate-200 space-y-0.5 py-0.5 dark:border-slate-700">
                                {FINANCE_CADASTROS_SUBMENUS.map((sub) => {
                                  const SubIcon = sub.icon;
                                  const subActive = activeModule === sub.id;
                                  return (
                                    <button
                                      key={sub.id}
                                      type="button"
                                      onClick={() => navigateTo(sub.id)}
                                      className={`w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-[11px] font-semibold transition-colors text-left ${
                                        subActive
                                          ? 'bg-slate-900 text-white dark:bg-emerald-600'
                                          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white'
                                      }`}
                                    >
                                      <SubIcon
                                        className={`w-3 h-3 shrink-0 ${
                                          subActive ? 'text-emerald-400 dark:text-white' : 'text-slate-400 dark:text-slate-400'
                                        }`}
                                      />
                                      <span className="truncate">{sub.label}</span>
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>

                          {/* Subopção 2: Conta Corrente -> Cadastro -> Contas Correntes / Movimento / Conciliação Bancária */}
                          <div className="space-y-0.5">
                            <button
                              type="button"
                              aria-expanded={contaCorrenteExpanded}
                              onClick={() => setContaCorrenteExpanded((prev) => !prev)}
                              className={`w-full flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition-colors text-left ${
                                isContaCorrenteActive && !contaCorrenteExpanded
                                  ? 'bg-slate-900 text-white dark:bg-emerald-600'
                                  : isContaCorrenteActive
                                  ? 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100'
                                  : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 dark:hover:text-white'
                              }`}
                            >
                              <span className="flex items-center gap-2 min-w-0">
                                <Landmark
                                  className={`w-3.5 h-3.5 shrink-0 ${
                                    isContaCorrenteActive && !contaCorrenteExpanded
                                      ? 'text-emerald-400 dark:text-white'
                                      : isContaCorrenteActive
                                      ? 'text-emerald-600 dark:text-emerald-400'
                                      : 'text-slate-500 dark:text-slate-400'
                                  }`}
                                />
                                <span className="truncate">Conta Corrente</span>
                              </span>
                              {contaCorrenteExpanded ? (
                                <ChevronDown className="w-3.5 h-3.5 shrink-0 text-slate-400 dark:text-slate-400" />
                              ) : (
                                <ChevronRight className="w-3.5 h-3.5 shrink-0 text-slate-400 dark:text-slate-400" />
                              )}
                            </button>

                            {contaCorrenteExpanded && (
                              <div className="ml-3 pl-2.5 border-l border-slate-200 space-y-0.5 py-0.5 dark:border-slate-700">
                                <button
                                  type="button"
                                  aria-expanded={contaCorrenteCadastroExpanded}
                                  onClick={() => setContaCorrenteCadastroExpanded((prev) => !prev)}
                                  className={`w-full flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-[11px] font-semibold transition-colors text-left ${
                                    isContaCorrenteActive && !contaCorrenteCadastroExpanded
                                      ? 'bg-slate-900 text-white dark:bg-emerald-600'
                                      : isContaCorrenteActive
                                      ? 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100'
                                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white'
                                  }`}
                                >
                                  <span className="flex items-center gap-2 min-w-0">
                                    <FolderKanban
                                      className={`w-3 h-3 shrink-0 ${
                                        isContaCorrenteActive ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400 dark:text-slate-400'
                                      }`}
                                    />
                                    <span className="truncate">Cadastro</span>
                                  </span>
                                  {contaCorrenteCadastroExpanded ? (
                                    <ChevronDown className="w-3 h-3 shrink-0 text-slate-400 dark:text-slate-400" />
                                  ) : (
                                    <ChevronRight className="w-3 h-3 shrink-0 text-slate-400 dark:text-slate-400" />
                                  )}
                                </button>

                                {contaCorrenteCadastroExpanded && (
                                  <div className="ml-3 pl-2 border-l border-slate-200 space-y-0.5 py-0.5 dark:border-slate-700">
                                    <button
                                      type="button"
                                      onClick={() => navigateTo('finance_conta_corrente')}
                                      className={`w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-[11px] font-semibold transition-colors text-left ${
                                        activeModule === 'finance_conta_corrente'
                                          ? 'bg-slate-900 text-white dark:bg-emerald-600'
                                          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white'
                                      }`}
                                    >
                                      <Landmark
                                        className={`w-3 h-3 shrink-0 ${
                                          activeModule === 'finance_conta_corrente' ? 'text-emerald-400 dark:text-white' : 'text-slate-400 dark:text-slate-400'
                                        }`}
                                      />
                                      <span className="truncate">Contas Correntes</span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => navigateTo('finance_movimento')}
                                      className={`w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-[11px] font-semibold transition-colors text-left ${
                                        activeModule === 'finance_movimento'
                                          ? 'bg-slate-900 text-white dark:bg-emerald-600'
                                          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white'
                                      }`}
                                    >
                                      <ArrowLeftRight
                                        className={`w-3 h-3 shrink-0 ${
                                          activeModule === 'finance_movimento' ? 'text-emerald-400 dark:text-white' : 'text-slate-400 dark:text-slate-400'
                                        }`}
                                      />
                                      <span className="truncate">Movimento</span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => navigateTo('finance_conciliacao')}
                                      className={`w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-[11px] font-semibold transition-colors text-left ${
                                        activeModule === 'finance_conciliacao'
                                          ? 'bg-slate-900 text-white dark:bg-emerald-600'
                                          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white'
                                      }`}
                                    >
                                      <Scale
                                        className={`w-3 h-3 shrink-0 ${
                                          activeModule === 'finance_conciliacao' ? 'text-emerald-400 dark:text-white' : 'text-slate-400 dark:text-slate-400'
                                        }`}
                                      />
                                      <span className="truncate">Conciliação Bancária</span>
                                    </button>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>

                          {/* Subopção 3: Contas a Receber */}
                          <button
                            type="button"
                            onClick={() => navigateTo('finance_receber')}
                            className={`w-full flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition-colors text-left ${
                              activeModule === 'finance_receber' || activeModule === 'finance' || activeModule === 'finance_operacao'
                                ? 'bg-slate-900 text-white dark:bg-emerald-600'
                                : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 dark:hover:text-white'
                            }`}
                          >
                            <span className="flex items-center gap-2 min-w-0">
                              <ArrowDownCircle
                                className={`w-3.5 h-3.5 shrink-0 ${
                                  activeModule === 'finance_receber' || activeModule === 'finance' || activeModule === 'finance_operacao'
                                    ? 'text-emerald-400 dark:text-white'
                                    : 'text-emerald-600 dark:text-emerald-400'
                                }`}
                              />
                              <span className="truncate">Contas a Receber</span>
                            </span>
                            {financePendingCount > 0 && (
                              <span
                                className={`font-mono text-[10px] font-bold tabular-nums shrink-0 ${
                                  activeModule === 'finance_receber' || activeModule === 'finance' || activeModule === 'finance_operacao'
                                    ? 'text-emerald-300 dark:text-white'
                                    : 'text-amber-700 dark:text-amber-300'
                                }`}
                              >
                                {financePendingCount}
                              </span>
                            )}
                          </button>

                          {/* Subopção 4: Régua de Cobrança Ivi (Separada) */}
                          <button
                            type="button"
                            onClick={() => navigateTo('finance_regua')}
                            className={`w-full flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition-colors text-left ${
                              activeModule === 'finance_regua'
                                ? 'bg-slate-900 text-white dark:bg-emerald-600'
                                : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 dark:hover:text-white'
                            }`}
                          >
                            <BellRing
                              className={`w-3.5 h-3.5 shrink-0 ${
                                activeModule === 'finance_regua' ? 'text-emerald-400 dark:text-white' : 'text-blue-600 dark:text-blue-400'
                              }`}
                            />
                            <span className="truncate">Régua de Cobrança (Ivi)</span>
                          </button>

                          {/* Subopção 5: Contas a Pagar */}
                          <button
                            type="button"
                            onClick={() => navigateTo('finance_pagar')}
                            className={`w-full flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition-colors text-left ${
                              activeModule === 'finance_pagar'
                                ? 'bg-slate-900 text-white dark:bg-emerald-600'
                                : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 dark:hover:text-white'
                            }`}
                          >
                            <ArrowUpCircle
                              className={`w-3.5 h-3.5 shrink-0 ${
                                activeModule === 'finance_pagar' ? 'text-emerald-400 dark:text-white' : 'text-rose-600 dark:text-rose-400'
                              }`}
                            />
                            <span className="truncate">Contas a Pagar</span>
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {items.map((item) => {
                    const Icon = item.icon;
                    const active = activeModule === item.id;
                    const pendingCount = navCounts[item.id] || 0;
                    const isCadActive = activeModule.startsWith('cad_');

                    if (item.id === 'collection') {
                      return (
                        <div key={item.id} className="space-y-0.5">
                          <button
                            type="button"
                            aria-expanded={collectionExpanded}
                            onClick={() => setCollectionExpanded((prev) => !prev)}
                            className={`w-full flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition-colors text-left ${
                              isCollectionActive && !collectionExpanded
                                ? 'bg-slate-900 text-white dark:bg-emerald-600'
                                : isCollectionActive
                                ? 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100'
                                : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800'
                            }`}
                          >
                            <span className="flex items-center gap-2.5 min-w-0">
                              <Icon
                                className={`w-4 h-4 shrink-0 ${
                                  isCollectionActive && !collectionExpanded
                                    ? 'text-emerald-400 dark:text-white'
                                    : isCollectionActive
                                    ? 'text-emerald-600 dark:text-emerald-400'
                                    : 'text-slate-500 dark:text-slate-400'
                                }`}
                              />
                              <span className="truncate">{item.label}</span>
                            </span>
                            <span className="flex items-center gap-1.5 shrink-0">
                              {!collectionExpanded && pendingCount > 0 && (
                                <span
                                  className={`font-mono text-[11px] font-bold tabular-nums ${
                                    isCollectionActive ? 'text-emerald-300 dark:text-white' : 'text-amber-700 dark:text-amber-300'
                                  }`}
                                >
                                  {pendingCount}
                                </span>
                              )}
                              {collectionExpanded ? (
                                <ChevronDown className="w-3.5 h-3.5 text-slate-400 dark:text-slate-400" />
                              ) : (
                                <ChevronRight className="w-3.5 h-3.5 text-slate-400 dark:text-slate-400" />
                              )}
                            </span>
                          </button>

                          {collectionExpanded && (
                            <div className="ml-4 pl-2.5 border-l border-slate-200 space-y-0.5 py-0.5 dark:border-slate-700">
                              {COLLECTION_SUBMENUS.map((sub) => {
                                const SubIcon = sub.icon;
                                const subActive =
                                  activeModule === sub.id ||
                                  (activeModule === 'collection' && sub.id === 'collection_operacional');
                                return (
                                  <button
                                    key={sub.id}
                                    type="button"
                                    onClick={() => navigateTo(sub.id)}
                                    className={`w-full flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition-colors text-left ${
                                      subActive
                                        ? 'bg-slate-900 text-white dark:bg-emerald-600'
                                        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white'
                                    }`}
                                  >
                                    <SubIcon
                                      className={`w-3.5 h-3.5 shrink-0 ${
                                        subActive ? 'text-emerald-400 dark:text-white' : 'text-slate-400 dark:text-slate-400'
                                      }`}
                                    />
                                    <span className="truncate">{sub.label}</span>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    }

                    if (item.id === 'acomp_juridico') {
                      if (visibleAcompJuridicoSubmenus.length === 0) return null;
                      return (
                        <div key={item.id} className="space-y-0.5">
                          <button
                            type="button"
                            aria-expanded={acompJuridicoExpanded}
                            onClick={() => setAcompJuridicoExpanded((prev) => !prev)}
                            className={`w-full flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition-colors text-left ${
                              isAcompJuridicoActive && !acompJuridicoExpanded
                                ? 'bg-slate-900 text-white dark:bg-emerald-600'
                                : isAcompJuridicoActive
                                ? 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100'
                                : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800'
                            }`}
                          >
                            <span className="flex items-center gap-2.5 min-w-0">
                              <Icon
                                className={`w-4 h-4 shrink-0 ${
                                  isAcompJuridicoActive && !acompJuridicoExpanded
                                    ? 'text-emerald-400 dark:text-white'
                                    : isAcompJuridicoActive
                                    ? 'text-emerald-600 dark:text-emerald-400'
                                    : 'text-slate-500 dark:text-slate-400'
                                }`}
                              />
                              <span className="truncate">{item.label}</span>
                            </span>
                            {acompJuridicoExpanded ? (
                              <ChevronDown className="w-3.5 h-3.5 shrink-0 text-slate-400 dark:text-slate-400" />
                            ) : (
                              <ChevronRight className="w-3.5 h-3.5 shrink-0 text-slate-400 dark:text-slate-400" />
                            )}
                          </button>

                          {acompJuridicoExpanded && (
                            <div className="ml-4 pl-2.5 border-l border-slate-200 space-y-0.5 py-0.5 dark:border-slate-700">
                              {visibleAcompJuridicoSubmenus.map((sub) => {
                                const SubIcon = sub.icon;
                                const subActive =
                                  activeModule === sub.id ||
                                  (activeModule === 'acomp_juridico' && sub.id === 'jur_dashboard');
                                return (
                                  <button
                                    key={sub.id}
                                    type="button"
                                    onClick={() => navigateTo(sub.id)}
                                    className={`w-full flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition-colors text-left ${
                                      subActive
                                        ? 'bg-slate-900 text-white dark:bg-emerald-600'
                                        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white'
                                    }`}
                                  >
                                    <SubIcon
                                      className={`w-3.5 h-3.5 shrink-0 ${
                                        subActive ? 'text-emerald-400 dark:text-white' : 'text-slate-400 dark:text-slate-400'
                                      }`}
                                    />
                                    <span className="truncate">{sub.label}</span>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    }

                    return (
                      <React.Fragment key={item.id}>
                        <button
                          type="button"
                          onClick={() => navigateTo(item.id)}
                          className={`w-full flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition-colors text-left ${
                            active
                              ? 'bg-slate-900 text-white dark:bg-emerald-600'
                              : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800'
                          }`}
                        >
                          <span className="flex items-center gap-2.5 min-w-0">
                            <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-emerald-400 dark:text-white' : 'text-slate-500 dark:text-slate-400'}`} />
                            <span className="truncate">{item.label}</span>
                          </span>
                          {pendingCount > 0 && (
                            <span
                              className={`font-mono text-[11px] font-bold tabular-nums shrink-0 ${
                                active ? 'text-emerald-300 dark:text-white' : 'text-amber-700 dark:text-amber-300'
                              }`}
                            >
                              {pendingCount}
                            </span>
                          )}
                        </button>

                        {/* Cadastros Comuns (abaixo de Agendamentos e acima de Comercial) */}
                        {item.id === cadastrosAnchorId && visibleCadastrosSubmenus.length > 0 && (
                          <div className="space-y-0.5">
                            <button
                              type="button"
                              aria-expanded={cadastrosExpanded}
                              onClick={() => setCadastrosExpanded((prev) => !prev)}
                              className={`w-full flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition-colors text-left ${
                                isCadActive && !cadastrosExpanded
                                  ? 'bg-slate-900 text-white dark:bg-emerald-600'
                                  : isCadActive
                                  ? 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100'
                                  : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800'
                              }`}
                            >
                              <span className="flex items-center gap-2.5 min-w-0">
                                <FolderKanban
                                  className={`w-4 h-4 shrink-0 ${
                                    isCadActive ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400'
                                  }`}
                                />
                                <span className="truncate">Cadastros Comuns</span>
                              </span>
                              {cadastrosExpanded ? (
                                <ChevronDown className="w-3.5 h-3.5 shrink-0 text-slate-400 dark:text-slate-400" />
                              ) : (
                                <ChevronRight className="w-3.5 h-3.5 shrink-0 text-slate-400 dark:text-slate-400" />
                              )}
                            </button>

                            {cadastrosExpanded && (
                              <div className="ml-4 pl-2.5 border-l border-slate-200 space-y-0.5 py-0.5 dark:border-slate-700">
                                {visibleCadastrosSubmenus.map((sub) => {
                                  const SubIcon = sub.icon;
                                  const subActive = activeModule === sub.id;
                                  return (
                                    <button
                                      key={sub.id}
                                      type="button"
                                      onClick={() => navigateTo(sub.id)}
                                      className={`w-full flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition-colors text-left ${
                                        subActive
                                          ? 'bg-slate-900 text-white dark:bg-emerald-600'
                                          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white'
                                      }`}
                                    >
                                      <SubIcon
                                        className={`w-3.5 h-3.5 shrink-0 ${
                                          subActive ? 'text-emerald-400 dark:text-white' : 'text-slate-400 dark:text-slate-400'
                                        }`}
                                      />
                                      <span className="truncate">{sub.label}</span>
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        )}
                        {/* Comercial (Prospecção & Agenda e Admissão & Dossiê - abaixo de Cadastros Comuns) */}
                        {item.id === cadastrosAnchorId && (
                          <div className="space-y-0.5 mt-1">
                            <button
                              type="button"
                              aria-expanded={comercialExpanded}
                              onClick={() => setComercialExpanded((prev) => !prev)}
                              className={`w-full flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition-colors text-left ${
                                (activeModule === 'prospection' || activeModule === 'admission') && !comercialExpanded
                                  ? 'bg-slate-900 text-white dark:bg-emerald-600'
                                  : (activeModule === 'prospection' || activeModule === 'admission')
                                  ? 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100'
                                  : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800'
                              }`}
                            >
                              <span className="flex items-center gap-2.5 min-w-0">
                                <Store
                                  className={`w-4 h-4 shrink-0 ${
                                    (activeModule === 'prospection' || activeModule === 'admission') ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400'
                                  }`}
                                />
                                <span className="truncate">Comercial</span>
                              </span>
                              {comercialExpanded ? (
                                <ChevronDown className="w-3.5 h-3.5 shrink-0 text-slate-400 dark:text-slate-400" />
                              ) : (
                                <ChevronRight className="w-3.5 h-3.5 shrink-0 text-slate-400 dark:text-slate-400" />
                              )}
                            </button>

                            {comercialExpanded && (
                              <div className="ml-4 pl-2.5 border-l border-slate-200 space-y-0.5 py-0.5 dark:border-slate-700">
                                {COMERCIAL_SUBMENUS.map((sub) => {
                                  const SubIcon = sub.icon;
                                  const subActive = activeModule === sub.id;
                                  return (
                                    <button
                                      key={sub.id}
                                      type="button"
                                      onClick={() => navigateTo(sub.id)}
                                      className={`w-full flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition-colors text-left ${
                                        subActive
                                          ? 'bg-slate-900 text-white dark:bg-emerald-600'
                                          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white'
                                      }`}
                                    >
                                      <SubIcon
                                        className={`w-3.5 h-3.5 shrink-0 ${
                                          subActive ? 'text-emerald-400 dark:text-white' : 'text-slate-400 dark:text-slate-400'
                                        }`}
                                      />
                                      <span className="truncate">{sub.label}</span>
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        )}
                      </React.Fragment>
                    );
                  })}
                </div>
              );
            })}
          </nav>

          <div className="space-y-2 pt-2 border-t border-slate-200 dark:border-slate-700">
            <button
              type="button"
              onClick={handleLogout}
              className="w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-50 transition-colors text-left dark:text-red-300 dark:hover:bg-red-950/60"
            >
              <LogOut className="w-4 h-4 shrink-0 text-red-600 dark:text-red-400" />
              <span className="truncate">Sair</span>
            </button>
            <div className="pt-1 px-1 text-[11px] text-slate-500 space-y-1 dark:text-slate-400">
              <div className="font-semibold text-slate-700 dark:text-slate-200">Fluxo do Cliente</div>
              <div className="text-[10px] text-slate-500 leading-relaxed dark:text-slate-400">
                Prospecção → Admissão → Auditoria → Jurídico/Negociação → Financeiro
              </div>
            </div>
          </div>
            </>
          )}
        </aside>

        {/* Mobile / Tablet Navigation Drawer (<1024px) */}
        {mobileNavOpen && (
          <div className="lg:hidden fixed inset-0 z-40 flex bg-slate-900/40 backdrop-blur-xs dark:bg-slate-950/80">
            <div className="w-76 max-w-[85vw] bg-white h-full p-4 flex flex-col justify-between shadow-2xl overflow-y-auto overflow-x-auto scroll-rulers dark:bg-slate-900">
              <div>
                <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
                  <span className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">Setores FinancePro</span>
                  <button
                    type="button"
                    onClick={() => setMobileNavOpen(false)}
                    aria-label="Fechar menu"
                    className="p-2 text-slate-500 min-h-[44px] min-w-[44px] flex items-center justify-center dark:text-slate-400"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Mobile Unit Selector */}
                <div className="mt-3 sm:hidden">
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">Unidade Ativa</label>
                  <select
                    value={activeUnitId}
                    onChange={(e) => handleUnitSwitch(Number(e.target.value))}
                    className="w-full rounded-lg border border-slate-200 px-2.5 py-2.5 text-xs font-semibold min-h-[44px] dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  >
                    {selectableUnits.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.code} · {u.name}
                      </option>
                    ))}
                  </select>
                </div>

                <nav className="mt-4 space-y-4">
                  {NAV_GROUPS.map((grp) => {
                    const items = visibleNavItems.filter((i) => i.group === grp.key);
                    const showFinanceBlock = grp.key === 'gestao' && canViewFinance;
                    if (items.length === 0 && !showFinanceBlock) return null;
                    const financePendingCount = navCounts.finance || 0;
                    return (
                      <div key={grp.key} className="space-y-1">
                        <div className="px-3 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-400">
                          {grp.title}
                        </div>

                        {showFinanceBlock && (
                          <div className="space-y-0.5">
                            <button
                              type="button"
                              aria-expanded={adminFinanceExpanded}
                              onClick={() => setAdminFinanceExpanded((prev) => !prev)}
                              className={`w-full flex items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-xs font-semibold min-h-[44px] ${
                                isFinanceActive ? 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100' : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800'
                              }`}
                            >
                              <span className="flex items-center gap-2.5">
                                <Banknote className="w-4 h-4 shrink-0 text-slate-500 dark:text-slate-400" />
                                <span>Administração Financeira</span>
                              </span>
                              <span className="flex items-center gap-1.5">
                                {!adminFinanceExpanded && financePendingCount > 0 && (
                                  <span className="font-mono text-[11px] font-bold text-amber-700 dark:text-amber-300">
                                    {financePendingCount}
                                  </span>
                                )}
                                {adminFinanceExpanded ? (
                                  <ChevronDown className="w-3.5 h-3.5 shrink-0 text-slate-400 dark:text-slate-400" />
                                ) : (
                                  <ChevronRight className="w-3.5 h-3.5 shrink-0 text-slate-400 dark:text-slate-400" />
                                )}
                              </span>
                            </button>

                            {adminFinanceExpanded && (
                              <div className="ml-4 pl-2.5 border-l border-slate-200 space-y-0.5 py-0.5 dark:border-slate-700">
                                <div className="space-y-0.5">
                                  <button
                                    type="button"
                                    aria-expanded={financeCadastrosExpanded}
                                    onClick={() => setFinanceCadastrosExpanded((prev) => !prev)}
                                    className={`w-full flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-xs font-semibold min-h-[40px] ${
                                      isFinanceCadActive ? 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100' : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800'
                                    }`}
                                  >
                                    <span className="flex items-center gap-2">
                                      <FolderKanban className="w-3.5 h-3.5 shrink-0" />
                                      <span>Cadastros</span>
                                    </span>
                                    {financeCadastrosExpanded ? (
                                      <ChevronDown className="w-3.5 h-3.5 shrink-0 text-slate-400 dark:text-slate-400" />
                                    ) : (
                                      <ChevronRight className="w-3.5 h-3.5 shrink-0 text-slate-400 dark:text-slate-400" />
                                    )}
                                  </button>

                                  {financeCadastrosExpanded && (
                                    <div className="ml-3 pl-2.5 border-l border-slate-200 space-y-0.5 py-0.5 dark:border-slate-700">
                                      {FINANCE_CADASTROS_SUBMENUS.map((sub) => {
                                        const SubIcon = sub.icon;
                                        const subActive = activeModule === sub.id;
                                        return (
                                          <button
                                            key={sub.id}
                                            type="button"
                                            onClick={() => navigateTo(sub.id)}
                                            className={`w-full flex items-center gap-2 rounded-lg px-2 py-2 text-xs font-semibold min-h-[38px] ${
                                              subActive ? 'bg-slate-900 text-white dark:bg-emerald-600' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                                            }`}
                                          >
                                            <SubIcon className="w-3.5 h-3.5 shrink-0" />
                                            <span>{sub.label}</span>
                                          </button>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>

                                <div className="space-y-0.5">
                                  <button
                                    type="button"
                                    aria-expanded={contaCorrenteExpanded}
                                    onClick={() => setContaCorrenteExpanded((prev) => !prev)}
                                    className={`w-full flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-xs font-semibold min-h-[40px] ${
                                      isContaCorrenteActive
                                        ? 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100'
                                        : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800'
                                    }`}
                                  >
                                    <span className="flex items-center gap-2">
                                      <Landmark className="w-3.5 h-3.5 shrink-0" />
                                      <span>Conta Corrente</span>
                                    </span>
                                    {contaCorrenteExpanded ? (
                                      <ChevronDown className="w-3.5 h-3.5 shrink-0 text-slate-400 dark:text-slate-400" />
                                    ) : (
                                      <ChevronRight className="w-3.5 h-3.5 shrink-0 text-slate-400 dark:text-slate-400" />
                                    )}
                                  </button>

                                  {contaCorrenteExpanded && (
                                    <div className="ml-3 pl-2.5 border-l border-slate-200 space-y-0.5 py-0.5 dark:border-slate-700">
                                      <button
                                        type="button"
                                        aria-expanded={contaCorrenteCadastroExpanded}
                                        onClick={() => setContaCorrenteCadastroExpanded((prev) => !prev)}
                                        className={`w-full flex items-center justify-between gap-2 rounded-lg px-2 py-2 text-xs font-semibold min-h-[38px] ${
                                          isContaCorrenteActive
                                            ? 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100'
                                            : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                                        }`}
                                      >
                                        <span className="flex items-center gap-2">
                                          <FolderKanban className="w-3.5 h-3.5 shrink-0" />
                                          <span>Cadastro</span>
                                        </span>
                                        {contaCorrenteCadastroExpanded ? (
                                          <ChevronDown className="w-3.5 h-3.5 shrink-0 text-slate-400 dark:text-slate-400" />
                                        ) : (
                                          <ChevronRight className="w-3.5 h-3.5 shrink-0 text-slate-400 dark:text-slate-400" />
                                        )}
                                      </button>

                                      {contaCorrenteCadastroExpanded && (
                                        <div className="ml-3 pl-2 border-l border-slate-200 space-y-0.5 py-0.5 dark:border-slate-700">
                                          <button
                                            type="button"
                                            onClick={() => navigateTo('finance_conta_corrente')}
                                            className={`w-full flex items-center gap-2 rounded-lg px-2 py-2 text-xs font-semibold min-h-[38px] ${
                                              activeModule === 'finance_conta_corrente'
                                                ? 'bg-slate-900 text-white dark:bg-emerald-600'
                                                : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                                            }`}
                                          >
                                            <Landmark className="w-3.5 h-3.5 shrink-0" />
                                            <span>Contas Correntes</span>
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => navigateTo('finance_movimento')}
                                            className={`w-full flex items-center gap-2 rounded-lg px-2 py-2 text-xs font-semibold min-h-[38px] ${
                                              activeModule === 'finance_movimento'
                                                ? 'bg-slate-900 text-white dark:bg-emerald-600'
                                                : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                                            }`}
                                          >
                                            <ArrowLeftRight className="w-3.5 h-3.5 shrink-0" />
                                            <span>Movimento</span>
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => navigateTo('finance_conciliacao')}
                                            className={`w-full flex items-center gap-2 rounded-lg px-2 py-2 text-xs font-semibold min-h-[38px] ${
                                              activeModule === 'finance_conciliacao'
                                                ? 'bg-slate-900 text-white dark:bg-emerald-600'
                                                : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                                            }`}
                                          >
                                            <Scale className="w-3.5 h-3.5 shrink-0" />
                                            <span>Conciliação Bancária</span>
                                          </button>
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>

                                <button
                                  type="button"
                                  onClick={() => navigateTo('finance_receber')}
                                  className={`w-full flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-xs font-semibold min-h-[40px] ${
                                    activeModule === 'finance_receber' || activeModule === 'finance' || activeModule === 'finance_operacao'
                                      ? 'bg-slate-900 text-white dark:bg-emerald-600'
                                      : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800'
                                  }`}
                                >
                                  <span className="flex items-center gap-2">
                                    <ArrowDownCircle className="w-3.5 h-3.5 shrink-0" />
                                    <span>Contas a Receber</span>
                                  </span>
                                  {financePendingCount > 0 && (
                                    <span className={`font-mono text-[11px] font-bold ${
                                      activeModule === 'finance_receber' || activeModule === 'finance' || activeModule === 'finance_operacao'
                                        ? 'text-emerald-300 dark:text-white'
                                        : 'text-amber-700 dark:text-amber-300'
                                    }`}>
                                      {financePendingCount}
                                    </span>
                                  )}
                                </button>

                                <button
                                  type="button"
                                  onClick={() => navigateTo('finance_regua')}
                                  className={`w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-semibold min-h-[40px] ${
                                    activeModule === 'finance_regua'
                                      ? 'bg-slate-900 text-white dark:bg-emerald-600'
                                      : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800'
                                  }`}
                                >
                                  <BellRing className="w-3.5 h-3.5 shrink-0" />
                                  <span>Régua de Cobrança (Ivi)</span>
                                </button>

                                <button
                                  type="button"
                                  onClick={() => navigateTo('finance_pagar')}
                                  className={`w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-semibold min-h-[40px] ${
                                    activeModule === 'finance_pagar'
                                      ? 'bg-slate-900 text-white dark:bg-emerald-600'
                                      : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800'
                                  }`}
                                >
                                  <ArrowUpCircle className="w-3.5 h-3.5 shrink-0" />
                                  <span>Contas a Pagar</span>
                                </button>
                              </div>
                            )}
                          </div>
                        )}

                        {items.map((item) => {
                          const Icon = item.icon;
                          const active = activeModule === item.id;
                          const pendingCount = navCounts[item.id] || 0;
                          const isCadActive = activeModule.startsWith('cad_');

                          if (item.id === 'collection') {
                            return (
                              <div key={item.id} className="space-y-0.5">
                                <button
                                  type="button"
                                  aria-expanded={collectionExpanded}
                                  onClick={() => setCollectionExpanded((prev) => !prev)}
                                  className={`w-full flex items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-xs font-semibold min-h-[44px] ${
                                    isCollectionActive ? 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100' : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800'
                                  }`}
                                >
                                  <span className="flex items-center gap-2.5">
                                    <Icon className="w-4 h-4 shrink-0 text-slate-500 dark:text-slate-400" />
                                    <span>{item.label}</span>
                                  </span>
                                  <span className="flex items-center gap-1.5">
                                    {!collectionExpanded && pendingCount > 0 && (
                                      <span className="font-mono text-[11px] font-bold text-amber-700 dark:text-amber-300">
                                        {pendingCount}
                                      </span>
                                    )}
                                    {collectionExpanded ? (
                                      <ChevronDown className="w-3.5 h-3.5 shrink-0 text-slate-400 dark:text-slate-400" />
                                    ) : (
                                      <ChevronRight className="w-3.5 h-3.5 shrink-0 text-slate-400 dark:text-slate-400" />
                                    )}
                                  </span>
                                </button>
                                {collectionExpanded && (
                                  <div className="ml-4 pl-2.5 border-l border-slate-200 space-y-0.5 py-0.5 dark:border-slate-700">
                                    {COLLECTION_SUBMENUS.map((sub) => {
                                      const SubIcon = sub.icon;
                                      const subActive =
                                        activeModule === sub.id ||
                                        (activeModule === 'collection' && sub.id === 'collection_operacional');
                                      return (
                                        <button
                                          key={sub.id}
                                          type="button"
                                          onClick={() => navigateTo(sub.id)}
                                          className={`w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-semibold min-h-[40px] ${
                                            subActive ? 'bg-slate-900 text-white dark:bg-emerald-600' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                                          }`}
                                        >
                                          <SubIcon className="w-3.5 h-3.5 shrink-0" />
                                          <span>{sub.label}</span>
                                        </button>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          }

                          if (item.id === 'acomp_juridico') {
                            if (visibleAcompJuridicoSubmenus.length === 0) return null;
                            return (
                              <div key={item.id} className="space-y-0.5">
                                <button
                                  type="button"
                                  aria-expanded={acompJuridicoExpanded}
                                  onClick={() => setAcompJuridicoExpanded((prev) => !prev)}
                                  className={`w-full flex items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-xs font-semibold min-h-[44px] ${
                                    isAcompJuridicoActive ? 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100' : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800'
                                  }`}
                                >
                                  <span className="flex items-center gap-2.5">
                                    <Icon className="w-4 h-4 shrink-0 text-slate-500 dark:text-slate-400" />
                                    <span>{item.label}</span>
                                  </span>
                                  {acompJuridicoExpanded ? (
                                    <ChevronDown className="w-3.5 h-3.5 shrink-0 text-slate-400 dark:text-slate-400" />
                                  ) : (
                                    <ChevronRight className="w-3.5 h-3.5 shrink-0 text-slate-400 dark:text-slate-400" />
                                  )}
                                </button>
                                {acompJuridicoExpanded && (
                                  <div className="ml-4 pl-2.5 border-l border-slate-200 space-y-0.5 py-0.5 dark:border-slate-700">
                                    {visibleAcompJuridicoSubmenus.map((sub) => {
                                      const SubIcon = sub.icon;
                                      const subActive =
                                        activeModule === sub.id ||
                                        (activeModule === 'acomp_juridico' && sub.id === 'jur_dashboard');
                                      return (
                                        <button
                                          key={sub.id}
                                          type="button"
                                          onClick={() => navigateTo(sub.id)}
                                          className={`w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-semibold min-h-[40px] ${
                                            subActive ? 'bg-slate-900 text-white dark:bg-emerald-600' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                                          }`}
                                        >
                                          <SubIcon className="w-3.5 h-3.5 shrink-0" />
                                          <span>{sub.label}</span>
                                        </button>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          }

                          return (
                            <React.Fragment key={item.id}>
                              <button
                                type="button"
                                onClick={() => navigateTo(item.id)}
                                className={`w-full flex items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-xs font-semibold min-h-[44px] ${
                                  active ? 'bg-slate-900 text-white dark:bg-emerald-600' : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800'
                                }`}
                              >
                                <span className="flex items-center gap-2.5">
                                  <Icon className="w-4 h-4 shrink-0" />
                                  <span>{item.label}</span>
                                </span>
                                {pendingCount > 0 && (
                                  <span className={`font-mono text-[11px] font-bold ${active ? 'text-emerald-300 dark:text-white' : 'text-amber-700 dark:text-amber-300'}`}>
                                    {pendingCount}
                                  </span>
                                )}
                              </button>

                              {item.id === cadastrosAnchorId && visibleCadastrosSubmenus.length > 0 && (
                                <div className="space-y-0.5">
                                  <button
                                    type="button"
                                    aria-expanded={cadastrosExpanded}
                                    onClick={() => setCadastrosExpanded((prev) => !prev)}
                                    className={`w-full flex items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-xs font-semibold min-h-[44px] ${
                                      isCadActive ? 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100' : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800'
                                    }`}
                                  >
                                    <span className="flex items-center gap-2.5">
                                      <FolderKanban className="w-4 h-4 shrink-0 text-slate-500 dark:text-slate-400" />
                                      <span>Cadastros Comuns</span>
                                    </span>
                                    {cadastrosExpanded ? (
                                      <ChevronDown className="w-3.5 h-3.5 shrink-0 text-slate-400 dark:text-slate-400" />
                                    ) : (
                                      <ChevronRight className="w-3.5 h-3.5 shrink-0 text-slate-400 dark:text-slate-400" />
                                    )}
                                  </button>
                                  {cadastrosExpanded && (
                                    <div className="ml-4 pl-2.5 border-l border-slate-200 space-y-0.5 py-0.5 dark:border-slate-700">
                                      {visibleCadastrosSubmenus.map((sub) => {
                                        const SubIcon = sub.icon;
                                        const subActive = activeModule === sub.id;
                                        return (
                                          <button
                                            key={sub.id}
                                            type="button"
                                            onClick={() => navigateTo(sub.id)}
                                            className={`w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-semibold min-h-[40px] ${
                                              subActive ? 'bg-slate-900 text-white dark:bg-emerald-600' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                                            }`}
                                          >
                                            <SubIcon className="w-3.5 h-3.5 shrink-0" />
                                            <span>{sub.label}</span>
                                          </button>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              )}

                              {item.id === cadastrosAnchorId && (
                                <div className="space-y-0.5 mt-1">
                                  <button
                                    type="button"
                                    aria-expanded={comercialExpanded}
                                    onClick={() => setComercialExpanded((prev) => !prev)}
                                    className={`w-full flex items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-xs font-semibold min-h-[44px] ${
                                      (activeModule === 'prospection' || activeModule === 'admission')
                                        ? 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100'
                                        : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800'
                                    }`}
                                  >
                                    <span className="flex items-center gap-2.5">
                                      <Store className="w-4 h-4 shrink-0 text-slate-500 dark:text-slate-400" />
                                      <span>Comercial</span>
                                    </span>
                                    {comercialExpanded ? (
                                      <ChevronDown className="w-3.5 h-3.5 shrink-0 text-slate-400 dark:text-slate-400" />
                                    ) : (
                                      <ChevronRight className="w-3.5 h-3.5 shrink-0 text-slate-400 dark:text-slate-400" />
                                    )}
                                  </button>
                                  {comercialExpanded && (
                                    <div className="ml-4 pl-2.5 border-l border-slate-200 space-y-0.5 py-0.5 dark:border-slate-700">
                                      {COMERCIAL_SUBMENUS.map((sub) => {
                                        const SubIcon = sub.icon;
                                        const subActive = activeModule === sub.id;
                                        return (
                                          <button
                                            key={sub.id}
                                            type="button"
                                            onClick={() => navigateTo(sub.id)}
                                            className={`w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-semibold min-h-[40px] ${
                                              subActive ? 'bg-slate-900 text-white dark:bg-emerald-600' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                                            }`}
                                          >
                                            <SubIcon className="w-3.5 h-3.5 shrink-0" />
                                            <span>{sub.label}</span>
                                          </button>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              )}
                            </React.Fragment>
                          );
                        })}
                      </div>
                    );
                  })}
                </nav>
              </div>
              <div className="text-[11px] text-slate-500 border-t border-slate-100 pt-3 mt-4 dark:text-slate-400 dark:border-slate-800">
                {currentUser.email}
              </div>
            </div>
            <div className="flex-1" onClick={() => setMobileNavOpen(false)} />
          </div>
        )}

        {/* Active Module Fluid Canvas */}
        <main className="flex-1 min-w-0 p-3 sm:p-5 pb-24 md:pb-8 overflow-y-auto overflow-x-auto scroll-rulers">
          <div className="max-w-7xl mx-auto space-y-3">
            {(navHistory.length > 0 || activeModule !== 'overview') && !hasDedicatedBackButton && (
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={handleGoBack}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-700 min-h-[38px] transition-colors"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Voltar para a tela anterior</span>
                  <span className="hidden sm:inline text-slate-400 dark:text-slate-400 font-normal">({previousModMeta})</span>
                </button>
              </div>
            )}

            {activeModule === 'overview' && (
              <OverviewModule onNavigate={navigateTo} activeUnitId={activeUnitId} />
            )}
            {activeModule === 'managerial_dashboard' && (
              <ManagerialDashboardModule
                units={allUnits}
                activeUnitId={activeUnitId}
                wsTick={wsTick}
                onNavigate={navigateTo}
              />
            )}
            {activeModule.startsWith('cad_') && (
              <CadastrosComunsModule
                activeSubmenu={activeModule as CadastrosSubmenuId}
                units={allUnits}
                activeUnitId={activeUnitId}
                currentUser={currentUser}
                onNavigate={navigateTo}
                onGoBack={handleGoBack}
                previousScreenLabel={previousModMeta}
                onCatalogUpdated={() => setCadastrosVersion((v) => v + 1)}
              />
            )}
            {activeModule === 'prospection' && (
              <ProspectionModule
                units={allUnits}
                currentUser={currentUser}
                navIntent={navIntent}
                onClearIntent={clearIntent}
                onNavigate={navigateTo}
              />
            )}
            {activeModule === 'appointments' && (
              <AppointmentsModule
                units={allUnits}
                currentUser={currentUser}
                activeUnitId={activeUnitId}
                wsTick={wsTick}
                navIntent={navIntent}
                onClearIntent={clearIntent}
                onNavigate={navigateTo}
                onGoBack={handleGoBack}
                previousScreenLabel={previousModMeta}
              />
            )}
            {activeModule === 'admission' && (
              <AdmissionVaultModule
                units={allUnits}
                activeUnitId={activeUnitId}
                navIntent={navIntent}
                onClearIntent={clearIntent}
                onNavigate={navigateTo}
                onGoBack={handleGoBack}
                cadastrosRefreshKey={cadastrosVersion}
              />
            )}
            {activeModule === 'audit' && (
              <AuditModule
                units={allUnits}
                currentUser={currentUser}
                wsTick={wsTick}
                navIntent={navIntent}
                onClearIntent={clearIntent}
                onNavigate={navigateTo}
              />
            )}
            {activeModule === 'legal' && (
              <LegalModule
                units={allUnits}
                wsTick={wsTick}
                navIntent={navIntent}
                onClearIntent={clearIntent}
                onNavigate={navigateTo}
              />
            )}
            {activeModule === 'negotiations' && (
              <NegotiationsModule
                units={allUnits}
                wsTick={wsTick}
                navIntent={navIntent}
                onClearIntent={clearIntent}
                onNavigate={navigateTo}
                onGoBack={handleGoBack}
                previousScreenLabel={previousModMeta}
              />
            )}
            {(activeModule === 'finance' || activeModule.startsWith('finance_')) && (
              <FinanceModule
                units={allUnits}
                wsTick={wsTick}
                activeModule={activeModule}
                navIntent={navIntent}
                onClearIntent={clearIntent}
                onNavigate={navigateTo}
              />
            )}
            {(activeModule === 'collection' || activeModule.startsWith('collection_')) && (
              <CollectionModule
                units={allUnits}
                currentUser={currentUser}
                group={group}
                wsTick={wsTick}
                activeSubmenu={
                  activeModule === 'collection_coordenacao'
                    ? 'coordenacao'
                    : activeModule === 'collection_operacional'
                    ? 'operacional'
                    : navIntent?.tab === 'coordenacao'
                    ? 'coordenacao'
                    : 'operacional'
                }
                copiedWhatsappText={copiedWhatsappText}
                navIntent={navIntent}
                onClearIntent={clearIntent}
                onNavigate={navigateTo}
              />
            )}
            {activeModule === 'forms' && (
              <FormsModule
                units={allUnits}
                wsTick={wsTick}
                navIntent={navIntent}
                onClearIntent={clearIntent}
                onNavigate={navigateTo}
                onGoBack={handleGoBack}
                previousScreenLabel={previousModMeta}
                branding={portalBranding}
              />
            )}
            {activeModule === 'reports' && (
              <ReportsModule
                currentUser={currentUser}
                units={allUnits}
                wsTick={wsTick}
                branding={portalBranding}
              />
            )}
            {(activeModule === 'acomp_juridico' || activeModule.startsWith('jur_')) && (
              <CompanyLegalModule
                activeSubmenu={activeModule}
                currentUser={currentUser}
                units={allUnits}
                wsTick={wsTick}
                onNavigate={navigateTo}
              />
            )}
            {activeModule === 'config' && (
              <ConfigModule
                currentUser={currentUser}
                wsTick={wsTick}
                onUnitsUpdated={loadProfile}
                onBrandingUpdated={(nextBranding) => {
                  setPortalBranding(nextBranding);
                  setCachedPortalBranding(nextBranding);
                }}
                onGoBack={handleGoBack}
                previousScreenLabel={previousModMeta}
              />
            )}
          </div>
        </main>

        {/* Collapsible WhatsApp Dock */}
        <FixedWhatsAppDock
          isMobileOpen={mobileWaOpen}
          onCloseMobile={() => setMobileWaOpen(false)}
          isDesktopOpen={desktopWaOpen}
          onCloseDesktop={() => setDesktopWaOpen(false)}
          onCopyToClipboard={(text) => {
            setCopiedWhatsappText(text);
          }}
          onUnreadCountChange={setWaUnreadCount}
          wsTick={wsTick}
        />
      </div>

      {/* Bottom Tab Bar for 5" / 7" Touch Screens (<768px) */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 h-16 pb-safe bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-slate-200 dark:border-slate-800 grid grid-cols-5">
        {visibleNavItems.slice(0, 4).map((item) => {
          const Icon = item.icon;
          const active = activeModule === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => navigateTo(item.id)}
              className={`flex flex-col items-center justify-center gap-0.5 text-[10px] font-semibold min-h-[44px] ${
                active ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span className="truncate max-w-[64px]">{item.shortLabel}</span>
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setMobileNavOpen(true)}
          className="flex flex-col items-center justify-center gap-0.5 text-[10px] font-semibold text-slate-600 dark:text-slate-300 min-h-[44px]"
        >
          <Menu className="w-5 h-5" />
          <span>Setores</span>
        </button>
      </nav>

      {/* Global Quick Search Modal (Ctrl+K) */}
      <GlobalSearchModal
        open={searchModalOpen}
        onClose={() => setSearchModalOpen(false)}
        onNavigate={navigateTo}
      />

      {/* Mandatory Password Change Modal */}
      {currentUser.mustChangePassword && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 dark:bg-slate-950/80 p-4">
          <form
            onSubmit={handlePasswordChangeSubmit}
            className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 shadow-2xl space-y-4"
          >
            <h2 className="font-display text-lg font-bold text-slate-900 dark:text-slate-100">
              Defina sua Nova Senha Pessoal
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-300">
              Você acessou com uma senha temporária. Por política de segurança corporativa, cadastre uma nova senha definitiva (mínimo 6 caracteres) para continuar.
            </p>
            {passwordChangeErr && (
              <div className="rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 px-3 py-2 text-xs text-red-700 dark:text-red-300">
                {passwordChangeErr}
              </div>
            )}
            <input
              type="password"
              required
              minLength={6}
              value={newPasswordInput}
              onChange={(e) => setNewPasswordInput(e.target.value)}
              placeholder="Nova senha corporativa"
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-2.5 text-sm"
            />
            <button
              type="submit"
              disabled={passwordSaving}
              className="w-full rounded-lg bg-emerald-600 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 dark:hover:bg-emerald-500"
            >
              {passwordSaving ? 'Salvando...' : 'Atualizar Senha e Acessar'}
            </button>
          </form>
        </div>
      )}

      {/* Ivi Copilot Quick Modal */}
      {iviOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 dark:bg-slate-950/80 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <img src={iviAvatarImg} alt="Ivi" className="w-8 h-8 rounded-full object-cover border border-blue-300 dark:border-blue-600 shadow-sm shrink-0" />
                <div>
                  <h3 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                    Agente Ivi · Copiloto FinancePro
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">Sua assistente virtual simpática e inteligente</p>
                </div>
              </div>
              <button type="button" onClick={() => setIviOpen(false)} className="text-slate-400 hover:text-slate-700 dark:hover:text-white p-1 dark:text-slate-400">
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Orquestração automática: Claude Code → OpenAI → Gemini → DeepSeek. Contexto atual: <strong>{activeNavMeta?.label || activeModule}</strong>.
            </p>
            <form onSubmit={handleAskIvi} className="space-y-3">
              <textarea
                rows={3}
                value={iviPrompt}
                onChange={(e) => setIviPrompt(e.target.value)}
                placeholder="Ex: Como estruturar a cobrança de busca e apreensão ou redigir resposta para cliente veicular?"
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 p-3 text-xs text-slate-900 dark:text-slate-100"
              />
              <button
                type="submit"
                disabled={iviBusy || !iviPrompt.trim()}
                className="rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 disabled:opacity-50"
              >
                {iviBusy ? 'Consultando cadeia Ivi...' : 'Enviar para Ivi'}
              </button>
            </form>
            {iviReply && (
              <div className="rounded-xl border border-blue-100 dark:border-blue-800 bg-blue-50/70 dark:bg-blue-950/50 p-3.5 text-xs space-y-1.5">
                <div className="font-mono text-[10px] font-semibold text-blue-800 dark:text-blue-300">
                  Provedor que respondeu: {iviProvider}
                </div>
                <p className="text-slate-800 dark:text-slate-100 whitespace-pre-wrap leading-relaxed">{iviReply}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Central de Ajuda Corporativa Modal */}
      {helpOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 dark:bg-slate-950/80 p-4"
          onClick={() => setHelpOpen(false)}
        >
          <div
            className="w-full max-w-4xl rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <BookOpen className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <h3 className="font-display text-base font-bold text-slate-900 dark:text-slate-100 truncate">
                  Central de Ajuda & Procedimentos Operacionais
                </h3>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {currentUser.role === 'admin' && (
                  <button
                    type="button"
                    onClick={() => {
                      setHelpOpen(false);
                      navigateTo('config');
                    }}
                    className="text-xs font-semibold text-blue-700 dark:text-blue-400 hover:underline"
                  >
                    Editar em Configurações
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setHelpOpen(false)}
                  aria-label="Fechar ajuda"
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 dark:text-slate-400"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="p-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/60">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5 dark:text-slate-400" />
                <input
                  type="text"
                  value={helpSearch}
                  onChange={(e) => setHelpSearch(e.target.value)}
                  placeholder="Filtrar tópicos por módulo, título, resumo ou palavra-chave..."
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 pl-9 pr-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:border-blue-600 focus:outline-none"
                />
              </div>
            </div>

            {helpLoading ? (
              <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">
                Carregando tópicos da Central de Ajuda...
              </div>
            ) : (
              (() => {
                const q = helpSearch.trim().toLowerCase();
                const filteredTopics = helpTopics.filter((t) => {
                  if (!q) return true;
                  const hay = `${t.menuPath} ${t.title} ${t.summary} ${(t.keywords || []).join(' ')}`.toLowerCase();
                  return hay.includes(q);
                });
                const activeTopic =
                  filteredTopics.find((t) => t.id === selectedHelpId) || filteredTopics[0] || null;

                return (
                  <div className="grid grid-cols-1 md:grid-cols-12 flex-1 min-h-0 overflow-hidden">
                    <div className="md:col-span-5 border-b md:border-b-0 md:border-r border-slate-200 dark:border-slate-800 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 max-h-60 md:max-h-none">
                      {filteredTopics.length === 0 ? (
                        <div className="p-6 text-center text-xs text-slate-500 dark:text-slate-400">
                          Nenhum procedimento encontrado para esta busca.
                        </div>
                      ) : (
                        filteredTopics.map((topic) => {
                          const isSelected = activeTopic?.id === topic.id;
                          return (
                            <button
                              key={topic.id}
                              type="button"
                              onClick={() => setSelectedHelpId(topic.id)}
                              className={`w-full text-left px-4 py-3 transition-colors ${
                                isSelected ? 'bg-blue-50/70 dark:bg-blue-950/50' : 'hover:bg-slate-50 dark:hover:bg-slate-800'
                              }`}
                            >
                              <div className="font-mono text-[10px] font-semibold text-blue-700 dark:text-blue-400 truncate">
                                {topic.menuPath}
                              </div>
                              <div className="mt-0.5 text-xs font-bold text-slate-900 dark:text-slate-100">
                                {topic.title}
                              </div>
                              {topic.summary && (
                                <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400 line-clamp-2">
                                  {topic.summary}
                                </div>
                              )}
                            </button>
                          );
                        })
                      )}
                    </div>

                    <div className="md:col-span-7 p-5 overflow-y-auto space-y-3 text-xs text-slate-700 dark:text-slate-200">
                      {activeTopic ? (
                        <>
                          <div>
                            <div className="font-mono text-[11px] font-semibold text-blue-700 dark:text-blue-400">
                              {activeTopic.menuPath}
                            </div>
                            <h4 className="mt-1 font-display text-base font-bold text-slate-900 dark:text-slate-100">
                              {activeTopic.title}
                            </h4>
                            {activeTopic.summary && (
                              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{activeTopic.summary}</p>
                            )}
                          </div>
                          <div
                            className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2 leading-relaxed [&_h3]:font-display [&_h3]:text-sm [&_h3]:font-bold [&_h3]:text-slate-900 dark:[&_h3]:text-slate-100 [&_ul]:list-disc [&_ul]:pl-5 [&_li]:mt-1 [&_strong]:text-slate-900 dark:[&_strong]:text-white"
                            dangerouslySetInnerHTML={{
                              __html: sanitizeHelpHtml(activeTopic.htmlContent),
                            }}
                          />
                        </>
                      ) : (
                        <div className="text-center py-8 text-slate-400 dark:text-slate-500">
                          Selecione um tópico ao lado para visualizar as orientações.
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()
            )}
          </div>
        </div>
      )}

      <OfflineIndicator />
    </div>
  );
}
