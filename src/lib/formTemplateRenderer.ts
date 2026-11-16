import type { Admission, Client, LegalProcess, Unit } from '../types.ts';
import {
  getCachedLogoNeedsDarkBackdrop,
  getCachedPortalBranding,
} from './portalBrandingCache.ts';

export interface FormMergeContext {
  client?: Partial<Client> | Record<string, any> | null;
  titular?: Partial<Client> | Record<string, any> | null;
  collaborator?: Record<string, any> | null;
  bank?: Record<string, any> | null;
  company?: Partial<Unit> | Record<string, any> | null;
  admission?: Partial<Admission> | Record<string, any> | null;
  recalc?: Record<string, any> | null;
  modality?: Record<string, any> | null;
  product?: Record<string, any> | null;
  service?: Record<string, any> | null;
  bankAccount?: Record<string, any> | null;
  documentType?: Record<string, any> | null;
  bearer?: Record<string, any> | null;
  chartOfAccount?: Record<string, any> | null;
  department?: Record<string, any> | null;
  series?: Record<string, any> | null;
  legalProcess?: Partial<LegalProcess> | Record<string, any> | null;
  currentUserName?: string;
}

const MONTHS_PT = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

const WEEKDAYS_PT = [
  'domingo',
  'segunda-feira',
  'terça-feira',
  'quarta-feira',
  'quinta-feira',
  'sexta-feira',
  'sábado',
];

export function formatMoneyFromCentsOrValue(centsOrRaw: unknown, rawFallback?: unknown): string {
  if (typeof centsOrRaw === 'number' && Number.isFinite(centsOrRaw)) {
    return (centsOrRaw / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }
  if (typeof rawFallback === 'number' && Number.isFinite(rawFallback)) {
    return rawFallback.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }
  if (typeof rawFallback === 'string' && rawFallback.trim()) return rawFallback;
  return 'R$ 0,00';
}

export function formatDateBRValue(val: unknown): string {
  if (!val) return '';
  if (val instanceof Date && !Number.isNaN(val.getTime())) {
    return val.toLocaleDateString('pt-BR');
  }
  const s = String(val).trim();
  if (!s) return '';
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return s;
  const iso = s.slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString('pt-BR');
}

function escapeHtmlValue(val: string): string {
  return val
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function sanitizeTemplateHtml(html: string): string {
  if (!html) return '';
  return String(html)
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/href\s*=\s*(['"])\s*javascript:[^'"]*\1/gi, 'href="#"')
    .replace(/src\s*=\s*(['"])\s*javascript:[^'"]*\1/gi, 'src=""');
}

export function buildTemplateVariableMap(ctx: FormMergeContext): Record<string, string> {
  const c: Record<string, any> = ctx.client || {};
  const t: Record<string, any> = ctx.titular || ctx.client || {};
  const col: Record<string, any> = ctx.collaborator || {};
  const b: Record<string, any> = ctx.bank || {};
  const emp: Record<string, any> = ctx.company || {};
  const adm: Record<string, any> = ctx.admission || {};
  const sc0: Record<string, any> =
    ctx.recalc ||
    (Array.isArray(adm.scenariosJson) && adm.scenariosJson.length > 0 ? adm.scenariosJson[0] : {}) ||
    {};
  const mod: Record<string, any> = ctx.modality || {};
  const prod: Record<string, any> = ctx.product || {};
  const srv: Record<string, any> = ctx.service || {};
  const cb: Record<string, any> = ctx.bankAccount || {};
  const td: Record<string, any> = ctx.documentType || {};
  const port: Record<string, any> = ctx.bearer || {};
  const pc: Record<string, any> = ctx.chartOfAccount || {};
  const dep: Record<string, any> = ctx.department || {};
  const ser: Record<string, any> = ctx.series || {};
  const proc: Record<string, any> = ctx.legalProcess || {};

  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yyyy = String(now.getFullYear());
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  const dataHoje = `${dd}/${mm}/${yyyy}`;
  const dataExtenso = `${now.getDate()} de ${MONTHS_PT[now.getMonth()]} de ${yyyy}`;

  const totalParcelas = Number(adm.debtTotalInstallments ?? adm.installmentsCount ?? 0);
  const parcelasPagas = Number(adm.debtPaidInstallments ?? 0);
  const parcelasAtraso = Number(adm.debtOverdueInstallments ?? 0);
  const parcelasAPagar = Math.max(0, totalParcelas - parcelasPagas);

  const clientName = String(c.fullName || c.name || adm.clientName || '');
  const clientDoc = String(c.cpfCnpj || c.document || '');
  const clientPhone = String(c.phone || c.whatsapp || '');
  const titularName = String(t.fullName || t.name || '');
  const titularDoc = String(t.cpfCnpj || t.document || '');

  const debtOrigCents =
    typeof sc0.originalDebtCents === 'number'
      ? sc0.originalDebtCents
      : typeof adm.debtAmountCents === 'number'
      ? adm.debtAmountCents
      : undefined;
  const recalcInstallmentCents =
    typeof sc0.recalcInstallmentCents === 'number' ? sc0.recalcInstallmentCents : undefined;
  const recalcDebtCents = typeof sc0.recalcDebtCents === 'number' ? sc0.recalcDebtCents : undefined;
  const savingsCents =
    typeof sc0.savingsCents === 'number'
      ? sc0.savingsCents
      : typeof debtOrigCents === 'number' && typeof recalcDebtCents === 'number'
      ? Math.max(0, debtOrigCents - recalcDebtCents)
      : undefined;

  const financedFmt = formatMoneyFromCentsOrValue(
    adm.financedAmountCents ?? adm.debtAmountCents,
    adm.financedAmount
  );
  const currentInstallmentFmt = formatMoneyFromCentsOrValue(
    adm.currentInstallmentCents ?? adm.initialInstallmentCents,
    adm.currentInstallment
  );
  const serviceFeeFmt = formatMoneyFromCentsOrValue(
    adm.serviceFeeCents ?? adm.serviceMgmtCents,
    adm.adminFee
  );
  const initialFeeFmt = formatMoneyFromCentsOrValue(
    adm.serviceInitialCents ?? adm.initialInstallmentCents,
    adm.initialInstallment
  );
  const secondFeeFmt = formatMoneyFromCentsOrValue(
    adm.serviceAdditionCents ?? adm.billingFeeCents,
    adm.secondInstallment
  );

  const map: Record<string, string> = {
    // 1. Cliente (19 + aliases)
    'cliente.id': String(c.id ?? ''),
    'cliente.nome': clientName,
    'cliente.tipo': String(c.clientType || c.personNature || 'PF'),
    'cliente.documento': clientDoc,
    'cliente.rg': String(c.rg || ''),
    'cliente.email': String(c.email || ''),
    'cliente.telefone': clientPhone,
    'cliente.telefone2': String(c.secondaryPhone || c.whatsapp || ''),
    'cliente.whatsapp': String(c.whatsapp || c.phone || ''),
    'cliente.profissao': String(c.profession || ''),
    'cliente.estado_civil': String(c.maritalStatus || ''),
    'cliente.data_nascimento': formatDateBRValue(c.birthDate),
    'cliente.cep': String(c.zipCode || c.cep || ''),
    'cliente.endereco': String(c.address || ''),
    'cliente.numero': String(c.addressNumber || c.number || ''),
    'cliente.complemento': String(c.complement || ''),
    'cliente.bairro': String(c.neighborhood || ''),
    'cliente.cidade': String(c.city || ''),
    'cliente.uf': String(c.state || ''),
    'cliente.anotacoes': String(c.notes || ''),

    // 2. Titular (19)
    'titular.id': String(t.id ?? ''),
    'titular.nome': titularName,
    'titular.tipo': String(t.clientType || t.personNature || ''),
    'titular.documento': titularDoc,
    'titular.rg': String(t.rg || ''),
    'titular.email': String(t.email || ''),
    'titular.telefone': String(t.phone || t.whatsapp || ''),
    'titular.telefone2': String(t.secondaryPhone || ''),
    'titular.profissao': String(t.profession || ''),
    'titular.estado_civil': String(t.maritalStatus || ''),
    'titular.data_nascimento': formatDateBRValue(t.birthDate),
    'titular.cep': String(t.zipCode || t.cep || ''),
    'titular.endereco': String(t.address || ''),
    'titular.numero': String(t.addressNumber || t.number || ''),
    'titular.complemento': String(t.complement || ''),
    'titular.bairro': String(t.neighborhood || ''),
    'titular.cidade': String(t.city || ''),
    'titular.uf': String(t.state || ''),
    'titular.anotacoes': String(t.notes || ''),

    // 3. Colaborador (16)
    'colaborador.id': String(col.id ?? adm.consultantId ?? ''),
    'colaborador.nome': String(col.name || col.fullName || adm.consultantName || ''),
    'colaborador.cargo': String(col.role || col.position || 'Consultor'),
    'colaborador.email': String(col.email || ''),
    'colaborador.telefone': String(col.phone || ''),
    'colaborador.whatsapp': String(col.whatsapp || col.phone || ''),
    'colaborador.estado_civil': String(col.maritalStatus || ''),
    'colaborador.data_nascimento': formatDateBRValue(col.birthDate),
    'colaborador.cep': String(col.zipCode || ''),
    'colaborador.endereco': String(col.address || ''),
    'colaborador.numero': String(col.addressNumber || ''),
    'colaborador.complemento': String(col.complement || ''),
    'colaborador.bairro': String(col.neighborhood || ''),
    'colaborador.cidade': String(col.city || ''),
    'colaborador.uf': String(col.state || ''),
    'colaborador.anotacoes': String(col.notes || ''),

    // 4. Banco (5)
    'banco.id': String(b.id ?? ''),
    'banco.nome': String(b.name || adm.bankName || ''),
    'banco.febraban': String(b.febrabanCode || b.code || ''),
    'banco.status': String(b.active === false ? 'Inativo' : 'Ativo'),
    'banco.anotacoes': String(b.notes || ''),

    // 5. Empresa / Unidade (12)
    'empresa.razao_social': String(emp.legalName || emp.name || 'FinancePro Assessoria Financeira'),
    'empresa.cnpj': String(emp.cnpj || ''),
    'empresa.telefone': String(emp.phone || emp.whatsappNumber || ''),
    'empresa.email': String(emp.email || ''),
    'empresa.cep': String(emp.zipCode || ''),
    'empresa.endereco': String(emp.address || ''),
    'empresa.numero': String(emp.addressNumber || ''),
    'empresa.complemento': String(emp.complement || ''),
    'empresa.bairro': String(emp.neighborhood || ''),
    'empresa.cidade': String(emp.city || ''),
    'empresa.uf': String(emp.state || ''),
    'empresa.taxa_minima': formatMoneyFromCentsOrValue(emp.minAdmissionCostCents),

    // 6. Admissão (28 + aliases)
    'admissao.id': String(adm.id ?? ''),
    'admissao.data': formatDateBRValue(adm.createdAt || now),
    'admissao.cliente': clientName,
    'admissao.contrato': String(adm.contractNumber || adm.protocolCode || ''),
    'admissao.total_parcelas': totalParcelas ? String(totalParcelas) : '',
    'admissao.parcelas_pagas': String(parcelasPagas),
    'admissao.parcelas_atraso': String(parcelasAtraso),
    'admissao.parcelas_a_pagar': String(parcelasAPagar),
    'admissao.valor_financiado': financedFmt,
    'admissao.valor_parcela': currentInstallmentFmt,
    'admissao.dia_vencimento': String(adm.debtDueDay ?? ''),
    'admissao.forma_pagamento': String(adm.paymentType || ''),
    'admissao.tipo_indicacao': String(adm.indicationSource || ''),
    'admissao.tipo_origem': String(adm.origin || ''),
    'admissao.tipo_cliente': String(adm.clientRoleSelected || c.clientType || ''),
    'admissao.status': String(adm.status || ''),
    'admissao.taxa_administrativa': serviceFeeFmt,
    'admissao.taxa_cobranca': formatMoneyFromCentsOrValue(adm.billingFeeCents),
    'admissao.parcela1': initialFeeFmt,
    'admissao.parcela_inicial': initialFeeFmt,
    'admissao.parcela2': secondFeeFmt,
    'admissao.valor_boletos': initialFeeFmt,
    'admissao.info1': String(adm.notes || ''),
    'admissao.info2': String(adm.vehicleInfo || ''),
    'admissao.marca_veiculo': String(adm.vehicleBrand || ''),
    'admissao.modelo_veiculo': String(adm.vehicleModel || ''),
    'admissao.cor_veiculo': String(adm.vehicleColor || ''),
    'admissao.ano_veiculo': String(adm.vehicleYear || ''),
    'admissao.placa': String(adm.vehiclePlate || ''),
    'admissao.chassi': String(adm.vehicleChassis || ''),
    'admissao.renavam': String(adm.vehicleRenavam || ''),
    'admissao.primeiro_vencimento': formatDateBRValue(adm.submittedToAuditAt || adm.createdAt),

    // 7. Recálculo (6)
    'recalculo.parcelas_a_pagar': String(sc0.installmentsToPay ?? parcelasAPagar ?? ''),
    'recalculo.divida_original': formatMoneyFromCentsOrValue(debtOrigCents),
    'recalculo.parcela': formatMoneyFromCentsOrValue(recalcInstallmentCents),
    'recalculo.divida': formatMoneyFromCentsOrValue(recalcDebtCents),
    'recalculo.economia': formatMoneyFromCentsOrValue(savingsCents),
    'recalculo.dia_vencimento': String(sc0.dueDay ?? adm.debtDueDay ?? ''),

    // 8. Modalidade (3)
    'modalidade.id': String(mod.id ?? ''),
    'modalidade.tipo': String(mod.type || adm.debtType || ''),
    'modalidade.descricao': String(mod.description || mod.name || adm.modality || adm.debtType || ''),

    // 9. Produto (4)
    'produto.id': String(prod.id ?? ''),
    'produto.tipo': String(prod.type || ''),
    'produto.descricao': String(prod.description || prod.name || ''),
    'produto.unidade': String(prod.unit || ''),

    // 10. Serviço (4)
    'servico.id': String(srv.id ?? ''),
    'servico.nome': String(srv.name || ''),
    'servico.duracao': String(srv.duration || ''),
    'servico.preco': formatMoneyFromCentsOrValue(srv.priceCents, srv.price),

    // 11. Conta Bancária (9)
    'conta_bancaria.id': String(cb.id ?? ''),
    'conta_bancaria.descricao': String(cb.description || cb.name || ''),
    'conta_bancaria.tipo': String(cb.type || ''),
    'conta_bancaria.banco': String(cb.bankName || ''),
    'conta_bancaria.agencia': String(cb.agency || ''),
    'conta_bancaria.numero_conta': String(cb.accountNumber || ''),
    'conta_bancaria.saldo_inicial': formatMoneyFromCentsOrValue(cb.initialBalanceCents),
    'conta_bancaria.saldo_atual': formatMoneyFromCentsOrValue(cb.currentBalanceCents),
    'conta_bancaria.status': String(cb.active === false ? 'Inativa' : 'Ativa'),

    // 12. Tipo de Documento (5)
    'tipo_documento.id': String(td.id ?? ''),
    'tipo_documento.descricao': String(td.description || td.name || ''),
    'tipo_documento.categoria': String(td.category || ''),
    'tipo_documento.fiscal': String(td.fiscal || ''),
    'tipo_documento.status': String(td.active === false ? 'Inativo' : 'Ativo'),

    // 13. Portador (5)
    'portador.id': String(port.id ?? ''),
    'portador.codigo': String(port.code || ''),
    'portador.nome': String(port.name || ''),
    'portador.tipo': String(port.type || ''),
    'portador.status': String(port.active === false ? 'Inativo' : 'Ativo'),

    // 14. Plano de Contas (5)
    'plano_contas.id': String(pc.id ?? ''),
    'plano_contas.codigo': String(pc.code || ''),
    'plano_contas.nome': String(pc.name || ''),
    'plano_contas.tipo': String(pc.type || ''),
    'plano_contas.analitica': String(pc.isAnalytical ? 'Sim' : 'Não'),

    // 15. Departamento (5)
    'departamento.id': String(dep.id ?? ''),
    'departamento.codigo': String(dep.code || ''),
    'departamento.nome': String(dep.name || ''),
    'departamento.gerente': String(dep.managerName || ''),
    'departamento.status': String(dep.active === false ? 'Inativo' : 'Ativo'),

    // 16. Série (3)
    'serie.id': String(ser.id ?? ''),
    'serie.sigla': String(ser.acronym || adm.series || ''),
    'serie.descricao': String(ser.description || adm.series || ''),

    // 17. Processo Jurídico (16)
    'processo.numero': String(proc.processNumber || ''),
    'processo.vara': String(proc.court || proc.courtDivision || proc.courtName || ''),
    'processo.comarca': String(proc.jurisdiction || proc.district || proc.courtName || ''),
    'processo.tipo': String(proc.type || proc.actionType || ''),
    'processo.papel': String(proc.role || proc.partyRole || 'Réu / Requerido'),
    'processo.status': String(proc.status || ''),
    'processo.assunto': String(proc.subject || proc.actionType || ''),
    'processo.valor_causa': proc.causeValue
      ? String(proc.causeValue).trim().startsWith('R$')
        ? String(proc.causeValue)
        : `R$ ${String(proc.causeValue)}`
      : formatMoneyFromCentsOrValue(proc.causeValueCents),
    'processo.valor_provisionado': proc.provisionValue
      ? String(proc.provisionValue).trim().startsWith('R$')
        ? String(proc.provisionValue)
        : `R$ ${String(proc.provisionValue)}`
      : formatMoneyFromCentsOrValue(proc.provisionedValueCents),
    'processo.risco': String(
      proc.hasSearchSeizure ? 'Alto (Busca e Apreensão)' : proc.riskLevel || 'Moderado'
    ),
    'processo.data_distribuicao': formatDateBRValue(proc.distributionDate || proc.createdAt),
    'processo.parte_adversa': String(proc.opposingParty || proc.adverseParty || adm.bankName || ''),
    'processo.documento_adversa': String(proc.opposingPartyDocument || proc.adverseDocument || ''),
    'processo.advogado_adverso': String(proc.opposingPartyLawyer || proc.adverseLawyer || ''),
    'processo.oab_adverso': String(
      proc.opposingPartyLawyerOAB || proc.opposingPartyLawyerOab || proc.adverseOab || ''
    ),
    'processo.advogado_responsavel': String(
      proc.responsibleLawyer || proc.responsibleLawyerName || col.name || ''
    ),

    // 18. Geral (7)
    'data.hoje': dataHoje,
    'data.extenso': dataExtenso,
    'data.dia_semana': WEEKDAYS_PT[now.getDay()],
    'data.mes': MONTHS_PT[now.getMonth()],
    'data.ano': yyyy,
    'hora.atual': `${hh}:${min}`,
    'usuario.nome': String(ctx.currentUserName || 'Usuário FinancePro'),

    // Aliases legados usados em modelos Word (.docx)
    cliente_nome: clientName,
    cliente_cpf: clientDoc,
    contrato: String(adm.contractNumber || adm.protocolCode || ''),
    banco: String(b.name || adm.bankName || ''),
    economia: formatMoneyFromCentsOrValue(savingsCents),
  };

  return map;
}

export function replaceTemplateVariables(
  template: string,
  ctx: FormMergeContext,
  options?: { escapeHtml?: boolean }
): string {
  if (!template) return '';
  const map = buildTemplateVariableMap(ctx);
  const shouldEscape = options?.escapeHtml !== false;

  return template.replace(/\{\{([a-zA-Z0-9_.]+)\}\}/g, (_full, key: string) => {
    const val = map[key] ?? '';
    return shouldEscape ? escapeHtmlValue(val) : val;
  });
}

export function splitBodyByPageBreaks(bodyHtml: string): string[] {
  if (!bodyHtml) return [''];
  const normalized = bodyHtml
    .replace(/<!--\s*pagebreak\s*-->/gi, '___FP_PAGEBREAK___')
    .replace(/<div[^>]*page-break-(?:after|before)\s*:\s*always[^>]*>[\s\S]*?<\/div>/gi, '___FP_PAGEBREAK___')
    .replace(/<hr[^>]*class=["'][^"']*fp-page-break[^"']*["'][^>]*\/?>/gi, '___FP_PAGEBREAK___');
  const pages = normalized.split('___FP_PAGEBREAK___');
  return pages.length > 0 ? pages : [''];
}

export function buildPrintableHtmlDocument(params: {
  title: string;
  headerHtml?: string;
  bodyHtml: string;
  footerHtml?: string;
  companyLogoDataUrl?: string;
  companyName?: string;
  logoDarkBackdrop?: boolean;
  includeDefaultLogo?: boolean;
}): string {
  const safeTitle = escapeHtmlValue(params.title || 'Documento A4');
  const safeHeader = sanitizeTemplateHtml(params.headerHtml || '').trim();
  const safeFooter = sanitizeTemplateHtml(params.footerHtml || '').trim();
  const pages = splitBodyByPageBreaks(sanitizeTemplateHtml(params.bodyHtml || ''));

  const cachedBranding = getCachedPortalBranding();
  const resolvedLogo =
    params.includeDefaultLogo === false
      ? ''
      : (params.companyLogoDataUrl ?? cachedBranding?.logoDataUrl ?? '').trim();
  const resolvedCompanyName = (params.companyName ?? cachedBranding?.companyName ?? '').trim();
  const useDarkBadge = params.logoDarkBackdrop ?? getCachedLogoNeedsDarkBackdrop();

  const headerAlreadyHasImg = /<img\b/i.test(safeHeader);
  const logoBadgeClass = useDarkBadge ? 'brand-logo-badge dark' : 'brand-logo-badge';
  const logoBlockHtml =
    resolvedLogo && !headerAlreadyHasImg
      ? `<div class="brand-logo-center"><span class="${logoBadgeClass}"><img src="${escapeHtmlValue(resolvedLogo)}" alt="${escapeHtmlValue(resolvedCompanyName || 'Logomarca da Empresa')}" /></span></div>`
      : '';

  const effectiveHeaderHtml = `${logoBlockHtml}${
    safeHeader ? `<div class="print-header-custom">${safeHeader}</div>` : ''
  }`.trim();

  const hasHeaderBlock = Boolean(effectiveHeaderHtml);
  const topPad = logoBlockHtml && safeHeader ? '44mm' : hasHeaderBlock ? '34mm' : '15mm';
  const headerMaxHeight = logoBlockHtml && safeHeader ? '34mm' : '24mm';
  const bottomPad = safeFooter ? '26mm' : '15mm';

  const sheetsHtml = pages
    .map(
      (pageHtml, idx) => `
      <div class="sheet${idx > 0 ? ' sheet-break' : ''}">
        ${effectiveHeaderHtml ? `<header class="print-header">${effectiveHeaderHtml}</header>` : ''}
        <main class="sheet-body">${pageHtml}</main>
        ${safeFooter ? `<footer class="print-footer">${safeFooter}</footer>` : ''}
      </div>`
    )
    .join('\n');

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>${safeTitle}</title>
  <style>
    @page {
      size: A4;
      margin: 0;
    }
    * {
      box-sizing: border-box;
    }
    html, body {
      margin: 0;
      padding: 0;
      background: #e2e8f0;
      font-family: 'Times New Roman', Times, serif;
      font-size: 16px;
      line-height: 1.45;
      color: #0f172a;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .sheet {
      position: relative;
      width: 210mm;
      min-height: 297mm;
      margin: 12mm auto;
      background: #ffffff;
      padding: ${topPad} 15mm ${bottomPad} 15mm;
      box-shadow: 0 4px 18px rgba(15, 23, 42, 0.14);
      overflow: hidden;
    }
    .sheet-break {
      page-break-before: always;
    }
    .print-header {
      position: absolute;
      top: 7mm;
      left: 15mm;
      right: 15mm;
      max-height: ${headerMaxHeight};
      overflow: hidden;
      border-bottom: 1px solid #cbd5e1;
      padding-bottom: 2.5mm;
    }
    .brand-logo-center {
      display: flex;
      justify-content: center;
      align-items: center;
      width: 100%;
      margin: 0 auto 1.5mm auto;
      text-align: center;
    }
    .brand-logo-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 6px;
      padding: 0.5mm 2mm;
    }
    .brand-logo-badge.dark {
      background: #0f172a;
      padding: 1.2mm 3.5mm;
    }
    .brand-logo-center img {
      max-height: 14mm;
      max-width: 60mm;
      width: auto;
      height: auto;
      object-fit: contain;
      display: block;
      margin: 0 auto;
    }
    .print-header-custom {
      width: 100%;
    }
    .print-footer {
      position: absolute;
      bottom: 8mm;
      left: 15mm;
      right: 15mm;
      max-height: 18mm;
      overflow: hidden;
      border-top: 1px solid #cbd5e1;
      padding-top: 2mm;
      font-size: 12px;
      color: #475569;
    }
    .sheet-body {
      position: relative;
      z-index: 2;
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    td, th {
      padding: 4px 6px;
      vertical-align: top;
    }
    img {
      max-width: 100%;
      height: auto;
    }
    img.img-behind-text {
      position: absolute;
      z-index: 1;
      opacity: 0.25;
      pointer-events: none;
    }
    img.img-front-text {
      position: relative;
      z-index: 20;
    }
    img.img-float-left {
      float: left;
      margin: 0 12px 8px 0;
    }
    img.img-float-right {
      float: right;
      margin: 0 0 8px 12px;
    }
    img.img-center {
      display: block;
      margin: 8px auto;
    }
    @media print {
      html, body {
        background: #ffffff;
      }
      .sheet {
        margin: 0;
        box-shadow: none;
        width: 210mm;
        min-height: 297mm;
      }
    }
  </style>
</head>
<body>
  ${sheetsHtml}
  <script>
    window.addEventListener('load', function () {
      setTimeout(function () {
        try { window.print(); } catch (e) {}
      }, 280);
    });
  </script>
</body>
</html>`;
}

export function openPrintWindow(params: {
  title: string;
  headerHtml?: string;
  bodyHtml: string;
  footerHtml?: string;
  companyLogoDataUrl?: string;
  companyName?: string;
  logoDarkBackdrop?: boolean;
  includeDefaultLogo?: boolean;
}): { opened: boolean; htmlDocument: string; blobUrl: string } {
  const htmlDocument = buildPrintableHtmlDocument(params);
  const blob = new Blob([htmlDocument], { type: 'text/html;charset=utf-8' });
  const blobUrl = URL.createObjectURL(blob);

  if (typeof document === 'undefined' || !document.body) {
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    return { opened: false, htmlDocument, blobUrl };
  }

  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.style.visibility = 'hidden';

  let printed = false;
  iframe.addEventListener('load', () => {
    if (printed) return;
    printed = true;
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } catch {
      // ignore sandbox print restrictions
    }
  });

  iframe.srcdoc = htmlDocument;
  document.body.appendChild(iframe);

  window.setTimeout(() => {
    URL.revokeObjectURL(blobUrl);
    if (iframe.parentNode) {
      iframe.parentNode.removeChild(iframe);
    }
  }, 60_000);

  return { opened: true, htmlDocument, blobUrl };
}
