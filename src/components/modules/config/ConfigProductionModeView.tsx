import React, { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  Lock,
  RefreshCw,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import { apiFetch } from '../../../lib/api.ts';

export interface ProductionModeStatusData {
  locked: boolean;
  activatedAt: string | null;
  activatedByName: string | null;
  activatedByEmail: string | null;
  lastPurgeAt: string | null;
  lastPurgedCounts: Record<string, number> | null;
  counts: {
    clients: number;
    admissions: number;
    financialTitles: number;
    bankAccounts: number;
    bankMovements: number;
    legalProcesses: number;
    negotiations: number;
    prospectionLeads: number;
    appointments: number;
    collaborators: number;
    banks: number;
    documents: number;
    demoUsers: number;
    totalOperationalRecords: number;
  };
}

interface ProductionModeBannerCardProps {
  status: ProductionModeStatusData | null;
  loading: boolean;
  onRefresh: () => void;
  onOpenModal: () => void;
}

function formatPtDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('pt-BR');
}

export const ProductionModeBannerCard: React.FC<ProductionModeBannerCardProps> = ({
  status,
  loading,
  onRefresh,
  onOpenModal,
}) => {
  const locked = Boolean(status?.locked);
  const c = status?.counts;

  return (
    <div
      className={`rounded-xl border p-5 space-y-4 ${
        locked
          ? 'border-emerald-200 bg-emerald-50/70 dark:border-emerald-800/70 dark:bg-emerald-950/30'
          : 'border-amber-200 bg-amber-50/70 dark:border-amber-800/70 dark:bg-amber-950/25'
      }`}
    >
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${
                locked
                  ? 'border-emerald-300 bg-emerald-100 text-emerald-900 dark:border-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-200'
                  : 'border-amber-300 bg-amber-100 text-amber-900 dark:border-amber-700 dark:bg-amber-900/60 dark:text-amber-200'
              }`}
            >
              {locked ? <Lock className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
              {locked ? 'Modo Produção Ativo · Trava Permanente no Banco' : 'Ambiente com Seed de Demonstração Liberado'}
            </span>
          </div>
          <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
            Limpeza de Dados Fictícios &amp; Bloqueio Permanente de Re-Seed (Exclusivo Admin)
          </h2>
          <p className="text-xs text-slate-600 dark:text-slate-300 max-w-3xl">
            {locked ? (
              <>
                A trava permanente <strong>production_mode_lock</strong> está gravada no PostgreSQL. Mesmo que tabelas
                operacionais fiquem vazias, nenhuma rotina de seed automático voltará a inserir dados fictícios.
              </>
            ) : (
              <>
                Remove todos os registros fictícios/operacionais de teste (clientes, admissões, boletos, leads,
                processos, negociações, movimentações bancárias e usuários de demonstração), preservando seu usuário
                Administrador, Unidades, Grupos RBAC e os formulários Folha de Rosto, gravando uma trava permanente no
                banco de dados.
              </>
            )}
          </p>
          {locked && status?.activatedAt && (
            <div className="text-[11px] font-mono text-emerald-800 dark:text-emerald-300">
              Ativado em {formatPtDateTime(status.activatedAt)} por {status.activatedByName || 'Administrador'} (
              {status.activatedByEmail || 'admin'})
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            disabled={loading}
            onClick={onRefresh}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Atualizar Contagem</span>
          </button>
          <button
            type="button"
            onClick={onOpenModal}
            className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-bold shadow-xs ${
              locked
                ? 'border border-emerald-700 bg-emerald-700 text-white hover:bg-emerald-800'
                : 'bg-rose-600 text-white hover:bg-rose-700'
            }`}
          >
            {locked ? <ShieldCheck className="w-4 h-4" /> : <Trash2 className="w-4 h-4" />}
            <span>
              {locked
                ? 'Modo Produção Ativo · Ver Trava'
                : 'Limpar Dados Fictícios / Modo Produção'}
            </span>
          </button>
        </div>
      </div>

      {c && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 pt-1">
          {[
            { label: 'Clientes / Fornec.', val: c.clients },
            { label: 'Admissões / Dossiês', val: c.admissions },
            { label: 'Títulos Financeiros', val: c.financialTitles },
            { label: 'Leads / Agenda', val: c.prospectionLeads + c.appointments },
            { label: 'Jurídico / Negoc.', val: c.legalProcesses + c.negotiations },
            { label: 'Usuários Demo', val: c.demoUsers },
          ].map((item) => (
            <div
              key={item.label}
              className="rounded-lg border border-slate-200/80 bg-white/90 px-3 py-2 dark:border-slate-700 dark:bg-slate-900/90"
            >
              <div className="text-[11px] text-slate-500 dark:text-slate-400">{item.label}</div>
              <div className="mt-0.5 font-mono text-sm font-bold text-slate-900 tabular-nums dark:text-slate-100">
                {item.val}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

interface ProductionModeConfirmModalProps {
  open: boolean;
  status: ProductionModeStatusData | null;
  onClose: () => void;
  onActivated: (nextStatus: ProductionModeStatusData) => Promise<void> | void;
  onToast: (msg: string) => void;
}

export const ProductionModeConfirmModal: React.FC<ProductionModeConfirmModalProps> = ({
  open,
  status,
  onClose,
  onActivated,
  onToast,
}) => {
  const [confirmInput, setConfirmInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  if (!open) return null;

  const locked = Boolean(status?.locked);
  const c = status?.counts;
  const normalizedConfirm = confirmInput
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();
  const canConfirm = !locked && normalizedConfirm === 'MODO PRODUCAO' && !submitting;

  const handleConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canConfirm) return;
    setSubmitting(true);
    setErrorMsg('');
    try {
      const res = await apiFetch<{
        ok: boolean;
        status: ProductionModeStatusData;
        preservedUsersCount: number;
      }>('/api/admin/production-mode/clean', {
        method: 'POST',
        body: JSON.stringify({ confirmationText: 'MODO PRODUCAO' }),
      });
      setConfirmInput('');
      await onActivated(res.status);
      onToast(
        'Modo Produção ativado com trava permanente no PostgreSQL! Dados fictícios removidos e cadastro administrativo preservado.'
      );
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao ativar Modo Produção.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs">
      <div className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div
              className={`flex h-9 w-9 items-center justify-center rounded-lg ${
                locked
                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                  : 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
              }`}
            >
              {locked ? <Lock className="w-5 h-5" /> : <Database className="w-5 h-5" />}
            </div>
            <div>
              <h3 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                {locked
                  ? 'Modo Produção Ativo (Trava Permanente no Banco)'
                  : 'Limpar Dados Fictícios / Ativar Modo Produção'}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Governança → Configurações &amp; SQL · Trava permanente anti-reseed no PostgreSQL
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setErrorMsg('');
              setConfirmInput('');
              onClose();
            }}
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 text-xs max-h-[80vh] overflow-y-auto">
          {locked ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 space-y-2 dark:border-emerald-800/70 dark:bg-emerald-950/40">
                <div className="flex items-center gap-2 font-bold text-emerald-900 dark:text-emerald-200">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Trava Permanente Gravada em system_settings (production_mode_lock)</span>
                </div>
                <p className="text-emerald-800 dark:text-emerald-300">
                  Este banco de dados está travado em <strong>Modo Produção</strong>. Nenhuma rotina de bootstrap ou
                  inicialização voltará a criar clientes, admissões, títulos, bancos, contatos ou usuários fictícios,
                  mesmo se todas as tabelas operacionais estiverem vazias.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 font-mono text-[11px] text-emerald-900 dark:text-emerald-200">
                  <div>Ativado por: {status?.activatedByName || 'Administrador'}</div>
                  <div>Data/Hora: {formatPtDateTime(status?.activatedAt || null)}</div>
                </div>
              </div>

              {status?.lastPurgedCounts && (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 space-y-2 dark:border-slate-700 dark:bg-slate-800/60">
                  <div className="font-bold text-slate-800 dark:text-slate-100">
                    Resumo da Limpeza Executada ({formatPtDateTime(status.lastPurgeAt)})
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 font-mono text-[11px]">
                    {Object.entries(status.lastPurgedCounts)
                      .filter(([, count]) => count > 0)
                      .map(([table, count]) => (
                        <div
                          key={table}
                          className="flex items-center justify-between rounded border border-slate-200 bg-white px-2.5 py-1.5 dark:border-slate-700 dark:bg-slate-900"
                        >
                          <span className="truncate text-slate-600 dark:text-slate-300">{table}</span>
                          <span className="font-bold text-slate-900 dark:text-slate-100 ml-2">{count}</span>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white hover:bg-slate-800 dark:bg-emerald-600 dark:hover:bg-emerald-500"
                >
                  Fechar
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleConfirm} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="rounded-xl border border-rose-200 bg-rose-50/80 p-3.5 space-y-2 dark:border-rose-900/70 dark:bg-rose-950/35">
                  <div className="font-bold text-rose-900 dark:text-rose-200">
                    Será REMOVIDO do Banco de Dados:
                  </div>
                  <ul className="space-y-1 text-rose-800 dark:text-rose-300 font-mono text-[11px]">
                    <li>• Clientes &amp; Fornecedores: {c?.clients ?? 0}</li>
                    <li>• Fichas de Admissão &amp; Dossiês: {c?.admissions ?? 0}</li>
                    <li>• Documentos no Vault (metadados): {c?.documents ?? 0}</li>
                    <li>• Títulos Financeiros &amp; Baixas: {c?.financialTitles ?? 0}</li>
                    <li>• Contas ({c?.bankAccounts ?? 0}) &amp; Mov. Bancários ({c?.bankMovements ?? 0})</li>
                    <li>• Processos Jurídicos: {c?.legalProcesses ?? 0}</li>
                    <li>• Negociações &amp; Oportunidades: {c?.negotiations ?? 0}</li>
                    <li>• Leads ({c?.prospectionLeads ?? 0}) &amp; Agenda ({c?.appointments ?? 0})</li>
                    <li>• Colaboradores ({c?.collaborators ?? 0}) &amp; Bancos Credores ({c?.banks ?? 0})</li>
                    <li>• Usuários Demo (@financepro.com.br): {c?.demoUsers ?? 0}</li>
                  </ul>
                </div>

                <div className="rounded-xl border border-emerald-200 bg-emerald-50/80 p-3.5 space-y-2 dark:border-emerald-900/70 dark:bg-emerald-950/35">
                  <div className="font-bold text-emerald-900 dark:text-emerald-200">
                    Será PRESERVADO Intacto:
                  </div>
                  <ul className="space-y-1 text-emerald-800 dark:text-emerald-300 text-[11px]">
                    <li>• Seu usuário Administrador atual e usuários reais criados</li>
                    <li>• Unidades / Filiais e Grupos RBAC (permissões)</li>
                    <li>• Formulários Folha de Rosto (Veículo e Cartão de Crédito)</li>
                    <li>• Modelos de Relatórios, Checklist de Auditoria &amp; Central de Ajuda</li>
                    <li>• Catálogo oficial FEBRABAN, Plano de Contas &amp; Modalidades</li>
                    <li>• Credenciais WhatsApp UaZapi, Canais GoTalk &amp; Agendamentos de Backup</li>
                    <li>• Identidade Visual do Portal &amp; Documentação Ivi</li>
                  </ul>
                </div>
              </div>

              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-amber-900 space-y-1 dark:border-amber-800/70 dark:bg-amber-950/35 dark:text-amber-200">
                <div className="font-bold flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5" />
                  <span>Trava Permanente Anti-Reinserção</span>
                </div>
                <p>
                  Após confirmar, esta ação gravará a chave permanente{' '}
                  <code className="font-mono font-bold">production_mode_lock = true</code> no banco. Nenhuma função de
                  seed voltará a criar dados de demonstração, mesmo com tabelas operacionais zeradas.
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="block font-bold text-slate-800 dark:text-slate-100">
                  Para confirmar, digite <span className="font-mono text-rose-600 dark:text-rose-400">MODO PRODUCAO</span>:
                </label>
                <input
                  type="text"
                  value={confirmInput}
                  onChange={(e) => setConfirmInput(e.target.value)}
                  placeholder="MODO PRODUCAO"
                  autoComplete="off"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs uppercase text-slate-900 focus:border-rose-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>

              {errorMsg && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-700 dark:border-red-800 dark:bg-red-950/50 dark:text-red-300">
                  {errorMsg}
                </div>
              )}

              <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => {
                    setErrorMsg('');
                    setConfirmInput('');
                    onClose();
                  }}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={!canConfirm}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-4 py-2 font-bold text-white hover:bg-rose-700 disabled:opacity-45 disabled:cursor-not-allowed"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>{submitting ? 'Limpando & Gravando Trava...' : 'Confirmar Limpeza & Ativar Modo Produção'}</span>
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
