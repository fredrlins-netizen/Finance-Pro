import React, { useMemo } from 'react';
import { FileText, Search, Users } from 'lucide-react';
import { formatBRL, formatDateBR } from '../../../lib/api.ts';
import type { Admission, Client, Negotiation } from '../../../types.ts';
import { NEGOTIATION_STATUS_CONFIG, type AvailableTitleRow } from './types.ts';

interface ClientPortfolioContainerProps {
  clients: Client[];
  admissions: Admission[];
  negotiations: Negotiation[];
  allReceberTitles: AvailableTitleRow[];
  dashboardClientId: string;
  onSelectClientId: (id: string) => void;
  clientSearch: string;
  onClientSearchChange: (val: string) => void;
  onOpenClientFicha: (clientId: number) => void;
  onOpenAdmissionFicha: (admissionId: number | null, clientId: number) => void;
  onSelectNegotiation: (negId: number) => void;
}

export const ClientPortfolioContainer: React.FC<ClientPortfolioContainerProps> = ({
  clients,
  admissions,
  negotiations,
  allReceberTitles,
  dashboardClientId,
  onSelectClientId,
  clientSearch,
  onClientSearchChange,
  onOpenClientFicha,
  onOpenAdmissionFicha,
  onSelectNegotiation,
}) => {
  const clientIdNum = Number(dashboardClientId || 0);
  const selectedClient = useMemo(
    () => clients.find((c) => c.id === clientIdNum) || null,
    [clients, clientIdNum]
  );

  const clientAdmissions = useMemo(
    () => admissions.filter((a) => a.clientId === clientIdNum),
    [admissions, clientIdNum]
  );

  const clientNegotiations = useMemo(
    () => negotiations.filter((n) => n.clientId === clientIdNum),
    [negotiations, clientIdNum]
  );

  const clientTitles = useMemo(
    () => allReceberTitles.filter((t) => t.clientId === clientIdNum),
    [allReceberTitles, clientIdNum]
  );

  const totalDebtCents = clientAdmissions.reduce((s, a) => s + (a.debtAmountCents || 0), 0);
  const totalOpenTitlesCents = clientTitles
    .filter((t) => t.status !== 'PAGO' && t.status !== 'CANCELADO')
    .reduce((s, t) => s + (t.currentBalanceCents || t.amountCents), 0);
  const totalSavingsCents = clientNegotiations.reduce((s, n) => s + (n.estimatedSavingsCents || 0), 0);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3 flex-1 min-w-0">
          <div className="relative w-full sm:w-64">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={clientSearch}
              onChange={(e) => onClientSearchChange(e.target.value)}
              placeholder="Filtrar cliente..."
              className="w-full rounded-lg border border-slate-300 pl-8 pr-3 py-1.5 text-xs"
            />
          </div>

          <select
            value={dashboardClientId}
            onChange={(e) => onSelectClientId(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-800 min-w-[240px] max-w-full bg-white"
          >
            {clients
              .filter((c) =>
                !clientSearch.trim()
                  ? true
                  : `${c.fullName} ${c.cpfCnpj}`.toLowerCase().includes(clientSearch.toLowerCase())
              )
              .map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.fullName} ({c.cpfCnpj})
                </option>
              ))}
          </select>
        </div>

        {clientIdNum > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onOpenClientFicha(clientIdNum)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap"
            >
              <Users className="w-3.5 h-3.5 text-blue-600" />
              Ficha Completa
            </button>
            <button
              type="button"
              onClick={() => onOpenAdmissionFicha(clientAdmissions[0]?.id || null, clientIdNum)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap"
            >
              <FileText className="w-3.5 h-3.5 text-emerald-600" />
              Dossiê Admissão
            </button>
          </div>
        )}
      </div>

      {selectedClient && (
        <div className="space-y-4">
          {/* Single KPI summary bar */}
          <div className="grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-slate-200 rounded-xl border border-slate-200 bg-white">
            <div className="p-4">
              <div className="text-[11px] font-semibold uppercase text-slate-500">Contratos Vinculados</div>
              <div className="font-mono tabular-nums text-xl font-bold text-slate-900 mt-1">
                {clientAdmissions.length}
              </div>
              <div className="text-[11px] text-slate-500 font-mono tabular-nums mt-0.5">
                Passivo: {formatBRL(totalDebtCents)}
              </div>
            </div>
            <div className="p-4">
              <div className="text-[11px] font-semibold uppercase text-slate-500">Títulos em Aberto</div>
              <div className="font-mono tabular-nums text-xl font-bold text-red-600 mt-1">
                {formatBRL(totalOpenTitlesCents)}
              </div>
              <div className="text-[11px] text-slate-500 font-mono tabular-nums mt-0.5">
                {clientTitles.length} título(s) emitido(s)
              </div>
            </div>
            <div className="p-4">
              <div className="text-[11px] font-semibold uppercase text-slate-500">Negociações Bancárias</div>
              <div className="font-mono tabular-nums text-xl font-bold text-blue-700 mt-1">
                {clientNegotiations.length}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">Processos com mesas de acordo</div>
            </div>
            <div className="p-4">
              <div className="text-[11px] font-semibold uppercase text-slate-500">Economia Obtida / Meta</div>
              <div className="font-mono tabular-nums text-xl font-bold text-emerald-700 mt-1">
                {formatBRL(totalSavingsCents)}
              </div>
              <div className="text-[11px] text-emerald-700 mt-0.5">Redução estimada no passivo</div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2.5">
              <h3 className="font-display text-xs font-bold uppercase tracking-wider text-slate-800 border-b border-slate-100 pb-2">
                Contratos & Dossiês ({clientAdmissions.length})
              </h3>
              {clientAdmissions.length === 0 ? (
                <div className="text-xs text-slate-500 py-4">Nenhum contrato vinculado a este cliente.</div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {clientAdmissions.map((adm) => (
                    <div key={adm.id} className="flex items-center justify-between py-2.5 text-xs gap-2">
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-900 truncate">
                          {adm.bankName} · Contrato {adm.contractNumber}
                        </div>
                        <div className="text-[11px] text-slate-500 font-mono tabular-nums">
                          {adm.protocolCode} · Dívida: {formatBRL(adm.debtAmountCents)}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => onOpenAdmissionFicha(adm.id, selectedClient.id)}
                        className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 shrink-0 whitespace-nowrap"
                      >
                        Abrir Ficha
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2.5">
              <h3 className="font-display text-xs font-bold uppercase tracking-wider text-slate-800 border-b border-slate-100 pb-2">
                Negociações do Cliente ({clientNegotiations.length})
              </h3>
              {clientNegotiations.length === 0 ? (
                <div className="text-xs text-slate-500 py-4">Nenhuma negociação aberta para este cliente.</div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {clientNegotiations.map((n) => {
                    const stCfg =
                      NEGOTIATION_STATUS_CONFIG[n.negotiationStatus || 'EM_ANDAMENTO'] ||
                      NEGOTIATION_STATUS_CONFIG.EM_ANDAMENTO;
                    return (
                      <div key={n.id} className="flex items-center justify-between py-2.5 text-xs gap-2">
                        <div className="min-w-0">
                          <div className="font-semibold text-slate-900 truncate">
                            {n.bankName} · {n.contractNumber}
                          </div>
                          <div className="text-[11px] text-slate-500 font-mono tabular-nums">
                            Abertura: {formatDateBR(n.openDate || '')} · Desc. {n.currentReductionPct}% ·{' '}
                            <span className="font-sans font-semibold text-slate-700">{stCfg.label}</span>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => onSelectNegotiation(n.id)}
                          className="rounded-lg bg-slate-900 px-3 py-1 text-[11px] font-semibold text-white hover:bg-slate-800 shrink-0 whitespace-nowrap"
                        >
                          Gerenciar
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
