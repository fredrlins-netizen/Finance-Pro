import crypto from 'node:crypto';
import * as XLSX from 'xlsx';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import {
  admissions,
  appointments,
  auditLogs,
  bankAccounts,
  bankMovements,
  banks,
  bearers,
  chartOfAccounts,
  clientAssetLinks,
  clients,
  collaborators,
  commercialDeals,
  companyLegalProcessDeadlines,
  companyLegalProcessHearings,
  companyLegalProcessMovements,
  companyLegalProcesses,
  departments,
  documentObjects,
  documentTypes,
  financialTitles,
  legalProcesses,
  measurementUnits,
  modalities,
  negotiations,
  paymentCategories,
  products,
  prospectionLeads,
  rolesCatalog,
  scheduleServices,
  seriesCatalog,
  titleSettlements,
  units,
  userGroups,
  users,
} from '../db/schema.ts';
import {
  DATA_HUB_ENTITIES,
  DATA_HUB_PACKAGES,
  DataHubEntityLayout,
  getEntityLayout,
  getPackageLayout,
  TIER_LABELS,
} from './dataHubRegistry.ts';
import { generateIntegrativeCode } from './integrativeVaultService.ts';

function normText(v: unknown): string {
  return String(v ?? '').trim();
}

function normKey(v: unknown): string {
  return normText(v)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function normDigits(v: unknown): string {
  return String(v ?? '').replace(/\D/g, '');
}

function parseBool(v: unknown, defaultVal = true): boolean {
  if (typeof v === 'boolean') return v;
  const s = normKey(v);
  if (!s) return defaultVal;
  if (['sim', 's', 'true', '1', 'yes', 'y', 'ativo'].includes(s)) return true;
  if (['nao', 'n', 'false', '0', 'no', 'inativo'].includes(s)) return false;
  return defaultVal;
}

function parseCentsFromBrl(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) {
    return Math.round(v * 100);
  }
  let raw = normText(v).replace(/[R$\s]/g, '');
  if (!raw) return 0;
  // Handle Brazilian "1.234,56" vs standard "1234.56"
  if (raw.includes(',') && raw.includes('.')) {
    raw = raw.replace(/\./g, '').replace(',', '.');
  } else if (raw.includes(',')) {
    raw = raw.replace(',', '.');
  }
  const n = Number(raw);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

function parseIntSafe(v: unknown, fallback = 0): number {
  const n = Number(String(v ?? '').replace(/[^\d-]/g, ''));
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function parseDateSafe(v: unknown, fallback?: Date): Date {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v;
  const s = normText(v);
  if (!s) return fallback || new Date();
  const brMatch = s.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?/);
  if (brMatch) {
    const dt = new Date(`${brMatch[3]}-${brMatch[2]}-${brMatch[1]}T${brMatch[4] || '00'}:${brMatch[5] || '00'}:00`);
    if (!Number.isNaN(dt.getTime())) return dt;
  }
  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) return parsed;
  return fallback || new Date();
}

function formatDateIso(v: Date | string | null | undefined): string {
  if (!v) return '';
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

function formatBrlPlain(cents: number | null | undefined): string {
  const val = Number(cents || 0) / 100;
  return val.toFixed(2);
}

function formatBoolStr(v: boolean | null | undefined): string {
  return v ? 'SIM' : 'NAO';
}

function appendSheetFromObjects(
  wb: XLSX.WorkBook,
  sheetName: string,
  headers: string[],
  rows: Array<Record<string, unknown>>
) {
  const cleanName = sheetName.slice(0, 31);
  const aoa: unknown[][] = [headers];
  for (const row of rows) {
    aoa.push(headers.map((h) => (row[h] === undefined || row[h] === null ? '' : row[h])));
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  // Auto-calculate friendly column widths
  ws['!cols'] = headers.map((h, i) => {
    let maxLen = h.length + 2;
    for (let r = 1; r < Math.min(aoa.length, 60); r++) {
      const cellLen = String(aoa[r][i] ?? '').length;
      if (cellLen > maxLen) maxLen = cellLen;
    }
    return { wch: Math.min(Math.max(maxLen + 2, 12), 46) };
  });
  XLSX.utils.book_append_sheet(wb, ws, cleanName);
}

async function fetchEntityExportRows(
  layout: DataHubEntityLayout,
  unitId: number | null
): Promise<Array<Record<string, unknown>>> {
  const [
    allUnits,
    allGroups,
    allDepts,
    allRoles,
    allSeries,
    allCats,
    allBearers,
    allDocTypes,
    allChart,
    allModals,
    allBanks,
    allMUnits,
    allProducts,
    allServices,
    allCollabs,
    allUsers,
    allClients,
    allAssetLinks,
    allBankAccounts,
  ] = await Promise.all([
    db.select().from(units),
    db.select().from(userGroups),
    db.select().from(departments),
    db.select().from(rolesCatalog),
    db.select().from(seriesCatalog),
    db.select().from(paymentCategories),
    db.select().from(bearers),
    db.select().from(documentTypes),
    db.select().from(chartOfAccounts),
    db.select().from(modalities),
    db.select().from(banks),
    db.select().from(measurementUnits),
    db.select().from(products),
    db.select().from(scheduleServices),
    db.select().from(collaborators),
    db.select().from(users),
    db.select().from(clients),
    db.select().from(clientAssetLinks),
    db.select().from(bankAccounts),
  ]);

  const unitCodeById = new Map(allUnits.map((u) => [u.id, u.code]));
  const groupNameById = new Map(allGroups.map((g) => [g.id, g.name]));
  const deptNameById = new Map(allDepts.map((d) => [d.id, d.name]));
  const roleNameById = new Map(allRoles.map((r) => [r.id, r.name]));
  const mUnitNameById = new Map(allMUnits.map((m) => [m.id, m.name]));
  const clientCpfById = new Map(allClients.map((c) => [c.id, c.cpfCnpj]));
  const catNameById = new Map(allCats.map((c) => [c.id, c.name]));
  const chartCodeById = new Map(allChart.map((c) => [c.id, c.code]));
  const bankAccNumById = new Map(allBankAccounts.map((b) => [b.id, b.accountNumber]));
  const collabCodeById = new Map(allCollabs.map((c) => [c.id, c.code || c.name]));
  const userEmailById = new Map(allUsers.map((u) => [u.id, u.email]));

  switch (layout.key) {
    case 'units':
      return allUnits
        .filter((u) => !unitId || u.id === unitId)
        .map((u) => ({
          codigo_unidade: u.code,
          nome_unidade: u.name,
          razao_social: u.legalName,
          cnpj: u.cnpj,
          cidade: u.city,
          uf: u.state,
          telefone: u.phone,
          email: u.email,
          whatsapp: u.whatsappNumber,
          cep: u.zipCode,
          logradouro: u.address,
          numero: u.addressNumber,
          bairro: u.neighborhood,
          custo_minimo_admissao_brl: formatBrlPlain(u.minAdmissionCostCents),
          ativo: formatBoolStr(u.active),
        }));
    case 'user_groups':
      return allGroups.map((g) => ({ nome_grupo: g.name, descricao: g.description }));
    case 'departments':
      return allDepts.map((d) => ({
        codigo_departamento: d.code,
        nome_departamento: d.name,
        gestor: d.managerName,
        status: d.status,
      }));
    case 'roles_catalog':
      return allRoles.map((r) => ({
        nome_cargo: r.name,
        participa_fila_agenda: formatBoolStr(r.participatesInScheduleQueue),
        ordem: r.sortOrder,
        ativo: formatBoolStr(r.active),
      }));
    case 'series_catalog':
      return allSeries.map((s) => ({
        sigla_serie: s.sigla,
        descricao: s.description,
        numeracao_geral: s.generalNumber,
        padrao: formatBoolStr(s.isDefault),
      }));
    case 'payment_categories':
      return allCats.map((c) => ({
        nome_categoria: c.name,
        codigo_provedor: c.providerCode,
        ativo: formatBoolStr(c.active),
      }));
    case 'bearers':
      return allBearers
        .filter((b) => !unitId || !b.unitId || b.unitId === unitId)
        .map((b) => ({
          codigo_portador: b.code,
          nome_portador: b.name,
          tipo: b.type,
          codigo_unidade: b.unitId ? unitCodeById.get(b.unitId) || '' : '',
          ativo: formatBoolStr(b.active),
        }));
    case 'document_types':
      return allDocTypes.map((d) => ({
        descricao: d.description,
        categoria: d.category,
        fiscal: formatBoolStr(d.isFiscal),
        exige_numero: formatBoolStr(d.requiresNumber),
        ativo: formatBoolStr(d.active),
      }));
    case 'chart_of_accounts':
      return allChart.map((c) => ({
        codigo_conta: c.code,
        nome_conta: c.name,
        tipo: c.type,
        analitica: formatBoolStr(c.isAnalytic),
        ativo: formatBoolStr(c.active),
      }));
    case 'modalities':
      return allModals.map((m) => ({
        tipo_segmento: m.type,
        descricao_modalidade: m.description,
        exige_dados_veiculo: formatBoolStr(m.hasVehicleSection),
        ativo: formatBoolStr(m.active),
      }));
    case 'banks':
      return allBanks.map((b) => ({
        codigo_banco: b.code,
        nome_banco: b.name,
        codigo_febraban: b.febrabanCode,
        status: b.status,
        observacoes: b.notes,
      }));
    case 'measurement_units':
      return allMUnits.map((m) => ({
        nome_unidade_medida: m.name,
        fator_conversao: m.conversionFactor,
      }));
    case 'products':
      return allProducts.map((p) => ({
        tipo: p.type,
        descricao: p.description,
        unidade_medida: p.unitId ? mUnitNameById.get(p.unitId) || '' : '',
      }));
    case 'schedule_services':
      return allServices.map((s) => ({
        nome_servico: s.name,
        duracao_minutos: s.durationMinutes,
        valor_brl: formatBrlPlain(s.priceCents),
        cor_hex: s.color,
        ativo: formatBoolStr(s.active),
      }));
    case 'collaborators':
      return allCollabs
        .filter((c) => !unitId || c.unitId === unitId)
        .map((c) => ({
          codigo_colaborador: c.code,
          nome_completo: c.name,
          codigo_unidade: unitCodeById.get(c.unitId) || '',
          departamento: c.departmentId ? deptNameById.get(c.departmentId) || '' : '',
          cargo: c.roleId ? roleNameById.get(c.roleId) || '' : '',
          funcao_exibicao: c.jobTitle,
          email: c.email,
          telefone: c.phone,
          whatsapp_ativo: formatBoolStr(c.isWhatsapp),
          fila_agenda: formatBoolStr(c.participatesInScheduleQueue),
          ativo: formatBoolStr(c.active),
          cidade: c.city,
          uf: c.state,
        }));
    case 'users':
      return allUsers
        .filter((u) => !unitId || u.defaultUnitId === unitId)
        .map((u) => ({
          codigo_uid: u.uid,
          email_login: u.email,
          nome_usuario: u.name,
          perfil_role: u.role,
          grupo_acesso: u.groupId ? groupNameById.get(u.groupId) || '' : '',
          codigo_unidade_padrao: u.defaultUnitId ? unitCodeById.get(u.defaultUnitId) || '' : '',
          whatsapp: u.whatsappPhone,
          ativo: formatBoolStr(u.active),
        }));
    case 'clients':
      return allClients
        .filter((c) => !unitId || c.unitId === unitId)
        .map((c) => ({
          codigo_unidade: unitCodeById.get(c.unitId) || '',
          natureza_pf_pj: c.personNature,
          nome_completo: c.fullName,
          cpf_cnpj: c.cpfCnpj,
          rg: c.rg,
          data_nascimento: c.birthDate,
          profissao: c.profession,
          estado_civil: c.maritalStatus,
          telefone: c.phone,
          whatsapp: c.whatsapp,
          telefone_secundario: c.secondaryPhone,
          email: c.email,
          cep: c.zipCode,
          logradouro: c.address,
          numero: c.addressNumber,
          complemento: c.complement,
          bairro: c.neighborhood,
          cidade: c.city,
          uf: c.state,
          tipo_cliente: c.clientType,
          natureza_cadastro: c.natureza,
          status: c.status,
          observacoes: c.notes,
        }));
    case 'client_asset_links':
      return allAssetLinks.map((l) => ({
        cpf_cnpj_titular: clientCpfById.get(l.titularClientId) || '',
        cpf_cnpj_responsavel_bem: clientCpfById.get(l.assetOwnerClientId) || '',
        grau_vinculo: l.relationshipLabel,
        placa_veiculo: l.vehiclePlate,
        modelo_veiculo: l.vehicleModel,
        renavam: l.renavam,
      }));
    case 'bank_accounts':
      return allBankAccounts
        .filter((b) => !unitId || !b.unitId || b.unitId === unitId)
        .map((b) => ({
          codigo_unidade: b.unitId ? unitCodeById.get(b.unitId) || '' : '',
          nome_banco: b.bankName,
          agencia: b.agency,
          numero_conta: b.accountNumber,
          tipo_conta: b.accountType,
          saldo_inicial_brl: formatBrlPlain(b.initialBalanceCents),
          saldo_atual_brl: formatBrlPlain(b.currentBalanceCents),
          ativo: formatBoolStr(b.active),
        }));
    case 'prospection_leads': {
      const leads = unitId
        ? await db.select().from(prospectionLeads).where(eq(prospectionLeads.unitId, unitId))
        : await db.select().from(prospectionLeads);
      return leads.map((l) => ({
        codigo_unidade: unitCodeById.get(l.unitId) || '',
        nome_lead: l.name,
        telefone: l.phone,
        email: l.email,
        canal_origem: l.channel,
        estagio: l.stage,
        resumo: l.summaryText,
      }));
    }
    case 'admissions': {
      const admRows = unitId
        ? await db.select().from(admissions).where(eq(admissions.unitId, unitId))
        : await db.select().from(admissions);
      return admRows.map((a) => ({
        codigo_unidade: unitCodeById.get(a.unitId) || '',
        codigo_protocolo: a.protocolCode,
        codigo_seguro_integrativo: a.integrativeCode || '',
        numero_contrato: a.contractNumber,
        cpf_cnpj_cliente: clientCpfById.get(a.clientId) || '',
        cpf_cnpj_responsavel_bem: a.assetOwnerId ? clientCpfById.get(a.assetOwnerId) || '' : '',
        banco_credor: a.bankName,
        segmento_divida: a.debtType,
        modalidade: a.modality,
        serie: a.series,
        consultor_nome: a.consultantName,
        origem: a.origin,
        veiculo_marca: a.vehicleBrand,
        veiculo_modelo: a.vehicleModel,
        veiculo_ano: a.vehicleYear,
        veiculo_placa: a.vehiclePlate,
        veiculo_renavam: a.vehicleRenavam,
        veiculo_chassi: a.vehicleChassis,
        qtd_parcelas_totais: a.debtTotalInstallments,
        qtd_parcelas_pagas: a.debtPaidInstallments,
        qtd_parcelas_atraso: a.debtOverdueInstallments,
        valor_financiado_brl: formatBrlPlain(a.financedAmountCents),
        valor_parcela_atual_brl: formatBrlPlain(a.currentInstallmentCents),
        valor_divida_brl: formatBrlPlain(a.debtAmountCents),
        valor_honorarios_brl: formatBrlPlain(a.serviceFeeCents),
        parcelas_honorarios: a.installmentsCount,
        status_admissao: a.status,
        observacoes: a.notes,
      }));
    }
    case 'negotiations': {
      const admRows = await db.select().from(admissions);
      const admContractById = new Map(admRows.map((a) => [a.id, a.contractNumber]));
      const rows = unitId
        ? await db.select().from(negotiations).where(eq(negotiations.unitId, unitId))
        : await db.select().from(negotiations);
      return rows.map((n) => ({
        codigo_unidade: unitCodeById.get(n.unitId) || '',
        cpf_cnpj_cliente: clientCpfById.get(n.clientId) || '',
        numero_contrato: n.contractNumber || (n.admissionId ? admContractById.get(n.admissionId) || '' : ''),
        banco_credor: n.bankName,
        negociador: n.collaboratorName,
        data_abertura: n.openDate,
        divida_original_brl: formatBrlPlain(n.originalDebtCents),
        meta_desconto_pct: n.targetReductionPct,
        desconto_atual_pct: n.currentReductionPct,
        economia_estimada_brl: formatBrlPlain(n.estimatedSavingsCents),
        prazo_alvo: formatDateIso(n.targetDeadline),
        status_negociacao: n.negotiationStatus,
        observacoes: n.notes,
      }));
    }
    case 'commercial_deals': {
      const admRows = await db.select().from(admissions);
      const admContractById = new Map(admRows.map((a) => [a.id, a.contractNumber]));
      const rows = unitId
        ? await db.select().from(commercialDeals).where(eq(commercialDeals.unitId, unitId))
        : await db.select().from(commercialDeals);
      return rows.map((d) => ({
        codigo_unidade: d.unitId ? unitCodeById.get(d.unitId) || '' : '',
        cpf_cnpj_cliente: clientCpfById.get(d.clientId) || '',
        numero_contrato: d.admissionId ? admContractById.get(d.admissionId) || '' : '',
        banco_credor: d.bankName,
        responsavel: d.collaboratorName,
        estagio_funil: d.stage,
        valor_divida_brl: formatBrlPlain(d.debtValueCents),
        valor_proposto_brl: d.proposedValueCents != null ? formatBrlPlain(d.proposedValueCents) : '',
        observacoes: d.notes,
      }));
    }
    case 'financial_titles': {
      const admRows = await db.select().from(admissions);
      const admContractById = new Map(admRows.map((a) => [a.id, a.contractNumber]));
      const rows = unitId
        ? await db.select().from(financialTitles).where(eq(financialTitles.unitId, unitId))
        : await db.select().from(financialTitles);
      return rows.map((t) => ({
        codigo_titulo: t.titleCode,
        codigo_unidade: unitCodeById.get(t.unitId) || '',
        cpf_cnpj_cliente: clientCpfById.get(t.clientId) || '',
        numero_contrato: t.contractNumber || (t.admissionId ? admContractById.get(t.admissionId) || '' : ''),
        carteira: t.scope,
        tipo_titulo: t.titleType,
        numero_documento: t.documentNumber,
        descricao: t.description,
        categoria_financeira: t.categoryId ? catNameById.get(t.categoryId) || '' : '',
        codigo_plano_contas: t.chartAccountId ? chartCodeById.get(t.chartAccountId) || '' : '',
        parcela_atual: t.installmentNumber,
        total_parcelas: t.totalInstallments,
        valor_brl: formatBrlPlain(t.amountCents),
        saldo_aberto_brl: formatBrlPlain(t.currentBalanceCents),
        data_emissao: formatDateIso(t.issueDate),
        data_vencimento: formatDateIso(t.dueDate),
        status: t.status,
      }));
    }
    case 'title_settlements': {
      const titles = await db.select().from(financialTitles);
      const titleCodeById = new Map(titles.map((t) => [t.id, t.titleCode]));
      const rows = await db.select().from(titleSettlements);
      return rows.map((s) => ({
        codigo_titulo: titleCodeById.get(s.titleId) || '',
        data_baixa: formatDateIso(s.settlementDate),
        principal_brl: formatBrlPlain(s.principalCents),
        juros_brl: formatBrlPlain(s.interestCents),
        multa_brl: formatBrlPlain(s.fineCents),
        desconto_brl: formatBrlPlain(s.discountCents),
        valor_total_pago_brl: formatBrlPlain(s.amountCents),
        forma_pagamento: s.paymentMethod,
        conta_bancaria: s.bankAccountId ? bankAccNumById.get(s.bankAccountId) || '' : '',
        historico: s.history,
      }));
    }
    case 'bank_movements': {
      const rows = unitId
        ? await db.select().from(bankMovements).where(eq(bankMovements.unitId, unitId))
        : await db.select().from(bankMovements);
      return rows.map((m) => ({
        codigo_unidade: m.unitId ? unitCodeById.get(m.unitId) || '' : '',
        numero_conta: bankAccNumById.get(m.bankAccountId) || '',
        tipo_movimento: m.movementType,
        valor_brl: formatBrlPlain(m.amountCents),
        data_movimento: formatDateIso(m.movementDate),
        numero_documento: m.documentNumber,
        descricao: m.description,
        codigo_plano_contas: m.categoryId ? chartCodeById.get(m.categoryId) || '' : '',
        conciliado: formatBoolStr(m.reconciled),
      }));
    }
    case 'legal_processes': {
      const admRows = await db.select().from(admissions);
      const admContractById = new Map(admRows.map((a) => [a.id, a.contractNumber]));
      const rows = unitId
        ? await db.select().from(legalProcesses).where(eq(legalProcesses.unitId, unitId))
        : await db.select().from(legalProcesses);
      return rows.map((l) => ({
        codigo_unidade: unitCodeById.get(l.unitId) || '',
        numero_processo_cnj: l.processNumber,
        cpf_cnpj_cliente: clientCpfById.get(l.clientId) || '',
        numero_contrato: l.admissionId ? admContractById.get(l.admissionId) || '' : '',
        vara_tribunal: l.courtName,
        tipo_acao: l.actionType,
        possui_busca_apreensao: formatBoolStr(l.hasSearchSeizure),
        veiculo_apreendido: formatBoolStr(l.vehicleSeized),
        status: l.status,
        monitorado_escavador: formatBoolStr(l.escavadorMonitored),
      }));
    }
    case 'company_legal_processes': {
      const rows = unitId
        ? await db.select().from(companyLegalProcesses).where(eq(companyLegalProcesses.unitId, unitId))
        : await db.select().from(companyLegalProcesses);
      return rows.map((p) => ({
        codigo_unidade: p.unitId ? unitCodeById.get(p.unitId) || '' : '',
        numero_processo: p.processNumber,
        tribunal: p.court,
        comarca_vara: p.jurisdiction,
        tipo_processo: p.type,
        polo: p.role,
        parte_contraria: p.opposingParty,
        cpf_cnpj_parte_contraria: p.opposingPartyDocument,
        cpf_cnpj_parceiro_cliente: p.partnerId ? clientCpfById.get(p.partnerId) || '' : '',
        numero_contrato: p.contractNumber,
        advogado_responsavel: p.responsibleLawyer,
        oab_responsavel: p.responsibleLawyerOab,
        status: p.status,
        grau_risco: p.riskLevel,
        valor_causa: p.causeValue,
        valor_provisao: p.provisionValue,
        data_distribuicao: p.distributionDate,
        assunto: p.subject,
        anotacoes: p.notes,
      }));
    }
    case 'company_legal_process_movements': {
      const procs = await db.select().from(companyLegalProcesses);
      const procNumById = new Map(procs.map((p) => [p.id, p.processNumber]));
      const rows = await db.select().from(companyLegalProcessMovements);
      return rows.map((m) => ({
        numero_processo: procNumById.get(m.processId) || '',
        data_movimentacao: m.date,
        tipo: m.type,
        descricao: m.description,
        origem: m.source,
      }));
    }
    case 'company_legal_process_deadlines': {
      const procs = await db.select().from(companyLegalProcesses);
      const procNumById = new Map(procs.map((p) => [p.id, p.processNumber]));
      const rows = await db.select().from(companyLegalProcessDeadlines);
      return rows.map((d) => ({
        numero_processo: procNumById.get(d.processId) || '',
        tipo_prazo: d.type,
        descricao: d.description,
        data_vencimento: d.dueDate,
        status: d.status,
        codigo_colaborador: d.responsibleId ? collabCodeById.get(d.responsibleId) || '' : '',
        observacoes: d.notes,
      }));
    }
    case 'company_legal_process_hearings': {
      const procs = await db.select().from(companyLegalProcesses);
      const procNumById = new Map(procs.map((p) => [p.id, p.processNumber]));
      const rows = await db.select().from(companyLegalProcessHearings);
      return rows.map((h) => ({
        numero_processo: procNumById.get(h.processId) || '',
        tipo_audiencia: h.type,
        data_audiencia: h.date,
        horario: h.time,
        local_link: h.location,
        status: h.status,
        observacoes: h.notes,
      }));
    }
    case 'appointments': {
      const rows = unitId
        ? await db.select().from(appointments).where(eq(appointments.unitId, unitId))
        : await db.select().from(appointments);
      return rows.map((a) => ({
        codigo_unidade: unitCodeById.get(a.unitId) || '',
        nome_cliente: a.clientName,
        telefone_cliente: a.clientPhone,
        cpf_cnpj_cliente: a.clientId ? clientCpfById.get(a.clientId) || '' : '',
        email_consultor: userEmailById.get(a.consultantId) || '',
        nome_servico: a.serviceName,
        modalidade_atendimento: a.modality,
        data_hora_inicio: a.scheduledFor ? new Date(a.scheduledFor).toISOString().slice(0, 16).replace('T', ' ') : '',
        status: a.status,
        observacoes: a.notes,
      }));
    }
    case 'document_objects': {
      const admRows = await db.select().from(admissions);
      const admContractById = new Map(admRows.map((a) => [a.id, a.contractNumber]));
      const rows = unitId
        ? await db.select().from(documentObjects).where(eq(documentObjects.unitId, unitId))
        : await db.select().from(documentObjects);
      return rows
        .filter((d) => !d.deletedAt && !d.archivedAt)
        .map((d) => ({
          codigo_unidade: unitCodeById.get(d.unitId) || '',
          codigo_seguro_integrativo: d.integrativeCode || '',
          cpf_cnpj_cliente: clientCpfById.get(d.clientId) || '',
          numero_contrato: d.admissionId ? admContractById.get(d.admissionId) || '' : '',
          subpasta_relativa: d.relativeSubpath || d.fileName,
          nome_arquivo: d.fileName,
          categoria_documento: d.docCategory,
          mime_type: d.mimeType,
          tamanho_bytes: d.sizeBytes,
          sha256_hash: d.sha256Hash,
          caminho_bucket: d.folderPath,
          versao: d.versionNumber,
        }));
    }
    default:
      return [];
  }
}

export async function exportExcelWorkbook(params: {
  scopeType: 'entity' | 'package';
  key: string;
  mode: 'data' | 'template';
  unitId: number | null;
  actorUserId: number;
  actorName: string;
}): Promise<{ buffer: Buffer; fileName: string; totalRows: number; sheetsCount: number }> {
  let entities: DataHubEntityLayout[] = [];
  let labelSlug = params.key;

  if (params.scopeType === 'package') {
    const pkg = getPackageLayout(params.key);
    if (!pkg) throw new Error(`Pacote relacional "${params.key}" não encontrado.`);
    entities = pkg.entityKeys
      .map((k) => getEntityLayout(k))
      .filter((e): e is DataHubEntityLayout => Boolean(e))
      .sort((a, b) => a.order - b.order);
    labelSlug = pkg.key;
  } else {
    const ent = getEntityLayout(params.key);
    if (!ent) throw new Error(`Layout de tabela "${params.key}" não encontrado.`);
    entities = [ent];
    labelSlug = ent.key;
  }

  const wb = XLSX.utils.book_new();
  let totalRows = 0;

  if (entities.length > 1) {
    const precedenceRows = entities.map((e, idx) => ({
      ordem_importacao: idx + 1,
      camada_precedencia: TIER_LABELS[e.tier],
      nome_aba_excel: e.sheetName,
      entidade: e.label,
      chave_upsert: e.naturalKeyDescription,
      dependencias: e.dependsOn.length > 0 ? e.dependsOn.join(', ') : 'Nenhuma (Raiz)',
      codigo_automatico: e.autoCodeField ? `${e.autoCodePrefix || 'COD'}-... (se vazio)` : 'Chave natural obrigatória',
    }));
    appendSheetFromObjects(
      wb,
      '_Ordem_Precedencia',
      [
        'ordem_importacao',
        'camada_precedencia',
        'nome_aba_excel',
        'entidade',
        'chave_upsert',
        'dependencias',
        'codigo_automatico',
      ],
      precedenceRows
    );
  }

  for (const ent of entities) {
    const headers = ent.columns.map((c) => c.header);
    let rows: Array<Record<string, unknown>> = [];
    if (params.mode === 'data') {
      rows = await fetchEntityExportRows(ent, ent.unitScoped ? params.unitId : null);
    }
    if (rows.length === 0 && params.mode === 'template') {
      const sample: Record<string, unknown> = {};
      for (const col of ent.columns) {
        sample[col.header] = col.example;
      }
      rows = [sample];
    }
    totalRows += rows.length;
    appendSheetFromObjects(wb, ent.sheetName, headers, rows);
  }

  // Dictionary Sheet
  const dictRows: Array<Record<string, unknown>> = [];
  for (const ent of entities) {
    for (const col of ent.columns) {
      dictRows.push({
        aba: ent.sheetName,
        camada: ent.tier,
        cabecalho_excel: col.header,
        tipo_dado: col.type,
        obrigatorio: col.required ? 'SIM' : 'NAO',
        chave_upsert: col.isUpsertKey ? 'SIM' : 'NAO',
        auto_codigo: col.isAutoCode ? 'SIM (gera se vazio)' : 'NAO',
        tabela_referencia: col.fkTarget || '',
        descricao: col.description,
        exemplo: col.example,
      });
    }
  }
  appendSheetFromObjects(
    wb,
    'Dicionario_Campos',
    [
      'aba',
      'camada',
      'cabecalho_excel',
      'tipo_dado',
      'obrigatorio',
      'chave_upsert',
      'auto_codigo',
      'tabela_referencia',
      'descricao',
      'exemplo',
    ],
    dictRows
  );

  // Domain Lists Sheet
  const [unitRows, catRows, bankRows, modRows, serRows] = await Promise.all([
    db.select().from(units),
    db.select().from(paymentCategories),
    db.select().from(banks),
    db.select().from(modalities),
    db.select().from(seriesCatalog),
  ]);
  const domainRows: Array<Record<string, unknown>> = [
    ...unitRows.map((u) => ({ dominio: 'unidades_codigo', codigo: u.code, descricao: `${u.name} (${u.city}/${u.state})` })),
    ...serRows.map((s) => ({ dominio: 'series_sigla', codigo: s.sigla, descricao: s.description })),
    ...catRows.map((c) => ({ dominio: 'categorias_financeiras', codigo: c.name, descricao: c.providerCode })),
    ...bankRows.map((b) => ({ dominio: 'bancos_credores', codigo: b.code || b.name, descricao: `${b.name} (FEBRABAN ${b.febrabanCode})` })),
    ...modRows.map((m) => ({ dominio: 'modalidades', codigo: m.description, descricao: m.type })),
    { dominio: 'status_admissao', codigo: 'pendente | aguardando_auditoria | aprovada | auditada | finalizada | concluido', descricao: 'Valores aceitos na Admissão' },
    { dominio: 'status_titulo', codigo: 'ABERTO | PARCIAL | PAGO | vencido | CANCELADO', descricao: 'Valores aceitos em Títulos Financeiros' },
    { dominio: 'booleanos', codigo: 'SIM | NAO', descricao: 'Campos lógicos' },
  ];
  appendSheetFromObjects(wb, 'Listas_Dominio', ['dominio', 'codigo', 'descricao'], domainRows);

  const outBuf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  const suffix = params.mode === 'template' ? 'modelo' : params.unitId ? `U${params.unitId}` : 'global';
  const fileName = `invicta_${labelSlug}_${suffix}.xlsx`;

  await db.insert(auditLogs).values({
    userId: params.actorUserId,
    userName: params.actorName,
    action: params.mode === 'template' ? 'EXCEL_TEMPLATE_DOWNLOADED' : 'EXCEL_LAYOUT_EXPORTED',
    entityType: params.scopeType,
    entityId: params.key,
    details: { mode: params.mode, totalRows, sheetsCount: wb.SheetNames.length, unitId: params.unitId },
    unitId: params.unitId,
  });

  return { buffer: outBuf, fileName, totalRows, sheetsCount: wb.SheetNames.length };
}

export interface ExcelImportRowEval {
  entityKey: string;
  sheetName: string;
  rowNumber: number;
  action: 'INSERT' | 'UPDATE' | 'SKIP' | 'ERROR';
  naturalKey: string;
  assignedCode: string;
  integrativeCode: string;
  message: string;
}

export interface ExcelImportSheetSummary {
  entityKey: string;
  label: string;
  sheetName: string;
  tier: number;
  order: number;
  totalRows: number;
  inserts: number;
  updates: number;
  skips: number;
  errors: number;
}

export interface ExcelImportResult {
  mode: 'dry_run' | 'commit';
  orderedSheets: ExcelImportSheetSummary[];
  totals: { totalRows: number; inserts: number; updates: number; skips: number; errors: number };
  rowResults: ExcelImportRowEval[];
  unrecognizedSheets: string[];
  returnWorkbookBase64?: string;
  returnFileName?: string;
}

function matchSheetToEntity(
  sheetName: string,
  headers: string[],
  expectedLayoutKey?: string
): DataHubEntityLayout | null {
  const cleanSheet = normKey(sheetName);
  if (
    ['_ordem_precedencia', 'dicionario_campos', 'listas_dominio', '_retorno_importacao'].includes(cleanSheet)
  ) {
    return null;
  }
  const bySheet = DATA_HUB_ENTITIES.find(
    (e) => normKey(e.sheetName) === cleanSheet || normKey(e.key) === cleanSheet
  );
  if (bySheet) return bySheet;

  if (expectedLayoutKey) {
    const expectedEnt = getEntityLayout(expectedLayoutKey);
    if (expectedEnt) {
      const headerSet = new Set(headers.map((h) => normKey(h)));
      const overlap = expectedEnt.columns.filter((c) => headerSet.has(normKey(c.header))).length;
      if (overlap >= Math.max(1, Math.min(3, expectedEnt.columns.length))) {
        return expectedEnt;
      }
    }
  }

  // Signature fallback across all registered entities
  const headerSet = new Set(headers.map((h) => normKey(h)));
  let best: { layout: DataHubEntityLayout; score: number } | null = null;
  for (const ent of DATA_HUB_ENTITIES) {
    const requiredCols = ent.columns.filter((c) => c.required || c.isUpsertKey);
    const reqHits = requiredCols.filter((c) => headerSet.has(normKey(c.header))).length;
    const totalHits = ent.columns.filter((c) => headerSet.has(normKey(c.header))).length;
    if (requiredCols.length > 0 && reqHits === requiredCols.length && totalHits >= 2) {
      if (!best || totalHits > best.score) {
        best = { layout: ent, score: totalHits };
      }
    }
  }
  return best?.layout || null;
}

export async function processExcelImport(params: {
  buffer: Buffer;
  expectedLayoutKey?: string;
  mode: 'dry_run' | 'commit';
  unitFallbackId?: number | null;
  assignIntegrative?: boolean;
  actorUserId?: number | null;
  actorName: string;
}): Promise<ExcelImportResult> {
  const wb = XLSX.read(params.buffer, { type: 'buffer', cellDates: true });

  const matchedPairs: Array<{ sheetName: string; layout: DataHubEntityLayout; rows: Array<Record<string, unknown>> }> = [];
  const unrecognizedSheets: string[] = [];

  for (const sName of wb.SheetNames) {
    const ws = wb.Sheets[sName];
    if (!ws) continue;
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' });
    if (aoa.length === 0) continue;
    const rawHeaders = (aoa[0] || []).map((h) => String(h ?? '').trim());
    const layout = matchSheetToEntity(sName, rawHeaders, params.expectedLayoutKey);
    if (!layout) {
      const clean = normKey(sName);
      if (!['_ordem_precedencia', 'dicionario_campos', 'listas_dominio', '_retorno_importacao'].includes(clean)) {
        unrecognizedSheets.push(sName);
      }
      continue;
    }

    // Normalize headers to exact canonical layout column headers (case/accent insensitive)
    const canonicalByNorm = new Map(layout.columns.map((c) => [normKey(c.header), c.header]));
    const parsedRows: Array<Record<string, unknown>> = [];
    for (let rIdx = 1; rIdx < aoa.length; rIdx++) {
      const arr = aoa[rIdx] || [];
      const hasAnyValue = arr.some((cell) => normText(cell) !== '');
      if (!hasAnyValue) continue;
      const obj: Record<string, unknown> = { __rowNumber: rIdx + 1 };
      for (let cIdx = 0; cIdx < rawHeaders.length; cIdx++) {
        const canonical = canonicalByNorm.get(normKey(rawHeaders[cIdx])) || rawHeaders[cIdx];
        if (canonical) obj[canonical] = arr[cIdx];
      }
      parsedRows.push(obj);
    }

    matchedPairs.push({ sheetName: sName, layout, rows: parsedRows });
  }

  // Sort strictly by precedence tier & order!
  matchedPairs.sort((a, b) => a.layout.order - b.layout.order);

  // Hydrate lookup maps from Cloud SQL
  const [
    existingUnits,
    existingGroups,
    existingDepts,
    existingRoles,
    existingSeries,
    existingCats,
    existingBearers,
    existingDocTypes,
    existingChart,
    existingModals,
    existingBanks,
    existingMUnits,
    existingProducts,
    existingServices,
    existingCollabs,
    existingUsers,
    existingClients,
    existingBankAccounts,
    existingAdmissions,
    existingNegotiations,
    existingTitles,
    existingLegalProcs,
    existingCompProcs,
  ] = await Promise.all([
    db.select().from(units),
    db.select().from(userGroups),
    db.select().from(departments),
    db.select().from(rolesCatalog),
    db.select().from(seriesCatalog),
    db.select().from(paymentCategories),
    db.select().from(bearers),
    db.select().from(documentTypes),
    db.select().from(chartOfAccounts),
    db.select().from(modalities),
    db.select().from(banks),
    db.select().from(measurementUnits),
    db.select().from(products),
    db.select().from(scheduleServices),
    db.select().from(collaborators),
    db.select().from(users),
    db.select().from(clients),
    db.select().from(bankAccounts),
    db.select().from(admissions),
    db.select().from(negotiations),
    db.select().from(financialTitles),
    db.select().from(legalProcesses),
    db.select().from(companyLegalProcesses),
  ]);

  const unitMap = new Map<string, { id: number; code: string }>();
  for (const u of existingUnits) unitMap.set(normKey(u.code), { id: u.id, code: u.code });

  const groupMap = new Map<string, number>(existingGroups.map((g) => [normKey(g.name), g.id]));
  const deptMap = new Map<string, number>();
  for (const d of existingDepts) {
    if (d.code) deptMap.set(normKey(d.code), d.id);
    deptMap.set(normKey(d.name), d.id);
  }
  const roleMap = new Map<string, number>(existingRoles.map((r) => [normKey(r.name), r.id]));
  const seriesMap = new Map<string, number>(existingSeries.map((s) => [normKey(s.sigla), s.id]));
  const catMap = new Map<string, number>(existingCats.map((c) => [normKey(c.name), c.id]));
  const bearerMap = new Map<string, number>();
  for (const b of existingBearers) {
    if (b.code) bearerMap.set(normKey(b.code), b.id);
    bearerMap.set(normKey(b.name), b.id);
  }
  const docTypeMap = new Map<string, number>(existingDocTypes.map((d) => [normKey(d.description), d.id]));
  const chartMap = new Map<string, number>(existingChart.map((c) => [normKey(c.code), c.id]));
  const modalMap = new Map<string, number>(existingModals.map((m) => [`${normKey(m.type)}::${normKey(m.description)}`, m.id]));
  const bankMap = new Map<string, number>();
  for (const b of existingBanks) {
    if (b.code) bankMap.set(normKey(b.code), b.id);
    bankMap.set(normKey(b.name), b.id);
  }
  const mUnitMap = new Map<string, number>(existingMUnits.map((m) => [normKey(m.name), m.id]));
  const productMap = new Map<string, number>(existingProducts.map((p) => [normKey(p.description), p.id]));
  const serviceMap = new Map<string, number>(existingServices.map((s) => [normKey(s.name), s.id]));
  const collabMap = new Map<string, number>();
  for (const c of existingCollabs) {
    if (c.code) collabMap.set(normKey(c.code), c.id);
    if (c.email) collabMap.set(normKey(c.email), c.id);
    collabMap.set(`${normKey(c.name)}::${c.unitId}`, c.id);
  }
  const userMap = new Map<string, number>(existingUsers.map((u) => [normKey(u.email), u.id]));
  const clientMap = new Map<string, { id: number; cpfCnpj: string; unitId: number }>();
  for (const c of existingClients) {
    const dig = normDigits(c.cpfCnpj);
    if (dig) clientMap.set(dig, { id: c.id, cpfCnpj: c.cpfCnpj, unitId: c.unitId });
  }
  const bankAccMap = new Map<string, number>();
  for (const b of existingBankAccounts) {
    if (b.accountNumber) bankAccMap.set(normKey(b.accountNumber), b.id);
    bankAccMap.set(`${normKey(b.bankName)}::${normKey(b.accountNumber)}`, b.id);
  }
  const admMap = new Map<string, { id: number; unitId: number; clientId: number; protocolCode: string; contractNumber: string; integrativeCode: string | null }>();
  for (const a of existingAdmissions) {
    if (a.protocolCode) admMap.set(`PROTO::${normKey(a.protocolCode)}`, a);
    if (a.integrativeCode) admMap.set(`INT::${normKey(a.integrativeCode)}`, a);
    if (a.contractNumber) {
      admMap.set(`CTR::${a.unitId}::${normKey(a.contractNumber)}`, a);
      admMap.set(`CTR_ANY::${normKey(a.contractNumber)}`, a);
    }
  }
  const negMap = new Map<string, number>();
  for (const n of existingNegotiations) {
    negMap.set(`${n.clientId}::${normKey(n.contractNumber)}`, n.id);
  }
  const titleMap = new Map<string, { id: number; titleCode: string }>();
  for (const t of existingTitles) {
    titleMap.set(normKey(t.titleCode), { id: t.id, titleCode: t.titleCode });
    if (t.contractNumber) {
      titleMap.set(`CTR_INST::${normKey(t.contractNumber)}::${t.installmentNumber}`, { id: t.id, titleCode: t.titleCode });
    }
  }
  const legalProcMap = new Map<string, number>(existingLegalProcs.map((l) => [normKey(l.processNumber), l.id]));
  const compProcMap = new Map<string, number>(existingCompProcs.map((c) => [normKey(c.processNumber), c.id]));

  let virtualSeq = 100000;
  let codeCounter = 1;
  const nextAutoCode = (prefix: string) => {
    const seq = existingUnits.length + existingAdmissions.length + codeCounter++;
    return `${prefix}-${String(seq).padStart(4, '0')}`;
  };

  const orderedSheets: ExcelImportSheetSummary[] = [];
  const rowResults: ExcelImportRowEval[] = [];
  const isCommit = params.mode === 'commit';

  const executeWork = async (tx: any) => {
    for (const pair of matchedPairs) {
      const { layout, sheetName, rows } = pair;
      const summary: ExcelImportSheetSummary = {
        entityKey: layout.key,
        label: layout.label,
        sheetName,
        tier: layout.tier,
        order: layout.order,
        totalRows: rows.length,
        inserts: 0,
        updates: 0,
        skips: 0,
        errors: 0,
      };

      const resolveUnitId = (codeVal: unknown): number | null => {
        const k = normKey(codeVal);
        if (k && unitMap.has(k)) return unitMap.get(k)!.id;
        if (!k && params.unitFallbackId) return params.unitFallbackId;
        return null;
      };

      const resolveUnitCode = (unitId: number): string => {
        for (const u of unitMap.values()) {
          if (u.id === unitId) return u.code;
        }
        return `U${unitId}`;
      };

      for (const r of rows) {
        const rowNumber = Number(r.__rowNumber || 0);
        let action: ExcelImportRowEval['action'] = 'INSERT';
        let naturalKey = '';
        let assignedCode = '';
        let integrativeCode = '';
        let message = '';

        try {
          switch (layout.key) {
            case 'units': {
              const rawCode = normText(r.codigo_unidade).toUpperCase();
              const name = normText(r.nome_unidade);
              const city = normText(r.cidade) || 'Recife';
              const state = normText(r.uf).toUpperCase().slice(0, 2) || 'PE';
              if (!name) throw new Error('nome_unidade obrigatório');
              const code = rawCode || nextAutoCode('U');
              naturalKey = code;
              assignedCode = code;
              const existing = unitMap.get(normKey(code));
              const payload = {
                code,
                name,
                legalName: normText(r.razao_social),
                cnpj: normText(r.cnpj),
                city,
                state,
                phone: normText(r.telefone),
                email: normText(r.email),
                whatsappNumber: normText(r.whatsapp),
                zipCode: normText(r.cep),
                address: normText(r.logradouro),
                addressNumber: normText(r.numero),
                neighborhood: normText(r.bairro),
                minAdmissionCostCents: parseCentsFromBrl(r.custo_minimo_admissao_brl) || 150000,
                active: parseBool(r.ativo, true),
              };
              if (existing) {
                action = 'UPDATE';
                message = `Unidade ${code} atualizada`;
                if (isCommit) await tx.update(units).set(payload).where(eq(units.id, existing.id));
              } else {
                action = 'INSERT';
                message = `Unidade ${code} criada`;
                let newId = -(virtualSeq++);
                if (isCommit) {
                  const [ins] = await tx.insert(units).values(payload).returning();
                  newId = ins.id;
                }
                unitMap.set(normKey(code), { id: newId, code });
              }
              break;
            }
            case 'user_groups': {
              const name = normText(r.nome_grupo);
              if (!name) throw new Error('nome_grupo obrigatório');
              naturalKey = name;
              assignedCode = name;
              const existingId = groupMap.get(normKey(name));
              if (existingId) {
                action = 'UPDATE';
                message = 'Grupo atualizado';
                if (isCommit) await tx.update(userGroups).set({ description: normText(r.descricao) }).where(eq(userGroups.id, existingId));
              } else {
                action = 'INSERT';
                message = 'Grupo criado';
                let newId = -(virtualSeq++);
                if (isCommit) {
                  const [ins] = await tx.insert(userGroups).values({ name, description: normText(r.descricao) }).returning();
                  newId = ins.id;
                }
                groupMap.set(normKey(name), newId);
              }
              break;
            }
            case 'departments': {
              const name = normText(r.nome_departamento);
              if (!name) throw new Error('nome_departamento obrigatório');
              const existingId = deptMap.get(normKey(r.codigo_departamento)) || deptMap.get(normKey(name));
              const code = normText(r.codigo_departamento) || nextAutoCode('DEP');
              naturalKey = code;
              assignedCode = code;
              const payload = { code, name, managerName: normText(r.gestor), status: normText(r.status) || 'ATIVO' };
              if (existingId) {
                action = 'UPDATE';
                message = `Departamento ${code} atualizado`;
                if (isCommit) await tx.update(departments).set(payload).where(eq(departments.id, existingId));
              } else {
                action = 'INSERT';
                message = `Departamento ${code} criado`;
                let newId = -(virtualSeq++);
                if (isCommit) {
                  const [ins] = await tx.insert(departments).values(payload).returning();
                  newId = ins.id;
                }
                deptMap.set(normKey(code), newId);
                deptMap.set(normKey(name), newId);
              }
              break;
            }
            case 'roles_catalog': {
              const name = normText(r.nome_cargo);
              if (!name) throw new Error('nome_cargo obrigatório');
              naturalKey = name;
              const existingId = roleMap.get(normKey(name));
              const payload = {
                name,
                participatesInScheduleQueue: parseBool(r.participa_fila_agenda, true),
                sortOrder: parseIntSafe(r.ordem, 0),
                active: parseBool(r.ativo, true),
              };
              if (existingId) {
                action = 'UPDATE';
                message = 'Cargo atualizado';
                if (isCommit) await tx.update(rolesCatalog).set(payload).where(eq(rolesCatalog.id, existingId));
              } else {
                action = 'INSERT';
                message = 'Cargo criado';
                let newId = -(virtualSeq++);
                if (isCommit) {
                  const [ins] = await tx.insert(rolesCatalog).values(payload).returning();
                  newId = ins.id;
                }
                roleMap.set(normKey(name), newId);
              }
              break;
            }
            case 'series_catalog': {
              const sigla = normText(r.sigla_serie).toUpperCase();
              const description = normText(r.descricao);
              if (!sigla || !description) throw new Error('sigla_serie e descricao obrigatórios');
              naturalKey = sigla;
              assignedCode = sigla;
              const existingId = seriesMap.get(normKey(sigla));
              const payload = {
                sigla,
                description,
                generalNumber: Math.max(1, parseIntSafe(r.numeracao_geral, 1)),
                isDefault: parseBool(r.padrao, false),
              };
              if (existingId) {
                action = 'UPDATE';
                message = `Série ${sigla} atualizada`;
                if (isCommit) await tx.update(seriesCatalog).set(payload).where(eq(seriesCatalog.id, existingId));
              } else {
                action = 'INSERT';
                message = `Série ${sigla} criada`;
                let newId = -(virtualSeq++);
                if (isCommit) {
                  const [ins] = await tx.insert(seriesCatalog).values(payload).returning();
                  newId = ins.id;
                }
                seriesMap.set(normKey(sigla), newId);
              }
              break;
            }
            case 'payment_categories': {
              const name = normText(r.nome_categoria);
              if (!name) throw new Error('nome_categoria obrigatório');
              naturalKey = name;
              const existingId = catMap.get(normKey(name));
              const payload = { name, providerCode: normText(r.codigo_provedor) || 'custom', active: parseBool(r.ativo, true) };
              if (existingId) {
                action = 'UPDATE';
                message = 'Categoria atualizada';
                if (isCommit) await tx.update(paymentCategories).set(payload).where(eq(paymentCategories.id, existingId));
              } else {
                action = 'INSERT';
                message = 'Categoria criada';
                let newId = -(virtualSeq++);
                if (isCommit) {
                  const [ins] = await tx.insert(paymentCategories).values(payload).returning();
                  newId = ins.id;
                }
                catMap.set(normKey(name), newId);
              }
              break;
            }
            case 'bearers': {
              const name = normText(r.nome_portador);
              if (!name) throw new Error('nome_portador obrigatório');
              const existingId = bearerMap.get(normKey(r.codigo_portador)) || bearerMap.get(normKey(name));
              const code = normText(r.codigo_portador) || nextAutoCode('POR');
              const unitId = r.codigo_unidade ? resolveUnitId(r.codigo_unidade) : null;
              if (r.codigo_unidade && !unitId) throw new Error(`Unidade "${r.codigo_unidade}" não encontrada`);
              naturalKey = code;
              assignedCode = code;
              const payload = { code, name, type: normText(r.tipo) || 'banco', unitId, active: parseBool(r.ativo, true) };
              if (existingId) {
                action = 'UPDATE';
                message = `Portador ${code} atualizado`;
                if (isCommit) await tx.update(bearers).set(payload).where(eq(bearers.id, existingId));
              } else {
                action = 'INSERT';
                message = `Portador ${code} criado`;
                let newId = -(virtualSeq++);
                if (isCommit) {
                  const [ins] = await tx.insert(bearers).values(payload).returning();
                  newId = ins.id;
                }
                bearerMap.set(normKey(code), newId);
                bearerMap.set(normKey(name), newId);
              }
              break;
            }
            case 'document_types': {
              const description = normText(r.descricao);
              if (!description) throw new Error('descricao obrigatório');
              naturalKey = description;
              const existingId = docTypeMap.get(normKey(description));
              const payload = {
                description,
                category: normText(r.categoria) || 'ambos',
                isFiscal: parseBool(r.fiscal, false),
                requiresNumber: parseBool(r.exige_numero, false),
                active: parseBool(r.ativo, true),
              };
              if (existingId) {
                action = 'UPDATE';
                message = 'Tipo de documento atualizado';
                if (isCommit) await tx.update(documentTypes).set(payload).where(eq(documentTypes.id, existingId));
              } else {
                action = 'INSERT';
                message = 'Tipo de documento criado';
                let newId = -(virtualSeq++);
                if (isCommit) {
                  const [ins] = await tx.insert(documentTypes).values(payload).returning();
                  newId = ins.id;
                }
                docTypeMap.set(normKey(description), newId);
              }
              break;
            }
            case 'chart_of_accounts': {
              const name = normText(r.nome_conta);
              if (!name) throw new Error('nome_conta obrigatório');
              const code = normText(r.codigo_conta) || nextAutoCode('PC');
              naturalKey = code;
              assignedCode = code;
              const existingId = chartMap.get(normKey(code));
              const payload = {
                code,
                name,
                type: normText(r.tipo) || 'despesa',
                isAnalytic: parseBool(r.analitica, true),
                active: parseBool(r.ativo, true),
              };
              if (existingId) {
                action = 'UPDATE';
                message = `Conta contábil ${code} atualizada`;
                if (isCommit) await tx.update(chartOfAccounts).set(payload).where(eq(chartOfAccounts.id, existingId));
              } else {
                action = 'INSERT';
                message = `Conta contábil ${code} criada`;
                let newId = -(virtualSeq++);
                if (isCommit) {
                  const [ins] = await tx.insert(chartOfAccounts).values(payload).returning();
                  newId = ins.id;
                }
                chartMap.set(normKey(code), newId);
              }
              break;
            }
            case 'modalities': {
              const type = normText(r.tipo_segmento);
              const description = normText(r.descricao_modalidade);
              if (!type || !description) throw new Error('tipo_segmento e descricao_modalidade obrigatórios');
              const k = `${normKey(type)}::${normKey(description)}`;
              naturalKey = `${type} - ${description}`;
              const existingId = modalMap.get(k);
              const payload = {
                type,
                description,
                hasVehicleSection: parseBool(r.exige_dados_veiculo, false),
                active: parseBool(r.ativo, true),
              };
              if (existingId) {
                action = 'UPDATE';
                message = 'Modalidade atualizada';
                if (isCommit) await tx.update(modalities).set(payload).where(eq(modalities.id, existingId));
              } else {
                action = 'INSERT';
                message = 'Modalidade criada';
                let newId = -(virtualSeq++);
                if (isCommit) {
                  const [ins] = await tx.insert(modalities).values(payload).returning();
                  newId = ins.id;
                }
                modalMap.set(k, newId);
              }
              break;
            }
            case 'banks': {
              const name = normText(r.nome_banco);
              if (!name) throw new Error('nome_banco obrigatório');
              const existingId = bankMap.get(normKey(r.codigo_banco)) || bankMap.get(normKey(name));
              const code = normText(r.codigo_banco) || nextAutoCode('BCO');
              naturalKey = code;
              assignedCode = code;
              const payload = {
                code,
                name,
                febrabanCode: normText(r.codigo_febraban),
                status: normText(r.status) || 'ATIVO',
                notes: normText(r.observacoes),
              };
              if (existingId) {
                action = 'UPDATE';
                message = `Banco ${code} atualizado`;
                if (isCommit) await tx.update(banks).set(payload).where(eq(banks.id, existingId));
              } else {
                action = 'INSERT';
                message = `Banco ${code} criado`;
                let newId = -(virtualSeq++);
                if (isCommit) {
                  const [ins] = await tx.insert(banks).values(payload).returning();
                  newId = ins.id;
                }
                bankMap.set(normKey(code), newId);
                bankMap.set(normKey(name), newId);
              }
              break;
            }
            case 'measurement_units': {
              const name = normText(r.nome_unidade_medida);
              if (!name) throw new Error('nome_unidade_medida obrigatório');
              naturalKey = name;
              const existingId = mUnitMap.get(normKey(name));
              const payload = { name, conversionFactor: normText(r.fator_conversao) || '1' };
              if (existingId) {
                action = 'UPDATE';
                message = 'Unidade de medida atualizada';
                if (isCommit) await tx.update(measurementUnits).set(payload).where(eq(measurementUnits.id, existingId));
              } else {
                action = 'INSERT';
                message = 'Unidade de medida criada';
                let newId = -(virtualSeq++);
                if (isCommit) {
                  const [ins] = await tx.insert(measurementUnits).values(payload).returning();
                  newId = ins.id;
                }
                mUnitMap.set(normKey(name), newId);
              }
              break;
            }
            case 'products': {
              const description = normText(r.descricao);
              if (!description) throw new Error('descricao obrigatório');
              naturalKey = description;
              const mUnitId = r.unidade_medida ? mUnitMap.get(normKey(r.unidade_medida)) ?? null : null;
              const existingId = productMap.get(normKey(description));
              const payload = { type: normText(r.tipo) || 'SERVICO', description, unitId: mUnitId };
              if (existingId) {
                action = 'UPDATE';
                message = 'Produto/Serviço atualizado';
                if (isCommit) await tx.update(products).set(payload).where(eq(products.id, existingId));
              } else {
                action = 'INSERT';
                message = 'Produto/Serviço criado';
                let newId = -(virtualSeq++);
                if (isCommit) {
                  const [ins] = await tx.insert(products).values(payload).returning();
                  newId = ins.id;
                }
                productMap.set(normKey(description), newId);
              }
              break;
            }
            case 'schedule_services': {
              const name = normText(r.nome_servico);
              if (!name) throw new Error('nome_servico obrigatório');
              naturalKey = name;
              const existingId = serviceMap.get(normKey(name));
              const payload = {
                name,
                durationMinutes: Math.max(5, parseIntSafe(r.duracao_minutos, 30)),
                priceCents: parseCentsFromBrl(r.valor_brl),
                color: normText(r.cor_hex) || '#e0e7ff',
                active: parseBool(r.ativo, true),
              };
              if (existingId) {
                action = 'UPDATE';
                message = 'Serviço de agenda atualizado';
                if (isCommit) await tx.update(scheduleServices).set(payload).where(eq(scheduleServices.id, existingId));
              } else {
                action = 'INSERT';
                message = 'Serviço de agenda criado';
                let newId = -(virtualSeq++);
                if (isCommit) {
                  const [ins] = await tx.insert(scheduleServices).values(payload).returning();
                  newId = ins.id;
                }
                serviceMap.set(normKey(name), newId);
              }
              break;
            }
            case 'collaborators': {
              const name = normText(r.nome_completo);
              const unitId = resolveUnitId(r.codigo_unidade);
              if (!name) throw new Error('nome_completo obrigatório');
              if (!unitId) throw new Error(`codigo_unidade "${r.codigo_unidade}" não encontrado`);
              const email = normText(r.email);
              const existingId =
                collabMap.get(normKey(r.codigo_colaborador)) ||
                (email ? collabMap.get(normKey(email)) : undefined) ||
                collabMap.get(`${normKey(name)}::${unitId}`);
              const code = normText(r.codigo_colaborador) || nextAutoCode('COL');
              naturalKey = code;
              assignedCode = code;
              const payload = {
                code,
                name,
                unitId,
                departmentId: r.departamento ? deptMap.get(normKey(r.departamento)) ?? null : null,
                roleId: r.cargo ? roleMap.get(normKey(r.cargo)) ?? null : null,
                jobTitle: normText(r.funcao_exibicao),
                email,
                phone: normText(r.telefone),
                isWhatsapp: parseBool(r.whatsapp_ativo, false),
                participatesInScheduleQueue: parseBool(r.fila_agenda, false),
                active: parseBool(r.ativo, true),
                city: normText(r.cidade),
                state: normText(r.uf).toUpperCase().slice(0, 2),
              };
              if (existingId) {
                action = 'UPDATE';
                message = `Colaborador ${code} atualizado`;
                if (isCommit) await tx.update(collaborators).set(payload).where(eq(collaborators.id, existingId));
              } else {
                action = 'INSERT';
                message = `Colaborador ${code} criado`;
                let newId = -(virtualSeq++);
                if (isCommit) {
                  const [ins] = await tx.insert(collaborators).values(payload).returning();
                  newId = ins.id;
                }
                collabMap.set(normKey(code), newId);
                if (email) collabMap.set(normKey(email), newId);
                collabMap.set(`${normKey(name)}::${unitId}`, newId);
              }
              break;
            }
            case 'users': {
              const email = normText(r.email_login).toLowerCase();
              const name = normText(r.nome_usuario);
              if (!email || !name) throw new Error('email_login e nome_usuario obrigatórios');
              const uid = normText(r.codigo_uid) || nextAutoCode('USR');
              naturalKey = email;
              assignedCode = uid;
              const defaultUnitId = r.codigo_unidade_padrao ? resolveUnitId(r.codigo_unidade_padrao) : null;
              const groupId = r.grupo_acesso ? groupMap.get(normKey(r.grupo_acesso)) ?? null : null;
              const existingId = userMap.get(normKey(email));
              if (existingId) {
                action = 'UPDATE';
                message = `Usuário ${email} atualizado`;
                if (isCommit) {
                  await tx
                    .update(users)
                    .set({
                      name,
                      role: normText(r.perfil_role) || 'consultant',
                      groupId,
                      defaultUnitId,
                      whatsappPhone: normText(r.whatsapp),
                      active: parseBool(r.ativo, true),
                    })
                    .where(eq(users.id, existingId));
                }
              } else {
                action = 'INSERT';
                message = `Usuário ${email} criado (código ${uid})`;
                let newId = -(virtualSeq++);
                if (isCommit) {
                  const [ins] = await tx
                    .insert(users)
                    .values({
                      uid: `${uid}-${crypto.randomBytes(2).toString('hex')}`,
                      email,
                      name,
                      role: normText(r.perfil_role) || 'consultant',
                      groupId,
                      defaultUnitId,
                      allowedUnitIds: defaultUnitId ? [defaultUnitId] : [],
                      whatsappPhone: normText(r.whatsapp),
                      active: parseBool(r.ativo, true),
                      mustChangePassword: true,
                    })
                    .returning();
                  newId = ins.id;
                }
                userMap.set(normKey(email), newId);
              }
              break;
            }
            case 'clients': {
              const fullName = normText(r.nome_completo);
              const rawCpf = normText(r.cpf_cnpj);
              const digits = normDigits(rawCpf);
              const unitId = resolveUnitId(r.codigo_unidade);
              if (!fullName) throw new Error('nome_completo obrigatório');
              if (digits.length < 11) throw new Error('cpf_cnpj inválido (< 11 dígitos)');
              if (!unitId) throw new Error(`codigo_unidade "${r.codigo_unidade}" não encontrado`);
              naturalKey = rawCpf;
              assignedCode = rawCpf;
              const existing = clientMap.get(digits);
              const payload = {
                personNature: normText(r.natureza_pf_pj) || (digits.length > 11 ? 'PJ' : 'PF'),
                fullName,
                cpfCnpj: rawCpf,
                rg: normText(r.rg),
                birthDate: normText(r.data_nascimento),
                profession: normText(r.profissao),
                maritalStatus: normText(r.estado_civil),
                phone: normText(r.telefone),
                whatsapp: normText(r.whatsapp),
                secondaryPhone: normText(r.telefone_secundario),
                email: normText(r.email),
                zipCode: normText(r.cep),
                address: normText(r.logradouro),
                addressNumber: normText(r.numero),
                complement: normText(r.complemento),
                neighborhood: normText(r.bairro),
                city: normText(r.cidade),
                state: normText(r.uf).toUpperCase().slice(0, 2),
                clientType: normText(r.tipo_cliente) || 'titular',
                natureza: normText(r.natureza_cadastro) || 'C',
                status: normText(r.status) || 'ativo',
                notes: normText(r.observacoes),
                unitId,
              };
              if (existing) {
                action = 'UPDATE';
                message = `Cliente ${rawCpf} atualizado via Upsert`;
                if (isCommit) await tx.update(clients).set(payload).where(eq(clients.id, existing.id));
              } else {
                action = 'INSERT';
                message = `Cliente ${rawCpf} inserido`;
                let newId = -(virtualSeq++);
                if (isCommit) {
                  const [ins] = await tx.insert(clients).values(payload).returning();
                  newId = ins.id;
                }
                clientMap.set(digits, { id: newId, cpfCnpj: rawCpf, unitId });
              }
              break;
            }
            case 'client_asset_links': {
              const titDig = normDigits(r.cpf_cnpj_titular);
              const ownDig = normDigits(r.cpf_cnpj_responsavel_bem);
              const tit = clientMap.get(titDig);
              const own = clientMap.get(ownDig);
              if (!tit) throw new Error(`Titular "${r.cpf_cnpj_titular}" não localizado`);
              if (!own) throw new Error(`Responsável pelo bem "${r.cpf_cnpj_responsavel_bem}" não localizado`);
              naturalKey = `${titDig} -> ${ownDig}`;
              action = 'INSERT';
              message = 'Vínculo titular/possuidor registrado';
              if (isCommit) {
                await tx.insert(clientAssetLinks).values({
                  titularClientId: tit.id,
                  assetOwnerClientId: own.id,
                  relationshipLabel: normText(r.grau_vinculo) || 'Responsável pelo Bem',
                  vehiclePlate: normText(r.placa_veiculo),
                  vehicleModel: normText(r.modelo_veiculo),
                  renavam: normText(r.renavam),
                });
              }
              break;
            }
            case 'bank_accounts': {
              const bankName = normText(r.nome_banco);
              const accountNumber = normText(r.numero_conta);
              if (!bankName || !accountNumber) throw new Error('nome_banco e numero_conta obrigatórios');
              const unitId = r.codigo_unidade ? resolveUnitId(r.codigo_unidade) : null;
              naturalKey = accountNumber;
              assignedCode = accountNumber;
              const existingId =
                bankAccMap.get(`${normKey(bankName)}::${normKey(accountNumber)}`) ||
                bankAccMap.get(normKey(accountNumber));
              const payload = {
                bankName,
                agency: normText(r.agencia),
                accountNumber,
                accountType: normText(r.tipo_conta) || 'corrente',
                initialBalanceCents: parseCentsFromBrl(r.saldo_inicial_brl),
                currentBalanceCents: parseCentsFromBrl(r.saldo_atual_brl),
                unitId,
                active: parseBool(r.ativo, true),
              };
              if (existingId) {
                action = 'UPDATE';
                message = `Conta ${accountNumber} atualizada`;
                if (isCommit) await tx.update(bankAccounts).set(payload).where(eq(bankAccounts.id, existingId));
              } else {
                action = 'INSERT';
                message = `Conta ${accountNumber} criada`;
                let newId = -(virtualSeq++);
                if (isCommit) {
                  const [ins] = await tx.insert(bankAccounts).values(payload).returning();
                  newId = ins.id;
                }
                bankAccMap.set(normKey(accountNumber), newId);
                bankAccMap.set(`${normKey(bankName)}::${normKey(accountNumber)}`, newId);
              }
              break;
            }
            case 'prospection_leads': {
              const name = normText(r.nome_lead);
              const phone = normText(r.telefone);
              const unitId = resolveUnitId(r.codigo_unidade);
              if (!name || !phone || !unitId) throw new Error('codigo_unidade, nome_lead e telefone obrigatórios');
              naturalKey = phone;
              action = 'INSERT';
              message = `Lead ${name} inserido`;
              if (isCommit) {
                await tx.insert(prospectionLeads).values({
                  name,
                  phone,
                  email: normText(r.email),
                  channel: normText(r.canal_origem) || 'whatsapp_uazapi',
                  unitId,
                  stage: normText(r.estagio) || 'novo',
                  summaryText: normText(r.resumo),
                });
              }
              break;
            }
            case 'admissions': {
              const unitId = resolveUnitId(r.codigo_unidade);
              const contractNumber = normText(r.numero_contrato);
              const client = clientMap.get(normDigits(r.cpf_cnpj_cliente));
              const bankName = normText(r.banco_credor) || 'Não Informado';
              if (!unitId) throw new Error(`codigo_unidade "${r.codigo_unidade}" não encontrado`);
              if (!contractNumber) throw new Error('numero_contrato obrigatório');
              if (!client) throw new Error(`Cliente "${r.cpf_cnpj_cliente}" não encontrado (Cadastre na aba Clientes antes)`);

              const assetOwner = r.cpf_cnpj_responsavel_bem ? clientMap.get(normDigits(r.cpf_cnpj_responsavel_bem)) : null;
              const rawProto = normText(r.codigo_protocolo);
              const rawInt = normText(r.codigo_seguro_integrativo);
              const existing =
                (rawInt ? admMap.get(`INT::${normKey(rawInt)}`) : undefined) ||
                (rawProto ? admMap.get(`PROTO::${normKey(rawProto)}`) : undefined) ||
                admMap.get(`CTR::${unitId}::${normKey(contractNumber)}`) ||
                admMap.get(`CTR_ANY::${normKey(contractNumber)}`);

              const series = normText(r.serie) || 'ADM';
              const protocolCode = existing?.protocolCode || rawProto || `${series}-${String(existingAdmissions.length + codeCounter++).padStart(4, '0')}-${crypto.randomInt(10, 99)}`;
              const unitCode = resolveUnitCode(unitId);

              naturalKey = contractNumber;
              assignedCode = protocolCode;

              const payload = {
                protocolCode,
                clientId: client.id,
                assetOwnerId: assetOwner?.id ?? null,
                unitId,
                bankName,
                contractNumber,
                debtType: normText(r.segmento_divida) || 'veicular',
                modality: normText(r.modalidade) || 'CDC Veículo',
                series,
                consultantName: normText(r.consultor_nome),
                origin: normText(r.origem),
                vehicleBrand: normText(r.veiculo_marca),
                vehicleModel: normText(r.veiculo_modelo),
                vehicleYear: normText(r.veiculo_ano),
                vehiclePlate: normText(r.veiculo_placa),
                vehicleRenavam: normText(r.veiculo_renavam),
                vehicleChassis: normText(r.veiculo_chassi),
                debtTotalInstallments: parseIntSafe(r.qtd_parcelas_totais, 48),
                debtPaidInstallments: parseIntSafe(r.qtd_parcelas_pagas, 0),
                debtOverdueInstallments: parseIntSafe(r.qtd_parcelas_atraso, 0),
                financedAmountCents: parseCentsFromBrl(r.valor_financiado_brl),
                currentInstallmentCents: parseCentsFromBrl(r.valor_parcela_atual_brl),
                debtAmountCents: parseCentsFromBrl(r.valor_divida_brl),
                serviceFeeCents: parseCentsFromBrl(r.valor_honorarios_brl),
                installmentsCount: Math.max(1, parseIntSafe(r.parcelas_honorarios, 6)),
                status: normText(r.status_admissao) || 'aprovada',
                notes: normText(r.observacoes),
              };

              if (existing) {
                action = 'UPDATE';
                integrativeCode =
                  existing.integrativeCode ||
                  rawInt ||
                  (params.assignIntegrative && existing.id > 0
                    ? generateIntegrativeCode({ unitCode, entityType: 'DOSS', entityId: existing.id, referenceSeed: contractNumber })
                    : '');
                message = `Admissão contrato ${contractNumber} atualizada via Upsert`;
                if (isCommit) {
                  await tx
                    .update(admissions)
                    .set({
                      ...payload,
                      integrativeCode: integrativeCode || existing.integrativeCode || null,
                    })
                    .where(eq(admissions.id, existing.id));
                }
              } else {
                action = 'INSERT';
                let newId = -(virtualSeq++);
                if (isCommit) {
                  const [ins] = await tx.insert(admissions).values(payload).returning();
                  newId = ins.id;
                  if (params.assignIntegrative !== false) {
                    integrativeCode = generateIntegrativeCode({
                      unitCode,
                      entityType: 'DOSS',
                      entityId: newId,
                      referenceSeed: contractNumber,
                    });
                    await tx
                      .update(admissions)
                      .set({ integrativeCode, legacyProtocolCode: protocolCode })
                      .where(eq(admissions.id, newId));
                  }
                } else {
                  integrativeCode = `INV-${unitCode}-DOSS-PREVIA-HMAC`;
                }
                const entry = {
                  id: newId,
                  unitId,
                  clientId: client.id,
                  protocolCode,
                  contractNumber,
                  integrativeCode: integrativeCode || null,
                };
                admMap.set(`PROTO::${normKey(protocolCode)}`, entry);
                admMap.set(`CTR::${unitId}::${normKey(contractNumber)}`, entry);
                admMap.set(`CTR_ANY::${normKey(contractNumber)}`, entry);
                message = `Admissão criada (${protocolCode})`;
              }
              break;
            }
            case 'negotiations': {
              const unitId = resolveUnitId(r.codigo_unidade);
              const client = clientMap.get(normDigits(r.cpf_cnpj_cliente));
              const contractNumber = normText(r.numero_contrato);
              if (!unitId || !client) throw new Error('codigo_unidade e cpf_cnpj_cliente válidos obrigatórios');
              const adm = contractNumber
                ? admMap.get(`CTR::${unitId}::${normKey(contractNumber)}`) || admMap.get(`CTR_ANY::${normKey(contractNumber)}`)
                : undefined;
              naturalKey = `${client.cpfCnpj} / ${contractNumber || 'S/C'}`;
              const existingId = negMap.get(`${client.id}::${normKey(contractNumber)}`);
              const payload = {
                unitId,
                clientId: client.id,
                admissionId: adm?.id && adm.id > 0 ? adm.id : null,
                contractNumber,
                bankName: normText(r.banco_credor) || 'Não Informado',
                collaboratorName: normText(r.negociador),
                openDate: normText(r.data_abertura),
                originalDebtCents: parseCentsFromBrl(r.divida_original_brl),
                targetReductionPct: parseIntSafe(r.meta_desconto_pct, 55),
                currentReductionPct: parseIntSafe(r.desconto_atual_pct, 20),
                estimatedSavingsCents: parseCentsFromBrl(r.economia_estimada_brl),
                targetDeadline: parseDateSafe(r.prazo_alvo, new Date(Date.now() + 30 * 86400000)),
                negotiationStatus: normText(r.status_negociacao) || 'EM_ANDAMENTO',
                notes: normText(r.observacoes),
              };
              if (existingId) {
                action = 'UPDATE';
                message = 'Negociação atualizada';
                if (isCommit) await tx.update(negotiations).set(payload).where(eq(negotiations.id, existingId));
              } else {
                action = 'INSERT';
                message = 'Negociação criada';
                let newId = -(virtualSeq++);
                if (isCommit) {
                  const [ins] = await tx.insert(negotiations).values(payload).returning();
                  newId = ins.id;
                }
                negMap.set(`${client.id}::${normKey(contractNumber)}`, newId);
              }
              break;
            }
            case 'commercial_deals': {
              const unitId = resolveUnitId(r.codigo_unidade);
              const client = clientMap.get(normDigits(r.cpf_cnpj_cliente));
              if (!unitId || !client) throw new Error('codigo_unidade e cpf_cnpj_cliente válidos obrigatórios');
              const contractNumber = normText(r.numero_contrato);
              const adm = contractNumber ? admMap.get(`CTR_ANY::${normKey(contractNumber)}`) : undefined;
              naturalKey = `${client.cpfCnpj} / ${normText(r.banco_credor)}`;
              action = 'INSERT';
              message = 'Oportunidade comercial inserida';
              if (isCommit) {
                await tx.insert(commercialDeals).values({
                  unitId,
                  clientId: client.id,
                  admissionId: adm?.id && adm.id > 0 ? adm.id : null,
                  bankName: normText(r.banco_credor) || 'Banco',
                  collaboratorName: normText(r.responsavel),
                  stage: normText(r.estagio_funil) || 'TRIAGEM',
                  debtValueCents: parseCentsFromBrl(r.valor_divida_brl),
                  proposedValueCents: r.valor_proposto_brl ? parseCentsFromBrl(r.valor_proposto_brl) : null,
                  notes: normText(r.observacoes),
                });
              }
              break;
            }
            case 'financial_titles': {
              const unitId = resolveUnitId(r.codigo_unidade);
              const client = clientMap.get(normDigits(r.cpf_cnpj_cliente));
              if (!unitId || !client) throw new Error('codigo_unidade e cpf_cnpj_cliente válidos obrigatórios');
              const contractNumber = normText(r.numero_contrato);
              const adm = contractNumber
                ? admMap.get(`CTR::${unitId}::${normKey(contractNumber)}`) || admMap.get(`CTR_ANY::${normKey(contractNumber)}`)
                : undefined;
              const inst = Math.max(1, parseIntSafe(r.parcela_atual, 1));
              const totalInst = Math.max(inst, parseIntSafe(r.total_parcelas, 1));
              const rawCode = normText(r.codigo_titulo);
              const existing =
                (rawCode ? titleMap.get(normKey(rawCode)) : undefined) ||
                (contractNumber ? titleMap.get(`CTR_INST::${normKey(contractNumber)}::${inst}`) : undefined);
              const titleCode =
                existing?.titleCode ||
                rawCode ||
                `TIT-${resolveUnitCode(unitId)}-${existingTitles.length + codeCounter++}-${String(inst).padStart(2, '0')}`;
              naturalKey = titleCode;
              assignedCode = titleCode;
              const amountCents = parseCentsFromBrl(r.valor_brl);
              const balanceCents = r.saldo_aberto_brl !== '' && r.saldo_aberto_brl !== undefined ? parseCentsFromBrl(r.saldo_aberto_brl) : amountCents;
              const payload = {
                titleCode,
                scope: normText(r.carteira) || 'RECEBER',
                titleType: normText(r.tipo_titulo) || 'PADRAO',
                origin: 'IMPORTACAO',
                documentNumber: normText(r.numero_documento),
                description: normText(r.descricao),
                clientId: client.id,
                admissionId: adm?.id && adm.id > 0 ? adm.id : null,
                unitId,
                categoryId: r.categoria_financeira ? catMap.get(normKey(r.categoria_financeira)) ?? null : null,
                chartAccountId: r.codigo_plano_contas ? chartMap.get(normKey(r.codigo_plano_contas)) ?? null : null,
                installmentNumber: inst,
                totalInstallments: totalInst,
                amountCents,
                originalValueCents: amountCents,
                currentBalanceCents: balanceCents,
                issueDate: parseDateSafe(r.data_emissao),
                dueDate: parseDateSafe(r.data_vencimento),
                status: normText(r.status) || 'ABERTO',
                contractNumber,
              };
              if (existing) {
                action = 'UPDATE';
                message = `Título ${titleCode} atualizado`;
                if (isCommit) await tx.update(financialTitles).set(payload).where(eq(financialTitles.id, existing.id));
              } else {
                action = 'INSERT';
                message = `Título ${titleCode} inserido`;
                let newId = -(virtualSeq++);
                if (isCommit) {
                  const [ins] = await tx.insert(financialTitles).values(payload).returning();
                  newId = ins.id;
                }
                titleMap.set(normKey(titleCode), { id: newId, titleCode });
                if (contractNumber) titleMap.set(`CTR_INST::${normKey(contractNumber)}::${inst}`, { id: newId, titleCode });
              }
              break;
            }
            case 'title_settlements': {
              const title = titleMap.get(normKey(r.codigo_titulo));
              if (!title) throw new Error(`Título "${r.codigo_titulo}" não encontrado`);
              naturalKey = title.titleCode;
              action = 'INSERT';
              message = `Baixa vinculada ao título ${title.titleCode}`;
              if (isCommit && title.id > 0) {
                await tx.insert(titleSettlements).values({
                  titleId: title.id,
                  settlementDate: parseDateSafe(r.data_baixa),
                  principalCents: parseCentsFromBrl(r.principal_brl),
                  interestCents: parseCentsFromBrl(r.juros_brl),
                  fineCents: parseCentsFromBrl(r.multa_brl),
                  discountCents: parseCentsFromBrl(r.desconto_brl),
                  amountCents: parseCentsFromBrl(r.valor_total_pago_brl),
                  origin: 'IMPORTACAO_EXCEL',
                  paymentMethod: normText(r.forma_pagamento) || 'PIX',
                  bankAccountId: r.conta_bancaria ? bankAccMap.get(normKey(r.conta_bancaria)) ?? null : null,
                  history: normText(r.historico),
                  createdByName: params.actorName,
                });
              }
              break;
            }
            case 'bank_movements': {
              const accId = bankAccMap.get(normKey(r.numero_conta));
              if (!accId) throw new Error(`Conta bancária "${r.numero_conta}" não encontrada`);
              const unitId = r.codigo_unidade ? resolveUnitId(r.codigo_unidade) : null;
              naturalKey = `${normText(r.numero_conta)} / ${normText(r.numero_documento) || formatDateIso(parseDateSafe(r.data_movimento))}`;
              action = 'INSERT';
              message = 'Movimento bancário registrado';
              if (isCommit && accId > 0) {
                await tx.insert(bankMovements).values({
                  bankAccountId: accId,
                  movementType: normText(r.tipo_movimento) || 'CREDITO',
                  amountCents: parseCentsFromBrl(r.valor_brl),
                  movementDate: parseDateSafe(r.data_movimento),
                  documentNumber: normText(r.numero_documento),
                  description: normText(r.descricao) || 'Importação Excel',
                  categoryId: r.codigo_plano_contas ? chartMap.get(normKey(r.codigo_plano_contas)) ?? null : null,
                  reconciled: parseBool(r.conciliado, false),
                  status: parseBool(r.conciliado, false) ? 'CONCILIADO' : 'PENDENTE',
                  unitId,
                });
              }
              break;
            }
            case 'legal_processes': {
              const unitId = resolveUnitId(r.codigo_unidade);
              const client = clientMap.get(normDigits(r.cpf_cnpj_cliente));
              const processNumber = normText(r.numero_processo_cnj);
              if (!unitId || !client || !processNumber) {
                throw new Error('codigo_unidade, cpf_cnpj_cliente e numero_processo_cnj obrigatórios');
              }
              const adm = r.numero_contrato ? admMap.get(`CTR_ANY::${normKey(r.numero_contrato)}`) : undefined;
              naturalKey = processNumber;
              assignedCode = processNumber;
              const existingId = legalProcMap.get(normKey(processNumber));
              const payload = {
                processNumber,
                clientId: client.id,
                admissionId: adm?.id && adm.id > 0 ? adm.id : null,
                unitId,
                courtName: normText(r.vara_tribunal) || 'Vara Cível',
                actionType: normText(r.tipo_acao) || 'busca_apreensao',
                hasSearchSeizure: parseBool(r.possui_busca_apreensao, false),
                vehicleSeized: parseBool(r.veiculo_apreendido, false),
                status: normText(r.status) || 'em_acompanhamento',
                escavadorMonitored: parseBool(r.monitorado_escavador, true),
              };
              if (existingId) {
                action = 'UPDATE';
                message = `Processo ${processNumber} atualizado`;
                if (isCommit) await tx.update(legalProcesses).set(payload).where(eq(legalProcesses.id, existingId));
              } else {
                action = 'INSERT';
                message = `Processo ${processNumber} inserido`;
                let newId = -(virtualSeq++);
                if (isCommit) {
                  const [ins] = await tx.insert(legalProcesses).values(payload).returning();
                  newId = ins.id;
                }
                legalProcMap.set(normKey(processNumber), newId);
              }
              break;
            }
            case 'company_legal_processes': {
              const processNumber = normText(r.numero_processo);
              if (!processNumber) throw new Error('numero_processo obrigatório');
              const unitId = r.codigo_unidade ? resolveUnitId(r.codigo_unidade) : null;
              const partner = r.cpf_cnpj_parceiro_cliente ? clientMap.get(normDigits(r.cpf_cnpj_parceiro_cliente)) : null;
              const contractNumber = normText(r.numero_contrato);
              const adm = contractNumber ? admMap.get(`CTR_ANY::${normKey(contractNumber)}`) : undefined;
              naturalKey = processNumber;
              assignedCode = processNumber;
              const existingId = compProcMap.get(normKey(processNumber));
              const payload = {
                unitId,
                processNumber,
                court: normText(r.tribunal),
                jurisdiction: normText(r.comarca_vara),
                type: normText(r.tipo_processo) || 'CÍVEL',
                role: normText(r.polo) || 'RÉU',
                opposingParty: normText(r.parte_contraria),
                opposingPartyDocument: normText(r.cpf_cnpj_parte_contraria),
                partnerId: partner?.id && partner.id > 0 ? partner.id : null,
                admissionId: adm?.id && adm.id > 0 ? adm.id : null,
                contractNumber,
                responsibleLawyer: normText(r.advogado_responsavel),
                responsibleLawyerOab: normText(r.oab_responsavel),
                status: normText(r.status) || 'ATIVO',
                riskLevel: normText(r.grau_risco) || 'MEDIO',
                causeValue: normText(r.valor_causa),
                provisionValue: normText(r.valor_provisao),
                distributionDate: normText(r.data_distribuicao),
                subject: normText(r.assunto),
                notes: normText(r.anotacoes),
              };
              if (existingId) {
                action = 'UPDATE';
                message = `Processo empresarial ${processNumber} atualizado`;
                if (isCommit) await tx.update(companyLegalProcesses).set(payload).where(eq(companyLegalProcesses.id, existingId));
              } else {
                action = 'INSERT';
                message = `Processo empresarial ${processNumber} inserido`;
                let newId = -(virtualSeq++);
                if (isCommit) {
                  const [ins] = await tx.insert(companyLegalProcesses).values(payload).returning();
                  newId = ins.id;
                }
                compProcMap.set(normKey(processNumber), newId);
              }
              break;
            }
            case 'company_legal_process_movements': {
              const procId = compProcMap.get(normKey(r.numero_processo));
              if (!procId) throw new Error(`Processo "${r.numero_processo}" não localizado`);
              naturalKey = normText(r.numero_processo);
              action = 'INSERT';
              message = 'Movimentação vinculada ao processo';
              if (isCommit && procId > 0) {
                await tx.insert(companyLegalProcessMovements).values({
                  processId: procId,
                  date: normText(r.data_movimentacao),
                  type: normText(r.tipo) || 'DESPACHO',
                  description: normText(r.descricao),
                  source: normText(r.origem) || 'Importação Excel',
                });
              }
              break;
            }
            case 'company_legal_process_deadlines': {
              const procId = compProcMap.get(normKey(r.numero_processo));
              if (!procId) throw new Error(`Processo "${r.numero_processo}" não localizado`);
              naturalKey = normText(r.numero_processo);
              action = 'INSERT';
              message = 'Prazo vinculado ao processo';
              if (isCommit && procId > 0) {
                await tx.insert(companyLegalProcessDeadlines).values({
                  processId: procId,
                  type: normText(r.tipo_prazo) || 'OUTRO',
                  description: normText(r.descricao),
                  dueDate: normText(r.data_vencimento),
                  status: normText(r.status) || 'PENDENTE',
                  responsibleId: r.codigo_colaborador ? collabMap.get(normKey(r.codigo_colaborador)) ?? null : null,
                  notes: normText(r.observacoes),
                });
              }
              break;
            }
            case 'company_legal_process_hearings': {
              const procId = compProcMap.get(normKey(r.numero_processo));
              if (!procId) throw new Error(`Processo "${r.numero_processo}" não localizado`);
              naturalKey = normText(r.numero_processo);
              action = 'INSERT';
              message = 'Audiência vinculada ao processo';
              if (isCommit && procId > 0) {
                await tx.insert(companyLegalProcessHearings).values({
                  processId: procId,
                  type: normText(r.tipo_audiencia) || 'INICIAL',
                  date: normText(r.data_audiencia),
                  time: normText(r.horario),
                  location: normText(r.local_link),
                  status: normText(r.status) || 'AGENDADA',
                  notes: normText(r.observacoes),
                });
              }
              break;
            }
            case 'appointments': {
              const unitId = resolveUnitId(r.codigo_unidade);
              const consultantId = userMap.get(normKey(r.email_consultor));
              const clientName = normText(r.nome_cliente);
              const clientPhone = normText(r.telefone_cliente);
              if (!unitId || !consultantId || !clientName || !clientPhone) {
                throw new Error('codigo_unidade, email_consultor, nome_cliente e telefone_cliente obrigatórios');
              }
              const client = r.cpf_cnpj_cliente ? clientMap.get(normDigits(r.cpf_cnpj_cliente)) : null;
              naturalKey = `${clientName} (${clientPhone})`;
              action = 'INSERT';
              message = 'Agendamento inserido';
              if (isCommit && consultantId > 0) {
                await tx.insert(appointments).values({
                  unitId,
                  consultantId,
                  clientId: client?.id && client.id > 0 ? client.id : null,
                  clientName,
                  clientPhone,
                  serviceId: r.nome_servico ? serviceMap.get(normKey(r.nome_servico)) ?? null : null,
                  serviceName: normText(r.nome_servico),
                  modality: normText(r.modalidade_atendimento) || 'presencial',
                  scheduledFor: parseDateSafe(r.data_hora_inicio),
                  status: normText(r.status) || 'agendado',
                  notes: normText(r.observacoes),
                  createdByName: params.actorName,
                });
              }
              break;
            }
            case 'document_objects': {
              const unitId = resolveUnitId(r.codigo_unidade);
              const client = clientMap.get(normDigits(r.cpf_cnpj_cliente));
              const fileName = normText(r.nome_arquivo);
              if (!unitId || !client || !fileName) {
                throw new Error('codigo_unidade, cpf_cnpj_cliente e nome_arquivo obrigatórios');
              }
              const contractNumber = normText(r.numero_contrato);
              const adm = contractNumber
                ? admMap.get(`CTR::${unitId}::${normKey(contractNumber)}`) || admMap.get(`CTR_ANY::${normKey(contractNumber)}`)
                : undefined;
              const subPath = normText(r.subpasta_relativa) || fileName;
              const folderPath =
                normText(r.caminho_bucket) ||
                `bucketdainvicta/U${unitId}/C${client.id}${adm?.id && adm.id > 0 ? `/ADM-${adm.id}` : '/GERAL'}`;
              naturalKey = `${contractNumber || client.cpfCnpj}/${subPath}`;
              assignedCode = normText(r.codigo_seguro_integrativo) || '';
              action = 'INSERT';
              message = 'Metadado documental indexado';
              if (isCommit && client.id > 0) {
                const [ins] = await tx
                  .insert(documentObjects)
                  .values({
                    clientId: client.id,
                    admissionId: adm?.id && adm.id > 0 ? adm.id : null,
                    unitId,
                    folderPath,
                    relativeSubpath: subPath,
                    fileName,
                    docCategory: normText(r.categoria_documento) || 'contrato',
                    mimeType: normText(r.mime_type) || 'application/pdf',
                    sizeBytes: parseIntSafe(r.tamanho_bytes, 0),
                    sha256Hash: normText(r.sha256_hash) || crypto.createHash('sha256').update(`${folderPath}/${fileName}`).digest('hex'),
                    storageUri: `bucket://bucketdainvicta/pending-sync`,
                    uploadedBy: params.actorName,
                    versionNumber: Math.max(1, parseIntSafe(r.versao, 1)),
                  })
                  .returning();
                if (!assignedCode && params.assignIntegrative !== false) {
                  integrativeCode = generateIntegrativeCode({
                    unitCode: resolveUnitCode(unitId),
                    entityType: 'DOC',
                    entityId: ins.id,
                    referenceSeed: ins.sha256Hash || fileName,
                  });
                  assignedCode = integrativeCode;
                  await tx.update(documentObjects).set({ integrativeCode }).where(eq(documentObjects.id, ins.id));
                }
              }
              break;
            }
            default: {
              action = 'SKIP';
              message = 'Entidade sem manipulador transacional';
            }
          }
        } catch (err) {
          action = 'ERROR';
          message = err instanceof Error ? err.message : 'Erro desconhecido';
        }

        if (action === 'INSERT') summary.inserts++;
        else if (action === 'UPDATE') summary.updates++;
        else if (action === 'SKIP') summary.skips++;
        else summary.errors++;

        rowResults.push({
          entityKey: layout.key,
          sheetName,
          rowNumber,
          action,
          naturalKey,
          assignedCode,
          integrativeCode,
          message,
        });
      }

      orderedSheets.push(summary);
    }
  };

  if (isCommit) {
    await db.transaction(async (tx) => {
      await executeWork(tx);
    });
    await db.insert(auditLogs).values({
      userId: params.actorUserId ?? null,
      userName: params.actorName,
      action: 'EXCEL_PRECEDENCE_IMPORT_COMMITTED',
      entityType: 'data_hub',
      entityId: String(rowResults.length),
      details: {
        sheets: orderedSheets.map((s) => `${s.sheetName}(+${s.inserts}/~${s.updates}/!${s.errors})`),
        totals: {
          inserts: orderedSheets.reduce((acc, s) => acc + s.inserts, 0),
          updates: orderedSheets.reduce((acc, s) => acc + s.updates, 0),
          errors: orderedSheets.reduce((acc, s) => acc + s.errors, 0),
        },
      },
      unitId: params.unitFallbackId ?? null,
    });
  } else {
    await executeWork(db);
  }

  const totals = {
    totalRows: rowResults.length,
    inserts: orderedSheets.reduce((acc, s) => acc + s.inserts, 0),
    updates: orderedSheets.reduce((acc, s) => acc + s.updates, 0),
    skips: orderedSheets.reduce((acc, s) => acc + s.skips, 0),
    errors: orderedSheets.reduce((acc, s) => acc + s.errors, 0),
  };

  let returnWorkbookBase64: string | undefined;
  let returnFileName: string | undefined;
  if (isCommit) {
    const retWb = XLSX.utils.book_new();
    appendSheetFromObjects(
      retWb,
      '_Retorno_Importacao',
      ['aba', 'entidade', 'linha', 'acao', 'chave_natural', 'codigo_atribuido', 'codigo_seguro_integrativo', 'detalhe'],
      rowResults.map((rr) => ({
        aba: rr.sheetName,
        entidade: rr.entityKey,
        linha: rr.rowNumber,
        acao: rr.action,
        chave_natural: rr.naturalKey,
        codigo_atribuido: rr.assignedCode,
        codigo_seguro_integrativo: rr.integrativeCode,
        detalhe: rr.message,
      }))
    );
    const retBuf = XLSX.write(retWb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    returnWorkbookBase64 = retBuf.toString('base64');
    returnFileName = `retorno_importacao_${new Date().toISOString().slice(0, 10)}.xlsx`;
  }

  return {
    mode: params.mode,
    orderedSheets,
    totals,
    rowResults: rowResults.slice(0, 500),
    unrecognizedSheets,
    returnWorkbookBase64,
    returnFileName,
  };
}
