import React from 'react';
import { Car, FileSpreadsheet, Scale, UserCheck, Users } from 'lucide-react';
import { formatBRL, formatDateBR, formatDateTimeBR } from '../../../lib/api.ts';
import { Admission, Client, LegalMovement, LegalProcess, RecalcScenario, Unit } from '../../../types.ts';

interface AuditDossierSummaryTabProps {
  admission: Admission;
  client?: Client | null;
  titular?: Client | null;
  unit?: Unit | null;
  recalcScenarios: RecalcScenario[];
  legalProcesses: LegalProcess[];
  legalMovements: LegalMovement[];
  isElectricVehicle: boolean;
  onToggleElectricVehicle: (val: boolean) => void;
}

export const AuditDossierSummaryTab: React.FC<AuditDossierSummaryTabProps> = ({
  admission,
  client,
  titular,
  unit,
  recalcScenarios,
  legalProcesses,
  legalMovements,
  isElectricVehicle,
  onToggleElectricVehicle,
}) => {
  const scenariosFromJson = Array.isArray(admission.scenariosJson) ? admission.scenariosJson : [];
  const computedServiceTotal =
    (admission.serviceMgmtCents || 0) +
    (admission.serviceInitialCents || 0) -
    (admission.serviceDiscountCents || 0) +
    (admission.serviceAdditionCents || 0);

  return (
    <div className="space-y-4 text-xs">
      {/* 01.A Responsável + 01.B Titular */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-2.5 dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2 dark:border-slate-800">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2 dark:text-slate-100">
              <UserCheck className="w-4 h-4 text-blue-700 dark:text-blue-300" />
              Responsável / Contratante
            </h3>
            <span className="font-mono text-[11px] font-semibold text-slate-500 dark:text-slate-400">
              {admission.clientRoleSelected?.toUpperCase() || 'RESPONSÁVEL'}
            </span>
          </div>
          {client ? (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
              <div className="col-span-2">
                <dt className="text-[11px] text-slate-500 dark:text-slate-400">Nome Completo</dt>
                <dd className="font-semibold text-slate-900 dark:text-slate-100">{client.fullName}</dd>
              </div>
              <div>
                <dt className="text-[11px] text-slate-500 dark:text-slate-400">CPF / CNPJ</dt>
                <dd className="font-mono text-slate-900 dark:text-slate-100">{client.cpfCnpj || '—'}</dd>
              </div>
              <div>
                <dt className="text-[11px] text-slate-500 dark:text-slate-400">RG</dt>
                <dd className="font-mono text-slate-900 dark:text-slate-100">{client.rg || '—'}</dd>
              </div>
              <div>
                <dt className="text-[11px] text-slate-500 dark:text-slate-400">Telefone / WhatsApp</dt>
                <dd className="font-mono text-slate-900 dark:text-slate-100">{client.phone || client.whatsapp || '—'}</dd>
              </div>
              <div>
                <dt className="text-[11px] text-slate-500 dark:text-slate-400">E-mail</dt>
                <dd className="text-slate-900 truncate dark:text-slate-100">{client.email || '—'}</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-[11px] text-slate-500 dark:text-slate-400">Endereço</dt>
                <dd className="text-slate-700 dark:text-slate-200">
                  {[client.address, client.addressNumber, client.neighborhood, client.city, client.state, client.zipCode]
                    .filter(Boolean)
                    .join(', ') || 'Não informado'}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="text-slate-500 dark:text-slate-400">Cadastro do cliente não localizado.</p>
          )}
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-2.5 dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2 dark:border-slate-800">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2 dark:text-slate-100">
              <Users className="w-4 h-4 text-slate-700 dark:text-slate-200" />
              Titular do Contrato / Unidade & Origem
            </h3>
            <span className="text-[11px] text-slate-500 dark:text-slate-400">{unit?.name || 'Matriz'}</span>
          </div>

          {titular ? (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 pb-2 border-b border-slate-100 dark:border-slate-800">
              <div className="col-span-2">
                <dt className="text-[11px] text-slate-500 dark:text-slate-400">Titular Vinculado (Contrato em nome de terceiro)</dt>
                <dd className="font-semibold text-amber-800 dark:text-amber-300">{titular.fullName}</dd>
              </div>
              <div>
                <dt className="text-[11px] text-slate-500 dark:text-slate-400">CPF / CNPJ Titular</dt>
                <dd className="font-mono text-slate-900 dark:text-slate-100">{titular.cpfCnpj || '—'}</dd>
              </div>
              <div>
                <dt className="text-[11px] text-slate-500 dark:text-slate-400">Telefone Titular</dt>
                <dd className="font-mono text-slate-900 dark:text-slate-100">{titular.phone || '—'}</dd>
              </div>
            </dl>
          ) : (
            <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-slate-600 dark:border-slate-800 dark:bg-slate-800/70 dark:text-slate-300">
              O próprio contratante figura como titular do bem/contrato.
            </div>
          )}

          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 pt-1">
            <div>
              <dt className="text-[11px] text-slate-500 dark:text-slate-400">Consultor / Vendedor</dt>
              <dd className="font-semibold text-slate-900 dark:text-slate-100">{admission.consultantName || '—'}</dd>
            </div>
            <div>
              <dt className="text-[11px] text-slate-500 dark:text-slate-400">Série / Data Admissão</dt>
              <dd className="font-mono text-slate-900 dark:text-slate-100">
                {admission.series || 'ADM'} · {formatDateBR(admission.createdAt)}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] text-slate-500 dark:text-slate-400">Origem</dt>
              <dd className="text-slate-900 dark:text-slate-100">{admission.origin || '—'}</dd>
            </div>
            <div>
              <dt className="text-[11px] text-slate-500 dark:text-slate-400">Indicação</dt>
              <dd className="text-slate-900 dark:text-slate-100">{admission.indicationSource || admission.indicationOther || '—'}</dd>
            </div>
          </dl>
        </section>
      </div>

      {/* 02. Contrato Financeiro & Composição de Honorários */}
      <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-3 dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-100 pb-2 dark:border-slate-800">
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2 dark:text-slate-100">
            <FileSpreadsheet className="w-4 h-4 text-emerald-700 dark:text-emerald-300" />
            Dados do Contrato Bancário & Honorários
          </h3>
          <span className="font-mono text-xs font-bold text-slate-700 dark:text-slate-200">
            #{admission.contractNumber} · {admission.bankName}
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
          <div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">Modalidade</div>
            <div className="font-semibold text-slate-900 dark:text-slate-100">{admission.modality || admission.debtType}</div>
          </div>
          <div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">Valor Financiado</div>
            <div className="font-mono font-semibold text-slate-900 tabular-nums dark:text-slate-100">
              {formatBRL(admission.financedAmountCents || admission.debtAmountCents)}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">Passivo Declarado</div>
            <div className="font-mono font-bold text-slate-900 tabular-nums dark:text-slate-100">
              {formatBRL(admission.debtAmountCents)}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">Parcela Atual (Banco)</div>
            <div className="font-mono font-semibold text-slate-900 tabular-nums dark:text-slate-100">
              {formatBRL(admission.currentInstallmentCents)} · Dia {admission.debtDueDay || 10}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">Situação Parcelas</div>
            <div className="font-mono text-slate-900 tabular-nums dark:text-slate-100">
              {admission.debtPaidInstallments || 0} pagas ·{' '}
              <span className={(admission.debtOverdueInstallments || 0) > 0 ? 'text-red-700 font-bold dark:text-red-300' : ''}>
                {admission.debtOverdueInstallments || 0} atraso
              </span>{' '}
              / {admission.debtTotalInstallments || 48}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">2x Boletos Iniciais</div>
            <div className="font-mono font-bold text-emerald-700 tabular-nums dark:text-emerald-300">
              {formatBRL(admission.initialInstallmentCents)} ({admission.installmentsCount}x)
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 pt-2 border-t border-slate-100 bg-slate-50/70 rounded-lg p-3 dark:border-slate-800 dark:bg-slate-800/60">
          <div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">Gestão / Parc. 01</div>
            <div className="font-mono font-semibold text-slate-900 tabular-nums dark:text-slate-100">
              {formatBRL(admission.serviceMgmtCents)}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">Custos Iniciais</div>
            <div className="font-mono font-semibold text-slate-900 tabular-nums dark:text-slate-100">
              {formatBRL(admission.serviceInitialCents)}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">Desconto / Acréscimo</div>
            <div className="font-mono text-slate-700 tabular-nums dark:text-slate-200">
              -{formatBRL(admission.serviceDiscountCents)} / +{formatBRL(admission.serviceAdditionCents)}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">Taxa de Cobrança</div>
            <div className="font-mono font-semibold text-slate-900 tabular-nums dark:text-slate-100">
              {formatBRL(admission.billingFeeCents)}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">Total Honorários</div>
            <div className="font-mono font-bold text-slate-900 tabular-nums dark:text-slate-100">
              {formatBRL(admission.serviceFeeCents || computedServiceTotal)}
            </div>
          </div>
        </div>
      </section>

      {/* 03. Veículo & Flag Elétrico */}
      <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-3 dark:border-slate-700 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2 dark:border-slate-800">
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2 dark:text-slate-100">
            <Car className="w-4 h-4 text-slate-700 dark:text-slate-200" />
            Dados do Bem / Veículo
          </h3>
          <label className="inline-flex items-center gap-2 font-semibold text-slate-800 cursor-pointer dark:text-slate-100">
            <input
              type="checkbox"
              checked={isElectricVehicle}
              onChange={(e) => onToggleElectricVehicle(e.target.checked)}
              className="rounded border-slate-300 dark:border-slate-600"
            />
            <span className={isElectricVehicle ? 'text-red-700 font-bold dark:text-red-300' : 'text-slate-700 dark:text-slate-200'}>
              Veículo Elétrico / Híbrido (Bloqueia conclusão padrão)
            </span>
          </label>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
          <div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">Marca</div>
            <div className="font-semibold text-slate-900 dark:text-slate-100">{admission.vehicleBrand || '—'}</div>
          </div>
          <div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">Modelo</div>
            <div className="font-semibold text-slate-900 dark:text-slate-100">{admission.vehicleModel || admission.vehicleInfo || '—'}</div>
          </div>
          <div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">Cor</div>
            <div className="text-slate-900 dark:text-slate-100">{admission.vehicleColor || '—'}</div>
          </div>
          <div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">Ano</div>
            <div className="font-mono text-slate-900 dark:text-slate-100">{admission.vehicleYear || '—'}</div>
          </div>
          <div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">Placa</div>
            <div className="font-mono font-bold text-slate-900 dark:text-slate-100">{admission.vehiclePlate || '—'}</div>
          </div>
          <div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">RENAVAM</div>
            <div className="font-mono text-slate-900 dark:text-slate-100">{admission.vehicleRenavam || '—'}</div>
          </div>
          <div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">Chassi</div>
            <div className="font-mono text-slate-900 truncate dark:text-slate-100">{admission.vehicleChassis || '—'}</div>
          </div>
        </div>
      </section>

      {/* 04. Cenários de Recálculo */}
      <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-2.5 dark:border-slate-700 dark:bg-slate-900">
        <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
          Cenários de Recálculo Vinculados ({scenariosFromJson.length + recalcScenarios.length})
        </h3>
        {scenariosFromJson.length === 0 && recalcScenarios.length === 0 ? (
          <p className="text-slate-500 dark:text-slate-400">Nenhum cenário de recálculo registrado para esta admissão.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
            <table className="w-full text-left border-collapse">
              <thead className="bg-slate-50 text-[11px] font-semibold text-slate-600 dark:bg-slate-800/70 dark:text-slate-300">
                <tr>
                  <th className="px-3 py-2">Cenário</th>
                  <th className="px-3 py-2">Parcelas / Taxa</th>
                  <th className="px-3 py-2 text-right">Parcela Original</th>
                  <th className="px-3 py-2 text-right">Nova Parcela / Redução</th>
                  <th className="px-3 py-2 text-right">Economia Projetada</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono dark:divide-slate-800">
                {scenariosFromJson.map((sc, idx) => (
                  <tr key={sc.id || `json-${idx}`}>
                    <td className="px-3 py-2 font-sans font-semibold text-slate-900 dark:text-slate-100">
                      {sc.name || `Cenário ${idx + 1}`}
                    </td>
                    <td className="px-3 py-2 text-slate-600 dark:text-slate-300">
                      {sc.installmentsToPay || admission.installmentsCount}x · {sc.servicePercent ?? 0}% (Dia {sc.dueDay || 10})
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatBRL(sc.originalDebtCents || admission.debtAmountCents)}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold text-blue-700 tabular-nums dark:text-blue-300">
                      {formatBRL(sc.recalcInstallmentCents || sc.recalcDebtCents)}
                    </td>
                    <td className="px-3 py-2 text-right font-bold text-emerald-700 tabular-nums dark:text-emerald-300">
                      {formatBRL(sc.savingsCents)}
                    </td>
                  </tr>
                ))}
                {recalcScenarios.map((sc) => (
                  <tr key={sc.id}>
                    <td className="px-3 py-2 font-sans font-semibold text-slate-900 dark:text-slate-100">Cálculo BACEN #{sc.id}</td>
                    <td className="px-3 py-2 text-slate-600 dark:text-slate-300">
                      {sc.installmentsTotal}x · {sc.contractRateMonthlyPct}% vs {sc.bacenAvgRateMonthlyPct}%
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatBRL(sc.originalInstallmentCents)}</td>
                    <td className="px-3 py-2 text-right font-semibold text-blue-700 tabular-nums dark:text-blue-300">
                      {formatBRL(sc.fairInstallmentCents)}
                    </td>
                    <td className="px-3 py-2 text-right font-bold text-emerald-700 tabular-nums dark:text-emerald-300">
                      {formatBRL(sc.projectedSavingsCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 05. Histórico Jurídico Salvo */}
      <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-2.5 dark:border-slate-700 dark:bg-slate-900">
        <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2 dark:text-slate-100">
          <Scale className="w-4 h-4 text-slate-700 dark:text-slate-200" />
          Processos & Movimentações Jurídicas Registradas ({legalProcesses.length})
        </h3>
        {legalProcesses.length === 0 ? (
          <p className="text-slate-500 dark:text-slate-400">
            Nenhum processo vinculado ainda no painel Jurídico (será roteado automaticamente na aprovação).
          </p>
        ) : (
          <div className="space-y-2">
            {legalProcesses.map((proc) => (
              <div key={proc.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-1 dark:border-slate-700 dark:bg-slate-800/70">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono font-bold text-slate-900 dark:text-slate-100">{proc.processNumber}</span>
                  <span className="font-semibold text-blue-700 dark:text-blue-300">
                    {proc.actionType} · {proc.status}
                  </span>
                </div>
                <div className="text-slate-600 dark:text-slate-300">{proc.courtName}</div>
                <div className="text-[11px] text-slate-500 font-mono dark:text-slate-400">
                  Última movimentação: {formatDateTimeBR(proc.lastMovementAt)}
                </div>
              </div>
            ))}
            {legalMovements.slice(0, 3).map((mv) => (
              <div key={mv.id} className="rounded-lg border border-slate-100 px-3 py-2 text-slate-700 dark:border-slate-800 dark:text-slate-200">
                <span className="font-semibold text-slate-900 dark:text-slate-100">Tradução Ivi Jurídica:</span> {mv.iviTranslationPtBr}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
