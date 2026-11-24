import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, History } from 'lucide-react';
import { apiFetch } from '../../lib/api.ts';
import {
  AuthUser,
  CadastrosBootstrapPayload,
  MeasurementUnitItem,
  ModuleId,
  NavigationIntent,
  ProductItem,
  Unit,
} from '../../types.ts';
import { CadastrosClientsView } from './cadastros/CadastrosClientsView.tsx';
import { CollaboratorsCrudView, DepartmentsCrudView, RolesCrudView } from './cadastros/CadastrosOrgViews.tsx';
import {
  BanksCrudView,
  ModalitiesCrudView,
  ProductsCrudView,
  SeriesCrudView,
} from './cadastros/CadastrosCommercialViews.tsx';
import { EntityAuditModal } from './cadastros/CadastrosShared.tsx';

export type CadastrosSubmenuId =
  | 'cad_clientes'
  | 'cad_cargos'
  | 'cad_colaboradores'
  | 'cad_departamentos'
  | 'cad_bancos'
  | 'cad_modalidades'
  | 'cad_produtos'
  | 'cad_series';

const SUBMENU_LABELS: Array<{ id: CadastrosSubmenuId; label: string; entityType: string }> = [
  { id: 'cad_clientes', label: 'Clientes', entityType: 'clients' },
  { id: 'cad_cargos', label: 'Cargos', entityType: 'roles' },
  { id: 'cad_colaboradores', label: 'Colaboradores', entityType: 'collaborators' },
  { id: 'cad_departamentos', label: 'Departamentos', entityType: 'departments' },
  { id: 'cad_bancos', label: 'Bancos', entityType: 'banks' },
  { id: 'cad_modalidades', label: 'Modalidades', entityType: 'modalities' },
  { id: 'cad_produtos', label: 'Produtos', entityType: 'products,measurement_units' },
  { id: 'cad_series', label: 'Série/Números', entityType: 'series' },
];

interface CadastrosComunsModuleProps {
  activeSubmenu: CadastrosSubmenuId;
  units: Unit[];
  activeUnitId: number;
  currentUser: AuthUser;
  navIntent?: NavigationIntent | null;
  onClearIntent?: () => void;
  onNavigate: (mod: ModuleId, intent?: NavigationIntent) => void;
  onGoBack?: () => void;
  previousScreenLabel?: string;
  onCatalogUpdated?: () => void;
}

export const CadastrosComunsModule: React.FC<CadastrosComunsModuleProps> = ({
  activeSubmenu,
  units,
  activeUnitId,
  currentUser,
  navIntent,
  onClearIntent,
  onNavigate,
  onGoBack,
  previousScreenLabel,
  onCatalogUpdated,
}) => {
  const [bootstrap, setBootstrap] = useState<CadastrosBootstrapPayload>({
    banks: [],
    febrabanBanks: [],
    modalities: [],
    series: [],
    collaborators: [],
    roles: [],
    departments: [],
    maritalStatuses: ['Solteiro(a)', 'Casado(a)', 'Divorciado(a)', 'Viúvo(a)', 'União Estável', 'Separado(a)'],
  });
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [measurementUnits, setMeasurementUnits] = useState<MeasurementUnitItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [auditOpen, setAuditOpen] = useState(false);

  const activeSubmenuMeta = SUBMENU_LABELS.find((s) => s.id === activeSubmenu) || SUBMENU_LABELS[0];

  const loadAll = useCallback(async () => {
    setErr('');
    try {
      const [boot, prods, mUnits] = await Promise.all([
        apiFetch<CadastrosBootstrapPayload>('/api/cadastros/bootstrap'),
        apiFetch<{ data: ProductItem[] }>('/api/cadastros/products'),
        apiFetch<{ data: MeasurementUnitItem[] }>('/api/cadastros/measurement-units'),
      ]);
      setBootstrap(boot);
      setProducts(prods.data || []);
      setMeasurementUnits(mUnits.data || []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erro ao carregar Cadastros Comuns.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const handleRefresh = useCallback(async () => {
    await loadAll();
    onCatalogUpdated?.();
  }, [loadAll, onCatalogUpdated]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-1">
        {onGoBack && (
          <button
            type="button"
            onClick={onGoBack}
            className="inline-flex items-center gap-1.5 self-start rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-700 min-h-[38px] shrink-0"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Voltar para a tela anterior</span>
            {previousScreenLabel && (
              <span className="hidden sm:inline text-slate-400 font-normal dark:text-slate-400">({previousScreenLabel})</span>
            )}
          </button>
        )}

        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scroll-rulers">
          {SUBMENU_LABELS.map((sub) => {
            const active = activeSubmenu === sub.id;
            return (
              <button
                key={sub.id}
                type="button"
                onClick={() => onNavigate(sub.id)}
                className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold whitespace-nowrap shrink-0 min-h-[36px] transition-colors ${
                  active
                    ? 'border-slate-900 bg-slate-900 text-white dark:border-emerald-500 dark:bg-emerald-600'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800'
                }`}
              >
                {sub.label}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setAuditOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0 min-h-[36px] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <History className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
            Auditoria
          </button>
        </div>
      </div>

      {err && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-medium text-red-700 dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300">
          {err}
        </div>
      )}

      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
          Carregando base corporativa de Cadastros Comuns...
        </div>
      ) : (
        <div className="overflow-x-auto scroll-rulers pb-1">
          {activeSubmenu === 'cad_clientes' && (
            <CadastrosClientsView
              units={units}
              activeUnitId={activeUnitId}
              currentUser={currentUser}
              maritalStatuses={bootstrap.maritalStatuses}
              onMaritalStatusesChange={(next) => setBootstrap((p) => ({ ...p, maritalStatuses: next }))}
              onCatalogUpdated={onCatalogUpdated}
              navIntent={navIntent}
              onClearIntent={onClearIntent}
              onNavigate={onNavigate}
            />
          )}

          {activeSubmenu === 'cad_cargos' && (
            <RolesCrudView roles={bootstrap.roles} onRefresh={handleRefresh} />
          )}

          {activeSubmenu === 'cad_colaboradores' && (
            <CollaboratorsCrudView
              collaborators={bootstrap.collaborators}
              roles={bootstrap.roles}
              departments={bootstrap.departments}
              units={units}
              activeUnitId={activeUnitId}
              maritalStatuses={bootstrap.maritalStatuses}
              onMaritalStatusesChange={(next) => setBootstrap((p) => ({ ...p, maritalStatuses: next }))}
              onRefresh={handleRefresh}
            />
          )}

          {activeSubmenu === 'cad_departamentos' && (
            <DepartmentsCrudView departments={bootstrap.departments} onRefresh={handleRefresh} />
          )}

          {activeSubmenu === 'cad_bancos' && (
            <BanksCrudView
              banks={bootstrap.banks}
              febrabanBanks={bootstrap.febrabanBanks}
              modalities={bootstrap.modalities}
              onRefresh={handleRefresh}
            />
          )}

          {activeSubmenu === 'cad_modalidades' && (
            <ModalitiesCrudView modalities={bootstrap.modalities} onRefresh={handleRefresh} />
          )}

          {activeSubmenu === 'cad_produtos' && (
            <ProductsCrudView products={products} measurementUnits={measurementUnits} onRefresh={handleRefresh} />
          )}

          {activeSubmenu === 'cad_series' && (
            <SeriesCrudView seriesList={bootstrap.series} units={units} onRefresh={handleRefresh} />
          )}
        </div>
      )}

      <EntityAuditModal
        open={auditOpen}
        title={`Cadastros Comuns · ${activeSubmenuMeta.label} · Auditoria Cumulativa`}
        entityType={activeSubmenuMeta.entityType}
        entityId="all"
        onClose={() => setAuditOpen(false)}
      />
    </div>
  );
};

