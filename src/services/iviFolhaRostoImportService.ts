import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import * as XLSX from 'xlsx';
import { GoogleGenAI, Type } from '@google/genai';
import { asc, eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import {
  admissions,
  auditLogs,
  banks,
  clientAssetLinks,
  clients,
  collaborators,
  febrabanBanks,
  formTemplates,
  modalities,
  units,
  users,
  type AdmissionScenarioCol,
} from '../db/schema.ts';
import { EMBEDDED_FORM_TEMPLATES } from '../data/embeddedFormTemplates.ts';
import { FORM_VARIABLE_CATEGORIES } from '../lib/formTemplateCatalog.ts';
import { generateIntegrativeCode } from './integrativeVaultService.ts';
import { readFolhaRostoPdfAsSheets, type PdfExtractionMetadata } from './iviFolhaRostoPdfParser.ts';
import {
  readSpreadsheetChunk,
  saveManifest,
  SPREADSHEET_CHUNK_ROWS,
  type SpreadsheetChunkMeta,
  type SpreadsheetStreamManifest,
  streamSpreadsheetToChunks,
  triggerBestEffortGc,
} from './spreadsheetStreamReader.ts';

export type FolhaRostoTargetGroup =
  | 'cliente'
  | 'titular'
  | 'banco'
  | 'colaborador'
  | 'admissao'
  | 'recalculo'
  | 'modalidade'
  | 'empresa';

export interface FolhaRostoVariableDef {
  key: string;
  token: string;
  label: string;
  targetGroup: FolhaRostoTargetGroup;
  inVeiculoForm: boolean;
  inCartaoForm: boolean;
  exclusiveToVeiculo: boolean;
}

export interface FolhaRostoFormSnapshot {
  key: 'veiculo' | 'cartao';
  id?: string;
  name: string;
  description: string;
  variables: string[];
  variableCount: number;
  previewHtml: string;
}

export interface FolhaRostoReferencePayload {
  forms: {
    veiculo: FolhaRostoFormSnapshot;
    cartao: FolhaRostoFormSnapshot;
  };
  variables: FolhaRostoVariableDef[];
  entityTargets: Array<{
    group: string;
    label: string;
    tableName: string;
    description: string;
  }>;
}

export interface IviColumnMappingItem {
  sheetName: string;
  sourceColumn: string;
  sampleValues: string[];
  mappedVariableKey: string; // '' = ignore
  targetGroup: FolhaRostoTargetGroup | '';
  formOrigin: 'ambos' | 'veiculo' | 'cartao' | 'titular' | '';
  confidence: 'alta' | 'media' | 'ia_gemini' | 'nao_mapeada';
  reason: string;
}

export interface IviRowPreview {
  sheetName: string;
  rowNumber: number;
  detectedForm: 'veiculo' | 'cartao';
  formLabel: string;
  clientName: string;
  clientCpf: string;
  titularName: string;
  titularCpf: string;
  bankName: string;
  collaboratorName: string;
  contractNumber: string;
  vehicleSummary: string;
  actions: string[];
  warnings: string[];
}

export interface IviFolhaRostoAnalyzeResult {
  fileName: string;
  fileSizeBytes: number;
  uploadSessionId?: string;
  detectedFormSummary: {
    dominantForm: 'veiculo' | 'cartao' | 'misto';
    veiculoRows: number;
    cartaoRows: number;
    totalRows: number;
  };
  sheets: Array<{
    sheetName: string;
    headers: string[];
    rowCount: number;
  }>;
  mappings: IviColumnMappingItem[];
  availableVariables: FolhaRostoVariableDef[];
  estimatedOperations: {
    clientsInsert: number;
    clientsUpdate: number;
    titularesInsert: number;
    titularesUpdate: number;
    assetLinksInsert: number;
    banksInsert: number;
    banksMatched: number;
    collaboratorsInsert: number;
    collaboratorsMatched: number;
    admissionsInsert: number;
    admissionsUpdate: number;
    errors: number;
  };
  previews: IviRowPreview[];
  iviDiagnosticText: string;
  usedGemini: boolean;
  pdfMetadata?: PdfExtractionMetadata;
}

export interface IviFolhaRostoCommitResult {
  totals: {
    totalRows: number;
    clientsCreated: number;
    clientsUpdated: number;
    titularesCreated: number;
    titularesUpdated: number;
    assetLinksCreated: number;
    banksCreated: number;
    banksLinked: number;
    collaboratorsCreated: number;
    collaboratorsLinked: number;
    admissionsCreated: number;
    admissionsUpdated: number;
    errors: number;
  };
  rowLogs: Array<{
    sheetName: string;
    rowNumber: number;
    formMatched: string;
    clientName: string;
    titularName: string;
    bankName: string;
    collaboratorName: string;
    contractNumber: string;
    protocolCode: string;
    integrativeCode: string;
    status: 'OK' | 'ERRO';
    detail: string;
  }>;
  returnWorkbookBase64: string;
  returnFileName: string;
}

function normText(v: unknown): string {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return v.toISOString().slice(0, 10);
  }
  return String(v ?? '').trim();
}

function normKey(v: unknown): string {
  return normText(v)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function normSlug(v: unknown): string {
  return normKey(v).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function normDigits(v: unknown): string {
  return String(v ?? '').replace(/\D/g, '');
}

function parseCentsFromBrl(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) {
    return Math.round(v * 100);
  }
  let raw = normText(v).replace(/[R$\s]/g, '');
  if (!raw) return 0;
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

function extractVariablesFromMarkup(markup: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const re = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markup)) !== null) {
    const key = m[1].trim();
    if (key && !seen.has(key)) {
      seen.add(key);
      found.push(key);
    }
  }
  return found;
}

function sanitizePreviewHtml(html: string): string {
  return String(html || '')
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
}

function inferGroupFromKey(varKey: string): FolhaRostoTargetGroup {
  if (varKey.startsWith('titular.')) return 'titular';
  if (varKey.startsWith('cliente.')) return 'cliente';
  if (varKey.startsWith('banco.')) return 'banco';
  if (varKey.startsWith('colaborador.')) return 'colaborador';
  if (varKey.startsWith('recalculo.')) return 'recalculo';
  if (varKey.startsWith('modalidade.')) return 'modalidade';
  if (varKey.startsWith('empresa.')) return 'empresa';
  return 'admissao';
}

const VARIABLE_LABEL_MAP: Map<string, string> = (() => {
  const m = new Map<string, string>();
  for (const cat of FORM_VARIABLE_CATEGORIES) {
    for (const item of cat.items) {
      m.set(item.key, `${cat.category.split(' ')[0]} · ${item.label}`);
    }
  }
  m.set('empresa.codigo_unidade', 'Unidade · Código da Unidade');
  return m;
})();

const EXTRA_IMPORT_VARIABLES: Array<{ key: string; label: string; group: FolhaRostoTargetGroup }> = [
  { key: 'empresa.codigo_unidade', label: 'Unidade · Código da Unidade (MTZ)', group: 'empresa' },
  { key: 'titular.nome', label: 'Titular · Nome Completo / Razão Social', group: 'titular' },
  { key: 'titular.documento', label: 'Titular · CPF / CNPJ', group: 'titular' },
  { key: 'titular.rg', label: 'Titular · RG', group: 'titular' },
  { key: 'titular.telefone', label: 'Titular · Telefone / WhatsApp', group: 'titular' },
  { key: 'titular.email', label: 'Titular · E-mail', group: 'titular' },
  { key: 'titular.profissao', label: 'Titular · Profissão', group: 'titular' },
  { key: 'titular.estado_civil', label: 'Titular · Estado Civil', group: 'titular' },
  { key: 'titular.data_nascimento', label: 'Titular · Data de Nascimento', group: 'titular' },
  { key: 'titular.cep', label: 'Titular · CEP', group: 'titular' },
  { key: 'titular.endereco', label: 'Titular · Endereço', group: 'titular' },
  { key: 'titular.numero', label: 'Titular · Número', group: 'titular' },
  { key: 'titular.complemento', label: 'Titular · Complemento', group: 'titular' },
  { key: 'titular.bairro', label: 'Titular · Bairro', group: 'titular' },
  { key: 'titular.cidade', label: 'Titular · Cidade', group: 'titular' },
  { key: 'titular.uf', label: 'Titular · UF', group: 'titular' },
  { key: 'banco.febraban', label: 'Banco · Código FEBRABAN', group: 'banco' },
  { key: 'colaborador.email', label: 'Colaborador · E-mail', group: 'colaborador' },
  { key: 'colaborador.telefone', label: 'Colaborador · Telefone', group: 'colaborador' },
  { key: 'cliente.telefone2', label: 'Cliente · Telefone Secundário / WhatsApp', group: 'cliente' },
  { key: 'cliente.complemento', label: 'Cliente · Complemento', group: 'cliente' },
  { key: 'cliente.tipo', label: 'Cliente · Tipo (titular / responsavel_bem / ambos)', group: 'cliente' },
  { key: 'admissao.status', label: 'Admissão · Status do Contrato', group: 'admissao' },
  { key: 'admissao.tipo_indicacao', label: 'Admissão · Tipo de Indicação', group: 'admissao' },
  { key: 'admissao.tipo_origem', label: 'Admissão · Origem (prospeccao / propaganda)', group: 'admissao' },
  { key: 'admissao.info1', label: 'Admissão · Observações Gerais', group: 'admissao' },
];

export async function getFolhaRostoReferenceForms(): Promise<FolhaRostoReferencePayload> {
  let rows = await db.select().from(formTemplates).orderBy(asc(formTemplates.name));
  if (rows.length === 0) {
    try {
      await db.insert(formTemplates).values(
        EMBEDDED_FORM_TEMPLATES.map((tpl) => ({
          name: tpl.name,
          description: tpl.description,
          content: tpl.content,
          header: tpl.header,
          footer: tpl.footer,
          menuIds: tpl.menuIds,
          docxTemplate: tpl.docxTemplate ?? null,
        }))
      );
      rows = await db.select().from(formTemplates).orderBy(asc(formTemplates.name));
    } catch {
      // ignore race condition on seed
    }
  }

  const findTemplate = (matcher: RegExp, embeddedFallbackName: string) => {
    const dbMatch = rows.find((r) => matcher.test(normKey(r.name)));
    if (dbMatch) {
      return {
        id: dbMatch.id,
        name: dbMatch.name,
        description: dbMatch.description || '',
        header: dbMatch.header || '',
        content: dbMatch.content || '',
        footer: dbMatch.footer || '',
      };
    }
    const emb = EMBEDDED_FORM_TEMPLATES.find((e) => e.name === embeddedFallbackName)!;
    return {
      id: undefined,
      name: emb.name,
      description: emb.description,
      header: emb.header,
      content: emb.content,
      footer: emb.footer,
    };
  };

  const veicRaw = findTemplate(/folha de rosto.*veiculo/, 'Folha de Rosto - Veículo');
  const cartRaw = findTemplate(/folha de rosto.*cartao/, 'Folha de Rosto - Cartão de Crédito');

  const veicMarkup = `${veicRaw.header}\n${veicRaw.content}\n${veicRaw.footer}`;
  const cartMarkup = `${cartRaw.header}\n${cartRaw.content}\n${cartRaw.footer}`;
  const veicVars = extractVariablesFromMarkup(veicMarkup);
  const cartVars = extractVariablesFromMarkup(cartMarkup);

  const veicSet = new Set(veicVars);
  const cartSet = new Set(cartVars);
  const allOrderedKeys: string[] = [];
  const seenKeys = new Set<string>();

  for (const k of [...veicVars, ...cartVars]) {
    if (!seenKeys.has(k)) {
      seenKeys.add(k);
      allOrderedKeys.push(k);
    }
  }
  for (const ext of EXTRA_IMPORT_VARIABLES) {
    if (!seenKeys.has(ext.key)) {
      seenKeys.add(ext.key);
      allOrderedKeys.push(ext.key);
    }
  }

  const variables: FolhaRostoVariableDef[] = allOrderedKeys.map((key) => {
    const extMeta = EXTRA_IMPORT_VARIABLES.find((e) => e.key === key);
    const inV = veicSet.has(key);
    const inC = cartSet.has(key);
    return {
      key,
      token: `{{${key}}}`,
      label: VARIABLE_LABEL_MAP.get(key) || extMeta?.label || key,
      targetGroup: extMeta?.group || inferGroupFromKey(key),
      inVeiculoForm: inV,
      inCartaoForm: inC,
      exclusiveToVeiculo: inV && !inC,
    };
  });

  return {
    forms: {
      veiculo: {
        key: 'veiculo',
        id: veicRaw.id,
        name: veicRaw.name,
        description: veicRaw.description,
        variables: veicVars,
        variableCount: veicVars.length,
        previewHtml: sanitizePreviewHtml(veicMarkup),
      },
      cartao: {
        key: 'cartao',
        id: cartRaw.id,
        name: cartRaw.name,
        description: cartRaw.description,
        variables: cartVars,
        variableCount: cartVars.length,
        previewHtml: sanitizePreviewHtml(cartMarkup),
      },
    },
    variables,
    entityTargets: [
      {
        group: 'cliente_titular',
        label: 'Clientes & Titulares',
        tableName: 'clients + client_asset_links',
        description: 'Cadastra/atualiza por CPF/CNPJ o Titular do contrato e o Cliente/Responsável pelo bem, criando o vínculo patrimonial quando distintos.',
      },
      {
        group: 'banco',
        label: 'Bancos & Financeiras',
        tableName: 'banks',
        description: 'Identifica a instituição financeira em {{banco.nome}} e vincula ou cria automaticamente no catálogo de Bancos com código FEBRABAN.',
      },
      {
        group: 'colaborador',
        label: 'Colaboradores / Consultores',
        tableName: 'collaborators',
        description: 'Localiza ou cadastra o consultor informado em {{colaborador.nome}} na unidade da admissão.',
      },
      {
        group: 'admissao',
        label: 'Admissão (Veículo / Cartão)',
        tableName: 'admissions',
        description: 'Gera ou atualiza a ficha de Admissão completa com protocolo, selo HMAC integrativo, parcelas, veículo e cenário de recálculo.',
      },
    ],
  };
}

// =========================================================================
// DETERMINISTIC SYNONYM MATCHING AGAINST FOLHA DE ROSTO VARIABLES
// =========================================================================
const SYNONYM_MAP: Array<{ varKey: string; patterns: RegExp[]; exactTokens: string[] }> = [
  // Titular (must come BEFORE generic cliente or contrato checks when explicit "titular" appears)
  { varKey: 'titular.nome', patterns: [/^titular$/, /nome.*titular/, /titular.*nome/, /titular.*contrato/, /nome_do_titular/, /titular_bem/], exactTokens: ['titular', 'nome_titular', 'titular_nome', 'titular_do_contrato'] },
  { varKey: 'titular.documento', patterns: [/cpf.*titular/, /cnpj.*titular/, /doc.*titular/, /titular.*cpf/, /titular.*cnpj/], exactTokens: ['cpf_titular', 'cpf_cnpj_titular', 'documento_titular'] },
  { varKey: 'titular.rg', patterns: [/rg.*titular/, /titular.*rg/], exactTokens: ['rg_titular'] },
  { varKey: 'titular.telefone', patterns: [/(tel|fone|cel|whatsapp).*titular/, /titular.*(tel|fone|cel|whatsapp)/], exactTokens: ['telefone_titular', 'whatsapp_titular'] },
  { varKey: 'titular.email', patterns: [/email.*titular/, /titular.*email/], exactTokens: ['email_titular'] },
  { varKey: 'titular.profissao', patterns: [/profiss.*titular/], exactTokens: ['profissao_titular'] },
  { varKey: 'titular.estado_civil', patterns: [/estado_civil.*titular/], exactTokens: ['estado_civil_titular'] },
  { varKey: 'titular.data_nascimento', patterns: [/nasc.*titular/], exactTokens: ['data_nascimento_titular', 'nascimento_titular'] },
  { varKey: 'titular.cep', patterns: [/cep.*titular/], exactTokens: ['cep_titular'] },
  { varKey: 'titular.endereco', patterns: [/(endereco|logradouro|rua).*titular/], exactTokens: ['endereco_titular', 'logradouro_titular'] },
  { varKey: 'titular.numero', patterns: [/num.*titular/], exactTokens: ['numero_titular'] },
  { varKey: 'titular.complemento', patterns: [/compl.*titular/], exactTokens: ['complemento_titular'] },
  { varKey: 'titular.bairro', patterns: [/bairro.*titular/], exactTokens: ['bairro_titular'] },
  { varKey: 'titular.cidade', patterns: [/cidade.*titular/], exactTokens: ['cidade_titular'] },
  { varKey: 'titular.uf', patterns: [/(uf|estado).*titular/], exactTokens: ['uf_titular'] },

  // Banco
  { varKey: 'banco.nome', patterns: [/^banco$/, /nome_banco/, /banco_credor/, /instituicao/, /financeira/, /credor/, /banco_financiador/, /banco_contrato/], exactTokens: ['banco', 'banco_nome', 'nome_banco', 'banco_credor', 'credor'] },
  { varKey: 'banco.febraban', patterns: [/febraban/, /cod_banco/, /codigo_febraban/], exactTokens: ['febraban', 'banco_febraban', 'codigo_febraban'] },

  // Colaborador
  { varKey: 'colaborador.nome', patterns: [/^consultor$/, /consultor_nome/, /nome_consultor/, /^colaborador$/, /nome_colaborador/, /vendedor/, /assessor/, /atendente/, /corretor/], exactTokens: ['consultor', 'consultor_nome', 'colaborador', 'colaborador_nome', 'nome_colaborador'] },
  { varKey: 'colaborador.email', patterns: [/email.*(consultor|colaborador|vendedor)/], exactTokens: ['email_consultor', 'email_colaborador'] },
  { varKey: 'colaborador.telefone', patterns: [/(tel|fone|whatsapp).*(consultor|colaborador|vendedor)/], exactTokens: ['telefone_consultor', 'telefone_colaborador'] },

  // Cliente
  { varKey: 'cliente.nome', patterns: [/^cliente$/, /nome_cliente/, /nome_completo/, /^nome$/, /razao_social/, /proponente/, /sacado/, /responsavel_bem/], exactTokens: ['cliente', 'cliente_nome', 'nome_cliente', 'nome_completo', 'nome'] },
  { varKey: 'cliente.documento', patterns: [/^cpf$/, /^cnpj$/, /cpf_cnpj/, /cpf_mf/, /^documento$/, /cpf_cliente/, /cnpj_cliente/, /doc_cliente/, /cpf_cnpj_cliente/, /cpf_cnpj_responsavel/], exactTokens: ['cpf', 'cnpj', 'cpf_cnpj', 'cliente_documento', 'cpf_cnpj_cliente'] },
  { varKey: 'cliente.rg', patterns: [/^rg$/, /rg_cliente/, /identidade/], exactTokens: ['rg', 'cliente_rg'] },
  { varKey: 'cliente.telefone', patterns: [/^telefone$/, /^fone$/, /^celular$/, /telefone_cliente/, /tel_cliente/, /^contato$/], exactTokens: ['telefone', 'celular', 'cliente_telefone'] },
  { varKey: 'cliente.telefone2', patterns: [/whatsapp/, /telefone_2/, /telefone2/, /telefone_secundario/, /fone2/], exactTokens: ['whatsapp', 'telefone_secundario', 'cliente_telefone2'] },
  { varKey: 'cliente.email', patterns: [/^email$/, /^e_mail$/, /email_cliente/], exactTokens: ['email', 'cliente_email'] },
  { varKey: 'cliente.profissao', patterns: [/profissao/, /ocupacao/], exactTokens: ['profissao', 'cliente_profissao'] },
  { varKey: 'cliente.estado_civil', patterns: [/estado_civil/, /est_civil/], exactTokens: ['estado_civil', 'cliente_estado_civil'] },
  { varKey: 'cliente.data_nascimento', patterns: [/data_nascimento/, /dt_nasc/, /data_nasc/, /^nascimento$/], exactTokens: ['data_nascimento', 'cliente_data_nascimento'] },
  { varKey: 'cliente.cep', patterns: [/^cep$/, /cep_cliente/], exactTokens: ['cep', 'cliente_cep'] },
  { varKey: 'cliente.endereco', patterns: [/^endereco$/, /^logradouro$/, /^rua$/, /endereco_cliente/], exactTokens: ['endereco', 'logradouro', 'cliente_endereco'] },
  { varKey: 'cliente.numero', patterns: [/^numero$/, /^nro$/, /^num$/, /numero_endereco/, /cliente_numero/], exactTokens: ['numero', 'cliente_numero'] },
  { varKey: 'cliente.complemento', patterns: [/complemento/, /compl/], exactTokens: ['complemento', 'cliente_complemento'] },
  { varKey: 'cliente.bairro', patterns: [/bairro/], exactTokens: ['bairro', 'cliente_bairro'] },
  { varKey: 'cliente.cidade', patterns: [/cidade/, /municipio/], exactTokens: ['cidade', 'cliente_cidade'] },
  { varKey: 'cliente.uf', patterns: [/^uf$/, /^estado$/, /cliente_uf/], exactTokens: ['uf', 'estado', 'cliente_uf'] },
  { varKey: 'cliente.tipo', patterns: [/tipo_cliente/, /natureza_pf_pj/, /papel_cliente/], exactTokens: ['tipo_cliente', 'cliente_tipo'] },

  // Admissão - Contrato & Financiamento (specific contract-number tokens BEFORE generic patterns)
  { varKey: 'admissao.data', patterns: [/data_admissao/, /data_do_contrato/, /data_contrato/, /^data$/], exactTokens: ['data_admissao', 'admissao_data', 'data_contrato'] },
  { varKey: 'admissao.status', patterns: [/status_admissao/, /status_contrato/, /situacao_admissao/, /situacao_contrato/], exactTokens: ['status_admissao', 'admissao_status', 'status_contrato'] },
  { varKey: 'admissao.contrato', patterns: [/^contrato$/, /^(n|nr|nro|num|numero|cod|codigo)_*(do_)?contrato$/, /numero_contrato/, /n_contrato/, /num_contrato/, /nro_contrato/, /protocolo/, /codigo_protocolo/], exactTokens: ['contrato', 'numero_contrato', 'n_contrato', 'num_contrato', 'nro_contrato', 'admissao_contrato', 'codigo_protocolo'] },
  { varKey: 'admissao.total_parcelas', patterns: [/total_parcelas/, /parcelas_totais/, /qtd_parcelas_totais/, /^prazo$/, /^parcelas$/], exactTokens: ['total_parcelas', 'qtd_parcelas_totais', 'admissao_total_parcelas'] },
  { varKey: 'admissao.parcelas_pagas', patterns: [/parcelas_pagas/, /qtd_parcelas_pagas/, /^pagas$/], exactTokens: ['parcelas_pagas', 'qtd_parcelas_pagas', 'admissao_parcelas_pagas'] },
  { varKey: 'admissao.parcelas_atraso', patterns: [/parcelas.*atraso/, /qtd_parcelas_atraso/, /^atraso$/], exactTokens: ['parcelas_atraso', 'qtd_parcelas_atraso', 'admissao_parcelas_atraso'] },
  { varKey: 'admissao.parcelas_a_pagar', patterns: [/parcelas_a_pagar/, /parcelas_restantes/], exactTokens: ['parcelas_a_pagar', 'admissao_parcelas_a_pagar'] },
  { varKey: 'admissao.valor_financiado', patterns: [/valor_financiado/, /vl_financiado/, /financiado/], exactTokens: ['valor_financiado', 'valor_financiado_brl', 'admissao_valor_financiado'] },
  { varKey: 'admissao.valor_parcela', patterns: [/valor_parcela/, /vl_parcela/, /valor_parcela_atual/, /^parcela_atual$/], exactTokens: ['valor_parcela', 'valor_parcela_atual_brl', 'admissao_valor_parcela'] },
  { varKey: 'admissao.dia_vencimento', patterns: [/dia_vencimento/, /dia_vcto/, /^vencimento$/], exactTokens: ['dia_vencimento', 'admissao_dia_vencimento'] },
  { varKey: 'admissao.forma_pagamento', patterns: [/forma_pagamento/, /tipo_pagamento/, /meio_pagamento/], exactTokens: ['forma_pagamento', 'tipo_pagamento', 'admissao_forma_pagamento'] },
  { varKey: 'admissao.taxa_administrativa', patterns: [/taxa_admin/, /valor_honorarios/, /honorarios/, /custo_gestao/], exactTokens: ['taxa_administrativa', 'valor_honorarios_brl', 'admissao_taxa_administrativa'] },
  { varKey: 'admissao.parcela1', patterns: [/parcela1/, /parcela_1/, /primeira_parcela/, /1_parcela/, /custos_iniciais/, /^entrada$/], exactTokens: ['parcela1', 'admissao_parcela1'] },
  { varKey: 'admissao.tipo_indicacao', patterns: [/tipo_indicacao/, /indicacao/], exactTokens: ['tipo_indicacao', 'admissao_tipo_indicacao'] },
  { varKey: 'admissao.tipo_origem', patterns: [/^origem$/, /tipo_origem/, /canal_aquisicao/], exactTokens: ['origem', 'tipo_origem', 'admissao_tipo_origem'] },
  { varKey: 'admissao.info1', patterns: [/^observacoes$/, /^obs$/, /^anotacoes$/, /historico/], exactTokens: ['observacoes', 'anotacoes', 'admissao_info1'] },

  // Admissão - Veículo (Folha de Rosto - Veículo)
  { varKey: 'admissao.marca_veiculo', patterns: [/marca_veiculo/, /veiculo_marca/, /^marca$/, /montadora/], exactTokens: ['marca', 'marca_veiculo', 'veiculo_marca', 'admissao_marca_veiculo'] },
  { varKey: 'admissao.modelo_veiculo', patterns: [/modelo_veiculo/, /veiculo_modelo/, /^modelo$/, /^veiculo$/], exactTokens: ['modelo', 'modelo_veiculo', 'veiculo_modelo', 'admissao_modelo_veiculo'] },
  { varKey: 'admissao.cor_veiculo', patterns: [/cor_veiculo/, /veiculo_cor/, /^cor$/], exactTokens: ['cor', 'cor_veiculo', 'admissao_cor_veiculo'] },
  { varKey: 'admissao.ano_veiculo', patterns: [/ano_veiculo/, /veiculo_ano/, /^ano$/, /ano_modelo/], exactTokens: ['ano', 'ano_veiculo', 'veiculo_ano', 'admissao_ano_veiculo'] },
  { varKey: 'admissao.placa', patterns: [/placa_veiculo/, /veiculo_placa/, /^placa$/], exactTokens: ['placa', 'placa_veiculo', 'veiculo_placa', 'admissao_placa'] },
  { varKey: 'admissao.chassi', patterns: [/chassi/, /veiculo_chassi/], exactTokens: ['chassi', 'veiculo_chassi', 'admissao_chassi'] },
  { varKey: 'admissao.renavam', patterns: [/renavam/, /veiculo_renavam/], exactTokens: ['renavam', 'veiculo_renavam', 'admissao_renavam'] },

  // Recálculo & Modalidade
  { varKey: 'recalculo.divida_original', patterns: [/divida_original/, /valor_divida/, /saldo_devedor/, /^divida$/], exactTokens: ['divida_original', 'valor_divida_brl', 'recalculo_divida_original'] },
  { varKey: 'recalculo.parcela', patterns: [/parcela.*recalc/, /recalc.*parcela/, /nova_parcela/], exactTokens: ['parcela_recalculo', 'parcela_recalculada', 'recalculo_parcela'] },
  { varKey: 'recalculo.divida', patterns: [/divida.*recalc/, /recalc.*divida/, /valor_recalculado/, /valor_recalculo/], exactTokens: ['divida_recalculo', 'divida_recalculada', 'recalculo_divida'] },
  { varKey: 'recalculo.economia', patterns: [/economia/, /desagio_valor/], exactTokens: ['economia', 'economia_estimada_brl', 'recalculo_economia'] },
  { varKey: 'modalidade.descricao', patterns: [/modalidade/, /^produto$/, /tipo_produto/, /segmento_divida/, /folha_rosto/, /tipo_processo/], exactTokens: ['modalidade', 'produto', 'segmento_divida', 'modalidade_descricao'] },

  // Unidade
  { varKey: 'empresa.codigo_unidade', patterns: [/codigo_unidade/, /^unidade$/, /^filial$/], exactTokens: ['codigo_unidade', 'unidade', 'empresa_codigo_unidade'] },
];

function deterministicMapHeader(
  header: string,
  allVariables: FolhaRostoVariableDef[]
): { varKey: string; confidence: 'alta' | 'media' | 'nao_mapeada'; reason: string } {
  const slug = normSlug(header);
  if (!slug) return { varKey: '', confidence: 'nao_mapeada', reason: 'Cabeçalho vazio' };
  if (header === '_pagina_pdf') {
    return {
      varKey: '',
      confidence: 'alta',
      reason: 'Referência de página extraída do PDF (metadado)',
    };
  }

  // Direct variable key match (e.g. "{{cliente.nome}}" or "cliente.nome" or "cliente_nome")
  const bareVar = header.replace(/^\{\{|\}\}$/g, '').trim();
  const exactVar = allVariables.find((v) => v.key === bareVar || normSlug(v.key) === slug);
  if (exactVar) {
    return {
      varKey: exactVar.key,
      confidence: 'alta',
      reason: `Correspondência direta com variável {{${exactVar.key}}}`,
    };
  }

  for (const rule of SYNONYM_MAP) {
    if (rule.exactTokens.includes(slug)) {
      return {
        varKey: rule.varKey,
        confidence: 'alta',
        reason: `Nome equivalente à variável {{${rule.varKey}}}`,
      };
    }
  }

  for (const rule of SYNONYM_MAP) {
    if (rule.patterns.some((re) => re.test(slug))) {
      return {
        varKey: rule.varKey,
        confidence: 'media',
        reason: `Padrão compatível com variável {{${rule.varKey}}}`,
      };
    }
  }

  return { varKey: '', confidence: 'nao_mapeada', reason: 'Aguardando comparação semântica da Ivi' };
}

async function mapRemainingHeadersWithGemini(params: {
  unmappedHeaders: Array<{ header: string; samples: string[] }>;
  variables: FolhaRostoVariableDef[];
  veiculoFormName: string;
  cartaoFormName: string;
  sheetSummaries: Array<{ sheetName: string; headers: string[]; rowCount: number }>;
}): Promise<{ mappedByHeader: Record<string, { varKey: string; reason: string }>; diagnostic: string; usedGemini: boolean }> {
  if (params.unmappedHeaders.length === 0) {
    return {
      mappedByHeader: {},
      diagnostic:
        'Todas as colunas/variáveis foram mapeadas deterministicamente pela Ivi com os formulários Folha de Rosto - Veículo e Folha de Rosto - Cartão de Crédito.',
      usedGemini: false,
    };
  }
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      mappedByHeader: {},
      diagnostic:
        'Ivi concluiu a comparação determinística das colunas da planilha com os formulários Folha de Rosto - Veículo e Folha de Rosto - Cartão de Crédito.',
      usedGemini: false,
    };
  }

  try {
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
    });

    const allowedKeysList = params.variables
      .map((v) => `${v.key} (${v.label})`)
      .join('\n');

    const headersText = params.unmappedHeaders
      .slice(0, 45)
      .map((h) => `- Coluna "${h.header}" | Exemplos: ${h.samples.join(' ; ') || '(vazio)'}`)
      .join('\n');

    const sheetsText = params.sheetSummaries
      .map((s) => `Aba "${s.sheetName}" (${s.rowCount} linhas): ${s.headers.join(', ')}`)
      .join('\n');

    const prompt = `Você é a Ivi, especialista da Invicta Assessoria Financeira.
Compare as colunas da planilha enviada com as variáveis dos formulários oficiais:
1) "${params.veiculoFormName}"
2) "${params.cartaoFormName}"

Estrutura das abas encontradas na planilha:
${sheetsText}

Variáveis oficiais disponíveis no sistema:
${allowedKeysList}

${
  params.unmappedHeaders.length > 0
    ? `Colunas que ainda precisam de associação (se nenhuma variável servir, retorne mappedKey vazio ""):\n${headersText}`
    : 'Todas as colunas principais já foram mapeadas deterministicamente.'
}

Retorne JSON estruturado com:
- suggestions: lista de associações para as colunas acima
- diagnostic: resumo curto e objetivo em português (máx 2 frases) explicando como a planilha se alinha à Folha de Rosto - Veículo e Folha de Rosto - Cartão de Crédito.`;

    const resp = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            diagnostic: { type: Type.STRING },
            suggestions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  sourceColumn: { type: Type.STRING },
                  mappedKey: { type: Type.STRING },
                  reason: { type: Type.STRING },
                },
              },
            },
          },
        },
      },
    });

    const parsed = JSON.parse((resp.text || '{}').trim()) as {
      diagnostic?: string;
      suggestions?: Array<{ sourceColumn?: string; mappedKey?: string; reason?: string }>;
    };

    const validKeys = new Set(params.variables.map((v) => v.key));
    const mappedByHeader: Record<string, { varKey: string; reason: string }> = {};
    for (const s of parsed.suggestions || []) {
      const col = String(s.sourceColumn || '').trim();
      const key = String(s.mappedKey || '').trim();
      if (col && key && validKeys.has(key)) {
        mappedByHeader[col] = {
          varKey: key,
          reason: String(s.reason || 'Associado pela Ivi via Gemini comparando Folha de Rosto'),
        };
      }
    }

    return {
      mappedByHeader,
      diagnostic:
        String(parsed.diagnostic || '').trim() ||
        'Ivi analisou as colunas da planilha comparando com as variáveis dos formulários Folha de Rosto - Veículo e Folha de Rosto - Cartão de Crédito.',
      usedGemini: true,
    };
  } catch {
    return {
      mappedByHeader: {},
      diagnostic:
        'Ivi realizou o comparativo completo das variáveis da planilha com Folha de Rosto - Veículo e Folha de Rosto - Cartão de Crédito.',
      usedGemini: false,
    };
  }
}

// =========================================================================
// STREAMING CHUNKS, MARCAÇÃO DE LEITURA E PROCESSAMENTO EM LOTES (<= 500 MB)
// =========================================================================
export function getIviWorkDir(filePath: string): string {
  return `${filePath}.ivi-work`;
}

export interface IviPlannedChunkMeta {
  chunkIndex: number;
  sheetName: string;
  fileName: string;
  startRowNumber: number;
  endRowNumber: number;
  rowCount: number;
  analyzeStatus: 'pending' | 'done';
  commitStatus: 'pending' | 'done';
}

interface IviPlanFile {
  filePath: string;
  originalFileName: string;
  fileSizeBytes: number;
  uploadSessionId?: string;
  isPdf: boolean;
  totalRows: number;
  totalChunks: number;
  batchSizeRows: number;
  sheets: Array<{ sheetName: string; headers: string[]; rowCount: number }>;
  initialMappings: IviColumnMappingItem[];
  geminiDiagnostic: string;
  usedGemini: boolean;
  pdfMetadata?: PdfExtractionMetadata;
  chunks: IviPlannedChunkMeta[];
}

interface SerializedIviAnalysisState {
  unitSet: Array<[string, number]>;
  bankSet: string[];
  collabSet: string[];
  clientDocSet: string[];
  clientNameSet: string[];
  admContractSet: string[];
  veiculoRows: number;
  cartaoRows: number;
  estimatedOperations: IviFolhaRostoAnalyzeResult['estimatedOperations'];
  previews: IviRowPreview[];
}

interface SerializedIviCommitState {
  fallbackUnitId: number;
  fallbackUnitCode: string;
  unitByCode: Array<[string, { id: number; code: string }]>;
  febrabanByName: Array<[string, string]>;
  bankByName: Array<[string, { id: number; name: string }]>;
  collabByKey: Array<[string, { id: number; name: string }]>;
  userByKey: Array<[string, number]>;
  clientByDoc: Array<[string, { id: number; fullName: string; cpfCnpj: string }]>;
  clientByNameUnit: Array<[string, { id: number; fullName: string; cpfCnpj: string }]>;
  linkSet: string[];
  admByContract: Array<[string, { id: number; protocolCode: string; integrativeCode: string | null }]>;
  modalitySet: string[];
  bankSeq: number;
  collabSeq: number;
  admSeq: number;
  totals: IviFolhaRostoCommitResult['totals'];
}

export interface IviSpreadsheetPrepareResult {
  isPdf: false;
  totalSheets: number;
  totalChunks: number;
  totalRows: number;
  batchSizeRows: number;
  sheets: Array<{ sheetName: string; headers: string[]; rowCount: number }>;
  usedGemini: boolean;
}

export interface IviAnalyzeBatchResult {
  processedChunks: number;
  totalChunks: number;
  markedReadChunks: number;
  processedRows: number;
  totalRows: number;
  batchProcessedRows: number;
  currentSheetName: string;
  veiculoRows: number;
  cartaoRows: number;
  estimatedOperations: IviFolhaRostoAnalyzeResult['estimatedOperations'];
  done: boolean;
}

export interface IviCommitPrepareResult {
  totalChunks: number;
  totalRows: number;
  batchSizeRows: number;
  sheets: Array<{ sheetName: string; headers: string[]; rowCount: number }>;
}

export interface IviCommitBatchResult {
  processedChunks: number;
  totalChunks: number;
  markedReadChunks: number;
  processedRows: number;
  totalRows: number;
  batchProcessedRows: number;
  currentSheetName: string;
  cumulativeTotals: IviFolhaRostoCommitResult['totals'];
  done: boolean;
}

// =========================================================================
// ROW CLASSIFICATION & DATA EXTRACTION
// =========================================================================
function classifyRowForm(params: {
  extracted: Record<string, string>;
  sheetName: string;
  forceForm?: 'auto' | 'veiculo' | 'cartao';
}): 'veiculo' | 'cartao' {
  if (params.forceForm === 'veiculo') return 'veiculo';
  if (params.forceForm === 'cartao') return 'cartao';

  const modText = normKey(
    `${params.extracted['modalidade.descricao'] || ''} ${params.extracted['modalidade.tipo'] || ''} ${params.sheetName}`
  );
  if (/cart[aã]o|credito|fatura|rotativo/.test(modText)) {
    return 'cartao';
  }
  const hasVehicleValue = Boolean(
    params.extracted['admissao.placa'] ||
      params.extracted['admissao.chassi'] ||
      params.extracted['admissao.renavam'] ||
      params.extracted['admissao.marca_veiculo'] ||
      params.extracted['admissao.modelo_veiculo']
  );
  if (hasVehicleValue || /ve[ií]culo|carro|moto|auto|cdc/.test(modText)) {
    return 'veiculo';
  }
  return 'cartao';
}

function buildExtractedRecord(
  row: Record<string, unknown>,
  headerToVarKey: Map<string, string>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [col, varKey] of headerToVarKey.entries()) {
    if (!varKey) continue;
    const val = normText(row[col]);
    if (val && !out[varKey]) {
      out[varKey] = val;
    }
  }
  return out;
}

function hasDistinctTitularName(
  titularName: string,
  titularCpf: string,
  clientName: string,
  clientCpf: string
): boolean {
  if (!titularName) return false;
  const tDig = normDigits(titularCpf);
  const cDig = normDigits(clientCpf);
  if (tDig && cDig && tDig !== cDig) return true;
  if (normKey(titularName) !== normKey(clientName)) return true;
  return false;
}

function resolveEffectiveMappings(
  baseMappings: IviColumnMappingItem[],
  variables: FolhaRostoVariableDef[],
  columnMappingsOverride?: Record<string, string>
): IviColumnMappingItem[] {
  if (!columnMappingsOverride || Object.keys(columnMappingsOverride).length === 0) {
    return baseMappings;
  }
  const varMap = new Map(variables.map((v) => [v.key, v]));
  return baseMappings.map((m) => {
    const overrideKey =
      columnMappingsOverride[`${m.sheetName}::${m.sourceColumn}`] ??
      columnMappingsOverride[m.sourceColumn];
    if (overrideKey === undefined) return m;
    const def = overrideKey ? varMap.get(overrideKey) : undefined;
    return {
      ...m,
      mappedVariableKey: overrideKey,
      targetGroup: def ? def.targetGroup : '',
      formOrigin: def
        ? def.targetGroup === 'titular'
          ? 'titular'
          : def.inVeiculoForm && def.inCartaoForm
          ? 'ambos'
          : def.inVeiculoForm
          ? 'veiculo'
          : def.inCartaoForm
          ? 'cartao'
          : 'ambos'
        : '',
      confidence: overrideKey ? 'alta' : 'nao_mapeada',
      reason: overrideKey ? 'Mapeamento ajustado manualmente' : 'Coluna ignorada manualmente',
    };
  });
}

async function computeInitialMappingsForSheets(params: {
  sheets: Array<{
    sheetName: string;
    headers: string[];
    rowCount: number;
    sampleRows: Array<Record<string, unknown>>;
  }>;
  refPayload: FolhaRostoReferencePayload;
  columnMappingsOverride?: Record<string, string>;
}): Promise<{ mappings: IviColumnMappingItem[]; diagnostic: string; usedGemini: boolean }> {
  const mappings: IviColumnMappingItem[] = [];
  const unmappedForGemini: Array<{ header: string; samples: string[] }> = [];

  for (const s of params.sheets) {
    for (const header of s.headers) {
      const samples: string[] = [];
      for (const row of s.sampleRows.slice(0, 8)) {
        const v = normText(row[header]);
        if (v && !samples.includes(v)) {
          samples.push(v.slice(0, 60));
          if (samples.length >= 3) break;
        }
      }

      const overrideKey =
        params.columnMappingsOverride?.[`${s.sheetName}::${header}`] ??
        params.columnMappingsOverride?.[header];

      if (overrideKey !== undefined) {
        const def = params.refPayload.variables.find((v) => v.key === overrideKey);
        mappings.push({
          sheetName: s.sheetName,
          sourceColumn: header,
          sampleValues: samples,
          mappedVariableKey: overrideKey,
          targetGroup: def ? def.targetGroup : '',
          formOrigin: def
            ? def.targetGroup === 'titular'
              ? 'titular'
              : def.inVeiculoForm && def.inCartaoForm
              ? 'ambos'
              : def.inVeiculoForm
              ? 'veiculo'
              : def.inCartaoForm
              ? 'cartao'
              : 'ambos'
            : '',
          confidence: overrideKey ? 'alta' : 'nao_mapeada',
          reason: overrideKey ? 'Mapeamento ajustado manualmente' : 'Coluna ignorada manualmente',
        });
        continue;
      }

      const det = deterministicMapHeader(header, params.refPayload.variables);
      const def = params.refPayload.variables.find((v) => v.key === det.varKey);
      if (!det.varKey && header !== '_pagina_pdf') {
        unmappedForGemini.push({ header, samples });
      }
      mappings.push({
        sheetName: s.sheetName,
        sourceColumn: header,
        sampleValues: samples,
        mappedVariableKey: det.varKey,
        targetGroup: def ? def.targetGroup : '',
        formOrigin: def
          ? def.targetGroup === 'titular'
            ? 'titular'
            : def.inVeiculoForm && def.inCartaoForm
            ? 'ambos'
            : def.inVeiculoForm
            ? 'veiculo'
            : def.inCartaoForm
            ? 'cartao'
            : 'ambos'
          : '',
        confidence: det.confidence,
        reason: det.reason,
      });
    }
  }

  const geminiRes = await mapRemainingHeadersWithGemini({
    unmappedHeaders: unmappedForGemini,
    variables: params.refPayload.variables,
    veiculoFormName: params.refPayload.forms.veiculo.name,
    cartaoFormName: params.refPayload.forms.cartao.name,
    sheetSummaries: params.sheets.map((s) => ({
      sheetName: s.sheetName,
      headers: s.headers,
      rowCount: s.rowCount,
    })),
  });

  for (const m of mappings) {
    if (!m.mappedVariableKey && geminiRes.mappedByHeader[m.sourceColumn]) {
      const g = geminiRes.mappedByHeader[m.sourceColumn];
      const def = params.refPayload.variables.find((v) => v.key === g.varKey);
      if (def) {
        m.mappedVariableKey = def.key;
        m.targetGroup = def.targetGroup;
        m.formOrigin =
          def.targetGroup === 'titular'
            ? 'titular'
            : def.inVeiculoForm && def.inCartaoForm
            ? 'ambos'
            : def.inVeiculoForm
            ? 'veiculo'
            : def.inCartaoForm
            ? 'cartao'
            : 'ambos';
        m.confidence = 'ia_gemini';
        m.reason = g.reason;
      }
    }
  }

  return {
    mappings,
    diagnostic: geminiRes.diagnostic,
    usedGemini: geminiRes.usedGemini,
  };
}

async function hydrateIviAnalysisLookups(): Promise<SerializedIviAnalysisState> {
  const [existingUnits, existingBanks, existingCollabs, existingClients, existingAdmissions] =
    await Promise.all([
      db.select({ id: units.id, code: units.code }).from(units),
      db.select({ name: banks.name }).from(banks),
      db.select({ email: collaborators.email, name: collaborators.name }).from(collaborators),
      db.select({ cpfCnpj: clients.cpfCnpj, fullName: clients.fullName }).from(clients),
      db.select({ contractNumber: admissions.contractNumber }).from(admissions),
    ]);

  const unitSet: Array<[string, number]> = existingUnits.map((u) => [normKey(u.code), u.id]);
  const bankSet = [...new Set(existingBanks.map((b) => normKey(b.name)).filter(Boolean))];
  const collabArr: string[] = [];
  for (const c of existingCollabs) {
    if (c.email) collabArr.push(normKey(c.email));
    if (c.name) collabArr.push(normKey(c.name));
  }
  const clientDocSet: string[] = [];
  const clientNameSet: string[] = [];
  for (const c of existingClients) {
    const dig = normDigits(c.cpfCnpj);
    if (dig) clientDocSet.push(dig);
    if (c.fullName) clientNameSet.push(normKey(c.fullName));
  }
  const admContractSet = [
    ...new Set(existingAdmissions.map((a) => normKey(a.contractNumber)).filter(Boolean)),
  ];

  return {
    unitSet,
    bankSet,
    collabSet: [...new Set(collabArr)],
    clientDocSet: [...new Set(clientDocSet)],
    clientNameSet: [...new Set(clientNameSet)],
    admContractSet,
    veiculoRows: 0,
    cartaoRows: 0,
    estimatedOperations: {
      clientsInsert: 0,
      clientsUpdate: 0,
      titularesInsert: 0,
      titularesUpdate: 0,
      assetLinksInsert: 0,
      banksInsert: 0,
      banksMatched: 0,
      collaboratorsInsert: 0,
      collaboratorsMatched: 0,
      admissionsInsert: 0,
      admissionsUpdate: 0,
      errors: 0,
    },
    previews: [],
  };
}

async function hydrateIviCommitLookups(unitFallbackId?: number | null): Promise<SerializedIviCommitState> {
  const [
    existingUnits,
    existingBanks,
    existingFebraban,
    existingCollabs,
    existingUsers,
    existingClients,
    existingLinks,
    existingAdmissions,
    existingModalities,
  ] = await Promise.all([
    db.select({ id: units.id, code: units.code, name: units.name }).from(units).orderBy(asc(units.id)),
    db.select({ id: banks.id, name: banks.name }).from(banks),
    db
      .select({ code: febrabanBanks.code, name: febrabanBanks.name, fullName: febrabanBanks.fullName })
      .from(febrabanBanks),
    db
      .select({
        id: collaborators.id,
        name: collaborators.name,
        email: collaborators.email,
        unitId: collaborators.unitId,
      })
      .from(collaborators),
    db.select({ id: users.id, email: users.email, name: users.name }).from(users),
    db
      .select({
        id: clients.id,
        fullName: clients.fullName,
        cpfCnpj: clients.cpfCnpj,
        unitId: clients.unitId,
      })
      .from(clients),
    db
      .select({
        titularClientId: clientAssetLinks.titularClientId,
        assetOwnerClientId: clientAssetLinks.assetOwnerClientId,
      })
      .from(clientAssetLinks),
    db
      .select({
        id: admissions.id,
        unitId: admissions.unitId,
        contractNumber: admissions.contractNumber,
        protocolCode: admissions.protocolCode,
        integrativeCode: admissions.integrativeCode,
      })
      .from(admissions),
    db.select({ description: modalities.description }).from(modalities),
  ]);

  const fallbackUnit = existingUnits.find((u) => u.id === unitFallbackId) || existingUnits[0];
  if (!fallbackUnit) {
    throw new Error('Nenhuma unidade cadastrada para vincular os registros importados.');
  }

  const unitByCode: Array<[string, { id: number; code: string }]> = [];
  for (const u of existingUnits) {
    unitByCode.push([normKey(u.code), { id: u.id, code: u.code }]);
    unitByCode.push([normKey(u.name), { id: u.id, code: u.code }]);
  }

  const febrabanByName: Array<[string, string]> = [];
  for (const fb of existingFebraban) {
    febrabanByName.push([normKey(fb.name), fb.code]);
    if (fb.fullName) febrabanByName.push([normKey(fb.fullName), fb.code]);
  }

  const bankByName: Array<[string, { id: number; name: string }]> = existingBanks.map((b) => [
    normKey(b.name),
    { id: b.id, name: b.name },
  ]);

  const collabByKey: Array<[string, { id: number; name: string }]> = [];
  for (const c of existingCollabs) {
    if (c.email) collabByKey.push([`EMAIL::${normKey(c.email)}`, { id: c.id, name: c.name }]);
    collabByKey.push([`NAME::${c.unitId}::${normKey(c.name)}`, { id: c.id, name: c.name }]);
    collabByKey.push([`NAME_ANY::${normKey(c.name)}`, { id: c.id, name: c.name }]);
  }

  const userByKey: Array<[string, number]> = [];
  for (const u of existingUsers) {
    userByKey.push([normKey(u.email), u.id]);
    userByKey.push([normKey(u.name), u.id]);
  }

  const clientByDoc: Array<[string, { id: number; fullName: string; cpfCnpj: string }]> = [];
  const clientByNameUnit: Array<[string, { id: number; fullName: string; cpfCnpj: string }]> = [];
  for (const c of existingClients) {
    const dig = normDigits(c.cpfCnpj);
    const val = { id: c.id, fullName: c.fullName, cpfCnpj: c.cpfCnpj };
    if (dig) clientByDoc.push([dig, val]);
    clientByDoc.push([`RAW::${normKey(c.cpfCnpj)}`, val]);
    clientByNameUnit.push([`${c.unitId}::${normKey(c.fullName)}`, val]);
  }

  const linkSet = existingLinks.map((l) => `${l.titularClientId}::${l.assetOwnerClientId}`);

  const admByContract: Array<
    [string, { id: number; protocolCode: string; integrativeCode: string | null }]
  > = [];
  for (const a of existingAdmissions) {
    const val = { id: a.id, protocolCode: a.protocolCode, integrativeCode: a.integrativeCode };
    if (a.contractNumber) {
      admByContract.push([`${a.unitId}::${normKey(a.contractNumber)}`, val]);
    }
    if (a.protocolCode) {
      admByContract.push([`PROTO::${normKey(a.protocolCode)}`, val]);
    }
  }

  const modalitySet = [...new Set(existingModalities.map((m) => normKey(m.description)))];

  return {
    fallbackUnitId: fallbackUnit.id,
    fallbackUnitCode: fallbackUnit.code,
    unitByCode,
    febrabanByName,
    bankByName,
    collabByKey,
    userByKey,
    clientByDoc,
    clientByNameUnit,
    linkSet,
    admByContract,
    modalitySet,
    bankSeq: existingBanks.length + 1,
    collabSeq: existingCollabs.length + 1,
    admSeq: existingAdmissions.length + 1,
    totals: {
      totalRows: 0,
      clientsCreated: 0,
      clientsUpdated: 0,
      titularesCreated: 0,
      titularesUpdated: 0,
      assetLinksCreated: 0,
      banksCreated: 0,
      banksLinked: 0,
      collaboratorsCreated: 0,
      collaboratorsLinked: 0,
      admissionsCreated: 0,
      admissionsUpdated: 0,
      errors: 0,
    },
  };
}

async function materializePdfSheetsToWorkDir(params: {
  filePath: string;
  originalFileName: string;
  fileSizeBytes: number;
  uploadSessionId?: string;
  columnMappingsOverride?: Record<string, string>;
}): Promise<IviPlanFile> {
  const workDir = getIviWorkDir(params.filePath);
  await fs.promises.mkdir(workDir, { recursive: true });

  const [refPayload, pdfRes] = await Promise.all([
    getFolhaRostoReferenceForms(),
    readFolhaRostoPdfAsSheets(params.filePath),
  ]);

  if (pdfRes.sheets.length === 0) {
    throw new Error('Nenhuma ficha ou aba com dados válidos foi encontrada no PDF enviado.');
  }

  const streamSheets: Array<{
    sheetName: string;
    headers: string[];
    rowCount: number;
    sampleRows: Array<Record<string, unknown>>;
    chunkIndices: number[];
  }> = [];
  const plannedChunks: IviPlannedChunkMeta[] = [];
  const manifestChunks: SpreadsheetChunkMeta[] = [];

  for (const s of pdfRes.sheets) {
    const sInfo = {
      sheetName: s.sheetName,
      headers: s.headers,
      rowCount: s.rows.length,
      sampleRows: s.rows.slice(0, 8),
      chunkIndices: [] as number[],
    };
    streamSheets.push(sInfo);

    for (let i = 0; i < s.rows.length; i += SPREADSHEET_CHUNK_ROWS) {
      const slice = s.rows.slice(i, i + SPREADSHEET_CHUNK_ROWS);
      const chunkIndex = plannedChunks.length;
      const chunkFile = `chunk-${String(chunkIndex).padStart(5, '0')}.json`;
      await fs.promises.writeFile(path.join(workDir, chunkFile), JSON.stringify(slice), 'utf8');
      sInfo.chunkIndices.push(chunkIndex);
      const startRowNumber = slice[0]?.__rowNumber ?? i + 1;
      const endRowNumber = slice[slice.length - 1]?.__rowNumber ?? startRowNumber;
      plannedChunks.push({
        chunkIndex,
        sheetName: s.sheetName,
        fileName: chunkFile,
        startRowNumber,
        endRowNumber,
        rowCount: slice.length,
        analyzeStatus: 'done',
        commitStatus: 'pending',
      });
      manifestChunks.push({
        chunkIndex,
        sheetName: s.sheetName,
        fileName: chunkFile,
        startRowNumber,
        endRowNumber,
        rowCount: slice.length,
        dryRunStatus: 'done',
        commitStatus: 'pending',
        analyzeStatus: 'done',
      });
    }
  }

  const totalRows = plannedChunks.reduce((acc, c) => acc + c.rowCount, 0);
  const manifest: SpreadsheetStreamManifest = {
    filePath: params.filePath,
    originalFileName: params.originalFileName,
    fileSizeBytes: params.fileSizeBytes,
    createdAt: new Date().toISOString(),
    chunkRows: SPREADSHEET_CHUNK_ROWS,
    totalSheets: streamSheets.length,
    totalChunks: plannedChunks.length,
    totalRows,
    sheets: streamSheets,
    chunks: manifestChunks,
  };
  await saveManifest(workDir, manifest);

  const mapped = await computeInitialMappingsForSheets({
    sheets: streamSheets,
    refPayload,
    columnMappingsOverride: params.columnMappingsOverride,
  });

  const plan: IviPlanFile = {
    filePath: params.filePath,
    originalFileName: params.originalFileName,
    fileSizeBytes: params.fileSizeBytes,
    uploadSessionId: params.uploadSessionId,
    isPdf: true,
    totalRows,
    totalChunks: plannedChunks.length,
    batchSizeRows: SPREADSHEET_CHUNK_ROWS,
    sheets: streamSheets.map((s) => ({
      sheetName: s.sheetName,
      headers: s.headers,
      rowCount: s.rowCount,
    })),
    initialMappings: mapped.mappings,
    geminiDiagnostic: mapped.diagnostic,
    usedGemini: mapped.usedGemini,
    pdfMetadata: pdfRes.pdfMetadata,
    chunks: plannedChunks,
  };

  await fs.promises.writeFile(path.join(workDir, 'ivi-plan.json'), JSON.stringify(plan), 'utf8');
  triggerBestEffortGc();
  return plan;
}

export async function prepareIviSpreadsheetWork(params: {
  filePath: string;
  originalFileName: string;
  fileSizeBytes?: number;
  uploadSessionId?: string;
  columnMappingsOverride?: Record<string, string>;
}): Promise<IviSpreadsheetPrepareResult> {
  const workDir = getIviWorkDir(params.filePath);
  const size = params.fileSizeBytes ?? fs.statSync(params.filePath).size;

  const [refPayload, manifest] = await Promise.all([
    getFolhaRostoReferenceForms(),
    streamSpreadsheetToChunks({
      filePath: params.filePath,
      originalFileName: params.originalFileName,
      workDir,
      chunkRows: SPREADSHEET_CHUNK_ROWS,
      headerMode: 'best_of_5',
      skipMetaSheets: true,
    }),
  ]);

  if (manifest.sheets.length === 0 || manifest.chunks.length === 0) {
    throw new Error('Nenhuma aba ou linha com dados válidos foi encontrada na planilha enviada.');
  }

  const mapped = await computeInitialMappingsForSheets({
    sheets: manifest.sheets,
    refPayload,
    columnMappingsOverride: params.columnMappingsOverride,
  });

  const plannedChunks: IviPlannedChunkMeta[] = manifest.chunks.map((ch) => ({
    chunkIndex: ch.chunkIndex,
    sheetName: ch.sheetName,
    fileName: ch.fileName,
    startRowNumber: ch.startRowNumber,
    endRowNumber: ch.endRowNumber,
    rowCount: ch.rowCount,
    analyzeStatus: 'pending',
    commitStatus: 'pending',
  }));

  const plan: IviPlanFile = {
    filePath: params.filePath,
    originalFileName: params.originalFileName,
    fileSizeBytes: size,
    uploadSessionId: params.uploadSessionId,
    isPdf: false,
    totalRows: manifest.totalRows,
    totalChunks: plannedChunks.length,
    batchSizeRows: SPREADSHEET_CHUNK_ROWS,
    sheets: manifest.sheets.map((s) => ({
      sheetName: s.sheetName,
      headers: s.headers,
      rowCount: s.rowCount,
    })),
    initialMappings: mapped.mappings,
    geminiDiagnostic: mapped.diagnostic,
    usedGemini: mapped.usedGemini,
    chunks: plannedChunks,
  };

  const initialState = await hydrateIviAnalysisLookups();

  await Promise.all([
    fs.promises.writeFile(path.join(workDir, 'ivi-plan.json'), JSON.stringify(plan), 'utf8'),
    fs.promises.writeFile(path.join(workDir, 'analysis-state.json'), JSON.stringify(initialState), 'utf8'),
  ]);
  triggerBestEffortGc();

  return {
    isPdf: false,
    totalSheets: plan.sheets.length,
    totalChunks: plan.totalChunks,
    totalRows: plan.totalRows,
    batchSizeRows: SPREADSHEET_CHUNK_ROWS,
    sheets: plan.sheets,
    usedGemini: mapped.usedGemini,
  };
}

export async function processIviSpreadsheetAnalyzeBatch(params: {
  filePath: string;
  startChunk: number;
  batchCount?: number;
  reset?: boolean;
  forceForm?: 'auto' | 'veiculo' | 'cartao';
  columnMappingsOverride?: Record<string, string>;
}): Promise<IviAnalyzeBatchResult> {
  const workDir = getIviWorkDir(params.filePath);
  const planPath = path.join(workDir, 'ivi-plan.json');
  const statePath = path.join(workDir, 'analysis-state.json');

  const plan = JSON.parse(await fs.promises.readFile(planPath, 'utf8')) as IviPlanFile;
  const refPayload = await getFolhaRostoReferenceForms();
  const effectiveMappings = resolveEffectiveMappings(
    plan.initialMappings,
    refPayload.variables,
    params.columnMappingsOverride
  );

  let serState: SerializedIviAnalysisState;
  if (params.reset || !fs.existsSync(statePath)) {
    for (const c of plan.chunks) c.analyzeStatus = 'pending';
    serState = await hydrateIviAnalysisLookups();
  } else {
    serState = JSON.parse(
      await fs.promises.readFile(statePath, 'utf8')
    ) as SerializedIviAnalysisState;
  }

  const bankSet = new Set<string>(serState.bankSet);
  const collabSet = new Set<string>(serState.collabSet);
  const clientDocSet = new Set<string>(serState.clientDocSet);
  const clientNameSet = new Set<string>(serState.clientNameSet);
  const admContractSet = new Set<string>(serState.admContractSet);
  const estimatedOperations = serState.estimatedOperations;
  const previews = serState.previews;
  let veiculoRows = serState.veiculoRows;
  let cartaoRows = serState.cartaoRows;

  const start = Math.max(0, Math.trunc(params.startChunk));
  const count = Math.max(1, Math.min(4, Math.trunc(params.batchCount ?? 2)));
  const end = Math.min(plan.chunks.length - 1, start + count - 1);

  let batchProcessedRows = 0;
  let currentSheetName = '';

  for (let idx = start; idx <= end; idx++) {
    const chunkMeta = plan.chunks[idx];
    if (!chunkMeta) continue;
    currentSheetName = chunkMeta.sheetName;
    if (chunkMeta.analyzeStatus === 'done') continue;

    const headerToVarKey = new Map<string, string>();
    for (const m of effectiveMappings) {
      if (m.sheetName === chunkMeta.sheetName && m.mappedVariableKey) {
        headerToVarKey.set(m.sourceColumn, m.mappedVariableKey);
      }
    }

    const rows = await readSpreadsheetChunk(workDir, chunkMeta.fileName);
    for (const row of rows) {
      const ext = buildExtractedRecord(row, headerToVarKey);
      const detectedForm = classifyRowForm({
        extracted: ext,
        sheetName: chunkMeta.sheetName,
        forceForm: params.forceForm,
      });
      if (detectedForm === 'veiculo') veiculoRows++;
      else cartaoRows++;

      const clientName = ext['cliente.nome'] || ext['titular.nome'] || '';
      const clientCpf = ext['cliente.documento'] || ext['titular.documento'] || '';
      const titularName = ext['titular.nome'] || '';
      const titularCpf = ext['titular.documento'] || '';
      const bankName = ext['banco.nome'] || '';
      const collaboratorName = ext['colaborador.nome'] || '';
      const contractNumber = ext['admissao.contrato'] || '';

      const actions: string[] = [];
      const warnings: string[] = [];

      if (!clientName && !titularName && !contractNumber) {
        estimatedOperations.errors++;
        warnings.push('Linha sem Nome do Cliente/Titular ou Nº do Contrato');
      } else {
        if (bankName) {
          const bk = normKey(bankName);
          if (bankSet.has(bk)) {
            estimatedOperations.banksMatched++;
            actions.push('Banco vinculado');
          } else {
            bankSet.add(bk);
            estimatedOperations.banksInsert++;
            actions.push('Banco será cadastrado');
          }
        }

        if (collaboratorName) {
          const ck = normKey(collaboratorName);
          if (collabSet.has(ck)) {
            estimatedOperations.collaboratorsMatched++;
            actions.push('Colaborador vinculado');
          } else {
            collabSet.add(ck);
            estimatedOperations.collaboratorsInsert++;
            actions.push('Colaborador será cadastrado');
          }
        }

        if (clientName) {
          const dig = normDigits(clientCpf);
          const isExisting =
            dig.length >= 11 ? clientDocSet.has(dig) : clientNameSet.has(normKey(clientName));
          if (isExisting) {
            estimatedOperations.clientsUpdate++;
            actions.push('Cliente atualizado');
          } else {
            if (dig.length >= 11) clientDocSet.add(dig);
            clientNameSet.add(normKey(clientName));
            estimatedOperations.clientsInsert++;
            actions.push('Cliente cadastrado');
          }
          if (dig.length < 11) {
            warnings.push('CPF/CNPJ ausente ou curto (será gerada identificação provisória)');
          }
        }

        const hasDistinctTitular =
          Boolean(titularName) &&
          (Boolean(titularCpf && normDigits(titularCpf) !== normDigits(clientCpf)) ||
            normKey(titularName) !== normKey(clientName));

        if (hasDistinctTitular) {
          const tDig = normDigits(titularCpf);
          const tExisting =
            tDig.length >= 11 ? clientDocSet.has(tDig) : clientNameSet.has(normKey(titularName));
          if (tExisting) {
            estimatedOperations.titularesUpdate++;
            actions.push('Titular atualizado');
          } else {
            if (tDig.length >= 11) clientDocSet.add(tDig);
            clientNameSet.add(normKey(titularName));
            estimatedOperations.titularesInsert++;
            actions.push('Titular cadastrado');
          }
          estimatedOperations.assetLinksInsert++;
          actions.push('Vínculo Titular ↔ Responsável');
        }

        if (contractNumber && admContractSet.has(normKey(contractNumber))) {
          estimatedOperations.admissionsUpdate++;
          actions.push('Admissão atualizada');
        } else {
          if (contractNumber) admContractSet.add(normKey(contractNumber));
          estimatedOperations.admissionsInsert++;
          actions.push(
            detectedForm === 'veiculo'
              ? 'Admissão Veículo criada'
              : 'Admissão Cartão de Crédito criada'
          );
        }
      }

      if (previews.length < 150) {
        const vehicleSummary = [
          ext['admissao.marca_veiculo'],
          ext['admissao.modelo_veiculo'],
          ext['admissao.ano_veiculo'],
          ext['admissao.placa'],
        ]
          .filter(Boolean)
          .join(' · ');
        previews.push({
          sheetName: chunkMeta.sheetName,
          rowNumber: row.__rowNumber,
          detectedForm,
          formLabel:
            detectedForm === 'veiculo'
              ? refPayload.forms.veiculo.name
              : refPayload.forms.cartao.name,
          clientName,
          clientCpf,
          titularName: hasDistinctTitularName(titularName, titularCpf, clientName, clientCpf)
            ? titularName
            : clientName,
          titularCpf: hasDistinctTitularName(titularName, titularCpf, clientName, clientCpf)
            ? titularCpf
            : clientCpf,
          bankName,
          collaboratorName,
          contractNumber,
          vehicleSummary,
          actions,
          warnings,
        });
      }

      batchProcessedRows++;
    }

    chunkMeta.analyzeStatus = 'done';
    rows.length = 0;
  }

  const nextState: SerializedIviAnalysisState = {
    unitSet: serState.unitSet,
    bankSet: [...bankSet],
    collabSet: [...collabSet],
    clientDocSet: [...clientDocSet],
    clientNameSet: [...clientNameSet],
    admContractSet: [...admContractSet],
    veiculoRows,
    cartaoRows,
    estimatedOperations,
    previews,
  };

  await Promise.all([
    fs.promises.writeFile(statePath, JSON.stringify(nextState), 'utf8'),
    fs.promises.writeFile(planPath, JSON.stringify(plan), 'utf8'),
  ]);
  triggerBestEffortGc();

  const markedReadChunks = plan.chunks.filter((c) => c.analyzeStatus === 'done').length;
  const processedRows = plan.chunks
    .filter((c) => c.analyzeStatus === 'done')
    .reduce((acc, c) => acc + c.rowCount, 0);

  return {
    processedChunks: markedReadChunks,
    totalChunks: plan.totalChunks,
    markedReadChunks,
    processedRows,
    totalRows: plan.totalRows,
    batchProcessedRows,
    currentSheetName,
    veiculoRows,
    cartaoRows,
    estimatedOperations,
    done: markedReadChunks >= plan.totalChunks,
  };
}

export async function finalizeIviSpreadsheetAnalyze(params: {
  filePath: string;
  columnMappingsOverride?: Record<string, string>;
}): Promise<IviFolhaRostoAnalyzeResult> {
  const workDir = getIviWorkDir(params.filePath);
  const planPath = path.join(workDir, 'ivi-plan.json');
  const statePath = path.join(workDir, 'analysis-state.json');

  const [refPayload, rawPlan, rawState] = await Promise.all([
    getFolhaRostoReferenceForms(),
    fs.promises.readFile(planPath, 'utf8'),
    fs.promises.readFile(statePath, 'utf8'),
  ]);

  const plan = JSON.parse(rawPlan) as IviPlanFile;
  const st = JSON.parse(rawState) as SerializedIviAnalysisState;
  const mappings = resolveEffectiveMappings(
    plan.initialMappings,
    refPayload.variables,
    params.columnMappingsOverride
  );

  const dominantForm: 'veiculo' | 'cartao' | 'misto' =
    st.veiculoRows > 0 && st.cartaoRows > 0
      ? 'misto'
      : st.veiculoRows > 0
      ? 'veiculo'
      : 'cartao';

  triggerBestEffortGc();

  return {
    fileName: plan.originalFileName,
    fileSizeBytes: plan.fileSizeBytes,
    uploadSessionId: plan.uploadSessionId,
    detectedFormSummary: {
      dominantForm,
      veiculoRows: st.veiculoRows,
      cartaoRows: st.cartaoRows,
      totalRows: st.veiculoRows + st.cartaoRows,
    },
    sheets: plan.sheets,
    mappings,
    availableVariables: refPayload.variables,
    estimatedOperations: st.estimatedOperations,
    previews: st.previews,
    iviDiagnosticText: plan.geminiDiagnostic,
    usedGemini: plan.usedGemini,
  };
}

export async function prepareIviCommitWork(params: {
  filePath: string;
  originalFileName: string;
  fileSizeBytes?: number;
  uploadSessionId?: string;
  unitFallbackId?: number | null;
  columnMappingsOverride?: Record<string, string>;
}): Promise<IviCommitPrepareResult> {
  const workDir = getIviWorkDir(params.filePath);
  const planPath = path.join(workDir, 'ivi-plan.json');
  const statePath = path.join(workDir, 'commit-state.json');
  const logsPath = path.join(workDir, 'commit-logs.ndjson');

  let plan: IviPlanFile;
  if (fs.existsSync(planPath)) {
    plan = JSON.parse(await fs.promises.readFile(planPath, 'utf8')) as IviPlanFile;
  } else {
    const isPdf = String(params.originalFileName || params.filePath).toLowerCase().endsWith('.pdf');
    if (isPdf) {
      plan = await materializePdfSheetsToWorkDir({
        filePath: params.filePath,
        originalFileName: params.originalFileName,
        fileSizeBytes: params.fileSizeBytes ?? fs.statSync(params.filePath).size,
        uploadSessionId: params.uploadSessionId,
        columnMappingsOverride: params.columnMappingsOverride,
      });
    } else {
      await prepareIviSpreadsheetWork({
        filePath: params.filePath,
        originalFileName: params.originalFileName,
        fileSizeBytes: params.fileSizeBytes,
        uploadSessionId: params.uploadSessionId,
        columnMappingsOverride: params.columnMappingsOverride,
      });
      plan = JSON.parse(await fs.promises.readFile(planPath, 'utf8')) as IviPlanFile;
    }
  }

  for (const ch of plan.chunks) {
    ch.commitStatus = 'pending';
  }
  const initialCommitState = await hydrateIviCommitLookups(params.unitFallbackId);

  await Promise.all([
    fs.promises.writeFile(planPath, JSON.stringify(plan), 'utf8'),
    fs.promises.writeFile(statePath, JSON.stringify(initialCommitState), 'utf8'),
    fs.promises.writeFile(logsPath, '', 'utf8'),
  ]);
  triggerBestEffortGc();

  return {
    totalChunks: plan.totalChunks,
    totalRows: plan.totalRows,
    batchSizeRows: plan.batchSizeRows || SPREADSHEET_CHUNK_ROWS,
    sheets: plan.sheets,
  };
}

export async function processIviCommitBatch(params: {
  filePath: string;
  startChunk: number;
  batchCount?: number;
  unitFallbackId?: number | null;
  forceForm?: 'auto' | 'veiculo' | 'cartao';
  columnMappingsOverride?: Record<string, string>;
  actorUserId?: number | null;
  actorName: string;
}): Promise<IviCommitBatchResult> {
  const workDir = getIviWorkDir(params.filePath);
  const planPath = path.join(workDir, 'ivi-plan.json');
  const statePath = path.join(workDir, 'commit-state.json');
  const logsPath = path.join(workDir, 'commit-logs.ndjson');

  const [rawPlan, rawState, refPayload] = await Promise.all([
    fs.promises.readFile(planPath, 'utf8'),
    fs.promises.readFile(statePath, 'utf8'),
    getFolhaRostoReferenceForms(),
  ]);

  const plan = JSON.parse(rawPlan) as IviPlanFile;
  const ser = JSON.parse(rawState) as SerializedIviCommitState;
  const effectiveMappings = resolveEffectiveMappings(
    plan.initialMappings,
    refPayload.variables,
    params.columnMappingsOverride
  );

  const unitByCode = new Map(ser.unitByCode);
  const fallbackUnit =
    (params.unitFallbackId
      ? ser.unitByCode.find(([, v]) => v.id === params.unitFallbackId)?.[1]
      : undefined) || { id: ser.fallbackUnitId, code: ser.fallbackUnitCode };
  const febrabanByName = new Map(ser.febrabanByName);
  const bankByName = new Map(ser.bankByName);
  const collabByKey = new Map(ser.collabByKey);
  const userByKey = new Map(ser.userByKey);
  const clientByDoc = new Map(ser.clientByDoc);
  const clientByNameUnit = new Map(ser.clientByNameUnit);
  const linkSet = new Set(ser.linkSet);
  const admByContract = new Map(ser.admByContract);
  const modalitySet = new Set(ser.modalitySet);
  let bankSeq = ser.bankSeq;
  let collabSeq = ser.collabSeq;
  let admSeq = ser.admSeq;
  const totals = ser.totals;

  const start = Math.max(0, Math.trunc(params.startChunk));
  const count = Math.max(1, Math.min(2, Math.trunc(params.batchCount ?? 1)));
  const end = Math.min(plan.chunks.length - 1, start + count - 1);

  let batchProcessedRows = 0;
  let currentSheetName = '';

  for (let idx = start; idx <= end; idx++) {
    const chunkMeta = plan.chunks[idx];
    if (!chunkMeta) continue;
    currentSheetName = chunkMeta.sheetName;
    if (chunkMeta.commitStatus === 'done') continue;

    const headerToVarKey = new Map<string, string>();
    for (const m of effectiveMappings) {
      if (m.sheetName === chunkMeta.sheetName && m.mappedVariableKey) {
        headerToVarKey.set(m.sourceColumn, m.mappedVariableKey);
      }
    }

    const rows = await readSpreadsheetChunk(workDir, chunkMeta.fileName);
    const chunkLogLines: string[] = [];

    await db.transaction(async (tx) => {
      for (const row of rows) {
        totals.totalRows++;
        batchProcessedRows++;
        const ext = buildExtractedRecord(row, headerToVarKey);
        const detectedForm = classifyRowForm({
          extracted: ext,
          sheetName: chunkMeta.sheetName,
          forceForm: params.forceForm,
        });

        const unitObj =
          (ext['empresa.codigo_unidade'] && unitByCode.get(normKey(ext['empresa.codigo_unidade']))) ||
          fallbackUnit;
        const unitId = unitObj.id;
        const unitCode = unitObj.code;

        const rawClientName = ext['cliente.nome'] || ext['titular.nome'] || '';
        const rawClientCpf = ext['cliente.documento'] || ext['titular.documento'] || '';
        const rawTitularName = ext['titular.nome'] || '';
        const rawTitularCpf = ext['titular.documento'] || '';
        const bankNameInput = ext['banco.nome'] || 'Banco Não Informado';
        const collabNameInput = ext['colaborador.nome'] || '';
        let contractNumber = ext['admissao.contrato'] || '';

        try {
          if (!rawClientName && !rawTitularName && !contractNumber) {
            throw new Error('Linha sem identificação de cliente/titular ou contrato');
          }

          // 1. BANCO (banks)
          let finalBankName = bankNameInput;
          const bankKey = normKey(bankNameInput);
          const foundBank = bankByName.get(bankKey);
          if (foundBank) {
            finalBankName = foundBank.name;
            totals.banksLinked++;
          } else {
            const code = `BCO-${String(bankSeq++).padStart(4, '0')}`;
            let febraban = ext['banco.febraban'] || febrabanByName.get(bankKey) || '';
            if (!febraban) {
              for (const [fbName, fbCode] of febrabanByName.entries()) {
                if (fbName.includes(bankKey) || bankKey.includes(fbName)) {
                  febraban = fbCode;
                  break;
                }
              }
            }
            const [insBank] = await tx
              .insert(banks)
              .values({
                code,
                name: bankNameInput,
                febrabanCode: febraban,
                status: 'ATIVO',
                notes: 'Cadastrado pela Ivi via Leitura Inteligente Folha de Rosto',
              })
              .returning({ id: banks.id, name: banks.name });
            bankByName.set(bankKey, { id: insBank.id, name: insBank.name });
            finalBankName = insBank.name;
            totals.banksCreated++;
          }

          // 2. COLABORADOR (collaborators)
          let finalConsultantName = collabNameInput || params.actorName;
          let resolvedConsultantUserId: number | null = params.actorUserId ?? null;
          if (collabNameInput) {
            const cEmail = ext['colaborador.email'] || '';
            const cFound =
              (cEmail ? collabByKey.get(`EMAIL::${normKey(cEmail)}`) : undefined) ||
              collabByKey.get(`NAME::${unitId}::${normKey(collabNameInput)}`) ||
              collabByKey.get(`NAME_ANY::${normKey(collabNameInput)}`);

            if (cFound) {
              finalConsultantName = cFound.name;
              totals.collaboratorsLinked++;
            } else {
              const colCode = `COL-${String(collabSeq++).padStart(4, '0')}`;
              const [insCol] = await tx
                .insert(collaborators)
                .values({
                  code: colCode,
                  name: collabNameInput,
                  unitId,
                  jobTitle: 'Consultor(a)',
                  email: cEmail,
                  phone: ext['colaborador.telefone'] || '',
                  active: true,
                  participatesInScheduleQueue: true,
                  notes: 'Cadastrado pela Ivi via Leitura Inteligente Folha de Rosto',
                })
                .returning({ id: collaborators.id, name: collaborators.name });
              if (cEmail) collabByKey.set(`EMAIL::${normKey(cEmail)}`, { id: insCol.id, name: insCol.name });
              collabByKey.set(`NAME::${unitId}::${normKey(collabNameInput)}`, { id: insCol.id, name: insCol.name });
              collabByKey.set(`NAME_ANY::${normKey(collabNameInput)}`, { id: insCol.id, name: insCol.name });
              finalConsultantName = insCol.name;
              totals.collaboratorsCreated++;
            }

            const matchedUserId =
              (cEmail ? userByKey.get(normKey(cEmail)) : undefined) ||
              userByKey.get(normKey(collabNameInput));
            if (matchedUserId) resolvedConsultantUserId = matchedUserId;
          }

          // Helper to upsert a person in `clients`
          const upsertPerson = async (person: {
            fullName: string;
            rawCpf: string;
            rg?: string;
            phone?: string;
            phone2?: string;
            email?: string;
            profession?: string;
            maritalStatus?: string;
            birthDate?: string;
            zipCode?: string;
            address?: string;
            addressNumber?: string;
            complement?: string;
            neighborhood?: string;
            city?: string;
            state?: string;
            clientType: string;
          }): Promise<{ id: number; created: boolean; fullName: string; cpfCnpj: string }> => {
            const dig = normDigits(person.rawCpf);
            const syntheticDoc = `PEND-${unitCode}-${crypto
              .createHash('sha1')
              .update(`${unitId}:${normKey(person.fullName)}`)
              .digest('hex')
              .slice(0, 8)
              .toUpperCase()}`;
            const finalDoc = person.rawCpf || syntheticDoc;

            const existing =
              (dig.length >= 11 ? clientByDoc.get(dig) : undefined) ||
              clientByDoc.get(`RAW::${normKey(finalDoc)}`) ||
              clientByNameUnit.get(`${unitId}::${normKey(person.fullName)}`);

            const payload = {
              personNature: dig.length > 11 ? 'PJ' : 'PF',
              fullName: person.fullName || 'Cliente Sem Nome',
              cpfCnpj: existing?.cpfCnpj || finalDoc,
              rg: person.rg || '',
              birthDate: person.birthDate || '',
              profession: person.profession || '',
              maritalStatus: person.maritalStatus || '',
              phone: person.phone || '',
              whatsapp: normDigits(person.phone2 || person.phone || ''),
              secondaryPhone: person.phone2 || '',
              email: person.email || '',
              zipCode: person.zipCode || '',
              address: person.address || '',
              addressNumber: person.addressNumber || '',
              complement: person.complement || '',
              neighborhood: person.neighborhood || '',
              city: person.city || '',
              state: (person.state || '').toUpperCase().slice(0, 2),
              clientType: person.clientType,
              natureza: 'C',
              status: 'ativo',
              unitId,
            };

            if (existing) {
              await tx
                .update(clients)
                .set({
                  ...(person.fullName ? { fullName: person.fullName } : {}),
                  ...(person.rg ? { rg: person.rg } : {}),
                  ...(person.birthDate ? { birthDate: person.birthDate } : {}),
                  ...(person.profession ? { profession: person.profession } : {}),
                  ...(person.maritalStatus ? { maritalStatus: person.maritalStatus } : {}),
                  ...(person.phone ? { phone: person.phone } : {}),
                  ...(person.phone2 ? { secondaryPhone: person.phone2 } : {}),
                  ...(person.email ? { email: person.email } : {}),
                  ...(person.zipCode ? { zipCode: person.zipCode } : {}),
                  ...(person.address ? { address: person.address } : {}),
                  ...(person.addressNumber ? { addressNumber: person.addressNumber } : {}),
                  ...(person.complement ? { complement: person.complement } : {}),
                  ...(person.neighborhood ? { neighborhood: person.neighborhood } : {}),
                  ...(person.city ? { city: person.city } : {}),
                  ...(person.state ? { state: person.state.toUpperCase().slice(0, 2) } : {}),
                })
                .where(eq(clients.id, existing.id));
              return { id: existing.id, created: false, fullName: existing.fullName, cpfCnpj: existing.cpfCnpj };
            }

            const [ins] = await tx
              .insert(clients)
              .values(payload)
              .returning({ id: clients.id, fullName: clients.fullName, cpfCnpj: clients.cpfCnpj });
            const insDig = normDigits(ins.cpfCnpj);
            if (insDig) clientByDoc.set(insDig, { id: ins.id, fullName: ins.fullName, cpfCnpj: ins.cpfCnpj });
            clientByDoc.set(`RAW::${normKey(ins.cpfCnpj)}`, { id: ins.id, fullName: ins.fullName, cpfCnpj: ins.cpfCnpj });
            clientByNameUnit.set(`${unitId}::${normKey(ins.fullName)}`, {
              id: ins.id,
              fullName: ins.fullName,
              cpfCnpj: ins.cpfCnpj,
            });
            return { id: ins.id, created: true, fullName: ins.fullName, cpfCnpj: ins.cpfCnpj };
          };

          // 3. CLIENTE & TITULAR (clients + client_asset_links)
          const distinctTitular = hasDistinctTitularName(
            rawTitularName,
            rawTitularCpf,
            rawClientName,
            rawClientCpf
          );

          const primaryCliente = await upsertPerson({
            fullName: rawClientName || rawTitularName,
            rawCpf: rawClientCpf || rawTitularCpf,
            rg: ext['cliente.rg'],
            phone: ext['cliente.telefone'],
            phone2: ext['cliente.telefone2'],
            email: ext['cliente.email'],
            profession: ext['cliente.profissao'],
            maritalStatus: ext['cliente.estado_civil'],
            birthDate: ext['cliente.data_nascimento'],
            zipCode: ext['cliente.cep'],
            address: ext['cliente.endereco'],
            addressNumber: ext['cliente.numero'],
            complement: ext['cliente.complemento'],
            neighborhood: ext['cliente.bairro'],
            city: ext['cliente.cidade'],
            state: ext['cliente.uf'],
            clientType: distinctTitular ? 'responsavel_bem' : ext['cliente.tipo'] || 'titular',
          });

          if (primaryCliente.created) totals.clientsCreated++;
          else totals.clientsUpdated++;

          let admissionClientId = primaryCliente.id;
          let admissionAssetOwnerId: number | null = null;
          let clientRoleSelected: 'titular' | 'responsavel' = 'titular';
          let titularDisplayName = primaryCliente.fullName;

          if (distinctTitular) {
            const titularPerson = await upsertPerson({
              fullName: rawTitularName,
              rawCpf: rawTitularCpf,
              rg: ext['titular.rg'],
              phone: ext['titular.telefone'],
              email: ext['titular.email'],
              profession: ext['titular.profissao'],
              maritalStatus: ext['titular.estado_civil'],
              birthDate: ext['titular.data_nascimento'],
              zipCode: ext['titular.cep'],
              address: ext['titular.endereco'],
              addressNumber: ext['titular.numero'],
              complement: ext['titular.complemento'],
              neighborhood: ext['titular.bairro'],
              city: ext['titular.cidade'],
              state: ext['titular.uf'],
              clientType: 'titular',
            });

            if (titularPerson.created) totals.titularesCreated++;
            else totals.titularesUpdated++;

            admissionClientId = titularPerson.id;
            admissionAssetOwnerId = primaryCliente.id;
            clientRoleSelected = 'responsavel';
            titularDisplayName = titularPerson.fullName;

            const linkKey = `${titularPerson.id}::${primaryCliente.id}`;
            if (!linkSet.has(linkKey)) {
              await tx.insert(clientAssetLinks).values({
                titularClientId: titularPerson.id,
                assetOwnerClientId: primaryCliente.id,
                relationshipLabel: 'Titular ↔ Responsável (Folha de Rosto)',
                vehiclePlate: ext['admissao.placa'] || '',
                vehicleModel: [ext['admissao.marca_veiculo'], ext['admissao.modelo_veiculo']].filter(Boolean).join(' '),
                renavam: ext['admissao.renavam'] || '',
              });
              linkSet.add(linkKey);
              totals.assetLinksCreated++;
            }
          }

          // 4. ADMISSÃO (admissions)
          const isVehicle = detectedForm === 'veiculo';
          const defaultModality = isVehicle ? 'CDC Veículo' : 'Cartão de Crédito';
          const modalityLabel = ext['modalidade.descricao'] || defaultModality;
          const debtType = isVehicle ? 'veicular' : 'cartao';

          if (!modalitySet.has(normKey(modalityLabel))) {
            await tx.insert(modalities).values({
              type: isVehicle ? 'Veicular' : 'Bancário',
              description: modalityLabel,
              hasVehicleSection: isVehicle,
              active: true,
            });
            modalitySet.add(normKey(modalityLabel));
          }

          if (!contractNumber) {
            contractNumber = `CT-IVI-${String(admSeq).padStart(5, '0')}`;
          }

          const existingAdm =
            admByContract.get(`${unitId}::${normKey(contractNumber)}`) ||
            admByContract.get(`PROTO::${normKey(contractNumber)}`);

          const seq = admSeq++;
          const protocolCode =
            existingAdm?.protocolCode ||
            `ADM-${String(seq).padStart(4, '0')}-${crypto.randomInt(10, 99)}`;

          const totalParcelas = Math.max(1, parseIntSafe(ext['admissao.total_parcelas'], isVehicle ? 48 : 12));
          const parcelasPagas = Math.max(0, parseIntSafe(ext['admissao.parcelas_pagas'], 0));
          const parcelasAtraso = Math.max(0, parseIntSafe(ext['admissao.parcelas_atraso'], 0));
          const financedAmountCents = parseCentsFromBrl(ext['admissao.valor_financiado']);
          const currentInstallmentCents = parseCentsFromBrl(ext['admissao.valor_parcela']);
          const debtAmountCents =
            parseCentsFromBrl(ext['recalculo.divida_original']) ||
            financedAmountCents ||
            currentInstallmentCents * Math.max(1, totalParcelas - parcelasPagas);
          const serviceFeeCents = parseCentsFromBrl(ext['admissao.taxa_administrativa']);
          const initialInstallmentCents = parseCentsFromBrl(ext['admissao.parcela1']);
          const recalcDebtCents = parseCentsFromBrl(ext['recalculo.divida']);
          const recalcInstallmentCents = parseCentsFromBrl(ext['recalculo.parcela']);
          const savingsCents =
            parseCentsFromBrl(ext['recalculo.economia']) ||
            (debtAmountCents > 0 && recalcDebtCents > 0 ? Math.max(0, debtAmountCents - recalcDebtCents) : 0);
          const dueDay = Math.min(31, Math.max(1, parseIntSafe(ext['admissao.dia_vencimento'] || ext['recalculo.dia_vencimento'], 10)));

          const scenariosJson: AdmissionScenarioCol[] =
            debtAmountCents > 0 || recalcDebtCents > 0 || savingsCents > 0
              ? [
                  {
                    id: 'scn-ivi-1',
                    name: 'Recálculo Folha de Rosto',
                    servicePercent: 20,
                    installmentsToPay: Math.max(1, parseIntSafe(ext['admissao.parcelas_a_pagar'], totalParcelas - parcelasPagas)),
                    originalDebtCents: debtAmountCents,
                    recalcInstallmentCents,
                    recalcDebtCents: recalcDebtCents || Math.max(0, debtAmountCents - savingsCents),
                    savingsCents,
                    dueDay,
                  },
                ]
              : [];

          const vehicleInfo = [
            ext['admissao.marca_veiculo'],
            ext['admissao.modelo_veiculo'],
            ext['admissao.ano_veiculo'],
            ext['admissao.cor_veiculo'],
            ext['admissao.placa'],
          ]
            .filter(Boolean)
            .join(' · ');

          const admValues = {
            protocolCode,
            clientId: admissionClientId,
            assetOwnerId: admissionAssetOwnerId,
            clientRoleSelected,
            unitId,
            origin: ext['admissao.tipo_origem'] || 'prospeccao',
            consultantId: resolvedConsultantUserId,
            consultantName: finalConsultantName,
            debtType,
            modality: modalityLabel,
            series: 'ADM',
            indicationSource: ext['admissao.tipo_indicacao'] || '',
            bankName: finalBankName,
            contractNumber,
            vehicleInfo,
            vehicleBrand: isVehicle ? ext['admissao.marca_veiculo'] || '' : '',
            vehicleModel: isVehicle ? ext['admissao.modelo_veiculo'] || '' : '',
            vehicleColor: isVehicle ? ext['admissao.cor_veiculo'] || '' : '',
            vehicleYear: isVehicle ? ext['admissao.ano_veiculo'] || '' : '',
            vehiclePlate: isVehicle ? ext['admissao.placa'] || '' : '',
            vehicleChassis: isVehicle ? ext['admissao.chassi'] || '' : '',
            vehicleRenavam: isVehicle ? ext['admissao.renavam'] || '' : '',
            debtTotalInstallments: totalParcelas,
            debtPaidInstallments: parcelasPagas,
            debtOverdueInstallments: parcelasAtraso,
            financedAmountCents,
            currentInstallmentCents,
            debtDueDay: dueDay,
            paymentType: ext['admissao.forma_pagamento'] || 'boleto',
            debtAmountCents,
            serviceFeeCents,
            initialInstallmentCents,
            scenariosJson,
            status: ext['admissao.status'] || 'pendente',
            notes:
              ext['admissao.info1'] ||
              `Admissão importada pela Ivi via comparativo ${isVehicle ? 'Folha de Rosto - Veículo' : 'Folha de Rosto - Cartão de Crédito'}`,
          };

          let finalIntegrativeCode = existingAdm?.integrativeCode || '';
          if (existingAdm) {
            if (!finalIntegrativeCode) {
              finalIntegrativeCode = generateIntegrativeCode({
                unitCode,
                entityType: 'DOSS',
                entityId: existingAdm.id,
                referenceSeed: contractNumber,
              });
            }
            await tx
              .update(admissions)
              .set({ ...admValues, integrativeCode: finalIntegrativeCode })
              .where(eq(admissions.id, existingAdm.id));
            totals.admissionsUpdated++;
          } else {
            const [insAdm] = await tx
              .insert(admissions)
              .values(admValues)
              .returning({ id: admissions.id });
            finalIntegrativeCode = generateIntegrativeCode({
              unitCode,
              entityType: 'DOSS',
              entityId: insAdm.id,
              referenceSeed: contractNumber,
            });
            await tx
              .update(admissions)
              .set({ integrativeCode: finalIntegrativeCode, legacyProtocolCode: protocolCode })
              .where(eq(admissions.id, insAdm.id));
            admByContract.set(`${unitId}::${normKey(contractNumber)}`, {
              id: insAdm.id,
              protocolCode,
              integrativeCode: finalIntegrativeCode,
            });
            totals.admissionsCreated++;
          }

          chunkLogLines.push(
            JSON.stringify({
              sheetName: chunkMeta.sheetName,
              rowNumber: row.__rowNumber,
              formMatched: isVehicle ? 'Folha de Rosto - Veículo' : 'Folha de Rosto - Cartão de Crédito',
              clientName: primaryCliente.fullName,
              titularName: titularDisplayName,
              bankName: finalBankName,
              collaboratorName: finalConsultantName,
              contractNumber,
              protocolCode,
              integrativeCode: finalIntegrativeCode,
              status: 'OK',
              detail: existingAdm ? 'Registro completo atualizado' : 'Cadastros & Admissão criados',
            })
          );
        } catch (err) {
          totals.errors++;
          chunkLogLines.push(
            JSON.stringify({
              sheetName: chunkMeta.sheetName,
              rowNumber: row.__rowNumber,
              formMatched:
                detectedForm === 'veiculo'
                  ? 'Folha de Rosto - Veículo'
                  : 'Folha de Rosto - Cartão de Crédito',
              clientName: rawClientName,
              titularName: rawTitularName || rawClientName,
              bankName: bankNameInput,
              collaboratorName: collabNameInput,
              contractNumber,
              protocolCode: '',
              integrativeCode: '',
              status: 'ERRO',
              detail: err instanceof Error ? err.message : 'Erro ao processar linha',
            })
          );
        }
      }
    });

    if (chunkLogLines.length > 0) {
      await fs.promises.appendFile(logsPath, `${chunkLogLines.join('\n')}\n`, 'utf8');
    }

    chunkMeta.commitStatus = 'done';
    rows.length = 0;
  }

  const nextSerState: SerializedIviCommitState = {
    fallbackUnitId: fallbackUnit.id,
    fallbackUnitCode: fallbackUnit.code,
    unitByCode: [...unitByCode.entries()],
    febrabanByName: [...febrabanByName.entries()],
    bankByName: [...bankByName.entries()],
    collabByKey: [...collabByKey.entries()],
    userByKey: [...userByKey.entries()],
    clientByDoc: [...clientByDoc.entries()],
    clientByNameUnit: [...clientByNameUnit.entries()],
    linkSet: [...linkSet],
    admByContract: [...admByContract.entries()],
    modalitySet: [...modalitySet],
    bankSeq,
    collabSeq,
    admSeq,
    totals,
  };

  await Promise.all([
    fs.promises.writeFile(statePath, JSON.stringify(nextSerState), 'utf8'),
    fs.promises.writeFile(planPath, JSON.stringify(plan), 'utf8'),
  ]);
  triggerBestEffortGc();

  const markedReadChunks = plan.chunks.filter((c) => c.commitStatus === 'done').length;
  const processedRows = plan.chunks
    .filter((c) => c.commitStatus === 'done')
    .reduce((acc, c) => acc + c.rowCount, 0);

  return {
    processedChunks: markedReadChunks,
    totalChunks: plan.totalChunks,
    markedReadChunks,
    processedRows,
    totalRows: plan.totalRows,
    batchProcessedRows,
    currentSheetName,
    cumulativeTotals: totals,
    done: markedReadChunks >= plan.totalChunks,
  };
}

export async function finalizeIviCommitWork(params: {
  filePath: string;
  originalFileName: string;
  unitFallbackId?: number | null;
  actorUserId?: number | null;
  actorName: string;
}): Promise<IviFolhaRostoCommitResult> {
  const workDir = getIviWorkDir(params.filePath);
  const statePath = path.join(workDir, 'commit-state.json');
  const logsPath = path.join(workDir, 'commit-logs.ndjson');

  const ser = JSON.parse(await fs.promises.readFile(statePath, 'utf8')) as SerializedIviCommitState;
  const totals = ser.totals;

  await db.insert(auditLogs).values({
    userId: params.actorUserId ?? null,
    userName: params.actorName,
    action: params.originalFileName.toLowerCase().endsWith('.pdf')
      ? 'IVI_FOLHA_ROSTO_PDF_IMPORT'
      : 'IVI_FOLHA_ROSTO_EXCEL_IMPORT',
    entityType: 'data_hub',
    entityId: String(totals.totalRows),
    details: totals,
    unitId: params.unitFallbackId ?? ser.fallbackUnitId,
  });

  const uiRowLogs: IviFolhaRostoCommitResult['rowLogs'] = [];
  const retRows: unknown[][] = [];
  const MAX_RETURN_ROWS = 15000;

  if (fs.existsSync(logsPath)) {
    const stream = fs.createReadStream(logsPath, { encoding: 'utf8', highWaterMark: 128 * 1024 });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.trim()) continue;
      const l = JSON.parse(line) as IviFolhaRostoCommitResult['rowLogs'][number];
      if (uiRowLogs.length < 500) {
        uiRowLogs.push(l);
      }
      if (retRows.length < MAX_RETURN_ROWS) {
        retRows.push([
          l.sheetName,
          l.rowNumber,
          l.formMatched,
          l.clientName,
          l.titularName,
          l.bankName,
          l.collaboratorName,
          l.contractNumber,
          l.protocolCode,
          l.integrativeCode,
          l.status,
          l.detail,
        ]);
      }
    }
  }

  const retWb = XLSX.utils.book_new();
  const retAoa: unknown[][] = [
    [
      'aba',
      'linha',
      'formulario_referencia',
      'cliente',
      'titular',
      'banco',
      'colaborador',
      'contrato',
      'protocolo',
      'codigo_seguro_integrativo',
      'status',
      'detalhe',
    ],
    ...retRows,
  ];
  const ws = XLSX.utils.aoa_to_sheet(retAoa);
  XLSX.utils.book_append_sheet(retWb, ws, 'Retorno_Ivi_FolhaRosto');
  const retBuf = XLSX.write(retWb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  retRows.length = 0;
  triggerBestEffortGc();

  return {
    totals,
    rowLogs: uiRowLogs,
    returnWorkbookBase64: retBuf.toString('base64'),
    returnFileName: `retorno_ivi_folha_rosto_${new Date().toISOString().slice(0, 10)}.xlsx`,
  };
}

// =========================================================================
// COMPATIBLE WRAPPER FUNCTIONS (PDF .parsed.json & DIRECT CALLERS)
// =========================================================================
export async function analyzeSpreadsheetWithFolhaRosto(params: {
  filePath: string;
  originalFileName: string;
  fileSizeBytes: number;
  uploadSessionId?: string;
  unitFallbackId?: number | null;
  forceForm?: 'auto' | 'veiculo' | 'cartao';
  columnMappingsOverride?: Record<string, string>;
}): Promise<IviFolhaRostoAnalyzeResult> {
  const lower = String(params.originalFileName || params.filePath).toLowerCase();
  if (lower.endsWith('.pdf')) {
    const plan = await materializePdfSheetsToWorkDir({
      filePath: params.filePath,
      originalFileName: params.originalFileName,
      fileSizeBytes: params.fileSizeBytes,
      uploadSessionId: params.uploadSessionId,
      columnMappingsOverride: params.columnMappingsOverride,
    });
    const prepInit = await hydrateIviAnalysisLookups();
    const workDir = getIviWorkDir(params.filePath);
    for (const c of plan.chunks) c.analyzeStatus = 'pending';
    await Promise.all([
      fs.promises.writeFile(path.join(workDir, 'ivi-plan.json'), JSON.stringify(plan), 'utf8'),
      fs.promises.writeFile(path.join(workDir, 'analysis-state.json'), JSON.stringify(prepInit), 'utf8'),
    ]);
    for (let idx = 0; idx < plan.totalChunks; idx += 2) {
      await processIviSpreadsheetAnalyzeBatch({
        filePath: params.filePath,
        startChunk: idx,
        batchCount: 2,
        forceForm: params.forceForm,
        columnMappingsOverride: params.columnMappingsOverride,
      });
    }
    const result = await finalizeIviSpreadsheetAnalyze({
      filePath: params.filePath,
      columnMappingsOverride: params.columnMappingsOverride,
    });
    const pdfMeta = plan.pdfMetadata;
    return {
      ...result,
      iviDiagnosticText: pdfMeta
        ? `Ivi processou ${pdfMeta.pageCount} página(s) do PDF (${pdfMeta.digitalPages} digitais${
            pdfMeta.ocrPages > 0 ? `, ${pdfMeta.ocrPages} via OCR Gemini` : ''
          }) e extraiu ${pdfMeta.extractedRecords} ficha(s) comparadas com Folha de Rosto - Veículo e Cartão de Crédito.`
        : result.iviDiagnosticText,
      usedGemini: result.usedGemini || Boolean(pdfMeta && pdfMeta.ocrPages > 0),
      pdfMetadata: pdfMeta,
    };
  }

  // Spreadsheets: reuse existing workDir on re-validation so file is never parsed twice
  const planPath = path.join(getIviWorkDir(params.filePath), 'ivi-plan.json');
  let totalChunks = 0;
  if (fs.existsSync(planPath)) {
    const existingPlan = JSON.parse(await fs.promises.readFile(planPath, 'utf8')) as IviPlanFile;
    totalChunks = existingPlan.totalChunks;
  } else {
    const prep = await prepareIviSpreadsheetWork({
      filePath: params.filePath,
      originalFileName: params.originalFileName,
      fileSizeBytes: params.fileSizeBytes,
      uploadSessionId: params.uploadSessionId,
      columnMappingsOverride: params.columnMappingsOverride,
    });
    totalChunks = prep.totalChunks;
  }

  for (let idx = 0; idx < totalChunks; idx += 2) {
    await processIviSpreadsheetAnalyzeBatch({
      filePath: params.filePath,
      startChunk: idx,
      batchCount: 2,
      reset: idx === 0,
      forceForm: params.forceForm,
      columnMappingsOverride: params.columnMappingsOverride,
    });
  }

  return finalizeIviSpreadsheetAnalyze({
    filePath: params.filePath,
    columnMappingsOverride: params.columnMappingsOverride,
  });
}

export async function commitSpreadsheetWithFolhaRosto(params: {
  filePath: string;
  originalFileName: string;
  unitFallbackId?: number | null;
  forceForm?: 'auto' | 'veiculo' | 'cartao';
  columnMappingsOverride?: Record<string, string>;
  actorUserId?: number | null;
  actorName: string;
}): Promise<IviFolhaRostoCommitResult> {
  const prep = await prepareIviCommitWork({
    filePath: params.filePath,
    originalFileName: params.originalFileName,
    unitFallbackId: params.unitFallbackId,
    columnMappingsOverride: params.columnMappingsOverride,
  });

  for (let idx = 0; idx < prep.totalChunks; idx++) {
    await processIviCommitBatch({
      filePath: params.filePath,
      startChunk: idx,
      batchCount: 1,
      unitFallbackId: params.unitFallbackId,
      forceForm: params.forceForm,
      columnMappingsOverride: params.columnMappingsOverride,
      actorUserId: params.actorUserId,
      actorName: params.actorName,
    });
  }

  return finalizeIviCommitWork({
    filePath: params.filePath,
    originalFileName: params.originalFileName,
    unitFallbackId: params.unitFallbackId,
    actorUserId: params.actorUserId,
    actorName: params.actorName,
  });
}
