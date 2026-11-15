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
  CalendarDays,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  FileStack,
  FileText,
  FolderKanban,
  FolderTree,
  Hash,
  Landmark,
  Layers,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  Network,
  Package,
  PhoneCall,
  Scale,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Store,
  TrendingDown,
  UserCog,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { auth } from './lib/firebase.ts';
import { apiFetch, setActiveUnitHeader, setAuthToken } from './lib/api.ts';
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
import { ConfigModule } from './components/modules/ConfigModule.tsx';
import { ManagerialDashboardModule } from './components/modules/ManagerialDashboardModule.tsx';
import { sanitizeHelpHtml } from './components/modules/config/ConfigGovernanceViews.tsx';

interface NavItem {
  id: ModuleId;
  label: string;
  shortLabel: string;
  group: 'entrada' | 'operacao' | 'gestao';
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

const NAV_ITEMS: NavItem[] = [
  { id: 'overview', label: 'Visão Executiva', shortLabel: 'Início', group: 'entrada', icon: LayoutDashboard },
  { id: 'managerial_dashboard', label: 'Dashboard Gerencial', shortLabel: 'Gerencial', group: 'entrada', icon: BarChart3 },
  { id: 'appointments', label: 'Agendamentos', shortLabel: 'Agendas', group: 'entrada', icon: CalendarDays },
  { id: 'audit', label: 'Auditoria & Boletos', shortLabel: 'Auditoria', group: 'operacao', icon: ClipboardCheck },
  { id: 'legal', label: 'Jurídico & Escavador', shortLabel: 'Jurídico', group: 'operacao', icon: Scale },
  { id: 'negotiations', label: 'Negociações Bancárias', shortLabel: 'Negociar', group: 'operacao', icon: TrendingDown },
  { id: 'collection', label: 'Cobrança & Ranking', shortLabel: 'Cobrança', group: 'gestao', icon: Briefcase },
  { id: 'config', label: 'Configurações & SQL', shortLabel: 'Config', group: 'gestao', icon: Settings },
];

const NAV_GROUPS: Array<{ key: NavItem['group']; title: string }> = [
  { key: 'entrada', title: 'Entrada & Atendimento' },
  { key: 'operacao', title: 'Operação & Tratativa' },
  { key: 'gestao', title: 'Receita & Governança' },
];

export default function App() {
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
  const [cadastrosExpanded, setCadastrosExpanded] = useState(false);
  const [comercialExpanded, setComercialExpanded] = useState(false);
  const [adminFinanceExpanded, setAdminFinanceExpanded] = useState(false);
  const [financeCadastrosExpanded, setFinanceCadastrosExpanded] = useState(false);
  const [contaCorrenteExpanded, setContaCorrenteExpanded] = useState(false);
  const [contaCorrenteCadastroExpanded, setContaCorrenteCadastroExpanded] = useState(false);
  const [collectionExpanded, setCollectionExpanded] = useState(false);
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
    fetch('/api/public/portal-branding')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { branding?: PortalBrandingConfig } | null) => {
        if (d?.branding) setPortalBranding(d.branding);
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

  const navigateTo = useCallback(
    (mod: ModuleId, intent?: NavigationIntent) => {
      setActiveModule((prevMod) => {
        if (prevMod !== mod) {
          setNavHistory((prev) => [...prev.slice(-24), { mod: prevMod, intent: null }]);
        }
        return mod;
      });
      setNavIntent(intent || null);
      if (mod.startsWith('cad_')) {
        setCadastrosExpanded(true);
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
      setMobileNavOpen(false);
    },
    []
  );

  const handleGoBack = useCallback(() => {
    setNavHistory((prev) => {
      if (prev.length === 0) {
        setActiveModule('overview');
        setNavIntent(null);
        return prev;
      }
      const nextStack = prev.slice(0, -1);
      const target = prev[prev.length - 1];
      setActiveModule(target.mod);
      setNavIntent(target.intent);
      if (target.mod.startsWith('cad_')) {
        setCadastrosExpanded(true);
      }
      if (target.mod === 'finance' || target.mod.startsWith('finance_')) {
        setAdminFinanceExpanded(true);
      }
      if (target.mod === 'finance_cadastros' || target.mod.startsWith('finance_cad_')) {
        setFinanceCadastrosExpanded(true);
      }
      if (
        target.mod === 'finance_conta_corrente' ||
        target.mod === 'finance_movimento' ||
        target.mod === 'finance_conciliacao'
      ) {
        setContaCorrenteExpanded(true);
        setContaCorrenteCadastroExpanded(true);
      }
      if (target.mod === 'collection' || target.mod.startsWith('collection_')) {
        setCollectionExpanded(true);
      }
      return nextStack;
    });
  }, []);

  const clearIntent = useCallback(() => {
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
      <div className="min-h-screen bg-slate-50 flex items-center justify-center text-sm font-medium text-slate-600">
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

  const isCollectionActive = activeModule === 'collection' || activeModule.startsWith('collection_');
  const selectableUnits = units.length > 0 ? units : allUnits;
  const cadastrosAnchorId: ModuleId = visibleNavItems.some((i) => i.id === 'appointments')
    ? 'appointments'
    : 'overview';
  const activeCadMeta = CADASTROS_SUBMENUS.find((s) => s.id === activeModule);
  const activeFinanceMeta = FINANCE_ALL_SUBMENUS.find((s) => s.id === activeModule);
  const activeCollectionMeta = COLLECTION_SUBMENUS.find((s) => s.id === activeModule);
  const activeNavMeta = activeCadMeta
    ? { id: activeCadMeta.id, label: `Cadastros Comuns · ${activeCadMeta.label}` }
    : activeFinanceMeta
    ? { id: activeFinanceMeta.id, label: `Administração Financeira · ${activeFinanceMeta.label}` }
    : activeCollectionMeta
    ? { id: activeCollectionMeta.id, label: `Cobrança & Ranking · ${activeCollectionMeta.label}` }
    : NAV_ITEMS.find((i) => i.id === activeModule);
  const previousModMeta = (() => {
    const prevMod = navHistory.length > 0 ? navHistory[navHistory.length - 1].mod : 'overview';
    const cad = CADASTROS_SUBMENUS.find((s) => s.id === prevMod);
    if (cad) return `Cadastros · ${cad.label}`;
    const fin = FINANCE_ALL_SUBMENUS.find((s) => s.id === prevMod);
    if (fin) return `Administração Financeira · ${fin.label}`;
    const col = COLLECTION_SUBMENUS.find((s) => s.id === prevMod);
    if (col) return `Cobrança & Ranking · ${col.label}`;
    return NAV_ITEMS.find((i) => i.id === prevMod)?.label || 'Visão Executiva';
  })();

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      {/* Top Bar (56px) */}
      <header className="sticky top-0 z-30 h-14 bg-white border-b border-slate-200 px-3 sm:px-5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            type="button"
            onClick={() => setMobileNavOpen(!mobileNavOpen)}
            aria-label="Menu de setores"
            className="lg:hidden p-2 rounded-lg text-slate-600 hover:bg-slate-100 min-h-[44px] min-w-[44px] flex items-center justify-center"
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
                className="h-8 w-8 rounded-lg object-contain bg-slate-900 p-1 shrink-0"
              />
            ) : (
              <div className="h-8 w-8 rounded-lg bg-slate-900 text-emerald-400 flex items-center justify-center shrink-0">
                <ShieldCheck className="w-4 h-4" />
              </div>
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-sm font-bold tracking-tight text-slate-900 font-display truncate">
                <span className="truncate max-w-[160px]">
                  {portalBranding?.companyName?.trim() || 'FinancePro'}
                </span>
                {activeNavMeta && activeModule !== 'overview' && (
                  <>
                    <ChevronRight className="w-3.5 h-3.5 text-slate-400 hidden sm:inline shrink-0" />
                    <span className="hidden sm:inline text-slate-600 font-semibold truncate">
                      {activeNavMeta.label}
                    </span>
                  </>
                )}
              </div>
              <div className="hidden md:block text-[10px] text-slate-500 truncate">
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
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 sm:px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 min-h-[38px]"
          >
            <Search className="w-3.5 h-3.5 text-slate-500 shrink-0" />
            <span className="hidden md:inline">Buscar cliente / CPF / processo...</span>
            <span className="md:hidden">Buscar</span>
            <kbd className="hidden lg:inline-block rounded border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-[10px] text-slate-400">
              Ctrl+K
            </kbd>
          </button>

          {/* Active Unit Switcher */}
          <div className="hidden sm:flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 min-h-[38px]">
            <Building2 className="w-3.5 h-3.5 text-slate-500 shrink-0" />
            <select
              value={activeUnitId}
              onChange={(e) => handleUnitSwitch(Number(e.target.value))}
              aria-label="Unidade ativa"
              className="bg-transparent text-xs font-semibold text-slate-800 focus:outline-none"
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
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 whitespace-nowrap min-h-[38px]"
          >
            <BookOpen className="w-3.5 h-3.5 text-slate-600" />
            <span className="hidden xl:inline">Ajuda</span>
          </button>

          <button
            type="button"
            onClick={() => setIviOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-xs font-semibold text-blue-800 hover:bg-blue-100 whitespace-nowrap min-h-[38px]"
          >
            <img src={iviAvatarImg} alt="Ivi" className="w-5 h-5 rounded-full object-cover border border-blue-300 shrink-0" />
            <span className="hidden sm:inline">Ivi IA</span>
          </button>

          <PWAInstallButton />

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
                ? 'bg-slate-900 text-white hover:bg-slate-800'
                : 'bg-emerald-600 text-white hover:bg-emerald-700'
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
            className="p-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 min-h-[38px] min-w-[38px] flex items-center justify-center"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Live WebSocket Alert Banner */}
      {liveAlert && (
        <div className="bg-slate-900 text-emerald-300 text-xs font-medium px-4 py-2 text-center border-b border-slate-800">
          {liveAlert}
        </div>
      )}

      {/* Main Responsive Workspace */}
      <div className="flex-1 flex min-h-0">
        {/* Desktop Sidebar (10" and 21") */}
        <aside className="hidden lg:flex lg:flex-col w-64 shrink-0 bg-white border-r border-slate-200 p-3 justify-between sticky top-14 h-[calc(100vh-56px)]">
          <nav className="space-y-4 overflow-y-auto overflow-x-auto scroll-rulers pr-0.5">
            {NAV_GROUPS.map((grp) => {
              const items = visibleNavItems.filter((i) => i.group === grp.key);
              const showFinanceBlock = grp.key === 'gestao' && canViewFinance;
              if (items.length === 0 && !showFinanceBlock) return null;
              const financePendingCount = navCounts.finance || 0;
              return (
                <div key={grp.key} className="space-y-1">
                  <div className="px-3 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    {grp.title}
                  </div>

                  {/* Administração Financeira (no grupo Receita & Governança) */}
                  {showFinanceBlock && (
                    <div className="space-y-0.5">
                      <button
                        type="button"
                        aria-expanded={adminFinanceExpanded}
                        onClick={() => setAdminFinanceExpanded((prev) => !prev)}
                        className={`w-full flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition-colors text-left ${
                          isFinanceActive && !adminFinanceExpanded
                            ? 'bg-slate-900 text-white'
                            : isFinanceActive
                            ? 'bg-slate-100 text-slate-900'
                            : 'text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        <span className="flex items-center gap-2.5 min-w-0">
                          <Banknote
                            className={`w-4 h-4 shrink-0 ${
                              isFinanceActive && !adminFinanceExpanded
                                ? 'text-emerald-400'
                                : isFinanceActive
                                ? 'text-emerald-600'
                                : 'text-slate-500'
                            }`}
                          />
                          <span className="truncate">Administração Financeira</span>
                        </span>
                        <span className="flex items-center gap-1.5 shrink-0">
                          {!adminFinanceExpanded && financePendingCount > 0 && (
                            <span
                              className={`font-mono text-[11px] font-bold tabular-nums ${
                                isFinanceActive ? 'text-emerald-300' : 'text-amber-700'
                              }`}
                            >
                              {financePendingCount}
                            </span>
                          )}
                          {adminFinanceExpanded ? (
                            <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                          ) : (
                            <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                          )}
                        </span>
                      </button>

                      {adminFinanceExpanded && (
                        <div className="ml-4 pl-2.5 border-l border-slate-200 space-y-0.5 py-0.5">
                          {/* Subopção 1: Cadastros e suas opções */}
                          <div className="space-y-0.5">
                            <button
                              type="button"
                              aria-expanded={financeCadastrosExpanded}
                              onClick={() => setFinanceCadastrosExpanded((prev) => !prev)}
                              className={`w-full flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition-colors text-left ${
                                isFinanceCadActive && !financeCadastrosExpanded
                                  ? 'bg-slate-900 text-white'
                                  : isFinanceCadActive
                                  ? 'bg-slate-100 text-slate-900'
                                  : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
                              }`}
                            >
                              <span className="flex items-center gap-2 min-w-0">
                                <FolderKanban
                                  className={`w-3.5 h-3.5 shrink-0 ${
                                    isFinanceCadActive ? 'text-emerald-600' : 'text-slate-500'
                                  }`}
                                />
                                <span className="truncate">Cadastros</span>
                              </span>
                              {financeCadastrosExpanded ? (
                                <ChevronDown className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                              ) : (
                                <ChevronRight className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                              )}
                            </button>

                            {financeCadastrosExpanded && (
                              <div className="ml-3 pl-2.5 border-l border-slate-200 space-y-0.5 py-0.5">
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
                                          ? 'bg-slate-900 text-white'
                                          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                                      }`}
                                    >
                                      <SubIcon
                                        className={`w-3 h-3 shrink-0 ${
                                          subActive ? 'text-emerald-400' : 'text-slate-400'
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
                                  ? 'bg-slate-900 text-white'
                                  : isContaCorrenteActive
                                  ? 'bg-slate-100 text-slate-900'
                                  : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
                              }`}
                            >
                              <span className="flex items-center gap-2 min-w-0">
                                <Landmark
                                  className={`w-3.5 h-3.5 shrink-0 ${
                                    isContaCorrenteActive && !contaCorrenteExpanded
                                      ? 'text-emerald-400'
                                      : isContaCorrenteActive
                                      ? 'text-emerald-600'
                                      : 'text-slate-500'
                                  }`}
                                />
                                <span className="truncate">Conta Corrente</span>
                              </span>
                              {contaCorrenteExpanded ? (
                                <ChevronDown className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                              ) : (
                                <ChevronRight className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                              )}
                            </button>

                            {contaCorrenteExpanded && (
                              <div className="ml-3 pl-2.5 border-l border-slate-200 space-y-0.5 py-0.5">
                                <button
                                  type="button"
                                  aria-expanded={contaCorrenteCadastroExpanded}
                                  onClick={() => setContaCorrenteCadastroExpanded((prev) => !prev)}
                                  className={`w-full flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-[11px] font-semibold transition-colors text-left ${
                                    isContaCorrenteActive && !contaCorrenteCadastroExpanded
                                      ? 'bg-slate-900 text-white'
                                      : isContaCorrenteActive
                                      ? 'bg-slate-100 text-slate-900'
                                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                                  }`}
                                >
                                  <span className="flex items-center gap-2 min-w-0">
                                    <FolderKanban
                                      className={`w-3 h-3 shrink-0 ${
                                        isContaCorrenteActive ? 'text-emerald-600' : 'text-slate-400'
                                      }`}
                                    />
                                    <span className="truncate">Cadastro</span>
                                  </span>
                                  {contaCorrenteCadastroExpanded ? (
                                    <ChevronDown className="w-3 h-3 shrink-0 text-slate-400" />
                                  ) : (
                                    <ChevronRight className="w-3 h-3 shrink-0 text-slate-400" />
                                  )}
                                </button>

                                {contaCorrenteCadastroExpanded && (
                                  <div className="ml-3 pl-2 border-l border-slate-200 space-y-0.5 py-0.5">
                                    <button
                                      type="button"
                                      onClick={() => navigateTo('finance_conta_corrente')}
                                      className={`w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-[11px] font-semibold transition-colors text-left ${
                                        activeModule === 'finance_conta_corrente'
                                          ? 'bg-slate-900 text-white'
                                          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                                      }`}
                                    >
                                      <Landmark
                                        className={`w-3 h-3 shrink-0 ${
                                          activeModule === 'finance_conta_corrente' ? 'text-emerald-400' : 'text-slate-400'
                                        }`}
                                      />
                                      <span className="truncate">Contas Correntes</span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => navigateTo('finance_movimento')}
                                      className={`w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-[11px] font-semibold transition-colors text-left ${
                                        activeModule === 'finance_movimento'
                                          ? 'bg-slate-900 text-white'
                                          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                                      }`}
                                    >
                                      <ArrowLeftRight
                                        className={`w-3 h-3 shrink-0 ${
                                          activeModule === 'finance_movimento' ? 'text-emerald-400' : 'text-slate-400'
                                        }`}
                                      />
                                      <span className="truncate">Movimento</span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => navigateTo('finance_conciliacao')}
                                      className={`w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-[11px] font-semibold transition-colors text-left ${
                                        activeModule === 'finance_conciliacao'
                                          ? 'bg-slate-900 text-white'
                                          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                                      }`}
                                    >
                                      <Scale
                                        className={`w-3 h-3 shrink-0 ${
                                          activeModule === 'finance_conciliacao' ? 'text-emerald-400' : 'text-slate-400'
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
                                ? 'bg-slate-900 text-white'
                                : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
                            }`}
                          >
                            <span className="flex items-center gap-2 min-w-0">
                              <ArrowDownCircle
                                className={`w-3.5 h-3.5 shrink-0 ${
                                  activeModule === 'finance_receber' || activeModule === 'finance' || activeModule === 'finance_operacao'
                                    ? 'text-emerald-400'
                                    : 'text-emerald-600'
                                }`}
                              />
                              <span className="truncate">Contas a Receber</span>
                            </span>
                            {financePendingCount > 0 && (
                              <span
                                className={`font-mono text-[10px] font-bold tabular-nums shrink-0 ${
                                  activeModule === 'finance_receber' || activeModule === 'finance' || activeModule === 'finance_operacao'
                                    ? 'text-emerald-300'
                                    : 'text-amber-700'
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
                                ? 'bg-slate-900 text-white'
                                : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
                            }`}
                          >
                            <BellRing
                              className={`w-3.5 h-3.5 shrink-0 ${
                                activeModule === 'finance_regua' ? 'text-emerald-400' : 'text-blue-600'
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
                                ? 'bg-slate-900 text-white'
                                : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
                            }`}
                          >
                            <ArrowUpCircle
                              className={`w-3.5 h-3.5 shrink-0 ${
                                activeModule === 'finance_pagar' ? 'text-emerald-400' : 'text-rose-600'
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
                                ? 'bg-slate-900 text-white'
                                : isCollectionActive
                                ? 'bg-slate-100 text-slate-900'
                                : 'text-slate-700 hover:bg-slate-100'
                            }`}
                          >
                            <span className="flex items-center gap-2.5 min-w-0">
                              <Icon
                                className={`w-4 h-4 shrink-0 ${
                                  isCollectionActive && !collectionExpanded
                                    ? 'text-emerald-400'
                                    : isCollectionActive
                                    ? 'text-emerald-600'
                                    : 'text-slate-500'
                                }`}
                              />
                              <span className="truncate">{item.label}</span>
                            </span>
                            <span className="flex items-center gap-1.5 shrink-0">
                              {!collectionExpanded && pendingCount > 0 && (
                                <span
                                  className={`font-mono text-[11px] font-bold tabular-nums ${
                                    isCollectionActive ? 'text-emerald-300' : 'text-amber-700'
                                  }`}
                                >
                                  {pendingCount}
                                </span>
                              )}
                              {collectionExpanded ? (
                                <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                              ) : (
                                <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                              )}
                            </span>
                          </button>

                          {collectionExpanded && (
                            <div className="ml-4 pl-2.5 border-l border-slate-200 space-y-0.5 py-0.5">
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
                                        ? 'bg-slate-900 text-white'
                                        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                                    }`}
                                  >
                                    <SubIcon
                                      className={`w-3.5 h-3.5 shrink-0 ${
                                        subActive ? 'text-emerald-400' : 'text-slate-400'
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
                              ? 'bg-slate-900 text-white'
                              : 'text-slate-700 hover:bg-slate-100'
                          }`}
                        >
                          <span className="flex items-center gap-2.5 min-w-0">
                            <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-emerald-400' : 'text-slate-500'}`} />
                            <span className="truncate">{item.label}</span>
                          </span>
                          {pendingCount > 0 && (
                            <span
                              className={`font-mono text-[11px] font-bold tabular-nums shrink-0 ${
                                active ? 'text-emerald-300' : 'text-amber-700'
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
                                  ? 'bg-slate-900 text-white'
                                  : isCadActive
                                  ? 'bg-slate-100 text-slate-900'
                                  : 'text-slate-700 hover:bg-slate-100'
                              }`}
                            >
                              <span className="flex items-center gap-2.5 min-w-0">
                                <FolderKanban
                                  className={`w-4 h-4 shrink-0 ${
                                    isCadActive ? 'text-emerald-600' : 'text-slate-500'
                                  }`}
                                />
                                <span className="truncate">Cadastros Comuns</span>
                              </span>
                              {cadastrosExpanded ? (
                                <ChevronDown className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                              ) : (
                                <ChevronRight className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                              )}
                            </button>

                            {cadastrosExpanded && (
                              <div className="ml-4 pl-2.5 border-l border-slate-200 space-y-0.5 py-0.5">
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
                                          ? 'bg-slate-900 text-white'
                                          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                                      }`}
                                    >
                                      <SubIcon
                                        className={`w-3.5 h-3.5 shrink-0 ${
                                          subActive ? 'text-emerald-400' : 'text-slate-400'
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
                                  ? 'bg-slate-900 text-white'
                                  : (activeModule === 'prospection' || activeModule === 'admission')
                                  ? 'bg-slate-100 text-slate-900'
                                  : 'text-slate-700 hover:bg-slate-100'
                              }`}
                            >
                              <span className="flex items-center gap-2.5 min-w-0">
                                <Store
                                  className={`w-4 h-4 shrink-0 ${
                                    (activeModule === 'prospection' || activeModule === 'admission') ? 'text-emerald-600' : 'text-slate-500'
                                  }`}
                                />
                                <span className="truncate">Comercial</span>
                              </span>
                              {comercialExpanded ? (
                                <ChevronDown className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                              ) : (
                                <ChevronRight className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                              )}
                            </button>

                            {comercialExpanded && (
                              <div className="ml-4 pl-2.5 border-l border-slate-200 space-y-0.5 py-0.5">
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
                                          ? 'bg-slate-900 text-white'
                                          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                                      }`}
                                    >
                                      <SubIcon
                                        className={`w-3.5 h-3.5 shrink-0 ${
                                          subActive ? 'text-emerald-400' : 'text-slate-400'
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

          <div className="space-y-2 pt-2 border-t border-slate-200">
            <button
              type="button"
              onClick={handleLogout}
              className="w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-50 transition-colors text-left"
            >
              <LogOut className="w-4 h-4 shrink-0 text-red-600" />
              <span className="truncate">Sair</span>
            </button>
            <div className="pt-1 px-1 text-[11px] text-slate-500 space-y-1">
              <div className="font-semibold text-slate-700">Fluxo do Cliente</div>
              <div className="text-[10px] text-slate-500 leading-relaxed">
                Prospecção → Admissão → Auditoria → Jurídico/Negociação → Financeiro
              </div>
            </div>
          </div>
        </aside>

        {/* Mobile / Tablet Navigation Drawer (<1024px) */}
        {mobileNavOpen && (
          <div className="lg:hidden fixed inset-0 z-40 flex bg-slate-900/40 backdrop-blur-xs">
            <div className="w-76 max-w-[85vw] bg-white h-full p-4 flex flex-col justify-between shadow-2xl overflow-y-auto overflow-x-auto scroll-rulers">
              <div>
                <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                  <span className="font-display text-sm font-bold text-slate-900">Setores FinancePro</span>
                  <button
                    type="button"
                    onClick={() => setMobileNavOpen(false)}
                    aria-label="Fechar menu"
                    className="p-2 text-slate-500 min-h-[44px] min-w-[44px] flex items-center justify-center"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Mobile Unit Selector */}
                <div className="mt-3 sm:hidden">
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1">Unidade Ativa</label>
                  <select
                    value={activeUnitId}
                    onChange={(e) => handleUnitSwitch(Number(e.target.value))}
                    className="w-full rounded-lg border border-slate-200 px-2.5 py-2.5 text-xs font-semibold min-h-[44px]"
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
                        <div className="px-3 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                          {grp.title}
                        </div>

                        {showFinanceBlock && (
                          <div className="space-y-0.5">
                            <button
                              type="button"
                              aria-expanded={adminFinanceExpanded}
                              onClick={() => setAdminFinanceExpanded((prev) => !prev)}
                              className={`w-full flex items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-xs font-semibold min-h-[44px] ${
                                isFinanceActive ? 'bg-slate-100 text-slate-900' : 'text-slate-700 hover:bg-slate-100'
                              }`}
                            >
                              <span className="flex items-center gap-2.5">
                                <Banknote className="w-4 h-4 shrink-0 text-slate-500" />
                                <span>Administração Financeira</span>
                              </span>
                              <span className="flex items-center gap-1.5">
                                {!adminFinanceExpanded && financePendingCount > 0 && (
                                  <span className="font-mono text-[11px] font-bold text-amber-700">
                                    {financePendingCount}
                                  </span>
                                )}
                                {adminFinanceExpanded ? (
                                  <ChevronDown className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                                ) : (
                                  <ChevronRight className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                                )}
                              </span>
                            </button>

                            {adminFinanceExpanded && (
                              <div className="ml-4 pl-2.5 border-l border-slate-200 space-y-0.5 py-0.5">
                                <div className="space-y-0.5">
                                  <button
                                    type="button"
                                    aria-expanded={financeCadastrosExpanded}
                                    onClick={() => setFinanceCadastrosExpanded((prev) => !prev)}
                                    className={`w-full flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-xs font-semibold min-h-[40px] ${
                                      isFinanceCadActive ? 'bg-slate-100 text-slate-900' : 'text-slate-700 hover:bg-slate-100'
                                    }`}
                                  >
                                    <span className="flex items-center gap-2">
                                      <FolderKanban className="w-3.5 h-3.5 shrink-0" />
                                      <span>Cadastros</span>
                                    </span>
                                    {financeCadastrosExpanded ? (
                                      <ChevronDown className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                                    ) : (
                                      <ChevronRight className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                                    )}
                                  </button>

                                  {financeCadastrosExpanded && (
                                    <div className="ml-3 pl-2.5 border-l border-slate-200 space-y-0.5 py-0.5">
                                      {FINANCE_CADASTROS_SUBMENUS.map((sub) => {
                                        const SubIcon = sub.icon;
                                        const subActive = activeModule === sub.id;
                                        return (
                                          <button
                                            key={sub.id}
                                            type="button"
                                            onClick={() => navigateTo(sub.id)}
                                            className={`w-full flex items-center gap-2 rounded-lg px-2 py-2 text-xs font-semibold min-h-[38px] ${
                                              subActive ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
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
                                        ? 'bg-slate-100 text-slate-900'
                                        : 'text-slate-700 hover:bg-slate-100'
                                    }`}
                                  >
                                    <span className="flex items-center gap-2">
                                      <Landmark className="w-3.5 h-3.5 shrink-0" />
                                      <span>Conta Corrente</span>
                                    </span>
                                    {contaCorrenteExpanded ? (
                                      <ChevronDown className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                                    ) : (
                                      <ChevronRight className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                                    )}
                                  </button>

                                  {contaCorrenteExpanded && (
                                    <div className="ml-3 pl-2.5 border-l border-slate-200 space-y-0.5 py-0.5">
                                      <button
                                        type="button"
                                        aria-expanded={contaCorrenteCadastroExpanded}
                                        onClick={() => setContaCorrenteCadastroExpanded((prev) => !prev)}
                                        className={`w-full flex items-center justify-between gap-2 rounded-lg px-2 py-2 text-xs font-semibold min-h-[38px] ${
                                          isContaCorrenteActive
                                            ? 'bg-slate-100 text-slate-900'
                                            : 'text-slate-600 hover:bg-slate-100'
                                        }`}
                                      >
                                        <span className="flex items-center gap-2">
                                          <FolderKanban className="w-3.5 h-3.5 shrink-0" />
                                          <span>Cadastro</span>
                                        </span>
                                        {contaCorrenteCadastroExpanded ? (
                                          <ChevronDown className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                                        ) : (
                                          <ChevronRight className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                                        )}
                                      </button>

                                      {contaCorrenteCadastroExpanded && (
                                        <div className="ml-3 pl-2 border-l border-slate-200 space-y-0.5 py-0.5">
                                          <button
                                            type="button"
                                            onClick={() => navigateTo('finance_conta_corrente')}
                                            className={`w-full flex items-center gap-2 rounded-lg px-2 py-2 text-xs font-semibold min-h-[38px] ${
                                              activeModule === 'finance_conta_corrente'
                                                ? 'bg-slate-900 text-white'
                                                : 'text-slate-600 hover:bg-slate-100'
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
                                                ? 'bg-slate-900 text-white'
                                                : 'text-slate-600 hover:bg-slate-100'
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
                                                ? 'bg-slate-900 text-white'
                                                : 'text-slate-600 hover:bg-slate-100'
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
                                      ? 'bg-slate-900 text-white'
                                      : 'text-slate-700 hover:bg-slate-100'
                                  }`}
                                >
                                  <span className="flex items-center gap-2">
                                    <ArrowDownCircle className="w-3.5 h-3.5 shrink-0" />
                                    <span>Contas a Receber</span>
                                  </span>
                                  {financePendingCount > 0 && (
                                    <span className={`font-mono text-[11px] font-bold ${
                                      activeModule === 'finance_receber' || activeModule === 'finance' || activeModule === 'finance_operacao'
                                        ? 'text-emerald-300'
                                        : 'text-amber-700'
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
                                      ? 'bg-slate-900 text-white'
                                      : 'text-slate-700 hover:bg-slate-100'
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
                                      ? 'bg-slate-900 text-white'
                                      : 'text-slate-700 hover:bg-slate-100'
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
                                    isCollectionActive ? 'bg-slate-100 text-slate-900' : 'text-slate-700 hover:bg-slate-100'
                                  }`}
                                >
                                  <span className="flex items-center gap-2.5">
                                    <Icon className="w-4 h-4 shrink-0 text-slate-500" />
                                    <span>{item.label}</span>
                                  </span>
                                  <span className="flex items-center gap-1.5">
                                    {!collectionExpanded && pendingCount > 0 && (
                                      <span className="font-mono text-[11px] font-bold text-amber-700">
                                        {pendingCount}
                                      </span>
                                    )}
                                    {collectionExpanded ? (
                                      <ChevronDown className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                                    ) : (
                                      <ChevronRight className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                                    )}
                                  </span>
                                </button>
                                {collectionExpanded && (
                                  <div className="ml-4 pl-2.5 border-l border-slate-200 space-y-0.5 py-0.5">
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
                                            subActive ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
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
                                  active ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100'
                                }`}
                              >
                                <span className="flex items-center gap-2.5">
                                  <Icon className="w-4 h-4 shrink-0" />
                                  <span>{item.label}</span>
                                </span>
                                {pendingCount > 0 && (
                                  <span className={`font-mono text-[11px] font-bold ${active ? 'text-emerald-300' : 'text-amber-700'}`}>
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
                                      isCadActive ? 'bg-slate-100 text-slate-900' : 'text-slate-700 hover:bg-slate-100'
                                    }`}
                                  >
                                    <span className="flex items-center gap-2.5">
                                      <FolderKanban className="w-4 h-4 shrink-0 text-slate-500" />
                                      <span>Cadastros Comuns</span>
                                    </span>
                                    {cadastrosExpanded ? (
                                      <ChevronDown className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                                    ) : (
                                      <ChevronRight className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                                    )}
                                  </button>
                                  {cadastrosExpanded && (
                                    <div className="ml-4 pl-2.5 border-l border-slate-200 space-y-0.5 py-0.5">
                                      {visibleCadastrosSubmenus.map((sub) => {
                                        const SubIcon = sub.icon;
                                        const subActive = activeModule === sub.id;
                                        return (
                                          <button
                                            key={sub.id}
                                            type="button"
                                            onClick={() => navigateTo(sub.id)}
                                            className={`w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-semibold min-h-[40px] ${
                                              subActive ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
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
                                        ? 'bg-slate-100 text-slate-900'
                                        : 'text-slate-700 hover:bg-slate-100'
                                    }`}
                                  >
                                    <span className="flex items-center gap-2.5">
                                      <Store className="w-4 h-4 shrink-0 text-slate-500" />
                                      <span>Comercial</span>
                                    </span>
                                    {comercialExpanded ? (
                                      <ChevronDown className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                                    ) : (
                                      <ChevronRight className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                                    )}
                                  </button>
                                  {comercialExpanded && (
                                    <div className="ml-4 pl-2.5 border-l border-slate-200 space-y-0.5 py-0.5">
                                      {COMERCIAL_SUBMENUS.map((sub) => {
                                        const SubIcon = sub.icon;
                                        const subActive = activeModule === sub.id;
                                        return (
                                          <button
                                            key={sub.id}
                                            type="button"
                                            onClick={() => navigateTo(sub.id)}
                                            className={`w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-semibold min-h-[40px] ${
                                              subActive ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
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
              <div className="text-[11px] text-slate-500 border-t border-slate-100 pt-3 mt-4">
                {currentUser.email}
              </div>
            </div>
            <div className="flex-1" onClick={() => setMobileNavOpen(false)} />
          </div>
        )}

        {/* Active Module Fluid Canvas */}
        <main className="flex-1 min-w-0 p-3 sm:p-5 pb-24 md:pb-8 overflow-y-auto overflow-x-auto scroll-rulers">
          <div className="max-w-7xl mx-auto space-y-3">
            {activeModule !== 'overview' &&
              activeModule !== 'appointments' &&
              activeModule !== 'config' &&
              !activeModule.startsWith('cad_') && (
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={handleGoBack}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 min-h-[38px]"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    <span>Voltar para a tela anterior</span>
                    <span className="hidden sm:inline text-slate-400 font-normal">({previousModMeta})</span>
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
              />
            )}
            {activeModule === 'admission' && (
              <AdmissionVaultModule
                units={allUnits}
                activeUnitId={activeUnitId}
                navIntent={navIntent}
                onClearIntent={clearIntent}
                onNavigate={navigateTo}
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
            {activeModule === 'config' && (
              <ConfigModule
                currentUser={currentUser}
                onUnitsUpdated={loadProfile}
                onBrandingUpdated={setPortalBranding}
                onGoBack={handleGoBack}
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
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 h-16 pb-safe bg-white/95 backdrop-blur-md border-t border-slate-200 grid grid-cols-5">
        {visibleNavItems.slice(0, 4).map((item) => {
          const Icon = item.icon;
          const active = activeModule === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => navigateTo(item.id)}
              className={`flex flex-col items-center justify-center gap-0.5 text-[10px] font-semibold min-h-[44px] ${
                active ? 'text-emerald-700' : 'text-slate-500'
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
          className="flex flex-col items-center justify-center gap-0.5 text-[10px] font-semibold text-slate-600 min-h-[44px]"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <form
            onSubmit={handlePasswordChangeSubmit}
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl space-y-4"
          >
            <h2 className="font-display text-lg font-bold text-slate-900">
              Defina sua Nova Senha Pessoal
            </h2>
            <p className="text-xs text-slate-600">
              Você acessou com uma senha temporária. Por política de segurança corporativa, cadastre uma nova senha definitiva (mínimo 6 caracteres) para continuar.
            </p>
            {passwordChangeErr && (
              <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
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
              className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm"
            />
            <button
              type="submit"
              disabled={passwordSaving}
              className="w-full rounded-lg bg-emerald-600 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700"
            >
              {passwordSaving ? 'Salvando...' : 'Atualizar Senha e Acessar'}
            </button>
          </form>
        </div>
      )}

      {/* Ivi Copilot Quick Modal */}
      {iviOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2.5">
                <img src={iviAvatarImg} alt="Ivi" className="w-8 h-8 rounded-full object-cover border border-blue-300 shadow-sm shrink-0" />
                <div>
                  <h3 className="font-display text-base font-bold text-slate-900">
                    Agente Ivi · Copiloto FinancePro
                  </h3>
                  <p className="text-[11px] text-slate-500">Sua assistente virtual simpática e inteligente</p>
                </div>
              </div>
              <button type="button" onClick={() => setIviOpen(false)} className="text-slate-400 hover:text-slate-700 p-1">
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-slate-500">
              Orquestração automática: Claude Code → OpenAI → Gemini → DeepSeek. Contexto atual: <strong>{activeNavMeta?.label || activeModule}</strong>.
            </p>
            <form onSubmit={handleAskIvi} className="space-y-3">
              <textarea
                rows={3}
                value={iviPrompt}
                onChange={(e) => setIviPrompt(e.target.value)}
                placeholder="Ex: Como estruturar a cobrança de busca e apreensão ou redigir resposta para cliente veicular?"
                className="w-full rounded-lg border border-slate-200 p-3 text-xs text-slate-900"
              />
              <button
                type="submit"
                disabled={iviBusy || !iviPrompt.trim()}
                className="rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-50"
              >
                {iviBusy ? 'Consultando cadeia Ivi...' : 'Enviar para Ivi'}
              </button>
            </form>
            {iviReply && (
              <div className="rounded-xl border border-blue-100 bg-blue-50/70 p-3.5 text-xs space-y-1.5">
                <div className="font-mono text-[10px] font-semibold text-blue-800">
                  Provedor que respondeu: {iviProvider}
                </div>
                <p className="text-slate-800 whitespace-pre-wrap leading-relaxed">{iviReply}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Central de Ajuda Corporativa Modal */}
      {helpOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
          onClick={() => setHelpOpen(false)}
        >
          <div
            className="w-full max-w-4xl rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <BookOpen className="w-4 h-4 text-emerald-600 shrink-0" />
                <h3 className="font-display text-base font-bold text-slate-900 truncate">
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
                    className="text-xs font-semibold text-blue-700 hover:underline"
                  >
                    Editar em Configurações
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setHelpOpen(false)}
                  aria-label="Fechar ajuda"
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="p-4 border-b border-slate-100 bg-slate-50/60">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  value={helpSearch}
                  onChange={(e) => setHelpSearch(e.target.value)}
                  placeholder="Filtrar tópicos por módulo, título, resumo ou palavra-chave..."
                  className="w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 py-2 text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
                />
              </div>
            </div>

            {helpLoading ? (
              <div className="p-8 text-center text-xs text-slate-500">
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
                    <div className="md:col-span-5 border-b md:border-b-0 md:border-r border-slate-200 overflow-y-auto divide-y divide-slate-100 max-h-60 md:max-h-none">
                      {filteredTopics.length === 0 ? (
                        <div className="p-6 text-center text-xs text-slate-500">
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
                                isSelected ? 'bg-blue-50/70' : 'hover:bg-slate-50'
                              }`}
                            >
                              <div className="font-mono text-[10px] font-semibold text-blue-700 truncate">
                                {topic.menuPath}
                              </div>
                              <div className="mt-0.5 text-xs font-bold text-slate-900">
                                {topic.title}
                              </div>
                              {topic.summary && (
                                <div className="mt-0.5 text-[11px] text-slate-500 line-clamp-2">
                                  {topic.summary}
                                </div>
                              )}
                            </button>
                          );
                        })
                      )}
                    </div>

                    <div className="md:col-span-7 p-5 overflow-y-auto space-y-3 text-xs text-slate-700">
                      {activeTopic ? (
                        <>
                          <div>
                            <div className="font-mono text-[11px] font-semibold text-blue-700">
                              {activeTopic.menuPath}
                            </div>
                            <h4 className="mt-1 font-display text-base font-bold text-slate-900">
                              {activeTopic.title}
                            </h4>
                            {activeTopic.summary && (
                              <p className="mt-1 text-xs text-slate-500">{activeTopic.summary}</p>
                            )}
                          </div>
                          <div
                            className="pt-3 border-t border-slate-100 space-y-2 leading-relaxed [&_h3]:font-display [&_h3]:text-sm [&_h3]:font-bold [&_h3]:text-slate-900 [&_ul]:list-disc [&_ul]:pl-5 [&_li]:mt-1 [&_strong]:text-slate-900"
                            dangerouslySetInnerHTML={{
                              __html: sanitizeHelpHtml(activeTopic.htmlContent),
                            }}
                          />
                        </>
                      ) : (
                        <div className="text-center py-8 text-slate-400">
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
