import React, { useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Copy,
  Edit3,
  Eye,
  Filter,
  History,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import type {
  Client,
  CompanyLegalProcess,
  Unit,
} from '../../../types.ts';
import { FormTemplateButton } from '../../FormTemplateButton.tsx';
import { CompanyLegalAuditHistoryModal } from './CompanyLegalAuditHistoryModal.tsx';
import {
  buildCompanyLegalMergeContext,
  formatDateBR,
  getUnitDisplayName,
  PROCESS_STATUSES,
  PROCESS_TYPES,
  RISK_BADGE_MAP,
  RISK_LEVELS,
  STATUS_BADGE_MAP,
} from './shared.ts';

interface CompanyLegalProcessListProps {
  processes: CompanyLegalProcess[];
  units: Unit[];
  clients: Client[];
  currentUserName: string;
  onCreateNew: () => void;
  onViewDetail: (proc: CompanyLegalProcess) => void;
  onEdit: (proc: CompanyLegalProcess) => void;
  onDuplicate: (proc: CompanyLegalProcess) => Promise<void>;
  onDelete: (proc: CompanyLegalProcess) => Promise<void>;
  onToast: (msg: string) => void;
}

type SortKey =
  | 'updatedAt'
  | 'processNumber'
  | 'court'
  | 'opposingParty'
  | 'partnerName'
  | 'type'
  | 'role'
  | 'riskLevel'
  | 'status'
  | 'responsibleLawyer'
  | 'lastMovementDate'
  | 'causeValue';

export const CompanyLegalProcessList: React.FC<CompanyLegalProcessListProps> = ({
  processes,
  units,
  clients,
  currentUserName,
  onCreateNew,
  onViewDetail,
  onEdit,
  onDuplicate,
  onDelete,
  onToast,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  // 7 filters
  const [filterType, setFilterType] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterRisk, setFilterRisk] = useState('');
  const [filterUnit, setFilterUnit] = useState('');
  const [filterPartner, setFilterPartner] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');

  // Sort & pagination
  const [sortKey, setSortKey] = useState<SortKey>('updatedAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Audit modal
  const [historyTarget, setHistoryTarget] = useState<{ id: number; processNumber: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CompanyLegalProcess | null>(null);
  const [deleting, setDeleting] = useState(false);

  const clientMap = useMemo(() => {
    const m = new Map<number, Client>();
    for (const c of clients) m.set(c.id, c);
    return m;
  }, [clients]);

  const hasAnyFilter = Boolean(
    searchTerm.trim() ||
      filterType ||
      filterStatus ||
      filterRisk ||
      filterUnit ||
      filterPartner.trim() ||
      filterDateFrom ||
      filterDateTo
  );

  const clearFilters = () => {
    setSearchTerm('');
    setFilterType('');
    setFilterStatus('');
    setFilterRisk('');
    setFilterUnit('');
    setFilterPartner('');
    setFilterDateFrom('');
    setFilterDateTo('');
    setPage(1);
  };

  const filteredProcesses = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    const pq = filterPartner.trim().toLowerCase();

    return processes.filter((p) => {
      const partner = p.partnerId ? clientMap.get(p.partnerId) : undefined;
      const partnerName = partner?.fullName || '';

      if (q) {
        const hay = [
          p.processNumber,
          p.court,
          p.jurisdiction,
          p.opposingParty,
          p.subject,
          p.responsibleLawyer,
          partnerName,
        ]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }

      if (filterType && p.type !== filterType) return false;
      if (filterStatus && p.status !== filterStatus) return false;
      if (filterRisk && p.riskLevel !== filterRisk) return false;
      if (filterUnit && String(p.unitId || '') !== filterUnit) return false;

      if (pq) {
        if (!partner) return false;
        const pHay = [partner.fullName, partner.cpfCnpj, partner.phone].join(' ').toLowerCase();
        if (!pHay.includes(pq)) return false;
      }

      if (filterDateFrom && (!p.distributionDate || p.distributionDate < filterDateFrom)) return false;
      if (filterDateTo && (!p.distributionDate || p.distributionDate > filterDateTo)) return false;

      return true;
    });
  }, [
    processes,
    clientMap,
    searchTerm,
    filterType,
    filterStatus,
    filterRisk,
    filterUnit,
    filterPartner,
    filterDateFrom,
    filterDateTo,
  ]);

  const sortedProcesses = useMemo(() => {
    const arr = [...filteredProcesses];
    arr.sort((a, b) => {
      const getVal = (p: CompanyLegalProcess): string => {
        if (sortKey === 'partnerName') {
          return (p.partnerId ? clientMap.get(p.partnerId)?.fullName : '') || '';
        }
        if (sortKey === 'updatedAt') return p.updatedAt || '';
        return String(p[sortKey as keyof CompanyLegalProcess] || '');
      };
      const va = getVal(a).toLowerCase();
      const vb = getVal(b).toLowerCase();
      if (va < vb) return sortDir === 'asc' ? -1 : 1;
      if (va > vb) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return arr;
  }, [filteredProcesses, sortKey, sortDir, clientMap]);

  const totalPages = Math.max(1, Math.ceil(sortedProcesses.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pagedProcesses = sortedProcesses.slice((safePage - 1) * pageSize, safePage * pageSize);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const renderSortIcon = (key: SortKey) => {
    if (sortKey !== key) return <ArrowUpDown className="w-3 h-3 text-slate-300" />;
    return sortDir === 'asc' ? (
      <ArrowUp className="w-3 h-3 text-slate-900" />
    ) : (
      <ArrowDown className="w-3 h-3 text-slate-900" />
    );
  };

  const pageNumbers = useMemo(() => {
    const pages: Array<number | '...'> = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (safePage > 3) pages.push('...');
      for (let i = Math.max(2, safePage - 1); i <= Math.min(totalPages - 1, safePage + 1); i++) {
        pages.push(i);
      }
      if (safePage < totalPages - 2) pages.push('...');
      pages.push(totalPages);
    }
    return pages;
  }, [safePage, totalPages]);

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await onDelete(deleteTarget);
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <h2 className="font-display text-lg font-bold text-slate-900">Processos Judiciais</h2>
          <p className="text-xs text-slate-500 tabular-nums">
            {filteredProcesses.length} processo(s) encontrado(s)
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <FormTemplateButton
            menuId="jur_processos"
            label="Formulários"
            getContext={() =>
              buildCompanyLegalMergeContext(pagedProcesses[0], clients, units, currentUserName)
            }
            onError={(msg) => onToast(msg)}
          />
          <button
            type="button"
            onClick={onCreateNew}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800"
          >
            <Plus className="w-4 h-4 text-emerald-400" /> Novo Processo
          </button>
        </div>
      </div>

      {/* Search & Filter Toggle */}
      <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setPage(1);
              }}
              placeholder="Buscar por número CNJ, vara, comarca, parte adversa, assunto, advogado ou parceiro..."
              className="w-full rounded-lg border border-slate-200 pl-9 pr-3 py-2 text-xs focus:border-blue-600 focus:outline-none"
            />
          </div>
          <button
            type="button"
            onClick={() => setShowFilters((v) => !v)}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold ${
              showFilters
                ? 'border-slate-900 bg-slate-900 text-white'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            <Filter className="w-3.5 h-3.5" /> Filtros
          </button>
          {hasAnyFilter && (
            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-100"
            >
              <X className="w-3.5 h-3.5" /> Limpar
            </button>
          )}
        </div>

        {/* 7-Filter Panel */}
        {showFilters && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-2.5 pt-2 border-t border-slate-100 text-xs">
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 mb-1">Tipo</label>
              <select
                value={filterType}
                onChange={(e) => {
                  setFilterType(e.target.value);
                  setPage(1);
                }}
                className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5"
              >
                <option value="">Todos</option>
                {PROCESS_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 mb-1">Status</label>
              <select
                value={filterStatus}
                onChange={(e) => {
                  setFilterStatus(e.target.value);
                  setPage(1);
                }}
                className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5"
              >
                <option value="">Todos</option>
                {PROCESS_STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 mb-1">Risco</label>
              <select
                value={filterRisk}
                onChange={(e) => {
                  setFilterRisk(e.target.value);
                  setPage(1);
                }}
                className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5"
              >
                <option value="">Todos</option>
                {RISK_LEVELS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 mb-1">Unidade</label>
              <select
                value={filterUnit}
                onChange={(e) => {
                  setFilterUnit(e.target.value);
                  setPage(1);
                }}
                className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5"
              >
                <option value="">Todas</option>
                {units.map((u) => (
                  <option key={u.id} value={String(u.id)}>
                    {getUnitDisplayName(u)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 mb-1">Parceiro</label>
              <input
                type="text"
                value={filterPartner}
                onChange={(e) => {
                  setFilterPartner(e.target.value);
                  setPage(1);
                }}
                placeholder="Nome / CPF / Tel..."
                className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 mb-1">Distribuição De</label>
              <input
                type="date"
                value={filterDateFrom}
                onChange={(e) => {
                  setFilterDateFrom(e.target.value);
                  setPage(1);
                }}
                className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 mb-1">Distribuição Até</label>
              <input
                type="date"
                value={filterDateTo}
                onChange={(e) => {
                  setFilterDateTo(e.target.value);
                  setPage(1);
                }}
                className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5"
              />
            </div>
          </div>
        )}
      </div>

      {/* 12-Column Sortable Table */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] font-semibold text-slate-600 whitespace-nowrap">
                <th className="px-3 py-2.5">
                  <button type="button" onClick={() => toggleSort('processNumber')} className="inline-flex items-center gap-1">
                    Nº Processo {renderSortIcon('processNumber')}
                  </button>
                </th>
                <th className="px-3 py-2.5">
                  <button type="button" onClick={() => toggleSort('court')} className="inline-flex items-center gap-1">
                    Vara/Comarca {renderSortIcon('court')}
                  </button>
                </th>
                <th className="px-3 py-2.5">
                  <button type="button" onClick={() => toggleSort('opposingParty')} className="inline-flex items-center gap-1">
                    Parte Adversa {renderSortIcon('opposingParty')}
                  </button>
                </th>
                <th className="px-3 py-2.5">
                  <button type="button" onClick={() => toggleSort('partnerName')} className="inline-flex items-center gap-1">
                    Parceiro {renderSortIcon('partnerName')}
                  </button>
                </th>
                <th className="px-3 py-2.5">
                  <button type="button" onClick={() => toggleSort('type')} className="inline-flex items-center gap-1">
                    Tipo {renderSortIcon('type')}
                  </button>
                </th>
                <th className="px-3 py-2.5">
                  <button type="button" onClick={() => toggleSort('role')} className="inline-flex items-center gap-1">
                    Papel {renderSortIcon('role')}
                  </button>
                </th>
                <th className="px-3 py-2.5">
                  <button type="button" onClick={() => toggleSort('riskLevel')} className="inline-flex items-center gap-1">
                    Risco {renderSortIcon('riskLevel')}
                  </button>
                </th>
                <th className="px-3 py-2.5">
                  <button type="button" onClick={() => toggleSort('status')} className="inline-flex items-center gap-1">
                    Status {renderSortIcon('status')}
                  </button>
                </th>
                <th className="px-3 py-2.5">
                  <button type="button" onClick={() => toggleSort('responsibleLawyer')} className="inline-flex items-center gap-1">
                    Advogado {renderSortIcon('responsibleLawyer')}
                  </button>
                </th>
                <th className="px-3 py-2.5">
                  <button type="button" onClick={() => toggleSort('lastMovementDate')} className="inline-flex items-center gap-1">
                    Últ. Mov. {renderSortIcon('lastMovementDate')}
                  </button>
                </th>
                <th className="px-3 py-2.5 text-right">
                  <button type="button" onClick={() => toggleSort('causeValue')} className="inline-flex items-center gap-1">
                    Valor {renderSortIcon('causeValue')}
                  </button>
                </th>
                <th className="px-3 py-2.5 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {pagedProcesses.length === 0 ? (
                <tr>
                  <td colSpan={12} className="px-4 py-10 text-center text-slate-400">
                    Nenhum processo encontrado.
                  </td>
                </tr>
              ) : (
                pagedProcesses.map((proc) => {
                  const partner = proc.partnerId ? clientMap.get(proc.partnerId) : undefined;
                  const riskMeta = RISK_BADGE_MAP[proc.riskLevel] || RISK_BADGE_MAP.MEDIO;
                  const statusMeta = STATUS_BADGE_MAP[proc.status] || STATUS_BADGE_MAP.ATIVO;

                  return (
                    <tr key={proc.id} className="hover:bg-slate-50/70">
                      <td className="px-3 py-2.5 font-mono text-[11px] font-semibold text-slate-900 whitespace-nowrap">
                        {proc.processNumber}
                      </td>
                      <td className="px-3 py-2.5 max-w-[160px]">
                        <div className="truncate font-medium text-slate-800">{proc.court || '-'}</div>
                        <div className="truncate text-[10px] text-slate-400">{proc.jurisdiction || '-'}</div>
                      </td>
                      <td className="px-3 py-2.5 max-w-[150px] truncate text-slate-700" title={proc.opposingParty}>
                        {proc.opposingParty || '-'}
                      </td>
                      <td className="px-3 py-2.5 max-w-[140px] truncate text-slate-600" title={partner?.fullName || '—'}>
                        {partner?.fullName || '—'}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700">
                          {proc.type}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <span className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-slate-700">
                          {proc.role}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <span className={`rounded border px-1.5 py-0.5 text-[10px] font-bold ${riskMeta.badgeClass}`}>
                          {riskMeta.label}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${statusMeta.badgeClass}`}>
                          {statusMeta.label}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 max-w-[120px] truncate text-slate-600">
                        {proc.responsibleLawyer || '-'}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap tabular-nums text-slate-600">
                        {formatDateBR(proc.lastMovementDate)}
                      </td>
                      <td className="px-3 py-2.5 text-right whitespace-nowrap font-mono tabular-nums text-slate-800">
                        {proc.causeValue ? `R$ ${proc.causeValue}` : '-'}
                      </td>
                      <td className="px-3 py-2.5 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setHistoryTarget({ id: proc.id, processNumber: proc.processNumber })}
                            title="Histórico de Movimentações"
                            className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100"
                          >
                            <History className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onViewDetail(proc)}
                            title="Ver Detalhes"
                            className="p-1.5 rounded-lg border border-slate-200 text-blue-700 hover:bg-blue-50"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onEdit(proc)}
                            title="Editar"
                            className="p-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-100"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => void onDuplicate(proc)}
                            title="Duplicar"
                            className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100"
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeleteTarget(proc)}
                            title="Excluir"
                            className="p-1.5 rounded-lg border border-red-200 text-red-700 hover:bg-red-50"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {sortedProcesses.length > 0 && (
          <div className="px-4 py-3 border-t border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-3 text-slate-600">
              <span>
                Mostrando {(safePage - 1) * pageSize + 1}–{Math.min(safePage * pageSize, sortedProcesses.length)} de{' '}
                {sortedProcesses.length}
              </span>
              <div className="hidden sm:flex items-center gap-1.5">
                <span>Por página:</span>
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setPage(1);
                  }}
                  className="rounded border border-slate-200 bg-white px-2 py-1 text-xs"
                >
                  {[5, 10, 20, 50, 100].map((sz) => (
                    <option key={sz} value={sz}>
                      {sz}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={safePage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="rounded border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-40"
              >
                Anterior
              </button>
              <div className="hidden sm:flex items-center gap-1">
                {pageNumbers.map((pn, idx) =>
                  pn === '...' ? (
                    <span key={`e-${idx}`} className="px-1.5 text-slate-400">
                      ...
                    </span>
                  ) : (
                    <button
                      key={pn}
                      type="button"
                      onClick={() => setPage(pn)}
                      className={`rounded border px-2.5 py-1 font-semibold tabular-nums ${
                        safePage === pn
                          ? 'border-slate-900 bg-slate-900 text-white'
                          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      {pn}
                    </button>
                  )
                )}
              </div>
              <span className="sm:hidden px-2 font-semibold tabular-nums">
                {safePage}/{totalPages}
              </span>
              <button
                type="button"
                disabled={safePage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="rounded border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-40"
              >
                Próxima
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Audit History Modal */}
      <CompanyLegalAuditHistoryModal
        open={Boolean(historyTarget)}
        processId={historyTarget?.id ?? null}
        processNumber={historyTarget?.processNumber || ''}
        onClose={() => setHistoryTarget(null)}
      />

      {/* Delete Confirmation Modal (avoids window.confirm inside iframe) */}
      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4"
          role="alertdialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl space-y-3 text-xs">
            <h4 className="text-sm font-bold text-slate-900">
              Excluir o processo <span className="font-mono">{deleteTarget.processNumber}</span>?
            </h4>
            <p className="text-slate-600">
              Esta ação removerá permanentemente o processo e todas as movimentações, prazos, audiências e anexos vinculados.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={deleting}
                onClick={() => setDeleteTarget(null)}
                className="rounded-lg border border-slate-300 bg-white px-4 py-1.5 font-semibold text-slate-700 hover:bg-slate-100"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={() => void handleConfirmDelete()}
                className="rounded-lg bg-red-600 px-4 py-1.5 font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? 'Excluindo...' : 'Excluir Processo'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
