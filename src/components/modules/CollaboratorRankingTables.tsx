import React, { useMemo, useState } from 'react';
import { Monitor, Search, Trophy, TrendingUp } from 'lucide-react';
import { formatBRL } from '../../lib/api.ts';
import {
  CollaboratorItem,
  CollectionCase,
  CollectionNote,
  FinancialTitle,
  TitleSettlement,
} from '../../types.ts';

interface CollaboratorRankingTablesProps {
  titles: FinancialTitle[];
  settlements?: TitleSettlement[];
  collaborators: CollaboratorItem[];
  operators?: Array<{ id: number; name: string; role: string; points?: number }>;
  notes?: CollectionNote[];
  cases?: CollectionCase[];
  unitFilter?: string;
  onMirrorOperator?: (collaboratorId: number) => void;
}

interface RankingRow {
  key: string;
  collaboratorId: number | null;
  name: string;
  role: string;
  settledTitlesCount: number;
  closedAgreementsCount: number;
  closedRecoveriesCount: number;
  recoveredCents: number;
  avgTicketCents: number;
  openCount: number;
  openBalanceCents: number;
}

type RankingPeriod = 'all' | 'month' | '30d';

const EXCLUDED_TITLE_STATUSES = new Set([
  'CANCELADO',
  'AGRUPADO',
  'FATURA_GERADA',
  'ADIANTAMENTO',
  'ADIANTAMENTO_PARCIAL',
  'DEVOLUCAO',
  'DEVOLUCAO_VINCULADA',
  'DEVOLUCAO_PARCIAL',
]);

function toIsoDate(val: string | null | undefined): string {
  if (!val) return '';
  const s = String(val);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

export const CollaboratorRankingTables: React.FC<CollaboratorRankingTablesProps> = ({
  titles,
  settlements = [],
  collaborators,
  operators = [],
  notes = [],
  cases = [],
  unitFilter = 'all',
  onMirrorOperator,
}) => {
  const [period, setPeriod] = useState<RankingPeriod>('all');
  const [search, setSearch] = useState('');

  const { byCount, byValue, totalClosures, totalRecoveredCents } = useMemo(() => {
    const now = new Date();
    const currentMonthPrefix = now.toISOString().slice(0, 7);
    const cutoff30Iso = new Date(now.getTime() - 30 * 86_400_000).toISOString().slice(0, 10);

    const matchesPeriod = (dateVal: string | null | undefined): boolean => {
      if (period === 'all') return true;
      const iso = toIsoDate(dateVal);
      if (!iso) return false;
      if (period === 'month') return iso.startsWith(currentMonthPrefix);
      return iso >= cutoff30Iso;
    };

    const collabById = new Map<number, CollaboratorItem>();
    const collabByUserId = new Map<number, CollaboratorItem>();
    const userById = new Map(operators.map((u) => [u.id, u]));

    interface Accumulator {
      key: string;
      collaboratorId: number | null;
      name: string;
      role: string;
      settledTitleIds: Set<number>;
      closedAgreementsCount: number;
      extraClosedNoteKeys: Set<string>;
      recoveredCents: number;
      openCount: number;
      openBalanceCents: number;
    }

    const accMap = new Map<string, Accumulator>();

    const ensureBucket = (
      key: string,
      info: { collaboratorId: number | null; name: string; role: string }
    ): Accumulator => {
      const existing = accMap.get(key);
      if (existing) return existing;
      const created: Accumulator = {
        key,
        collaboratorId: info.collaboratorId,
        name: info.name,
        role: info.role,
        settledTitleIds: new Set<number>(),
        closedAgreementsCount: 0,
        extraClosedNoteKeys: new Set<string>(),
        recoveredCents: 0,
        openCount: 0,
        openBalanceCents: 0,
      };
      accMap.set(key, created);
      return created;
    };

    for (const c of collaborators) {
      collabById.set(c.id, c);
      if (c.userId != null) collabByUserId.set(c.userId, c);
      if (c.active !== false) {
        ensureBucket(`collab-${c.id}`, {
          collaboratorId: c.id,
          name: c.name,
          role: c.jobTitle || 'Colaborador de Cobrança',
        });
      }
    }

    const caseByTitleId = new Map<number, CollectionCase>();
    for (const cs of cases) {
      caseByTitleId.set(cs.titleId, cs);
    }

    const resolveOwnerForUserId = (uId: number | null | undefined): Accumulator | null => {
      if (!uId) return null;
      const linkedCollab = collabByUserId.get(uId);
      if (linkedCollab) {
        return ensureBucket(`collab-${linkedCollab.id}`, {
          collaboratorId: linkedCollab.id,
          name: linkedCollab.name,
          role: linkedCollab.jobTitle || 'Colaborador de Cobrança',
        });
      }
      const userObj = userById.get(uId);
      if (userObj) {
        return ensureBucket(`user-${userObj.id}`, {
          collaboratorId: null,
          name: userObj.name,
          role: userObj.role || 'Operador',
        });
      }
      return null;
    };

    const resolveTitleOwner = (t: FinancialTitle): Accumulator => {
      if (t.assignedCollaboratorId && collabById.has(t.assignedCollaboratorId)) {
        const col = collabById.get(t.assignedCollaboratorId)!;
        return ensureBucket(`collab-${col.id}`, {
          collaboratorId: col.id,
          name: col.name,
          role: col.jobTitle || 'Colaborador de Cobrança',
        });
      }
      if (t.collectorId) {
        const owner = resolveOwnerForUserId(t.collectorId);
        if (owner) return owner;
      }
      const linkedCase = caseByTitleId.get(t.id);
      if (linkedCase?.assignedCollectorId) {
        const owner = resolveOwnerForUserId(linkedCase.assignedCollectorId);
        if (owner) return owner;
      }
      return ensureBucket('unassigned', {
        collaboratorId: null,
        name: 'Sem Atribuição Direta',
        role: 'Carteira Geral',
      });
    };

    const eligibleTitles = titles.filter((t) => {
      if (unitFilter !== 'all' && String(t.unitId) !== unitFilter) return false;
      if ((t.scope || 'RECEBER') !== 'RECEBER') return false;
      if (String(t.titleType || 'PADRAO').toUpperCase() !== 'PADRAO') return false;
      const st = String(t.status || 'ABERTO').trim().toUpperCase();
      if (st === 'PAGO' || st === 'PARCIAL') return true;
      return !EXCLUDED_TITLE_STATUSES.has(st);
    });

    const titleById = new Map(eligibleTitles.map((t) => [t.id, t]));
    const settlementsByTitle = new Map<number, TitleSettlement[]>();
    for (const s of settlements) {
      if (!titleById.has(s.titleId)) continue;
      const list = settlementsByTitle.get(s.titleId) || [];
      list.push(s);
      settlementsByTitle.set(s.titleId, list);
    }

    for (const t of eligibleTitles) {
      const owner = resolveTitleOwner(t);
      const st = String(t.status || 'ABERTO').trim().toUpperCase();
      const orig = Number(t.originalValueCents || t.amountCents || 0);
      const bal = Number(t.currentBalanceCents ?? t.amountCents ?? 0);
      const linkedSettlements = settlementsByTitle.get(t.id) || [];

      if (st !== 'PAGO') {
        owner.openCount += 1;
        owner.openBalanceCents += bal;
      }

      if (linkedSettlements.length > 0) {
        let matchedAnyPeriod = false;
        for (const s of linkedSettlements) {
          if (!matchesPeriod(s.settlementDate || s.createdAt)) continue;
          const val = Number(s.amountCents || 0);
          if (val > 0) {
            owner.recoveredCents += val;
            matchedAnyPeriod = true;
          }
        }
        if (matchedAnyPeriod) {
          owner.settledTitleIds.add(t.id);
        }
      } else if (st === 'PAGO') {
        if (matchesPeriod(t.paidAt || t.updatedAt || t.dueDate)) {
          owner.settledTitleIds.add(t.id);
          owner.recoveredCents += orig;
        }
      } else if (orig > bal && (st === 'PARCIAL' || bal > 0)) {
        if (matchesPeriod(t.paidAt || t.updatedAt || t.dueDate)) {
          owner.settledTitleIds.add(t.id);
          owner.recoveredCents += Math.max(0, orig - bal);
        }
      } else {
        const linkedCase = caseByTitleId.get(t.id);
        if (linkedCase && linkedCase.status === 'pago' && matchesPeriod(t.updatedAt || t.dueDate)) {
          owner.settledTitleIds.add(t.id);
          owner.recoveredCents += orig;
        }
      }
    }

    // Acordos com fechamento registrados em collectionNotes (FECHADA)
    for (const n of notes) {
      if (unitFilter !== 'all' && n.unitId && String(n.unitId) !== unitFilter) continue;
      if (String(n.negotiationStatus || '').toUpperCase() !== 'FECHADA') continue;
      if (!matchesPeriod(n.contactDate || n.createdAt)) continue;

      let owner: Accumulator | null = null;
      if (n.collaboratorId && collabById.has(n.collaboratorId)) {
        const col = collabById.get(n.collaboratorId)!;
        owner = ensureBucket(`collab-${col.id}`, {
          collaboratorId: col.id,
          name: col.name,
          role: col.jobTitle || 'Colaborador de Cobrança',
        });
      } else if (n.userId) {
        owner = resolveOwnerForUserId(n.userId);
      }
      if (!owner && n.titleId && titleById.has(n.titleId)) {
        owner = resolveTitleOwner(titleById.get(n.titleId)!);
      }
      if (!owner) continue;

      owner.closedAgreementsCount += 1;
      if (!n.titleId || !owner.settledTitleIds.has(n.titleId)) {
        owner.extraClosedNoteKeys.add(n.titleId ? `title-${n.titleId}` : `note-${n.id}`);
      }
    }

    const q = search.trim().toLowerCase();

    const rows: RankingRow[] = [...accMap.values()]
      .filter((a) => {
        // Só exibe "Sem Atribuição Direta" se houver fechamentos ou valores recuperados atribuídos a ela
        if (a.key === 'unassigned') {
          return a.settledTitleIds.size > 0 || a.recoveredCents > 0;
        }
        return true;
      })
      .map((a) => {
        const settledTitlesCount = a.settledTitleIds.size;
        const closedRecoveriesCount = settledTitlesCount + a.extraClosedNoteKeys.size;
        const avgTicketCents =
          closedRecoveriesCount > 0 ? Math.round(a.recoveredCents / closedRecoveriesCount) : 0;
        return {
          key: a.key,
          collaboratorId: a.collaboratorId,
          name: a.name,
          role: a.role,
          settledTitlesCount,
          closedAgreementsCount: a.closedAgreementsCount,
          closedRecoveriesCount,
          recoveredCents: a.recoveredCents,
          avgTicketCents,
          openCount: a.openCount,
          openBalanceCents: a.openBalanceCents,
        };
      })
      .filter((r) => {
        if (!q) return true;
        return r.name.toLowerCase().includes(q) || r.role.toLowerCase().includes(q);
      });

    const sortedByCount = [...rows].sort(
      (a, b) =>
        b.closedRecoveriesCount - a.closedRecoveriesCount ||
        b.recoveredCents - a.recoveredCents ||
        b.closedAgreementsCount - a.closedAgreementsCount ||
        a.name.localeCompare(b.name)
    );

    const sortedByValue = [...rows].sort(
      (a, b) =>
        b.recoveredCents - a.recoveredCents ||
        b.closedRecoveriesCount - a.closedRecoveriesCount ||
        a.name.localeCompare(b.name)
    );

    const closuresSum = rows.reduce((s, r) => s + r.closedRecoveriesCount, 0);
    const recoveredSum = rows.reduce((s, r) => s + r.recoveredCents, 0);

    return {
      byCount: sortedByCount,
      byValue: sortedByValue,
      totalClosures: closuresSum,
      totalRecoveredCents: recoveredSum,
    };
  }, [titles, settlements, collaborators, operators, notes, cases, unitFilter, period, search]);

  return (
    <div className="space-y-4">
      {/* Barra de Filtro do Ranking */}
      <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 dark:border-slate-700 dark:bg-slate-900">
        <div>
          <h2 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
            Ranking dos Colaboradores de Cobrança
          </h2>
          <p className="text-xs text-slate-500 font-mono tabular-nums mt-0.5 dark:text-slate-400">
            {totalClosures} recuperação(ões) com fechamento · {formatBRL(totalRecoveredCents)} recuperados no recorte
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2 dark:text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filtrar colaborador..."
              className="w-44 sm:w-52 rounded-lg border border-slate-200 bg-slate-50/50 pl-8 pr-3 py-1.5 text-xs text-slate-900 focus:border-slate-400 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-100 dark:focus:bg-slate-900"
            />
          </div>

          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg border border-slate-200 dark:bg-slate-800 dark:border-slate-700">
            {(
              [
                { id: 'all', label: 'Todo Período' },
                { id: 'month', label: 'Mês Atual' },
                { id: '30d', label: 'Últimos 30d' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setPeriod(opt.id)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md whitespace-nowrap shrink-0 transition-colors ${
                  period === opt.id
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-slate-100'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* As 2 Tabelas Oficiais de Ranking */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 items-start">
        {/* TABELA 01: QUANTIDADE DE RECUPERAÇÕES COM FECHAMENTO */}
        <section className="rounded-xl border border-slate-200 bg-white overflow-hidden dark:border-slate-700 dark:bg-slate-900">
          <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-2 dark:border-slate-700">
            <div className="flex items-center gap-2 min-w-0">
              <Trophy className="w-4 h-4 text-amber-600 shrink-0 dark:text-amber-400" />
              <div className="min-w-0">
                <h3 className="font-display text-sm font-bold text-slate-900 truncate dark:text-slate-100">
                  01. Quantidade de Recuperações com Fechamento
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Classificação por volume de quitações, baixas parciais e acordos fechados
                </p>
              </div>
            </div>
            <span className="font-mono text-xs font-semibold text-slate-500 tabular-nums shrink-0 dark:text-slate-400">
              {byCount.length} colab.
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600 dark:bg-slate-800/70 dark:border-slate-700 dark:text-slate-300">
                <tr>
                  <th className="py-2.5 px-3 w-12">Pos.</th>
                  <th className="py-2.5 px-3">Colaborador</th>
                  <th className="py-2.5 px-3 text-right whitespace-nowrap">Baixas / Títulos</th>
                  <th className="py-2.5 px-3 text-right whitespace-nowrap">Acordos Fechados</th>
                  <th className="py-2.5 px-4 text-right whitespace-nowrap">Qtd. Fechamentos</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {byCount.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-10 text-center text-slate-400 dark:text-slate-400">
                      Nenhum colaborador encontrado neste filtro.
                    </td>
                  </tr>
                ) : (
                  byCount.map((row, idx) => (
                    <tr key={row.key} className="hover:bg-slate-50/70 dark:hover:bg-slate-800">
                      <td className="py-2.5 px-3 font-mono font-bold tabular-nums text-slate-500 dark:text-slate-400">
                        <span className={idx < 3 && row.closedRecoveriesCount > 0 ? 'text-slate-900 dark:text-slate-100' : 'text-slate-400 dark:text-slate-500'}>
                          {idx + 1}º
                        </span>
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-slate-900 dark:text-slate-100">{row.name}</span>
                          {onMirrorOperator && row.collaboratorId && (
                            <button
                              type="button"
                              onClick={() => onMirrorOperator(row.collaboratorId!)}
                              title={`Espelhar tela de ${row.name}`}
                              className="p-0.5 rounded text-slate-400 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-white dark:hover:bg-slate-800"
                            >
                              <Monitor className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">{row.role}</div>
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-700 dark:text-slate-200">
                        {row.settledTitlesCount}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-700 dark:text-slate-200">
                        {row.closedAgreementsCount}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums font-bold text-slate-900 dark:text-slate-100">
                        {row.closedRecoveriesCount}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              {byCount.length > 0 && (
                <tfoot className="bg-slate-50 border-t border-slate-200 text-xs font-bold text-slate-800 dark:bg-slate-800/70 dark:border-slate-700 dark:text-slate-100">
                  <tr>
                    <td colSpan={2} className="py-2.5 px-3">
                      Total da Equipe
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                      {byCount.reduce((s, r) => s + r.settledTitlesCount, 0)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                      {byCount.reduce((s, r) => s + r.closedAgreementsCount, 0)}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-900 dark:text-slate-100">
                      {totalClosures}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </section>

        {/* TABELA 02: MAIOR VALOR FINANCEIRO DE RECUPERAÇÃO ALCANÇADO */}
        <section className="rounded-xl border border-slate-200 bg-white overflow-hidden dark:border-slate-700 dark:bg-slate-900">
          <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-2 dark:border-slate-700">
            <div className="flex items-center gap-2 min-w-0">
              <TrendingUp className="w-4 h-4 text-emerald-700 shrink-0 dark:text-emerald-300" />
              <div className="min-w-0">
                <h3 className="font-display text-sm font-bold text-slate-900 truncate dark:text-slate-100">
                  02. Maior Valor Financeiro de Recuperação Alcançado
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Classificação por montante financeiro efetivamente recuperado no período
                </p>
              </div>
            </div>
            <span className="font-mono text-xs font-semibold text-emerald-700 tabular-nums shrink-0 dark:text-emerald-300">
              {formatBRL(totalRecoveredCents)}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600 dark:bg-slate-800/70 dark:border-slate-700 dark:text-slate-300">
                <tr>
                  <th className="py-2.5 px-3 w-12">Pos.</th>
                  <th className="py-2.5 px-3">Colaborador</th>
                  <th className="py-2.5 px-3 text-right whitespace-nowrap">Fechamentos</th>
                  <th className="py-2.5 px-3 text-right whitespace-nowrap">Ticket Médio</th>
                  <th className="py-2.5 px-4 text-right whitespace-nowrap">Valor Recuperado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {byValue.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-10 text-center text-slate-400 dark:text-slate-400">
                      Nenhum colaborador encontrado neste filtro.
                    </td>
                  </tr>
                ) : (
                  byValue.map((row, idx) => (
                    <tr key={row.key} className="hover:bg-slate-50/70 dark:hover:bg-slate-800">
                      <td className="py-2.5 px-3 font-mono font-bold tabular-nums text-slate-500 dark:text-slate-400">
                        <span className={idx < 3 && row.recoveredCents > 0 ? 'text-slate-900 dark:text-slate-100' : 'text-slate-400 dark:text-slate-500'}>
                          {idx + 1}º
                        </span>
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-slate-900 dark:text-slate-100">{row.name}</span>
                          {onMirrorOperator && row.collaboratorId && (
                            <button
                              type="button"
                              onClick={() => onMirrorOperator(row.collaboratorId!)}
                              title={`Espelhar tela de ${row.name}`}
                              className="p-0.5 rounded text-slate-400 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-white dark:hover:bg-slate-800"
                            >
                              <Monitor className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">{row.role}</div>
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-700 dark:text-slate-200">
                        {row.closedRecoveriesCount}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300">
                        {formatBRL(row.avgTicketCents)}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums font-bold text-emerald-700 dark:text-emerald-300">
                        {formatBRL(row.recoveredCents)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              {byValue.length > 0 && (
                <tfoot className="bg-slate-50 border-t border-slate-200 text-xs font-bold text-slate-800 dark:bg-slate-800/70 dark:border-slate-700 dark:text-slate-100">
                  <tr>
                    <td colSpan={2} className="py-2.5 px-3">
                      Total Recuperado
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                      {totalClosures}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300">
                      {formatBRL(totalClosures > 0 ? Math.round(totalRecoveredCents / totalClosures) : 0)}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums text-emerald-800 dark:text-emerald-300">
                      {formatBRL(totalRecoveredCents)}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </section>
      </div>
    </div>
  );
};
