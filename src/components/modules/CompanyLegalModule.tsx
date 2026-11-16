import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarClock, LayoutDashboard, List, Scale } from 'lucide-react';
import { apiFetch } from '../../lib/api.ts';
import type {
  AuthUser,
  Client,
  CollaboratorItem,
  CompanyLegalProcess,
  ModuleId,
  Unit,
} from '../../types.ts';
import { CompanyLegalDashboard } from './companylegal/CompanyLegalDashboard.tsx';
import { CompanyLegalProcessList } from './companylegal/CompanyLegalProcessList.tsx';
import { CompanyLegalProcessForm } from './companylegal/CompanyLegalProcessForm.tsx';
import { CompanyLegalProcessDetail } from './companylegal/CompanyLegalProcessDetail.tsx';
import { CompanyLegalDeadlinesPanel } from './companylegal/CompanyLegalDeadlinesPanel.tsx';

interface CompanyLegalModuleProps {
  activeSubmenu: ModuleId;
  currentUser: AuthUser;
  units: Unit[];
  wsTick: number;
  onNavigate: (mod: ModuleId) => void;
}

export const CompanyLegalModule: React.FC<CompanyLegalModuleProps> = ({
  activeSubmenu,
  currentUser,
  units: initialUnits,
  wsTick,
  onNavigate,
}) => {
  const [processes, setProcesses] = useState<CompanyLegalProcess[]>([]);
  const [dashboardProcesses, setDashboardProcesses] = useState<CompanyLegalProcess[]>([]);
  const [units, setUnits] = useState<Unit[]>(initialUnits);
  const [clients, setClients] = useState<Client[]>([]);
  const [collaborators, setCollaborators] = useState<CollaboratorItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

  // Processos screen sub-states: LIST | FORM | DETAIL
  const [processViewMode, setProcessViewMode] = useState<'LIST' | 'FORM' | 'DETAIL'>('LIST');
  const [selectedProcess, setSelectedProcess] = useState<CompanyLegalProcess | null>(null);

  const resolvedView: 'jur_dashboard' | 'jur_processos' | 'jur_prazos' =
    activeSubmenu === 'jur_processos'
      ? 'jur_processos'
      : activeSubmenu === 'jur_prazos'
      ? 'jur_prazos'
      : 'jur_dashboard';

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(''), 4000);
  }, []);

  const loadBootstrap = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{
        processes: CompanyLegalProcess[];
        units: Unit[];
        clients: Client[];
        collaborators: CollaboratorItem[];
      }>('/api/company-legal/bootstrap');
      setProcesses(Array.isArray(res.processes) ? res.processes : []);
      if (Array.isArray(res.units) && res.units.length > 0) setUnits(res.units);
      setClients(Array.isArray(res.clients) ? res.clients : []);
      setCollaborators(Array.isArray(res.collaborators) ? res.collaborators : []);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erro ao carregar Acompanhamento Jurídico.');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  const loadDashboardData = useCallback(async () => {
    try {
      const res = await apiFetch<{ data: CompanyLegalProcess[] }>('/api/company-legal/dashboard-data');
      setDashboardProcesses(Array.isArray(res.data) ? res.data : []);
    } catch {
      // fallback to bootstrap processes if jur_dashboard specific endpoint is unavailable
    }
  }, []);

  useEffect(() => {
    void loadBootstrap();
  }, [loadBootstrap, wsTick]);

  useEffect(() => {
    if (resolvedView === 'jur_dashboard') {
      void loadDashboardData();
    }
  }, [resolvedView, loadDashboardData, wsTick]);

  // Reset subview mode when switching away from jur_processos
  useEffect(() => {
    if (resolvedView !== 'jur_processos') {
      setProcessViewMode('LIST');
      setSelectedProcess(null);
    }
  }, [resolvedView]);

  const activeDetailProcess = useMemo(() => {
    if (!selectedProcess) return null;
    return processes.find((p) => p.id === selectedProcess.id) || selectedProcess;
  }, [processes, selectedProcess]);

  const handleSaveProcess = async (payload: CompanyLegalProcess) => {
    setSaving(true);
    try {
      const isEdit = Boolean(payload.id && Number(payload.id) > 0);
      const res = isEdit
        ? await apiFetch<{ data: CompanyLegalProcess }>(`/api/company-legal/processes/${payload.id}`, {
            method: 'PUT',
            body: JSON.stringify(payload),
          })
        : await apiFetch<{ data: CompanyLegalProcess }>('/api/company-legal/processes', {
            method: 'POST',
            body: JSON.stringify(payload),
          });

      const saved = res.data;
      setProcesses((prev) => {
        const exists = prev.some((p) => p.id === saved.id);
        return exists ? prev.map((p) => (p.id === saved.id ? saved : p)) : [saved, ...prev];
      });
      setDashboardProcesses((prev) => {
        const exists = prev.some((p) => p.id === saved.id);
        return exists ? prev.map((p) => (p.id === saved.id ? saved : p)) : [saved, ...prev];
      });
      setSelectedProcess(saved);
      setProcessViewMode('LIST');
      showToast(isEdit ? 'Processo atualizado com sucesso.' : 'Processo cadastrado com sucesso.');
      if (resolvedView === 'jur_dashboard') void loadDashboardData();
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateProcessInPlace = async (updated: CompanyLegalProcess) => {
    const res = await apiFetch<{ data: CompanyLegalProcess }>(
      `/api/company-legal/processes/${updated.id}`,
      {
        method: 'PUT',
        body: JSON.stringify(updated),
      }
    );
    const saved = res.data;
    setProcesses((prev) => prev.map((p) => (p.id === saved.id ? saved : p)));
    setDashboardProcesses((prev) => prev.map((p) => (p.id === saved.id ? saved : p)));
    if (selectedProcess?.id === saved.id) setSelectedProcess(saved);
    showToast('Registro jurídico atualizado.');
  };

  const handleDuplicateProcess = async (proc: CompanyLegalProcess) => {
    const clonePayload: CompanyLegalProcess = {
      ...proc,
      id: 0,
      processNumber: `${proc.processNumber} (CÓPIA)`,
      movements: [],
      deadlines: [],
      hearings: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const res = await apiFetch<{ data: CompanyLegalProcess }>('/api/company-legal/processes', {
      method: 'POST',
      body: JSON.stringify(clonePayload),
    });
    const saved = res.data;
    setProcesses((prev) => [saved, ...prev]);
    setDashboardProcesses((prev) => [saved, ...prev]);
    showToast(`Processo ${proc.processNumber} duplicado.`);
  };

  const handleDeleteProcess = async (proc: CompanyLegalProcess) => {
    await apiFetch(`/api/company-legal/processes/${proc.id}`, { method: 'DELETE' });
    setProcesses((prev) => prev.filter((p) => p.id !== proc.id));
    setDashboardProcesses((prev) => prev.filter((p) => p.id !== proc.id));
    if (selectedProcess?.id === proc.id) {
      setSelectedProcess(null);
      setProcessViewMode('LIST');
    }
    showToast(`Processo ${proc.processNumber} excluído.`);
  };

  return (
    <div className="space-y-4">
      {/* Sub-navigation strip aligned with sidebar */}
      <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-slate-900 text-emerald-400 flex items-center justify-center shrink-0">
            <Scale className="w-4 h-4" />
          </div>
          <div>
            <h1 className="font-display text-sm font-bold text-slate-900">Acompanhamento Jurídico</h1>
            <p className="text-[11px] text-slate-500">
              Governança · Gestão de Processos Judiciais da Empresa
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => onNavigate('jur_dashboard')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
              resolvedView === 'jur_dashboard'
                ? 'bg-slate-900 text-white'
                : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            <LayoutDashboard className="w-3.5 h-3.5" /> Dashboard
          </button>
          <button
            type="button"
            onClick={() => onNavigate('jur_processos')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
              resolvedView === 'jur_processos'
                ? 'bg-slate-900 text-white'
                : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            <List className="w-3.5 h-3.5" /> Processos
          </button>
          <button
            type="button"
            onClick={() => onNavigate('jur_prazos')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
              resolvedView === 'jur_prazos'
                ? 'bg-slate-900 text-white'
                : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            <CalendarClock className="w-3.5 h-3.5" /> Prazos e Audiências
          </button>
        </div>
      </div>

      {toast && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-semibold text-emerald-800">
          {toast}
        </div>
      )}

      {resolvedView === 'jur_dashboard' && (
        <CompanyLegalDashboard
          processes={dashboardProcesses.length > 0 ? dashboardProcesses : processes}
          units={units}
          collaborators={collaborators}
          loading={loading}
        />
      )}

      {resolvedView === 'jur_processos' && (
        <>
          {processViewMode === 'DETAIL' && activeDetailProcess ? (
            <CompanyLegalProcessDetail
              process={activeDetailProcess}
              units={units}
              clients={clients}
              collaborators={collaborators}
              currentUserName={currentUser.name}
              onBack={() => {
                setProcessViewMode('LIST');
                setSelectedProcess(null);
              }}
              onUpdateProcess={handleUpdateProcessInPlace}
              onToast={showToast}
            />
          ) : (
            <CompanyLegalProcessList
              processes={processes}
              units={units}
              clients={clients}
              currentUserName={currentUser.name}
              onCreateNew={() => {
                setSelectedProcess(null);
                setProcessViewMode('FORM');
              }}
              onViewDetail={(proc) => {
                setSelectedProcess(proc);
                setProcessViewMode('DETAIL');
              }}
              onEdit={(proc) => {
                setSelectedProcess(proc);
                setProcessViewMode('FORM');
              }}
              onDuplicate={handleDuplicateProcess}
              onDelete={handleDeleteProcess}
              onToast={showToast}
            />
          )}

          {processViewMode === 'FORM' && (
            <CompanyLegalProcessForm
              process={selectedProcess}
              units={units}
              clients={clients}
              collaborators={collaborators}
              currentUser={currentUser}
              saving={saving}
              onSave={handleSaveProcess}
              onClose={() => {
                setProcessViewMode('LIST');
                setSelectedProcess(null);
              }}
            />
          )}
        </>
      )}

      {resolvedView === 'jur_prazos' && (
        <CompanyLegalDeadlinesPanel
          processes={processes}
          collaborators={collaborators}
          onUpdateProcess={handleUpdateProcessInPlace}
        />
      )}
    </div>
  );
};
